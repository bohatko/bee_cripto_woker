'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Radar, ArrowUpRight, ShieldAlert, Sparkles, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { playWarningSound } from '@/lib/sound';

export interface SignalReadinessCardProps {
  userId?: string;
  strategyId?: string;
}

export function SignalReadinessCard({ userId, strategyId = 'xrp_dip_buy_v1' }: SignalReadinessCardProps) {
  const { t } = useLanguage();
  const [strategy, setStrategy] = useState<any>(null);
  const [userSettings, setUserSettings] = useState<any>(null);
  const [hasPlayedSound, setHasPlayedSound] = useState(false);

  useEffect(() => {
    async function loadData() {
      // 1. Fetch signal strategy
      const { data: strat } = await supabase
        .from('signal_strategies')
        .select('*')
        .eq('id', strategyId)
        .maybeSingle();

      if (strat) {
        setStrategy(strat);
      }

      // 2. Fetch user settings if logged in
      if (userId) {
        const { data: uSettings } = await supabase
          .from('user_signal_settings')
          .select('*')
          .eq('user_id', userId)
          .eq('strategy_id', strategyId)
          .maybeSingle();

        if (uSettings) {
          setUserSettings(uSettings);
        }
      }
    }

    loadData();

    // Subscribe to realtime updates for signal_strategies
    const stratChannel = supabase
      .channel(`realtime_signal_strategy_card_${strategyId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'signal_strategies',
          filter: `id=eq.${strategyId}`,
        },
        (payload: any) => {
          if (payload.new) {
            setStrategy(payload.new);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(stratChannel);
    };
  }, [userId, strategyId]);

  const liveState = strategy?.live_state || {
    price: 0,
    rolling_max: 0,
    drop_pct: 0,
    readiness_pct: 0,
    state: 'flat',
  };

  const readiness = Number(liveState.readiness_pct || 0);
  const dropPct = Number(liveState.drop_pct || 0);
  const isTradingOn = Boolean(userSettings?.is_enabled);

  // Sound chime when readiness >= 80% once per episode
  useEffect(() => {
    if (readiness >= 80 && !hasPlayedSound) {
      playWarningSound();
      setHasPlayedSound(true);
    } else if (readiness < 70 && hasPlayedSound) {
      setHasPlayedSound(false);
    }
  }, [readiness, hasPlayedSound]);

  // Color logic for readiness
  const getProgressColor = (r: number) => {
    if (r >= 90) return 'bg-rose-500 shadow-rose-500/50 animate-pulse';
    if (r >= 80) return 'bg-amber-400 shadow-amber-400/50';
    if (r >= 50) return 'bg-honey-500 shadow-honey-500/30';
    return 'bg-slate-500';
  };

  const getStatusBadge = () => {
    if (liveState.state === 'in_position') {
      return (
        <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-honey-500/15 text-honey-400 border border-honey-500/30 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-honey-400 animate-ping" />
          {t('signals.statusInPosition')}
        </span>
      );
    }
    if (readiness >= 100) {
      return (
        <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 animate-pulse">
          {t('signals.statusFired')}
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-dark-800 text-slate-400 border border-dark-700">
        {t('signals.statusWaiting')}
      </span>
    );
  };

  return (
    <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-xl hover:border-dark-700 transition-all relative overflow-hidden group">
      {/* Background radial glow */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-honey-500/5 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20 group-hover:bg-honey-500/10 transition-colors" />

      {/* Header */}
      <div className="flex items-center justify-between mb-4 relative z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-honey-500/10 border border-honey-500/25 flex items-center justify-center text-honey-400 shadow-sm">
            <Radar className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-white tracking-wide">
                {strategy?.symbol || 'XRP'} / USDT{' '}
                <span className="text-[11px] font-mono text-honey-400 font-normal">
                  {strategy?.leverage || 3.0}x Isolated
                </span>
              </h3>
            </div>
            <p className="text-[11px] text-slate-400 font-mono">
              {strategy?.name || t('signals.readinessCardTitle')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {getStatusBadge()}
          <Link
            href={`/signals?tab=${strategy?.symbol?.toLowerCase() || 'xrp'}`}
            className="text-xs text-honey-400 hover:text-honey-300 font-mono font-semibold flex items-center gap-0.5 bg-honey-500/10 hover:bg-honey-500/20 px-2.5 py-1 rounded-lg border border-honey-500/25 transition-all"
          >
            {t('signals.viewDetails')}
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 relative z-10">
        <div className="bg-dark-950/70 border border-dark-800/80 rounded-xl p-2.5">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-mono">
            {t('signals.currentPrice')}
          </span>
          <span className="text-sm font-bold font-mono text-white">
            ${liveState.price > 0 ? liveState.price.toFixed(strategy?.symbol === 'ETH' ? 2 : 4) : '---'}
          </span>
        </div>

        <div className="bg-dark-950/70 border border-dark-800/80 rounded-xl p-2.5">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-mono">
            {strategy?.config?.window_minutes < 60
              ? `${strategy?.config?.window_minutes}m High`
              : strategy?.config?.window_minutes === 60
              ? '1h High'
              : `${Math.round((strategy?.config?.window_minutes || 1440) / 60)}h High`}
          </span>
          <span className="text-sm font-bold font-mono text-slate-300">
            ${liveState.rolling_max > 0 ? liveState.rolling_max.toFixed(strategy?.symbol === 'ETH' ? 2 : 4) : '---'}
          </span>
        </div>

        <div className="bg-dark-950/70 border border-dark-800/80 rounded-xl p-2.5">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-mono">
            {strategy?.config?.window_minutes < 60
              ? `Drop (${strategy?.config?.window_minutes}m)`
              : strategy?.config?.window_minutes === 60
              ? 'Drop (1h)'
              : `Drop (${Math.round((strategy?.config?.window_minutes || 1440) / 60)}h)`}
          </span>
          <span className={`text-sm font-bold font-mono ${dropPct >= (strategy?.config?.drop_pct || 15) * 0.7 ? 'text-rose-400' : 'text-slate-200'}`}>
            -{dropPct.toFixed(2)}%{' '}
            <span className="text-[10px] text-slate-500 font-normal">
              / {strategy?.config?.drop_pct || 15}%
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
      <div className="space-y-1.5 relative z-10">
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
