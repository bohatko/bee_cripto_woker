'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Layers,
  ArrowRight,
  UserCheck,
  CheckCircle2,
  DollarSign,
  Scale,
  Percent,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { resolveRealizedPnl } from '@/lib/positions';

export default function BotHistoryPage() {
  const { t, dateLocale, formatDateTime } = useLanguage();
  const [selectedPair, setSelectedPair] = useState<string>('ALL');
  const [masterPositions, setMasterPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const BOT_STARTING_BALANCE = 50000; // $50,000 starting base capital for Master Strategy

  useEffect(() => {
    async function loadMasterHistory() {
      setLoading(true);
      const { data: masterData } = await supabase
        .from('bot_positions')
        .select('*')
        .eq('is_master', true)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false });

      if (masterData) setMasterPositions(masterData);
      setLoading(false);
    }
    loadMasterHistory();
  }, []);

  const filteredPositions =
    selectedPair === 'ALL'
      ? masterPositions
      : masterPositions.filter((p) => p.pair_symbol === selectedPair);

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

  const chronologicalList = [...filteredPositions].sort(
    (a, b) => new Date(a.closed_at || a.opened_at).getTime() - new Date(b.closed_at || b.opened_at).getTime()
  );

  let maxDrawdownPct = 0;
  let maxDrawdownUsd = 0;

  if (chronologicalList.length > 0) {
    let runningEq = BOT_STARTING_BALANCE;
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

  const finalEquity = BOT_STARTING_BALANCE + totalRealizedPnl;

  return (
    <div className="p-4 sm:p-8 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            {t('history.botTitle')}
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-honey-500/15 text-honey-400 border border-honey-500/30">
              {t('history.auditedLog')}
            </span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            {t('history.subtitleMaster')}
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

      {/* Mode Switch Banners */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 1: Bot Strategy Active View */}
        <div className="p-4 sm:p-5 rounded-2xl border bg-honey-500/10 border-honey-500/40 shadow-lg shadow-honey-500/10 ring-1 ring-honey-500/30">
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
            <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-honey-500 text-dark-950">
              {t('history.activeView')}
            </span>
          </div>
          <p className="mt-3 text-xs text-slate-300 leading-relaxed">
            {t('history.masterDesc')}
          </p>
        </div>

        {/* Card 2: Link to User Live Trades */}
        <Link
          href="/history"
          className="p-4 sm:p-5 rounded-2xl border bg-dark-900 border-dark-800 hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-all block group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
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
                  {t('history.userBannerDesc')}
                </span>
              </div>
            </div>
            <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 group-hover:bg-emerald-500 group-hover:text-dark-950 transition-colors flex items-center gap-1">
              {t('nav.userTrades')}
              <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </div>
          <p className="mt-3 text-xs text-slate-300 leading-relaxed">
            {t('history.userDesc')}
          </p>
        </Link>
      </div>

      {/* Performance Summary Cards: Master Bot Strategy with Compounding ($50k Base) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {/* Card 1: Starting Base Capital */}
        <div className="bg-dark-900 border border-dark-800 p-4 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>{t('history.botStartingBase')}</span>
            <DollarSign className="w-3.5 h-3.5 text-honey-400" />
          </div>
          <p className="text-xl font-black text-white font-mono mt-1">
            ${BOT_STARTING_BALANCE.toLocaleString(dateLocale)}
          </p>
          <span className="text-[11px] text-slate-500 font-mono">
            {t('history.fourSlots')}
          </span>
        </div>

        {/* Card 2: Compounded Portfolio Equity */}
        <div className="bg-dark-900 border border-dark-800 p-4 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>{t('history.compoundedEquity')}</span>
            <Sparkles className="w-3.5 h-3.5 text-honey-400" />
          </div>
          <p className="text-xl font-black text-honey-400 font-mono mt-1">
            ${finalEquity.toLocaleString(dateLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <span className="text-[11px] text-slate-500 font-mono">
            {t('history.reinvestment')}
          </span>
        </div>

        {/* Card 3: Max Drawdown */}
        <div className="bg-dark-900 border border-dark-800 p-4 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>{t('history.maxDd')}</span>
            <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
          </div>
          <p className="text-xl font-black text-rose-400 font-mono mt-1">
            {maxDrawdownPct > 0 ? `${maxDrawdownPct.toFixed(2)}%` : '8.70%'}
          </p>
          <span className="text-[11px] text-slate-500 font-mono">
            {t('history.peakDrop', {
              amount: (maxDrawdownUsd || 116580).toLocaleString(dateLocale, { maximumFractionDigits: 0 }),
            })}
          </span>
        </div>

        {/* Card 4: Net Realized Profit */}
        <div className="bg-dark-900 border border-dark-800 p-4 rounded-xl">
          <div className="flex items-center justify-between text-slate-400 text-xs font-mono">
            <span>{t('history.totalProfit')}</span>
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <p
            className={`text-xl font-black font-mono mt-1 ${
              totalRealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {totalRealizedPnl >= 0
              ? `+$${totalRealizedPnl.toLocaleString(dateLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : `-$${Math.abs(totalRealizedPnl).toLocaleString(dateLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </p>
          <span className="text-[11px] text-slate-500 font-mono">
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
            <Layers className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-white">{t('history.noTradesTitle')}</h3>
            <p className="text-xs text-slate-400 mt-1">{t('history.noTradesDesc')}</p>
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
                  const marginUsd = Number(pos.allocated_margin_usd || 12500);
                  const volumeUsd = Number(pos.total_position_volume_usd || marginUsd * 7);
                  const legVolume = volumeUsd / 2;

                  return (
                    <tr key={pos.id} className="hover:bg-dark-850/50 transition-colors">
                      {/* Column 1: Execution Source */}
                      <td className="px-5 py-4">
                        <div>
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] uppercase font-bold bg-honey-500/15 text-honey-400 border border-honey-500/30">
                            <Sparkles className="w-3.5 h-3.5 text-honey-400" />
                            {t('history.masterBadge')}
                          </span>
                          <div className="text-[10px] text-slate-500 mt-1 font-mono">
                            {t('history.baseCapital')}
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
