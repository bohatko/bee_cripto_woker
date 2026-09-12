'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { SignalStrategyHeader } from '@/components/signals/SignalStrategyHeader';
import { SignalSettingsCard } from '@/components/signals/SignalSettingsCard';
import { SignalStatsCards } from '@/components/signals/SignalStatsCards';
import { SignalEventsTable } from '@/components/signals/SignalEventsTable';
import { SignalPositionsTable } from '@/components/signals/SignalPositionsTable';
import { SignalReadinessCard } from '@/components/dashboard/SignalReadinessCard';

export default function SignalsPage() {
  const { t } = useLanguage();
  const [user, setUser] = useState<any>(null);
  const [strategy, setStrategy] = useState<any>(null);
  const [userSettings, setUserSettings] = useState<any>(null);
  const [primaryAccount, setPrimaryAccount] = useState<any>(null);
  const [freeMargin, setFreeMargin] = useState<number>(0);
  const [events, setEvents] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadData() {
    try {
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (!authUser) return;
      setUser(authUser);

      // 1. Fetch signal strategy
      const { data: strat } = await supabase
        .from('signal_strategies')
        .select('*')
        .eq('id', 'xrp_dip_buy_v1')
        .single();
      if (strat) setStrategy(strat);

      // 2. Fetch user settings
      const { data: uSettings } = await supabase
        .from('user_signal_settings')
        .select('*')
        .eq('user_id', authUser.id)
        .eq('strategy_id', 'xrp_dip_buy_v1')
        .maybeSingle();
      if (uSettings) setUserSettings(uSettings);

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

      // 4. Fetch global signal events
      const { data: evs } = await supabase
        .from('signal_events')
        .select('*')
        .eq('strategy_id', 'xrp_dip_buy_v1')
        .order('created_at', { ascending: false })
        .limit(50);
      if (evs) setEvents(evs);

      // 5. Fetch user signal positions
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
      .channel('signals_page_realtime')
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
        { event: 'UPDATE', schema: 'public', table: 'signal_strategies', filter: 'id=eq.xrp_dip_buy_v1' },
        (payload: any) => {
          if (payload.new) setStrategy(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const hasOpenPosition = positions.some((p) => p.status === 'open');

  if (loading) {
    return (
      <div className="flex-1 p-6 md:p-8 flex items-center justify-center font-mono text-sm text-slate-400">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="flex-1 p-6 md:p-8 space-y-6 overflow-y-auto max-w-7xl mx-auto w-full">
      {/* Strategy Header */}
      <SignalStrategyHeader strategy={strategy} />

      {/* Live Readiness Card */}
      <SignalReadinessCard userId={user?.id} />

      {/* Settings Card */}
      {user && (
        <SignalSettingsCard
          userId={user.id}
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
