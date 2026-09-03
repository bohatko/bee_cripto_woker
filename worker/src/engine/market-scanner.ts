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

export class MarketScanner {
  private client: any;
  private emaCache: Map<string, number> = new Map();
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

        const minLen = Math.min(longKlines.length, shortKlines.length);
        if (minLen < 5) {
          console.warn(`⚠️ Insufficient kline history for ${pair.pairSymbol}, using default ratio`);
          continue;
        }

        const ratios: number[] = [];
        for (let i = 0; i < minLen; i++) {
          const lClose = longKlines[i][4];
          const sClose = shortKlines[i][4];
          if (sClose > 0) ratios.push(lClose / sClose);
        }

        // Calculate EMA 10
        let ema = ratios[0];
        const alpha = 2 / (10 + 1);
        for (let i = 1; i < ratios.length; i++) {
          ema = alpha * ratios[i] + (1 - alpha) * ema;
        }

        this.emaCache.set(pair.pairSymbol, ema);
        console.log(`✅ [${pair.pairSymbol}] Historical EMA10 initialized: ${ema.toFixed(6)}`);
      } catch (err: any) {
        console.error(`❌ Failed to init EMA history for ${pair.pairSymbol}:`, err.message);
      }
    }
  }

  public async scanOnce(): Promise<MarketSignal[]> {
    const signals: MarketSignal[] = [];

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
        let ema10 = this.emaCache.get(pair.pairSymbol) || currentRatio;

        // Smooth update EMA (alpha = 2 / 11 = 0.181818)
        const alpha = 2 / (10 + 1);
        ema10 = alpha * currentRatio + (1 - alpha) * ema10;
        this.emaCache.set(pair.pairSymbol, ema10);

        const isInTrend = currentRatio > ema10;

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
    const record: Partial<PairMarketData> = {
      pair_symbol: signal.pairConfig.pairSymbol,
      long_coin: signal.pairConfig.longCoin,
      short_coin: signal.pairConfig.shortCoin,
      current_ratio: Number(signal.currentRatio.toFixed(8)),
      ema_10: Number(signal.ema10.toFixed(8)),
      is_in_trend: signal.isInTrend,
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
