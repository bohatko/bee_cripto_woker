/**
 * Mark DB-open positions as closed when exchange position size is already zero
 * (manual close / liquidated / race). Usage:
 *   npx tsx src/scripts/reconcile-flat-positions.ts          # dry-run
 *   npx tsx src/scripts/reconcile-flat-positions.ts --apply
 */
import dotenv from 'dotenv';

dotenv.config();

import { supabase, CONFIG } from '../config.js';
import { createExchangeInstance } from '../exchanges/exchange-factory.js';
import { computePositionExit, ensureMarketsLoaded, fetchFundingFeesUsd } from '../engine/execution.js';
import type { BotPosition, ExchangeAccount } from '../types/index.js';

const applyMode = process.argv.includes('--apply');
const idsArg = process.argv.find((a) => a.startsWith('--ids='))?.split('=')[1];
const forceIds = idsArg ? new Set(idsArg.split(',').map((s) => s.trim()).filter(Boolean)) : null;

function isZeroPositionError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('current position is zero') ||
    m.includes('position is zero') ||
    m.includes('retcode":110017') ||
    m.includes('retcode": 110017') ||
    m.includes('110017')
  );
}

function positionSize(pos: any): number {
  const contracts = Number(pos?.contracts ?? pos?.contractSize ?? 0);
  if (Number.isFinite(contracts) && contracts !== 0) return Math.abs(contracts);
  const amount = Number(pos?.amount ?? pos?.info?.size ?? 0);
  return Number.isFinite(amount) ? Math.abs(amount) : 0;
}

async function fetchMarkPrices(
  client: any,
  longSymbol: string,
  shortSymbol: string
): Promise<{ longPrice: number; shortPrice: number }> {
  const tickers = await client.fetchTickers([longSymbol, shortSymbol]);
  const longPrice = Number(tickers[longSymbol]?.last || tickers[longSymbol]?.close || 0);
  const shortPrice = Number(tickers[shortSymbol]?.last || tickers[shortSymbol]?.close || 0);
  if (!(longPrice > 0) || !(shortPrice > 0)) {
    throw new Error(`Failed to fetch mark prices for ${longSymbol} / ${shortSymbol}`);
  }
  return { longPrice, shortPrice };
}

async function isFlatOnExchange(
  client: any,
  account: ExchangeAccount,
  position: BotPosition
): Promise<boolean> {
  if (!client.fetchPositions) {
    throw new Error(`Exchange ${account.exchange} has no fetchPositions`);
  }
  const params = account.exchange === 'bybit' ? { category: 'linear' } : {};
  const rows = await client.fetchPositions([position.long_symbol, position.short_symbol], params);
  const long = (rows || []).find((p: any) => p.symbol === position.long_symbol);
  const short = (rows || []).find((p: any) => p.symbol === position.short_symbol);
  const longSize = positionSize(long);
  const shortSize = positionSize(short);
  console.log(
    `   exchange sizes: ${position.long_symbol}=${longSize}, ${position.short_symbol}=${shortSize}`
  );
  return longSize < 1e-8 && shortSize < 1e-8;
}

async function markClosed(
  position: BotPosition,
  account: ExchangeAccount,
  client: any,
  longExitPrice: number,
  shortExitPrice: number
): Promise<void> {
  let fundingFeesUsd = 0;
  try {
    fundingFeesUsd = await fetchFundingFeesUsd(client, account, position);
  } catch (err: any) {
    console.warn(`   funding fetch skipped: ${err.message}`);
  }

  // Manual/external close: no exit order fees available from our side.
  const exitFeesUsd = 0;
  const { grossPnlUsd, netPnlUsd, pnlPct, exitRatio } = computePositionExit(
    position,
    longExitPrice,
    shortExitPrice,
    position.entry_fees_usd || 0,
    exitFeesUsd,
    fundingFeesUsd
  );

  const payload = {
    status: 'closed' as const,
    exit_ratio: Number(exitRatio.toFixed(8)),
    long_exit_price: longExitPrice,
    short_exit_price: shortExitPrice,
    long_exit_order_id: null,
    short_exit_order_id: null,
    gross_pnl_usd: grossPnlUsd,
    exit_fees_usd: exitFeesUsd,
    funding_fees_usd: fundingFeesUsd,
    realized_pnl_usd: netPnlUsd,
    unrealized_pnl_usd: 0,
    pnl_pct: pnlPct,
    exit_reason: 'panic_close' as const,
    closed_at: new Date().toISOString(),
  };

  console.log(
    `   -> close ${position.pair_symbol}: net $${netPnlUsd.toFixed(2)} (${pnlPct}%) reason=panic_close`
  );

  if (!applyMode) {
    console.log('   (dry-run) skipped DB update');
    return;
  }

  const { error } = await supabase.from('bot_positions').update(payload).eq('id', position.id);
  if (error) {
    throw new Error(`DB update failed for ${position.id}: ${error.message}`);
  }
  console.log(`   ✅ marked closed in DB`);
}

async function main() {
  console.log(`Reconcile flat positions (${applyMode ? 'APPLY' : 'DRY-RUN'})`);
  console.log(`Supabase: ${CONFIG.supabaseUrl}`);

  let query = supabase
    .from('bot_positions')
    .select('*, exchange_accounts(*)')
    .eq('status', 'open')
    .eq('is_master', false)
    .order('opened_at', { ascending: false });

  if (forceIds && forceIds.size > 0) {
    query = query.in('id', [...forceIds]);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data || []) as Array<BotPosition & { exchange_accounts: ExchangeAccount }>;
  console.log(`Open non-master positions: ${rows.length}`);

  if (rows.length === 0) {
    console.log('Nothing to reconcile.');
    return;
  }

  for (const position of rows) {
    const account = position.exchange_accounts;
    if (!account) {
      console.warn(`⚠️ ${position.pair_symbol} (${position.id}) has no exchange_accounts join`);
      continue;
    }

    console.log(`\n📌 ${position.pair_symbol} id=${position.id} margin=$${position.allocated_margin_usd}`);

    try {
      const client = createExchangeInstance(account);
      await ensureMarketsLoaded(client as any, account.id);

      const flat =
        forceIds?.has(position.id) ||
        (await isFlatOnExchange(client, account, position));

      if (!flat) {
        console.log('   still open on exchange — skip');
        continue;
      }

      const { longPrice, shortPrice } = await fetchMarkPrices(
        client,
        position.long_symbol,
        position.short_symbol
      );
      await markClosed(position, account, client, longPrice, shortPrice);
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (isZeroPositionError(msg) || forceIds?.has(position.id)) {
        console.warn(`   treating as flat due to: ${msg}`);
        try {
          const client = createExchangeInstance(account);
          await ensureMarketsLoaded(client as any, account.id);
          const { longPrice, shortPrice } = await fetchMarkPrices(
            client,
            position.long_symbol,
            position.short_symbol
          );
          await markClosed(position, account, client, longPrice, shortPrice);
        } catch (inner: any) {
          console.error(`   ❌ failed: ${inner.message}`);
        }
      } else {
        console.error(`   ❌ ${msg}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
