/**
 * One-shot: refresh pair_market_data for the active strategy_pairs basket.
 * Usage: npx tsx src/scripts/refresh-market-data-once.ts
 */
import ccxt from 'ccxt';
import { supabase } from '../config.js';

const FOUR_H_MS = 4 * 60 * 60 * 1000;
const EMA_SPAN = 10;
const EMA_CANDLES = 60;

function emaLast(values: number[], span: number) {
  if (values.length === 0) return NaN;
  const alpha = 2 / (span + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) ema = alpha * values[i] + (1 - alpha) * ema;
  return ema;
}

async function main() {
  const { data: basket, error } = await supabase
    .from('strategy_pairs')
    .select('pair_symbol, long_coin, short_coin')
    .eq('is_active', true);

  if (error) throw new Error(error.message);
  if (!basket?.length) {
    console.log('No active pairs');
    return;
  }

  const client = new ccxt.binanceusdm({ enableRateLimit: true, options: { defaultType: 'future' } });
  await client.loadMarkets();

  for (const pair of basket) {
    const longSym = `${pair.long_coin}/USDT`;
    const shortSym = `${pair.short_coin}/USDT`;

    const [longTicker, shortTicker, longKlines, shortKlines] = await Promise.all([
      client.fetchTicker(longSym),
      client.fetchTicker(shortSym),
      client.fetchOHLCV(longSym, '4h', undefined, EMA_CANDLES),
      client.fetchOHLCV(shortSym, '4h', undefined, EMA_CANDLES),
    ]);

    const longPrice = Number(longTicker.last || longTicker.close || 0);
    const shortPrice = Number(shortTicker.last || shortTicker.close || 0);
    const currentRatio = shortPrice > 0 ? longPrice / shortPrice : 0;

    const now = Date.now();
    const longClosed = (longKlines as number[][]).filter((k) => k[0] + FOUR_H_MS <= now);
    const shortClosed = (shortKlines as number[][]).filter((k) => k[0] + FOUR_H_MS <= now);
    const n = Math.min(longClosed.length, shortClosed.length);
    const ratios: number[] = [];
    for (let i = 0; i < n; i++) {
      const s = shortClosed[i][4];
      if (s > 0) ratios.push(longClosed[i][4] / s);
    }
    const ema10 = emaLast(ratios.slice(-EMA_CANDLES), EMA_SPAN);
    const isInTrend = Number.isFinite(ema10) && currentRatio > ema10;
    const gapPct = ema10 > 0 ? ((currentRatio - ema10) / ema10) * 100 : 0;
    let readinessPct = 0;
    if (isInTrend) {
      readinessPct = 100;
    } else if (ema10 > 0 && currentRatio > 0) {
      readinessPct = Math.max(0, Math.min(99, Math.round(100 + (gapPct / 3.0) * 100)));
    }

    const row = {
      pair_symbol: pair.pair_symbol,
      long_coin: pair.long_coin,
      short_coin: pair.short_coin,
      current_ratio: Number(currentRatio.toFixed(8)),
      ema_10: Number((Number.isFinite(ema10) ? ema10 : 0).toFixed(8)),
      is_in_trend: Boolean(isInTrend),
      readiness_pct: readinessPct,
      long_price: Number(longPrice.toFixed(8)),
      short_price: Number(shortPrice.toFixed(8)),
      updated_at: new Date().toISOString(),
    };

    const { error: upsertError } = await supabase
      .from('pair_market_data')
      .upsert(row, { onConflict: 'pair_symbol' });
    if (upsertError) throw new Error(`${pair.pair_symbol}: ${upsertError.message}`);

    console.log(
      `${pair.pair_symbol}: ratio=${row.current_ratio} ema=${row.ema_10} trend=${row.is_in_trend} L=${row.long_price} S=${row.short_price}`
    );
  }

  console.log('✅ pair_market_data refreshed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
