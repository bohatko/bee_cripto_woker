import { supabase } from '../config.js';
import { DEFAULT_STRATEGY_PAIRS, StrategyPairConfig } from './symbols.js';
import { StrategyPairRow } from '../types/index.js';

const REFRESH_INTERVAL_MS = 60_000;

/**
 * PairRegistry: in-memory cache of the global active trading basket.
 *
 * Source of truth is the `strategy_pairs` table (rows with is_active = true),
 * refreshed every 60s. If the table is empty or the DB is unreachable, the
 * registry falls back to DEFAULT_STRATEGY_PAIRS and logs a warning; in that
 * fallback state it reports itself as "not healthy" so that consumers (e.g.
 * pair_market_data cleanup) can skip destructive actions.
 */
export class PairRegistry {
  private pairs: StrategyPairConfig[] = [...DEFAULT_STRATEGY_PAIRS];
  private activeSymbols: Set<string> = new Set(DEFAULT_STRATEGY_PAIRS.map((p) => p.pairSymbol));
  private healthy = false;
  private timer: NodeJS.Timeout | null = null;
  private lastWarnAt = 0;

  /** Load the basket once (call before the scanner starts). */
  public async init(): Promise<void> {
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('strategy_pairs')
        .select('pair_symbol, long_coin, short_coin')
        .eq('is_active', true)
        .order('activated_at', { ascending: true });

      if (error) throw new Error(error.message);

      if (!data || data.length === 0) {
        this.applyFallback('strategy_pairs table is empty');
        return;
      }

      this.pairs = (data as Pick<StrategyPairRow, 'pair_symbol' | 'long_coin' | 'short_coin'>[]).map((row) => ({
        pairSymbol: row.pair_symbol,
        longCoin: row.long_coin,
        shortCoin: row.short_coin,
      }));
      this.activeSymbols = new Set(this.pairs.map((p) => p.pairSymbol));
      this.healthy = true;
    } catch (err: any) {
      this.applyFallback(`DB error: ${err.message}`);
    }
  }

  private applyFallback(reason: string) {
    this.pairs = [...DEFAULT_STRATEGY_PAIRS];
    this.activeSymbols = new Set(this.pairs.map((p) => p.pairSymbol));
    this.healthy = false;
    const now = Date.now();
    if (now - this.lastWarnAt > 5 * 60_000) {
      this.lastWarnAt = now;
      console.warn(`⚠️ [PAIR REGISTRY] Falling back to DEFAULT_STRATEGY_PAIRS (${reason})`);
    }
  }

  /** Current active basket (fallback defaults when DB is unavailable). */
  public getActivePairs(): StrategyPairConfig[] {
    return this.pairs;
  }

  public isActivePair(pairSymbol: string): boolean {
    return this.activeSymbols.has(pairSymbol);
  }

  /** True when the basket was successfully loaded from the DB (not fallback). */
  public isHealthy(): boolean {
    return this.healthy;
  }

  public start() {
    if (this.timer) return;
    console.log(`🧺 Pair Registry started (refresh interval: ${REFRESH_INTERVAL_MS}ms)...`);
    this.timer = setInterval(() => {
      this.refresh().catch((err) => console.error('Pair registry refresh error:', err.message));
    }, REFRESH_INTERVAL_MS);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('🛑 Pair Registry stopped.');
    }
  }
}

/** Shared singleton used by the scanner, order router and pair selection job. */
export const pairRegistry = new PairRegistry();
