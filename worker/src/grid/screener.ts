import { roundPx } from './prices.js';

const OKX_BASE = 'https://www.okx.com';
const TARGET_STEP = 0.006;
const LOOKBACK = 14;

export interface GridCandidate {
  baseAsset: string;
  lowerPrice: number;
  upperPrice: number;
  gridCount: number;
  leverage: number;
  stopPrice: number;
  takeProfitPrice: number;
  spacing: 'geometric';
  direction: 'neutral';
  score: number;
  metrics: {
    lastPrice: number;
    netReturnPct: number;
    efficiency: number;
    rangePos: number;
    avgDailyRangePct: number;
    widthPct: number;
    quoteVolume: number;
  };
}

interface Candle {
  high: number;
  low: number;
  close: number;
}

async function okxPublic<T>(path: string): Promise<T[]> {
  const response = await fetch(`${OKX_BASE}${path}`);
  if (!response.ok) {
    throw new Error(`OKX public ${path} failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { code?: string; msg?: string; data?: T[] };
  if (body.code !== '0') {
    throw new Error(`OKX public ${path} failed: ${body.msg || body.code}`);
  }
  return body.data || [];
}

function scoreCandles(baseAsset: string, quoteVolume: number, rows: string[][]): GridCandidate | null {
  const closed = rows.filter((row) => String(row[8]) === '1').slice(0, LOOKBACK);
  if (closed.length < LOOKBACK) return null;

  const candles: Candle[] = closed.map((row) => ({
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
  }));
  if (candles.some((c) => !Number.isFinite(c.close) || c.close <= 0)) return null;

  const newest = candles[0].close;
  const oldest = candles[candles.length - 1].close;
  const net = (newest - oldest) / oldest;
  let path = 0;
  for (let i = 0; i < candles.length - 1; i += 1) {
    path += Math.abs(candles[i].close - candles[i + 1].close) / candles[i + 1].close;
  }
  const efficiency = path > 0 ? Math.abs(net) / path : 1;
  const high = Math.max(...candles.map((c) => c.high));
  const low = Math.min(...candles.map((c) => c.low));
  if (!(high > low)) return null;
  const rangePos = (newest - low) / (high - low);
  const width = (high - low) / newest;
  const avgDailyRange =
    candles.reduce((sum, c) => sum + (c.high - c.low) / c.close, 0) / candles.length;

  if (Math.abs(net) > 0.12) return null;
  if (efficiency > 0.35) return null;
  if (rangePos < 0.28 || rangePos > 0.72) return null;
  if (avgDailyRange < 0.015 || avgDailyRange > 0.12) return null;
  if (width < 0.04 || width > 0.28) return null;

  const lowerPrice = roundPx(low * 0.995);
  const upperPrice = roundPx(high * 1.005);
  if (!(upperPrice > lowerPrice)) return null;
  const ratio = upperPrice / lowerPrice;
  let gridCount = Math.round(Math.log(ratio) / Math.log(1 + TARGET_STEP));
  gridCount = Math.max(8, Math.min(30, gridCount));
  const stopPrice = roundPx(lowerPrice * 0.98);
  const takeProfitPrice = roundPx(upperPrice * 1.02);
  const midness = 1 - Math.abs(rangePos - 0.5) * 2;
  const score = (1 - efficiency) * midness * Math.min(avgDailyRange, 0.06) * 100;

  return {
    baseAsset,
    lowerPrice,
    upperPrice,
    gridCount,
    leverage: 2,
    stopPrice,
    takeProfitPrice,
    spacing: 'geometric',
    direction: 'neutral',
    score: Number(score.toFixed(4)),
    metrics: {
      lastPrice: newest,
      netReturnPct: Number((net * 100).toFixed(2)),
      efficiency: Number(efficiency.toFixed(3)),
      rangePos: Number(rangePos.toFixed(3)),
      avgDailyRangePct: Number((avgDailyRange * 100).toFixed(2)),
      widthPct: Number((width * 100).toFixed(2)),
      quoteVolume,
    },
  };
}

export async function scanGridCandidates(): Promise<GridCandidate[]> {
  const tickers = await okxPublic<{ instId: string; volCcyQuote24h?: string; last?: string }>(
    '/api/v5/market/tickers?instType=SWAP'
  );
  const ranked = tickers
    .filter((row) => row.instId.endsWith('-USDT-SWAP'))
    .map((row) => ({
      instId: row.instId,
      base: row.instId.replace('-USDT-SWAP', ''),
      volume: Number(row.volCcyQuote24h || 0),
    }))
    .filter((row) => row.base && row.volume > 5_000_000)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 24);

  const found: GridCandidate[] = [];
  for (const row of ranked) {
    try {
      const candles = await okxPublic<string[]>(
        `/api/v5/market/candles?instId=${row.instId}&bar=1D&limit=21`
      );
      const candidate = scoreCandles(row.base, row.volume, candles);
      if (candidate) found.push(candidate);
    } catch (err: any) {
      console.warn(`[GridScreener] Skip ${row.base}: ${err?.message || err}`);
    }
  }

  found.sort((a, b) => b.score - a.score);
  return found.slice(0, 8);
}
