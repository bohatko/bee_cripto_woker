'use client';

import React, { useState, useEffect } from 'react';
import { History, TrendingUp, Filter } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

export default function HistoryPage() {
  const [closedPositions, setClosedPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadHistory() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('bot_positions')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false });

      if (data) setClosedPositions(data);
      setLoading(false);
    }
    loadHistory();
  }, []);

  const totalRealizedPnl = closedPositions.reduce(
    (acc, p) => acc + (Number(p.realized_pnl_usd) || 0),
    0
  );

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Trade History
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Historical log of all completed long-short basket cycles.
          </p>
        </div>

        <div className="bg-dark-900 border border-dark-800 px-4 py-2.5 rounded-xl flex items-center gap-3">
          <span className="text-xs text-slate-400">Total Realized PnL:</span>
          <span
            className={`font-mono font-bold text-sm ${
              totalRealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {totalRealizedPnl >= 0 ? `+$${totalRealizedPnl.toFixed(2)}` : `-$${Math.abs(totalRealizedPnl).toFixed(2)}`}
          </span>
        </div>
      </div>

      <div className="bg-dark-900 border border-dark-800 rounded-2xl shadow-xl overflow-hidden">
        {closedPositions.length === 0 ? (
          <div className="p-12 text-center">
            <History className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-white">No closed trades yet</h3>
            <p className="text-xs text-slate-400 mt-1">
              Completed basket trades will be archived and audited here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-dark-950/60 text-[11px] uppercase tracking-wider text-slate-400 font-mono border-b border-dark-800">
                <tr>
                  <th className="px-5 py-3">Pair</th>
                  <th className="px-5 py-3">Exit Reason</th>
                  <th className="px-5 py-3">Ratios</th>
                  <th className="px-5 py-3">Duration</th>
                  <th className="px-5 py-3 text-right">Realized PnL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-800 font-mono text-xs">
                {closedPositions.map((pos) => {
                  const pnl = Number(pos.realized_pnl_usd) || 0;
                  const pnlPct = Number(pos.pnl_pct) || 0;
                  return (
                    <tr key={pos.id} className="hover:bg-dark-850/50 transition-colors">
                      <td className="px-5 py-4">
                        <span className="font-bold text-white">{pos.pair_symbol}</span>
                      </td>
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
                          {pos.exit_reason || 'closed'}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-slate-400">
                        {Number(pos.entry_ratio).toFixed(4)} → {Number(pos.exit_ratio || 0).toFixed(4)}
                      </td>
                      <td className="px-5 py-4 text-slate-500 text-[11px]">
                        {new Date(pos.opened_at).toLocaleDateString('en-US')}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span
                          className={`font-bold ${
                            pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {pnl >= 0 ? `+${pnlPct.toFixed(2)}%` : `${pnlPct.toFixed(2)}%`}
                        </span>
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
    </div>
  );
}
