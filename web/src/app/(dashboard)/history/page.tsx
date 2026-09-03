'use client';

import React, { useState, useEffect } from 'react';
import { History, TrendingUp, Filter, Sparkles, CheckCircle2, ShieldAlert, Layers } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';

export default function HistoryPage() {
  const [activeTab, setActiveTab] = useState<'master' | 'user'>('master');
  const [selectedPair, setSelectedPair] = useState<string>('ALL');
  const [masterPositions, setMasterPositions] = useState<any[]>([]);
  const [userPositions, setUserPositions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadHistory() {
      setLoading(true);
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // 1. Fetch Master bot positions (6-month backtest + live master trades)
      const { data: masterData } = await supabase
        .from('bot_positions')
        .select('*')
        .eq('is_master', true)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false });

      if (masterData) setMasterPositions(masterData);

      // 2. Fetch User's personal exchange trades
      if (user) {
        const { data: userData } = await supabase
          .from('bot_positions')
          .select('*')
          .eq('user_id', user.id)
          .eq('status', 'closed')
          .order('closed_at', { ascending: false });

        if (userData) setUserPositions(userData);
      }

      setLoading(false);
    }
    loadHistory();
  }, []);

  const currentList = activeTab === 'master' ? masterPositions : userPositions;

  const filteredPositions =
    selectedPair === 'ALL'
      ? currentList
      : currentList.filter((p) => p.pair_symbol === selectedPair);

  const totalRealizedPnl = filteredPositions.reduce(
    (acc, p) => acc + (Number(p.realized_pnl_usd) || 0),
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

  return (
    <div className="p-4 sm:p-8 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
            Trade History
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-honey-500/15 text-honey-400 border border-honey-500/30">
              6-MONTH VERIFIED
            </span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Complete audited log of all autonomous basket cycles and executed exchange orders.
          </p>
        </div>

        {/* Global PnL Pill */}
        <div className="bg-dark-900 border border-dark-800 px-4 py-2.5 rounded-xl flex items-center gap-3 shadow-lg">
          <span className="text-xs text-slate-400 font-mono">Realized PnL:</span>
          <span
            className={`font-mono font-black text-base ${
              totalRealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {totalRealizedPnl >= 0
              ? `+$${totalRealizedPnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : `-$${Math.abs(totalRealizedPnl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </span>
        </div>
      </div>

      {/* Primary Tabs: Master History vs User Account */}
      <div className="flex border-b border-dark-800 gap-4 font-mono text-xs font-bold uppercase">
        <button
          onClick={() => setActiveTab('master')}
          className={`pb-3 px-2 border-b-2 transition-all flex items-center gap-2 ${
            activeTab === 'master'
              ? 'border-honey-500 text-honey-400 font-black'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <Sparkles className="w-4 h-4 text-honey-400" />
          Master Bot Strategy ({masterPositions.length} Trades)
        </button>

        <button
          onClick={() => setActiveTab('user')}
          className={`pb-3 px-2 border-b-2 transition-all flex items-center gap-2 ${
            activeTab === 'user'
              ? 'border-honey-500 text-honey-400 font-black'
              : 'border-transparent text-slate-400 hover:text-white'
          }`}
        >
          <History className="w-4 h-4 text-slate-400" />
          My Exchange Account ({userPositions.length} Trades)
        </button>
      </div>

      {/* Performance Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-dark-900 border border-dark-800 p-4 rounded-xl">
          <span className="text-xs text-slate-400 font-mono">Total Trades</span>
          <p className="text-xl font-black text-white font-mono mt-1">{filteredPositions.length}</p>
          <span className="text-[11px] text-slate-500 font-mono">
            {tpCount} TP • {slCount} SL • {flipCount} Flip
          </span>
        </div>

        <div className="bg-dark-900 border border-dark-800 p-4 rounded-xl">
          <span className="text-xs text-slate-400 font-mono">Strategy Winrate</span>
          <p className="text-xl font-black text-emerald-400 font-mono mt-1">{winrate}%</p>
          <span className="text-[11px] text-slate-500 font-mono">{winningTrades.length} winning cycles</span>
        </div>

        <div className="bg-dark-900 border border-dark-800 p-4 rounded-xl">
          <span className="text-xs text-slate-400 font-mono">Target Risk Rule</span>
          <p className="text-xl font-black text-white font-mono mt-1">7.0x</p>
          <span className="text-[11px] text-honey-400 font-mono">TP +5.0% / SL -1.5%</span>
        </div>

        <div className="bg-dark-900 border border-dark-800 p-4 rounded-xl">
          <span className="text-xs text-slate-400 font-mono">Average Slot Allocation</span>
          <p className="text-xl font-black text-white font-mono mt-1">$1,000</p>
          <span className="text-[11px] text-slate-500 font-mono">$7,000 Total Volume</span>
        </div>
      </div>

      {/* Pair Filter Pills */}
      <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-xs">
        <span className="text-slate-500 text-[11px] uppercase mr-1">Filter Pair:</span>
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
          <div className="p-12 text-center text-slate-500 font-mono text-sm">Loading trade history...</div>
        ) : filteredPositions.length === 0 ? (
          <div className="p-12 text-center">
            <History className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-white">No closed trades found</h3>
            <p className="text-xs text-slate-400 mt-1">
              {activeTab === 'user'
                ? 'Your bot has not closed any live exchange trades yet. Switch to "Master Bot Strategy" tab to view 6 months of audited strategy performance.'
                : 'No trades match the selected filter.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-dark-950/80 sticky top-0 z-10 text-[11px] uppercase tracking-wider text-slate-400 font-mono border-b border-dark-800 backdrop-blur-md">
                <tr>
                  <th className="px-5 py-3">Pair Symbol</th>
                  <th className="px-5 py-3">Exit Reason</th>
                  <th className="px-5 py-3">Entry → Exit Ratio</th>
                  <th className="px-5 py-3">Execution Dates</th>
                  <th className="px-5 py-3 text-right">Realized PnL ($)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-800 font-mono text-xs">
                {filteredPositions.map((pos) => {
                  const pnl = Number(pos.realized_pnl_usd) || 0;
                  const pnlPct = Number(pos.pnl_pct) || 0;
                  return (
                    <tr key={pos.id} className="hover:bg-dark-850/50 transition-colors">
                      <td className="px-5 py-4">
                        <div className="font-bold text-white text-sm">{pos.pair_symbol}</div>
                        <div className="text-[10px] text-slate-500">
                          {pos.long_symbol} / {pos.short_symbol}
                        </div>
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
                          {pos.exit_reason === 'tp'
                            ? 'Take Profit (+5.0%)'
                            : pos.exit_reason === 'sl'
                            ? 'Stop Loss (-1.5%)'
                            : 'Trend Flip'}
                        </span>
                      </td>

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

                      <td className="px-5 py-4 text-slate-400 text-[11px]">
                        <div>In: {new Date(pos.opened_at).toLocaleDateString('en-US')}</div>
                        {pos.closed_at && (
                          <div className="text-slate-500 text-[10px]">
                            Out: {new Date(pos.closed_at).toLocaleDateString('en-US')}
                          </div>
                        )}
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
    </div>
  );
}
