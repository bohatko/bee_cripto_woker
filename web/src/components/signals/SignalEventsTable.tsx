'use client';

import React from 'react';
import { History, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export interface SignalEventsTableProps {
  events: any[];
  userPositions: any[];
}

export function SignalEventsTable({ events, userPositions }: SignalEventsTableProps) {
  const { t, formatDateTime } = useLanguage();

  const userEventIds = new Set(userPositions.map((p) => p.signal_event_id).filter(Boolean));

  return (
    <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-xl space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-honey-400" />
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            {t('signals.eventsTitle')}
          </h3>
        </div>
        <span className="text-xs font-mono text-slate-500">
          {events.length} events
        </span>
      </div>

      {events.length === 0 ? (
        <div className="text-center py-8 text-xs font-mono text-slate-500">
          {t('signals.eventsEmpty')}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-dark-800 text-[11px] font-mono uppercase text-slate-500">
                <th className="py-2.5 px-3">{t('signals.tableTime')}</th>
                <th className="py-2.5 px-3">{t('signals.tableSymbol')}</th>
                <th className="py-2.5 px-3">{t('signals.tableDrop')}</th>
                <th className="py-2.5 px-3">{t('signals.tableClose')}</th>
                <th className="py-2.5 px-3">{t('signals.tableRefEntry')}</th>
                <th className="py-2.5 px-3">{t('signals.tableStatus')}</th>
                <th className="py-2.5 px-3 text-right">My Execution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dark-800/60 font-mono text-xs">
              {events.map((ev) => {
                const isExecutedForMe = userEventIds.has(ev.id);
                return (
                  <tr key={ev.id} className="hover:bg-dark-950/40 transition-colors">
                    <td className="py-3 px-3 text-slate-400">
                      {formatDateTime(ev.signal_bar_ts || ev.created_at)}
                    </td>
                    <td className="py-3 px-3 font-bold text-white">
                      {ev.symbol}/USDT
                    </td>
                    <td className="py-3 px-3 text-rose-400 font-bold">
                      -{Number(ev.drop_pct || 0).toFixed(2)}%
                    </td>
                    <td className="py-3 px-3 text-slate-300">
                      ${Number(ev.signal_close || 0).toFixed(4)}
                    </td>
                    <td className="py-3 px-3 text-slate-300">
                      ${Number(ev.reference_entry_price || 0).toFixed(4)}
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {ev.status || 'fired'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      {isExecutedForMe ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 rounded">
                          <CheckCircle2 className="w-3 h-3" />
                          My Trade
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-500">
                          Not filled
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
