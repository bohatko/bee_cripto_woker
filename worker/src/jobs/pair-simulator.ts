import { atr, ema, OhlcBar } from '../engine/stats.js';

export interface RatioBar extends OhlcBar {}

export interface SimParams {
  leverage: number;
  emaSpan: number;
  slAtrMult: number;
  slMaxMarginPct: number;
  tpDisabled: boolean;
  takeProfitPct: number;
  stopLossPct?: number;
  trailingActive?: boolean;
  trailingActivationPct?: number;
  trailingDeltaPct?: number;
  minHoldBarsBeforeTrendExit?: number;
  takerFeePct: number;
  simSlippagePct: number;
  fundingLong8h: number;
  fundingShort8h: number;
}

export interface SimResult {
  netPnlPct: number;
  trades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  slShare: number;
  avgHoldBars: number;
  equityCurve: number[];
}

interface TradeStats {
  netPnlPct: number;
  bars: number;
  sl: boolean;
}

export function simulatePairEngine(ratioBars: RatioBar[], params: SimParams): SimResult {
  if (ratioBars.length < 40) {
    return emptyResult();
  }

  const closes = ratioBars.map((b) => b.close);
  const emaSeries = ema(closes, params.emaSpan);
  const atrSeries = atr(ratioBars, 14);

  const roundTripFeePct = params.takerFeePct * 4 * params.leverage;
  const roundTripSlippagePct = params.simSlippagePct * 4 * params.leverage;
  const fundingDiffPct8h = (params.fundingLong8h - params.fundingShort8h) * 100 * params.leverage;

  let inPosition = false;
  let entryRatio = 0;
  let entryIndex = -1;
  let peakGrossPnlPct = 0;
  let fundingCarry = 0;
  let blockEntryUntil = -1;
  let equity = 0;
  const equityRaw: number[] = [0];
  const trades: TradeStats[] = [];

  const trailingActive = params.trailingActive ?? true;
  const trailingActivationPct = params.trailingActivationPct ?? 2.0;
  const trailingDeltaPct = params.trailingDeltaPct ?? 0.8;
  const defaultSlPct = params.stopLossPct ?? 2.5;
  const minHoldBarsBeforeTrendExit = params.minHoldBarsBeforeTrendExit ?? 3;

  for (let i = 15; i < ratioBars.length; i++) {
    const close = closes[i];
    const emaNow = emaSeries[i];
    if (!Number.isFinite(close) || !Number.isFinite(emaNow) || close <= 0) continue;

    if (inPosition) {
      if ((i - entryIndex) % 2 === 0) {
        fundingCarry += fundingDiffPct8h;
      }

      const grossPnlPct = params.leverage * ((close / entryRatio) - 1) * 100;
      const highPnlPct = params.leverage * ((ratioBars[i].high / entryRatio) - 1) * 100;
      const lowPnlPct = params.leverage * ((ratioBars[i].low / entryRatio) - 1) * 100;

      if (highPnlPct > peakGrossPnlPct) {
        peakGrossPnlPct = highPnlPct;
      }

      const atrPct = close > 0 ? (atrSeries[i] / close) * 100 : 0;
      const atrSlMarginPct = params.slAtrMult > 0 ? params.slAtrMult * atrPct * params.leverage : 0;
      let slThresholdPct = Math.max(defaultSlPct, atrSlMarginPct);
      slThresholdPct = Math.min(params.slMaxMarginPct, Math.max(0, slThresholdPct));

      const holdBars = Math.max(1, i - entryIndex);

      let reason: 'sl' | 'tp' | 'trailing' | 'trend' | null = null;
      let exitPnlPct = grossPnlPct;

      if (slThresholdPct > 0 && grossPnlPct <= -slThresholdPct) {
        reason = 'sl';
        exitPnlPct = grossPnlPct;
      } else if (!params.tpDisabled && grossPnlPct >= params.takeProfitPct) {
        reason = 'tp';
        exitPnlPct = grossPnlPct;
      } else if (
        !params.tpDisabled &&
        trailingActive &&
        peakGrossPnlPct >= trailingActivationPct &&
        grossPnlPct <= (peakGrossPnlPct - trailingDeltaPct)
      ) {
        reason = 'trailing';
        exitPnlPct = grossPnlPct;
      } else if (close < emaNow && holdBars >= minHoldBarsBeforeTrendExit) {
        reason = 'trend';
        exitPnlPct = grossPnlPct;
      }

      if (reason) {
        const netPnlPct = exitPnlPct - roundTripFeePct - roundTripSlippagePct - fundingCarry;
        equity += netPnlPct;
        trades.push({
          netPnlPct,
          bars: holdBars,
          sl: reason === 'sl',
        });
        inPosition = false;
        blockEntryUntil = i + 1;
        fundingCarry = 0;
        peakGrossPnlPct = 0;
      }
    }

    // Clean breakout entry: ratio crosses above EMA10, or is comfortably above EMA10
    const prevClose = i > 0 ? closes[i - 1] : close;
    const prevEma = i > 0 ? emaSeries[i - 1] : emaNow;
    const isCrossover = prevClose <= prevEma && close > emaNow;
    const isConfirmedTrend = close > emaNow * 1.002;

    if (!inPosition && i >= blockEntryUntil && (isCrossover || isConfirmedTrend)) {
      inPosition = true;
      entryRatio = close;
      entryIndex = i;
      peakGrossPnlPct = 0;
      fundingCarry = 0;
    }

    let mtm = equity;
    if (inPosition) {
      mtm += params.leverage * ((close / entryRatio) - 1) * 100 - fundingCarry;
    }
    equityRaw.push(mtm);
  }

  if (inPosition) {
    const lastClose = closes[closes.length - 1];
    const grossPnlPct = params.leverage * ((lastClose / entryRatio) - 1) * 100;
    const netPnlPct = grossPnlPct - roundTripFeePct - roundTripSlippagePct - fundingCarry;
    equity += netPnlPct;
    trades.push({
      netPnlPct,
      bars: Math.max(1, ratioBars.length - 1 - entryIndex),
      sl: false,
    });
    equityRaw[equityRaw.length - 1] = equity;
  }

  const wins = trades.filter((t) => t.netPnlPct > 0);
  const losses = trades.filter((t) => t.netPnlPct < 0);
  const grossProfit = wins.reduce((acc, t) => acc + t.netPnlPct, 0);
  const grossLossAbs = Math.abs(losses.reduce((acc, t) => acc + t.netPnlPct, 0));
  const profitFactor = grossLossAbs > 0 ? grossProfit / grossLossAbs : grossProfit > 0 ? 99 : 0;

  let peak = Number.NEGATIVE_INFINITY;
  let maxDd = 0;
  for (const point of equityRaw) {
    if (point > peak) peak = point;
    maxDd = Math.max(maxDd, peak - point);
  }

  return {
    netPnlPct: Number(equity.toFixed(4)),
    trades: trades.length,
    winRate: trades.length > 0 ? Number(((wins.length / trades.length) * 100).toFixed(2)) : 0,
    profitFactor: Number(profitFactor.toFixed(4)),
    maxDrawdownPct: Number(maxDd.toFixed(4)),
    slShare: trades.length > 0 ? Number((trades.filter((t) => t.sl).length / trades.length).toFixed(4)) : 0,
    avgHoldBars:
      trades.length > 0 ? Number((trades.reduce((acc, t) => acc + t.bars, 0) / trades.length).toFixed(2)) : 0,
    equityCurve: downsample(equityRaw, 60),
  };
}

function emptyResult(): SimResult {
  return {
    netPnlPct: 0,
    trades: 0,
    winRate: 0,
    profitFactor: 0,
    maxDrawdownPct: 0,
    slShare: 0,
    avgHoldBars: 0,
    equityCurve: [],
  };
}

function downsample(values: number[], maxPoints: number): number[] {
  if (values.length <= maxPoints) return values.map((v) => Number(v.toFixed(4)));
  const out: number[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.floor((i * (values.length - 1)) / (maxPoints - 1));
    out.push(Number(values[idx].toFixed(4)));
  }
  return out;
}
