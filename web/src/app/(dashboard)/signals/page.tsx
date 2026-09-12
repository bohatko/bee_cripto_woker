'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { SignalStrategyHeader } from '@/components/signals/SignalStrategyHeader';
import { SignalSettingsCard } from '@/components/signals/SignalSettingsCard';
import { SignalStatsCards } from '@/components/signals/SignalStatsCards';
import { SignalEventsTable } from '@/components/signals/SignalEventsTable';
import { SignalPositionsTable } from '@/components/signals/SignalPositionsTable';
import { SignalReadinessCard } from '@/components/dashboard/SignalReadinessCard';

function SignalsContent() {
  const { t } = useLanguage();
  const searchParams = useSearchParams();
  const router = useRouter();

  const [activeStrategyId, setActiveStrategyId] = useState<string>('xrp_dip_buy_v1');
  const [strategies, setStrategies] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const [strategy, setStrategy] = useState<any>(null);
  const [userSettings, setUserSettings] = useState<any>(null);
  const [primaryAccount, setPrimaryAccount] = useState<any>(null);
  const [freeMargin, setFreeMargin] = useState<number>(0);
  const [events, setEvents] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Sync tab with URL search param
  useEffect(() => {
    const tab = searchParams.get('tab')?.toLowerCase();
    if (tab === 'eth') {
      setActiveStrategyId('eth_dip_buy_v1');
    } else if (tab === 'xrp') {
      setActiveStrategyId('xrp_dip_buy_v1');
    }
  }, [searchParams]);

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
        setStrategies(strats);
        const currentStrat = strats.find((s) => s.id === activeStrategyId) || strats[0];
        setStrategy(currentStrat);
      }

      // 2. Fetch user settings for active strategy
      const { data: uSettings } = await supabase
        .from('user_signal_settings')
        .select('*')
        .eq('user_id', authUser.id)
        .eq('strategy_id', activeStrategyId)
        .maybeSingle();

      setUserSettings(uSettings || null);

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

      // 4. Fetch global signal events for active strategy
      const { data: evs } = await supabase
        .from('signal_events')
        .select('*')
        .eq('strategy_id', activeStrategyId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (evs) setEvents(evs);

      // 5. Fetch user signal positions for active strategy
      const { data: pos } = await supabase
        .from('signal_positions')
        .select('*')
        .eq('user_id', authUser.id)
        .eq('strategy_id', activeStrategyId)
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
      .channel(`signals_page_realtime_${activeStrategyId}`)
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
        { event: 'UPDATE', schema: 'public', table: 'signal_strategies', filter: `id=eq.${activeStrategyId}` },
        (payload: any) => {
          if (payload.new) setStrategy(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeStrategyId]);

  const handleTabChange = (strategyId: string) => {
    setActiveStrategyId(strategyId);
    const sym = strategyId.includes('eth') ? 'eth' : 'xrp';
    router.replace(`/signals?tab=${sym}`);
  };

  const hasOpenPosition = positions.some((p) => p.status === 'open');

  if (loading) {
    return (
      <div className="flex-1 p-6 md:p-8 flex items-center justify-center font-mono text-sm text-slate-400">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 max-w-5xl space-y-8">
      {/* Coin Selector Tabs */}
      <div className="flex items-center gap-3 border-b border-dark-800 pb-3">
        {strategies.map((s) => {
          const isActive = s.id === activeStrategyId;
          return (
            <button
              key={s.id}
              onClick={() => handleTabChange(s.id)}
              className={`px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all flex items-center gap-2 ${
                isActive
                  ? 'bg-honey-500 text-dark-950 shadow-md shadow-honey-500/20'
                  : 'bg-dark-900 hover:bg-dark-850 text-slate-400 hover:text-white border border-dark-800'
              }`}
            >
              <span>{s.symbol}/USDT</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${isActive ? 'bg-dark-950/20 text-dark-950' : 'bg-dark-800 text-slate-400'}`}>
                {s.config?.drop_pct}% / {s.config?.window_minutes === 60 ? '1h' : '24h'}
              </span>
            </button>
          );
        })}
      </div>

      {/* Strategy Header */}
      <SignalStrategyHeader strategy={strategy} />

      {/* Live Readiness Card */}
      <SignalReadinessCard userId={user?.id} strategyId={activeStrategyId} />

      {/* Settings Card */}
      {user && (
        <SignalSettingsCard
          userId={user.id}
          strategyId={activeStrategyId}
          strategySymbol={strategy?.symbol || 'XRP'}
          leverage={Number(strategy?.leverage || 3.0)}
          initialSettings={userSettings}
          primaryAccount={primaryAccount}
          freeMargin={freeMargin}
          hasOpenPosition={hasOpenPosition}
          onSettingsUpdated={(newSettings) => setUserSettings(newSettings)}
        />
      )}

      {/* Stats Cards */}
      <SignalStatsCards positions={positions} />

      {/* Active & Closed Positions */}
      <SignalPositionsTable positions={positions} />

      {/* Global Signal Events Log */}
      <SignalEventsTable events={events} userPositions={positions} />
    </div>
  );
}

export default function SignalsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-4 sm:p-8 max-w-5xl flex items-center justify-center font-mono text-sm text-slate-400">
          Loading...
        </div>
      }
    >
      <SignalsContent />
    </Suspense>
  );
}
