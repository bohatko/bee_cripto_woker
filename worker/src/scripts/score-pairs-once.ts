/**
 * Score specific basket pairs with the same momentum metrics as PairSelectionJob.
 * Usage: npx tsx src/scripts/score-pairs-once.ts
 */
import ccxt from 'ccxt';
import { CONFIG } from '../config.js';

const PAIRS = [
  { pair: 'ENA/SUI', long: 'ENA', short: 'SUI' },
  { pair: 'SOL/ADA', long: 'SOL', short: 'ADA' },
  { pair: 'BNB/ETH', long: 'BNB', short: 'ETH' },
  { pair: 'ZEC/AVAX', long: 'ZEC', short: 'AVAX' },
];

const FOUR_H_MS = 4 * 60 * 60 * 1000;
const BARS_REQUIRED = 540;
const EMA_SPAN = 10;
const MIN_DRIFT_TSTAT = 2.0;
const MIN_LEG_CORRELATION = 0.5;
const MAX_BETA_DIFF = 0.15;
const MAX_FUNDING_COST_PCT_8H = 0.05;
const FUNDING_PENALTY_PER_THRESHOLD = 1.0;

function mean(xs: number[]) {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function std(xs: number[], mu: number) {
  if (xs.length < 2) return 0;
  const v = xs.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (xs.length - 1);
  return Math.sqrt(v);
}
function correlation(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a);
  const mb = mean(b);
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) * (a[i] - ma);
    vb += (b[i] - mb) * (b[i] - mb);
  }
  if (va <= 0 || vb <= 0) return 0;
  return cov / Math.sqrt(va * vb);
}
function emaLast(values: number[], span: number) {
  if (values.length === 0) return NaN;
  const alpha = 2 / (span + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) ema = alpha * values[i] + (1 - alpha) * ema;
  return ema;
}

async function fetch4h(client: any, symbol: string) {
  const since = Date.now() - (BARS_REQUIRED + 40) * FOUR_H_MS;
  const page1 = await client.fetchOHLCV(symbol, '4h', since, 500);
  const page2 = await client.fetchOHLCV(symbol, '4h', since + 500 * FOUR_H_MS, 500);
  const all = [...page1, ...page2]
    .filter((k: number[]) => k[0] + FOUR_H_MS <= Date.now())
    .sort((a: number[], b: number[]) => a[0] - b[0]);
  const byTs = new Map<number, number>();
  for (const k of all) byTs.set(k[0], k[4]);
  const times = [...byTs.keys()].sort((a, b) => a - b);
  const closesByTs = new Map<number, number>();
  const retsByTs = new Map<number, number>();
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    closesByTs.set(t, byTs.get(t)!);
    if (i > 0) {
      const prev = byTs.get(times[i - 1])!;
      const cur = byTs.get(t)!;
      if (prev > 0 && cur > 0) retsByTs.set(t, Math.log(cur / prev));
    }
  }
  return { closesByTs, retsByTs };
}

function betaVs(retsA: Map<number, number>, retsBtc: Map<number, number>) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [t, r] of retsA) {
    const b = retsBtc.get(t);
    if (b === undefined) continue;
    xs.push(b);
    ys.push(r);
  }
  if (xs.length < 50) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0;
  let vx = 0;
  for (let i = 0; i < xs.length; i++) {
    cov += (xs[i] - mx) * (ys[i] - my);
    vx += (xs[i] - mx) * (xs[i] - mx);
  }
  return vx <= 0 ? NaN : cov / vx;
}

async function main() {
  const binance = new ccxt.binanceusdm({ enableRateLimit: true, options: { defaultType: 'future' } });
  await binance.loadMarkets();

  const coins = new Set<string>(['BTC']);
  for (const p of PAIRS) {
    coins.add(p.long);
    coins.add(p.short);
  }

  const fundingBySymbol = new Map<string, number>();
  try {
    const frs: any = await binance.fetchFundingRates();
    for (const key of Object.keys(frs)) {
      if (typeof frs[key]?.fundingRate === 'number') fundingBySymbol.set(key, frs[key].fundingRate);
    }
  } catch {
    console.warn('funding fetch failed');
  }

  const series = new Map<string, Awaited<ReturnType<typeof fetch4h>>>();
  for (const coin of coins) {
    const sym = `${coin}/USDT`;
    series.set(coin, await fetch4h(binance, sym));
    console.log(`loaded ${sym}: ${series.get(coin)!.closesByTs.size} bars`);
  }

  const btc = series.get('BTC')!;
  const tickers = await binance.fetchTickers();

  console.log('\n=== Current momentum scores ===');
  for (const p of PAIRS) {
    const a = series.get(p.long)!;
    const b = series.get(p.short)!;
    const times: number[] = [];
    for (const t of a.retsByTs.keys()) {
      if (b.retsByTs.has(t)) times.push(t);
    }
    times.sort((x, y) => x - y);
    const window = times.slice(-BARS_REQUIRED);
    const ratioRets = window.map((t) => a.retsByTs.get(t)! - b.retsByTs.get(t)!);
    const mu = mean(ratioRets);
    const sd = std(ratioRets, mu);
    const tStat = sd > 0 ? mu / (sd / Math.sqrt(ratioRets.length)) : 0;
    const mid = Math.floor(ratioRets.length / 2);
    const drift1 = mean(ratioRets.slice(0, mid));
    const drift2 = mean(ratioRets.slice(mid));
    const aRets = window.map((t) => a.retsByTs.get(t)!);
    const bRets = window.map((t) => b.retsByTs.get(t)!);
    const corr = correlation(aRets, bRets);
    const betaA = betaVs(a.retsByTs, btc.retsByTs);
    const betaB = betaVs(b.retsByTs, btc.retsByTs);
    const betaDiff = Math.abs(betaA - betaB);
    const fundA = fundingBySymbol.get(`${p.long}/USDT`) ?? 0;
    const fundB = fundingBySymbol.get(`${p.short}/USDT`) ?? 0;
    // pay long funding, receive short funding → cost = fundA - fundB
    const fundingCostPct8h = (fundA - fundB) * 100;
    const fundingPenalty =
      fundingCostPct8h > 0
        ? (fundingCostPct8h / MAX_FUNDING_COST_PCT_8H) * FUNDING_PENALTY_PER_THRESHOLD
        : 0;
    const score = tStat - fundingPenalty;

    const closeTimes = [...a.closesByTs.keys()].filter((t) => b.closesByTs.has(t)).sort((x, y) => x - y);
    const ratios = closeTimes.map((t) => a.closesByTs.get(t)! / b.closesByTs.get(t)!);
    const ema = emaLast(ratios.slice(-60), EMA_SPAN);
    const lastRatio = ratios[ratios.length - 1];
    const inTrend = lastRatio > ema;

    const volA = Number((tickers[`${p.long}/USDT:USDT`] || tickers[`${p.long}/USDT`])?.quoteVolume || 0);
    const volB = Number((tickers[`${p.short}/USDT:USDT`] || tickers[`${p.short}/USDT`])?.quoteVolume || 0);

    const rejects: string[] = [];
    if (tStat <= MIN_DRIFT_TSTAT) rejects.push('t_stat');
    if (!(drift1 > 0 && drift2 > 0)) rejects.push('stability');
    if (corr < MIN_LEG_CORRELATION) rejects.push('correlation');
    if (betaDiff > MAX_BETA_DIFF) rejects.push('beta');
    if (volA < CONFIG.minLegVolumeUsd || volB < CONFIG.minLegVolumeUsd) rejects.push('volume');
    if (fundingCostPct8h > MAX_FUNDING_COST_PCT_8H) rejects.push('funding');
    if (!inTrend) rejects.push('not_in_trend');

    console.log(
      JSON.stringify(
        {
          pair: p.pair,
          score: Number(score.toFixed(4)),
          t_stat: Number(tStat.toFixed(4)),
          corr: Number(corr.toFixed(4)),
          beta_diff: Number(betaDiff.toFixed(4)),
          in_trend: inTrend,
          funding_cost_pct_8h: Number(fundingCostPct8h.toFixed(5)),
          drift_halves: [Number(drift1.toFixed(6)), Number(drift2.toFixed(6))],
          valid: rejects.length === 0,
          reject_reasons: rejects,
        },
        null,
        0
      )
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
