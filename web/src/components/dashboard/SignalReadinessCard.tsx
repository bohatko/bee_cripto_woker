'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Radar, ArrowUpRight, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { playWarningSound } from '@/lib/sound';
import { signalPriceDecimals } from '@/lib/signals';

export interface SignalReadinessCardProps {
  userId?: string;
  strategyId?: string;
  strategyData?: any;
  hideDetailsLink?: boolean;
}

function getReadinessTone(r: number) {
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
}

export function SignalReadinessCard({
  userId,
  strategyId = 'xrp_dip_buy_v1',
  strategyData,
  hideDetailsLink = false,
}: SignalReadinessCardProps) {
  const { t } = useLanguage();
  const [strategy, setStrategy] = useState<any>(strategyData || null);
  const [userSettings, setUserSettings] = useState<any>(null);
  const [hasPlayedSound, setHasPlayedSound] = useState(false);

  useEffect(() => {
    if (strategyData) {
      setStrategy(strategyData);
    }
  }, [strategyData]);

  useEffect(() => {
    async function loadData() {
      const { data: strat } = await supabase
        .from('signal_strategies')
        .select('*')
        .eq('id', strategyId)
        .maybeSingle();

      if (strat) {
        setStrategy(strat);
      }

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
  const clampedReadiness = Math.min(100, Math.max(0, readiness));
  const isTradingOn = Boolean(userSettings?.is_enabled);
  const tone = getReadinessTone(readiness);
  const symbol = strategy?.symbol || 'XRP';
  const leverage = strategy?.leverage || 3.0;
  const dropTarget = strategy?.config?.drop_pct || 15;
  const windowMinutes = strategy?.config?.window_minutes || 1440;

  const windowLabel =
    windowMinutes < 60
      ? `${windowMinutes}m`
      : windowMinutes === 60
      ? '1h'
      : `${Math.round(windowMinutes / 60)}h`;

  useEffect(() => {
    if (readiness >= 80 && !hasPlayedSound) {
      playWarningSound();
      setHasPlayedSound(true);
    } else if (readiness < 70 && hasPlayedSound) {
      setHasPlayedSound(false);
    }
  }, [readiness, hasPlayedSound]);

  const getStatusBadge = () => {
    if (liveState.state === 'in_position') {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-honey-500/15 text-honey-400 border border-honey-500/30 flex items-center gap-1.5 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-honey-400 animate-ping" />
          {t('signals.statusInPositionShort')}
        </span>
      );
    }
    if (readiness >= 100) {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30 animate-pulse shrink-0">
          {t('signals.statusFiredShort')}
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-dark-800 text-slate-400 border border-dark-700 shrink-0">
        {t('signals.statusWaitingShort')}
      </span>
    );
  };

  return (
    <div className="bg-dark-900 border border-dark-800 rounded-2xl p-4 sm:p-5 shadow-xl hover:border-dark-700 transition-all relative overflow-hidden group space-y-4">
      <div className="absolute top-0 right-0 w-64 h-64 bg-honey-500/5 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20 group-hover:bg-honey-500/10 transition-colors" />

      {/* Header: stacks on narrow screens */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between relative z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-honey-500/10 border border-honey-500/25 flex items-center justify-center text-honey-400 shadow-sm shrink-0">
            <Radar className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-white tracking-wide truncate">
                {symbol} / USDT
              </h3>
              <span className="text-[10px] font-mono text-honey-400 shrink-0">
                {leverage}x Isolated
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono truncate mt-0.5">
              {strategy?.name || t('signals.readinessCardTitle')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-start">
          {getStatusBadge()}
          {!hideDetailsLink && (
            <Link
              href="/signals"
              title={t('signals.viewDetails')}
              aria-label={t('signals.viewDetails')}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-honey-400 bg-honey-500/10 hover:bg-honey-500/20 border border-honey-500/25 transition-all shrink-0"
            >
              <ArrowUpRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      </div>

      {/* Metrics — always 2×2 on dashboard card; compact labels */}
      <div className="grid grid-cols-2 gap-2 relative z-10">
        <div className="bg-dark-950/70 border border-dark-800/80 rounded-lg px-2.5 py-2 min-w-0">
          <span className="text-[9px] text-slate-500 uppercase tracking-wide block font-mono truncate">
            {t('signals.metricPrice')}
          </span>
          <span className="text-xs sm:text-sm font-bold font-mono text-white tabular-nums">
            ${liveState.price > 0 ? liveState.price.toFixed(signalPriceDecimals(symbol)) : '---'}
          </span>
        </div>

        <div className="bg-dark-950/70 border border-dark-800/80 rounded-lg px-2.5 py-2 min-w-0">
          <span className="text-[9px] text-slate-500 uppercase tracking-wide block font-mono truncate">
            {t('signals.metricHigh', { window: windowLabel })}
          </span>
          <span className="text-xs sm:text-sm font-bold font-mono text-slate-300 tabular-nums">
            $
            {liveState.rolling_max > 0
              ? liveState.rolling_max.toFixed(signalPriceDecimals(symbol))
              : '---'}
          </span>
        </div>

        <div className="bg-dark-950/70 border border-dark-800/80 rounded-lg px-2.5 py-2 min-w-0">
          <span className="text-[9px] text-slate-500 uppercase tracking-wide block font-mono truncate">
            {t('signals.metricDrop', { window: windowLabel })}
          </span>
          <span
            className={`text-xs sm:text-sm font-bold font-mono tabular-nums ${
              dropPct >= dropTarget * 0.7 ? 'text-rose-400' : 'text-slate-200'
            }`}
          >
            -{dropPct.toFixed(2)}%
            <span className="text-[9px] text-slate-500 font-normal ml-1">/{dropTarget}%</span>
          </span>
        </div>

        <div className="bg-dark-950/70 border border-dark-800/80 rounded-lg px-2.5 py-2 min-w-0">
          <span className="text-[9px] text-slate-500 uppercase tracking-wide block font-mono truncate">
            {t('signals.metricTrading')}
          </span>
          <span className="flex items-center gap-1.5 mt-0.5">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                isTradingOn ? 'bg-emerald-400 shadow-sm shadow-emerald-400' : 'bg-slate-600'
              }`}
            />
            <span
              className={`text-xs font-bold font-mono ${
                isTradingOn ? 'text-emerald-400' : 'text-slate-400'
              }`}
            >
              {isTradingOn ? t('signals.on') : t('signals.off')}
            </span>
          </span>
        </div>
      </div>

      {/* Signal readiness — same style as /signals StrategyCombinedCard */}
      <div className={`relative z-10 rounded-xl border p-3 space-y-2.5 ${tone.track}`}>
        <div className="flex justify-between items-center gap-3">
          <span className="text-xs font-mono text-slate-300 flex items-center gap-1.5 min-w-0">
            <span className="relative flex h-5 w-5 items-center justify-center rounded-md bg-dark-950/70 border border-dark-700/80 shrink-0">
              <Sparkles className={`w-3 h-3 ${tone.text} ${tone.pulse ? 'animate-pulse' : ''}`} />
            </span>
            <span className="truncate">{t('signals.readiness')}</span>
          </span>
          <span
            className={`font-mono text-sm font-black tracking-tight tabular-nums shrink-0 ${tone.text} ${
              tone.pulse ? 'animate-pulse' : ''
            }`}
          >
            {clampedReadiness.toFixed(1)}%
          </span>
        </div>

        <div className="relative h-3 w-full rounded-full bg-dark-950/90 border border-dark-800/90 overflow-hidden shadow-inner">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.03] to-transparent pointer-events-none" />
          <div className="absolute inset-y-0 left-[80%] w-px bg-amber-400/25 pointer-events-none" />
          <div className="absolute inset-y-0 left-[90%] w-px bg-rose-400/30 pointer-events-none" />
          <div
            className={`relative h-full rounded-full bg-gradient-to-r ${tone.fill} ${tone.glow} transition-all duration-700 ease-out ${
              tone.pulse ? 'animate-pulse' : ''
            }`}
            style={{ width: `${clampedReadiness}%` }}
          >
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
