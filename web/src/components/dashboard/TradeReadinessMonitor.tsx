'use client';

import React, { useState, useEffect } from 'react';
import {
  Compass,
  TrendingUp,
  Clock,
  Sparkles,
  Info,
  ChevronDown,
  ChevronUp,
  Zap,
  Layers,
  ArrowUpRight,
  ShieldCheck,
  AlertCircle,
  Play,
  CheckCircle2,
} from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface MarketDataRecord {
  pair_symbol: string;
  long_coin: string;
  short_coin: string;
  current_ratio: number | string;
  ema_10: number | string;
  is_in_trend: boolean;
  readiness_pct?: number | string;
  long_price: number | string;
  short_price: number | string;
  last_signal_at?: string;
  updated_at?: string;
}

export interface TradeReadinessMonitorProps {
  marketData: MarketDataRecord[];
  positions: any[];
  isBotActive: boolean;
  hasValidatedAccount: boolean;
  onStartBotClick?: () => void;
}

interface PairStrategyMeta {
  pairSymbol: string;
  longCoin: string;
  shortCoin: string;
  narrativeKey: 'narrativeZecAvax' | 'narrativeEnaSui' | 'narrativeSolAda' | 'narrativeBnbEth';
  sharePct: string;
}

const STRATEGY_META: PairStrategyMeta[] = [
  {
    pairSymbol: 'ZEC/AVAX',
    longCoin: 'ZEC',
    shortCoin: 'AVAX',
    narrativeKey: 'narrativeZecAvax',
    sharePct: '50.0',
  },
  {
    pairSymbol: 'ENA/SUI',
    longCoin: 'ENA',
    shortCoin: 'SUI',
    narrativeKey: 'narrativeEnaSui',
    sharePct: '31.9',
  },
  {
    pairSymbol: 'SOL/ADA',
    longCoin: 'SOL',
    shortCoin: 'ADA',
    narrativeKey: 'narrativeSolAda',
    sharePct: '11.6',
  },
  {
    pairSymbol: 'BNB/ETH',
    longCoin: 'BNB',
    shortCoin: 'ETH',
    narrativeKey: 'narrativeBnbEth',
    sharePct: '6.5',
  },
];

export function TradeReadinessMonitor({
  marketData,
  positions,
  isBotActive,
  hasValidatedAccount,
  onStartBotClick,
}: TradeReadinessMonitorProps) {
  const { t } = useLanguage();
  const [showFormulaInfo, setShowFormulaInfo] = useState(false);
  const [timeToNext4h, setTimeToNext4h] = useState<string>('--:--:--');

  // Real-time countdown to the next 4-hour candle close (00:00, 04:00, 08:00, 12:00, 16:00, 20:00 UTC)
  useEffect(() => {
    function updateCountdown() {
      const now = new Date();
      const currentUtcHours = now.getUTCHours();
      const currentUtcMinutes = now.getUTCMinutes();
      const currentUtcSeconds = now.getUTCSeconds();

      const nextPeriodHour = (Math.floor(currentUtcHours / 4) + 1) * 4;
      const hoursRemaining = nextPeriodHour - currentUtcHours - 1;
      const minutesRemaining = 59 - currentUtcMinutes;
      const secondsRemaining = 59 - currentUtcSeconds;

      const h = hoursRemaining.toString().padStart(2, '0');
      const m = minutesRemaining.toString().padStart(2, '0');
      const s = secondsRemaining.toString().padStart(2, '0');

      setTimeToNext4h(`${h}h ${m}m ${s}s`);
    }

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, []);

  // Map market data by pair_symbol
  const marketMap = new Map<string, MarketDataRecord>();
  marketData.forEach((m) => {
    marketMap.set(m.pair_symbol, m);
  });

  // Calculate detailed readiness metrics for all 4 pairs
  const evaluatedPairs = STRATEGY_META.map((meta) => {
    const data = marketMap.get(meta.pairSymbol);
    const openPos = positions.find(
      (p) => p.pair_symbol === meta.pairSymbol && p.status === 'open'
    );

    const currentRatio = data ? Number(data.current_ratio) : 0;
    const ema10 = data ? Number(data.ema_10) : 0;
    const isInTrend = Boolean(data?.is_in_trend);
    const longPrice = data ? Number(data.long_price) : 0;
    const shortPrice = data ? Number(data.short_price) : 0;

    // Distance to EMA10 in percentage: positive = above EMA, negative = below EMA
    const gapPct = ema10 > 0 ? ((currentRatio - ema10) / ema10) * 100 : 0;

    // Readiness calculation on 0-100% scale
    // If Ratio >= EMA10, readiness is 100% (entry threshold met)
    // If Ratio < EMA10, scale from 0% (at -3.0% gap) to 99% (at 0% gap)
    let readinessPct = 0;
    if (isInTrend || (currentRatio > 0 && ema10 > 0 && currentRatio >= ema10)) {
      readinessPct = 100;
    } else if (currentRatio > 0 && ema10 > 0) {
      const MAX_PULLBACK = 3.0; // 3% benchmark distance
      readinessPct = Math.max(
        0,
        Math.min(99, Math.round(100 + (gapPct / MAX_PULLBACK) * 100))
      );
    }

    return {
      meta,
      data,
      openPos,
      currentRatio,
      ema10,
      gapPct,
      readinessPct,
      isInTrend,
      longPrice,
      shortPrice,
      isOpen: !!openPos,
    };
  });

  // Determine the next upcoming or active trade
  const unenteredPairs = evaluatedPairs.filter((p) => !p.isOpen);
  const highestReadinessPair = unenteredPairs.reduce(
    (prev, current) =>
      current.readinessPct > (prev?.readinessPct ?? -1) ? current : prev,
    unenteredPairs[0]
  );

  const readyToEnterPairs = unenteredPairs.filter((p) => p.readinessPct >= 100);
  const openCount = evaluatedPairs.filter((p) => p.isOpen).length;

  return (
    <div className="bg-dark-900 border border-dark-800 rounded-2xl shadow-2xl p-5 sm:p-6 space-y-6">
      {/* Top Header Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-dark-800 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-honey-500/15 border border-honey-500/30 text-honey-400">
              <Compass className="w-5 h-5 animate-[spin_12s_linear_infinite]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-extrabold text-white tracking-tight">
                  {t('readiness.title')}
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-honey-500/10 text-honey-400 border border-honey-500/20 font-bold uppercase tracking-wider">
                  {t('readiness.scale')}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {t('readiness.subtitle')}{' '}
                <span className="text-honey-400 font-mono font-semibold">{t('readiness.rule')}</span> {t('readiness.ruleSuffix')}
              </p>
            </div>
          </div>
        </div>

        {/* Quick Highlights: Next Trade & 4h Candle Countdown */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Next Trade Highlight Pill */}
          <div className="bg-dark-950 border border-dark-800 px-3.5 py-2 rounded-xl flex items-center gap-2.5">
            <Zap className={`w-4 h-4 ${readyToEnterPairs.length > 0 ? 'text-emerald-400 animate-pulse' : 'text-honey-400'}`} />
            <div className="text-left font-mono">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                {readyToEnterPairs.length > 0 ? t('readiness.signalReady') : t('readiness.closestSetup')}
              </div>
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                {highestReadinessPair ? (
                  <>
                    <span>{highestReadinessPair.meta.pairSymbol}</span>
                    <span
                      className={`text-[11px] px-1.5 py-0.2 rounded ${
                        highestReadinessPair.readinessPct >= 100
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-honey-500/15 text-honey-400'
                      }`}
                    >
                      {highestReadinessPair.readinessPct}%
                    </span>
                  </>
                ) : (
                  <span className="text-emerald-400">{t('readiness.allSlots')}</span>
                )}
              </div>
            </div>
          </div>

          {/* 4H Candle Countdown Pill */}
          <div className="bg-dark-950 border border-dark-800 px-3.5 py-2 rounded-xl flex items-center gap-2.5">
            <Clock className="w-4 h-4 text-slate-400" />
            <div className="text-left font-mono">
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                {t('readiness.candleClose')}
              </div>
              <div className="text-xs font-bold text-slate-200" title="Candle close confirms 4h trend status">
                {timeToNext4h}
              </div>
            </div>
          </div>

          {/* Info Modal/Guide Trigger */}
          <button
            onClick={() => setShowFormulaInfo(!showFormulaInfo)}
            className="p-2 rounded-xl bg-dark-950 border border-dark-800 hover:border-honey-500/40 text-slate-400 hover:text-honey-400 transition-colors flex items-center gap-1.5 text-xs font-mono"
            title="How is Trade Readiness calculated?"
          >
            <Info className="w-4 h-4" />
            <span className="hidden sm:inline">{t('readiness.strategyFormula')}</span>
            {showFormulaInfo ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Expandable Strategy Formula Explanation */}
      {showFormulaInfo && (
        <div className="p-4 rounded-xl bg-dark-950/80 border border-honey-500/25 text-xs text-slate-300 space-y-3 animate-in fade-in duration-200">
          <div className="flex items-center gap-2 text-honey-400 font-bold">
            <Sparkles className="w-4 h-4" />
            <span>{t('readiness.howWorks')}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-[11px]">
            <div className="bg-dark-900/90 p-3 rounded-lg border border-dark-800">
              <span className="text-honey-400 font-bold">{t('readiness.ratioTitle')}</span>
              <p className="text-slate-400 mt-1">{t('readiness.ratioDesc')}</p>
            </div>
            <div className="bg-dark-900/90 p-3 rounded-lg border border-dark-800">
              <span className="text-emerald-400 font-bold">{t('readiness.entryTitle')}</span>
              <p className="text-slate-400 mt-1">{t('readiness.entryDesc')}</p>
            </div>
            <div className="bg-dark-900/90 p-3 rounded-lg border border-dark-800">
              <span className="text-amber-400 font-bold">{t('readiness.proximityTitle')}</span>
              <p className="text-slate-400 mt-1">{t('readiness.proximityDesc')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Quick Action Prompt if Signal Ready but Bot is Idle */}
      {readyToEnterPairs.length > 0 && !isBotActive && (
        <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
            <span className="text-emerald-300 font-medium">
              {t('readiness.pairsReady', { count: readyToEnterPairs.length })}
            </span>
          </div>
          {onStartBotClick && (
            <button
              onClick={onStartBotClick}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-dark-950 font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-md shadow-emerald-500/20 shrink-0"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              {t('readiness.startNow')}
            </button>
          )}
        </div>
      )}

      {/* 4 Strategy Pairs Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {evaluatedPairs.map((pair) => {
          const {
            meta,
            openPos,
            currentRatio,
            ema10,
            gapPct,
            readinessPct,
            isInTrend,
            longPrice,
            shortPrice,
            isOpen,
          } = pair;

          // Color themes based on state
          let badgeText = t('readiness.pctReady', { pct: readinessPct });
          let badgeBg = 'bg-honey-500/10 text-honey-400 border-honey-500/25';
          let barBg = 'from-amber-600 via-amber-500 to-yellow-400';
          let statusText = t('readiness.approaching');

          if (isOpen) {
            badgeText = t('readiness.inPosition');
            badgeBg = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
            barBg = 'from-emerald-600 to-teal-400';
            statusText = t('readiness.activeTrade');
          } else if (readinessPct >= 100 || isInTrend) {
            badgeText = t('readiness.signalActive');
            badgeBg = 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 animate-pulse';
            barBg = 'from-emerald-500 to-green-400';
            statusText = isBotActive ? t('readiness.readyAwaiting') : t('readiness.readyIdle');
          } else if (readinessPct < 80) {
            badgeText = t('readiness.accumulating', { pct: readinessPct });
            badgeBg = 'bg-dark-800 text-slate-400 border-dark-700';
            barBg = 'from-slate-700 via-slate-600 to-slate-500';
            statusText = t('readiness.consolidating');
          }

          const narrative = t(`readiness.${meta.narrativeKey}`);
          const shareOfProfit = t('readiness.shareOfAlpha', { pct: meta.sharePct });

          const fillWidth = isOpen ? 100 : readinessPct;

          return (
            <div
              key={meta.pairSymbol}
              className={`bg-dark-950 border rounded-2xl p-4 flex flex-col justify-between transition-all ${
                isOpen
                  ? 'border-emerald-500/40 shadow-lg shadow-emerald-500/5'
                  : readinessPct >= 100
                  ? 'border-emerald-500/30 bg-emerald-950/10'
                  : 'border-dark-800 hover:border-dark-700'
              }`}
            >
              <div>
                {/* Header: Pair Name & Status Badge */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-extrabold text-white text-base tracking-wide font-mono">
                        {meta.pairSymbol}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-1" title={narrative}>
                      {narrative}
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider shrink-0 ${badgeBg}`}
                  >
                    {badgeText}
                  </span>
                </div>

                {/* Subheader: Long / Short Leg Badges */}
                <div className="flex items-center gap-2 mt-2.5">
                  <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    LONG {meta.longCoin}
                  </span>
                  <span className="text-slate-600 text-xs">•</span>
                  <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    SHORT {meta.shortCoin}
                  </span>
                  <span className="text-[10px] font-mono text-slate-500 ml-auto">
                    {shareOfProfit}
                  </span>
                </div>

                {/* Progress Bar Section (The 100% Scale Readiness Metric) */}
                <div className="mt-4 pt-3 border-t border-dark-850">
                  <div className="flex items-baseline justify-between font-mono mb-1.5">
                    <span className="text-xs text-slate-400 font-medium">
                      {isOpen ? t('readiness.tradeStatus') : t('readiness.entryReadiness')}
                    </span>
                    <span
                      className={`text-sm font-black ${
                        isOpen
                          ? 'text-emerald-400'
                          : readinessPct >= 100
                          ? 'text-emerald-400'
                          : readinessPct >= 80
                          ? 'text-honey-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {isOpen ? t('readiness.inMarket') : `${readinessPct}%`}
                    </span>
                  </div>

                  {/* Visual Gauge Bar */}
                  <div className="w-full h-2.5 bg-dark-850 rounded-full overflow-hidden p-0.5 border border-dark-800 relative">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r transition-all duration-700 ease-out shadow-sm ${barBg}`}
                      style={{ width: `${Math.max(4, fillWidth)}%` }}
                    />
                  </div>

                  {/* Status Note & Gap Distance */}
                  <div className="mt-2 flex items-center justify-between text-[10px] font-mono">
                    <span className="text-slate-400 truncate max-w-[140px]" title={statusText}>
                      {statusText}
                    </span>
                    <span
                      className={`font-semibold shrink-0 ${
                        gapPct >= 0 ? 'text-emerald-400' : 'text-slate-400'
                      }`}
                    >
                      {isOpen
                        ? `PnL: ${Number(openPos.pnl_pct || 0) >= 0 ? '+' : ''}${Number(openPos.pnl_pct || 0).toFixed(2)}%`
                        : gapPct >= 0
                        ? t('readiness.aboveEma', { pct: gapPct.toFixed(2) })
                        : t('readiness.toEma', { pct: gapPct.toFixed(2) })}
                    </span>
                  </div>
                </div>

                {/* Ratio & EMA10 Technical Data */}
                <div className="mt-3.5 bg-dark-900/80 rounded-xl p-2.5 border border-dark-850 grid grid-cols-2 gap-2 text-[11px] font-mono">
                  <div>
                    <div className="text-[10px] text-slate-400 uppercase">Ratio</div>
                    <div className="text-white font-bold mt-0.5">
                      {currentRatio > 0 ? currentRatio.toFixed(4) : '--'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 uppercase">EMA 10 (4H)</div>
                    <div className="text-honey-400 font-bold mt-0.5">
                      {ema10 > 0 ? ema10.toFixed(4) : '--'}
                    </div>
                  </div>
                  <div className="col-span-2 pt-1.5 border-t border-dark-850 flex items-center justify-between text-[10px] text-slate-400">
                    <span>
                      {meta.longCoin}:{' '}
                      <span className="text-slate-300 font-semibold">
                        ${longPrice > 0 ? longPrice.toFixed(2) : '--'}
                      </span>
                    </span>
                    <span>
                      {meta.shortCoin}:{' '}
                      <span className="text-slate-300 font-semibold">
                        ${shortPrice > 0 ? shortPrice.toFixed(2) : '--'}
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Card Footer Note */}
              <div className="mt-3 pt-2 text-[10px] font-mono text-slate-400 flex items-center justify-between">
                <span>{t('readiness.slot')}</span>
                {isOpen ? (
                  <span className="text-emerald-400 font-semibold">{t('readiness.guarded')}</span>
                ) : readinessPct >= 100 ? (
                  <span className="text-emerald-400 font-semibold">{t('readiness.ready100')}</span>
                ) : (
                  <span>{t('readiness.waitingTrigger')}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
