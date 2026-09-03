import ccxt from 'ccxt';
import { supabase } from '../config.js';
import { STRATEGY_PAIRS, StrategyPairConfig } from '../exchanges/symbols.js';
import { PairMarketData } from '../types/index.js';

export interface MarketSignal {
  pairConfig: StrategyPairConfig;
  currentRatio: number;
  ema10: number;
  longPrice: number;
  shortPrice: number;
  isInTrend: boolean;
}

export type SignalCallback = (signal: MarketSignal) => Promise<void>;

const FOUR_H_MS = 4 * 60 * 60 * 1000;

function isFourHourCandleClosed(candleOpenTs: number, now = Date.now()): boolean {
  return candleOpenTs + FOUR_H_MS <= now;
}

export class MarketScanner {
  private client: any;
  private emaCache: Map<string, number> = new Map();
  private lastClosedRatio: Map<string, number> = new Map();
  private lastClosedOpenTs: Map<string, number> = new Map();
  private lastEmaRefreshAttemptAt = 0;
  private signalCallbacks: SignalCallback[] = [];
  private timer: NodeJS.Timeout | null = null;
  private intervalMs: number;

  constructor(intervalMs: number = 10000) {
    this.intervalMs = intervalMs;
    this.client = new ccxt.binanceusdm({
      enableRateLimit: true,
      options: { defaultType: 'future' },
    });
  }

  public onSignal(callback: SignalCallback) {
    this.signalCallbacks.push(callback);
  }

  public async initEmaHistory() {
    console.log('📊 Initializing 4h EMA10 history for strategy pairs...');
    for (const pair of STRATEGY_PAIRS) {
      try {
        const longSym = `${pair.longCoin}/USDT`;
        const shortSym = `${pair.shortCoin}/USDT`;

        const [longKlines, shortKlines] = await Promise.all([
          this.client.fetchOHLCV(longSym, '4h', undefined, 20),
          this.client.fetchOHLCV(shortSym, '4h', undefined, 20),
        ]);

        const longClosed = longKlines.filter((k: number[]) => isFourHourCandleClosed(k[0]));
        const shortClosed = shortKlines.filter((k: number[]) => isFourHourCandleClosed(k[0]));
        const minLen = Math.min(longClosed.length, shortClosed.length);
        if (minLen < 5) {
          console.warn(`⚠️ Insufficient closed 4h history for ${pair.pairSymbol}, using default ratio`);
          continue;
        }

        const ratios: number[] = [];
        for (let i = 0; i < minLen; i++) {
          const lClose = longClosed[i][4];
          const sClose = shortClosed[i][4];
          if (sClose > 0) ratios.push(lClose / sClose);
        }

        let ema = ratios[0];
        const alpha = 2 / (10 + 1);
        for (let i = 1; i < ratios.length; i++) {
          ema = alpha * ratios[i] + (1 - alpha) * ema;
        }

        const lastClosedOpenTs = Math.min(longClosed[minLen - 1][0], shortClosed[minLen - 1][0]);
        this.emaCache.set(pair.pairSymbol, ema);
        this.lastClosedRatio.set(pair.pairSymbol, ratios[ratios.length - 1]);
        this.lastClosedOpenTs.set(pair.pairSymbol, lastClosedOpenTs);
        console.log(`✅ [${pair.pairSymbol}] Historical EMA10 initialized from closed 4h candles: ${ema.toFixed(6)}`);
      } catch (err: any) {
        console.error(`❌ Failed to init EMA history for ${pair.pairSymbol}:`, err.message);
      }
    }
  }

  public isClosedFourHourBelowEma(pairSymbol: string): boolean {
    const closedRatio = this.lastClosedRatio.get(pairSymbol);
    const ema = this.emaCache.get(pairSymbol);
    if (closedRatio === undefined || ema === undefined) return false;
    return closedRatio < ema;
  }

  private isEmaRefreshDue(now = Date.now()): boolean {
    if (now - this.lastEmaRefreshAttemptAt < 60_000) return false;
    if (this.lastClosedOpenTs.size < STRATEGY_PAIRS.length) return true;
    for (const ts of this.lastClosedOpenTs.values()) {
      if (now >= ts + 2 * FOUR_H_MS - 5_000) return true;
    }
    return false;
  }

  private async refreshClosedEmaIfDue() {
    if (!this.isEmaRefreshDue()) return;
    this.lastEmaRefreshAttemptAt = Date.now();
    await this.initEmaHistory();
  }

  public async scanOnce(): Promise<MarketSignal[]> {
    const signals: MarketSignal[] = [];
    await this.refreshClosedEmaIfDue();

    for (const pair of STRATEGY_PAIRS) {
      try {
        const longSym = `${pair.longCoin}/USDT`;
        const shortSym = `${pair.shortCoin}/USDT`;

        const [longTicker, shortTicker] = await Promise.all([
          this.client.fetchTicker(longSym),
          this.client.fetchTicker(shortSym),
        ]);

        const longPrice = longTicker.last || longTicker.close || 0;
        const shortPrice = shortTicker.last || shortTicker.close || 0;

        if (longPrice <= 0 || shortPrice <= 0) continue;

        const currentRatio = longPrice / shortPrice;
        const ema10 = this.emaCache.get(pair.pairSymbol) ?? currentRatio;
        // Entry requires live Ratio > EMA10 AND last closed 4h candle still above EMA.
        // Without the closed-candle gate, live spikes above EMA while the last closed
        // candle is below would open a trade that the risk guard closes ~seconds later
        // (trend_flip) at the same tick prices → $0 PnL spam in history.
        const closedRatio = this.lastClosedRatio.get(pair.pairSymbol);
        const closedTrendOk = closedRatio === undefined || closedRatio >= ema10;
        const isInTrend = currentRatio > ema10 && closedTrendOk;

        const signal: MarketSignal = {
          pairConfig: pair,
          currentRatio,
          ema10,
          longPrice,
          shortPrice,
          isInTrend,
        };

        signals.push(signal);

        // Update database cache for frontend
        await this.persistMarketData(signal);

        // Notify dispatchers
        for (const cb of this.signalCallbacks) {
          await cb(signal).catch((err) =>
            console.error(`Error in signal callback: ${err.message}`)
          );
        }
      } catch (err: any) {
        console.error(`❌ Error scanning pair ${pair.pairSymbol}:`, err.message);
      }
    }

    return signals;
  }

  private async persistMarketData(signal: MarketSignal) {
    const gapPct = signal.ema10 > 0 ? ((signal.currentRatio - signal.ema10) / signal.ema10) * 100 : 0;
    let readinessPct = 100.0;
    if (!signal.isInTrend) {
      // Benchmark pullback distance: 3.0% below EMA10 = 0% readiness
      const MAX_PULLBACK = 3.0;
      readinessPct = Math.max(0, Math.min(99.0, Number((100 + (gapPct / MAX_PULLBACK) * 100).toFixed(1))));
    }

    const record: Partial<PairMarketData> = {
      pair_symbol: signal.pairConfig.pairSymbol,
      long_coin: signal.pairConfig.longCoin,
      short_coin: signal.pairConfig.shortCoin,
      current_ratio: Number(signal.currentRatio.toFixed(8)),
      ema_10: Number(signal.ema10.toFixed(8)),
      is_in_trend: signal.isInTrend,
      readiness_pct: readinessPct,
      long_price: Number(signal.longPrice.toFixed(8)),
      short_price: Number(signal.shortPrice.toFixed(8)),
      last_signal_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('pair_market_data')
      .upsert(record, { onConflict: 'pair_symbol' });

    if (error) {
      console.error(`❌ DB error updating pair_market_data [${signal.pairConfig.pairSymbol}]:`, error.message);
    }
  }

  public start() {
    if (this.timer) return;
    console.log(`🚀 Starting Market Scanner (poll interval: ${this.intervalMs}ms)...`);
    this.timer = setInterval(() => {
      this.scanOnce().catch((err) => console.error('Scan error:', err));
    }, this.intervalMs);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('🛑 Market Scanner stopped.');
    }
  }
}
