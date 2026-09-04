'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  History,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  KeyRound,
  Wallet,
  Scale,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { isUnfilledSimulation, resolveRealizedPnl } from '@/lib/positions';
import { EquityGrowthChart } from '@/components/charts/EquityGrowthChart';

export default function UserHistoryPage() {
  const { t, dateLocale, formatDateTime } = useLanguage();
  const [selectedPair, setSelectedPair] = useState<string>('ALL');
  const [userPositions, setUserPositions] = useState<any[]>([]);
  const [userExchangeBalance, setUserExchangeBalance] = useState<number>(0);
  const [userAccountCount, setUserAccountCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUserHistory() {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        // Fetch User's personal exchange trades
        const { data: userData } = await supabase
          .from('bot_positions')
          .select('*, exchange_accounts(exchange, account_name)')
          .eq('user_id', user.id)
          .eq('status', 'closed')
          .order('closed_at', { ascending: false });

        if (userData) {
          setUserPositions(userData.filter((p) => !isUnfilledSimulation(p)));
        }

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
    loadUserHistory();
  }, []);

  // Filter by pair
  const filteredPositions =
    selectedPair === 'ALL'
      ? userPositions
      : userPositions.filter((p) => p.pair_symbol === selectedPair);

  const totalRealizedPnl = filteredPositions.reduce(
    (acc, p) => acc + resolveRealizedPnl(p).pnlUsd,
    0
  );

  const totalVolumeTraded = filteredPositions.reduce(
    (acc, p) => acc + (Number(p.total_position_volume_usd) || 0),
    0
  );

  const winningTrades = filteredPositions.filter((p) => resolveRealizedPnl(p).pnlUsd > 0);
  const winrate =
    filteredPositions.length > 0
      ? ((winningTrades.length / filteredPositions.length) * 100).toFixed(1)
      : '0.0';

  const tpCount = filteredPositions.filter((p) => p.exit_reason === 'tp').length;
  const slCount = filteredPositions.filter((p) => p.exit_reason === 'sl').length;

  // Calculate Maximum Drawdown over all time for user account
  const chronologicalList = [...filteredPositions].sort(
    (a, b) => new Date(a.closed_at || a.opened_at).getTime() - new Date(b.closed_at || b.opened_at).getTime()
  );

  const startingCapital = userExchangeBalance > 0 ? userExchangeBalance : 0;

  let maxDrawdownPct = 0;
  let maxDrawdownUsd = 0;

  if (chronologicalList.length > 0) {
    let runningEq = startingCapital > 0 ? startingCapital : 0;
    let peakEq = runningEq;

    for (const trade of chronologicalList) {
      runningEq += resolveRealizedPnl(trade).pnlUsd;
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
            {t('history.userTitle')}
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              {t('history.auditedLog')}
            </span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            {t('history.subtitleUser')}
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

      {/* Realized PnL Growth Dynamics Chart (Strictly trade-by-trade, no exchange capital) */}
      <EquityGrowthChart
        positions={filteredPositions}
        mode="pnl"
        isMaster={false}
      />

      {/* Performance Summary Cards - Tailored strictly for Connected Exchange Account */}
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
            </div>
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
                  const { pnlUsd: pnl, pnlPct } = resolveRealizedPnl(pos);
                  const isSimulated = isUnfilledSimulation(pos);
                  const exchangeName =
                    pos.exchange_accounts?.exchange?.toUpperCase() || 'EXCHANGE';

                  const marginUsd = Number(pos.allocated_margin_usd || 25);
                  const volumeUsd = Number(pos.total_position_volume_usd || marginUsd * 7);
                  const legVolume = volumeUsd / 2;

                  return (
                    <tr
                      key={pos.id}
                      className="bg-emerald-500/[0.03] hover:bg-emerald-500/[0.08] transition-colors"
                    >
                      {/* Column 1: Explicit Execution Source */}
                      <td className="px-5 py-4">
                        <div>
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] uppercase font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            {t('history.myAccountBadge', { exchange: exchangeName })}
                          </span>
                          <div
                            className={`text-[10px] mt-1 font-semibold ${
                              isSimulated ? 'text-rose-400' : 'text-emerald-400/80'
                            }`}
                          >
                            {isSimulated ? t('history.notFilled') : t('history.liveApi')}
                          </div>
                        </div>
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
                          L: ${Number(pos.long_entry_price).toFixed(2)} → ${Number(pos.long_exit_price || pos.long_entry_price).toFixed(2)}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          S: ${Number(pos.short_entry_price).toFixed(2)} → ${Number(pos.short_exit_price || pos.short_entry_price).toFixed(2)}
                        </div>
                      </td>

                      {/* Column 6: Execution Dates */}
                      <td className="px-5 py-4 text-slate-400 text-[11px]">
                        <div>{t('history.in')} {formatDateTime(pos.opened_at)}</div>
                        {pos.closed_at && (
                          <div className="text-slate-500 text-[10px]">
                            {t('history.out')} {formatDateTime(pos.closed_at)}
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
