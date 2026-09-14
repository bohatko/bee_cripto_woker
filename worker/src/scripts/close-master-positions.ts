/**
 * Force-close open MASTER paper pair positions (admin_close).
 * Usage:
 *   npx tsx src/scripts/close-master-positions.ts
 *   npx tsx src/scripts/close-master-positions.ts --apply
 *   npx tsx src/scripts/close-master-positions.ts --apply --ids=uuid1,uuid2
 */
import dotenv from 'dotenv';
import ccxt from 'ccxt';

dotenv.config();

import { supabase, CONFIG } from '../config.js';
import { OrderRouter } from '../engine/order-router.js';
import type { BotPosition } from '../types/index.js';

const applyMode = process.argv.includes('--apply');
const idsArg = process.argv.find((a) => a.startsWith('--ids='))?.split('=')[1];
const forceIds = idsArg
  ? new Set(idsArg.split(',').map((s) => s.trim()).filter(Boolean))
  : null;

async function fetchMarkPrice(client: any, symbol: string): Promise<number> {
  const ticker = await client.fetchTicker(symbol);
  const mark = Number(ticker?.info?.markPrice ?? ticker?.last ?? ticker?.close ?? 0);
  if (!Number.isFinite(mark) || mark <= 0) {
    throw new Error(`Invalid mark price for ${symbol}`);
  }
  return mark;
}

async function main() {
  let query = supabase
    .from('bot_positions')
    .select('*')
    .eq('status', 'open')
    .eq('is_master', true)
    .order('opened_at', { ascending: true });

  if (forceIds && forceIds.size > 0) {
    query = query.in('id', Array.from(forceIds));
  }

  const { data, error } = await query;
  if (error) throw error;

  const positions = (data || []) as BotPosition[];
  if (positions.length === 0) {
    console.log('No open master positions found.');
    return;
  }

  console.log(`Found ${positions.length} open master position(s). Mode: ${applyMode ? 'APPLY' : 'DRY-RUN'}`);

  const client = new (ccxt as any).binanceusdm({ enableRateLimit: true });
  await client.loadMarkets();

  const router = new OrderRouter();

  for (const pos of positions) {
    const longPx = await fetchMarkPrice(client, pos.long_symbol);
    const shortPx = await fetchMarkPrice(client, pos.short_symbol);
    const exitRatio = longPx / shortPx;

    console.log(
      `• ${pos.pair_symbol} (${pos.id.slice(0, 8)}) ` +
        `long=${longPx} short=${shortPx} ratio=${exitRatio.toFixed(6)} ` +
        `uPnL=$${Number(pos.unrealized_pnl_usd || 0).toFixed(2)}`
    );

    if (!applyMode) continue;

    await router.executeMasterExit(pos, 'admin_close', longPx, shortPx);
  }

  if (!applyMode) {
    console.log('\nDry-run only. Re-run with --apply to close.');
  } else {
    console.log('\nDone. Master positions closed with exit_reason=admin_close.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
