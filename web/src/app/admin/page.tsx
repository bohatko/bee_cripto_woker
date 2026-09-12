'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
  ChevronDown,
  ChevronRight,
  Play,
  Repeat,
  ArrowRightLeft,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { PairSelectionTraceDrawer } from '@/components/admin/PairSelectionTraceDrawer';
import {
  ReplacePairModal,
  type BasketPairRow,
  type CandidateRow,
} from '@/components/admin/ReplacePairModal';
import { toast } from '@/components/ui/sonner';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { LanguageSwitcher } from '@/lib/i18n/LanguageSwitcher';
import { isUnfilledSimulation, getDisplayPnlUsd } from '@/lib/positions';
import { LineChart, Line } from 'recharts';

export default function AdminDashboardPage() {
  const router = useRouter();
  const { t, dateLocale, formatDate, formatDateTime } = useLanguage();
  const [activeTab, setActiveTab] = useState<'users' | 'invoices' | 'positions' | 'pairs' | 'signals' | 'health'>('users');
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // Data states
  const [users, setUsers] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [healthLogs, setHealthLogs] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Signals state
  const [signalStrategy, setSignalStrategy] = useState<any>(null);
  const [signalEvents, setSignalEvents] = useState<any[]>([]);
  const [isUpdatingSignalStrategy, setIsUpdatingSignalStrategy] = useState(false);

  // Invoice moderation state
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [actionType, setActionType] = useState<'approve' | 'reject' | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);

  // Pairs & rotation state
  const [activePairs, setActivePairs] = useState<any[]>([]);
  const [pairRuns, setPairRuns] = useState<any[]>([]);
  const [engineSettings, setEngineSettings] = useState<any>(null);
  const [engineConfig, setEngineConfig] = useState<any>(null);
  const [lockedPairs, setLockedPairs] = useState<Set<string>>(new Set());
  const [validOnlyCandidates, setValidOnlyCandidates] = useState(true);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [pairsAction, setPairsAction] = useState<'toggleRotation' | 'runSelection' | null>(null);
  const [isPairsConfirmOpen, setIsPairsConfirmOpen] = useState(false);
  const [traceRunId, setTraceRunId] = useState<string | null>(null);
  const [replaceOutgoing, setReplaceOutgoing] = useState<BasketPairRow | null>(null);
  const [isReplacePickerOpen, setIsReplacePickerOpen] = useState(false);
  const [pendingReplacement, setPendingReplacement] = useState<{
    outgoing: BasketPairRow;
    incoming: CandidateRow;
  } | null>(null);
  const [isReplaceConfirmOpen, setIsReplaceConfirmOpen] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);

  async function loadPairsData() {
    // Load current active basket pairs
    const { data: pairs } = await supabase
      .from('strategy_pairs')
      .select('*')
      .eq('is_active', true)
      .order('score', { ascending: false });

    if (pairs) setActivePairs(pairs);

    // Load last 10 pair selection runs
    const { data: runs } = await supabase
      .from('pair_selection_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);

    if (runs) setPairRuns(runs);

    // Load engine settings (single row, id = 1)
    const { data: settings } = await supabase
      .from('engine_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    if (settings) setEngineSettings(settings);

    const { data: openMaster } = await supabase
      .from('bot_positions')
      .select('pair_symbol')
      .eq('is_master', true)
      .in('status', ['open', 'closing']);
    setLockedPairs(new Set((openMaster || []).map((p: any) => String(p.pair_symbol))));

    try {
      const res = await fetch('/api/admin/engine-config', { cache: 'no-store' });
      if (res.ok) {
        const payload = await res.json();
        setEngineConfig(payload);
      }
    } catch {
      setEngineConfig(null);
    }
  }

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

    // Load recent positions across all users (incl. master rows with null user_id)
    const { data: allPositions, error: positionsError } = await supabase
      .from('bot_positions')
      .select('*, users_profile:users_profile!user_id(email)')
      .order('opened_at', { ascending: false })
      .limit(100);

    if (positionsError) {
      console.error('Failed to load admin positions:', positionsError.message);
      setPositions([]);
    } else if (allPositions) {
      setPositions(allPositions.filter((p) => !isUnfilledSimulation(p)));
    }

    // Load system health logs
    const { data: health } = await supabase
      .from('system_health_logs')
      .select('*')
      .order('pinged_at', { ascending: false })
      .limit(10);

    if (health) setHealthLogs(health);

    // Load pairs, selection runs and engine settings
    await loadPairsData();

    // Load signal strategy & events
    const { data: strat } = await supabase
      .from('signal_strategies')
      .select('*')
      .eq('id', 'xrp_dip_buy_v1')
      .maybeSingle();
    if (strat) setSignalStrategy(strat);

    const { data: sEvs } = await supabase
      .from('signal_events')
      .select('*')
      .eq('strategy_id', 'xrp_dip_buy_v1')
      .order('created_at', { ascending: false })
      .limit(10);
    if (sEvs) setSignalEvents(sEvs);

    setLoading(false);
  }

  const handleToggleSignalStrategy = async () => {
    if (!signalStrategy) return;
    setIsUpdatingSignalStrategy(true);
    const nextVal = !signalStrategy.is_enabled;
    try {
      const { error } = await supabase
        .from('signal_strategies')
        .update({ is_enabled: nextVal })
        .eq('id', signalStrategy.id);

      if (error) {
        toast.error('Failed to toggle signal strategy: ' + error.message);
      } else {
        setSignalStrategy((prev: any) => ({ ...prev, is_enabled: nextVal }));
        toast.success(`Signal strategy globally ${nextVal ? 'enabled' : 'disabled'}.`);
      }
    } finally {
      setIsUpdatingSignalStrategy(false);
    }
  };

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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'strategy_pairs' }, () => {
        loadPairsData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pair_selection_runs' }, () => {
        loadPairsData();
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

  const handleToggleRotation = () => {
    setPairsAction('toggleRotation');
    setIsPairsConfirmOpen(true);
  };

  const handleRunSelection = () => {
    setPairsAction('runSelection');
    setIsPairsConfirmOpen(true);
  };

  const confirmPairsAction = async () => {
    if (!pairsAction) return;
    setIsPairsConfirmOpen(false);

    try {
      const { data: { user: adminUser } } = await supabase.auth.getUser();
      if (!adminUser) return;

      if (pairsAction === 'toggleRotation') {
        const nextEnabled = !engineSettings?.auto_rotation_enabled;
        await supabase
          .from('engine_settings')
          .update({
            auto_rotation_enabled: nextEnabled,
            updated_at: new Date().toISOString(),
          })
          .eq('id', 1);

        await supabase.from('audit_logs').insert({
          user_id: adminUser.id,
          action: 'auto_rotation_toggled',
          details: { enabled: nextEnabled },
        });

        toast.success(
          nextEnabled ? t('admin.rotationEnabledToast') : t('admin.rotationDisabledToast')
        );
      } else if (pairsAction === 'runSelection') {
        await supabase.from('pair_selection_runs').insert({
          status: 'pending',
          trigger_source: 'admin',
          requested_by: adminUser.id,
          progress_log: [
            {
              at: new Date().toISOString(),
              stage: 'queued',
              message: 'Admin queued a manual pair selection run. Waiting for the worker daemon to pick it up.',
              detail: { requested_by: adminUser.id },
            },
          ],
        });

        await supabase.from('audit_logs').insert({
          user_id: adminUser.id,
          action: 'pair_selection_triggered',
          details: {},
        });

        toast.success(t('admin.selectionTriggeredToast'));
        // Open the live trace drawer for the newest pending run after reload
        const { data: newest } = await supabase
          .from('pair_selection_runs')
          .select('id')
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (newest?.id) setTraceRunId(newest.id);
      }

      loadPairsData();
    } catch (err: any) {
      const errorText = err.message || 'Action failed';
      toast.error(errorText);
    }
  };

  const formatScore = (value: any) =>
    value === null || value === undefined ? '—' : Number(value).toFixed(3);

  const formatMetric = (value: any, digits = 2) =>
    value === null || value === undefined ? '—' : Number(value).toFixed(digits);

  const latestRun = pairRuns[0];
  const isRunInProgress =
    latestRun && (latestRun.status === 'pending' || latestRun.status === 'running');
  const lastRotationAt = engineSettings?.last_rotation_applied_at
    ? new Date(engineSettings.last_rotation_applied_at)
    : null;
  const nextRotationAt = lastRotationAt
    ? new Date(lastRotationAt.getTime() + 14 * 24 * 60 * 60 * 1000)
    : null;
  const isCooldownActive = nextRotationAt ? nextRotationAt.getTime() > Date.now() : false;
  const tracedRun =
    (traceRunId ? pairRuns.find((r) => r.id === traceRunId) : null) ||
    (isRunInProgress ? latestRun : null);

  const latestCandidates: CandidateRow[] = useMemo(() => {
    const completedWithCandidates = pairRuns.find(
      (r) => r.status === 'completed' && Array.isArray(r.candidates) && r.candidates.length > 0
    );
    return Array.isArray(completedWithCandidates?.candidates)
      ? (completedWithCandidates.candidates as CandidateRow[])
      : [];
  }, [pairRuns]);

  const candidateScoreBySymbol = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of latestCandidates) {
      if (c?.pair_symbol != null && c.score != null) map.set(c.pair_symbol, Number(c.score));
    }
    return map;
  }, [latestCandidates]);

  const displayBasket: BasketPairRow[] = useMemo(() => {
    return activePairs.map((p) => ({
      ...p,
      score:
        p.score !== null && p.score !== undefined
          ? Number(p.score)
          : candidateScoreBySymbol.get(p.pair_symbol) ?? null,
    }));
  }, [activePairs, candidateScoreBySymbol]);

  const openReplacePicker = (pair: BasketPairRow) => {
    setReplaceOutgoing(pair);
    setIsReplacePickerOpen(true);
  };

  const handleCandidatePicked = (incoming: CandidateRow) => {
    if (!replaceOutgoing) return;
    setIsReplacePickerOpen(false);
    setPendingReplacement({ outgoing: replaceOutgoing, incoming });
    setIsReplaceConfirmOpen(true);
  };

  const confirmManualReplace = async () => {
    if (!pendingReplacement || isReplacing) return;
    setIsReplacing(true);
    setIsReplaceConfirmOpen(false);

    const { outgoing, incoming } = pendingReplacement;
    const nowIso = new Date().toISOString();

    try {
      const { data: { user: adminUser } } = await supabase.auth.getUser();
      if (!adminUser) throw new Error('Not authenticated');

      // Coin uniqueness vs remaining active slots
      const reserved = new Set<string>();
      for (const p of activePairs) {
        if (p.id === outgoing.id) continue;
        reserved.add(String(p.long_coin).toUpperCase());
        reserved.add(String(p.short_coin).toUpperCase());
      }
      if (
        reserved.has(incoming.long_coin.toUpperCase()) ||
        reserved.has(incoming.short_coin.toUpperCase())
      ) {
        throw new Error('Replacement shares a coin with another active pair');
      }

      const { error: deactivateError } = await supabase
        .from('strategy_pairs')
        .update({ is_active: false, deactivated_at: nowIso })
        .eq('id', outgoing.id)
        .eq('is_active', true);

      if (deactivateError) throw deactivateError;

      const { error: insertError } = await supabase.from('strategy_pairs').insert({
        pair_symbol: incoming.pair_symbol,
        long_coin: incoming.long_coin,
        short_coin: incoming.short_coin,
        score: incoming.score,
        metrics: incoming.metrics ?? null,
        activated_at: nowIso,
        is_active: true,
        run_id: pairRuns.find((r) => Array.isArray(r.candidates))?.id ?? null,
      });

      if (insertError) {
        // Best-effort rollback
        await supabase
          .from('strategy_pairs')
          .update({ is_active: true, deactivated_at: null })
          .eq('id', outgoing.id);
        throw insertError;
      }

      await supabase.from('audit_logs').insert({
        user_id: adminUser.id,
        action: 'pair_manual_replace',
        details: {
          removed: outgoing.pair_symbol,
          added: incoming.pair_symbol,
          old_score: outgoing.score,
          new_score: incoming.score,
        },
      });

      // Keep dashboard/scanner in sync with the new basket pair.
      // NEVER delete pair_market_data for the outgoing pair while open positions
      // still exist — PositionGuard needs those prices for TP/SL/Trend-Flip.
      // Writes go through service-role API (table RLS is SELECT-only for browsers).
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const authHeaders: HeadersInit = {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      };

      const upsertRes = await fetch('/api/admin/pair-market-data', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          action: 'upsert',
          row: {
            pair_symbol: incoming.pair_symbol,
            long_coin: incoming.long_coin,
            short_coin: incoming.short_coin,
            current_ratio: 0,
            ema_10: 0,
            is_in_trend: false,
            long_price: 0,
            short_price: 0,
            updated_at: nowIso,
          },
        }),
      });
      if (!upsertRes.ok) {
        const payload = await upsertRes.json().catch(() => ({}));
        console.warn('[Admin] pair_market_data upsert failed:', payload?.error || upsertRes.status);
      }

      const { count: openOnOutgoing } = await supabase
        .from('bot_positions')
        .select('id', { count: 'exact', head: true })
        .eq('pair_symbol', outgoing.pair_symbol)
        .eq('status', 'open');

      if (!openOnOutgoing || openOnOutgoing === 0) {
        const deleteRes = await fetch('/api/admin/pair-market-data', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ action: 'delete', pair_symbol: outgoing.pair_symbol }),
        });
        if (!deleteRes.ok) {
          const payload = await deleteRes.json().catch(() => ({}));
          console.warn('[Admin] pair_market_data delete failed:', payload?.error || deleteRes.status);
        }
      }

      toast.success(
        t('admin.replaceSuccessToast', {
          old: outgoing.pair_symbol,
          next: incoming.pair_symbol,
        })
      );
      setPendingReplacement(null);
      setReplaceOutgoing(null);
      await loadPairsData();
    } catch (err: any) {
      toast.error(err.message || t('admin.replaceFailedToast'));
    } finally {
      setIsReplacing(false);
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
            onClick={() => setActiveTab('pairs')}
            className={`pb-3 px-4 border-b-2 transition-colors ${
              activeTab === 'pairs'
                ? 'border-honey-500 text-honey-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            {t('admin.pairsTab')}
          </button>
          <button
            onClick={() => setActiveTab('signals')}
            className={`pb-3 px-4 border-b-2 transition-colors ${
              activeTab === 'signals'
                ? 'border-honey-500 text-honey-400 font-bold'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            Signals
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
                      const pnl = getDisplayPnlUsd(p);
                      const traderLabel =
                        p.users_profile?.email?.split('@')[0] ||
                        (p.is_master ? 'MASTER' : null) ||
                        (typeof p.user_id === 'string' ? p.user_id.slice(0, 8) : '—');
                      return (
                        <tr key={p.id} className="hover:bg-dark-850/50 transition-colors">
                          <td className="px-5 py-4 text-slate-300">
                            <span className={p.is_master ? 'text-honey-400 font-bold' : undefined}>
                              {traderLabel}
                            </span>
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
                            {Number(p.entry_ratio || 0).toFixed(4)}
                          </td>
                          <td className="px-5 py-4 text-slate-300">
                            ${Number(p.allocated_margin_usd || 0).toFixed(2)}
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

        {/* TAB 4: PAIRS & ROTATION */}
        {activeTab === 'pairs' && (
          <div className="space-y-6">
            {/* Block A: Current Active Basket */}
            <div className="bg-dark-900 border border-dark-800 rounded-2xl shadow-xl overflow-hidden">
              <div className="p-5 border-b border-dark-800 flex justify-between items-center">
                <h2 className="text-base font-bold text-white">{t('admin.currentBasket')}</h2>
                <span className="text-xs font-mono text-slate-400">
                  {t('admin.activePairsCount', { count: activePairs.length })}
                </span>
              </div>

              {activePairs.length === 0 ? (
                <div className="p-12 text-center text-slate-500 font-mono text-sm">
                  {t('admin.noPairs')}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-dark-950/60 text-[11px] uppercase tracking-wider text-slate-400 font-mono border-b border-dark-800">
                      <tr>
                        <th className="px-5 py-3">{t('admin.colPair')}</th>
                        <th className="px-5 py-3">{t('admin.colLongShort')}</th>
                        <th className="px-5 py-3">{t('admin.colScore')}</th>
                        <th className="px-5 py-3">PF (IS/OOS)</th>
                        <th className="px-5 py-3">Trades IS</th>
                        <th className="px-5 py-3">MaxDD IS</th>
                        <th className="px-5 py-3">Hurst</th>
                        <th className="px-5 py-3">Live PF 30d</th>
                        <th className="px-5 py-3">Funding</th>
                        <th className="px-5 py-3">Equity</th>
                        <th className="px-5 py-3 text-right">{t('admin.colActivated')}</th>
                        <th className="px-5 py-3 text-right">{t('admin.basketActions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-dark-800 font-mono text-xs">
                      {displayBasket.map((pair) => (
                        <tr key={pair.id} className="hover:bg-dark-850/50 transition-colors">
                          <td className="px-5 py-4 font-bold text-white">{pair.pair_symbol}</td>
                          <td className="px-5 py-4">
                            <span className="text-emerald-400 font-bold">L:{pair.long_coin}</span>
                            <span className="text-slate-500 mx-1.5">/</span>
                            <span className="text-rose-400 font-bold">S:{pair.short_coin}</span>
                            {lockedPairs.has(pair.pair_symbol) && (
                              <span className="ml-2 px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/30 text-[10px] font-bold uppercase">
                                Locked
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-4 text-honey-400 font-bold">
                            {formatScore(pair.score)}
                          </td>
                          <td className="px-5 py-4 text-slate-300 text-[11px]">{formatMetric((pair.metrics as any)?.sim_insample?.profitFactor, 2)} / {formatMetric((pair.metrics as any)?.sim_oos?.profitFactor, 2)}</td>
                          <td className="px-5 py-4 text-slate-300 text-[11px]">{formatMetric((pair.metrics as any)?.sim_insample?.trades, 0)}</td>
                          <td className="px-5 py-4 text-slate-300 text-[11px]">{formatMetric((pair.metrics as any)?.sim_insample?.maxDrawdownPct, 2)}%</td>
                          <td className="px-5 py-4 text-slate-300 text-[11px]">{formatMetric((pair.metrics as any)?.hurst, 3)}</td>
                          <td className="px-5 py-4 text-slate-300 text-[11px]">{formatMetric((pair.metrics as any)?.live_pf_30d, 2)}</td>
                          <td className="px-5 py-4 text-slate-300 text-[11px]">{formatMetric((pair.metrics as any)?.funding_cost_pct_8h, 4)}%</td>
                          <td className="px-5 py-4 text-slate-300 text-[11px]">
                            {Array.isArray((pair.metrics as any)?.sim_insample?.equityCurve) && (pair.metrics as any).sim_insample.equityCurve.length > 1 ? (
                              <LineChart width={110} height={32} data={(pair.metrics as any).sim_insample.equityCurve.map((y: number, idx: number) => ({ x: idx, y }))}>
                                <Line type="monotone" dataKey="y" stroke="#F59E0B" dot={false} strokeWidth={1.5} />
                              </LineChart>
                            ) : '—'}
                          </td>
                          <td className="px-5 py-4 text-right text-slate-400 text-[11px]">
                            {formatDateTime(pair.activated_at)}
                          </td>
                          <td className="px-5 py-4 text-right">
                            <button
                              type="button"
                              onClick={() => openReplacePicker(pair)}
                              disabled={latestCandidates.length === 0 || isReplacing}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase bg-dark-800 border border-dark-700 text-honey-400 hover:bg-honey-500/15 hover:border-honey-500/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                              title={
                                latestCandidates.length === 0
                                  ? t('admin.replaceNeedRun')
                                  : t('admin.replacePairTitle')
                              }
                            >
                              <ArrowRightLeft className="w-3 h-3" />
                              {t('admin.replace')}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Blocks B + C: Auto-Rotation Toggle & Manual Run */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-sm font-bold text-white">
                    <Repeat className="w-4 h-4 text-honey-400" />
                    {t('admin.autoRotation')}
                    {isCooldownActive && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/40 text-[10px] uppercase">
                        Cooldown
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5">{t('admin.autoRotationDesc')}</p>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Last: {lastRotationAt ? formatDateTime(lastRotationAt.toISOString()) : '—'} | Next:{' '}
                    {nextRotationAt ? formatDateTime(nextRotationAt.toISOString()) : '—'}
                  </p>
                </div>
                <button
                  onClick={handleToggleRotation}
                  className={`px-4 py-2 rounded-xl text-xs font-mono font-bold uppercase border transition-all ${
                    engineSettings?.auto_rotation_enabled
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25'
                      : 'bg-rose-500/15 text-rose-400 border-rose-500/30 hover:bg-rose-500/25'
                  }`}
                >
                  {engineSettings?.auto_rotation_enabled
                    ? t('admin.rotationOn')
                    : t('admin.rotationOff')}
                </button>
              </div>

              <div className="bg-dark-900 border border-dark-800 p-5 rounded-2xl shadow-xl flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-sm font-bold text-white">
                    <Play className="w-4 h-4 text-honey-400" />
                    {t('admin.runSelection')}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5">{t('admin.runSelectionHint')}</p>
                </div>
                {isRunInProgress ? (
                  <button
                    type="button"
                    onClick={() => setTraceRunId(latestRun.id)}
                    className="px-4 py-2 rounded-xl text-xs font-mono font-bold uppercase bg-amber-500/20 text-amber-400 border border-amber-500/40 animate-pulse hover:bg-amber-500/30 transition-colors"
                    title={t('admin.traceOpenHint')}
                  >
                    {t('admin.runInProgress')}
                  </button>
                ) : (
                  <button
                    onClick={handleRunSelection}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-honey-500 hover:bg-honey-400 text-dark-950 shadow-lg shadow-honey-500/20 transition-all"
                  >
                    {t('admin.runNow')}
                  </button>
                )}
              </div>
            </div>

            <div className="bg-dark-900 border border-dark-800 p-4 rounded-2xl shadow-xl">
              <div className="text-sm font-bold text-white">Engine Mode</div>
              <div className="text-xs text-slate-400 mt-1.5 font-mono">
                {engineConfig
                  ? `Lev ${engineConfig.defaultLeverage}x (cap ${engineConfig.maxLeverage}x) • TP disabled: ${engineConfig.tpDisabled ? 'yes' : 'no'} • ATR SL x${engineConfig.slAtrMult} • 4h close only: ${engineConfig.entryOn4hCloseOnly ? 'yes' : 'no'}`
                  : 'Unavailable'}
              </div>
            </div>

            {/* Block D: Run History */}
            <div className="bg-dark-900 border border-dark-800 rounded-2xl shadow-xl overflow-hidden">
              <div className="p-5 border-b border-dark-800 flex justify-between items-center">
                <h2 className="text-base font-bold text-white">{t('admin.runHistory')}</h2>
                <span className="text-xs font-mono text-slate-400">
                  {t('admin.lastRuns', { count: pairRuns.length })}
                </span>
              </div>

              {pairRuns.length === 0 ? (
                <div className="p-12 text-center text-slate-500 font-mono text-sm">
                  {t('admin.noRuns')}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-dark-950/60 text-[11px] uppercase tracking-wider text-slate-400 font-mono border-b border-dark-800">
                      <tr>
                        <th className="px-5 py-3 w-8" />
                        <th className="px-5 py-3">{t('admin.colCreated')}</th>
                        <th className="px-5 py-3">{t('admin.colTrigger')}</th>
                        <th className="px-5 py-3">{t('common.status')}</th>
                        <th className="px-5 py-3">{t('admin.colUniverse')}</th>
                        <th className="px-5 py-3">{t('admin.colApplied')}</th>
                        <th className="px-5 py-3">{t('admin.colReplacements')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-dark-800 font-mono text-xs">
                      {pairRuns.map((run) => {
                        const isExpanded = expandedRunId === run.id;
                        const candidates = Array.isArray(run.candidates)
                          ? run.candidates.slice(0, 15)
                          : [];
                        const replacements = Array.isArray(run.replacements)
                          ? run.replacements
                          : [];

                        return (
                          <React.Fragment key={run.id}>
                            <tr className="hover:bg-dark-850/50 transition-colors">
                              <td className="px-5 py-4">
                                <button
                                  onClick={() =>
                                    setExpandedRunId(isExpanded ? null : run.id)
                                  }
                                  className="p-1 rounded bg-dark-800 hover:bg-dark-700 text-slate-400 hover:text-white transition-colors"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </td>
                              <td className="px-5 py-4 text-slate-400 text-[11px]">
                                {formatDateTime(run.created_at)}
                              </td>
                              <td className="px-5 py-4">
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                                    run.trigger_source === 'admin'
                                      ? 'bg-honey-500/15 text-honey-400 border border-honey-500/30'
                                      : 'bg-dark-800 text-slate-400'
                                  }`}
                                >
                                  {run.trigger_source}
                                </span>
                              </td>
                              <td className="px-5 py-4">
                                <button
                                  type="button"
                                  onClick={() => setTraceRunId(run.id)}
                                  className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border transition-colors hover:brightness-125 ${
                                    run.status === 'completed'
                                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                      : run.status === 'failed'
                                      ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                                      : 'bg-amber-500/20 text-amber-400 border-amber-500/40 animate-pulse'
                                  }`}
                                  title={t('admin.traceOpenHint')}
                                >
                                  {run.status}
                                </button>
                              </td>
                              <td className="px-5 py-4 text-slate-300">
                                {run.universe_size ?? '—'}
                              </td>
                              <td className="px-5 py-4">
                                <span
                                  className={`font-bold ${
                                    run.applied ? 'text-emerald-400' : 'text-slate-500'
                                  }`}
                                >
                                  {run.applied ? t('admin.appliedYes') : t('admin.appliedNo')}
                                </span>
                              </td>
                              <td className="px-5 py-4 text-[11px]">
                                {run.status === 'failed' && run.error ? (
                                  <span className="text-rose-400 block max-w-xs truncate" title={run.error}>
                                    {run.error}
                                  </span>
                                ) : replacements.length > 0 ? (
                                  <span className="text-slate-300">
                                    {replacements
                                      .map((r: any) => `${r.removed} → ${r.added}`)
                                      .join(', ')}
                                  </span>
                                ) : (
                                  <span className="text-slate-600">—</span>
                                )}
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-dark-950/40">
                                <td colSpan={7} className="px-5 py-4">
                                  {candidates.length === 0 ? (
                                    <div className="text-slate-500 text-[11px]">
                                      {t('admin.noCandidates')}
                                    </div>
                                  ) : (
                                    <div>
                                      <div className="flex items-center justify-between mb-2">
                                        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
                                          {t('admin.topCandidates', { count: candidates.length })}
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => setValidOnlyCandidates((v) => !v)}
                                          className={`px-2 py-1 rounded text-[10px] font-bold border ${validOnlyCandidates ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-dark-800 text-slate-400 border-dark-700'}`}
                                        >
                                          Valid only
                                        </button>
                                      </div>
                                      <table className="w-full text-left font-mono text-[11px]">
                                        <thead className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-dark-800">
                                          <tr>
                                            <th className="px-3 py-2">{t('admin.candColPair')}</th>
                                            <th className="px-3 py-2 text-right">{t('admin.candColScore')}</th>
                                            <th className="px-3 py-2 text-right">PF IS</th>
                                            <th className="px-3 py-2 text-right">PF OOS</th>
                                            <th className="px-3 py-2 text-right">Trades</th>
                                            <th className="px-3 py-2 text-right">DD</th>
                                            <th className="px-3 py-2 text-right">Hurst</th>
                                            <th className="px-3 py-2">Reject reasons</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-dark-800/60">
                                          {candidates.filter((c: any) => (validOnlyCandidates ? !!c.valid : true)).map((c: any, idx: number) => (
                                            <tr key={`${run.id}-${c.pair_symbol || idx}`}>
                                              <td className="px-3 py-1.5 text-white font-bold">
                                                {c.pair_symbol || `${c.long_coin}/${c.short_coin}`}
                                              </td>
                                              <td className="px-3 py-1.5 text-right text-honey-400 font-bold">
                                                {formatScore(c.score)}
                                              </td>
                                              <td className="px-3 py-1.5 text-right text-slate-300">
                                                {formatMetric(c.metrics?.sim_insample?.profitFactor)}
                                              </td>
                                              <td className="px-3 py-1.5 text-right text-slate-300">
                                                {formatMetric(c.metrics?.sim_oos?.profitFactor)}
                                              </td>
                                              <td className="px-3 py-1.5 text-right text-slate-300">
                                                {formatMetric(c.metrics?.sim_insample?.trades, 0)}
                                              </td>
                                              <td className="px-3 py-1.5 text-right text-slate-300">
                                                {formatMetric(c.metrics?.sim_insample?.maxDrawdownPct, 2)}%
                                              </td>
                                              <td className="px-3 py-1.5 text-right text-slate-300">
                                                {formatMetric(c.metrics?.hurst, 3)}
                                              </td>
                                              <td className="px-3 py-1.5 text-slate-300">
                                                {Array.isArray(c.reject_reasons) && c.reject_reasons.length > 0 ? c.reject_reasons.join(', ') : '—'}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 5: SIGNALS STRATEGY ADMIN */}
        {activeTab === 'signals' && (
          <div className="space-y-6">
            <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-white">
                    {signalStrategy?.name || 'XRP Dip-Buy 24h'}
                  </h3>
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-honey-500/15 text-honey-400 border border-honey-500/30">
                    ID: {signalStrategy?.id || 'xrp_dip_buy_v1'}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Global master switch. When disabled, scanner pauses and no trades will be opened for any users.
                </p>
              </div>

              <button
                onClick={handleToggleSignalStrategy}
                disabled={isUpdatingSignalStrategy}
                className={`px-4 py-2 rounded-xl text-xs font-mono font-bold flex items-center gap-2 transition-all ${
                  signalStrategy?.is_enabled
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-dark-950 shadow-md shadow-emerald-500/20'
                    : 'bg-dark-800 hover:bg-dark-700 text-slate-300 border border-dark-700'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    signalStrategy?.is_enabled ? 'bg-dark-950' : 'bg-rose-400'
                  }`}
                />
                {signalStrategy?.is_enabled ? 'GLOBAL: ENABLED' : 'GLOBAL: DISABLED'}
              </button>
            </div>

            {/* Recent Signal Events Table */}
            <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-xl space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Last 10 Signal Fired Events
              </h4>

              {signalEvents.length === 0 ? (
                <div className="text-center py-6 text-xs font-mono text-slate-500">
                  No signal events registered yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-xs">
                    <thead className="text-[11px] uppercase tracking-wider text-slate-500 border-b border-dark-800">
                      <tr>
                        <th className="py-2 px-3">Time</th>
                        <th className="py-2 px-3">Symbol</th>
                        <th className="py-2 px-3">Drop %</th>
                        <th className="py-2 px-3">Bar Close</th>
                        <th className="py-2 px-3">Ref Entry</th>
                        <th className="py-2 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-dark-800/60">
                      {signalEvents.map((ev) => (
                        <tr key={ev.id} className="hover:bg-dark-950/40">
                          <td className="py-2.5 px-3 text-slate-400">
                            {formatDateTime(ev.signal_bar_ts || ev.created_at)}
                          </td>
                          <td className="py-2.5 px-3 font-bold text-white">
                            {ev.symbol}/USDT
                          </td>
                          <td className="py-2.5 px-3 text-rose-400 font-bold">
                            -{Number(ev.drop_pct || 0).toFixed(2)}%
                          </td>
                          <td className="py-2.5 px-3 text-slate-300">
                            ${Number(ev.signal_close || 0).toFixed(4)}
                          </td>
                          <td className="py-2.5 px-3 text-slate-300">
                            ${Number(ev.reference_entry_price || 0).toFixed(4)}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              {ev.status || 'fired'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 6: SYSTEM HEALTH PINGS */}
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

      {/* Confirmation Modal for Pairs & Rotation */}
      <ConfirmModal
        isOpen={isPairsConfirmOpen}
        title={
          pairsAction === 'toggleRotation'
            ? t('admin.toggleRotationTitle')
            : t('admin.runSelectionTitle')
        }
        description={
          pairsAction === 'toggleRotation'
            ? engineSettings?.auto_rotation_enabled
              ? t('admin.disableRotationDesc')
              : t('admin.enableRotationDesc')
            : t('admin.runSelectionDesc')
        }
        confirmText={
          pairsAction === 'toggleRotation'
            ? engineSettings?.auto_rotation_enabled
              ? t('admin.disableRotation')
              : t('admin.enableRotation')
            : t('admin.runSelectionConfirm')
        }
        isDestructive={pairsAction === 'toggleRotation' && !!engineSettings?.auto_rotation_enabled}
        onConfirm={confirmPairsAction}
        onCancel={() => setIsPairsConfirmOpen(false)}
      />

      <PairSelectionTraceDrawer
        isOpen={!!traceRunId}
        run={tracedRun}
        onClose={() => setTraceRunId(null)}
      />

      <ReplacePairModal
        isOpen={isReplacePickerOpen}
        outgoing={replaceOutgoing}
        activePairs={displayBasket}
        candidates={latestCandidates}
        onClose={() => {
          setIsReplacePickerOpen(false);
          setReplaceOutgoing(null);
        }}
        onSelect={handleCandidatePicked}
      />

      <ConfirmModal
        isOpen={isReplaceConfirmOpen}
        title={t('admin.replaceConfirmTitle')}
        description={
          pendingReplacement
            ? t('admin.replaceConfirmDesc', {
                old: pendingReplacement.outgoing.pair_symbol,
                next: pendingReplacement.incoming.pair_symbol,
                oldScore:
                  pendingReplacement.outgoing.score === null ||
                  pendingReplacement.outgoing.score === undefined
                    ? '—'
                    : Number(pendingReplacement.outgoing.score).toFixed(3),
                nextScore: Number(pendingReplacement.incoming.score).toFixed(3),
              })
            : ''
        }
        confirmText={t('admin.replaceConfirmButton')}
        isDestructive
        onConfirm={confirmManualReplace}
        onCancel={() => {
          setIsReplaceConfirmOpen(false);
          setPendingReplacement(null);
        }}
      />
    </div>
  );
}
