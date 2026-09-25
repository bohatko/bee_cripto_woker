import ccxt from 'ccxt';
import { autocorr, ema, hurstRS, mean, std } from '../engine/stats.js';
import { supabase, CONFIG } from '../config.js';
import { pairRegistry } from '../exchanges/pair-registry.js';
import { getExchangeSymbol } from '../exchanges/symbols.js';
import { RatioBar, simulatePairEngine } from './pair-simulator.js';
import { CandidateMetrics, PairSelectionProgressStep, PairSelectionRun, StrategyPairRow } from '../types/index.js';

const FOUR_H_MS = 4 * 60 * 60 * 1000;
const BARS_REQUIRED = 1080;
const MAX_FUNDING_COST_PCT_8H = 0.05;
const BASKET_SIZE = 4;
const CANDIDATES_STORED = 50;
const MIN_RET_SAMPLES = 700;

const EXCLUDED_BASES = new Set([
  'USDC', 'FDUSD', 'TUSD', 'DAI', 'BUSD', 'USDP', 'USDE', 'USD1', 'XUSD', 'EUR', 'EURI', 'AEUR', 'PAXG',
]);

const COIN_SECTOR_MAP: Record<string, string> = {
  BTC: 'MAJOR',
  ETH: 'MAJOR',
  SOL: 'L1',
  BNB: 'L1',
  AVAX: 'L1',
  ADA: 'L1',
  DOT: 'L1',
  NEAR: 'L1',
  SUI: 'L1',
  APT: 'L1',
  SEI: 'L1',
  ATOM: 'L1',
  FTM: 'L1',
  ALGO: 'L1',
  HBAR: 'L1',
  TON: 'L1',
  TRX: 'L1',
  XRP: 'PAYMENT',
  DOGE: 'MEME',
  SHIB: 'MEME',
  PEPE: 'MEME',
  WIF: 'MEME',
  BONK: 'MEME',
  FLOKI: 'MEME',
  UNI: 'DEFI',
  AAVE: 'DEFI',
  MKR: 'DEFI',
  CRV: 'DEFI',
  LDO: 'DEFI',
  ENA: 'DEFI',
  PENDLE: 'DEFI',
  INJ: 'DEFI',
  RUNE: 'DEFI',
  SNX: 'DEFI',
  LINK: 'INFRA',
  TIA: 'INFRA',
  PYTH: 'INFRA',
  GRT: 'INFRA',
  RENDER: 'AI',
  FET: 'AI',
  NEAR_AI: 'AI',
  TAO: 'AI',
  WLD: 'AI',
  FIL: 'STORAGE',
  AR: 'STORAGE',
  OP: 'L2',
  ARB: 'L2',
  MATIC: 'L2',
  POL: 'L2',
  MANTA: 'L2',
  STRK: 'L2',
  ZEC: 'PRIVACY',
  XMR: 'PRIVACY',
  DASH: 'PRIVACY',
};

function getCoinSector(coin: string): string {
  return COIN_SECTOR_MAP[coin.toUpperCase()] || 'OTHER';
}

function getSectorAffinityMultiplier(coinA: string, coinB: string): number {
  const sA = getCoinSector(coinA);
  const sB = getCoinSector(coinB);
  if (sA !== 'OTHER' && sA === sB) {
    return 1.15; // +15% boost for same sector pairs (L1/L1, DEFI/DEFI, etc.)
  }
  if ((sA === 'MAJOR' && sB === 'L1') || (sA === 'L1' && sB === 'MAJOR')) {
    return 1.05; // +5% boost for Major + L1 combinations
  }
  return 1.0;
}

interface OhlcPoint {
  open: number;
  high: number;
  low: number;
  close: number;
}

interface CoinData {
  coin: string;
  binanceSymbol: string;
  quoteVolumeUsd: number;
  spreadPct: number;
  fundingMean8h: number;
  fundingAbsMax8h: number;
  closesByTs: Map<number, number>;
  ohlcByTs: Map<number, OhlcPoint>;
  retsByTs: Map<number, number>;
  betaVsBtc: number;
}

interface Candidate {
  id: string;
  score: number;
  pair_symbol: string;
  long_coin: string;
  short_coin: string;
  valid: boolean;
  reject_reasons: string[];
  metrics: CandidateMetrics;
  ratioRets: number[];
  ratioBars: RatioBar[];
  activated_at: string;
  deactivated_at: string | null;
  run_id: string | null;
  is_active: boolean;
}

interface BasketSlot {
  pairSymbol: string;
  longCoin: string;
  shortCoin: string;
  score: number;
  isIncumbent: boolean;
  metrics: CandidateMetrics | null;
  ratioRets: number[];
}

interface Replacement {
  removed: string | null;
  added: string;
  old_score: number | null;
  new_score: number;
}

function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const a2 = a.slice(-n);
  const b2 = b.slice(-n);
  const ma = mean(a2);
  const mb = mean(b2);
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (a2[i] - ma) * (b2[i] - mb);
    va += (a2[i] - ma) ** 2;
    vb += (b2[i] - mb) ** 2;
  }
  if (va <= 0 || vb <= 0) return 0;
  return cov / Math.sqrt(va * vb);
}

class RunCancelledError extends Error {
  constructor() {
    super('Cancelled by admin');
    this.name = 'RunCancelledError';
  }
}

function emptySim() {
  return {
    netPnlPct: 0,
    trades: 0,
    winRate: 0,
    profitFactor: 0,
    maxDrawdownPct: 0,
    slShare: 0,
    avgHoldBars: 0,
    equityCurve: [] as number[],
  };
}

export class PairSelectionJob {
  private timer: NodeJS.Timeout | null = null;
  private intervalMs: number;
  private running = false;

  constructor(intervalMs: number = 60_000) {
    this.intervalMs = intervalMs;
  }

  public async tick() {
    if (this.running) return;
    const { data: pending } = await supabase
      .from('pair_selection_runs')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (pending) return this.executeRun(pending as PairSelectionRun);

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
    const { data: created } = await supabase.from('pair_selection_runs').insert({ status: 'pending', trigger_source: 'cron' }).select().single();
    if (created) await this.executeRun(created as PairSelectionRun);
  }

  private async executeRun(run: PairSelectionRun) {
    this.running = true;
    try {
      const { data: claimed, error: claimError } = await supabase
        .from('pair_selection_runs')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', run.id)
        .eq('status', 'pending')
        .eq('cancel_requested', false)
        .select('id')
        .maybeSingle();

      if (claimError) {
        console.error(`❌ PairSelectionRun ${run.id} claim failed:`, claimError.message);
        return;
      }
      if (!claimed) {
        console.log(`PairSelectionRun ${run.id} skipped: cancelled or no longer pending`);
        return;
      }

      console.log(`🚀 Starting PairSelectionRun ${run.id} (trigger: ${run.trigger_source})...`);
      await this.appendProgress(run.id, 'started', 'Worker started engine-aware screener');
      try {
        const result = await this.runPipeline(run);
        await this.throwIfCancelled(run.id);
        const { data: saved } = await supabase
          .from('pair_selection_runs')
          .update({
            status: 'completed',
            finished_at: new Date().toISOString(),
            universe_size: result.universeSize,
            candidates: result.candidatesJson,
            applied: result.applied,
            replacements: result.replacements,
          })
          .eq('id', run.id)
          .eq('status', 'running')
          .eq('cancel_requested', false)
          .select('id')
          .maybeSingle();
        if (!saved) {
          await this.markCancelled(run.id);
          console.log(`PairSelectionRun ${run.id} cancelled before completion was saved`);
          return;
        }
        console.log(`✅ PairSelectionRun ${run.id} completed. Valid candidates: ${result.validCount}/${result.universeSize}`);
      } catch (err: any) {
        if (err instanceof RunCancelledError || (await this.isCancelRequested(run.id))) {
          await this.markCancelled(run.id);
          console.log(`PairSelectionRun ${run.id} cancelled by admin`);
          return;
        }
        console.error(`❌ PairSelectionRun ${run.id} failed:`, err.message);
        await supabase
          .from('pair_selection_runs')
          .update({ status: 'failed', finished_at: new Date().toISOString(), error: String(err.message || err).slice(0, 2000) })
          .eq('id', run.id)
          .eq('status', 'running')
          .eq('cancel_requested', false);
      }
    } finally {
      this.running = false;
    }
  }

  private async isCancelRequested(runId: string): Promise<boolean> {
    const { data } = await supabase
      .from('pair_selection_runs')
      .select('status, cancel_requested')
      .eq('id', runId)
      .maybeSingle();
    return Boolean(data?.cancel_requested) || data?.status === 'cancelled';
  }

  private async throwIfCancelled(runId: string) {
    if (await this.isCancelRequested(runId)) throw new RunCancelledError();
  }

  private async markCancelled(runId: string) {
    await this.appendProgress(runId, 'cancelled', 'Cancelled by admin');
    await supabase
      .from('pair_selection_runs')
      .update({
        status: 'cancelled',
        cancel_requested: true,
        finished_at: new Date().toISOString(),
        error: 'Cancelled by admin',
        applied: false,
      })
      .eq('id', runId)
      .in('status', ['pending', 'running', 'cancelled']);
  }

  private async appendProgress(runId: string, stage: string, message: string, detail?: Record<string, unknown>) {
    const step: PairSelectionProgressStep = { at: new Date().toISOString(), stage, message, ...(detail ? { detail } : {}) };
    const { data } = await supabase.from('pair_selection_runs').select('progress_log').eq('id', runId).maybeSingle();
    const existing = Array.isArray(data?.progress_log) ? data.progress_log : [];
    await supabase.from('pair_selection_runs').update({ progress_log: [...existing, step].slice(-100) }).eq('id', runId);
  }

  private async runPipeline(run: PairSelectionRun) {
    const binance = new ccxt.binanceusdm({ enableRateLimit: true, options: { defaultType: 'future' } });
    const okx = new ccxt.okx({ enableRateLimit: true });
    const bybit = new ccxt.bybit({ enableRateLimit: true });

    binance.timeout = 20_000;
    okx.timeout = 20_000;
    bybit.timeout = 20_000;

    await Promise.all([binance.loadMarkets(), okx.loadMarkets(), bybit.loadMarkets()]);
    await this.throwIfCancelled(run.id);
    const tickers = await binance.fetchTickers();
    const universeCoins = await this.buildUniverse(binance, okx, bybit, tickers, run.id);
    const btc = await this.fetch4hBars(binance, 'BTC/USDT', run.id);
    if (!btc) throw new Error('BTC history not available');

    const coins: CoinData[] = [];
    for (const u of universeCoins) {
      await this.throwIfCancelled(run.id);
      const series = await this.fetch4hBars(binance, u.binanceSymbol, run.id);
      if (!series || series.closesByTs.size < BARS_REQUIRED) continue;
      coins.push({
        coin: u.coin,
        binanceSymbol: u.binanceSymbol,
        quoteVolumeUsd: u.quoteVolumeUsd,
        spreadPct: u.spreadPct,
        fundingMean8h: u.fundingMean8h,
        fundingAbsMax8h: u.fundingAbsMax8h,
        closesByTs: series.closesByTs,
        ohlcByTs: series.ohlcByTs,
        retsByTs: series.retsByTs,
        betaVsBtc: this.computeBeta(series.retsByTs, btc.retsByTs),
      });
    }
    if (coins.length < 4) throw new Error('Insufficient coins after history filter');

    const allCandidates: Candidate[] = [];
    let pairIndex = 0;
    for (const a of coins) {
      for (const b of coins) {
        if (a.coin === b.coin) continue;
        if (pairIndex % 200 === 0) await this.throwIfCancelled(run.id);
        pairIndex++;
        const c = this.evaluatePairStructure(a, b);
        if (!c) continue;
        allCandidates.push(c);
      }
    }
    const structurePass = allCandidates.filter((c) => c.reject_reasons.length === 0);
    // Sort all candidates for simulation: first structure passes, then best near-misses
    const simReady = [...allCandidates].sort((x, y) => {
      const xPass = x.reject_reasons.length === 0 ? 1 : 0;
      const yPass = y.reject_reasons.length === 0 ? 1 : 0;
      if (yPass !== xPass) return yPass - xPass;
      return (y.metrics.hurst ?? 0) - (x.metrics.hurst ?? 0);
    });
    const toSim = simReady.slice(0, CONFIG.simMaxCandidates);
    await this.appendProgress(
      run.id,
      'structure_summary',
      `Structure pass=${structurePass.length}, totalCandidates=${allCandidates.length}, toSim=${toSim.length}`,
    );
    for (let i = 0; i < toSim.length; i++) {
      if (i % 10 === 0) await this.throwIfCancelled(run.id);
      this.evaluatePairSimulation(toSim[i]);
      if ((i + 1) % 50 === 0) await this.appendProgress(run.id, 'sim_progress', `Simulated ${i + 1}/${toSim.length} candidates`);
    }
    await this.throwIfCancelled(run.id);
    allCandidates.sort((x, y) => {
      const sx = Number.isFinite(x.score) ? x.score : Number.NEGATIVE_INFINITY;
      const sy = Number.isFinite(y.score) ? y.score : Number.NEGATIVE_INFINITY;
      if (sy !== sx) return sy - sx;
      return (y.metrics.hurst ?? 0) - (x.metrics.hurst ?? 0);
    });
    const validCandidates = allCandidates.filter((c) => c.valid);
    await this.appendProgress(
      run.id,
      'candidates_evaluated',
      `Candidates evaluation finished: total=${allCandidates.length}, valid=${validCandidates.length}, top_valid_score=${validCandidates[0] ? validCandidates[0].score : 'none'}`
    );

    const { data: currentRows } = await supabase.from('strategy_pairs').select('*').eq('is_active', true);
    const current = (currentRows || []) as StrategyPairRow[];
    const bySymbol = new Map(allCandidates.map((c) => [c.pair_symbol, c]));
    const livePf = await this.loadLivePfMap();
    const openLocked = await this.loadOpenPositionPairs();
    const basket: BasketSlot[] = current.map((row) => {
      const c = bySymbol.get(row.pair_symbol);
      const live = livePf.get(row.pair_symbol);
      let score = c?.score ?? Number.NEGATIVE_INFINITY;
      if (live && live.trades >= CONFIG.liveDemotionMinTrades && live.pf < CONFIG.liveDemotionPf) score = 0;
      if (c && live) {
        c.metrics.live_pf_30d = live.pf;
        c.metrics.live_trades_30d = live.trades;
      }
      return {
        pairSymbol: row.pair_symbol,
        longCoin: row.long_coin,
        shortCoin: row.short_coin,
        score,
        isIncumbent: true,
        metrics: c?.metrics ?? null,
        ratioRets: c?.ratioRets ?? [],
      };
    });
    const replacements = this.planRotation(basket, validCandidates, openLocked);
    const settings = await this.getEngineSettings();
    let applied = false;
    await this.throwIfCancelled(run.id);
    if (settings.auto_rotation_enabled && !this.isInCooldown(settings.last_rotation_applied_at) && replacements.length > 0) {
      await this.applyRotation(run, basket, replacements, bySymbol);
      applied = true;
    } else if (settings.auto_rotation_enabled && this.isInCooldown(settings.last_rotation_applied_at)) {
      await this.appendProgress(run.id, 'rotation_cooldown', 'Rotation cooldown active');
    }

    await this.throwIfCancelled(run.id);
    await this.refreshActivePairScores(bySymbol);
    const candidatesJson = this.buildCandidatesJson(allCandidates, current);
    return { universeSize: coins.length, validCount: validCandidates.length, candidatesJson, applied, replacements };
  }

  private async buildUniverse(binance: any, okx: any, bybit: any, tickers: any, runId: string) {
    const excluded = new Set([...EXCLUDED_BASES, ...CONFIG.universeBlacklist]);
    const base: Array<{ coin: string; binanceSymbol: string; quoteVolumeUsd: number; spreadPct: number; fundingMean8h: number; fundingAbsMax8h: number }> = [];
    const ranked: Array<{ coin: string; binanceSymbol: string; quoteVolumeUsd: number }> = [];
    for (const symbol of Object.keys(binance.markets)) {
      const m = binance.markets[symbol];
      if (!m || !m.swap || !m.linear || m.quote !== 'USDT' || m.settle !== 'USDT' || m.active === false) continue;
      const coin = String(m.base || '').toUpperCase();
      if (!coin || excluded.has(coin)) continue;
      if (!okx.markets[getExchangeSymbol(coin, 'okx')] || !bybit.markets[getExchangeSymbol(coin, 'bybit')]) continue;
      const quoteVolumeUsd = Number(tickers[symbol]?.quoteVolume ?? 0);
      if (!Number.isFinite(quoteVolumeUsd) || quoteVolumeUsd < CONFIG.minLegVolumeUsd) continue;
      const onboard = Number(m.info?.onboardDate ?? 0);
      if (onboard > 0 && (Date.now() - onboard) / 86400000 < CONFIG.minListingAgeDays) continue;
      ranked.push({ coin, binanceSymbol: symbol, quoteVolumeUsd });
    }
    ranked.sort((a, b) => b.quoteVolumeUsd - a.quoteVolumeUsd);
    const shortlist = ranked.slice(0, CONFIG.universeSize * 3);
    await this.appendProgress(runId, 'universe_spread', `Spread filtering ${shortlist.length} symbols`);
    for (const item of shortlist) {
      await this.throwIfCancelled(runId);
      const ob = await binance.fetchOrderBook(item.binanceSymbol, 5).catch(() => null);
      const bid = Number(ob?.bids?.[0]?.[0] ?? 0);
      const ask = Number(ob?.asks?.[0]?.[0] ?? 0);
      const mid = (ask + bid) / 2;
      const spreadPct = mid > 0 ? ((ask - bid) / mid) * 100 : 999;
      if (spreadPct > CONFIG.maxSpreadPct) continue;
      const fr = await binance.fetchFundingRateHistory(item.binanceSymbol, Date.now() - 30 * 86400000, 200).catch(() => []);
      const arr = (fr || []).map((r: any) => Number(r.fundingRate)).filter((x: number) => Number.isFinite(x));
      if (arr.length < 40) continue;
      const fundingMean8h = mean(arr);
      const fundingAbsMax8h = Math.max(...arr.map((x: number) => Math.abs(x)));
      if (Math.abs(fundingMean8h) * 100 > CONFIG.maxFundingMean8hPct) continue;
      if (fundingAbsMax8h * 100 > CONFIG.maxFundingAbsMax8hPct) continue;
      base.push({ ...item, spreadPct, fundingMean8h, fundingAbsMax8h });
      if (base.length >= CONFIG.universeSize) break;
    }
    await this.appendProgress(runId, 'universe_funding_hist', `Universe after funding history filter: ${base.length}`);
    return base;
  }

  private async fetch4hBars(binance: any, symbol: string, runId?: string) {
    const now = Date.now();
    const since = now - (BARS_REQUIRED + 80) * FOUR_H_MS;
    const all: number[][] = [];
    let cursor = since;
    for (let page = 0; page < 4; page++) {
      if (runId) await this.throwIfCancelled(runId);
      const batch: number[][] = await binance.fetchOHLCV(symbol, '4h', cursor, 500).catch(() => []);
      if (!batch.length) break;
      all.push(...batch);
      if (batch.length < 500) break;
      cursor = batch[batch.length - 1][0] + 1;
    }
    const closed = all.filter((k) => k[0] + FOUR_H_MS <= now);
    if (closed.length < BARS_REQUIRED) return null;
    const window = closed.slice(-BARS_REQUIRED);
    const closesByTs = new Map<number, number>();
    const ohlcByTs = new Map<number, OhlcPoint>();
    for (const k of window) {
      const o = Number(k[1]); const h = Number(k[2]); const l = Number(k[3]); const c = Number(k[4]);
      if (o > 0 && h > 0 && l > 0 && c > 0) {
        closesByTs.set(k[0], c);
        ohlcByTs.set(k[0], { open: o, high: h, low: l, close: c });
      }
    }
    const retsByTs = new Map<number, number>();
    for (const [ts, close] of closesByTs) {
      const prev = closesByTs.get(ts - FOUR_H_MS);
      if (prev && prev > 0) retsByTs.set(ts, Math.log(close / prev));
    }
    return { closesByTs, ohlcByTs, retsByTs };
  }

  private computeBeta(coinRets: Map<number, number>, btcRets: Map<number, number>): number {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [ts, r] of coinRets) {
      const rb = btcRets.get(ts);
      if (rb !== undefined) { xs.push(rb); ys.push(r); }
    }
    if (xs.length < 60) return NaN;
    const mx = mean(xs);
    const my = mean(ys);
    let cov = 0;
    let varx = 0;
    for (let i = 0; i < xs.length; i++) {
      cov += (xs[i] - mx) * (ys[i] - my);
      varx += (xs[i] - mx) ** 2;
    }
    return varx > 0 ? cov / varx : NaN;
  }

  private evaluatePairStructure(a: CoinData, b: CoinData): Candidate | null {
    const commonTs: number[] = [];
    for (const ts of a.retsByTs.keys()) if (b.retsByTs.has(ts)) commonTs.push(ts);
    if (commonTs.length < MIN_RET_SAMPLES) return null;
    commonTs.sort((x, y) => x - y);
    const retsA: number[] = [];
    const retsB: number[] = [];
    const ratioRets: number[] = [];
    const ratioCloses: number[] = [];
    const ratioBars: RatioBar[] = [];
    for (const ts of commonTs) {
      const ra = a.retsByTs.get(ts)!;
      const rb = b.retsByTs.get(ts)!;
      const ao = a.ohlcByTs.get(ts);
      const bo = b.ohlcByTs.get(ts);
      if (!ao || !bo || bo.open <= 0 || bo.high <= 0 || bo.low <= 0 || bo.close <= 0) continue;
      retsA.push(ra);
      retsB.push(rb);
      ratioRets.push(ra - rb);
      const close = ao.close / bo.close;
      const open = ao.open / bo.open;
      const high = Math.max(open, close, Math.min(ao.high / bo.low, open * 1.05));
      const low = Math.min(open, close, Math.max(ao.low / bo.high, open * 0.95));
      ratioBars.push({ ts, open, high, low, close });
      ratioCloses.push(close);
    }
    if (ratioRets.length < MIN_RET_SAMPLES || ratioBars.length < 850) return null;
    const n = ratioRets.length;
    const mu = mean(ratioRets);
    const sigma = std(ratioRets, mu);
    const tStat = sigma > 0 ? mu / (sigma / Math.sqrt(n)) : 0;
    const chunk = Math.floor(n / 3);
    const driftW1 = mean(ratioRets.slice(0, chunk));
    const driftW2 = mean(ratioRets.slice(chunk, 2 * chunk));
    const driftW3 = mean(ratioRets.slice(2 * chunk));
    const corr = correlation(retsA, retsB);
    const betaDiff = Number.isFinite(a.betaVsBtc) && Number.isFinite(b.betaVsBtc) ? Math.abs(a.betaVsBtc - b.betaVsBtc) : Number.POSITIVE_INFINITY;
    const fundingCostPct8h = (a.fundingMean8h - b.fundingMean8h) * 100;
    const fundingPenalty = Math.max(0, fundingCostPct8h) / MAX_FUNDING_COST_PCT_8H;
    const emaLast = ema(ratioCloses, 10).at(-1) ?? NaN;
    const inTrend = Number.isFinite(emaLast) && ratioCloses[ratioCloses.length - 1] > emaLast;
    const hurst = hurstRS(ratioRets);
    const acSum = autocorr(ratioRets, 1) + autocorr(ratioRets, 2) + autocorr(ratioRets, 3);

    const positiveWindows = [driftW1, driftW2, driftW3].filter((d) => d > 0).length;
    const reasons: string[] = [];
    if (positiveWindows < CONFIG.minStabilityWindows) reasons.push('stability_3w');
    if (corr < CONFIG.minLegCorrelation) reasons.push('correlation');
    if (!(betaDiff <= CONFIG.maxBetaDiff)) reasons.push('beta');
    if (CONFIG.requireInTrend && !inTrend) reasons.push('not_in_trend');
    if (hurst <= CONFIG.minHurst) reasons.push('hurst');
    if (CONFIG.requireAutocorr && acSum <= 0) reasons.push('autocorr');

    const metrics: CandidateMetrics = {
      t_stat: tStat,
      drift_w1: driftW1,
      drift_w2: driftW2,
      drift_w3: driftW3,
      corr,
      beta_long: Number.isFinite(a.betaVsBtc) ? Number(a.betaVsBtc.toFixed(4)) : NaN,
      beta_short: Number.isFinite(b.betaVsBtc) ? Number(b.betaVsBtc.toFixed(4)) : NaN,
      beta_diff: betaDiff,
      funding_long: a.fundingMean8h,
      funding_short: b.fundingMean8h,
      funding_cost_pct_8h: fundingCostPct8h,
      funding_penalty: Number(fundingPenalty.toFixed(4)),
      vol_long_usd_24h: Math.round(a.quoteVolumeUsd),
      vol_short_usd_24h: Math.round(b.quoteVolumeUsd),
      spread_long_pct: Number(a.spreadPct.toFixed(5)),
      spread_short_pct: Number(b.spreadPct.toFixed(5)),
      funding_mean_long_8h: Number((a.fundingMean8h * 100).toFixed(5)),
      funding_mean_short_8h: Number((b.fundingMean8h * 100).toFixed(5)),
      in_trend: inTrend,
      hurst: Number(hurst.toFixed(4)),
      autocorr_1_3: Number(acSum.toFixed(4)),
      samples: n,
      sim_insample: emptySim(),
      sim_oos: emptySim(),
    };

    return {
      id: '',
      pair_symbol: `${a.coin}/${b.coin}`,
      long_coin: a.coin,
      short_coin: b.coin,
      score: Number.NEGATIVE_INFINITY,
      valid: false,
      reject_reasons: reasons,
      metrics,
      ratioRets,
      ratioBars,
      activated_at: '',
      deactivated_at: null,
      run_id: null,
      is_active: false,
    };
  }

  private evaluatePairSimulation(c: Candidate) {
    if (c.ratioBars.length < 850) {
      c.reject_reasons.push('sim_window');
      return;
    }
    const total = c.ratioBars.length;
    const oosBars = Math.min(CONFIG.simOosDays * 6, total - 200);
    const insampleBars = Math.min(CONFIG.simInsampleDays * 6, total - oosBars);
    const inSampleSlice = c.ratioBars.slice(total - oosBars - insampleBars, total - oosBars);
    const oosSlice = c.ratioBars.slice(total - oosBars);
    const params = {
      leverage: CONFIG.defaultLeverage,
      emaSpan: 10,
      slAtrMult: CONFIG.slAtrMult,
      slMaxMarginPct: CONFIG.slMaxMarginPct,
      tpDisabled: CONFIG.tpDisabled,
      takeProfitPct: CONFIG.takeProfitPct,
      stopLossPct: CONFIG.stopLossPct,
      trailingActive: CONFIG.trailingActive,
      trailingActivationPct: CONFIG.trailingActivationPct,
      trailingDeltaPct: CONFIG.trailingDeltaPct,
      takerFeePct: CONFIG.takerFeePct,
      simSlippagePct: CONFIG.simSlippagePct,
      fundingLong8h: c.metrics.funding_long,
      fundingShort8h: c.metrics.funding_short,
    };
    c.metrics.sim_insample = simulatePairEngine(inSampleSlice, params);
    c.metrics.sim_oos = simulatePairEngine(oosSlice, params);
    if (c.metrics.sim_insample.trades < CONFIG.simMinTrades) c.reject_reasons.push('sim_trades');
    if (c.metrics.sim_insample.profitFactor < CONFIG.simMinProfitFactor) c.reject_reasons.push('sim_pf');
    if (c.metrics.sim_insample.slShare > CONFIG.simMaxSlShare) c.reject_reasons.push('sim_sl_share');
    if (c.metrics.sim_oos.trades >= 6 && (c.metrics.sim_oos.profitFactor < 0.70 && c.metrics.sim_oos.netPnlPct < -30)) {
      c.reject_reasons.push('oos_pf');
    }
    c.reject_reasons = Array.from(new Set(c.reject_reasons));
    c.valid = c.reject_reasons.length === 0;
    const score =
      c.metrics.sim_insample.profitFactor *
      Math.sqrt(Math.max(c.metrics.sim_insample.trades, 1)) *
      (1 - c.metrics.funding_penalty) *
      getSectorAffinityMultiplier(c.long_coin, c.short_coin);
    c.score = Number.isFinite(score) ? Number(score.toFixed(6)) : Number.NEGATIVE_INFINITY;
    if (!c.valid && c.score > 0) {
      // Small penalty multiplier instead of inverting to negative so near-misses remain visible and rankable
      c.score = Number((c.score * 0.1).toFixed(6));
    }
  }

  private async loadOpenPositionPairs() {
    const { data } = await supabase.from('bot_positions').select('pair_symbol').in('status', ['open', 'closing']);
    return new Set((data || []).map((r: any) => String(r.pair_symbol)));
  }

  private async loadLivePfMap() {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data } = await supabase
      .from('bot_positions')
      .select('pair_symbol, realized_pnl_usd')
      .eq('is_master', true)
      .eq('status', 'closed')
      .gte('closed_at', since);
    const raw = new Map<string, { wins: number; losses: number; trades: number }>();
    for (const row of data || []) {
      const pair = String((row as any).pair_symbol);
      const pnl = Number((row as any).realized_pnl_usd || 0);
      const cur = raw.get(pair) || { wins: 0, losses: 0, trades: 0 };
      cur.trades += 1;
      if (pnl >= 0) cur.wins += pnl;
      else cur.losses += Math.abs(pnl);
      raw.set(pair, cur);
    }
    const out = new Map<string, { trades: number; pf: number }>();
    for (const [pair, v] of raw) out.set(pair, { trades: v.trades, pf: v.losses > 0 ? v.wins / v.losses : 99 });
    return out;
  }

  private planRotation(basket: BasketSlot[], validCandidates: Candidate[], openLocked: Set<string>): Replacement[] {
    const replacements: Replacement[] = [];
    const roundTripFeePct = CONFIG.takerFeePct * 4 * CONFIG.defaultLeverage + CONFIG.simSlippagePct * 4 * CONFIG.defaultLeverage;
    const coinsInUse = (slots: BasketSlot[]) => {
      const s = new Set<string>();
      for (const slot of slots) {
        s.add(slot.longCoin);
        s.add(slot.shortCoin);
      }
      return s;
    };
    const maxCorr = (cand: Candidate, slots: BasketSlot[]) => {
      let max = 0;
      for (const slot of slots) {
        if (!cand.ratioRets.length || !slot.ratioRets.length) continue;
        max = Math.max(max, Math.abs(correlation(cand.ratioRets, slot.ratioRets)));
      }
      return max;
    };

    for (const cand of validCandidates) {
      if (basket.some((b) => b.pairSymbol === cand.pair_symbol)) continue;
      if (basket.length < BASKET_SIZE) {
        const used = coinsInUse(basket);
        if (used.has(cand.long_coin) || used.has(cand.short_coin)) continue;
        const corrMax = maxCorr(cand, basket);
        if (corrMax > CONFIG.basketMaxRatioCorr) continue;
        cand.metrics.basket_corr_max = Number(corrMax.toFixed(4));
        basket.push({
          pairSymbol: cand.pair_symbol,
          longCoin: cand.long_coin,
          shortCoin: cand.short_coin,
          score: cand.score,
          isIncumbent: false,
          metrics: cand.metrics,
          ratioRets: cand.ratioRets,
        });
        replacements.push({ removed: null, added: cand.pair_symbol, old_score: null, new_score: Number(cand.score.toFixed(4)) });
        continue;
      }
      if (replacements.filter((r) => r.removed !== null).length >= CONFIG.rotationMaxReplacements) break;
      const incumbents = basket.filter((b) => b.isIncumbent).sort((x, y) => x.score - y.score);
      for (const inc of incumbents) {
        if (openLocked.has(inc.pairSymbol)) continue;
        const rest = basket.filter((s) => s !== inc);
        const used = coinsInUse(rest);
        if (used.has(cand.long_coin) || used.has(cand.short_coin)) continue;
        const corrMax = maxCorr(cand, rest);
        if (corrMax > CONFIG.basketMaxRatioCorr) continue;
        const passHysteresis = inc.score <= 0 ? cand.score > 0 : cand.score >= CONFIG.rotationHysteresis * inc.score;
        if (!passHysteresis) break;
        const incNet = inc.metrics?.sim_insample.netPnlPct ?? 0;
        const candNet = cand.metrics.sim_insample.netPnlPct;
        if (candNet - incNet < 2 * roundTripFeePct) continue;
        cand.metrics.basket_corr_max = Number(corrMax.toFixed(4));
        const idx = basket.indexOf(inc);
        basket[idx] = {
          pairSymbol: cand.pair_symbol,
          longCoin: cand.long_coin,
          shortCoin: cand.short_coin,
          score: cand.score,
          isIncumbent: false,
          metrics: cand.metrics,
          ratioRets: cand.ratioRets,
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

  private async getEngineSettings() {
    const { data } = await supabase
      .from('engine_settings')
      .select('auto_rotation_enabled,last_rotation_applied_at')
      .eq('id', 1)
      .maybeSingle();
    return {
      auto_rotation_enabled: Boolean(data?.auto_rotation_enabled),
      last_rotation_applied_at: data?.last_rotation_applied_at || null,
    };
  }

  private isInCooldown(lastRotationAppliedAt: string | null) {
    if (!lastRotationAppliedAt) return false;
    const ts = new Date(lastRotationAppliedAt).getTime();
    return Number.isFinite(ts) && Date.now() - ts < CONFIG.rotationMinIntervalDays * 86400000;
  }

  private async applyRotation(run: PairSelectionRun, finalBasket: BasketSlot[], replacements: Replacement[], candidateBySymbol: Map<string, Candidate>) {
    const nowIso = new Date().toISOString();
    const removedSymbols = replacements.map((r) => r.removed).filter((s): s is string => Boolean(s));
    if (removedSymbols.length > 0) {
      await supabase.from('strategy_pairs').update({ is_active: false, deactivated_at: nowIso }).in('pair_symbol', removedSymbols).eq('is_active', true);
    }
    const addedSymbols = new Set(replacements.map((r) => r.added));
    const inserts = finalBasket.filter((b) => addedSymbols.has(b.pairSymbol)).map((b) => ({
      pair_symbol: b.pairSymbol,
      long_coin: b.longCoin,
      short_coin: b.shortCoin,
      score: Number.isFinite(b.score) ? Number(b.score.toFixed(4)) : null,
      metrics: b.metrics,
      run_id: run.id,
      is_active: true,
      activated_at: nowIso,
    }));
    if (inserts.length > 0) await supabase.from('strategy_pairs').insert(inserts);
    for (const slot of finalBasket) {
      if (addedSymbols.has(slot.pairSymbol) || !slot.metrics) continue;
      const c = candidateBySymbol.get(slot.pairSymbol);
      if (!c) continue;
      await supabase.from('strategy_pairs').update({ score: Number(c.score.toFixed(4)), metrics: c.metrics }).eq('pair_symbol', slot.pairSymbol).eq('is_active', true);
    }
    await supabase.from('engine_settings').update({ last_rotation_applied_at: nowIso, updated_at: nowIso }).eq('id', 1);
    await supabase.from('audit_logs').insert({
      user_id: run.requested_by ?? null,
      action: 'pair_rotation_applied',
      details: { run_id: run.id, trigger_source: run.trigger_source, replacements },
    });
    await pairRegistry.refresh();
  }

  private async refreshActivePairScores(candidateBySymbol: Map<string, Candidate>) {
    const { data } = await supabase.from('strategy_pairs').select('id,pair_symbol').eq('is_active', true);
    for (const row of data || []) {
      const c = candidateBySymbol.get((row as any).pair_symbol);
      if (!c) continue;
      await supabase.from('strategy_pairs').update({ score: Number(c.score.toFixed(6)), metrics: c.metrics }).eq('id', (row as any).id);
    }
  }

  private buildCandidatesJson(candidates: Candidate[], current: StrategyPairRow[]) {
    // Put valid candidates first (sorted by score descending), then remaining candidates
    const sorted = [...candidates].sort((x, y) => {
      if (x.valid !== y.valid) return x.valid ? -1 : 1;
      const sx = Number.isFinite(x.score) ? x.score : Number.NEGATIVE_INFINITY;
      const sy = Number.isFinite(y.score) ? y.score : Number.NEGATIVE_INFINITY;
      return sy - sx;
    });

    const top = sorted.slice(0, CANDIDATES_STORED).map((c) => ({
      pair_symbol: c.pair_symbol,
      long_coin: c.long_coin,
      short_coin: c.short_coin,
      score: Number.isFinite(c.score) ? Number(c.score.toFixed(4)) : null,
      valid: c.valid,
      reject_reasons: c.reject_reasons,
      metrics: c.metrics,
    }));
    const seen = new Set(top.map((x) => x.pair_symbol));
    const by = new Map(candidates.map((c) => [c.pair_symbol, c]));
    for (const row of current) {
      if (seen.has(row.pair_symbol)) continue;
      const c = by.get(row.pair_symbol);
      if (!c) continue;
      top.push({
        pair_symbol: c.pair_symbol,
        long_coin: c.long_coin,
        short_coin: c.short_coin,
        score: Number.isFinite(c.score) ? Number(c.score.toFixed(4)) : null,
        valid: c.valid,
        reject_reasons: c.reject_reasons,
        metrics: c.metrics,
      });
    }
    return top;
  }

  public start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => console.error('Pair selection tick error:', err.message));
    }, this.intervalMs);
  }

  public stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
