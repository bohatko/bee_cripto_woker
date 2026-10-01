import type { GridOrderParams } from './okx-grid.js';

/** Coins whose futures grid may only run on Bybit (CL = WTI crude oil perpetual). */
export const BYBIT_ONLY_ASSETS: ReadonlySet<string> = new Set(['CL']);

export function formatPx(price: number): string {
  const abs = Math.abs(price);
  const digits = abs >= 1000 ? 2 : abs >= 100 ? 3 : abs >= 1 ? 4 : abs >= 0.01 ? 5 : 6;
  return price.toFixed(digits);
}

export function roundPx(price: number): number {
  return Number(formatPx(price));
}

/** Share of the half-range around the center in which the price still counts as "centered". */
const CENTER_TOLERANCE = 0.2;

export async function fetchLastPrice(exchange: 'okx' | 'bybit', baseAsset: string): Promise<number> {
  const url =
    exchange === 'okx'
      ? `https://www.okx.com/api/v5/market/ticker?instId=${baseAsset}-USDT-SWAP`
      : `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${baseAsset}USDT`;
  const response = await fetch(url);
  const json = (await response.json().catch(() => ({}))) as any;
  const raw = exchange === 'okx' ? json?.data?.[0]?.last : json?.result?.list?.[0]?.lastPrice;
  const price = Number(raw);
  if (!response.ok || !Number.isFinite(price) || price <= 0) {
    throw new Error(`Could not read the current ${baseAsset}/USDT price from ${exchange.toUpperCase()}`);
  }
  return price;
}

const ATR_DAYS = 14;

/** Mean daily true range (price units) over the last completed daily candles on Bybit. */
export async function fetchDailyAtr(baseAsset: string, days = ATR_DAYS): Promise<number> {
  const url = `https://api.bybit.com/v5/market/kline?category=linear&symbol=${baseAsset}USDT&interval=D&limit=${days + 2}`;
  const response = await fetch(url);
  const json = (await response.json().catch(() => ({}))) as any;
  const rows: string[][] = json?.result?.list;
  if (!response.ok || !Array.isArray(rows) || rows.length < days + 1) {
    throw new Error(`Could not read daily candles for ${baseAsset}USDT from Bybit`);
  }
  // Bybit returns newest first; index 0 is the still-forming candle.
  const closed = rows
    .slice(1, days + 2)
    .reverse()
    .map((r) => ({ high: Number(r[2]), low: Number(r[3]), close: Number(r[4]) }));
  let sum = 0;
  for (let i = 1; i < closed.length; i++) {
    const prevClose = closed[i - 1].close;
    sum += Math.max(closed[i].high, prevClose) - Math.min(closed[i].low, prevClose);
  }
  const atr = sum / (closed.length - 1);
  if (!Number.isFinite(atr) || atr <= 0) throw new Error(`Invalid ATR for ${baseAsset}USDT`);
  return atr;
}

/** Moves the stop to `lowerPrice - multiplier * ATR`; never above the lower bound. */
export function applyAtrStop(params: GridOrderParams, atr: number, multiplier: number): GridOrderParams {
  const stop = params.lowerPrice - multiplier * atr;
  if (!(stop > 0) || stop >= params.lowerPrice) return params;
  return { ...params, stopPrice: stop };
}

export interface CenterResult {
  params: GridOrderParams;
  price: number;
  shifted: boolean;
  factor: number;
}

/**
 * Keeps the template shape (range width, stop and take-profit distances in percent)
 * but moves everything so the range is centered on the live exchange price.
 */
export function centerOnPrice(params: GridOrderParams, price: number): CenterResult {
  const center = (params.lowerPrice + params.upperPrice) / 2;
  const halfWidth = (params.upperPrice - params.lowerPrice) / 2;
  const offCenter = halfWidth > 0 ? Math.abs(price - center) / halfWidth : 1;
  if (offCenter <= CENTER_TOLERANCE) {
    return { params, price, shifted: false, factor: 1 };
  }
  const factor = price / center;
  return {
    price,
    shifted: true,
    factor,
    params: {
      ...params,
      lowerPrice: params.lowerPrice * factor,
      upperPrice: params.upperPrice * factor,
      stopPrice: params.stopPrice * factor,
      takeProfitPrice: params.takeProfitPrice * factor,
    },
  };
}
