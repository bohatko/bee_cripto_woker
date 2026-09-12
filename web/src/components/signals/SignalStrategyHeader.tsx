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
    <div className="bg-gradient-to-r from-dark-900 via-dark-900 to-dark-950 border border-dark-800 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 right-0 w-80 h-80 bg-honey-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-honey-500/15 border border-honey-500/30 flex items-center justify-center text-honey-400 shadow-lg shadow-honey-500/10">
              <Radar className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                  {strategy?.name || 'XRP Dip-Buy 24h'}
                </h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-honey-500/15 text-honey-400 border border-honey-500/30">
                  {strategy?.leverage || 3.0}x Isolated
                </span>
              </div>
              <p className="text-xs text-slate-400 max-w-xl">
                {strategy?.symbol === 'ETH'
                  ? 'Autonomous Dip-Buy engine on ETH with isolated 1.75x leverage, +2% Take Profit and -15% Stop Loss (1h window).'
                  : t('signals.subtitle')}
              </p>
            </div>
          </div>
        </div>

        {/* Strategy Badges Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="bg-dark-950/80 border border-dark-800 p-2.5 rounded-xl">
            <span className="text-[10px] text-slate-500 uppercase font-mono block">Trigger</span>
            <span className="text-xs font-bold font-mono text-white">Drop ≥ {config.drop_pct}%</span>
          </div>

          <div className="bg-dark-950/80 border border-dark-800 p-2.5 rounded-xl">
            <span className="text-[10px] text-slate-500 uppercase font-mono block">Window</span>
            <span className="text-xs font-bold font-mono text-slate-300">
              {config.window_minutes === 60 ? '1 Hour (60m)' : '24 Hours (1440m)'}
            </span>
          </div>

          <div className="bg-dark-950/80 border border-dark-800 p-2.5 rounded-xl">
            <span className="text-[10px] text-slate-500 uppercase font-mono block">Take-Profit</span>
            <span className="text-xs font-bold font-mono text-emerald-400">+{config.tp_pct}.0%</span>
          </div>

          <div className="bg-dark-950/80 border border-dark-800 p-2.5 rounded-xl">
            <span className="text-[10px] text-slate-500 uppercase font-mono block">Stop-Loss</span>
            <span className="text-xs font-bold font-mono text-rose-400">-{config.sl_pct}.0%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
