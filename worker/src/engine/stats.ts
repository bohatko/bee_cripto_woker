export interface OhlcBar {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, x) => acc + x, 0) / values.length;
}

export function std(values: number[], mu = mean(values)): number {
  if (values.length < 2) return 0;
  const variance = values.reduce((acc, x) => acc + (x - mu) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function ema(values: number[], span: number): number[] {
  if (values.length === 0) return [];
  const alpha = 2 / (span + 1);
  const out = new Array<number>(values.length);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = alpha * values[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

export function atr(bars: OhlcBar[], period = 14): number[] {
  if (bars.length === 0) return [];
  const trs = new Array<number>(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const prevClose = bars[i - 1].close;
    const h = bars[i].high;
    const l = bars[i].low;
    trs[i] = Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));
  }

  const out = new Array<number>(bars.length).fill(0);
  if (bars.length <= period) return out;
  let seed = 0;
  for (let i = 1; i <= period; i++) seed += trs[i];
  let running = seed / period;
  out[period] = running;
  for (let i = period + 1; i < bars.length; i++) {
    running = (running * (period - 1) + trs[i]) / period;
    out[i] = running;
  }
  return out;
}

export function autocorr(values: number[], lag: number): number {
  if (lag <= 0 || values.length <= lag + 2) return 0;
  const n = values.length - lag;
  const x = values.slice(0, n);
  const y = values.slice(lag);
  const mx = mean(x);
  const my = mean(y);
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx <= 0 || vy <= 0) return 0;
  return cov / Math.sqrt(vx * vy);
}

/**
 * Hurst exponent estimator via rescaled range (R/S).
 * Returns 0.5 for random-walk-like inputs when estimation is unstable.
 */
export function hurstRS(values: number[]): number {
  if (values.length < 64) return 0.5;
  const windows = [8, 16, 32, 64, 128].filter((w) => w <= Math.floor(values.length / 2));
  const points: Array<{ x: number; y: number }> = [];

  for (const win of windows) {
    const chunks = Math.floor(values.length / win);
    if (chunks < 2) continue;
    const rsVals: number[] = [];
    for (let c = 0; c < chunks; c++) {
      const slice = values.slice(c * win, (c + 1) * win);
      const m = mean(slice);
      let cumulative = 0;
      let minCum = Number.POSITIVE_INFINITY;
      let maxCum = Number.NEGATIVE_INFINITY;
      for (const v of slice) {
        cumulative += v - m;
        if (cumulative < minCum) minCum = cumulative;
        if (cumulative > maxCum) maxCum = cumulative;
      }
      const range = maxCum - minCum;
      const s = std(slice, m);
      if (range > 0 && s > 0) rsVals.push(range / s);
    }
    if (rsVals.length > 0) {
      points.push({ x: Math.log(win), y: Math.log(mean(rsVals)) });
    }
  }

  if (points.length < 2) return 0.5;
  const mx = mean(points.map((p) => p.x));
  const my = mean(points.map((p) => p.y));
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  if (den <= 0) return 0.5;
  const h = num / den;
  if (!Number.isFinite(h)) return 0.5;
  return Math.max(0, Math.min(1, h));
}
