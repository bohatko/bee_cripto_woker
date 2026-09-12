'use client';

import React from 'react';
import { Radar, ShieldAlert, Target, Zap, Clock } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface SignalStrategyHeaderProps {
  strategy: any;
}

export function SignalStrategyHeader({ strategy }: SignalStrategyHeaderProps) {
  const { t } = useLanguage();

  const config = strategy?.config || {
    drop_pct: 15,
    window_minutes: 1440,
    tp_pct: 4,
    sl_pct: 30,
    reference_margin_usd: 20000,
  };

  const liveState = strategy?.live_state || {
    price: 0,
    rolling_max: 0,
    drop_pct: 0,
    readiness_pct: 0,
    state: 'flat',
  };

  return (
    <div className="bg-gradient-to-r from-dark-900 via-dark-900 to-dark-950 border border-dark-800 rounded-2xl p-4 sm:p-5 shadow-xl relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 bg-honey-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="flex flex-col gap-4 relative z-10">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-honey-500/15 border border-honey-500/30 flex items-center justify-center text-honey-400 shadow-md">
              <Radar className="w-4 h-4 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white tracking-tight">
                  {strategy?.name || (strategy?.symbol ? `${strategy.symbol} Dip-Buy` : 'Dip-Buy')}
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-honey-500/15 text-honey-400 border border-honey-500/30">
                  {strategy?.leverage || 1.75}x Isolated
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                {strategy?.symbol === 'ETH'
                  ? `ETH Dip-Buy • Drop ≥ ${config.drop_pct}% / ${config.window_minutes}m • TP +${config.tp_pct}% • SL -${config.sl_pct}%`
                  : `XRP Dip-Buy • Drop ≥ ${config.drop_pct}% / 24h • TP +${config.tp_pct}% • SL -${config.sl_pct}%`}
              </p>
            </div>
          </div>
        </div>

        {/* Strategy Badges Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
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
      </div>
    </div>
  );
}
