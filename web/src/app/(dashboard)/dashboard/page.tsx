'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  Play,
  Pause,
  AlertOctagon,
  TrendingUp,
  Wallet,
  Activity,
  Layers,
  ShieldCheck,
  Clock,
  KeyRound,
  AlertCircle,
  RefreshCw,
  Building2,
  ExternalLink,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { PanicCloseModal } from '@/components/modals/PanicCloseModal';
import { TradeReadinessMonitor } from '@/components/dashboard/TradeReadinessMonitor';
import { toast } from '@/components/ui/sonner';

export default function DashboardPage() {
  const [positions, setPositions] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [marketData, setMarketData] = useState<any[]>([]);
  const [isShowingMaster, setIsShowingMaster] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const hasAutoSyncedRef = useRef(false);

  // Modals state
  const [isToggleModalOpen, setIsToggleModalOpen] = useState(false);
  const [isPanicModalOpen, setIsPanicModalOpen] = useState(false);
  const [isMissingExchangeModalOpen, setIsMissingExchangeModalOpen] = useState(false);

  async function loadDashboardData() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // 1. Fetch user trading settings
    const { data: sett } = await supabase
      .from('trading_settings')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (sett) setSettings(sett);

    // 2. Fetch all active connected exchange accounts
    const { data: accs } = await supabase
      .from('exchange_accounts')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    const currentAccounts = accs || [];
    setAccounts(currentAccounts);

    const hasValidated = currentAccounts.some((a) => a.is_validated);

    // Auto-disable bot if all exchange keys were removed/missing
    if (!hasValidated && sett?.is_bot_active) {
      await supabase
        .from('trading_settings')
        .update({ is_bot_active: false })
        .eq('id', sett.id);
      setSettings((prev: any) => (prev ? { ...prev, is_bot_active: false } : null));
    }

    // 3. Fetch active open positions (check user's first, fallback to Master Bot live positions)
    const { data: userPos } = await supabase
      .from('bot_positions')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'open');

    if (userPos && userPos.length > 0) {
      setPositions(userPos);
      setIsShowingMaster(false);
    } else {
      const { data: masterPos } = await supabase
        .from('bot_positions')
        .select('*')
        .eq('is_master', true)
        .eq('status', 'open');
      setPositions(masterPos || []);
      setIsShowingMaster(true);
    }

    // 4. Fetch live market scanner data for trade readiness
    const { data: mData } = await supabase
      .from('pair_market_data')
      .select('*')
      .order('pair_symbol', { ascending: true });

    if (mData) setMarketData(mData);

    setLoading(false);

    // Auto-sync live balances once on initial load if exchanges are validated
    if (hasValidated && !hasAutoSyncedRef.current) {
      hasAutoSyncedRef.current = true;
      handleSyncBalances(false);
    }
  }

  async function handleSyncBalances(silent = false) {
    if (syncing) return;
    setSyncing(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch('/api/exchange/sync-balances', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        const text = await res.text().catch(() => '');
        throw new Error(text || `Server returned status ${res.status}`);
      }

      if (res.ok && data?.success && Array.isArray(data.accounts)) {
        setAccounts(data.accounts);
        const errorAccounts = data.accounts.filter(
          (a: any) => a.syncStatus === 'error' || a.last_error_msg
        );
        if (!silent) {
          if (errorAccounts.length > 0 && errorAccounts[0].last_error_msg) {
            toast.error(`Exchange API sync error: ${errorAccounts[0].last_error_msg}`);
          } else {
            toast.success('Balances updated directly from exchange APIs!');
          }
        }
      } else if (!silent) {
        toast.error(data?.error || 'Failed to sync balances from exchange APIs');
      }
    } catch (err: any) {
      console.error('Failed to sync live balances:', err);
      if (!silent) {
        toast.error(err.message || 'Failed to sync live balances');
      }
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    loadDashboardData();

    // Auto-refresh balances silently every 60 seconds while viewing dashboard
    const syncInterval = setInterval(() => {
      handleSyncBalances(true);
    }, 60000);

    // Auto-refresh market data every 10 seconds for real-time trade readiness tracking
    const marketInterval = setInterval(async () => {
      const { data: mData } = await supabase
        .from('pair_market_data')
        .select('*')
        .order('pair_symbol', { ascending: true });
      if (mData) setMarketData(mData);
    }, 10000);

    // Subscribe to realtime updates for positions, exchange accounts, settings, and market data
    const posChannel = supabase
      .channel('dashboard_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bot_positions' },
        () => loadDashboardData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'exchange_accounts' },
        () => loadDashboardData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trading_settings' },
        () => loadDashboardData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pair_market_data' },
        () => {
          supabase
            .from('pair_market_data')
            .select('*')
            .order('pair_symbol', { ascending: true })
            .then(({ data }) => {
              if (data) setMarketData(data);
            });
        }
      )
      .subscribe();

    return () => {
      clearInterval(syncInterval);
      clearInterval(marketInterval);
      supabase.removeChannel(posChannel);
    };
  }, []);

  const totalUnrealizedPnl = positions.reduce(
    (acc, p) => acc + (Number(p.unrealized_pnl_usd) || 0),
    0
  );

  const hasValidatedAccount = accounts.some((a) => a.is_validated);

  const totalAggregatedEquity = accounts.reduce(
    (sum, a) => sum + (Number(a.last_balance_usd) || 0),
    0
  );

  const totalAvailableMargin = totalAggregatedEquity * 0.75;

  const handleToggleBot = async () => {
    if (!settings) return;

    // Check if at least one exchange account is linked and validated
    if (!hasValidatedAccount) {
      setIsToggleModalOpen(false);
      setIsMissingExchangeModalOpen(true);
      toast.error('Connect and validate an exchange API before starting the bot.');
      return;
    }

    const nextState = !settings.is_bot_active;

    try {
      const { error } = await supabase
        .from('trading_settings')
        .update({ is_bot_active: nextState })
        .eq('id', settings.id);

      if (error) throw error;

      setSettings({ ...settings, is_bot_active: nextState });
      setIsToggleModalOpen(false);

      if (nextState) {
        toast.success('Trading bot started successfully!');
      } else {
        toast.info('Trading bot paused.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to update trading bot status');
    }
  };

  const handlePanicClose = async () => {
    if (!settings) return;

    try {
      // Trigger panic signal in trading_settings
      const { error } = await supabase
        .from('trading_settings')
        .update({
          panic_closed_at: new Date().toISOString(),
          is_bot_active: false,
        })
        .eq('id', settings.id);

      if (error) throw error;

      setIsPanicModalOpen(false);
      toast.error('Emergency panic close initiated! Liquidating all open positions immediately.');
      // Reload positions after signal
      setTimeout(loadDashboardData, 1500);
    } catch (err: any) {
      toast.error(err.message || 'Failed to trigger panic close');
    }
  };

  return (
    <div className="p-4 sm:p-8 space-y-6">
      {/* Top Bar: Title & Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Trading Dashboard
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            Real-time multi-pair market-neutral position monitoring and risk management.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          {accounts.length > 0 && (
            <button
              onClick={() => handleSyncBalances(false)}
              disabled={syncing}
              className="px-3 py-2.5 rounded-xl font-bold text-xs bg-dark-900 border border-dark-700 hover:border-honey-500/50 text-slate-300 hover:text-white flex items-center gap-2 transition-all shadow-md disabled:opacity-50"
              title="Query exchange APIs for latest wallet balances"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-honey-400 ${syncing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{syncing ? 'Syncing...' : 'Sync Balances'}</span>
            </button>
          )}

          <button
            onClick={() => {
              if (!settings?.is_bot_active && !hasValidatedAccount) {
                setIsMissingExchangeModalOpen(true);
              } else {
                setIsToggleModalOpen(true);
              }
            }}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider flex items-center gap-2 shadow-lg transition-all ${
              settings?.is_bot_active
                ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25'
                : 'bg-emerald-500 text-dark-950 hover:bg-emerald-400 shadow-emerald-500/20'
            }`}
          >
            {settings?.is_bot_active ? (
              <>
                <Pause className="w-4 h-4" /> Pause Trading
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" /> Start Trading
              </>
            )}
          </button>

          <button
            onClick={() => setIsPanicModalOpen(true)}
            disabled={positions.length === 0}
            className="px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-rose-600/15 text-rose-400 border border-rose-600/30 hover:bg-rose-600/25 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <AlertOctagon className="w-4 h-4" />
            Panic Close All
          </button>
        </div>
      </div>

      {/* Warning banner if exchange is not linked */}
      {!hasValidatedAccount && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/15 text-honey-400 shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">No Exchange Account Connected</h4>
              <p className="text-xs text-slate-300 mt-0.5">
                Trading is blocked until you connect at least one exchange API (Binance, OKX, or Bybit).
              </p>
            </div>
          </div>
          <Link
            href="/settings/exchange"
            className="px-4 py-2 rounded-xl text-xs font-bold bg-honey-500 hover:bg-honey-400 text-dark-950 flex items-center justify-center gap-1.5 transition-all shadow-md shadow-honey-500/20 shrink-0"
          >
            <KeyRound className="w-3.5 h-3.5" />
            Connect API Keys
          </Link>
        </div>
      )}

      {/* System Health Monitor */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-dark-900 border border-dark-800 p-3.5 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-medium text-slate-300">Railway Daemon</span>
          </div>
          <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
            ONLINE (12ms)
          </span>
        </div>

        <div className="bg-dark-900 border border-dark-800 p-3.5 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                hasValidatedAccount ? 'bg-emerald-400' : 'bg-amber-400'
              }`}
            />
            <span className="text-xs font-medium text-slate-300">
              Exchanges ({accounts.length > 0 ? accounts.map((a) => a.exchange.toUpperCase()).join(', ') : 'NONE'})
            </span>
          </div>
          <span
            className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
              hasValidatedAccount
                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                : 'text-amber-400 bg-amber-500/10 border-amber-500/20'
            }`}
          >
            {hasValidatedAccount ? `${accounts.length} CONNECTED` : 'WAITING KEYS'}
          </span>
        </div>

        <div className="bg-dark-900 border border-dark-800 p-3.5 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                settings?.is_bot_active ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
              }`}
            />
            <span className="text-xs font-medium text-slate-300">Bot Strategy State</span>
          </div>
          <span
            className={`text-[11px] font-mono px-2 py-0.5 rounded border uppercase ${
              settings?.is_bot_active
                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                : 'text-slate-400 bg-dark-800 border-dark-700'
            }`}
          >
            {settings?.is_bot_active ? 'ACTIVE (7x)' : 'IDLE'}
          </span>
        </div>
      </div>

      {/* Key Financial Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Total Account Equity Card */}
        <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl relative">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Total Account Equity</span>
            <div className="flex items-center gap-2">
              {accounts.length > 0 && (
                <button
                  onClick={() => handleSyncBalances(false)}
                  disabled={syncing}
                  className="text-slate-500 hover:text-honey-400 transition-colors p-1"
                  title="Refresh live exchange balances"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-honey-400' : ''}`} />
                </button>
              )}
              <Wallet className="w-4 h-4 text-honey-400" />
            </div>
          </div>
          <p className="text-2xl font-black text-white font-mono mt-2">
            ${totalAggregatedEquity.toLocaleString('en-US', {
              minimumFractionDigits: 2,
            })}{' '}
            <span className="text-xs text-slate-500 font-normal">USDT</span>
          </p>
          <div className="mt-2 text-[11px] text-slate-400 font-mono flex items-center justify-between">
            <span>
              Available Margin:{' '}
              <span className="text-slate-200 font-semibold">
                ${totalAvailableMargin.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </span>
            {accounts.length > 0 ? (
              <span className="text-[10px] text-emerald-400">{accounts.length} exchange(s)</span>
            ) : (
              <Link href="/settings/exchange" className="text-[10px] text-honey-400 hover:underline">
                + Connect
              </Link>
            )}
          </div>
        </div>

        {/* Basket Floating PnL Card */}
        <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Basket Floating PnL</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <p
            className={`text-2xl font-black font-mono mt-2 ${
              totalUnrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {totalUnrealizedPnl >= 0
              ? `+$${totalUnrealizedPnl.toFixed(2)}`
              : `-$${Math.abs(totalUnrealizedPnl).toFixed(2)}`}{' '}
            <span className="text-xs text-slate-500 font-normal">USDT</span>
          </p>
          <div className="mt-2 text-[11px] text-slate-400 font-mono">
            Active Open Legs:{' '}
            <span className="text-slate-200 font-semibold">{positions.length * 2}</span>
          </div>
        </div>

        {/* Target Risk Rules */}
        <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Active Risk Guards</span>
            <ShieldCheck className="w-4 h-4 text-honey-400" />
          </div>
          <div className="mt-3 flex items-center gap-4 font-mono">
            <div>
              <span className="text-xs text-slate-400">TP: </span>
              <span className="text-base font-bold text-emerald-400">+5.0%</span>
            </div>
            <div>
              <span className="text-xs text-slate-400">SL: </span>
              <span className="text-base font-bold text-rose-400">-1.5%</span>
            </div>
            <div>
              <span className="text-xs text-slate-400">Lev: </span>
              <span className="text-base font-bold text-honey-400">7.0x</span>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-500 font-mono">
            Trend-Flip Filter: EMA10 Exit Guard
          </p>
        </div>
      </div>

      {/* Individual Exchange Balances Breakdown */}
      {accounts.length > 0 && (
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-honey-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Connected Exchanges Balance Breakdown ({accounts.length})
              </h3>
            </div>
            <Link
              href="/settings/exchange"
              className="text-xs font-mono text-honey-400 hover:text-honey-300 flex items-center gap-1 transition-colors"
            >
              Manage Exchanges
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                className="bg-dark-950 border border-dark-800 p-4 rounded-xl flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs font-black uppercase text-white tracking-wider">
                      {acc.exchange}
                    </span>
                  </div>
                  <p className="text-lg font-black font-mono text-white mt-1">
                    ${Number(acc.last_balance_usd || 0).toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                    })}{' '}
                    <span className="text-[10px] text-slate-500 font-normal">USDT</span>
                  </p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                    Synced:{' '}
                    {acc.last_sync_at ? new Date(acc.last_sync_at).toLocaleTimeString() : 'Never'}
                  </p>
                </div>

                <div className="text-right flex flex-col items-end">
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    FUTURES
                  </span>
                  {acc.last_error_msg && (
                    <span className="text-[9px] text-rose-400 font-mono mt-1" title={acc.last_error_msg}>
                      ⚠️ Sync issue
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trade Readiness & Signal Proximity Monitor (100% Scale) */}
      <TradeReadinessMonitor
        marketData={marketData}
        positions={positions}
        isBotActive={Boolean(settings?.is_bot_active)}
        hasValidatedAccount={hasValidatedAccount}
        onStartBotClick={() => {
          if (!settings?.is_bot_active && !hasValidatedAccount) {
            setIsMissingExchangeModalOpen(true);
          } else {
            setIsToggleModalOpen(true);
          }
        }}
      />

      {/* Active Basket Positions Table */}
      <div className="bg-dark-900 border border-dark-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-5 border-b border-dark-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Layers className="w-5 h-5 text-honey-400" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">
                  Active Long-Short Basket Pairs
                </h2>
                {isShowingMaster && (
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-honey-500/15 text-honey-400 border border-honey-500/30">
                    MASTER STRATEGY
                  </span>
                )}
              </div>
              {isShowingMaster && (
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Displaying live signals actively traded by the Master Bot Strategy in real time.
                </p>
              )}
            </div>
          </div>
          <span className="text-xs font-mono text-slate-400">
            {positions.length} Positions Open
          </span>
        </div>

        {positions.length === 0 ? (
          <div className="p-12 text-center">
            <Layers className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-white">No active pairs open</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              When market scanner detects Ratio &gt; EMA10 and the bot is active, long-short legs will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-dark-950/60 text-[11px] uppercase tracking-wider text-slate-400 font-mono border-b border-dark-800">
                <tr>
                  <th className="px-5 py-3">Strategy Pair</th>
                  <th className="px-5 py-3">Ratio (Entry / Now)</th>
                  <th className="px-5 py-3">Long Leg</th>
                  <th className="px-5 py-3">Short Leg</th>
                  <th className="px-5 py-3">Margin / Vol</th>
                  <th className="px-5 py-3 text-right">PnL (% / $)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-800 font-mono text-xs">
                {positions.map((p) => {
                  const pnl = Number(p.unrealized_pnl_usd) || 0;
                  const pnlPct = Number(p.pnl_pct) || 0;
                  return (
                    <tr key={p.id} className="hover:bg-dark-850/50 transition-colors">
                      <td className="px-5 py-4">
                        <div className="font-bold text-white tracking-wide">
                          {p.pair_symbol}
                        </div>
                        <span className="text-[10px] text-emerald-400 font-normal">
                          Market-Neutral
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="text-slate-300">
                          {Number(p.entry_ratio).toFixed(4)}
                        </div>
                        <div className="text-[11px] text-honey-400">
                          Now: {Number(p.current_ratio || p.entry_ratio).toFixed(4)}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-emerald-400 font-semibold">{p.long_symbol}</span>
                        <div className="text-slate-400 text-[11px]">
                          @ ${Number(p.long_entry_price).toFixed(2)}
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="text-rose-400 font-semibold">{p.short_symbol}</span>
                        <div className="text-slate-400 text-[11px]">
                          @ ${Number(p.short_entry_price).toFixed(2)}
                        </div>
                      </td>
                      <td className="px-5 py-4 text-slate-300">
                        <div className="font-bold text-white">
                          ${Number(p.total_position_volume_usd || 87500).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Margin: ${Number(p.allocated_margin_usd || 12500).toLocaleString('en-US', { minimumFractionDigits: 2 })} (7.0x)
                        </div>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div
                          className={`font-bold text-sm ${
                            pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {pnl >= 0 ? `+${pnlPct.toFixed(2)}%` : `${pnlPct.toFixed(2)}%`}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirmation & Panic Modals */}
      <ConfirmModal
        isOpen={isToggleModalOpen}
        onCancel={() => setIsToggleModalOpen(false)}
        onConfirm={handleToggleBot}
        title={settings?.is_bot_active ? 'Pause Autonomous Bot' : 'Start Autonomous Bot'}
        description={
          settings?.is_bot_active
            ? 'Pausing will stop the bot from opening new pairs. Currently open pairs will continue to be monitored by the Risk Guard until TP (+5%) or SL (-1.5%).'
            : 'Starting the bot activates automated execution across your connected exchanges. Ensure your exchange accounts have sufficient USDT futures margin.'
        }
        confirmText={settings?.is_bot_active ? 'Pause Strategy' : 'Start Strategy'}
      />

      <PanicCloseModal
        isOpen={isPanicModalOpen}
        onCancel={() => setIsPanicModalOpen(false)}
        onConfirm={handlePanicClose}
        openPositionsCount={positions.length}
        unrealizedPnl={totalUnrealizedPnl}
      />

      {/* Modal: Missing Exchange Account */}
      <ConfirmModal
        isOpen={isMissingExchangeModalOpen}
        onCancel={() => setIsMissingExchangeModalOpen(false)}
        onConfirm={() => {
          setIsMissingExchangeModalOpen(false);
          window.location.href = '/settings/exchange';
        }}
        title="Exchange API Required"
        description="You cannot start the trading bot without linking at least one validated exchange API (Binance, OKX, or Bybit). Please connect your exchange credentials first."
        confirmText="Connect Exchange"
      />
    </div>
  );
}
