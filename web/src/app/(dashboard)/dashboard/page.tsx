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
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { PanicCloseModal } from '@/components/modals/PanicCloseModal';
import { TradeReadinessMonitor } from '@/components/dashboard/TradeReadinessMonitor';
import { toast } from '@/components/ui/sonner';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { isUnfilledSimulation } from '@/lib/positions';
import { playWarningSound } from '@/lib/sound';

export default function DashboardPage() {
  const { t, dateLocale, formatDateTime } = useLanguage();
  const [positions, setPositions] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [marketData, setMarketData] = useState<any[]>([]);
  const [isShowingMaster, setIsShowingMaster] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const hasAutoSyncedRef = useRef(false);
  const hasWarnedMarginRef = useRef(false);

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

    const liveUserPos = (userPos || []).filter((p) => !isUnfilledSimulation(p));

    if (liveUserPos.length > 0) {
      setPositions(liveUserPos);
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

    // Initial check for low free margin
    const freeMarginSum = currentAccounts.reduce(
      (sum, a) =>
        sum +
        (a.free_balance_usd !== null && a.free_balance_usd !== undefined
          ? Number(a.free_balance_usd)
          : Number(a.last_balance_usd) * 0.75),
      0
    );
    const primAcc =
      currentAccounts.find((a) => a.id === sett?.exchange_account_id) || currentAccounts[0];
    const isMarginLow =
      hasValidated &&
      (freeMarginSum < 20 ||
        Boolean(
          primAcc?.last_error_msg &&
            (primAcc.last_error_msg.toLowerCase().includes('insufficient free') ||
              primAcc.last_error_msg.toLowerCase().includes('free usdt'))
        ));

    if (isMarginLow && sett?.is_bot_active && !hasWarnedMarginRef.current) {
      hasWarnedMarginRef.current = true;
      playWarningSound();
      toast.warning(t('dashboard.toastLowMarginTitle'), {
        description: t('dashboard.toastLowMarginDesc', {
          free: freeMarginSum.toFixed(2),
          min: '20.00',
        }),
        duration: 9000,
      });
    }
  }

  async function handleSyncBalances(
    silent = false,
    opts?: { botActive?: boolean }
  ) {
    if (syncing) return;
    setSyncing(true);
    const botActive = opts?.botActive ?? Boolean(settings?.is_bot_active);
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

        const freeMarginSum = data.accounts.reduce(
          (sum: number, a: any) =>
            sum +
            (a.free_balance_usd !== null && a.free_balance_usd !== undefined
              ? Number(a.free_balance_usd)
              : Number(a.last_balance_usd) * 0.75),
          0
        );
        const primAcc =
          data.accounts.find((a: any) => a.id === settings?.exchange_account_id) || data.accounts[0];
        const isMarginLow =
          freeMarginSum < 20 ||
          Boolean(
            primAcc?.last_error_msg &&
              (primAcc.last_error_msg.toLowerCase().includes('insufficient free') ||
                primAcc.last_error_msg.toLowerCase().includes('free usdt'))
          );

        if (!silent) {
          // Margin warnings only matter while the bot is actively trading
          if (botActive && isMarginLow) {
            playWarningSound();
            toast.warning(t('dashboard.toastLowMarginTitle'), {
              description: t('dashboard.toastLowMarginDesc', {
                free: freeMarginSum.toFixed(2),
                min: '20.00',
              }),
              duration: 9000,
            });
          } else {
            const errorAccounts = data.accounts.filter(
              (a: any) => a.syncStatus === 'error' || a.last_error_msg
            );
            if (errorAccounts.length > 0 && errorAccounts[0].last_error_msg) {
              toast.error(t('dashboard.toastSyncError', { msg: errorAccounts[0].last_error_msg }));
            } else {
              toast.success(t('dashboard.toastBalancesUpdated'));
            }
          }
        }
      } else if (!silent) {
        toast.error(data?.error || t('dashboard.toastSyncFailed'));
      }
    } catch (err: any) {
      console.error('Failed to sync live balances:', err);
      if (!silent) {
        toast.error(err.message || t('dashboard.toastSyncFailed'));
      }
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    loadDashboardData();

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
      clearInterval(marketInterval);
      supabase.removeChannel(posChannel);
    };
  }, []);

  // Auto-sync exchange balances every 60s only while trading is active
  useEffect(() => {
    if (!settings?.is_bot_active) {
      hasAutoSyncedRef.current = false;
      hasWarnedMarginRef.current = false;
      return;
    }

    const isFirstSyncAfterStart = !hasAutoSyncedRef.current;
    hasAutoSyncedRef.current = true;
    // First sync after start may show margin toast; later interval syncs stay silent
    handleSyncBalances(!isFirstSyncAfterStart, { botActive: true });

    const syncInterval = setInterval(() => {
      handleSyncBalances(true, { botActive: true });
    }, 60000);

    return () => clearInterval(syncInterval);
  }, [settings?.is_bot_active]);

  const totalUnrealizedPnl = positions.reduce(
    (acc, p) => acc + (Number(p.unrealized_pnl_usd) || 0),
    0
  );

  const hasValidatedAccount = accounts.some((a) => a.is_validated);

  const primaryAccount =
    accounts.find((a) => a.id === settings?.exchange_account_id) || accounts[0];

  const totalAggregatedEquity = accounts.reduce(
    (sum, a) => sum + (Number(a.last_balance_usd) || 0),
    0
  );

  const totalFreeMargin = accounts.reduce(
    (sum, a) =>
      sum +
      (a.free_balance_usd !== null && a.free_balance_usd !== undefined
        ? Number(a.free_balance_usd)
        : Number(a.last_balance_usd) * 0.75),
    0
  );

  const isBotActive = Boolean(settings?.is_bot_active);

  const hasInsufficientMargin =
    isBotActive &&
    hasValidatedAccount &&
    (totalFreeMargin < 20 ||
      Boolean(
        primaryAccount?.last_error_msg &&
          (primaryAccount.last_error_msg.toLowerCase().includes('insufficient free') ||
            primaryAccount.last_error_msg.toLowerCase().includes('free usdt'))
      ));

  const handleToggleBot = async () => {
    if (!settings) return;

    // Check if at least one exchange account is linked and validated
    if (!hasValidatedAccount) {
      setIsToggleModalOpen(false);
      setIsMissingExchangeModalOpen(true);
      toast.error(t('dashboard.toastConnectFirst'));
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
        hasWarnedMarginRef.current = false;
        toast.success(t('dashboard.toastBotStarted'));
      } else {
        hasWarnedMarginRef.current = false;
        toast.info(t('dashboard.toastBotPaused'));
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
      toast.error(t('dashboard.toastPanic'));
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
            {t('dashboard.title')}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            {t('dashboard.subtitle')}
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
              <span className="hidden sm:inline">{syncing ? t('dashboard.syncing') : t('dashboard.syncBalances')}</span>
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
                <Pause className="w-4 h-4" /> {t('dashboard.pauseTrading')}
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" /> {t('dashboard.startTrading')}
              </>
            )}
          </button>

          <button
            onClick={() => setIsPanicModalOpen(true)}
            disabled={positions.length === 0}
            className="px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-rose-600/15 text-rose-400 border border-rose-600/30 hover:bg-rose-600/25 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <AlertOctagon className="w-4 h-4" />
            {t('dashboard.panicCloseAll')}
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
              <h4 className="text-sm font-bold text-white">{t('dashboard.noExchangeTitle')}</h4>
              <p className="text-xs text-slate-300 mt-0.5">
                {t('dashboard.noExchangeDesc')}
              </p>
            </div>
          </div>
          <Link
            href="/settings/exchange"
            className="px-4 py-2 rounded-xl text-xs font-bold bg-honey-500 hover:bg-honey-400 text-dark-950 flex items-center justify-center gap-1.5 transition-all shadow-md shadow-honey-500/20 shrink-0"
          >
            <KeyRound className="w-3.5 h-3.5" />
            {t('dashboard.connectApiKeys')}
          </Link>
        </div>
      )}

      {/* System Health Monitor */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-dark-900 border border-dark-800 p-3.5 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-medium text-slate-300">{t('dashboard.railwayDaemon')}</span>
          </div>
          <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
            {t('dashboard.online')}
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
              {t('dashboard.exchanges')} ({accounts.length > 0 ? accounts.map((a) => a.exchange.toUpperCase()).join(', ') : t('dashboard.none')})
            </span>
          </div>
          <span
            className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
              hasValidatedAccount
                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                : 'text-amber-400 bg-amber-500/10 border-amber-500/20'
            }`}
          >
            {hasValidatedAccount ? t('dashboard.connected', { count: accounts.length }) : t('dashboard.waitingKeys')}
          </span>
        </div>

        <div className="bg-dark-900 border border-dark-800 p-3.5 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                settings?.is_bot_active ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
              }`}
            />
            <span className="text-xs font-medium text-slate-300">{t('dashboard.botStrategyState')}</span>
          </div>
          <span
            className={`text-[11px] font-mono px-2 py-0.5 rounded border uppercase ${
              settings?.is_bot_active
                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                : 'text-slate-400 bg-dark-800 border-dark-700'
            }`}
          >
            {settings?.is_bot_active ? t('dashboard.active7x') : t('dashboard.idle')}
          </span>
        </div>
      </div>

      {/* Insufficient Margin Warning Banner */}
      {hasInsufficientMargin && (
        <div className="bg-gradient-to-r from-amber-950/40 via-amber-900/20 to-dark-900 border border-amber-500/40 rounded-2xl p-5 shadow-2xl relative overflow-hidden animate-in fade-in duration-200">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 shrink-0 mt-0.5">
                <AlertTriangle className="w-5 h-5 animate-pulse" />
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold text-white tracking-tight">
                    {t('dashboard.insufficientMarginTitle')}
                  </h3>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full font-bold uppercase bg-rose-500/20 text-rose-300 border border-rose-500/30">
                    {t('dashboard.freeMargin')}: ${totalFreeMargin.toFixed(2)} USDT
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed max-w-3xl">
                  {t('dashboard.insufficientMarginDesc', {
                    exchange: (primaryAccount?.exchange || 'exchange').toUpperCase(),
                    free: totalFreeMargin.toFixed(2),
                    total: totalAggregatedEquity.toFixed(2),
                    min: '20.00',
                    minTotal: '80.00',
                  })}
                </p>
                <p className="text-[11px] text-amber-400 font-medium">
                  {t('dashboard.insufficientMarginHint')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-center">
              <button
                onClick={() => handleSyncBalances(false)}
                disabled={syncing}
                className="px-3.5 py-2 rounded-xl bg-dark-900 border border-dark-700 hover:border-honey-500/40 text-xs font-mono font-medium text-slate-300 hover:text-white transition-colors flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-honey-400' : ''}`} />
                <span>{syncing ? t('common.loading') : t('dashboard.syncBalances')}</span>
              </button>
              <Link
                href="/settings/exchange"
                className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-dark-950 text-xs font-bold font-mono transition-colors flex items-center gap-1"
              >
                {t('dashboard.manageExchanges')}
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Key Financial Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Total Account Equity Card */}
        <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl relative">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>{t('dashboard.totalEquity')}</span>
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
            ${totalAggregatedEquity.toLocaleString(dateLocale, {
              minimumFractionDigits: 2,
            })}{' '}
            <span className="text-xs text-slate-500 font-normal">USDT</span>
          </p>
          <div className="mt-2 text-[11px] text-slate-400 font-mono flex items-center justify-between">
            <span>
              {t('dashboard.freeMargin')}:{' '}
              <span
                className={`font-semibold ${
                  totalFreeMargin < 20 ? 'text-rose-400 font-bold' : 'text-emerald-400'
                }`}
              >
                ${totalFreeMargin.toLocaleString(dateLocale, { minimumFractionDigits: 2 })}
              </span>
              {totalFreeMargin < 20 && (
                <span className="ml-1 text-[9px] px-1 py-0.2 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  {t('dashboard.lowMarginBadge')}
                </span>
              )}
            </span>
            {accounts.length > 0 ? (
              <span className="text-[10px] text-slate-400">
                {t('dashboard.lockedMargin')}: $
                {Math.max(0, totalAggregatedEquity - totalFreeMargin).toFixed(2)}
              </span>
            ) : (
              <Link href="/settings/exchange" className="text-[10px] text-honey-400 hover:underline">
                {t('dashboard.connect')}
              </Link>
            )}
          </div>
        </div>

        {/* Basket Floating PnL Card */}
        <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>{t('dashboard.basketPnl')}</span>
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
            {t('dashboard.activeOpenLegs')}{' '}
            <span className="text-slate-200 font-semibold">{positions.length * 2}</span>
          </div>
        </div>

        {/* Target Risk Rules */}
        <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>{t('dashboard.activeRiskGuards')}</span>
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
            {t('dashboard.trendFlipFilter')}
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
                {t('dashboard.balanceBreakdown', { count: accounts.length })}
              </h3>
            </div>
            <Link
              href="/settings/exchange"
              className="text-xs font-mono text-honey-400 hover:text-honey-300 flex items-center gap-1 transition-colors"
            >
              {t('dashboard.manageExchanges')}
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
                    {settings?.exchange_account_id === acc.id && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded font-bold bg-honey-500/10 text-honey-400 border border-honey-500/30">
                        {t('dashboard.trading')}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-baseline gap-2 mt-1 font-mono">
                    <p className="text-lg font-black text-white">
                      ${Number(acc.last_balance_usd || 0).toLocaleString(dateLocale, {
                        minimumFractionDigits: 2,
                      })}{' '}
                      <span className="text-[10px] text-slate-500 font-normal">USDT</span>
                    </p>
                    <span className="text-xs text-slate-600">•</span>
                    <p
                      className={`text-xs font-bold ${
                        Number(acc.free_balance_usd ?? 0) < 20 ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {t('dashboard.freeMargin')}: $
                      {Number(acc.free_balance_usd ?? 0).toLocaleString(dateLocale, {
                        minimumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                  {acc.last_error_msg && (
                    <div className="mt-1.5 flex items-start gap-1.5 text-[10px] text-rose-400 font-mono bg-rose-500/10 p-1.5 rounded border border-rose-500/20 max-w-xs">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-400" />
                      <span className="line-clamp-2" title={acc.last_error_msg}>
                        {acc.last_error_msg}
                      </span>
                    </div>
                  )}
                  <p className="text-[10px] text-slate-500 font-mono mt-1">
                    {t('dashboard.synced')}{' '}
                    {acc.last_sync_at ? formatDateTime(acc.last_sync_at) : t('common.never')}
                  </p>
                </div>

                <div className="text-right flex flex-col items-end">
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    {t('dashboard.futures')}
                  </span>
                  {acc.last_error_msg && (
                    <span className="text-[9px] text-rose-400 font-mono mt-1" title={acc.last_error_msg}>
                      {t('dashboard.syncIssue')}
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
        isBotActive={isBotActive}
        hasValidatedAccount={hasValidatedAccount}
        freeMargin={totalFreeMargin}
        hasInsufficientMargin={hasInsufficientMargin}
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
                  {t('dashboard.activePairs')}
                </h2>
                {isShowingMaster && (
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-honey-500/15 text-honey-400 border border-honey-500/30">
                    {t('dashboard.masterStrategy')}
                  </span>
                )}
              </div>
              {isShowingMaster && (
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {t('dashboard.masterHint')}
                </p>
              )}
            </div>
          </div>
          <span className="text-xs font-mono text-slate-400">
            {t('dashboard.positionsOpen', { count: positions.length })}
          </span>
        </div>

        {positions.length === 0 ? (
          <div className="p-12 text-center">
            <Layers className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-white">{t('dashboard.noPairsTitle')}</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              {t('dashboard.noPairsDesc')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-dark-950/60 text-[11px] uppercase tracking-wider text-slate-400 font-mono border-b border-dark-800">
                <tr>
                  <th className="px-5 py-3">{t('dashboard.colPair')}</th>
                  <th className="px-5 py-3">{t('dashboard.colRatio')}</th>
                  <th className="px-5 py-3">{t('dashboard.colLong')}</th>
                  <th className="px-5 py-3">{t('dashboard.colShort')}</th>
                  <th className="px-5 py-3">{t('dashboard.colMargin')}</th>
                  <th className="px-5 py-3 text-right">{t('dashboard.colPnl')}</th>
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
                          {t('dashboard.marketNeutral')}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="text-slate-300">
                          {Number(p.entry_ratio).toFixed(4)}
                        </div>
                        <div className="text-[11px] text-honey-400">
                          {t('dashboard.now')} {Number(p.current_ratio || p.entry_ratio).toFixed(4)}
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
                          ${Number(p.total_position_volume_usd || 87500).toLocaleString(dateLocale, { minimumFractionDigits: 2 })}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {t('dashboard.margin')} ${Number(p.allocated_margin_usd || 12500).toLocaleString(dateLocale, { minimumFractionDigits: 2 })} (7.0x)
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
        title={settings?.is_bot_active ? t('dashboard.pauseTitle') : t('dashboard.startTitle')}
        description={
          settings?.is_bot_active
            ? t('dashboard.pauseDesc')
            : t('dashboard.startDesc')
        }
        confirmText={settings?.is_bot_active ? t('dashboard.pauseConfirm') : t('dashboard.startConfirm')}
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
        title={t('dashboard.exchangeRequiredTitle')}
        description={t('dashboard.exchangeRequiredDesc')}
        confirmText={t('dashboard.connectExchange')}
      />
    </div>
  );
}
