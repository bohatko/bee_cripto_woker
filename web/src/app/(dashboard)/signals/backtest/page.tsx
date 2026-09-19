'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Filter, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { EquityGrowthChart } from '@/components/charts/EquityGrowthChart';
import { SignalEventsTable } from '@/components/signals/SignalEventsTable';
import { SignalStatsCards } from '@/components/signals/SignalStatsCards';
import { SignalsBacktestSkeleton } from '@/components/skeletons/PageSkeletons';

const SIGNAL_BACKTEST_START_USD = 10000;

export default function SignalsBacktestPage() {
  const router = useRouter();
  const { t, dateLocale } = useLanguage();
  const [events, setEvents] = useState<any[]>([]);
  const [masterPositions, setMasterPositions] = useState<any[]>([]);
  const [userPositions, setUserPositions] = useState<any[]>([]);
  const [coinFilter, setCoinFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          router.replace('/login');
          return;
        }

        const [{ data: evs }, { data: masters }, { data: userPos }] = await Promise.all([
          supabase
            .from('signal_events')
            .select('*')
            .order('signal_bar_ts', { ascending: false })
            .limit(500),
          supabase
            .from('signal_positions')
            .select('*')
            .eq('is_master', true)
            .order('opened_at', { ascending: false })
            .limit(500),
          supabase
            .from('signal_positions')
            .select('*')
            .eq('user_id', user.id)
            .order('opened_at', { ascending: false }),
        ]);

        if (evs) setEvents(evs);
        if (masters) setMasterPositions(masters);
        if (userPos) setUserPositions(userPos);
      } catch (err: any) {
        console.error('Error loading Dip-Buy backtest:', err?.message || err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const coinOptions = useMemo(() => {
    const symbols = new Set<string>();
    for (const p of masterPositions) {
      if (p.symbol) symbols.add(String(p.symbol).toUpperCase());
    }
    for (const e of events) {
      if (e.symbol) symbols.add(String(e.symbol).toUpperCase());
    }
    return ['ALL', ...Array.from(symbols).sort()];
  }, [masterPositions, events]);

  const filteredEvents = useMemo(() => {
    if (coinFilter === 'ALL') return events;
    return events.filter((e) => String(e.symbol || '').toUpperCase() === coinFilter);
  }, [events, coinFilter]);

  const filteredMasters = useMemo(() => {
    if (coinFilter === 'ALL') return masterPositions;
    return masterPositions.filter((p) => String(p.symbol || '').toUpperCase() === coinFilter);
  }, [masterPositions, coinFilter]);

  const filteredUserPositions = useMemo(() => {
    if (coinFilter === 'ALL') return userPositions;
    return userPositions.filter((p) => String(p.symbol || '').toUpperCase() === coinFilter);
  }, [userPositions, coinFilter]);

  const closedMasters = useMemo(
    () => filteredMasters.filter((p) => p.status === 'closed'),
    [filteredMasters]
  );

  const startingBalance =
    coinFilter === 'ALL'
      ? SIGNAL_BACKTEST_START_USD *
        Math.max(1, new Set(closedMasters.map((p) => String(p.symbol || '').toUpperCase())).size)
      : SIGNAL_BACKTEST_START_USD;

  const totalPnl = useMemo(
    () => closedMasters.reduce((acc, p) => acc + Number(p.realized_pnl_usd || 0), 0),
    [closedMasters]
  );

  if (loading) {
    return <SignalsBacktestSkeleton />;
  }

  return (
    <div className="p-4 sm:p-8 space-y-6 w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            {t('signals.backtestPageTitle')}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            {t('signals.backtestPageSubtitle')}
          </p>
        </div>

        <div className="bg-dark-900 border border-dark-800 px-4 py-2.5 rounded-xl flex items-center gap-3 shadow-lg shrink-0">
          <span className="text-xs text-slate-400 font-mono">{t('signals.realizedPnl')}</span>
          <span
            className={`font-mono font-black text-base ${
              totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {totalPnl >= 0
              ? `+$${totalPnl.toLocaleString(dateLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : `-$${Math.abs(totalPnl).toLocaleString(dateLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <Filter className="w-3.5 h-3.5 text-honey-400" />
          <span>Filter:</span>
        </div>
        <div className="flex items-center gap-2">
          {coinOptions.map((coin) => {
            const isActive = coinFilter === coin;
            return (
              <button
                key={coin}
                onClick={() => setCoinFilter(coin)}
                className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all ${
                  isActive
                    ? 'bg-honey-500 text-dark-950 shadow-md shadow-honey-500/20'
                    : 'bg-dark-900 hover:bg-dark-850 text-slate-400 hover:text-white border border-dark-800'
                }`}
              >
                {coin === 'ALL' ? t('signals.filterAll') : `${coin}/USDT`}
              </button>
            );
          })}
        </div>
      </div>

      {closedMasters.length > 0 ? (
        <EquityGrowthChart
          positions={closedMasters}
          mode="equity"
          startingBalance={startingBalance}
          isMaster
          title={t('signals.backtestChartTitle')}
          subtitle={t('signals.backtestChartSubtitle')}
        />
      ) : (
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 text-center space-y-2">
          <div className="w-10 h-10 rounded-xl bg-honey-500/10 border border-honey-500/25 flex items-center justify-center text-honey-400 mx-auto">
            <Sparkles className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-bold text-white">{t('signals.backtestChartTitle')}</h3>
          <p className="text-xs font-mono text-slate-400 max-w-md mx-auto">
            {t('signals.noChartData')}
          </p>
        </div>
      )}

      <SignalStatsCards positions={filteredMasters} />

      <SignalEventsTable
        events={filteredEvents}
        userPositions={filteredUserPositions}
        masterPositions={filteredMasters}
      />
    </div>
  );
}
