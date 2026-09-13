'use client';

import React from 'react';
import { Radar, ArrowUpRight, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { signalPriceDecimals } from '@/lib/signals';

export interface StrategyCombinedCardProps {
  strategy: any;
  liveState: any;
  isTradingOn: boolean;
  hideDetailsLink?: boolean;
}

export function StrategyCombinedCard({
  strategy,
  liveState,
  isTradingOn,
  hideDetailsLink = true,
}: StrategyCombinedCardProps) {
  const { t } = useLanguage();

  const config = strategy?.config || {
    drop_pct: 15,
    window_minutes: 1440,
    tp_pct: 4,
    sl_pct: 30,
  };

  const readiness = Number(liveState?.readiness_pct || 0);
  const dropPct = Number(liveState?.drop_pct || 0);
  const symbol = (strategy?.symbol || 'XRP').toUpperCase();
  const leverage = strategy?.leverage ? Number(strategy.leverage) : 3.0;

  const clampedReadiness = Math.min(100, Math.max(0, readiness));

  const getReadinessTone = (r: number) => {
    if (r >= 90) {
      return {
        text: 'text-rose-400',
        track: 'border-rose-500/25 bg-rose-500/5',
        fill: 'from-rose-600 via-rose-400 to-amber-300',
        glow: 'shadow-[0_0_14px_rgba(244,63,94,0.55)]',
        pulse: true,
      };
    }
    if (r >= 80) {
      return {
        text: 'text-amber-300',
        track: 'border-amber-500/25 bg-amber-500/5',
        fill: 'from-amber-600 via-amber-400 to-honey-300',
        glow: 'shadow-[0_0_12px_rgba(251,191,36,0.45)]',
        pulse: false,
      };
    }
    if (r >= 50) {
      return {
        text: 'text-honey-400',
        track: 'border-honey-500/20 bg-honey-500/5',
        fill: 'from-honey-600 via-honey-500 to-amber-300',
        glow: 'shadow-[0_0_10px_rgba(245,158,11,0.35)]',
        pulse: false,
      };
    }
    return {
      text: 'text-sky-400',
      track: 'border-sky-500/15 bg-sky-500/5',
      fill: 'from-sky-700 via-sky-500 to-cyan-300',
      glow: 'shadow-[0_0_8px_rgba(56,189,248,0.3)]',
      pulse: false,
    };
  };

  const tone = getReadinessTone(readiness);

  const getStatusBadge = () => {
    if (liveState?.state === 'in_position') {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-honey-500/15 text-honey-400 border border-honey-500/30 flex items-center gap-1.5 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-honey-400 animate-ping" />
          {t('signals.statusInPosition')}
        </span>
      );
    }
    if (readiness >= 100) {
      return (
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 animate-pulse shrink-0">
          {t('signals.statusFired')}
        </span>
      );
    }
    return (
      <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-dark-800 text-slate-400 border border-dark-700 shrink-0">
        {t('signals.statusWaiting')}
      </span>
    );
  };

  const windowLabel =
    config.window_minutes < 60
      ? `${config.window_minutes}m`
      : config.window_minutes === 60
      ? '1h'
      : `${Math.round(config.window_minutes / 60)}h`;

  return (
    <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-xl hover:border-dark-700 transition-all relative overflow-hidden group space-y-4">
      {/* Background glow */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-honey-500/5 rounded-full blur-3xl pointer-events-none group-hover:bg-honey-500/10 transition-colors" />

      {/* Header */}
      <div className="flex items-center justify-between gap-3 relative z-10">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-9 h-9 rounded-xl bg-honey-500/15 border border-honey-500/30 flex items-center justify-center text-honey-400 shadow-md shrink-0">
            <Radar className="w-4 h-4 animate-pulse" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white tracking-tight truncate">
                {strategy?.name || `${symbol} Dip-Buy`}
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-honey-500/15 text-honey-400 border border-honey-500/30 shrink-0">
                {leverage}x Isolated
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono truncate mt-0.5">
              {symbol}/USDT • Trigger: Drop ≥ {config.drop_pct}% / {windowLabel} • TP +{config.tp_pct}% • SL -{config.sl_pct}%
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
          {getStatusBadge()}
          {!hideDetailsLink && (
            <Link
              href="/signals"
              className="text-xs text-honey-400 hover:text-honey-300 font-mono font-semibold flex items-center gap-0.5 bg-honey-500/10 hover:bg-honey-500/20 px-2.5 py-1 rounded-lg border border-honey-500/25 transition-all"
            >
              {t('signals.viewDetails')}
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
      </div>

      {/* 4 Strategy Parameter Badges */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 relative z-10">
        <div className="bg-dark-950/80 border border-dark-800 p-2 rounded-lg">
          <span className="text-[9px] text-slate-500 uppercase font-mono block">Trigger</span>
          <span className="text-xs font-bold font-mono text-white">Drop ≥ {config.drop_pct}%</span>
        </div>

        <div className="bg-dark-950/80 border border-dark-800 p-2 rounded-lg">
          <span className="text-[9px] text-slate-500 uppercase font-mono block">Window</span>
          <span className="text-xs font-bold font-mono text-slate-300">
            {config.window_minutes < 60
              ? `${config.window_minutes} Min (${config.window_minutes}m)`
              : config.window_minutes === 60
              ? '1 Hour (60m)'
              : `${Math.round(config.window_minutes / 60)} Hours (${config.window_minutes}m)`}
          </span>
        </div>

        <div className="bg-dark-950/80 border border-dark-800 p-2 rounded-lg">
          <span className="text-[9px] text-slate-500 uppercase font-mono block">Take-Profit</span>
          <span className="text-xs font-bold font-mono text-emerald-400">+{config.tp_pct}%</span>
        </div>

        <div className="bg-dark-950/80 border border-dark-800 p-2 rounded-lg">
          <span className="text-[9px] text-slate-500 uppercase font-mono block">Stop-Loss</span>
          <span className="text-xs font-bold font-mono text-rose-400">-{config.sl_pct}%</span>
        </div>
      </div>

      {/* Live Market Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 relative z-10">
        <div className="bg-dark-950/70 border border-dark-800/80 rounded-xl p-2.5">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-mono">
            {t('signals.currentPrice')}
          </span>
          <span className="text-sm font-bold font-mono text-white">
            ${liveState?.price > 0 ? liveState.price.toFixed(signalPriceDecimals(symbol)) : '---'}
          </span>
        </div>

        <div className="bg-dark-950/70 border border-dark-800/80 rounded-xl p-2.5">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-mono">
            {windowLabel} High
          </span>
          <span className="text-sm font-bold font-mono text-slate-300">
            ${liveState?.rolling_max > 0 ? liveState.rolling_max.toFixed(signalPriceDecimals(symbol)) : '---'}
          </span>
        </div>

        <div className="bg-dark-950/70 border border-dark-800/80 rounded-xl p-2.5">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-mono">
            Drop ({windowLabel})
          </span>
          <span className={`text-sm font-bold font-mono ${dropPct >= config.drop_pct * 0.7 ? 'text-rose-400' : 'text-slate-200'}`}>
            -{dropPct.toFixed(2)}%{' '}
            <span className="text-[10px] text-slate-500 font-normal">
              / {config.drop_pct}%
            </span>
          </span>
        </div>

        <div className="bg-dark-950/70 border border-dark-800/80 rounded-xl p-2.5 flex flex-col justify-between">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-mono">
            {t('signals.myTradingStatus')}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                isTradingOn ? 'bg-emerald-400 shadow-sm shadow-emerald-400' : 'bg-slate-600'
              }`}
            />
            <span className={`text-xs font-bold font-mono ${isTradingOn ? 'text-emerald-400' : 'text-slate-400'}`}>
              {isTradingOn ? t('signals.on') : t('signals.off')}
            </span>
          </span>
        </div>
      </div>

      {/* Progress Bar & Readiness */}
      <div className={`relative z-10 rounded-xl border p-3 space-y-2.5 ${tone.track}`}>
        <div className="flex justify-between items-center gap-3">
          <span className="text-xs font-mono text-slate-300 flex items-center gap-1.5">
            <span className="relative flex h-5 w-5 items-center justify-center rounded-md bg-dark-950/70 border border-dark-700/80">
              <Sparkles className={`w-3 h-3 ${tone.text} ${tone.pulse ? 'animate-pulse' : ''}`} />
            </span>
            {t('signals.readiness')}
          </span>
          <span
            className={`font-mono text-sm font-black tracking-tight tabular-nums ${tone.text} ${
              tone.pulse ? 'animate-pulse' : ''
            }`}
          >
            {clampedReadiness.toFixed(1)}%
          </span>
        </div>

        <div className="relative h-3 w-full rounded-full bg-dark-950/90 border border-dark-800/90 overflow-hidden shadow-inner">
          {/* Soft track sheen */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.03] to-transparent pointer-events-none" />

          {/* Threshold markers */}
          <div className="absolute inset-y-0 left-[80%] w-px bg-amber-400/25 pointer-events-none" />
          <div className="absolute inset-y-0 left-[90%] w-px bg-rose-400/30 pointer-events-none" />

          <div
            className={`relative h-full rounded-full bg-gradient-to-r ${tone.fill} ${tone.glow} transition-all duration-700 ease-out ${
              tone.pulse ? 'animate-pulse' : ''
            }`}
            style={{ width: `${clampedReadiness}%` }}
          >
            {/* Leading edge highlight */}
            <div className="absolute inset-y-0 right-0 w-4 bg-gradient-to-l from-white/35 to-transparent rounded-full" />
          </div>
        </div>

        <div className="flex justify-between text-[9px] font-mono text-slate-600 px-0.5">
          <span>0%</span>
          <span className="text-amber-500/50">80%</span>
          <span className="text-rose-500/50">90%</span>
          <span>100%</span>
        </div>
      </div>
    </div>
  );
}
