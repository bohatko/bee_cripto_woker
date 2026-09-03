'use client';

import React, { useState, useEffect } from 'react';
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
  CheckCircle2,
  Clock,
  KeyRound,
  AlertCircle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { PanicCloseModal } from '@/components/modals/PanicCloseModal';

export default function DashboardPage() {
  const [positions, setPositions] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [account, setAccount] = useState<any>(null);
  const [healthLogs, setHealthLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals state
  const [isToggleModalOpen, setIsToggleModalOpen] = useState(false);
  const [isPanicModalOpen, setIsPanicModalOpen] = useState(false);
  const [isMissingExchangeModalOpen, setIsMissingExchangeModalOpen] = useState(false);

  async function loadDashboardData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // 1. Fetch user trading settings
    const { data: sett } = await supabase
      .from('trading_settings')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (sett) setSettings(sett);

    // 2. Fetch connected exchange account
    const { data: acc } = await supabase
      .from('exchange_accounts')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();

    setAccount(acc || null);

    // Auto-disable bot if exchange keys were removed/missing
    if ((!acc || !acc.is_validated) && sett?.is_bot_active) {
      await supabase
        .from('trading_settings')
        .update({ is_bot_active: false })
        .eq('id', sett.id);
      setSettings((prev: any) => (prev ? { ...prev, is_bot_active: false } : null));
    }

    // 3. Fetch active open positions
    const { data: pos } = await supabase
      .from('bot_positions')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'open');

    if (pos) setPositions(pos);

    // 4. Fetch latest system health logs
    const { data: health } = await supabase
      .from('system_health_logs')
      .select('*')
      .order('pinged_at', { ascending: false })
      .limit(4);

    if (health) setHealthLogs(health);

    setLoading(false);
  }

  useEffect(() => {
    loadDashboardData();

    // Subscribe to realtime updates for positions and health
    const posChannel = supabase
      .channel('dashboard_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bot_positions' },
        () => loadDashboardData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'system_health_logs' },
        () => loadDashboardData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trading_settings' },
        () => loadDashboardData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(posChannel);
    };
  }, []);

  const totalUnrealizedPnl = positions.reduce(
    (acc, p) => acc + (Number(p.unrealized_pnl_usd) || 0),
    0
  );

  const handleToggleBot = async () => {
    if (!settings) return;

    // Check if exchange account is linked and validated
    if (!account || !account.is_validated) {
      setIsToggleModalOpen(false);
      setIsMissingExchangeModalOpen(true);
      return;
    }

    const nextState = !settings.is_bot_active;

    await supabase
      .from('trading_settings')
      .update({ is_bot_active: nextState })
      .eq('id', settings.id);

    setSettings({ ...settings, is_bot_active: nextState });
    setIsToggleModalOpen(false);
  };

  const handlePanicClose = async () => {
    if (!settings) return;

    // Trigger panic signal in trading_settings
    await supabase
      .from('trading_settings')
      .update({
        panic_closed_at: new Date().toISOString(),
        is_bot_active: false,
      })
      .eq('id', settings.id);

    setIsPanicModalOpen(false);
    // Reload positions after signal
    setTimeout(loadDashboardData, 1500);
  };

  return (
    <div className="p-4 sm:p-8 space-y-6">
      {/* Top Bar: Title & Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Trading Dashboard
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            Real-time multi-pair market-neutral position monitoring and risk management.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (!settings?.is_bot_active && (!account || !account.is_validated)) {
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
                <Pause className="w-4 h-4" /> Pause Trading
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-current" /> Start Trading
              </>
            )}
          </button>

          <button
            onClick={() => setIsPanicModalOpen(true)}
            disabled={positions.length === 0}
            className="px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-rose-600/15 text-rose-400 border border-rose-600/30 hover:bg-rose-600/25 transition-all flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <AlertOctagon className="w-4 h-4" />
            Panic Close All
          </button>
        </div>
      </div>

      {/* Warning banner if exchange is not linked */}
      {(!account || !account.is_validated) && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/15 text-honey-400 shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">No Exchange Account Connected</h4>
              <p className="text-xs text-slate-300 mt-0.5">
                Trading is blocked until you connect at least one exchange API (Binance, OKX, or Bybit).
              </p>
            </div>
          </div>
          <Link
            href="/settings/exchange"
            className="px-4 py-2 rounded-xl text-xs font-bold bg-honey-500 hover:bg-honey-400 text-dark-950 flex items-center justify-center gap-1.5 transition-all shadow-md shadow-honey-500/20 shrink-0"
          >
            <KeyRound className="w-3.5 h-3.5" />
            Connect API Keys
          </Link>
        </div>
      )}

      {/* System Health Monitor */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-dark-900 border border-dark-800 p-3.5 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs font-medium text-slate-300">Railway Daemon</span>
          </div>
          <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
            ONLINE (12ms)
          </span>
        </div>

        <div className="bg-dark-900 border border-dark-800 p-3.5 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                account?.is_validated ? 'bg-emerald-400' : 'bg-amber-400'
              }`}
            />
            <span className="text-xs font-medium text-slate-300">
              Exchange ({account?.exchange?.toUpperCase() || 'NOT LINKED'})
            </span>
          </div>
          <span
            className={`text-[11px] font-mono px-2 py-0.5 rounded border ${
              account?.is_validated
                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                : 'text-amber-400 bg-amber-500/10 border-amber-500/20'
            }`}
          >
            {account?.is_validated ? 'CONNECTED' : 'WAITING KEYS'}
          </span>
        </div>

        <div className="bg-dark-900 border border-dark-800 p-3.5 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                settings?.is_bot_active ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
              }`}
            />
            <span className="text-xs font-medium text-slate-300">Bot Strategy State</span>
          </div>
          <span
            className={`text-[11px] font-mono px-2 py-0.5 rounded border uppercase ${
              settings?.is_bot_active
                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                : 'text-slate-400 bg-dark-800 border-dark-700'
            }`}
          >
            {settings?.is_bot_active ? 'ACTIVE (7x)' : 'IDLE'}
          </span>
        </div>
      </div>

      {/* Key Financial Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Total Account Equity</span>
            <Wallet className="w-4 h-4 text-honey-400" />
          </div>
          <p className="text-2xl font-black text-white font-mono mt-2">
            ${(Number(account?.last_balance_usd) || 0.0).toLocaleString('en-US', {
              minimumFractionDigits: 2,
            })}{' '}
            <span className="text-xs text-slate-500 font-normal">USDT</span>
          </p>
          <div className="mt-2 text-[11px] text-slate-400 font-mono">
            Available Margin:{' '}
            <span className="text-slate-200 font-semibold">
              ${((Number(account?.last_balance_usd) || 0.0) * 0.75).toFixed(2)}
            </span>
          </div>
        </div>

        <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Basket Floating PnL</span>
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
            Active Open Legs:{' '}
            <span className="text-slate-200 font-semibold">{positions.length * 2}</span>
          </div>
        </div>

        <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Risk Constraints</span>
            <ShieldCheck className="w-4 h-4 text-honey-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-3 font-mono">
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
            Trend-Flip Filter: EMA10 Exit Guard
          </p>
        </div>
      </div>

      {/* Active Basket Positions Table */}
      <div className="bg-dark-900 border border-dark-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-5 border-b border-dark-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Layers className="w-5 h-5 text-honey-400" />
            <h2 className="text-base font-bold text-white tracking-tight">
              Active Long-Short Basket Pairs
            </h2>
          </div>
          <span className="text-xs font-mono text-slate-400">
            {positions.length} Positions Open
          </span>
        </div>

        {positions.length === 0 ? (
          <div className="p-12 text-center">
            <Layers className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-white">No active pairs open</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              When market scanner detects Ratio &gt; EMA10 and the bot is active, long-short legs will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-dark-950/60 text-[11px] uppercase tracking-wider text-slate-400 font-mono border-b border-dark-800">
                <tr>
                  <th className="px-5 py-3">Strategy Pair</th>
                  <th className="px-5 py-3">Ratio (Entry / Now)</th>
                  <th className="px-5 py-3">Long Leg</th>
                  <th className="px-5 py-3">Short Leg</th>
                  <th className="px-5 py-3">Margin / Vol</th>
                  <th className="px-5 py-3 text-right">PnL (% / $)</th>
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
                          Market-Neutral
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="text-slate-300">
                          {Number(p.entry_ratio).toFixed(4)}
                        </div>
                        <div className="text-[11px] text-honey-400">
                          Now: {Number(p.current_ratio || p.entry_ratio).toFixed(4)}
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
                        ${Number(p.allocated_margin_usd).toFixed(2)}
                        <div className="text-[10px] text-slate-500">
                          Vol: ${Number(p.total_position_volume_usd).toFixed(0)}
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

      {/* Start/Pause Bot Confirmation Modal */}
      <ConfirmModal
        isOpen={isToggleModalOpen}
        title={settings?.is_bot_active ? 'Pause Autonomous Trading?' : 'Activate Autonomous Trading?'}
        description={
          settings?.is_bot_active
            ? 'The bot will stop opening new basket entries. Existing open positions will continue to be safely monitored until Take-Profit or Stop-Loss.'
            : 'The engine will begin mirroring multi-pair basket orders on your connected exchange account with 7x leverage and 1.5% stop-loss.'
        }
        confirmText={settings?.is_bot_active ? 'Pause Bot' : 'Start Bot'}
        onConfirm={handleToggleBot}
        onCancel={() => setIsToggleModalOpen(false)}
      />

      {/* Emergency Panic Close Modal */}
      <PanicCloseModal
        isOpen={isPanicModalOpen}
        unrealizedPnl={totalUnrealizedPnl}
        openPositionsCount={positions.length}
        onConfirm={handlePanicClose}
        onCancel={() => setIsPanicModalOpen(false)}
      />

      {/* Missing Exchange Warning Modal */}
      {isMissingExchangeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-md bg-dark-900 border border-amber-500/40 rounded-2xl p-6 shadow-2xl">
            <div className="flex items-start gap-4 mb-4">
              <div className="p-3 rounded-xl bg-amber-500/15 text-honey-400 border border-amber-500/30">
                <AlertCircle className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Exchange Connection Required</h3>
                <p className="text-sm text-slate-300 mt-1.5 leading-relaxed">
                  You cannot start trading because no valid exchange API is connected. Please link at least one exchange (Binance, OKX, or Bybit) in settings first.
                </p>
              </div>
            </div>

            <div className="bg-dark-950 border border-dark-800 rounded-xl p-3.5 my-4 text-xs font-mono text-slate-400 space-y-1">
              <div>• Required: Futures trading permission</div>
              <div>• Whitelist IP: <span className="text-honey-400">54.198.120.45</span></div>
              <div className="text-rose-400 font-semibold">• Strictly disable withdrawal permissions</div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setIsMissingExchangeModalOpen(false)}
                className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white bg-dark-800 hover:bg-dark-700 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <Link
                href="/settings/exchange"
                onClick={() => setIsMissingExchangeModalOpen(false)}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-honey-500 hover:bg-honey-400 text-dark-950 flex items-center gap-1.5 transition-all shadow-md shadow-honey-500/20"
              >
                <KeyRound className="w-4 h-4" />
                Connect Exchange API
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
