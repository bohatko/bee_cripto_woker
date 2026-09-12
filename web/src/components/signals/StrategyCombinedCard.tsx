'use client';

import React from 'react';
import { Radar, ArrowUpRight, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useLanguage } from '@/lib/i18n/LanguageContext';

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

  const getProgressColor = (r: number) => {
    if (r >= 90) return 'bg-rose-500 shadow-rose-500/50 animate-pulse';
    if (r >= 80) return 'bg-amber-400 shadow-amber-400/50';
    if (r >= 50) return 'bg-honey-500 shadow-honey-500/30';
    return 'bg-slate-500';
  };

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
            ${liveState?.price > 0 ? liveState.price.toFixed(symbol === 'ETH' ? 2 : 4) : '---'}
          </span>
        </div>

        <div className="bg-dark-950/70 border border-dark-800/80 rounded-xl p-2.5">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-mono">
            {windowLabel} High
          </span>
          <span className="text-sm font-bold font-mono text-slate-300">
            ${liveState?.rolling_max > 0 ? liveState.rolling_max.toFixed(symbol === 'ETH' ? 2 : 4) : '---'}
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
      <div className="space-y-1.5 relative z-10 pt-1">
        <div className="flex justify-between items-center text-xs font-mono">
          <span className="text-slate-400 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-honey-400" />
            {t('signals.readiness')}
          </span>
          <span className={`font-bold ${readiness >= 80 ? 'text-rose-400 font-mono text-sm' : 'text-honey-400'}`}>
            {readiness.toFixed(1)}%
          </span>
        </div>

        <div className="w-full bg-dark-950 h-2.5 rounded-full overflow-hidden p-0.5 border border-dark-800">
          <div
            className={`h-full rounded-full transition-all duration-500 shadow-sm ${getProgressColor(readiness)}`}
            style={{ width: `${Math.min(100, Math.max(0, readiness))}%` }}
          />
        </div>
      </div>
    </div>
  );
}
