'use client';

import React, { useState, useEffect } from 'react';
import {
  KeyRound,
  ShieldAlert,
  Copy,
  Check,
  CheckCircle2,
  Trash2,
  AlertTriangle,
  Server,
  Lock,
  RefreshCw,
  Wallet,
  Building2,
  ArrowRight,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ConfirmModal } from '@/components/modals/ConfirmModal';

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

export default function ExchangeSettingsPage() {
  const [exchange, setExchange] = useState<'binance' | 'okx' | 'bybit'>('binance');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [loading, setLoading] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const [accounts, setAccounts] = useState<ExchangeAccountItem[]>([]);
  const [accountToDelete, setAccountToDelete] = useState<ExchangeAccountItem | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);

  const railwayStaticIp = process.env.NEXT_PUBLIC_RAILWAY_EGRESS_IP || '54.198.120.45';

  async function loadAccounts() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('exchange_accounts')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    if (data) {
      setAccounts(data as ExchangeAccountItem[]);
    }
  }

  useEffect(() => {
    loadAccounts();
  }, []);

  const handleCopyIp = () => {
    navigator.clipboard.writeText(railwayStaticIp);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveKeys = async () => {
    setLoading(true);
    setStatusMsg(null);
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
          exchange,
          apiKey: apiKey.trim(),
          apiSecret: apiSecret.trim(),
          passphrase: exchange === 'okx' ? passphrase.trim() : undefined,
        }),
      });

      const resData = await response.json();

      if (!response.ok) {
        throw new Error(resData.error || 'Failed to validate exchange API credentials');
      }

      setStatusMsg({
        type: 'success',
        text: `Successfully validated and linked ${exchange.toUpperCase()}! Live futures balance: $${Number(
          resData.balanceUsd || 0
        ).toLocaleString('en-US', { minimumFractionDigits: 2 })} USDT`,
      });

      setApiKey('');
      setApiSecret('');
      setPassphrase('');
      await loadAccounts();
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err.message || 'Failed to save exchange credentials',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSyncAll = async () => {
    setSyncingAll(true);
    setStatusMsg(null);

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

      setStatusMsg({
        type: 'success',
        text: `Live balances refreshed: Total $${Number(data.totalEquityUsd || 0).toLocaleString(
          'en-US',
          { minimumFractionDigits: 2 }
        )} USDT across ${data.accounts?.length || 0} exchange(s).`,
      });

      await loadAccounts();
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err.message || 'Failed to sync exchange balances',
      });
    } finally {
      setSyncingAll(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!accountToDelete) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();

    await supabase.from('exchange_accounts').delete().eq('id', accountToDelete.id);

    // If no accounts left, disable bot
    const remaining = accounts.filter((a) => a.id !== accountToDelete.id);
    if (remaining.length === 0 && user) {
      await supabase
        .from('trading_settings')
        .update({ exchange_account_id: null, is_bot_active: false })
        .eq('user_id', user.id);
    }

    setAccountToDelete(null);
    setIsDeleteModalOpen(false);
    setStatusMsg({
      type: 'success',
      text: `${accountToDelete.exchange.toUpperCase()} API keys removed completely from database.`,
    });
    await loadAccounts();
  };

  const totalAggregatedEquity = accounts.reduce(
    (acc, item) => acc + (Number(item.last_balance_usd) || 0),
    0
  );

  return (
    <div className="p-4 sm:p-8 max-w-5xl space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Exchange API Connections
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 mt-1">
            Connect your exchange futures accounts. The autonomous worker trades on your behalf
            without withdrawal permissions.
          </p>
        </div>

        {accounts.length > 0 && (
          <button
            onClick={handleSyncAll}
            disabled={syncingAll}
            className="px-4 py-2.5 rounded-xl text-xs font-bold bg-dark-900 border border-dark-700 hover:border-honey-500 text-slate-200 hover:text-white flex items-center gap-2 transition-all shadow-lg disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-honey-400 ${syncingAll ? 'animate-spin' : ''}`} />
            {syncingAll ? 'Syncing Balances...' : 'Sync Live Balances'}
          </button>
        )}
      </div>

      {statusMsg && (
        <div
          className={`p-4 rounded-xl border text-xs font-mono flex items-center gap-2 ${
            statusMsg.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
          }`}
        >
          {statusMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* Railway Static IP Whitelist Card */}
      <div className="bg-dark-900 border border-honey-500/30 rounded-2xl p-5 shadow-xl relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-honey-500/10 text-honey-400 border border-honey-500/20">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Railway Static Outbound Egress IP</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Add this exact IP to your exchange API Key whitelist for maximum security:
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

      {/* Connected Exchanges List */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400">
            Connected Exchange Accounts ({accounts.length})
          </h2>
          {accounts.length > 0 && (
            <span className="text-xs font-mono text-slate-300">
              Total Combined Equity:{' '}
              <span className="text-honey-400 font-bold">
                ${totalAggregatedEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })} USDT
              </span>
            </span>
          )}
        </div>

        {accounts.length === 0 ? (
          <div className="bg-dark-900 border border-dark-800 rounded-2xl p-8 text-center">
            <Building2 className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-300">No exchange accounts connected yet</p>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              Select an exchange below and provide your API keys to enable real-time balance tracking
              and market-neutral automated execution.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                      <span className="text-sm font-black text-white uppercase tracking-wider">
                        {acc.exchange}
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                        acc.is_validated
                          ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                          : 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                      }`}
                    >
                      {acc.is_validated ? 'CONNECTED' : 'CHECKING'}
                    </span>
                  </div>

                  <div className="bg-dark-950 p-3.5 rounded-xl border border-dark-800 mb-3">
                    <span className="text-[10px] text-slate-400 uppercase font-medium">
                      Futures Balance (USDT)
                    </span>
                    <p className="text-xl font-black text-white font-mono mt-0.5">
                      ${Number(acc.last_balance_usd || 0).toLocaleString('en-US', {
                        minimumFractionDigits: 2,
                      })}{' '}
                      <span className="text-xs text-slate-500 font-normal">USDT</span>
                    </p>
                  </div>

                  {acc.last_error_msg ? (
                    <p className="text-[11px] text-rose-400 font-mono mb-2 line-clamp-2">
                      ⚠️ {acc.last_error_msg}
                    </p>
                  ) : (
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono mb-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Withdrawals disabled (Safe)</span>
                    </div>
                  )}

                  <p className="text-[10px] text-slate-500 font-mono">
                    Last synced:{' '}
                    {acc.last_sync_at ? new Date(acc.last_sync_at).toLocaleTimeString() : 'Never'}
                  </p>
                </div>

                <div className="pt-4 border-t border-dark-800 mt-4 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 font-mono">AES-256-GCM Encrypted</span>
                  <button
                    onClick={() => {
                      setAccountToDelete(acc);
                      setIsDeleteModalOpen(true);
                    }}
                    className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors rounded-lg hover:bg-rose-500/10"
                    title="Remove Exchange Keys"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Connection Form */}
      <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 sm:p-8 shadow-xl">
        <h2 className="text-lg font-bold text-white mb-2">Link Exchange API Keys</h2>
        <p className="text-xs text-slate-400 mb-6">
          Your credentials are immediately checked with CCXT to verify that withdrawals are
          forbidden, then encrypted using military-grade AES-256-GCM.
        </p>

        {/* Exchange Selector Tabs */}
        <div className="grid grid-cols-3 gap-2 mb-6 max-w-md">
          {(['binance', 'okx', 'bybit'] as const).map((ex) => (
            <button
              key={ex}
              onClick={() => setExchange(ex)}
              className={`py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                exchange === ex
                  ? 'bg-honey-500 text-dark-950 shadow-md shadow-honey-500/20'
                  : 'bg-dark-950 text-slate-400 border border-dark-800 hover:border-dark-700'
              }`}
            >
              {ex}
            </button>
          ))}
        </div>

        {/* Form Inputs */}
        <div className="space-y-4 max-w-xl">
          <div>
            <label className="block text-xs font-medium text-slate-300 uppercase mb-1.5">
              {exchange.toUpperCase()} API Key
            </label>
            <input
              type="text"
              required
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={`Enter your ${exchange} API key`}
              className="w-full px-4 py-2.5 bg-dark-950 border border-dark-700 rounded-xl text-white text-sm outline-none focus:border-honey-500 font-mono transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 uppercase mb-1.5">
              {exchange.toUpperCase()} API Secret
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

          {exchange === 'okx' && (
            <div>
              <label className="block text-xs font-medium text-slate-300 uppercase mb-1.5">
                OKX API Passphrase
              </label>
              <input
                type="password"
                required
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Passphrase specified during API key creation"
                className="w-full px-4 py-2.5 bg-dark-950 border border-dark-700 rounded-xl text-white text-sm outline-none focus:border-honey-500 font-mono transition-colors"
              />
            </div>
          )}

          {/* Security Notice */}
          <div className="p-4 rounded-xl bg-dark-950 border border-dark-800 flex items-start gap-3">
            <Lock className="w-4 h-4 text-honey-400 shrink-0 mt-0.5" />
            <div className="text-[11px] text-slate-400 space-y-1">
              <p className="font-semibold text-slate-300">Permission Requirements:</p>
              <p>• Enable: "Futures Trading" / "Derivatives"</p>
              <p>• Disable: "Enable Withdrawals" (strictly blocked by our security system)</p>
              <p>• IP Access Restriction: Recommended, restrict to static IP above.</p>
            </div>
          </div>

          <button
            onClick={() => setIsSaveModalOpen(true)}
            disabled={loading || !apiKey || !apiSecret || (exchange === 'okx' && !passphrase)}
            className="w-full py-3 px-4 rounded-xl font-bold text-sm bg-honey-500 hover:bg-honey-400 text-dark-950 shadow-lg shadow-honey-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Testing Live Connection with CCXT...
              </>
            ) : (
              <>
                <KeyRound className="w-4 h-4" />
                Validate & Save {exchange.toUpperCase()} Keys
              </>
            )}
          </button>
        </div>
      </div>

      {/* Confirmation Modals */}
      <ConfirmModal
        isOpen={isSaveModalOpen}
        onClose={() => setIsSaveModalOpen(false)}
        onConfirm={handleSaveKeys}
        title={`Save ${exchange.toUpperCase()} API Keys`}
        description={`This will establish a live CCXT connection to ${exchange.toUpperCase()}, verify futures permissions, fetch your actual wallet balance, and encrypt the keys with AES-256-GCM. Make sure withdrawals are disabled.`}
        confirmText="Connect & Validate"
      />

      <ConfirmModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleDeleteAccount}
        title="Remove Exchange Connection"
        description={`Are you sure you want to remove your ${accountToDelete?.exchange?.toUpperCase()} API keys? This action immediately deletes your credentials from the database.`}
        confirmText="Yes, Delete Keys"
        variant="danger"
      />
    </div>
  );
}
