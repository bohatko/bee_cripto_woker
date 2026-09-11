import dotenv from 'dotenv';

dotenv.config();

import { supabase } from '../config.js';
import { createExchangeInstance } from '../exchanges/exchange-factory.js';
import { BotPosition, ExchangeAccount } from '../types/index.js';

const SLEEP_MS = 300;

const args = process.argv.slice(2);
const applyMode = args.includes('--apply');
const sinceArg = args.find((a) => a.startsWith('--since='))?.split('=')[1];
const positionArg = args.find((a) => a.startsWith('--position='))?.split('=')[1];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bybitParams(exchange: string): Record<string, any> {
  return exchange === 'bybit' ? { category: 'linear' } : {};
}

// Bybit fetchOrder only scans the last 500 orders and warns unless acknowledged.
function fetchOrderParams(exchange: string): Record<string, any> {
  return exchange === 'bybit' ? { category: 'linear', acknowledged: true } : {};
}

function getUsdtFeeCost(fee: any, referencePrice: number): number {
  if (!fee || typeof fee !== 'object') return 0;
  const cost = Number(fee.cost || 0);
  if (cost === 0 || !Number.isFinite(cost)) return 0;
  const currency = String(fee.currency || '').toUpperCase();
  if (currency === 'USDT' || currency === 'USD' || currency === '') {
    return cost;
  }
  // If fee was paid in the base coin, approximate its USD value using the trade price.
  if (referencePrice > 0) {
    return cost * referencePrice;
  }
  console.warn(`⚠️ Fee currency ${currency} cannot be converted to USDT without a price; treating cost as USDT`);
  return cost;
}

function sumFeeArray(fees: any[] | undefined, referencePrice: number): number {
  if (!Array.isArray(fees)) return 0;
  return fees.reduce((sum, f) => sum + getUsdtFeeCost(f, referencePrice), 0);
}

function extractFeeFromOrderOrTrade(item: any): number {
  const price = Number(item.price || item.average || 0);
  if (item.fee && typeof item.fee === 'object') {
    return getUsdtFeeCost(item.fee, price);
  }
  if (Array.isArray(item.fees)) {
    return sumFeeArray(item.fees, price);
  }
  return 0;
}

function qtyFromOrder(order: any): number {
  if (Number(order.filled) > 0) return Number(order.filled);
  if (order.status === 'closed' && Number(order.amount) > 0) return Number(order.amount);
  return Number(order.amount || 0);
}

async function fetchOrderWithFallback(
  client: any,
  exchange: string,
  symbol: string,
  orderId: string,
  since: number
): Promise<{ qty: number; avgPrice: number; feesUsd: number } | null> {
  const params = bybitParams(exchange);
  try {
    const order = await client.fetchOrder(orderId, symbol, fetchOrderParams(exchange));
    const qty = qtyFromOrder(order);
    const avgPrice = Number(order.average || order.price || 0);
    let feesUsd = extractFeeFromOrderOrTrade(order);
    if (feesUsd === 0 && client.fetchMyTrades) {
      const trades = await client.fetchMyTrades(symbol, since, 200, params);
      const orderTrades = (trades || []).filter((t: any) => t.order === orderId || t.orderId === orderId);
      feesUsd = orderTrades.reduce((sum: number, t: any) => sum + extractFeeFromOrderOrTrade(t), 0);
    }
    if (qty > 0 && avgPrice > 0) {
      return { qty, avgPrice, feesUsd };
    }
  } catch (err: any) {
    console.warn(`⚠️ fetchOrder ${orderId} ${symbol} failed: ${err.message}`);
  }

  // Fallback to trade history if the order cannot be fetched.
  if (client.fetchMyTrades) {
    try {
      const trades = await client.fetchMyTrades(symbol, since, 200, params);
      const orderTrades = (trades || []).filter((t: any) => t.order === orderId || t.orderId === orderId);
      if (orderTrades.length === 0) return null;
      const qty = orderTrades.reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);
      const notional = orderTrades.reduce((sum: number, t: any) => sum + Number(t.amount || 0) * Number(t.price || 0), 0);
      const avgPrice = qty > 0 ? notional / qty : 0;
      const feesUsd = orderTrades.reduce((sum: number, t: any) => sum + extractFeeFromOrderOrTrade(t), 0);
      return { qty, avgPrice, feesUsd };
    } catch (err: any) {
      console.warn(`⚠️ fetchMyTrades fallback for ${orderId} ${symbol} failed: ${err.message}`);
    }
  }
  return null;
}

async function resolveExitLeg(
  client: any,
  exchange: string,
  symbol: string,
  side: 'sell' | 'buy',
  position: BotPosition,
  exitOrderId: string | null,
  targetQty: number
): Promise<{ qty: number; avgPrice: number; feesUsd: number; error?: string } | null> {
  const params = bybitParams(exchange);
  const closedAt = position.closed_at ? new Date(position.closed_at).getTime() : Date.now();
  const since = closedAt - 3 * 60 * 1000;

  // If we stored the exit order id, try it first.
  if (exitOrderId) {
    const result = await fetchOrderWithFallback(client, exchange, symbol, exitOrderId, since);
    if (result) return result;
  }

  if (!client.fetchMyTrades) {
    return { qty: 0, avgPrice: 0, feesUsd: 0, error: 'fetchMyTrades not available' };
  }

  try {
    const trades = await client.fetchMyTrades(symbol, since, 200, params);
    const sideLower = side.toLowerCase();
    const candidates = (trades || []).filter((t: any) => {
      const ts = Number(t.timestamp || 0);
      const tradeSide = String(t.side || '').toLowerCase();
      return ts > 0 && ts >= since && ts <= closedAt + 3 * 60 * 1000 && tradeSide === sideLower;
    });

    if (candidates.length === 0) {
      return { qty: 0, avgPrice: 0, feesUsd: 0, error: `no exit ${side} trades found` };
    }

    // Adjacent positions on the same pair (SL -> immediate re-entry -> SL) can close within the
    // same window. Take the trades closest to closed_at and stop once the position qty is covered.
    const sorted = [...candidates].sort(
      (a: any, b: any) => Math.abs(Number(a.timestamp) - closedAt) - Math.abs(Number(b.timestamp) - closedAt)
    );
    const exitTrades: any[] = [];
    let accumulated = 0;
    const tolerance = targetQty * 0.01;
    for (const t of sorted) {
      if (targetQty > 0 && accumulated >= targetQty - tolerance) break;
      exitTrades.push(t);
      accumulated += Number(t.amount || 0);
    }

    const qty = exitTrades.reduce((sum: number, t: any) => sum + Number(t.amount || 0), 0);
    const notional = exitTrades.reduce(
      (sum: number, t: any) => sum + Number(t.amount || 0) * Number(t.price || 0),
      0
    );
    const avgPrice = qty > 0 ? notional / qty : 0;
    const feesUsd = exitTrades.reduce((sum: number, t: any) => sum + extractFeeFromOrderOrTrade(t), 0);
    return { qty, avgPrice, feesUsd };
  } catch (err: any) {
    return { qty: 0, avgPrice: 0, feesUsd: 0, error: err.message };
  }
}

async function fetchFundingForLeg(
  client: any,
  exchange: string,
  symbol: string,
  openedAt: number,
  closedAt: number
): Promise<number> {
  if (!client.fetchFundingHistory) return 0;
  const params = bybitParams(exchange);
  try {
    const history = await client.fetchFundingHistory(symbol, openedAt, undefined, params);
    if (!Array.isArray(history)) return 0;
    let totalAmount = 0;
    for (const item of history) {
      const ts = Number(item.timestamp || item.info?.execTime || item.info?.fundingTime || 0);
      if (Number.isFinite(ts) && ts > 0 && ts >= openedAt && ts <= closedAt) {
        totalAmount += Number(item.amount || 0);
      }
    }
    // Positive column value means cost to the user.
    return Number((-totalAmount).toFixed(4));
  } catch (err: any) {
    console.warn(`⚠️ fetchFundingHistory ${symbol} failed: ${err.message}`);
    return 0;
  }
}

interface AccountPositions {
  account: ExchangeAccount;
  positions: (BotPosition & { exchange_accounts: ExchangeAccount })[];
}

async function loadPositions(): Promise<AccountPositions[]> {
  let query = supabase
    .from('bot_positions')
    .select('*, exchange_accounts(*)')
    .eq('status', 'closed')
    .eq('is_master', false)
    .not('long_order_id', 'like', 'sim-%');

  if (sinceArg) {
    query = query.gte('closed_at', `${sinceArg}T00:00:00Z`);
  }
  if (positionArg) {
    query = query.eq('id', positionArg);
  }

  const { data, error } = await query;
  if (error) throw new Error(`DB query failed: ${error.message}`);
  if (!data || data.length === 0) return [];

  const grouped = new Map<string, AccountPositions>();
  for (const row of data as any[]) {
    const account: ExchangeAccount = row.exchange_accounts;
    const position: BotPosition = row as BotPosition;
    if (!grouped.has(account.id)) {
      grouped.set(account.id, { account, positions: [] });
    }
    grouped.get(account.id)!.positions.push({ ...position, exchange_accounts: account });
  }
  return Array.from(grouped.values());
}

interface PositionResult {
  id: string;
  pair: string;
  openedAt: string;
  closedAt: string | null;
  oldRealized: number;
  gross: number;
  entryFees: number;
  exitFees: number;
  funding: number;
  newNet: number;
  delta: number;
  status: 'OK' | 'UNRESOLVED';
  reason: string;
}

async function processPosition(
  client: any,
  account: ExchangeAccount,
  position: BotPosition
): Promise<PositionResult> {
  const baseResult: PositionResult = {
    id: position.id,
    pair: position.pair_symbol,
    openedAt: position.opened_at,
    closedAt: position.closed_at,
    oldRealized: Number(position.realized_pnl_usd || 0),
    gross: 0,
    entryFees: 0,
    exitFees: 0,
    funding: 0,
    newNet: 0,
    delta: 0,
    status: 'UNRESOLVED',
    reason: '',
  };

  try {
    const openedAt = new Date(position.opened_at).getTime();
    const closedAt = position.closed_at ? new Date(position.closed_at).getTime() : Date.now();
    const exchange = account.exchange;

    // Entry legs
    const longEntry = await fetchOrderWithFallback(
      client,
      exchange,
      position.long_symbol,
      position.long_order_id || '',
      openedAt - 5 * 60 * 1000
    );
    const shortEntry = await fetchOrderWithFallback(
      client,
      exchange,
      position.short_symbol,
      position.short_order_id || '',
      openedAt - 5 * 60 * 1000
    );

    if (!longEntry) {
      return { ...baseResult, reason: 'long entry order unresolved' };
    }
    if (!shortEntry) {
      return { ...baseResult, reason: 'short entry order unresolved' };
    }

    // Exit legs
    const longExit = await resolveExitLeg(
      client,
      exchange,
      position.long_symbol,
      'sell',
      position,
      position.long_exit_order_id || null,
      longEntry.qty
    );
    const shortExit = await resolveExitLeg(
      client,
      exchange,
      position.short_symbol,
      'buy',
      position,
      position.short_exit_order_id || null,
      shortEntry.qty
    );

    if (!longExit || longExit.error || longExit.qty <= 0) {
      return { ...baseResult, reason: longExit?.error || 'long exit unresolved' };
    }
    if (!shortExit || shortExit.error || shortExit.qty <= 0) {
      return { ...baseResult, reason: shortExit?.error || 'short exit unresolved' };
    }

    // Qty mismatch warnings
    const longMismatch = Math.abs(longEntry.qty - longExit.qty) / Math.max(longEntry.qty, 1);
    const shortMismatch = Math.abs(shortEntry.qty - shortExit.qty) / Math.max(shortEntry.qty, 1);
    if (longMismatch > 0.02) {
      console.warn(
        `⚠️ ${position.pair_symbol} long qty mismatch: entry ${longEntry.qty.toFixed(6)} vs exit ${longExit.qty.toFixed(6)} (${(longMismatch * 100).toFixed(1)}%)`
      );
    }
    if (shortMismatch > 0.02) {
      console.warn(
        `⚠️ ${position.pair_symbol} short qty mismatch: entry ${shortEntry.qty.toFixed(6)} vs exit ${shortExit.qty.toFixed(6)} (${(shortMismatch * 100).toFixed(1)}%)`
      );
    }

    // Funding
    const longFunding = await fetchFundingForLeg(client, exchange, position.long_symbol, openedAt, closedAt);
    const shortFunding = await fetchFundingForLeg(client, exchange, position.short_symbol, openedAt, closedAt);
    const funding = Number((longFunding + shortFunding).toFixed(4));

    // Actual matched quantity per leg (use smaller side to avoid overcounting partial fills).
    const longMatchedQty = Math.min(longEntry.qty, longExit.qty);
    const shortMatchedQty = Math.min(shortEntry.qty, shortExit.qty);

    const longGross = (longExit.avgPrice - longEntry.avgPrice) * longMatchedQty;
    const shortGross = (shortEntry.avgPrice - shortExit.avgPrice) * shortMatchedQty;
    const gross = Number((longGross + shortGross).toFixed(4));

    const entryFees = Number((longEntry.feesUsd + shortEntry.feesUsd).toFixed(4));
    const exitFees = Number((longExit.feesUsd + shortExit.feesUsd).toFixed(4));
    const newNet = Number((gross - entryFees - exitFees - funding).toFixed(4));
    const pnlPct = Number(((newNet / position.allocated_margin_usd) * 100).toFixed(2));
    const delta = Number((newNet - baseResult.oldRealized).toFixed(4));

    if (applyMode) {
      const { error } = await supabase
        .from('bot_positions')
        .update({
          long_entry_price: longEntry.avgPrice,
          short_entry_price: shortEntry.avgPrice,
          long_exit_price: longExit.avgPrice,
          short_exit_price: shortExit.avgPrice,
          long_qty: longMatchedQty,
          short_qty: shortMatchedQty,
          entry_ratio: longEntry.avgPrice / shortEntry.avgPrice,
          exit_ratio: longExit.avgPrice / shortExit.avgPrice,
          gross_pnl_usd: gross,
          entry_fees_usd: entryFees,
          exit_fees_usd: exitFees,
          funding_fees_usd: funding,
          realized_pnl_usd: newNet,
          pnl_pct: pnlPct,
          execution_mode: position.execution_mode || 'market',
        })
        .eq('id', position.id);
      if (error) {
        return { ...baseResult, reason: `DB update failed: ${error.message}` };
      }
    }

    return {
      ...baseResult,
      gross,
      entryFees,
      exitFees,
      funding,
      newNet,
      delta,
      status: 'OK',
      reason: '',
    };
  } catch (err: any) {
    return { ...baseResult, reason: err.message || 'unknown error' };
  }
}

async function main() {
  console.log(`🔧 Backfill fee mode: ${applyMode ? 'APPLY' : 'DRY RUN'}`);
  if (sinceArg) console.log(`📅 Since filter: ${sinceArg}`);
  if (positionArg) console.log(`🆔 Position filter: ${positionArg}`);

  const groups = await loadPositions();
  if (groups.length === 0) {
    console.log('No closed live positions found.');
    process.exit(0);
  }

  const results: PositionResult[] = [];
  for (const group of groups) {
    console.log(`\n🏦 Account ${group.account.account_name} (${group.account.exchange}) — ${group.positions.length} position(s)`);
    let client: any;
    try {
      client = createExchangeInstance(group.account);
      await client.loadMarkets();
    } catch (err: any) {
      console.error(`❌ Failed to create exchange client for ${group.account.account_name}: ${err.message}`);
      for (const pos of group.positions) {
        results.push({
          id: pos.id,
          pair: pos.pair_symbol,
          openedAt: pos.opened_at,
          closedAt: pos.closed_at,
          oldRealized: Number(pos.realized_pnl_usd || 0),
          gross: 0,
          entryFees: 0,
          exitFees: 0,
          funding: 0,
          newNet: 0,
          delta: 0,
          status: 'UNRESOLVED',
          reason: `exchange client failed: ${err.message}`,
        });
      }
      continue;
    }

    for (const position of group.positions) {
      const result = await processPosition(client, group.account, position);
      results.push(result);
      await sleep(SLEEP_MS);
    }
  }

  // Print results table
  const tableRows = results.map((r) => ({
    id: r.id,
    pair: r.pair,
    opened: r.openedAt.slice(0, 10),
    closed: r.closedAt ? r.closedAt.slice(0, 10) : '',
    oldRealized: r.oldRealized.toFixed(2),
    gross: r.gross.toFixed(2),
    entryFees: r.entryFees.toFixed(4),
    exitFees: r.exitFees.toFixed(4),
    funding: r.funding.toFixed(4),
    newNet: r.newNet.toFixed(2),
    delta: r.delta.toFixed(2),
    status: r.status,
  }));
  console.log('\n📋 Per-position results:');
  console.table(tableRows);

  const unresolved = results.filter((r) => r.status === 'UNRESOLVED');
  if (unresolved.length > 0) {
    console.log('\n⚠️ Unresolved positions:');
    for (const r of unresolved) {
      console.log(`  ${r.id} ${r.pair}: ${r.reason}`);
    }
  }

  const okResults = results.filter((r) => r.status === 'OK');
  const sumOld = okResults.reduce((sum, r) => sum + r.oldRealized, 0);
  const sumNew = okResults.reduce((sum, r) => sum + r.newNet, 0);
  const sumGross = okResults.reduce((sum, r) => sum + r.gross, 0);
  const sumEntryFees = okResults.reduce((sum, r) => sum + r.entryFees, 0);
  const sumExitFees = okResults.reduce((sum, r) => sum + r.exitFees, 0);
  const sumFunding = okResults.reduce((sum, r) => sum + r.funding, 0);
  const sumDelta = okResults.reduce((sum, r) => sum + r.delta, 0);

  console.log('\n📊 Summary (resolved positions only):');
  console.log(`  Positions processed: ${results.length}`);
  console.log(`  Resolved: ${okResults.length}`);
  console.log(`  Unresolved: ${unresolved.length}`);
  console.log(`  Sum old realized_pnl_usd:  $${sumOld.toFixed(2)}`);
  console.log(`  Sum gross PnL:             $${sumGross.toFixed(2)}`);
  console.log(`  Sum entry fees:            $${sumEntryFees.toFixed(4)}`);
  console.log(`  Sum exit fees:             $${sumExitFees.toFixed(4)}`);
  console.log(`  Sum funding:               $${sumFunding.toFixed(4)}`);
  console.log(`  Sum new net PnL:           $${sumNew.toFixed(2)}`);
  console.log(`  Delta vs old:              $${sumDelta.toFixed(2)}`);

  if (!applyMode) {
    console.log('\n📝 Dry run complete. Add --apply to write updates.');
  } else {
    console.log('\n✅ Applied updates to resolved positions.');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
