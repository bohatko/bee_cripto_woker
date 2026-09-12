'use client';

import React from 'react';
import { Layers, ArrowUpRight, TrendingUp, AlertTriangle, ShieldCheck } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface SignalPositionsTableProps {
  positions: any[];
}

export function SignalPositionsTable({ positions }: SignalPositionsTableProps) {
  const { t, dateLocale, formatDateTime } = useLanguage();

  const openPositions = positions.filter((p) => p.status === 'open');
  const closedPositions = positions.filter((p) => p.status === 'closed');

  const renderReasonBadge = (reason: string | null) => {
    const r = (reason || '').toLowerCase();
    if (r === 'tp') {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
          TP (+4.0%)
        </span>
      );
    }
    if (r === 'sl') {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30">
          SL (-30.0%)
        </span>
      );
    }
    if (r.includes('panic')) {
      return (
        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
          PANIC
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded text-[10px] bg-dark-800 text-slate-400 border border-dark-700">
        {reason || 'CLOSED'}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      {/* Active Open Positions Card */}
      {openPositions.length > 0 && (
        <div className="bg-gradient-to-r from-honey-950/30 via-dark-900 to-dark-950 border border-honey-500/40 rounded-2xl p-5 shadow-2xl space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-honey-400 animate-ping" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                {t('signals.openPositionCardTitle')} ({openPositions.length})
              </h3>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {openPositions.map((pos) => {
              const uPnl = Number(pos.unrealized_pnl_usd || 0);
              const pnlPct = Number(pos.pnl_pct || 0);

              return (
                <div
                  key={pos.id}
                  className="bg-dark-950/80 border border-dark-800 p-4 rounded-xl space-y-3 font-mono text-xs"
                >
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-base text-white">
                      {pos.symbol}/USDT{' '}
                      <span className="text-xs font-normal text-honey-400">
                        ({pos.leverage || 3.0}x LONG)
                      </span>
                    </span>
                    <span
                      className={`font-bold text-sm ${
                        uPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {uPnl >= 0 ? '+' : ''}${uPnl.toFixed(2)} ({pnlPct >= 0 ? '+' : ''}
                      {pnlPct.toFixed(2)}%)
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-[11px] pt-1 border-t border-dark-800/80">
                    <div>
                      <span className="text-slate-500 block">{t('signals.entryPrice')}</span>
                      <span className="text-white font-bold">
                        ${Number(pos.entry_price || 0).toFixed(4)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">{t('signals.tpPrice')}</span>
                      <span className="text-emerald-400 font-bold">
                        ${Number(pos.tp_price || 0).toFixed(4)}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">{t('signals.slPrice')}</span>
                      <span className="text-rose-400 font-bold">
                        ${Number(pos.sl_price || 0).toFixed(4)}
                      </span>
                    </div>
                  </div>

                  <div className="flex justify-between items-center text-[10px] text-slate-500 pt-1">
                    <span>
                      Margin: ${Number(pos.allocated_margin_usd || 0).toFixed(2)} USDT (Vol: $
                      {Number(pos.notional_usd || 0).toFixed(2)})
                    </span>
                    <span>{formatDateTime(pos.opened_at)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Closed Positions History */}
      <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-honey-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">
              {t('signals.positionsTitle')}
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-500">
            {closedPositions.length} closed
          </span>
        </div>

        {closedPositions.length === 0 ? (
          <div className="text-center py-8 text-xs font-mono text-slate-500">
            {t('signals.positionsEmpty')}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-dark-800 text-[11px] font-mono uppercase text-slate-500">
                  <th className="py-2.5 px-3">{t('signals.tableTime')}</th>
                  <th className="py-2.5 px-3">{t('signals.tableSymbol')}</th>
                  <th className="py-2.5 px-3">{t('signals.tableMargin')}</th>
                  <th className="py-2.5 px-3">{t('signals.tableEntryExit')}</th>
                  <th className="py-2.5 px-3">{t('signals.tableReason')}</th>
                  <th className="py-2.5 px-3 text-right">{t('signals.tablePnl')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-800/60 font-mono text-xs">
                {closedPositions.map((pos) => {
                  const rPnl = Number(pos.realized_pnl_usd || 0);
                  const pnlPct = Number(pos.pnl_pct || 0);
                  const isWin = rPnl >= 0;

                  return (
                    <tr key={pos.id} className="hover:bg-dark-950/40 transition-colors">
                      <td className="py-3 px-3 text-slate-400">
                        {formatDateTime(pos.closed_at || pos.opened_at)}
                      </td>
                      <td className="py-3 px-3 font-bold text-white">
                        {pos.symbol}/USDT{' '}
                        <span className="text-[10px] text-slate-500 font-normal">
                          {pos.is_master ? '(Benchmark)' : ''}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-slate-300">
                        ${Number(pos.allocated_margin_usd || 0).toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-slate-300">
                        ${Number(pos.entry_price || 0).toFixed(4)} ➔ $
                        {Number(pos.exit_price || 0).toFixed(4)}
                      </td>
                      <td className="py-3 px-3">
                        {renderReasonBadge(pos.exit_reason)}
                      </td>
                      <td
                        className={`py-3 px-3 text-right font-bold ${
                          isWin ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {isWin ? '+' : ''}${rPnl.toFixed(2)} ({isWin ? '+' : ''}
                        {pnlPct.toFixed(2)}%)
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
