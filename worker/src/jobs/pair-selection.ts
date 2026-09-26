import ccxt from 'ccxt';
import { supabase, CONFIG } from '../config.js';
import { pairRegistry } from '../exchanges/pair-registry.js';
import { getExchangeSymbol } from '../exchanges/symbols.js';
import { PairSelectionProgressStep, PairSelectionRun, StrategyPairRow } from '../types/index.js';

// ==============================================================================
// Momentum pair screener + basket auto-rotation.
//
// Daily (or admin-triggered) pipeline:
//   universe -> 4h OHLCV (90d) -> ordered-pair momentum metrics -> greedy basket
//   -> rotation guardrails (hysteresis, replacement limit, global toggle)
//   -> apply to strategy_pairs + audit_logs.
//
// Selection metric is momentum (ratio drift t-stat), NOT cointegration:
// the mean-reversion screener was proven -34.8% OOS (research/pair_selection).
// ==============================================================================

const FOUR_H_MS = 4 * 60 * 60 * 1000;
const BARS_REQUIRED = 540; // 90 days of closed 4h candles
const MIN_DRIFT_TSTAT = 2.0;
const MIN_LEG_CORRELATION = 0.5;
const MAX_BETA_DIFF = 0.15; // |beta_long - beta_short| vs BTC
const MAX_FUNDING_COST_PCT_8H = 0.05; // hard reject above this expected cost (%/8h)
const FUNDING_PENALTY_PER_THRESHOLD = 1.0; // t-stat points subtracted at the threshold cost
const EMA_SPAN = 10;
const BASKET_SIZE = 2;
const CANDIDATES_STORED = 50;
const MIN_RET_SAMPLES = 500; // require near-full 90d overlap between legs

/** Stablecoins and pegged assets excluded from the universe. Leveraged tokens
 * (UP/DOWN/BULL/BEAR) are spot-only products and never appear on USDT-M futures. */
const EXCLUDED_BASES = new Set([
  'USDC', 'FDUSD', 'TUSD', 'DAI', 'BUSD', 'USDP', 'USDE', 'USD1', 'XUSD',
  'EUR', 'EURI', 'AEUR', 'PAXG',
]);

interface CoinData {
  coin: string;
  binanceSymbol: string; // unified ccxt symbol on binanceusdm
  quoteVolumeUsd: number;
  fundingRate: number; // per 8h, fraction (0.0001 = 0.01%)
  /** close by candle open timestamp (closed 4h candles only) */
  closesByTs: Map<number, number>;
  /** 4h log return by candle open timestamp (needs previous grid candle) */
  retsByTs: Map<number, number>;
  betaVsBtc: number;
}

export interface CandidateMetrics {
  t_stat: number;
  drift_first_half: number;
  drift_second_half: number;
  corr: number;
  beta_long: number;
  beta_short: number;
  beta_diff: number;
  funding_long: number;
  funding_short: number;
  funding_cost_pct_8h: number;
  funding_penalty: number;
  vol_long_usd_24h: number;
  vol_short_usd_24h: number;
  in_trend: boolean;
  samples: number;
}

export interface Candidate {
  pair_symbol: string;
  long_coin: string;
  short_coin: string;
  score: number;
  valid: boolean;
  reject_reasons: string[];
  metrics: CandidateMetrics;
}

interface BasketSlot {
  pairSymbol: string;
  longCoin: string;
  shortCoin: string;
  score: number;
  isIncumbent: boolean;
  metrics: CandidateMetrics | null;
}

export interface Replacement {
  removed: string | null;
  added: string;
  old_score: number | null;
  new_score: number;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function std(xs: number[], mu: number): number {
  if (xs.length < 2) return 0;
  const v = xs.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function correlation(a: number[], b: number[]): number {
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

function emaLast(values: number[], span: number): number {
  if (values.length === 0) return NaN;
  const alpha = 2 / (span + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) {
    ema = alpha * values[i] + (1 - alpha) * ema;
  }
  return ema;
}

export class PairSelectionJob {
  private timer: NodeJS.Timeout | null = null;
  private intervalMs: number;
  private running = false;

  constructor(intervalMs: number = 60_000) {
    this.intervalMs = intervalMs;
  }

  // ============================================================================
  // Scheduling
  // ============================================================================

  public async tick() {
    if (this.running) return;

    try {
      // 1. Admin-triggered pending run has priority
      const { data: pending } = await supabase
        .from('pair_selection_runs')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (pending) {
        await this.executeRun(pending as PairSelectionRun);
        return;
      }

      // 2. Daily cron run after PAIR_SELECTION_UTC_HOUR:MINUTE (default 00:10 UTC,
      //    right after the 00:00 4h candle close)
      if (!CONFIG.pairSelectionEnabled) return;
      const now = new Date();
      const minutesNow = now.getUTCHours() * 60 + now.getUTCMinutes();
      const minutesDue = CONFIG.pairSelectionUtcHour * 60 + CONFIG.pairSelectionUtcMinute;
      if (minutesNow < minutesDue) return;

      const todayUtcStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
      const { count } = await supabase
        .from('pair_selection_runs')
        .select('id', { count: 'exact', head: true })
        .eq('trigger_source', 'cron')
        .gte('created_at', todayUtcStart);

      if ((count ?? 0) > 0) return;

      const { data: created, error } = await supabase
        .from('pair_selection_runs')
        .insert({ status: 'pending', trigger_source: 'cron' })
        .select()
        .single();

      if (error || !created) {
        if (error) console.error('❌ [PAIR SELECTION] Failed to create cron run:', error.message);
        return;
      }
      await this.executeRun(created as PairSelectionRun);
    } catch (err: any) {
      console.error('❌ [PAIR SELECTION] Tick error:', err.message);
    }
  }

  private async executeRun(run: PairSelectionRun) {
    this.running = true;
    console.log(`🔬 [PAIR SELECTION] Starting run ${run.id} (trigger: ${run.trigger_source})...`);

    await supabase
      .from('pair_selection_runs')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', run.id);

    await this.appendProgress(run.id, 'started', 'Worker picked up the run and started the momentum screener', {
      trigger: run.trigger_source,
    });

    try {
      const result = await this.runPipeline(run);
      await this.appendProgress(run.id, 'completed', 'Pipeline finished', {
        universe_size: result.universeSize,
        valid_candidates: result.validCount,
        applied: result.applied,
        replacements: result.replacements.length,
      });
      await supabase
        .from('pair_selection_runs')
        .update({
          status: 'completed',
          finished_at: new Date().toISOString(),
          universe_size: result.universeSize,
          candidates: result.candidatesJson,
          applied: result.applied,
          replacements: result.replacements,
        })
        .eq('id', run.id);
      console.log(
        `✅ [PAIR SELECTION] Run ${run.id} completed. Universe: ${result.universeSize}, valid candidates: ${result.validCount}, applied: ${result.applied}, replacements: ${result.replacements.length}`
      );
    } catch (err: any) {
      console.error(`❌ [PAIR SELECTION] Run ${run.id} failed:`, err.message);
      await this.appendProgress(run.id, 'failed', String(err.message || err).slice(0, 500));
      await supabase
        .from('pair_selection_runs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error: String(err.message || err).slice(0, 2000),
        })
        .eq('id', run.id);
    } finally {
      this.running = false;
    }
  }

  /** Append a step to pair_selection_runs.progress_log for live admin tracing. */
  private async appendProgress(
    runId: string,
    stage: string,
    message: string,
    detail?: Record<string, unknown>
  ) {
    const step: PairSelectionProgressStep = {
      at: new Date().toISOString(),
      stage,
      message,
      ...(detail ? { detail } : {}),
    };

    try {
      const { data } = await supabase
        .from('pair_selection_runs')
        .select('progress_log')
        .eq('id', runId)
        .maybeSingle();

      const existing = Array.isArray(data?.progress_log) ? data!.progress_log : [];
      const next = [...existing, step].slice(-80);

      await supabase.from('pair_selection_runs').update({ progress_log: next }).eq('id', runId);
      console.log(`🧾 [PAIR SELECTION] [${stage}] ${message}`);
    } catch (err: any) {
      console.warn(`⚠️ [PAIR SELECTION] Failed to append progress_log: ${err.message}`);
    }
  }

  // ============================================================================
  // Pipeline
  // ============================================================================

  private async runPipeline(run: PairSelectionRun): Promise<{
    universeSize: number;
    validCount: number;
    candidatesJson: unknown;
    applied: boolean;
    replacements: Replacement[];
  }> {
    const binance = new ccxt.binanceusdm({ enableRateLimit: true, options: { defaultType: 'future' } });
    const okx = new ccxt.okx({ enableRateLimit: true });
    const bybit = new ccxt.bybit({ enableRateLimit: true });

    // --- 1. Universe: top USDT-M perps by 24h quote volume, tradable on all 3 exchanges
    await this.appendProgress(run.id, 'load_markets', 'Loading markets on Binance / OKX / Bybit');
    await Promise.all([binance.loadMarkets(), okx.loadMarkets(), bybit.loadMarkets()]);
    await this.appendProgress(run.id, 'fetch_tickers', 'Fetching Binance USDT-M tickers for universe ranking');
    const tickers = await binance.fetchTickers();

    const universeCoins = this.buildUniverse(binance, okx, bybit, tickers);
    console.log(`🌐 [PAIR SELECTION] Universe: ${universeCoins.length} coins (cap ${CONFIG.universeSize})`);
    await this.appendProgress(run.id, 'universe', `Universe built: ${universeCoins.length} coins (cap ${CONFIG.universeSize})`, {
      coins: universeCoins.slice(0, 12).map((c) => c.coin),
    });
    if (universeCoins.length < 4) {
      throw new Error(`Universe too small (${universeCoins.length} coins) - aborting run`);
    }

    // --- 2. Funding rates (single batched call)
    await this.appendProgress(run.id, 'funding', 'Fetching funding rates for carry cost filter');
    const fundingBySymbol = new Map<string, number>();
    try {
      const fundingRates: any = await binance.fetchFundingRates();
      for (const key of Object.keys(fundingRates)) {
        const fr = fundingRates[key];
        if (fr && typeof fr.fundingRate === 'number') fundingBySymbol.set(key, fr.fundingRate);
      }
      await this.appendProgress(run.id, 'funding_done', `Funding rates loaded for ${fundingBySymbol.size} symbols`);
    } catch (err: any) {
      console.warn(`⚠️ [PAIR SELECTION] fetchFundingRates failed (${err.message}); funding penalty disabled for this run`);
      await this.appendProgress(run.id, 'funding_skip', `Funding fetch failed — penalty disabled (${err.message})`);
    }

    // --- 3. Historical data: 90d of 4h closes per coin + BTC (for betas)
    await this.appendProgress(run.id, 'ohlcv_btc', 'Downloading BTC 4h history for beta benchmark');
    const btcSeries = await this.fetch4hCloses(binance, 'BTC/USDT');
    if (!btcSeries || btcSeries.closesByTs.size < BARS_REQUIRED) {
      throw new Error('Insufficient BTC 4h history for beta computation');
    }

    await this.appendProgress(
      run.id,
      'ohlcv_universe',
      `Downloading 90d 4h OHLCV for ${universeCoins.length} coins (rate-limited, may take a few minutes)`
    );
    const coins: CoinData[] = [];
    for (let i = 0; i < universeCoins.length; i++) {
      const u = universeCoins[i];
      const series = await this.fetch4hCloses(binance, u.binanceSymbol);
      if (series && series.closesByTs.size >= BARS_REQUIRED) {
        const beta = this.computeBeta(series.retsByTs, btcSeries.retsByTs);
        coins.push({
          coin: u.coin,
          binanceSymbol: u.binanceSymbol,
          quoteVolumeUsd: u.quoteVolumeUsd,
          fundingRate: fundingBySymbol.get(u.binanceSymbol) ?? 0,
          closesByTs: series.closesByTs,
          retsByTs: series.retsByTs,
          betaVsBtc: beta,
        });
      }
      const scanned = i + 1;
      if (scanned === 1 || scanned % 10 === 0 || scanned === universeCoins.length) {
        await this.appendProgress(
          run.id,
          'ohlcv_progress',
          `OHLCV scan ${scanned}/${universeCoins.length} — ${coins.length} coins with full history`
        );
      }
    }
    console.log(`📥 [PAIR SELECTION] Loaded full 90d history for ${coins.length}/${universeCoins.length} coins`);
    await this.appendProgress(
      run.id,
      'ohlcv_done',
      `OHLCV ready: ${coins.length}/${universeCoins.length} coins with ≥540 bars`
    );
    if (coins.length < 4) {
      throw new Error(`Only ${coins.length} coins with full 540-bar history - aborting run`);
    }

    // --- 4. Candidate metrics for every ordered pair (A=long, B=short)
    await this.appendProgress(run.id, 'score_pairs', `Scoring ${coins.length * (coins.length - 1)} ordered pairs`);
    const candidates: Candidate[] = [];
    for (const a of coins) {
      for (const b of coins) {
        if (a.coin === b.coin) continue;
        const cand = this.evaluatePair(a, b);
        if (cand) candidates.push(cand);
      }
    }
    candidates.sort((x, y) => y.score - x.score);
    const validCandidates = candidates.filter((c) => c.valid);
    console.log(`🧮 [PAIR SELECTION] Evaluated ${candidates.length} ordered pairs, ${validCandidates.length} pass all filters`);
    await this.appendProgress(
      run.id,
      'score_done',
      `Scored ${candidates.length} pairs — ${validCandidates.length} pass all filters`,
      {
        top: validCandidates.slice(0, 5).map((c) => ({ pair: c.pair_symbol, score: Number(c.score.toFixed(3)) })),
      }
    );

    // --- 5. Rotation with guardrails
    await this.appendProgress(run.id, 'rotation_plan', 'Planning basket rotation with hysteresis / replacement limits');
    const { data: currentRows } = await supabase
      .from('strategy_pairs')
      .select('*')
      .eq('is_active', true);
    const current = (currentRows || []) as StrategyPairRow[];

    const candidateBySymbol = new Map(candidates.map((c) => [c.pair_symbol, c]));
    const basket: BasketSlot[] = current.map((row) => {
      const recomputed = candidateBySymbol.get(row.pair_symbol);
      return {
        pairSymbol: row.pair_symbol,
        longCoin: row.long_coin,
        shortCoin: row.short_coin,
        // Recomputed score in THIS run; pairs that no longer compute (delisted,
        // insufficient history) get -Infinity and become freely replaceable.
        score: recomputed ? recomputed.score : Number.NEGATIVE_INFINITY,
        isIncumbent: true,
        metrics: recomputed ? recomputed.metrics : null,
      };
    });

    const replacements = this.planRotation(basket, validCandidates);
    await this.appendProgress(
      run.id,
      'rotation_ready',
      replacements.length === 0
        ? 'No replacements pass guardrails'
        : `Planned ${replacements.length} replacement(s)`,
      { replacements }
    );

    // --- 6. Apply (only when the global toggle is on)
    const autoRotationEnabled = await this.isAutoRotationEnabled();
    let applied = false;
    if (!autoRotationEnabled) {
      console.log('⏸️ [PAIR SELECTION] auto_rotation_enabled=false - candidates saved, basket NOT modified');
      await this.appendProgress(
        run.id,
        'apply_skipped',
        'auto_rotation_enabled=false — candidates saved, basket NOT modified'
      );
    } else if (replacements.length === 0) {
      console.log('🔁 [PAIR SELECTION] No replacements pass the guardrails - basket unchanged');
      await this.appendProgress(run.id, 'apply_skipped', 'No replacements to apply — basket unchanged');
    } else {
      await this.appendProgress(run.id, 'apply', 'Applying rotation to strategy_pairs + audit_logs');
      await this.applyRotation(run, basket, replacements, candidateBySymbol);
      applied = true;
      await this.appendProgress(run.id, 'apply_done', 'Basket rotation applied');
    }

    // Always refresh score/metrics on remaining active incumbents so the admin
    // basket table never shows blank scores after a screener run.
    await this.refreshActivePairScores(candidateBySymbol);
    await this.appendProgress(run.id, 'scores_refreshed', 'Refreshed score/metrics on active basket pairs');

    const candidatesJson = candidates.slice(0, CANDIDATES_STORED).map((c) => ({
      pair_symbol: c.pair_symbol,
      long_coin: c.long_coin,
      short_coin: c.short_coin,
      score: Number(c.score.toFixed(4)),
      valid: c.valid,
      reject_reasons: c.reject_reasons,
      metrics: {
        ...c.metrics,
        t_stat: Number(c.metrics.t_stat.toFixed(4)),
        corr: Number(c.metrics.corr.toFixed(4)),
        beta_diff: Number(c.metrics.beta_diff.toFixed(4)),
        funding_cost_pct_8h: Number(c.metrics.funding_cost_pct_8h.toFixed(5)),
      },
    }));

    // Ensure every active basket pair is present in stored candidates (even if
    // it ranked outside the top-N), so the admin UI can show its score.
    const storedSymbols = new Set(candidatesJson.map((c) => c.pair_symbol));
    for (const row of current) {
      if (storedSymbols.has(row.pair_symbol)) continue;
      const cand = candidateBySymbol.get(row.pair_symbol);
      if (!cand) continue;
      candidatesJson.push({
        pair_symbol: cand.pair_symbol,
        long_coin: cand.long_coin,
        short_coin: cand.short_coin,
        score: Number(cand.score.toFixed(4)),
        valid: cand.valid,
        reject_reasons: cand.reject_reasons,
        metrics: {
          ...cand.metrics,
          t_stat: Number(cand.metrics.t_stat.toFixed(4)),
          corr: Number(cand.metrics.corr.toFixed(4)),
          beta_diff: Number(cand.metrics.beta_diff.toFixed(4)),
          funding_cost_pct_8h: Number(cand.metrics.funding_cost_pct_8h.toFixed(5)),
        },
      });
    }

    return {
      universeSize: coins.length,
      validCount: validCandidates.length,
      candidatesJson,
      applied,
      replacements,
    };
  }

  // ============================================================================
  // Universe
  // ============================================================================

  private buildUniverse(
    binance: any,
    okx: any,
    bybit: any,
    tickers: any
  ): { coin: string; binanceSymbol: string; quoteVolumeUsd: number }[] {
    const seen = new Set<string>();
    const all: { coin: string; binanceSymbol: string; quoteVolumeUsd: number }[] = [];

    for (const symbol of Object.keys(binance.markets)) {
      const m = binance.markets[symbol];
      if (!m || !m.swap || !m.linear || m.quote !== 'USDT' || m.settle !== 'USDT') continue;
      if (m.active === false) continue;
      const coin = String(m.base || '').toUpperCase();
      if (!coin || seen.has(coin) || EXCLUDED_BASES.has(coin)) continue;

      const ticker = tickers[symbol];
      const quoteVolumeUsd = Number(ticker?.quoteVolume ?? 0);
      if (!Number.isFinite(quoteVolumeUsd) || quoteVolumeUsd <= 0) continue;

      seen.add(coin);
      all.push({ coin, binanceSymbol: symbol, quoteVolumeUsd });
    }

    all.sort((x, y) => y.quoteVolumeUsd - x.quoteVolumeUsd);
    const top = all.slice(0, CONFIG.universeSize);

    // Coin must be tradable on all 3 supported exchanges, otherwise users on
    // OKX/Bybit could not open the position.
    return top.filter((u) => {
      const okxOk = Boolean(okx.markets[getExchangeSymbol(u.coin, 'okx')]);
      const bybitOk = Boolean(bybit.markets[getExchangeSymbol(u.coin, 'bybit')]);
      return okxOk && bybitOk;
    });
  }

  // ============================================================================
  // Data
  // ============================================================================

  private async fetch4hCloses(
    binance: any,
    symbol: string
  ): Promise<{ closesByTs: Map<number, number>; retsByTs: Map<number, number> } | null> {
    try {
      const now = Date.now();
      const since = now - (BARS_REQUIRED + 10) * FOUR_H_MS;
      const all: number[][] = [];
      let cursor = since;

      // 2 pages x 500 bars cover 540 bars; loop defensively with a hard cap.
      for (let page = 0; page < 3; page++) {
        const batch: number[][] = await binance.fetchOHLCV(symbol, '4h', cursor, 500);
        if (!batch || batch.length === 0) break;
        all.push(...batch);
        if (batch.length < 500) break;
        cursor = batch[batch.length - 1][0] + 1;
      }

      // Keep closed candles only
      const closed = all.filter((k) => k[0] + FOUR_H_MS <= now);
      if (closed.length < BARS_REQUIRED) return null;
      const window = closed.slice(-BARS_REQUIRED);

      const closesByTs = new Map<number, number>();
      for (const k of window) {
        const close = Number(k[4]);
        if (close > 0) closesByTs.set(k[0], close);
      }

      const retsByTs = new Map<number, number>();
      for (const [ts, close] of closesByTs) {
        const prev = closesByTs.get(ts - FOUR_H_MS);
        if (prev && prev > 0) retsByTs.set(ts, Math.log(close / prev));
      }

      return { closesByTs, retsByTs };
    } catch (err: any) {
      console.warn(`⚠️ [PAIR SELECTION] fetchOHLCV failed for ${symbol}: ${err.message}`);
      return null;
    }
  }

  private computeBeta(coinRets: Map<number, number>, btcRets: Map<number, number>): number {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [ts, r] of coinRets) {
      const rb = btcRets.get(ts);
      if (rb !== undefined) {
        ys.push(r);
        xs.push(rb);
      }
    }
    if (xs.length < 30) return NaN;
    const mx = mean(xs);
    const my = mean(ys);
    let cov = 0;
    let varx = 0;
    for (let i = 0; i < xs.length; i++) {
      cov += (xs[i] - mx) * (ys[i] - my);
      varx += (xs[i] - mx) * (xs[i] - mx);
    }
    if (varx <= 0) return NaN;
    return cov / varx;
  }

  // ============================================================================
  // Pair evaluation
  // ============================================================================

  private evaluatePair(a: CoinData, b: CoinData): Candidate | null {
    // Common return timestamps of both legs
    const commonTs: number[] = [];
    for (const ts of a.retsByTs.keys()) {
      if (b.retsByTs.has(ts)) commonTs.push(ts);
    }
    if (commonTs.length < MIN_RET_SAMPLES) return null;
    commonTs.sort((x, y) => x - y);

    const retsA: number[] = [];
    const retsB: number[] = [];
    const ratioRets: number[] = [];
    for (const ts of commonTs) {
      const ra = a.retsByTs.get(ts)!;
      const rb = b.retsByTs.get(ts)!;
      retsA.push(ra);
      retsB.push(rb);
      ratioRets.push(ra - rb); // log-return of Ratio = P_A / P_B
    }

    const n = ratioRets.length;
    const mu = mean(ratioRets);
    const sigma = std(ratioRets, mu);
    const tStat = sigma > 0 ? (mu / (sigma / Math.sqrt(n))) : 0;

    const half = Math.floor(n / 2);
    const driftFirstHalf = mean(ratioRets.slice(0, half));
    const driftSecondHalf = mean(ratioRets.slice(half));

    const corr = correlation(retsA, retsB);
    const betaDiff = Number.isFinite(a.betaVsBtc) && Number.isFinite(b.betaVsBtc)
      ? Math.abs(a.betaVsBtc - b.betaVsBtc)
      : Number.POSITIVE_INFINITY;

    // Expected funding cost of the position: we PAY long-leg funding (when
    // positive) and RECEIVE short-leg funding (when positive) => net cost per 8h.
    const fundingCostPct8h = (a.fundingRate - b.fundingRate) * 100;
    const fundingPenalty = Math.max(0, fundingCostPct8h) / MAX_FUNDING_COST_PCT_8H * FUNDING_PENALTY_PER_THRESHOLD;

    // In-trend now: last closed 4h ratio above EMA10 of the ratio series
    const ratioCloses: number[] = [];
    for (const ts of commonTs) {
      const ca = a.closesByTs.get(ts);
      const cb = b.closesByTs.get(ts);
      if (ca && cb && cb > 0) ratioCloses.push(ca / cb);
    }
    const ema = emaLast(ratioCloses, EMA_SPAN);
    const inTrend = ratioCloses.length > 0 && Number.isFinite(ema) && ratioCloses[ratioCloses.length - 1] > ema;

    const rejectReasons: string[] = [];
    if (tStat <= MIN_DRIFT_TSTAT) rejectReasons.push('t_stat');
    if (driftFirstHalf <= 0 || driftSecondHalf <= 0) rejectReasons.push('stability');
    if (corr < MIN_LEG_CORRELATION) rejectReasons.push('correlation');
    if (!(betaDiff <= MAX_BETA_DIFF)) rejectReasons.push('beta');
    if (a.quoteVolumeUsd < CONFIG.minLegVolumeUsd || b.quoteVolumeUsd < CONFIG.minLegVolumeUsd) rejectReasons.push('liquidity');
    if (fundingCostPct8h > MAX_FUNDING_COST_PCT_8H) rejectReasons.push('funding');
    if (!inTrend) rejectReasons.push('not_in_trend');

    const score = tStat - fundingPenalty;

    return {
      pair_symbol: `${a.coin}/${b.coin}`,
      long_coin: a.coin,
      short_coin: b.coin,
      score,
      valid: rejectReasons.length === 0,
      reject_reasons: rejectReasons,
      metrics: {
        t_stat: tStat,
        drift_first_half: driftFirstHalf,
        drift_second_half: driftSecondHalf,
        corr,
        beta_long: Number.isFinite(a.betaVsBtc) ? Number(a.betaVsBtc.toFixed(4)) : NaN,
        beta_short: Number.isFinite(b.betaVsBtc) ? Number(b.betaVsBtc.toFixed(4)) : NaN,
        beta_diff: betaDiff,
        funding_long: a.fundingRate,
        funding_short: b.fundingRate,
        funding_cost_pct_8h: fundingCostPct8h,
        funding_penalty: Number(fundingPenalty.toFixed(4)),
        vol_long_usd_24h: Math.round(a.quoteVolumeUsd),
        vol_short_usd_24h: Math.round(b.quoteVolumeUsd),
        in_trend: inTrend,
        samples: n,
      },
    };
  }

  // ============================================================================
  // Rotation guardrails
  // ============================================================================

  /**
   * Plans replacements against the current basket:
   * - hysteresis: challenger score >= ROTATION_HYSTERESIS x incumbent recomputed score
   *   (an incumbent with score <= 0 is replaceable by any positive challenger);
   * - at most ROTATION_MAX_REPLACEMENTS replacements per run;
   * - one coin appears in at most one basket pair (long or short side);
   * - free slots (basket smaller than BASKET_SIZE) are filled without hysteresis
   *   and do not count against the replacement limit.
   * Mutates `basket` in place and returns the replacement list.
   */
  private planRotation(basket: BasketSlot[], validCandidates: Candidate[]): Replacement[] {
    const replacements: Replacement[] = [];

    const coinsInUse = (slots: BasketSlot[]) => {
      const s = new Set<string>();
      for (const b of slots) {
        s.add(b.longCoin);
        s.add(b.shortCoin);
      }
      return s;
    };

    for (const cand of validCandidates) {
      if (basket.some((b) => b.pairSymbol === cand.pair_symbol)) continue;

      // Fill free slots first (no hysteresis, no replacement budget)
      if (basket.length < BASKET_SIZE) {
        const used = coinsInUse(basket);
        if (used.has(cand.long_coin) || used.has(cand.short_coin)) continue;
        basket.push({
          pairSymbol: cand.pair_symbol,
          longCoin: cand.long_coin,
          shortCoin: cand.short_coin,
          score: cand.score,
          isIncumbent: false,
          metrics: cand.metrics,
        });
        replacements.push({ removed: null, added: cand.pair_symbol, old_score: null, new_score: Number(cand.score.toFixed(4)) });
        continue;
      }

      if (replacements.filter((r) => r.removed !== null).length >= CONFIG.rotationMaxReplacements) continue;

      // Try to replace the weakest incumbent that resolves coin-uniqueness
      const incumbents = basket
        .filter((b) => b.isIncumbent)
        .sort((x, y) => x.score - y.score);

      for (const inc of incumbents) {
        const rest = basket.filter((b) => b !== inc);
        const used = coinsInUse(rest);
        if (used.has(cand.long_coin) || used.has(cand.short_coin)) continue;

        const passesHysteresis = inc.score <= 0
          ? cand.score > 0
          : cand.score >= CONFIG.rotationHysteresis * inc.score;
        if (!passesHysteresis) break; // incumbents sorted ascending: stronger ones will not pass either

        const idx = basket.indexOf(inc);
        basket[idx] = {
          pairSymbol: cand.pair_symbol,
          longCoin: cand.long_coin,
          shortCoin: cand.short_coin,
          score: cand.score,
          isIncumbent: false,
          metrics: cand.metrics,
        };
        replacements.push({
          removed: inc.pairSymbol,
          added: cand.pair_symbol,
          old_score: Number.isFinite(inc.score) ? Number(inc.score.toFixed(4)) : null,
          new_score: Number(cand.score.toFixed(4)),
        });
        break;
      }
    }

    return replacements;
  }

  /** Persist recomputed score/metrics onto currently active strategy_pairs rows. */
  private async refreshActivePairScores(candidateBySymbol: Map<string, Candidate>) {
    const { data: activeRows, error } = await supabase
      .from('strategy_pairs')
      .select('id, pair_symbol')
      .eq('is_active', true);

    if (error || !activeRows) {
      console.warn(`⚠️ [PAIR SELECTION] Could not load active pairs for score refresh: ${error?.message}`);
      return;
    }

    for (const row of activeRows as { id: string; pair_symbol: string }[]) {
      const cand = candidateBySymbol.get(row.pair_symbol);
      if (!cand) continue;
      const { error: updError } = await supabase
        .from('strategy_pairs')
        .update({
          score: Number(cand.score.toFixed(6)),
          metrics: {
            ...cand.metrics,
            t_stat: Number(cand.metrics.t_stat.toFixed(4)),
            corr: Number(cand.metrics.corr.toFixed(4)),
            beta_diff: Number(cand.metrics.beta_diff.toFixed(4)),
            funding_cost_pct_8h: Number(cand.metrics.funding_cost_pct_8h.toFixed(5)),
            valid: cand.valid,
            reject_reasons: cand.reject_reasons,
          },
        })
        .eq('id', row.id);
      if (updError) {
        console.warn(`⚠️ [PAIR SELECTION] Score refresh failed for ${row.pair_symbol}: ${updError.message}`);
      }
    }
  }

  private async isAutoRotationEnabled(): Promise<boolean> {
    const { data, error } = await supabase
      .from('engine_settings')
      .select('auto_rotation_enabled')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) {
      console.warn('⚠️ [PAIR SELECTION] engine_settings unavailable - treating auto-rotation as DISABLED');
      return false;
    }
    return Boolean(data.auto_rotation_enabled);
  }

  private async applyRotation(
    run: PairSelectionRun,
    finalBasket: BasketSlot[],
    replacements: Replacement[],
    candidateBySymbol: Map<string, Candidate>
  ) {
    const nowIso = new Date().toISOString();

    // 1. Deactivate replaced pairs (open positions on them keep being managed
    //    by the scanner/guard until natural TP/SL/trend-flip exit)
    const removedSymbols = replacements.map((r) => r.removed).filter((s): s is string => Boolean(s));
    if (removedSymbols.length > 0) {
      const { error } = await supabase
        .from('strategy_pairs')
        .update({ is_active: false, deactivated_at: nowIso })
        .in('pair_symbol', removedSymbols)
        .eq('is_active', true);
      if (error) throw new Error(`Failed to deactivate replaced pairs: ${error.message}`);
    }

    // 2. Insert newly added pairs
    const addedSymbols = new Set(replacements.map((r) => r.added));
    const inserts = finalBasket
      .filter((b) => addedSymbols.has(b.pairSymbol))
      .map((b) => ({
        pair_symbol: b.pairSymbol,
        long_coin: b.longCoin,
        short_coin: b.shortCoin,
        score: Number.isFinite(b.score) ? Number(b.score.toFixed(4)) : null,
        metrics: b.metrics,
        run_id: run.id,
        is_active: true,
        activated_at: nowIso,
      }));
    if (inserts.length > 0) {
      const { error } = await supabase.from('strategy_pairs').insert(inserts);
      if (error) throw new Error(`Failed to insert new basket pairs: ${error.message}`);
    }

    // 3. Refresh scores/metrics of kept incumbents (informational)
    for (const slot of finalBasket) {
      if (addedSymbols.has(slot.pairSymbol) || !slot.metrics) continue;
      const recomputed = candidateBySymbol.get(slot.pairSymbol);
      if (!recomputed) continue;
      await supabase
        .from('strategy_pairs')
        .update({ score: Number(recomputed.score.toFixed(4)), metrics: recomputed.metrics })
        .eq('pair_symbol', slot.pairSymbol)
        .eq('is_active', true);
    }

    // 4. Audit trail
    await supabase.from('audit_logs').insert({
      user_id: run.requested_by ?? null,
      action: 'pair_rotation_applied',
      details: { run_id: run.id, trigger_source: run.trigger_source, replacements },
    });

    // 5. Make the new basket effective immediately
    await pairRegistry.refresh();

    console.log(
      `🔄 [ROTATION APPLIED] ${replacements.map((r) => `${r.removed ?? '∅'} → ${r.added}`).join(', ')}`
    );
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  public start() {
    if (this.timer) return;
    console.log(`🔬 Pair Selection Job started (poll interval: ${this.intervalMs}ms, cron ${String(CONFIG.pairSelectionUtcHour).padStart(2, '0')}:${String(CONFIG.pairSelectionUtcMinute).padStart(2, '0')} UTC, enabled: ${CONFIG.pairSelectionEnabled})...`);
    this.timer = setInterval(() => {
      this.tick().catch((err) => console.error('Pair selection tick error:', err.message));
    }, this.intervalMs);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('🛑 Pair Selection Job stopped.');
    }
  }
}
