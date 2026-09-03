'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Users,
  CreditCard,
  Layers,
  Activity,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Search,
  Filter,
  ArrowLeft,
  KeyRound,
  RefreshCw,
  Wallet,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { toast } from '@/components/ui/sonner';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { LanguageSwitcher } from '@/lib/i18n/LanguageSwitcher';
import { isUnfilledSimulation } from '@/lib/positions';

export default function AdminDashboardPage() {
  const router = useRouter();
  const { t, dateLocale, formatDate, formatDateTime } = useLanguage();
  const [activeTab, setActiveTab] = useState<'users' | 'invoices' | 'positions' | 'health'>('users');
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // Data states
  const [users, setUsers] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [healthLogs, setHealthLogs] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Invoice moderation state
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [actionType, setActionType] = useState<'approve' | 'reject' | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);

  async function checkAdminAndLoadData() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      router.push('/login');
      return;
    }

    // Check user role in users_profile
    const { data: prof } = await supabase
      .from('users_profile')
      .select('*')
      .eq('id', user.id)
      .single();

    if (prof?.role !== 'admin') {
      router.push('/dashboard');
      return;
    }

    setIsAdmin(true);

    // Load all users with their connected exchanges and trading settings
    const { data: allUsers } = await supabase
      .from('users_profile')
      .select('*, exchange_accounts(*), trading_settings(*)');

    if (allUsers) setUsers(allUsers);

    // Load all invoices
    const { data: allInvoices } = await supabase
      .from('invoices')
      .select('*, users_profile:users_profile!invoices_user_id_fkey(email, full_name)')
      .order('created_at', { ascending: false });

    if (allInvoices) setInvoices(allInvoices);

    // Load all open and recently closed positions across all users
    const { data: allPositions } = await supabase
      .from('bot_positions')
      .select('*, users_profile:users_profile!user_id(email)')
      .order('opened_at', { ascending: false })
      .limit(50);

    if (allPositions) setPositions(allPositions.filter((p) => !isUnfilledSimulation(p)));

    // Load system health logs
    const { data: health } = await supabase
      .from('system_health_logs')
      .select('*')
      .order('pinged_at', { ascending: false })
      .limit(10);

    if (health) setHealthLogs(health);

    setLoading(false);
  }

  useEffect(() => {
    checkAdminAndLoadData();

    // Subscribe to realtime updates on invoices and users
    const channel = supabase
      .channel('admin_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => {
        checkAdminAndLoadData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'users_profile' }, () => {
        checkAdminAndLoadData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [router]);

  const handleApproveInvoice = async (invoice: any) => {
    setSelectedInvoice(invoice);
    setActionType('approve');
    setIsConfirmModalOpen(true);
  };

  const handleRejectInvoice = async (invoice: any) => {
    setSelectedInvoice(invoice);
    setActionType('reject');
    setIsConfirmModalOpen(true);
  };

  const confirmInvoiceAction = async () => {
    if (!selectedInvoice || !actionType) return;
    setIsConfirmModalOpen(false);

    try {
      const { data: { user: adminUser } } = await supabase.auth.getUser();

      if (actionType === 'approve') {
        // 1. Mark invoice paid
        await supabase
          .from('invoices')
          .update({
            status: 'paid',
            paid_at: new Date().toISOString(),
            approved_by_admin_id: adminUser?.id || null,
          })
          .eq('id', selectedInvoice.id);

        // 2. Extend subscription for user by 7 days and unfreeze if frozen
        const newPaidUntil = new Date(Date.now() + 7 * 86400000).toISOString();
        await supabase
          .from('users_profile')
          .update({
            subscription_status: 'active',
            is_frozen: false,
            subscription_paid_until: newPaidUntil,
            high_water_mark_equity: selectedInvoice.hwm_after,
          })
          .eq('id', selectedInvoice.user_id);

        const successText = t('admin.approvedToast', { number: selectedInvoice.invoice_number });
        toast.success(successText);
      } else if (actionType === 'reject') {
        await supabase
          .from('invoices')
          .update({
            status: 'issued',
            user_notes: rejectReason ? `Rejected: ${rejectReason}` : 'Rejected by administrator',
          })
          .eq('id', selectedInvoice.id);

        const errorText = t('admin.rejectedToast', { number: selectedInvoice.invoice_number });
        toast.error(errorText);
      }

      checkAdminAndLoadData();
    } catch (err: any) {
      const errorText = err.message || 'Action failed';
      toast.error(errorText);
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase();
    return (
      u.email?.toLowerCase().includes(q) ||
      u.full_name?.toLowerCase().includes(q) ||
      u.role?.toLowerCase().includes(q) ||
      u.subscription_status?.toLowerCase().includes(q)
    );
  });

  const totalCollectedProfit = invoices
    .filter((i) => i.status === 'paid')
    .reduce((sum, i) => sum + Number(i.total_amount_usd || 0), 0);

  const pendingReviewInvoices = invoices.filter((i) => i.status === 'pending_review');

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-950 flex items-center justify-center text-slate-400 font-mono text-sm">
        {t('admin.loading')}
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-dark-950 text-slate-100 flex flex-col">
      {/* Top Navigation Bar */}
      <header className="border-b border-dark-800 bg-dark-900/90 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="p-2 rounded-xl bg-dark-800 hover:bg-dark-700 text-slate-300 hover:text-white transition-colors flex items-center gap-1.5 text-xs font-semibold"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('admin.userDashboard')}
            </Link>

            <div className="h-5 w-px bg-dark-800" />

            <div className="flex items-center gap-2">
              <span className="text-lg font-extrabold text-white tracking-tight">{t('admin.adminControl')}</span>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-honey-500/15 text-honey-400 border border-honey-500/30">
                {t('admin.master')}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <LanguageSwitcher variant="compact" />
            <button
              onClick={checkAdminAndLoadData}
              className="p-2 bg-dark-800 hover:bg-dark-700 rounded-xl text-slate-400 hover:text-white transition-colors"
              title="Refresh Data"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Admin Content */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full space-y-8">
        {/* Top Summary Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl">
            <div className="flex justify-between items-center text-xs text-slate-400 font-medium">
              <span>{t('admin.totalUsers')}</span>
              <Users className="w-4 h-4 text-honey-400" />
            </div>
            <p className="text-2xl font-black text-white font-mono mt-2">{users.length}</p>
            <span className="text-[11px] text-slate-500 font-mono">
              {t('admin.onTrial', {
                trial: users.filter((u) => u.subscription_status === 'trial').length,
                active: users.filter((u) => u.subscription_status === 'active').length,
              })}
            </span>
          </div>

          <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl">
            <div className="flex justify-between items-center text-xs text-slate-400 font-medium">
              <span>{t('admin.pendingInvoices')}</span>
              <CreditCard className="w-4 h-4 text-amber-400" />
            </div>
            <p className="text-2xl font-black text-amber-400 font-mono mt-2">
              {pendingReviewInvoices.length}
            </p>
            <span className="text-[11px] text-slate-500 font-mono">{t('admin.requireVerification')}</span>
          </div>

          <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl">
            <div className="flex justify-between items-center text-xs text-slate-400 font-medium">
              <span>{t('admin.totalRevenue')}</span>
              <Wallet className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="text-2xl font-black text-emerald-400 font-mono mt-2">
              ${totalCollectedProfit.toFixed(2)}
            </p>
            <span className="text-[11px] text-slate-500 font-mono">{t('admin.fromSubs')}</span>
          </div>

          <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl">
            <div className="flex justify-between items-center text-xs text-slate-400 font-medium">
              <span>{t('admin.daemonState')}</span>
              <Activity className="w-4 h-4 text-honey-400" />
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-mono font-bold text-white text-base">{t('admin.online')}</span>
            </div>
            <span className="text-[11px] text-slate-500 font-mono">{t('admin.railwayActive')}</span>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-dark-800 gap-2 font-mono text-xs font-semibold uppercase">
          <button
            onClick={() => setActiveTab('users')}
            className={`pb-3 px-4 border-b-2 transition-colors ${
              activeTab === 'users'
                ? 'border-honey-500 text-honey-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            {t('admin.usersDir', { count: users.length })}
          </button>
          <button
            onClick={() => setActiveTab('invoices')}
            className={`pb-3 px-4 border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'invoices'
                ? 'border-honey-500 text-honey-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <span>{t('admin.invoicesPayments')}</span>
            {pendingReviewInvoices.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-amber-500 text-dark-950 font-black text-[10px] flex items-center justify-center">
                {pendingReviewInvoices.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('positions')}
            className={`pb-3 px-4 border-b-2 transition-colors ${
              activeTab === 'positions'
                ? 'border-honey-500 text-honey-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            {t('admin.livePositions')}
          </button>
          <button
            onClick={() => setActiveTab('health')}
            className={`pb-3 px-4 border-b-2 transition-colors ${
              activeTab === 'health'
                ? 'border-honey-500 text-honey-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            {t('admin.healthPings')}
          </button>
        </div>

        {/* TAB 1: USERS DIRECTORY */}
        {activeTab === 'users' && (
          <div className="bg-dark-900 border border-dark-800 rounded-2xl shadow-xl overflow-hidden">
            <div className="p-5 border-b border-dark-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative w-full sm:w-80">
                <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder={t('admin.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-dark-950 border border-dark-700 rounded-xl text-xs text-white outline-none focus:border-honey-500 font-mono"
                />
              </div>
              <span className="text-xs text-slate-400 font-mono">
                {t('admin.showing', { filtered: filteredUsers.length, total: users.length })}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-dark-950/60 text-[11px] uppercase tracking-wider text-slate-400 font-mono border-b border-dark-800">
                  <tr>
                    <th className="px-5 py-3">{t('admin.colUser')}</th>
                    <th className="px-5 py-3">{t('admin.colRole')}</th>
                    <th className="px-5 py-3">{t('admin.colSub')}</th>
                    <th className="px-5 py-3">{t('admin.colExchange')}</th>
                    <th className="px-5 py-3">{t('admin.colBot')}</th>
                    <th className="px-5 py-3 text-right">{t('admin.colHwm')}</th>
                    <th className="px-5 py-3 text-center">{t('admin.colControl')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-800 font-mono text-xs">
                  {filteredUsers.map((u) => {
                    const exchangeAcc = u.exchange_accounts?.[0];
                    const tradingSet = u.trading_settings?.[0];
                    return (
                      <tr key={u.id} className="hover:bg-dark-850/50 transition-colors">
                        <td className="px-5 py-4">
                          <div className="font-bold text-white">{u.full_name || t('common.trader')}</div>
                          <div className="text-slate-400 text-[11px]">{u.email}</div>
                        </td>
                        <td className="px-5 py-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                              u.role === 'admin'
                                ? 'bg-amber-500/20 text-honey-400 border border-honey-500/30'
                                : 'bg-dark-800 text-slate-400'
                            }`}
                          >
                            {u.role}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                              u.subscription_status === 'trial'
                                ? 'bg-honey-500/15 text-honey-400'
                                : u.subscription_status === 'active'
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'bg-rose-500/15 text-rose-400'
                            }`}
                          >
                            {u.subscription_status}
                          </span>
                          {u.is_frozen && (
                            <span className="ml-1.5 text-[10px] text-rose-400 font-bold">{t('admin.frozen')}</span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          {exchangeAcc ? (
                            <div className="text-emerald-400 font-semibold uppercase flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                              <span>{exchangeAcc.exchange}</span>
                              <span className="text-slate-500 text-[10px]">
                                (${Number(exchangeAcc.last_balance_usd || 0).toFixed(0)})
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-600 font-medium">{t('admin.noneLinked')}</span>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                              tradingSet?.is_bot_active
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : 'bg-dark-800 text-slate-500'
                            }`}
                          >
                            {tradingSet?.is_bot_active ? t('admin.botActive') : t('admin.botOff')}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-right text-slate-200 font-bold">
                          ${Number(u.high_water_mark_equity || 0).toFixed(2)}
                        </td>
                        <td className="px-5 py-4 text-center">
                          {u.role !== 'admin' && (
                            <button
                              onClick={async () => {
                                const nextFrozen = !u.is_frozen;
                                await supabase
                                  .from('users_profile')
                                  .update({ is_frozen: nextFrozen })
                                  .eq('id', u.id);
                                checkAdminAndLoadData();
                              }}
                              className={`px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
                                u.is_frozen
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30'
                                  : 'bg-rose-500/15 text-rose-400 border border-rose-500/30 hover:bg-rose-500/25'
                              }`}
                            >
                              {u.is_frozen ? t('admin.unfreeze') : t('admin.freeze')}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: INVOICES MODERATION */}
        {activeTab === 'invoices' && (
          <div className="bg-dark-900 border border-dark-800 rounded-2xl shadow-xl overflow-hidden">
            <div className="p-5 border-b border-dark-800 flex justify-between items-center">
              <h2 className="text-base font-bold text-white">{t('admin.systemInvoices')}</h2>
              <span className="text-xs font-mono text-slate-400">{t('admin.totalInvoices', { count: invoices.length })}</span>
            </div>

            {invoices.length === 0 ? (
              <div className="p-12 text-center text-slate-500 font-mono text-sm">
                {t('admin.noInvoices')}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-dark-950/60 text-[11px] uppercase tracking-wider text-slate-400 font-mono border-b border-dark-800">
                    <tr>
                      <th className="px-5 py-3">{t('admin.colInvoice')}</th>
                      <th className="px-5 py-3">{t('admin.colPeriod')}</th>
                      <th className="px-5 py-3">{t('admin.colAmount')}</th>
                      <th className="px-5 py-3">{t('admin.colStatus')}</th>
                      <th className="px-5 py-3">{t('admin.colTxid')}</th>
                      <th className="px-5 py-3 text-right">{t('admin.colActions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-800 font-mono text-xs">
                    {invoices.map((inv) => {
                      const isPending = inv.status === 'pending_review';
                      const explorerUrl =
                        inv.payment_network === 'TRC20'
                          ? `https://tronscan.org/#/transaction/${inv.tx_hash}`
                          : `https://bscscan.com/tx/${inv.tx_hash}`;

                      return (
                        <tr key={inv.id} className="hover:bg-dark-850/50 transition-colors">
                          <td className="px-5 py-4">
                            <div className="font-bold text-white">{inv.invoice_number}</div>
                            <div className="text-slate-400 text-[11px]">
                              {inv.users_profile?.email || inv.user_id}
                            </div>
                          </td>
                          <td className="px-5 py-4 text-slate-400 text-[11px]">
                            {formatDate(inv.period_start)} –{' '}
                            {formatDate(inv.period_end)}
                          </td>
                          <td className="px-5 py-4">
                            <div className="font-bold text-honey-400 text-sm">
                              ${Number(inv.total_amount_usd).toFixed(2)} USDT
                            </div>
                            <div className="text-[10px] text-slate-500">
                              Fixed: ${Number(inv.base_fee_usd).toFixed(0)} • Profit:{' '}
                              ${Number(inv.profit_fee_usd).toFixed(2)}
                            </div>
                          </td>
                          <td className="px-5 py-4">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                                inv.status === 'paid'
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                  : inv.status === 'pending_review'
                                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 animate-pulse'
                                  : inv.status === 'frozen'
                                  ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                                  : 'bg-dark-800 text-slate-400'
                              }`}
                            >
                              {inv.status}
                            </span>
                          </td>
                          <td className="px-5 py-4">
                            {inv.tx_hash ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] text-slate-300 font-bold">
                                  {inv.payment_network}:
                                </span>
                                <a
                                  href={explorerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-honey-400 hover:underline text-[11px] flex items-center gap-1"
                                >
                                  {inv.tx_hash.substring(0, 10)}...{inv.tx_hash.substring(inv.tx_hash.length - 6)}
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                            ) : (
                              <span className="text-slate-600 text-[11px]">{t('admin.noHash')}</span>
                            )}
                          </td>
                          <td className="px-5 py-4 text-right">
                            {isPending ? (
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => handleApproveInvoice(inv)}
                                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-all"
                                >
                                  {t('admin.approve')}
                                </button>
                                <button
                                  onClick={() => handleRejectInvoice(inv)}
                                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-dark-800 hover:bg-rose-600/20 text-rose-400 border border-rose-500/20 transition-all"
                                >
                                  {t('admin.reject')}
                                </button>
                              </div>
                            ) : (
                              <span className="text-slate-500 text-[11px]">
                                {inv.status === 'paid' ? t('admin.completed') : t('admin.awaitingPayment')}
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
        )}

        {/* TAB 3: GLOBAL POSITIONS */}
        {activeTab === 'positions' && (
          <div className="bg-dark-900 border border-dark-800 rounded-2xl shadow-xl overflow-hidden">
            <div className="p-5 border-b border-dark-800 flex justify-between items-center">
              <h2 className="text-base font-bold text-white">{t('admin.globalTrades')}</h2>
              <span className="text-xs font-mono text-slate-400">{t('admin.loggedTrades', { count: positions.length })}</span>
            </div>

            {positions.length === 0 ? (
              <div className="p-12 text-center text-slate-500 font-mono text-sm">
                {t('admin.noTrades')}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-dark-950/60 text-[11px] uppercase tracking-wider text-slate-400 font-mono border-b border-dark-800">
                    <tr>
                      <th className="px-5 py-3">{t('admin.colTrader')}</th>
                      <th className="px-5 py-3">{t('admin.colPair')}</th>
                      <th className="px-5 py-3">{t('common.status')}</th>
                      <th className="px-5 py-3">{t('admin.colRatio')}</th>
                      <th className="px-5 py-3">{t('admin.colMargin')}</th>
                      <th className="px-5 py-3 text-right">{t('admin.colPnl')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-dark-800 font-mono text-xs">
                    {positions.map((p) => {
                      const pnl = Number(p.realized_pnl_usd ?? p.unrealized_pnl_usd ?? 0);
                      return (
                        <tr key={p.id} className="hover:bg-dark-850/50 transition-colors">
                          <td className="px-5 py-4 text-slate-300">
                            {p.users_profile?.email?.split('@')[0] || p.user_id.substring(0, 8)}
                          </td>
                          <td className="px-5 py-4 font-bold text-white">{p.pair_symbol}</td>
                          <td className="px-5 py-4">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                                p.status === 'open'
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : 'bg-dark-800 text-slate-400'
                              }`}
                            >
                              {p.status}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-slate-400">
                            {Number(p.entry_ratio).toFixed(4)}
                          </td>
                          <td className="px-5 py-4 text-slate-300">
                            ${Number(p.allocated_margin_usd).toFixed(2)}
                          </td>
                          <td className="px-5 py-4 text-right">
                            <span
                              className={`font-bold ${
                                pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: SYSTEM HEALTH PINGS */}
        {activeTab === 'health' && (
          <div className="bg-dark-900 border border-dark-800 rounded-2xl shadow-xl overflow-hidden">
            <div className="p-5 border-b border-dark-800 flex justify-between items-center">
              <h2 className="text-base font-bold text-white">{t('admin.healthLogs')}</h2>
              <span className="text-xs font-mono text-slate-400">{t('admin.pingCycles')}</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-dark-950/60 text-[11px] uppercase tracking-wider text-slate-400 font-mono border-b border-dark-800">
                  <tr>
                    <th className="px-5 py-3">{t('admin.colComponent')}</th>
                    <th className="px-5 py-3">{t('admin.colHealth')}</th>
                    <th className="px-5 py-3">{t('admin.colLatency')}</th>
                    <th className="px-5 py-3 text-right">{t('admin.colPing')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-800 font-mono text-xs">
                  {healthLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-dark-850/50 transition-colors">
                      <td className="px-5 py-4 font-bold text-white uppercase">{log.component}</td>
                      <td className="px-5 py-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                            log.status === 'healthy'
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                          }`}
                        >
                          {log.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-honey-400 font-bold">{log.latency_ms} ms</td>
                      <td className="px-5 py-4 text-right text-slate-400 text-[11px]">
                        {formatDateTime(log.pinged_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* Confirmation Modal for Invoices */}
      <ConfirmModal
        isOpen={isConfirmModalOpen}
        title={actionType === 'approve' ? t('admin.approveTitle') : t('admin.rejectTitle')}
        description={
          actionType === 'approve'
            ? t('admin.approveDesc', {
                number: selectedInvoice?.invoice_number ?? '',
                amount: Number(selectedInvoice?.total_amount_usd || 0).toFixed(2),
              })
            : t('admin.rejectDesc', { number: selectedInvoice?.invoice_number ?? '' })
        }
        confirmText={actionType === 'approve' ? t('admin.approvePayment') : t('admin.rejectPayment')}
        isDestructive={actionType === 'reject'}
        onConfirm={confirmInvoiceAction}
        onCancel={() => setIsConfirmModalOpen(false)}
      />
    </div>
  );
}
