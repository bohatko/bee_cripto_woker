'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  Copy,
  Check,
  CheckCircle2,
  Trash2,
  Server,
  Lock,
  RefreshCw,
  Wallet,
  Building2,
  Activity,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { toast } from '@/components/ui/sonner';
import { useLanguage } from '@/lib/i18n/LanguageContext';

interface ExchangeAccountItem {
  id: string;
  exchange: 'binance' | 'okx' | 'bybit';
  account_name: string;
  is_active: boolean;
  is_validated: boolean;
  can_withdraw: boolean;
  can_trade_futures: boolean;
  last_balance_usd: number;
  last_sync_at: string | null;
  last_error_msg: string | null;
}

interface TradingSettingsItem {
  id: string;
  exchange_account_id: string | null;
  is_bot_active: boolean;
}

export default function ExchangeSettingsPage() {
  const { t, dateLocale } = useLanguage();
  const [selectedExchange, setSelectedExchange] = useState<'binance' | 'okx' | 'bybit'>('binance');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [isPrimaryForTrading, setIsPrimaryForTrading] = useState(true);

  const [loading, setLoading] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [settingPrimary, setSettingPrimary] = useState(false);
  const [copied, setCopied] = useState(false);

  const [accounts, setAccounts] = useState<ExchangeAccountItem[]>([]);
  const [tradingSettings, setTradingSettings] = useState<TradingSettingsItem | null>(null);

  // Modals state
  const [accountToDelete, setAccountToDelete] = useState<ExchangeAccountItem | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [targetPrimaryAccount, setTargetPrimaryAccount] = useState<ExchangeAccountItem | null>(null);
  const [isSwitchPrimaryModalOpen, setIsSwitchPrimaryModalOpen] = useState(false);

  const railwayStaticIp = process.env.NEXT_PUBLIC_RAILWAY_EGRESS_IP || '54.198.120.45';
  const hasAutoSyncedRef = useRef(false);

  async function loadAccountsAndSettings() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // 1. Fetch exchange accounts
    const { data: accData } = await supabase
      .from('exchange_accounts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    const accList = (accData || []) as ExchangeAccountItem[];
    setAccounts(accList);

    // 2. Fetch trading settings to know primary exchange
    const { data: settData } = await supabase
      .from('trading_settings')
      .select('id, exchange_account_id, is_bot_active')
      .eq('user_id', user.id)
      .maybeSingle();

    if (settData) {
      setTradingSettings(settData);
    }

    // Auto-determine default checkbox state:
    // If user has no active primary account yet, enable by default
    const hasActivePrimary = settData?.exchange_account_id && accList.some((a) => a.id === settData.exchange_account_id);
    setIsPrimaryForTrading(!hasActivePrimary);

    // Initial silent sync once if accounts exist
    if (accList.length > 0 && !hasAutoSyncedRef.current) {
      hasAutoSyncedRef.current = true;
      handleSyncAll(true);
    }
  }

  useEffect(() => {
    loadAccountsAndSettings();
  }, []);

  // Update isPrimaryForTrading when selectedExchange changes
  useEffect(() => {
    setApiKey('');
    setApiSecret('');
    setPassphrase('');

    const hasActivePrimary =
      tradingSettings?.exchange_account_id &&
      accounts.some((a) => a.id === tradingSettings.exchange_account_id);

    setIsPrimaryForTrading(!hasActivePrimary);
  }, [selectedExchange, tradingSettings, accounts]);

  const handleCopyIp = () => {
    navigator.clipboard.writeText(railwayStaticIp);
    setCopied(true);
    toast.success(t('exchange.ipCopied'));
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveKeys = async () => {
    setLoading(true);
    setIsSaveModalOpen(false);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated. Please sign in again.');

      const response = await fetch('/api/exchange/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          exchange: selectedExchange,
          apiKey: apiKey.trim(),
          apiSecret: apiSecret.trim(),
          passphrase: selectedExchange === 'okx' ? passphrase.trim() : undefined,
          isPrimary: isPrimaryForTrading,
        }),
      });

      const resData = await response.json();

      if (!response.ok) {
        throw new Error(resData.error || 'Failed to validate exchange API credentials');
      }

      toast.success(
        t('exchange.validatedSuccess', {
          exchange: selectedExchange.toUpperCase(),
          balance: Number(resData.balanceUsd || 0).toLocaleString(dateLocale, { minimumFractionDigits: 2 }),
        })
      );

      setApiKey('');
      setApiSecret('');
      setPassphrase('');
      await loadAccountsAndSettings();
    } catch (err: any) {
      const errorText = err.message || 'Failed to save exchange credentials';
      toast.error(errorText);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncAll = async (silent = false) => {
    setSyncingAll(true);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch('/api/exchange/sync-balances', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to sync balances');

      const successText = t('exchange.balancesRefreshed', {
        total: Number(data.totalEquityUsd || 0).toLocaleString(dateLocale, { minimumFractionDigits: 2 }),
        count: data.accounts?.length || 0,
      });

      if (!silent) {
        toast.success(successText);
      }

      await loadAccountsAndSettings();
    } catch (err: any) {
      const errorText = err.message || 'Failed to sync exchange balances';
      if (!silent) {
        toast.error(errorText);
      }
    } finally {
      setSyncingAll(false);
    }
  };

  const handleSwitchPrimary = async (targetAccount: ExchangeAccountItem) => {
    setSettingPrimary(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch('/api/exchange/set-primary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ accountId: targetAccount.id }),
      });

      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || 'Failed to update trading exchange');

      toast.success(t('exchange.nowPrimary', { exchange: targetAccount.exchange.toUpperCase() }));
      setIsSwitchPrimaryModalOpen(false);
      setTargetPrimaryAccount(null);
      await loadAccountsAndSettings();
    } catch (err: any) {
      toast.error(err.message || 'Failed to switch primary exchange');
    } finally {
      setSettingPrimary(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!accountToDelete) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();

    await supabase.from('exchange_accounts').delete().eq('id', accountToDelete.id);

    // Check if the deleted account was the primary trading account
    const remaining = accounts.filter((a) => a.id !== accountToDelete.id);
    if (user) {
      if (tradingSettings?.exchange_account_id === accountToDelete.id) {
        if (remaining.length === 0) {
          // No accounts left, pause bot and set primary to null
          await supabase
            .from('trading_settings')
            .update({ exchange_account_id: null, is_bot_active: false })
            .eq('user_id', user.id);
        } else {
          // Automatically promote the first remaining validated account
          const nextPrimary = remaining[0];
          await supabase
            .from('trading_settings')
            .update({ exchange_account_id: nextPrimary.id })
            .eq('user_id', user.id);
          toast.info(t('exchange.autoPrimary', { exchange: nextPrimary.exchange.toUpperCase() }));
        }
      }
    }

    setAccountToDelete(null);
    setIsDeleteModalOpen(false);
    toast.success(t('exchange.removed', { exchange: accountToDelete.exchange.toUpperCase() }));
    await loadAccountsAndSettings();
  };

  const totalAggregatedEquity = accounts.reduce(
    (acc, item) => acc + (Number(item.last_balance_usd) || 0),
    0
  );

  const activeTradingAccount = accounts.find(
    (a) => a.id === tradingSettings?.exchange_account_id
  );

  // Current selected exchange account (if connected)
  const currentTabAccount = accounts.find((a) => a.exchange === selectedExchange);
  const isCurrentTabPrimary = Boolean(
    currentTabAccount && tradingSettings?.exchange_account_id === currentTabAccount.id
  );

  return (
    <div className="p-4 sm:p-8 max-w-5xl space-y-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            {t('exchange.title')}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            {t('exchange.subtitle')}
          </p>
        </div>

        {accounts.length > 0 && (
          <button
            onClick={() => handleSyncAll(false)}
            disabled={syncingAll}
            className="px-4 py-2.5 rounded-xl text-xs font-bold bg-dark-900 border border-dark-700 hover:border-honey-500 text-slate-200 hover:text-white flex items-center gap-2 transition-all shadow-lg disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-honey-400 ${syncingAll ? 'animate-spin' : ''}`} />
            {syncingAll ? t('exchange.syncing') : t('exchange.syncLive')}
          </button>
        )}
      </div>

      {/* Primary Trading Exchange Status & Total Equity Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl sm:col-span-2 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              {t('exchange.primaryExchange')}
            </span>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase ${
                activeTradingAccount
                  ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                  : 'text-amber-400 bg-amber-500/10 border-amber-500/20'
              }`}
            >
              {activeTradingAccount ? t('exchange.botTradingActive') : t('exchange.noTradingExchange')}
            </span>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <div className={`p-3 rounded-xl border ${activeTradingAccount ? 'bg-honey-500/10 border-honey-500/30 text-honey-400' : 'bg-dark-950 border-dark-800 text-slate-500'}`}>
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <p className="text-lg font-black text-white uppercase tracking-wide">
                {activeTradingAccount
                  ? t('exchange.futuresLabel', { exchange: activeTradingAccount.exchange })
                  : t('exchange.notSelected')}
              </p>
              <p className="text-xs text-slate-400">
                {activeTradingAccount
                  ? t('exchange.strategyOnAccount', {
                      balance: Number(activeTradingAccount.last_balance_usd || 0).toLocaleString(dateLocale, {
                        minimumFractionDigits: 2,
                      }),
                    })
                  : t('exchange.connectBelow')}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span className="font-bold uppercase tracking-wider">{t('exchange.totalEquity')}</span>
            <Wallet className="w-4 h-4 text-honey-400" />
          </div>
          <div className="mt-2">
            <p className="text-2xl font-black text-white font-mono">
              ${totalAggregatedEquity.toLocaleString(dateLocale, { minimumFractionDigits: 2 })}{' '}
              <span className="text-xs text-slate-500 font-normal">USDT</span>
            </p>
            <p className="text-[11px] text-slate-400 font-mono mt-1">
              {t('exchange.connectedOf')}{' '}
              <span className="text-emerald-400 font-semibold">{t('exchange.of3', { count: accounts.length })}</span>{' '}
              {t('exchange.of3Exchanges')}
            </p>
          </div>
        </div>
      </div>

      {/* Railway Static IP Whitelist Card */}
      <div className="bg-dark-900 border border-honey-500/30 rounded-2xl p-5 shadow-xl relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-honey-500/10 text-honey-400 border border-honey-500/20">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{t('exchange.railwayIpTitle')}</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {t('exchange.railwayIpDesc')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <code className="px-3.5 py-2 bg-dark-950 border border-dark-700 rounded-xl font-mono text-sm text-honey-400 font-bold">
              {railwayStaticIp}
            </code>
            <button
              onClick={handleCopyIp}
              className="p-2.5 bg-dark-800 hover:bg-dark-700 border border-dark-700 rounded-xl text-slate-300 hover:text-white transition-colors"
              title="Copy IP"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Main Exchange Tabs Section */}
      <div className="space-y-4">
        {/* Exchange Selector Tabs with Status Indicators */}
        <div className="grid grid-cols-3 gap-3">
          {(['binance', 'okx', 'bybit'] as const).map((ex) => {
            const acc = accounts.find((a) => a.exchange === ex);
            const isPrimary = acc && tradingSettings?.exchange_account_id === acc.id;
            const isSelected = selectedExchange === ex;

            return (
              <button
                key={ex}
                onClick={() => setSelectedExchange(ex)}
                className={`p-3.5 sm:p-4 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-2 border transition-all text-left ${
                  isSelected
                    ? 'bg-dark-900 border-honey-500 ring-2 ring-honey-500/20 shadow-xl'
                    : 'bg-dark-950 border-dark-800 hover:border-dark-700 hover:bg-dark-900/60'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      acc ? (isPrimary ? 'bg-honey-400 animate-pulse' : 'bg-emerald-400') : 'bg-slate-600'
                    }`}
                  />
                  <span
                    className={`text-sm sm:text-base font-black uppercase tracking-wider ${
                      isSelected ? 'text-white' : 'text-slate-300'
                    }`}
                  >
                    {ex}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  {acc ? (
                    isPrimary ? (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded font-bold bg-honey-500/10 text-honey-400 border border-honey-500/30 flex items-center gap-1">
                        <Activity className="w-3 h-3 text-honey-400" /> {t('exchange.trading')}
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {t('exchange.connected')}
                      </span>
                    )
                  ) : (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded text-slate-500 bg-dark-900 border border-dark-800">
                      {t('exchange.connect')}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Tab Content Box */}
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 sm:p-8 shadow-2xl">
          {currentTabAccount ? (
            /* ============================================================
             * STATE 1: EXCHANGE IS ALREADY CONNECTED (1 ACCOUNT PER EXCHANGE)
             * New key input is blocked; shows full account card & trading toggle.
             * ============================================================ */
            <div className="space-y-6">
              {/* Account Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-dark-800 gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-dark-950 border border-dark-700 rounded-xl text-honey-400">
                    <Building2 className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                      <h2 className="text-xl font-black text-white uppercase tracking-wider">
                        {t('exchange.futuresLabel', { exchange: currentTabAccount.exchange })}
                      </h2>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {t('exchange.connected')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {t('exchange.accountId')} <span className="font-mono text-slate-300">{currentTabAccount.id.slice(0, 8)}...</span> • {t('exchange.encrypted')}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setAccountToDelete(currentTabAccount);
                    setIsDeleteModalOpen(true);
                  }}
                  className="px-3.5 py-2 text-xs font-semibold text-rose-400 hover:text-white bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-xl flex items-center gap-2 transition-all self-start sm:self-auto"
                  title="Remove Exchange Keys"
                >
                  <Trash2 className="w-4 h-4" />
                  {t('exchange.disconnect')}
                </button>
              </div>

              {/* Single Account Limit Notice */}
              <div className="bg-dark-950 border border-dark-800 rounded-xl p-3.5 flex items-center gap-3">
                <ShieldCheck className="w-4 h-4 text-honey-400 shrink-0" />
                <p className="text-xs text-slate-400">
                  {t('exchange.singleLimit', { exchange: currentTabAccount.exchange.toUpperCase() })}
                </p>
              </div>

              {/* Trading Permission Section (Primary Trading Exchange Switcher) */}
              <div
                className={`p-5 rounded-2xl border transition-all ${
                  isCurrentTabPrimary
                    ? 'bg-honey-500/5 border-honey-500/40 shadow-lg shadow-honey-500/5'
                    : 'bg-dark-950 border-dark-800'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div
                      className={`p-2.5 rounded-xl border mt-0.5 ${
                        isCurrentTabPrimary
                          ? 'bg-honey-500/20 text-honey-400 border-honey-500/30'
                          : 'bg-dark-900 text-slate-400 border-dark-700'
                      }`}
                    >
                      <Activity className="w-5 h-5 text-honey-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-white">
                          {t('exchange.botPermission')}
                        </h3>
                        {isCurrentTabPrimary ? (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded font-bold bg-honey-500 text-dark-950 shadow-sm">
                            {t('exchange.activeTrading')}
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded text-slate-400 bg-dark-900 border border-dark-800">
                            {t('exchange.standby')}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-1 max-w-xl">
                        {isCurrentTabPrimary
                          ? t('exchange.botOnThis', { exchange: currentTabAccount.exchange.toUpperCase() })
                          : t('exchange.routedTo', {
                              exchange: activeTradingAccount
                                ? activeTradingAccount.exchange.toUpperCase()
                                : t('exchange.anotherAccount'),
                            })}
                      </p>
                    </div>
                  </div>

                  <div>
                    {isCurrentTabPrimary ? (
                      <div className="flex items-center gap-2 text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3.5 py-2 rounded-xl">
                        <CheckCircle2 className="w-4 h-4" />
                        {t('exchange.tradingAllowed')}
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setTargetPrimaryAccount(currentTabAccount);
                          setIsSwitchPrimaryModalOpen(true);
                        }}
                        disabled={settingPrimary}
                        className="px-4 py-2 rounded-xl text-xs font-bold bg-honey-500 hover:bg-honey-400 text-dark-950 transition-all shadow-md shadow-honey-500/20 flex items-center gap-2 disabled:opacity-50"
                      >
                        <Activity className="w-3.5 h-3.5 text-dark-950" />
                        {t('exchange.setActive')}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Balance & Diagnostics Metrics */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-dark-950 p-4 rounded-xl border border-dark-800">
                  <span className="text-[10px] text-slate-400 uppercase font-medium tracking-wider">
                    {t('exchange.futuresBalance')}
                  </span>
                  <p className="text-2xl font-black text-white font-mono mt-1">
                    ${Number(currentTabAccount.last_balance_usd || 0).toLocaleString(dateLocale, {
                      minimumFractionDigits: 2,
                    })}{' '}
                    <span className="text-xs text-slate-500 font-normal">USDT</span>
                  </p>
                  <p className="text-[10px] text-slate-500 font-mono mt-1.5">
                    {t('exchange.lastSynced')}{' '}
                    {currentTabAccount.last_sync_at
                      ? new Date(currentTabAccount.last_sync_at).toLocaleTimeString(dateLocale)
                      : t('common.never')}
                  </p>
                </div>

                <div className="bg-dark-950 p-4 rounded-xl border border-dark-800 flex flex-col justify-between">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase font-medium tracking-wider">
                      {t('exchange.securityPerms')}
                    </span>
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center gap-2 text-xs text-emerald-400 font-mono">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{t('exchange.withdrawalsDisabled')}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                        <Lock className="w-3.5 h-3.5 text-honey-400" />
                        <span>{t('exchange.aesStorage')}</span>
                      </div>
                    </div>
                  </div>

                  {currentTabAccount.last_error_msg && (
                    <p className="text-[11px] text-rose-400 font-mono mt-2 line-clamp-2">
                      ⚠️ {currentTabAccount.last_error_msg}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* ============================================================
             * STATE 2: EXCHANGE NOT CONNECTED YET
             * Shows the API Key connection form with "Allowed for Trading" checkbox.
             * ============================================================ */
            <div>
              <div className="mb-6">
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <KeyRound className="w-5 h-5 text-honey-400" />
                  {t('exchange.linkKeys', { exchange: selectedExchange.toUpperCase() })}
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  {t('exchange.linkDesc', { exchange: selectedExchange.toUpperCase() })}
                </p>
              </div>

              {/* Form Inputs */}
              <div className="space-y-4 max-w-xl">
                <div>
                  <label className="block text-xs font-medium text-slate-300 uppercase mb-1.5">
                    {t('exchange.apiKey', { exchange: selectedExchange.toUpperCase() })}
                  </label>
                  <input
                    type="text"
                    required
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={t('exchange.apiKeyPlaceholder', { exchange: selectedExchange })}
                    className="w-full px-4 py-2.5 bg-dark-950 border border-dark-700 rounded-xl text-white text-sm outline-none focus:border-honey-500 font-mono transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 uppercase mb-1.5">
                    {t('exchange.apiSecret', { exchange: selectedExchange.toUpperCase() })}
                  </label>
                  <input
                    type="password"
                    required
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value)}
                    placeholder="••••••••••••••••••••••••••••••••"
                    className="w-full px-4 py-2.5 bg-dark-950 border border-dark-700 rounded-xl text-white text-sm outline-none focus:border-honey-500 font-mono transition-colors"
                  />
                </div>

                {selectedExchange === 'okx' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 uppercase mb-1.5">
                      {t('exchange.okxPassphrase')}
                    </label>
                    <input
                      type="password"
                      required
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder={t('exchange.okxPassphrasePlaceholder')}
                      className="w-full px-4 py-2.5 bg-dark-950 border border-dark-700 rounded-xl text-white text-sm outline-none focus:border-honey-500 font-mono transition-colors"
                    />
                  </div>
                )}

                {/* Primary Trading Exchange Checkbox (Allowed for Trading) */}
                <div className="p-4 rounded-xl bg-dark-950 border border-dark-800 mt-2">
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPrimaryForTrading}
                      onChange={(e) => setIsPrimaryForTrading(e.target.checked)}
                      className="mt-0.5 w-4 h-4 text-honey-500 bg-dark-900 border-dark-700 rounded focus:ring-honey-500 focus:ring-offset-dark-950 accent-honey-500"
                    />
                    <div>
                      <span className="text-xs font-bold text-white flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5 text-honey-400" />
                        {t('exchange.allowTrading')}
                      </span>
                      <p className="text-[11px] text-slate-400 mt-1">
                        {accounts.length === 0 || !activeTradingAccount ? (
                          <span className="text-honey-400 font-medium">
                            {t('exchange.firstAccount')}
                          </span>
                        ) : isPrimaryForTrading ? (
                          <span className="text-amber-400">
                            {t('exchange.willReplace', {
                              exchange: selectedExchange.toUpperCase(),
                              current: activeTradingAccount?.exchange.toUpperCase(),
                            })}
                          </span>
                        ) : (
                          <span>
                            {t('exchange.leaveUnchecked', {
                              current: activeTradingAccount?.exchange.toUpperCase(),
                            })}
                          </span>
                        )}
                      </p>
                    </div>
                  </label>
                </div>

                {/* Permission Requirements Reminder */}
                <div className="p-4 bg-dark-950 border border-dark-800 rounded-xl space-y-2 text-xs text-slate-400">
                  <div className="flex items-center gap-2 text-honey-400 font-semibold uppercase text-[11px]">
                    <Lock className="w-3.5 h-3.5" />
                    {t('exchange.permRequirements')}
                  </div>
                  <ul className="list-disc list-inside space-y-1 font-mono text-[11px]">
                    <li>{t('exchange.enableFutures')}</li>
                    <li>{t('exchange.doNotWithdraw')}</li>
                    <li>{t('exchange.addIp')} <span className="text-honey-400 font-bold">{railwayStaticIp}</span></li>
                  </ul>
                </div>

                <button
                  type="button"
                  disabled={loading || !apiKey || !apiSecret || (selectedExchange === 'okx' && !passphrase)}
                  onClick={() => setIsSaveModalOpen(true)}
                  className="w-full py-3 bg-honey-500 hover:bg-honey-400 disabled:opacity-50 text-dark-950 font-bold text-sm rounded-xl transition-all shadow-lg shadow-honey-500/20 flex items-center justify-center gap-2 mt-2"
                >
                  {loading ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      {t('exchange.validating')}
                    </>
                  ) : (
                    <>
                      <KeyRound className="w-4 h-4" />
                      {t('exchange.validateLink', { exchange: selectedExchange.toUpperCase() })}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Save / Link Confirmation Modal */}
      <ConfirmModal
        isOpen={isSaveModalOpen}
        title={t('exchange.connectTitle', { exchange: selectedExchange.toUpperCase() })}
        description={
          isPrimaryForTrading
            ? t('exchange.connectDescActive', { exchange: selectedExchange.toUpperCase() })
            : t('exchange.connectDescStandby', { exchange: selectedExchange.toUpperCase() })
        }
        confirmText={loading ? t('exchange.validating') : t('exchange.validateConnect')}
        onConfirm={handleSaveKeys}
        onCancel={() => setIsSaveModalOpen(false)}
      />

      {/* Switch Primary Trading Account Modal */}
      {targetPrimaryAccount && (
        <ConfirmModal
          isOpen={isSwitchPrimaryModalOpen}
          title={t('exchange.switchTitle', { exchange: targetPrimaryAccount.exchange.toUpperCase() })}
          description={t('exchange.switchDesc', {
            exchange: targetPrimaryAccount.exchange.toUpperCase(),
            balance: Number(targetPrimaryAccount.last_balance_usd || 0).toLocaleString(dateLocale, {
              minimumFractionDigits: 2,
            }),
          })}
          confirmText={
            settingPrimary
              ? t('exchange.switching')
              : t('exchange.setActiveBtn', { exchange: targetPrimaryAccount.exchange.toUpperCase() })
          }
          onConfirm={() => handleSwitchPrimary(targetPrimaryAccount)}
          onCancel={() => {
            setIsSwitchPrimaryModalOpen(false);
            setTargetPrimaryAccount(null);
          }}
        />
      )}

      {/* Delete / Disconnect Account Confirmation Modal */}
      {accountToDelete && (
        <ConfirmModal
          isOpen={isDeleteModalOpen}
          title={t('exchange.disconnectTitle', { exchange: accountToDelete.exchange.toUpperCase() })}
          description={`${t('exchange.disconnectDesc', { exchange: accountToDelete.exchange.toUpperCase() })}${
            tradingSettings?.exchange_account_id === accountToDelete.id
              ? t('exchange.disconnectPrimaryNote')
              : ''
          }`}
          confirmText={t('exchange.yesDisconnect')}
          isDestructive={true}
          variant="danger"
          onConfirm={handleDeleteAccount}
          onCancel={() => {
            setAccountToDelete(null);
            setIsDeleteModalOpen(false);
          }}
        />
      )}
    </div>
  );
}
