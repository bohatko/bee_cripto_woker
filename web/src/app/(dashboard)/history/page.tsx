'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  History,
  TrendingUp,
  TrendingDown,
  Filter,
  Sparkles,
  CheckCircle2,
  ShieldAlert,
  Layers,
  KeyRound,
  Play,
  ArrowRight,
  UserCheck,
  Bot,
  ExternalLink,
  Wallet,
  DollarSign,
  Scale,
  Percent,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export default function HistoryPage() {
  const { t, dateLocale } = useLanguage();
  const [activeTab, setActiveTab] = useState<'all' | 'user' | 'master'>('all');
  const [selectedPair, setSelectedPair] = useState<string>('ALL');
  const [masterPositions, setMasterPositions] = useState<any[]>([]);
  const [userPositions, setUserPositions] = useState<any[]>([]);
  const [userExchangeBalance, setUserExchangeBalance] = useState<number>(0);
  const [userAccountCount, setUserAccountCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const BOT_STARTING_BALANCE = 50000; // $50,000 starting base capital for Master Strategy

  useEffect(() => {
    async function loadHistory() {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // 1. Fetch Master bot positions (6-month backtest + live master trades)
      const { data: masterData } = await supabase
        .from('bot_positions')
        .select('*, exchange_accounts(exchange, account_name)')
        .eq('is_master', true)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false });

      if (masterData) setMasterPositions(masterData);

      // 2. Fetch User's personal exchange trades and exchange balance
      if (user) {
        const { data: userData } = await supabase
          .from('bot_positions')
          .select('*, exchange_accounts(exchange, account_name)')
          .eq('user_id', user.id)
          .eq('status', 'closed')
          .order('closed_at', { ascending: false });

        if (userData) setUserPositions(userData);

        // Fetch user's active exchange accounts for balance display
        const { data: userAccounts } = await supabase
          .from('exchange_accounts')
          .select('last_balance_usd, is_active')
          .eq('user_id', user.id)
          .eq('is_active', true);

        if (userAccounts && userAccounts.length > 0) {
          const totalBal = userAccounts.reduce(
            (acc, a) => acc + (Number(a.last_balance_usd) || 0),
            0
          );
          setUserExchangeBalance(totalBal);
          setUserAccountCount(userAccounts.length);
        }
      }

      setLoading(false);
    }
    loadHistory();
  }, []);

  // Determine current active list based on tab
  const currentList =
    activeTab === 'all'
      ? [...userPositions, ...masterPositions]
      : activeTab === 'user'
      ? userPositions
      : masterPositions;

  // Filter by pair
  const filteredPositions =
    selectedPair === 'ALL'
      ? currentList
      : currentList.filter((p) => p.pair_symbol === selectedPair);

  const totalRealizedPnl = filteredPositions.reduce(
    (acc, p) => acc + (Number(p.realized_pnl_usd) || 0),
    0
  );

  const totalVolumeTraded = filteredPositions.reduce(
    (acc, p) => acc + (Number(p.total_position_volume_usd) || 0),
    0
  );

  const winningTrades = filteredPositions.filter((p) => Number(p.realized_pnl_usd) > 0);
  const winrate =
    filteredPositions.length > 0
      ? ((winningTrades.length / filteredPositions.length) * 100).toFixed(1)
      : '0.0';

  const tpCount = filteredPositions.filter((p) => p.exit_reason === 'tp').length;
  const slCount = filteredPositions.filter((p) => p.exit_reason === 'sl').length;
  const flipCount = filteredPositions.filter((p) => p.exit_reason === 'trend_flip').length;

  // Calculate Maximum Drawdown over all time based on active tab view
  // Sort chronological for drawdown calculation
  const chronologicalList = [...filteredPositions].sort(
    (a, b) => new Date(a.closed_at || a.opened_at).getTime() - new Date(b.closed_at || b.opened_at).getTime()
  );

  const isUserView = activeTab === 'user';
  const startingCapital = isUserView
    ? userExchangeBalance > 0
      ? userExchangeBalance
      : 0
    : BOT_STARTING_BALANCE;

  let maxDrawdownPct = 0;
  let maxDrawdownUsd = 0;

  if (chronologicalList.length > 0) {
    let runningEq = startingCapital > 0 ? startingCapital : 0;
    let peakEq = runningEq;

    for (const trade of chronologicalList) {
      runningEq += Number(trade.realized_pnl_usd) || 0;
      if (runningEq > peakEq) {
        peakEq = runningEq;
      }
      const ddUsd = peakEq - runningEq;
      const ddPct = peakEq > 0 ? (ddUsd / peakEq) * 100 : 0;

      if (ddPct > maxDrawdownPct) {
        maxDrawdownPct = ddPct;
      }
      if (ddUsd > maxDrawdownUsd) {
        maxDrawdownUsd = ddUsd;
      }
    }
  }

  return (
    <div className="p-4 sm:p-8 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            {t('history.title')}
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-honey-500/15 text-honey-400 border border-honey-500/30">
              {t('history.auditedLog')}
            </span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            {isUserView ? t('history.subtitleUser') : t('history.subtitleMaster')}
          </p>
        </div>

        {/* Global PnL Pill */}
        <div className="bg-dark-900 border border-dark-800 px-4 py-2.5 rounded-xl flex items-center gap-3 shadow-lg shrink-0">
          <span className="text-xs text-slate-400 font-mono">{t('history.realizedPnl')}</span>
          <span
            className={`font-mono font-black text-base ${
              totalRealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {totalRealizedPnl >= 0
              ? `+$${totalRealizedPnl.toLocaleString(dateLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : `-$${Math.abs(totalRealizedPnl).toLocaleString(dateLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </span>
        </div>
      </div>

      {/* Dual Context Explainer Cards: Master Strategy vs My Account */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 1: Master Bot Strategy Signals ($50k Base Capital) */}
        <div
          onClick={() => setActiveTab('master')}
          className={`cursor-pointer p-4 sm:p-5 rounded-2xl border transition-all ${
            activeTab === 'master'
              ? 'bg-honey-500/10 border-honey-500/40 shadow-lg shadow-honey-500/10 ring-1 ring-honey-500/30'
              : 'bg-dark-900 border-dark-800 hover:border-dark-700'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-honey-500/15 border border-honey-500/30 text-honey-400 flex items-center justify-center font-bold">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  {t('history.masterBot')}
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-honey-500/20 text-honey-400 font-bold">
                    {t('history.compounding')}
                  </span>
                </h3>
                <span className="text-[11px] font-mono text-slate-400">
                  {t('history.masterTrades', { count: masterPositions.length })}
                </span>
              </div>
            </div>
            <span
              className={`text-xs font-mono font-bold px-2.5 py-1 rounded-lg ${
                activeTab === 'master' ? 'bg-honey-500 text-dark-950' : 'text-slate-400 bg-dark-950'
              }`}
            >
              {activeTab === 'master' ? t('history.activeView') : t('history.select')}
            </span>
          </div>
          <p className="mt-3 text-xs text-slate-300 leading-relaxed">
            {t('history.masterDesc')}
          </p>
        </div>

        {/* Card 2: My Personal Exchange Account */}
        <div
          onClick={() => setActiveTab('user')}
          className={`cursor-pointer p-4 sm:p-5 rounded-2xl border transition-all ${
            activeTab === 'user'
              ? 'bg-emerald-500/10 border-emerald-500/40 shadow-lg shadow-emerald-500/10 ring-1 ring-emerald-500/30'
              : 'bg-dark-900 border-dark-800 hover:border-dark-700'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center font-bold">
                <UserCheck className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  {t('history.myAccount')}
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">
                    {t('history.liveAccount')}
                  </span>
                </h3>
                <span className="text-[11px] font-mono text-slate-400">
                  {t('history.userOrders', { count: userPositions.length })}
                </span>
              </div>
            </div>
            <span
              className={`text-xs font-mono font-bold px-2.5 py-1 rounded-lg ${
                activeTab === 'user' ? 'bg-emerald-500 text-dark-950' : 'text-slate-400 bg-dark-950'
              }`}
            >
              {activeTab === 'user' ? t('history.activeView') : t('history.select')}
            </span>
          </div>
          <p className="mt-3 text-xs text-slate-300 leading-relaxed">
            {t('history.userDesc')}
          </p>
        </div>
      </div>

      {/* Primary Navigation Tabs */}
      <div className="flex border-b border-dark-800 gap-3 font-mono text-xs font-bold uppercase overflow-x-auto">
        <button
          onClick={() => setActiveTab('all')}
          className={`pb-3 px-3 border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'all'
              ? 'border-honey-500 text-honey-400 font-black'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <Layers className="w-4 h-4" />
          {t('history.allTrades', { count: userPositions.length + masterPositions.length })}
        </button>

        <button
          onClick={() => setActiveTab('master')}
          className={`pb-3 px-3 border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'master'
              ? 'border-honey-500 text-honey-400 font-black'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <Sparkles className="w-4 h-4 text-honey-400" />
          {t('history.masterBenchmark', { count: masterPositions.length })}
        </button>

        <button
          onClick={() => setActiveTab('user')}
          className={`pb-3 px-3 border-b-2 transition-all flex items-center gap-2 whitespace-nowrap ${
            activeTab === 'user'
              ? 'border-emerald-500 text-emerald-400 font-black'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <UserCheck className="w-4 h-4 text-emerald-400" />
          {t('history.myTrades', { count: userPositions.length })}
        </button>
      </div>

      {/* Performance Summary Cards - Dynamically tailored for Master Bot vs User Account */}
      {isUserView ? (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {/* Card 1: My Connected Exchange Balance */}
          <div className="bg-dark-900 border border-dark-800 p-4 rounded-xl">
            <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
              <span>{t('history.myBalance')}</span>
              <Wallet className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <p className="text-xl font-black text-white font-mono mt-1">
              ${userExchangeBalance.toLocaleString(dateLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <span className="text-[11px] text-slate-500 font-mono">
              {userAccountCount > 0 ? t('history.activeApi', { count: userAccountCount }) : t('history.noApi')}
            </span>
          </div>

          {/* Card 2: My Account Total Realized PnL */}
          <div className="bg-dark-900 border border-dark-800 p-4 rounded-xl">
            <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
              <span>{t('history.myProfit')}</span>
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <p
              className={`text-xl font-black font-mono mt-1 ${
                totalRealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {totalRealizedPnl >= 0
                ? `+$${totalRealizedPnl.toLocaleString(dateLocale, { minimumFractionDigits: 2 })}`
                : `-$${Math.abs(totalRealizedPnl).toLocaleString(dateLocale, { minimumFractionDigits: 2 })}`}
            </p>
            <span className="text-[11px] text-slate-500 font-mono">
              {t('history.closedUserTrades', { count: userPositions.length })}
            </span>
          </div>

          {/* Card 3: Max Drawdown */}
          <div className="bg-dark-900 border border-dark-800 p-4 rounded-xl">
            <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
              <span>{t('history.maxDd')}</span>
              <TrendingDown className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <p className="text-xl font-black text-amber-400 font-mono mt-1">
              {userPositions.length > 0 ? `${maxDrawdownPct.toFixed(2)}%` : '0.00%'}
            </p>
            <span className="text-[11px] text-slate-500 font-mono">
              {userPositions.length > 0
                ? t('history.peakDrop', {
                    amount: maxDrawdownUsd.toLocaleString(dateLocale, { minimumFractionDigits: 2 }),
                  })
                : t('history.zeroDd')}
            </span>
          </div>

          {/* Card 4: My Strategy Winrate */}
          <div className="bg-dark-900 border border-dark-800 p-4 rounded-xl">
            <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
              <span>{t('history.accountWinrate')}</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <p className="text-xl font-black text-white font-mono mt-1">{winrate}%</p>
            <span className="text-[11px] text-slate-500 font-mono">
              {tpCount} TP • {slCount} SL
            </span>
          </div>

          {/* Card 5: My Total Volume */}
          <div className="bg-dark-900 border border-dark-800 p-4 rounded-xl col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
              <span>{t('history.tradedVolume')}</span>
              <Scale className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <p className="text-xl font-black text-white font-mono mt-1">
              ${totalVolumeTraded.toLocaleString(dateLocale, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </p>
            <span className="text-[11px] text-slate-500 font-mono">
              {t('history.leverage7x')}
            </span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {/* Card 1: Bot Starting Base */}
          <div className="bg-dark-900 border border-dark-800 p-4 rounded-xl">
            <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
              <span>{t('history.botStartingBase')}</span>
              <Wallet className="w-3.5 h-3.5 text-honey-400" />
            </div>
            <p className="text-xl font-black text-white font-mono mt-1">
              ${BOT_STARTING_BALANCE.toLocaleString(dateLocale, { minimumFractionDigits: 2 })}
            </p>
            <span className="text-[11px] text-slate-500 font-mono">
              {t('history.fourSlots')}
            </span>
          </div>

          {/* Card 2: Compounded Equity */}
          <div className="bg-dark-900 border border-dark-800 p-4 rounded-xl">
            <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
              <span>{t('history.compoundedEquity')}</span>
              <Scale className="w-3.5 h-3.5 text-honey-400" />
            </div>
            <p className="text-xl font-black text-honey-400 font-mono mt-1">
              ${(BOT_STARTING_BALANCE + totalRealizedPnl).toLocaleString(dateLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <span className="text-[11px] text-slate-500 font-mono">
              {t('history.reinvestment')}
            </span>
          </div>

          {/* Card 3: Max Drawdown over all time */}
          <div className="bg-dark-900 border border-dark-800 p-4 rounded-xl">
            <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
              <span>{t('history.maxDd')}</span>
              <TrendingDown className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <p className="text-xl font-black text-amber-400 font-mono mt-1">
              {maxDrawdownPct.toFixed(2)}%
            </p>
            <span className="text-[11px] text-slate-500 font-mono">
              {t('history.peakDrop', {
                amount: maxDrawdownUsd.toLocaleString(dateLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
              })}
            </span>
          </div>

          {/* Card 4: Total Realized Profit */}
          <div className="bg-dark-900 border border-dark-800 p-4 rounded-xl">
            <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
              <span>{t('history.totalProfit')}</span>
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <p className="text-xl font-black text-emerald-400 font-mono mt-1">
              +${totalRealizedPnl.toLocaleString(dateLocale, { minimumFractionDigits: 2 })}
            </p>
            <span className="text-[11px] text-emerald-400/80 font-mono font-semibold">
              {t('history.roiOnBase', { pct: ((totalRealizedPnl / BOT_STARTING_BALANCE) * 100).toFixed(1) })}
            </span>
          </div>

          {/* Card 5: Strategy Winrate */}
          <div className="bg-dark-900 border border-dark-800 p-4 rounded-xl col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
              <span>{t('history.strategyWinrate')}</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <p className="text-xl font-black text-white font-mono mt-1">{winrate}%</p>
            <span className="text-[11px] text-slate-500 font-mono">
              {tpCount} TP (+5%) • {slCount} SL (-1.5%)
            </span>
          </div>
        </div>
      )}

      {/* Pair Filter Pills */}
      <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-xs">
        <span className="text-slate-500 text-[11px] uppercase mr-1">{t('history.filterPair')}</span>
        {['ALL', 'ZEC/AVAX', 'ENA/SUI', 'SOL/ADA', 'BNB/ETH'].map((pair) => (
          <button
            key={pair}
            onClick={() => setSelectedPair(pair)}
            className={`px-3 py-1.5 rounded-lg font-bold transition-all ${
              selectedPair === pair
                ? 'bg-honey-500 text-dark-950 shadow-md shadow-honey-500/20'
                : 'bg-dark-900 border border-dark-800 text-slate-400 hover:text-white'
            }`}
          >
            {pair}
          </button>
        ))}
      </div>

      {/* Trade Log Table */}
      <div className="bg-dark-900 border border-dark-800 rounded-2xl shadow-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500 font-mono text-sm">{t('history.loading')}</div>
        ) : filteredPositions.length === 0 ? (
          <div className="p-12 text-center max-w-md mx-auto">
            {activeTab === 'user' ? (
              <>
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto mb-3">
                  <KeyRound className="w-6 h-6" />
                </div>
                <h3 className="text-base font-bold text-white">{t('history.noLiveTitle')}</h3>
                <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
                  {t('history.noLiveDesc')}
                </p>
                <div className="flex items-center justify-center gap-3 mt-5">
                  <Link
                    href="/settings/exchange"
                    className="px-4 py-2 text-xs font-bold rounded-xl bg-honey-500 hover:bg-honey-400 text-dark-950 shadow-md shadow-honey-500/20 transition-all flex items-center gap-1.5"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    {t('history.connectKeys')}
                  </Link>
                  <button
                    onClick={() => setActiveTab('master')}
                    className="px-4 py-2 text-xs font-semibold rounded-xl bg-dark-800 hover:bg-dark-700 text-slate-300 hover:text-white transition-colors"
                  >
                    {t('history.viewMaster')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <History className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <h3 className="text-base font-semibold text-white">{t('history.noTradesTitle')}</h3>
                <p className="text-xs text-slate-400 mt-1">{t('history.noTradesDesc')}</p>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[650px] overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-dark-950/90 sticky top-0 z-10 text-[11px] uppercase tracking-wider text-slate-400 font-mono border-b border-dark-800 backdrop-blur-md">
                <tr>
                  <th className="px-5 py-3.5">{t('history.colSource')}</th>
                  <th className="px-5 py-3.5">{t('history.colPair')}</th>
                  <th className="px-5 py-3.5">{t('history.colAmount')}</th>
                  <th className="px-5 py-3.5">{t('history.colExit')}</th>
                  <th className="px-5 py-3.5">{t('history.colRatio')}</th>
                  <th className="px-5 py-3.5">{t('history.colDates')}</th>
                  <th className="px-5 py-3.5 text-right">{t('history.colPnl')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-800 font-mono text-xs">
                {filteredPositions.map((pos) => {
                  const pnl = Number(pos.realized_pnl_usd) || 0;
                  const pnlPct = Number(pos.pnl_pct) || 0;
                  const isUserTrade = !pos.is_master && Boolean(pos.user_id);
                  const exchangeName =
                    pos.exchange_accounts?.exchange?.toUpperCase() ||
                    (isUserTrade ? 'EXCHANGE' : 'MASTER');

                  const marginUsd = Number(pos.allocated_margin_usd || 12500);
                  const volumeUsd = Number(pos.total_position_volume_usd || marginUsd * 7);
                  const legVolume = volumeUsd / 2;

                  return (
                    <tr
                      key={pos.id}
                      className={`transition-colors ${
                        isUserTrade
                          ? 'bg-emerald-500/[0.03] hover:bg-emerald-500/[0.08]'
                          : 'hover:bg-dark-850/50'
                      }`}
                    >
                      {/* Column 1: Explicit Execution Source */}
                      <td className="px-5 py-4">
                        {isUserTrade ? (
                          <div>
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] uppercase font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              {t('history.myAccountBadge', { exchange: exchangeName })}
                            </span>
                            <div className="text-[10px] text-emerald-400/80 mt-1 font-semibold">
                              {t('history.liveApi')}
                            </div>
                          </div>
                        ) : (
                          <div>
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] uppercase font-bold bg-honey-500/15 text-honey-400 border border-honey-500/30">
                              <Sparkles className="w-3.5 h-3.5 text-honey-400" />
                              {t('history.masterBadge')}
                            </span>
                            <div className="text-[10px] text-slate-500 mt-1 font-mono">
                              {t('history.baseCapital')}
                            </div>
                          </div>
                        )}
                      </td>

                      {/* Column 2: Pair Symbol */}
                      <td className="px-5 py-4">
                        <div className="font-bold text-white text-sm">{pos.pair_symbol}</div>
                        <div className="text-[10px] text-slate-500">
                          {pos.long_symbol} / {pos.short_symbol}
                        </div>
                      </td>

                      {/* Column 3: Prominent Trade Amount & Margin */}
                      <td className="px-5 py-4">
                        <div className="font-black text-white text-sm">
                          ${volumeUsd.toLocaleString(dateLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                          <span className="text-[10px] font-normal text-honey-400">USDT</span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-semibold mt-0.5">
                          {t('dashboard.margin')} ${marginUsd.toLocaleString(dateLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                          <span className="text-honey-400 font-bold">(7.0x)</span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          L: ${legVolume.toLocaleString(dateLocale, { maximumFractionDigits: 0 })} | S: ${legVolume.toLocaleString(dateLocale, { maximumFractionDigits: 0 })}
                        </div>
                      </td>

                      {/* Column 4: Exit Reason */}
                      <td className="px-5 py-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                            pos.exit_reason === 'tp'
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : pos.exit_reason === 'sl'
                              ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                              : 'bg-amber-500/15 text-honey-400 border border-honey-500/30'
                          }`}
                        >
                          {pos.exit_reason === 'tp'
                            ? t('history.takeProfit')
                            : pos.exit_reason === 'sl'
                            ? t('history.stopLoss')
                            : t('history.trendFlip')}
                        </span>
                      </td>

                      {/* Column 5: Ratio Spread & Prices */}
                      <td className="px-5 py-4 text-slate-300">
                        <div>
                          <span className="text-slate-400">{Number(pos.entry_ratio).toFixed(4)}</span>
                          <span className="text-slate-600 mx-1.5">→</span>
                          <span className="text-honey-400 font-semibold">
                            {Number(pos.exit_ratio || 0).toFixed(4)}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500">
                          L: ${Number(pos.long_entry_price).toFixed(2)} | S: ${Number(pos.short_entry_price).toFixed(2)}
                        </div>
                      </td>

                      {/* Column 6: Execution Dates */}
                      <td className="px-5 py-4 text-slate-400 text-[11px]">
                        <div>{t('history.in')} {new Date(pos.opened_at).toLocaleDateString(dateLocale)}</div>
                        {pos.closed_at && (
                          <div className="text-slate-500 text-[10px]">
                            {t('history.out')} {new Date(pos.closed_at).toLocaleDateString(dateLocale)}
                          </div>
                        )}
                      </td>

                      {/* Column 7: Realized PnL */}
                      <td className="px-5 py-4 text-right">
                        <div
                          className={`font-black text-sm ${
                            pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {pnl >= 0
                            ? `+$${pnl.toLocaleString(dateLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : `-$${Math.abs(pnl).toLocaleString(dateLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                        </div>
                        <div
                          className={`text-[11px] font-bold ${
                            pnl >= 0 ? 'text-emerald-400/80' : 'text-rose-400/80'
                          }`}
                        >
                          {pnl >= 0 ? `+${pnlPct.toFixed(2)}%` : `${pnlPct.toFixed(2)}%`}
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
    </div>
  );
}
