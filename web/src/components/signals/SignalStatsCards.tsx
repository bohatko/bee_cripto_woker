'use client';

import React from 'react';
import { DollarSign, Percent, TrendingUp, Receipt } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface SignalStatsCardsProps {
  positions: any[];
}

export function SignalStatsCards({ positions }: SignalStatsCardsProps) {
  const { t, dateLocale } = useLanguage();

  const closed = positions.filter((p) => p.status === 'closed');
  const totalTrades = closed.length;

  const totalRealizedPnl = closed.reduce(
    (acc, p) => acc + Number(p.realized_pnl_usd || 0),
    0
  );

  const totalFees = closed.reduce(
    (acc, p) =>
      acc +
      Number(p.entry_fees_usd || 0) +
      Number(p.exit_fees_usd || 0) +
      Number(p.funding_fees_usd || 0),
    0
  );

  const tpTrades = closed.filter((p) => p.exit_reason === 'tp').length;
  const winRate = totalTrades > 0 ? (tpTrades / totalTrades) * 100 : 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Realized PnL */}
      <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl">
        <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
          <span>{t('signals.realizedPnl')}</span>
          <DollarSign className="w-4 h-4 text-honey-400" />
        </div>
        <p
          className={`text-2xl font-black font-mono mt-2 ${
            totalRealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
          }`}
        >
          {totalRealizedPnl >= 0 ? '+' : ''}$
          {totalRealizedPnl.toLocaleString(dateLocale, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </p>
      </div>

      {/* Win Rate */}
      <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl">
        <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
          <span>{t('signals.winRate')}</span>
          <Percent className="w-4 h-4 text-honey-400" />
        </div>
        <div className="flex items-baseline gap-2 mt-2">
          <p className="text-2xl font-black font-mono text-white">
            {winRate.toFixed(1)}%
          </p>
          <span className="text-xs font-mono text-slate-500">
            ({tpTrades} / {totalTrades})
          </span>
        </div>
      </div>

      {/* Completed Trades */}
      <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl">
        <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
          <span>{t('signals.totalTrades')}</span>
          <TrendingUp className="w-4 h-4 text-honey-400" />
        </div>
        <p className="text-2xl font-black font-mono text-white mt-2">
          {totalTrades}
        </p>
      </div>

      {/* Paid Fees */}
      <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl">
        <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
          <span>{t('signals.totalFees')}</span>
          <Receipt className="w-4 h-4 text-honey-400" />
        </div>
        <p className="text-2xl font-black font-mono text-slate-300 mt-2">
          ${totalFees.toLocaleString(dateLocale, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </p>
      </div>
    </div>
  );
}
