'use client';

import React, { Suspense, useEffect, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { SignalSettingsCard } from '@/components/signals/SignalSettingsCard';
import { SignalStatsCards } from '@/components/signals/SignalStatsCards';
import { SignalEventsTable } from '@/components/signals/SignalEventsTable';
import { SignalPositionsTable } from '@/components/signals/SignalPositionsTable';
import { StrategyCombinedCard } from '@/components/signals/StrategyCombinedCard';
import { EquityGrowthChart } from '@/components/charts/EquityGrowthChart';
import { Compass, Sparkles, Filter } from 'lucide-react';

function SignalsContent() {
  const { t, dateLocale } = useLanguage();

  const [strategies, setStrategies] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const [userSettingsMap, setUserSettingsMap] = useState<Record<string, any>>({});
  const [primaryAccount, setPrimaryAccount] = useState<any>(null);
  const [freeMargin, setFreeMargin] = useState<number>(0);
  const [events, setEvents] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter for history tables & chart (ALL, XRP, ETH)
  const [historyCoinFilter, setHistoryCoinFilter] = useState<string>('ALL');

  async function loadData() {
    try {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (!authUser) return;
      setUser(authUser);

      // 1. Fetch all signal strategies
      const { data: strats } = await supabase
        .from('signal_strategies')
        .select('*')
        .order('id', { ascending: false });

      if (strats && strats.length > 0) {
        // Keep canonical order: XRP first, ETH second
        const sorted = [...strats].sort((a, b) => {
          if (a.symbol === 'XRP') return -1;
          if (b.symbol === 'XRP') return 1;
          return a.symbol.localeCompare(b.symbol);
        });
        setStrategies(sorted);
      }

      // 2. Fetch user settings for all strategies
      const { data: uSettingsList } = await supabase
        .from('user_signal_settings')
        .select('*')
        .eq('user_id', authUser.id);

      const sMap: Record<string, any> = {};
      (uSettingsList || []).forEach((item: any) => {
        sMap[item.strategy_id] = item;
      });
      setUserSettingsMap(sMap);

      // 3. Fetch primary exchange account & free margin
      const { data: tSettings } = await supabase
        .from('trading_settings')
        .select('*, exchange_accounts(*)')
        .eq('user_id', authUser.id)
        .maybeSingle();

      const acc = tSettings?.exchange_accounts;
      if (acc) {
        setPrimaryAccount(acc);
        setFreeMargin(Number(acc.free_balance_usd ?? acc.last_balance_usd ?? 0));
      }

      // 4. Fetch global signal events (all strategies)
      const { data: evs } = await supabase
        .from('signal_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(60);
      if (evs) setEvents(evs);

      // 5. Fetch user signal positions (both XRP and ETH)
      const { data: pos } = await supabase
        .from('signal_positions')
        .select('*')
        .eq('user_id', authUser.id)
        .order('opened_at', { ascending: false });
      if (pos) setPositions(pos);
    } catch (err: any) {
      console.error('Error loading signals data:', err?.message || err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();

    // Subscribe to realtime updates
    const channel = supabase
      .channel('signals_page_all_unified')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'signal_positions' },
        () => loadData()
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'signal_events' },
        () => loadData()
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'signal_strategies' },
        (payload: any) => {
          setStrategies((prev) =>
            prev.map((s) => (s.id === payload.new?.id ? payload.new : s))
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Filter positions and events by selected coin
  const filteredPositions = useMemo(() => {
    if (historyCoinFilter === 'ALL') return positions;
    return positions.filter((p) => (p.symbol || '').toUpperCase() === historyCoinFilter);
  }, [positions, historyCoinFilter]);

  const filteredEvents = useMemo(() => {
    if (historyCoinFilter === 'ALL') return events;
    return events.filter((e) => (e.symbol || '').toUpperCase() === historyCoinFilter);
  }, [events, historyCoinFilter]);

  const closedPositionsForChart = useMemo(() => {
    return filteredPositions.filter((p) => p.status === 'closed');
  }, [filteredPositions]);

  // Total Realized Net PnL of all user signal trades
  const totalUserSignalPnl = useMemo(() => {
    return filteredPositions
      .filter((p) => p.status === 'closed')
      .reduce((acc, p) => acc + Number(p.realized_pnl_usd || 0), 0);
  }, [filteredPositions]);

  if (loading) {
    return (
      <div className="flex-1 p-6 md:p-8 flex items-center justify-center font-mono text-sm text-slate-400">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 space-y-6 w-full">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            {t('signals.title')}
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-honey-500/15 text-honey-400 border border-honey-500/30">
              Multi-Asset (XRP + ETH)
            </span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            {t('signals.subtitle')}
          </p>
        </div>

        {/* Global Signal PnL Pill (same style as in /history/bot) */}
        <div className="bg-dark-900 border border-dark-800 px-4 py-2.5 rounded-xl flex items-center gap-3 shadow-lg shrink-0">
          <span className="text-xs text-slate-400 font-mono">{t('signals.realizedPnl')}</span>
          <span
            className={`font-mono font-black text-base ${
              totalUserSignalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {totalUserSignalPnl >= 0
              ? `+$${totalUserSignalPnl.toLocaleString(dateLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : `-$${Math.abs(totalUserSignalPnl).toLocaleString(dateLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </span>
        </div>
      </div>

      {/* User's Personal Signal Equity / PnL Growth Chart (shows if user has trades) */}
      {closedPositionsForChart.length > 0 ? (
        <EquityGrowthChart
          positions={closedPositionsForChart}
          mode="pnl"
          title={t('signals.performanceChartTitle')}
          subtitle={t('signals.performanceChartSubtitle')}
        />
      ) : (
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 text-center space-y-2">
          <div className="w-10 h-10 rounded-xl bg-honey-500/10 border border-honey-500/25 flex items-center justify-center text-honey-400 mx-auto">
            <Sparkles className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-bold text-white">{t('signals.performanceChartTitle')}</h3>
          <p className="text-xs font-mono text-slate-400 max-w-md mx-auto">
            {t('signals.noChartData')}
          </p>
        </div>
      )}

      {/* Overall Performance Summary Cards */}
      <SignalStatsCards positions={filteredPositions} />

      {/* Active Open Positions across all signal strategies */}
      <SignalPositionsTable positions={positions} mode="open" />

      {/* Live Strategies Proximity & Readiness (Unified Cards) */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-honey-400" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-white">
            {t('signals.strategiesOverview')}
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {strategies.map((strat) => {
            const uSettings = userSettingsMap[strat.id];
            const isTradingOn = Boolean(uSettings?.is_enabled);

            return (
              <StrategyCombinedCard
                key={strat.id}
                strategy={strat}
                liveState={strat.live_state}
                isTradingOn={isTradingOn}
                hideDetailsLink={true}
              />
            );
          })}
        </div>
      </div>

      {/* Trading Settings per Coin (Both XRP & ETH side-by-side) */}
      {user && (
        <div className="space-y-4">
          <h2 className="text-sm font-bold uppercase tracking-wider text-white">
            {t('signals.settingsTitle')}
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {strategies.map((strat) => {
              const uSettings = userSettingsMap[strat.id];
              const hasOpen = positions.some(
                (p) => p.status === 'open' && p.symbol?.toUpperCase() === strat.symbol?.toUpperCase()
              );

              return (
                <div key={strat.id} className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-bold font-mono text-honey-400">
                      {strat.symbol}/USDT ({strat.leverage}x Isolated)
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">
                      Trigger: Drop ≥ {strat.config?.drop_pct}% / {strat.config?.window_minutes < 60 ? `${strat.config?.window_minutes}m` : strat.config?.window_minutes === 60 ? '1h' : `${Math.round(strat.config?.window_minutes / 60)}h`}
                    </span>
                  </div>

                  <SignalSettingsCard
                    userId={user.id}
                    strategyId={strat.id}
                    strategySymbol={strat.symbol}
                    leverage={Number(strat.leverage || 3.0)}
                    initialSettings={uSettings}
                    primaryAccount={primaryAccount}
                    freeMargin={freeMargin}
                    hasOpenPosition={hasOpen}
                    onSettingsUpdated={(newSet) => {
                      setUserSettingsMap((prev) => ({
                        ...prev,
                        [strat.id]: newSet,
                      }));
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Coin Filter for History and Signal Events Tables */}
      <div className="flex items-center justify-between border-t border-dark-800 pt-6">
        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <Filter className="w-3.5 h-3.5 text-honey-400" />
          <span>Filter Tables:</span>
        </div>

        <div className="flex items-center gap-2">
          {['ALL', ...Array.from(new Set(strategies.map((s) => s.symbol.toUpperCase()))).sort()].map((coin) => {
            const isActive = historyCoinFilter === coin;
            return (
              <button
                key={coin}
                onClick={() => setHistoryCoinFilter(coin)}
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

      {/* Closed Positions History (История моих сделок) */}
      <SignalPositionsTable positions={filteredPositions} mode="closed" />

      {/* Global Signal Events Log (Глобальный журнал сигналов) */}
      <SignalEventsTable events={filteredEvents} userPositions={filteredPositions} />
    </div>
  );
}

export default function SignalsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 sm:p-8 w-full flex items-center justify-center font-mono text-sm text-slate-400">
          Loading...
        </div>
      }
    >
      <SignalsContent />
    </Suspense>
  );
}
