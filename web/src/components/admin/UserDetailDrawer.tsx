'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  User2,
  CreditCard,
  Layers,
  Radio,
  KeyRound,
  ScrollText,
  Loader2,
  Mail,
  ShieldCheck,
  Wallet,
  ExternalLink,
  AlertTriangle,
  Activity,
  Ban,
  CheckCircle2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import {
  getNetPnlUsd,
  getUnrealizedPnlUsd,
  isUnfilledSimulation,
} from '@/lib/positions';
import { signalPriceDecimals } from '@/lib/signals';

type TabKey = 'profile' | 'payments' | 'trades' | 'signals' | 'exchanges' | 'activity';

interface UserDetailDrawerProps {
  isOpen: boolean;
  user: Record<string, any> | null;
  onClose: () => void;
}

const usd = (value: unknown, digits = 2): string =>
  `$${Number(value ?? 0).toFixed(digits)}`;

const pnlClass = (value: number): string =>
  value >= 0 ? 'text-emerald-400' : 'text-rose-400';

const formatPnl = (value: number): string =>
  value >= 0 ? `+$${value.toFixed(2)}` : `-$${Math.abs(value).toFixed(2)}`;

function shortId(id: string | null | undefined): string {
  if (!id) return '—';
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

const statusTone = (status: string | null | undefined): string => {
  switch (status) {
    case 'paid':
    case 'active':
    case 'closed':
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case 'open':
    case 'trial':
      return 'bg-honey-500/15 text-honey-400 border-honey-500/30';
    case 'pending_review':
      return 'bg-amber-500/20 text-amber-400 border-amber-500/40';
    case 'frozen':
    case 'expired':
    case 'error':
    case 'cancelled':
      return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
    default:
      return 'bg-dark-800 text-slate-300 border-dark-700';
  }
};

function Badge({ value, tone }: { value: string; tone?: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${
        tone ?? statusTone(value)
      }`}
    >
      {value}
    </span>
  );
}

function Field({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 font-mono">
        {label}
      </div>
      <div className={`text-xs text-slate-200 mt-0.5 break-words ${mono ? 'font-mono' : ''}`}>
        {value ?? '—'}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = 'text-white',
  icon,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-dark-900 border border-dark-800 rounded-xl px-3 py-2.5">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500 font-mono">
        <span className="truncate">{label}</span>
        {icon}
      </div>
      <div className={`text-base font-black mt-1 font-mono ${tone}`}>{value}</div>
    </div>
  );
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-xs font-mono text-slate-500">
        {text}
      </td>
    </tr>
  );
}

export function UserDetailDrawer({ isOpen, user, onClose }: UserDetailDrawerProps) {
  const { t, formatDate, formatDateTime } = useLanguage();
  const [tab, setTab] = useState<TabKey>('profile');
  const [loading, setLoading] = useState(false);

  const [profile, setProfile] = useState<Record<string, any> | null>(null);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [tradingSettings, setTradingSettings] = useState<Record<string, any> | null>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);
  const [signalPositions, setSignalPositions] = useState<any[]>([]);
  const [signalSettings, setSignalSettings] = useState<any[]>([]);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  const userId = user?.id as string | undefined;

  useEffect(() => {
    if (!isOpen || !userId) return;
    let cancelled = false;
    setLoading(true);
    setTab('profile');

    (async () => {
      const [
        profRes,
        accRes,
        tsRes,
        invRes,
        posRes,
        sigPosRes,
        sigSetRes,
        stratRes,
        auditRes,
      ] = await Promise.all([
        supabase.from('users_profile').select('*').eq('id', userId).maybeSingle(),
        supabase
          .from('exchange_accounts')
          .select(
            'id, user_id, exchange, account_name, is_active, is_validated, can_withdraw, can_trade_futures, last_balance_usd, last_error_msg, last_sync_at, created_at, updated_at'
          )
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
        supabase.from('trading_settings').select('*').eq('user_id', userId).maybeSingle(),
        supabase
          .from('invoices')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
        supabase
          .from('bot_positions')
          .select('*')
          .eq('user_id', userId)
          .order('opened_at', { ascending: false })
          .limit(200),
        supabase
          .from('signal_positions')
          .select('*')
          .eq('user_id', userId)
          .order('opened_at', { ascending: false })
          .limit(200),
        supabase.from('user_signal_settings').select('*').eq('user_id', userId),
        supabase.from('signal_strategies').select('id, name, symbol'),
        supabase
          .from('audit_logs')
          .select('*')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(100),
      ]);

      if (cancelled) return;

      setProfile((profRes.data as Record<string, any>) ?? user);
      setAccounts(accRes.data ?? []);
      setTradingSettings((tsRes.data as Record<string, any>) ?? null);
      setInvoices(invRes.data ?? []);
      setPositions((posRes.data ?? []).filter((p: any) => !isUnfilledSimulation(p)));
      setSignalPositions(sigPosRes.data ?? []);
      setSignalSettings(sigSetRes.data ?? []);
      setStrategies(stratRes.data ?? []);
      setAuditLogs(auditRes.data ?? []);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, userId, user]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const strategyName = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of strategies) map.set(String(s.id), String(s.name || s.symbol || s.id));
    return map;
  }, [strategies]);

  const stats = useMemo(() => {
    const paidInvoices = invoices.filter((i) => i.status === 'paid');
    const lifetimePaid = paidInvoices.reduce(
      (sum, i) => sum + Number(i.total_amount_usd || 0),
      0
    );
    const openTrades = positions.filter((p) => p.status === 'open');
    const closedTrades = positions.filter((p) => p.status === 'closed');
    const unrealized = openTrades.reduce((sum, p) => sum + getUnrealizedPnlUsd(p), 0);
    const realized = closedTrades.reduce((sum, p) => sum + getNetPnlUsd(p), 0);
    const signalRealized = signalPositions
      .filter((p) => p.status === 'closed')
      .reduce((sum, p) => sum + Number(p.realized_pnl_usd || 0), 0);
    const signalUnrealized = signalPositions
      .filter((p) => p.status === 'open')
      .reduce((sum, p) => sum + Number(p.unrealized_pnl_usd || 0), 0);
    const balance = accounts.reduce((sum, a) => sum + Number(a.last_balance_usd || 0), 0);

    return {
      lifetimePaid,
      invoicesCount: invoices.length,
      openTrades: openTrades.length,
      closedTrades: closedTrades.length,
      unrealized,
      realized,
      signalRealized,
      signalUnrealized,
      signalClosed: signalPositions.filter((p) => p.status === 'closed').length,
      balance,
    };
  }, [invoices, positions, signalPositions, accounts]);

  const accountName = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of accounts) {
      map.set(String(a.id), `${String(a.exchange).toUpperCase()} · ${a.account_name || ''}`);
    }
    return map;
  }, [accounts]);

  if (!isOpen || !user) return null;

  const displayName = profile?.full_name || user.full_name || t('common.trader');
  const displayEmail = profile?.email || user.email || '—';
  const initials = String(displayName)
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0]?.toUpperCase())
    .join('') || '?';

  const paymentNetwork = (network: string | null | undefined): string => {
    if (network === 'TRC20') return 'TRC20';
    if (network === 'BEP20') return 'BEP20';
    return network || '—';
  };

  const explorerUrl = (inv: any): string =>
    inv.payment_network === 'TRC20'
      ? `https://tronscan.org/#/transaction/${inv.tx_hash}`
      : `https://bscscan.com/tx/${inv.tx_hash}`;

  const TABS: { key: TabKey; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: 'profile', label: t('admin.userDetail.tabProfile'), icon: <User2 className="w-3.5 h-3.5" /> },
    { key: 'payments', label: t('admin.userDetail.tabPayments'), icon: <CreditCard className="w-3.5 h-3.5" />, count: invoices.length },
    { key: 'trades', label: t('admin.userDetail.tabTrades'), icon: <Layers className="w-3.5 h-3.5" />, count: positions.length },
    { key: 'signals', label: t('admin.userDetail.tabSignals'), icon: <Radio className="w-3.5 h-3.5" />, count: signalPositions.length },
    { key: 'exchanges', label: t('admin.userDetail.tabExchanges'), icon: <KeyRound className="w-3.5 h-3.5" />, count: accounts.length },
    { key: 'activity', label: t('admin.userDetail.tabActivity'), icon: <ScrollText className="w-3.5 h-3.5" />, count: auditLogs.length },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label={t('common.cancel')}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <aside className="relative h-full w-full max-w-4xl bg-dark-950 border-l border-dark-800 shadow-2xl flex flex-col animate-fadeIn">
        {/* Header */}
        <header className="px-5 py-4 border-b border-dark-800 shrink-0">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-honey-500/15 border border-honey-500/30 flex items-center justify-center text-honey-400 font-black text-lg font-mono shrink-0">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-bold text-white truncate">{displayName}</h2>
                <Badge value={profile?.role || 'user'} />
                <Badge value={profile?.subscription_status || 'trial'} />
                {profile?.is_frozen && (
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase font-bold text-rose-400">
                    <Ban className="w-3 h-3" />
                    {t('admin.userDetail.frozen')}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-400 font-mono flex-wrap">
                <span className="inline-flex items-center gap-1">
                  <Mail className="w-3 h-3" />
                  {displayEmail}
                </span>
                <span className="text-slate-600">•</span>
                <span className="truncate" title={userId}>
                  {t('admin.userDetail.userId')}: {shortId(userId)}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-dark-900 hover:bg-dark-800 text-slate-400 hover:text-white transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Tabs */}
        <nav className="px-5 border-b border-dark-800 flex gap-1 overflow-x-auto shrink-0">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`inline-flex items-center gap-1.5 px-3 py-3 text-[11px] font-mono font-bold uppercase border-b-2 whitespace-nowrap transition-colors ${
                tab === item.key
                  ? 'border-honey-500 text-honey-400'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              {item.icon}
              {item.label}
              {item.count !== undefined && item.count > 0 && (
                <span className="px-1.5 rounded bg-dark-800 text-slate-300 text-[10px]">
                  {item.count}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {loading ? (
            <div className="h-full flex items-center justify-center gap-2 text-slate-400 text-xs font-mono">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('admin.userDetail.loading')}
            </div>
          ) : (
            <>
              {/* PROFILE */}
              {tab === 'profile' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <StatCard
                      label={t('admin.userDetail.statLifetimePaid')}
                      value={usd(stats.lifetimePaid)}
                      tone="text-honey-400"
                      icon={<Wallet className="w-3.5 h-3.5 text-honey-400" />}
                    />
                    <StatCard
                      label={t('admin.userDetail.statOpenTrades')}
                      value={stats.openTrades}
                      icon={<Activity className="w-3.5 h-3.5 text-emerald-400" />}
                    />
                    <StatCard
                      label={t('admin.userDetail.statRealizedPnl')}
                      value={formatPnl(stats.realized)}
                      tone={pnlClass(stats.realized)}
                    />
                    <StatCard
                      label={t('admin.userDetail.statSignalPnl')}
                      value={formatPnl(stats.signalRealized)}
                      tone={pnlClass(stats.signalRealized)}
                    />
                  </div>

                  <section className="bg-dark-900 border border-dark-800 rounded-2xl p-4">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3">
                      {t('admin.userDetail.sectionIdentity')}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      <Field label={t('admin.userDetail.fullName')} value={displayName} />
                      <Field label={t('admin.userDetail.email')} value={displayEmail} />
                      <Field label={t('admin.userDetail.role')} value={<Badge value={profile?.role || 'user'} />} />
                      <Field label={t('admin.userDetail.userId')} value={userId} />
                      <Field label={t('admin.userDetail.joinedAt')} value={formatDateTime(profile?.created_at)} />
                      <Field label={t('admin.userDetail.updatedAt')} value={formatDateTime(profile?.updated_at)} />
                    </div>
                  </section>

                  <section className="bg-dark-900 border border-dark-800 rounded-2xl p-4">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3">
                      {t('admin.userDetail.sectionSubscription')}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      <Field
                        label={t('admin.userDetail.subStatus')}
                        value={<Badge value={profile?.subscription_status || 'trial'} />}
                      />
                      <Field
                        label={t('admin.userDetail.isFrozen')}
                        value={
                          profile?.is_frozen
                            ? t('admin.userDetail.yes')
                            : t('admin.userDetail.no')
                        }
                      />
                      <Field
                        label={t('admin.userDetail.hwm')}
                        value={usd(profile?.high_water_mark_equity)}
                      />
                      <Field label={t('admin.userDetail.trialStart')} value={formatDateTime(profile?.trial_start_at)} />
                      <Field label={t('admin.userDetail.trialEnd')} value={formatDateTime(profile?.trial_end_at)} />
                      <Field
                        label={t('admin.userDetail.paidUntil')}
                        value={
                          profile?.subscription_paid_until
                            ? formatDateTime(profile.subscription_paid_until)
                            : '—'
                        }
                      />
                    </div>
                  </section>

                  <section className="bg-dark-900 border border-dark-800 rounded-2xl p-4">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3">
                      {t('admin.userDetail.sectionTelegram')}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <Field
                        label={t('admin.userDetail.telegramEnabled')}
                        value={
                          profile?.telegram_enabled
                            ? t('admin.userDetail.yes')
                            : t('admin.userDetail.no')
                        }
                      />
                      <Field
                        label={t('admin.userDetail.telegramChatId')}
                        value={profile?.telegram_chat_id || '—'}
                      />
                      <Field
                        label={t('admin.userDetail.telegramToken')}
                        value={
                          profile?.telegram_bot_token_enc
                            ? t('admin.userDetail.telegramConfigured')
                            : t('admin.userDetail.telegramNotConfigured')
                        }
                      />
                    </div>
                  </section>
                </div>
              )}

              {/* PAYMENTS */}
              {tab === 'payments' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <StatCard
                      label={t('admin.userDetail.statLifetimePaid')}
                      value={usd(stats.lifetimePaid)}
                      tone="text-emerald-400"
                    />
                    <StatCard
                      label={t('admin.userDetail.statInvoices')}
                      value={stats.invoicesCount}
                    />
                    <StatCard
                      label={t('admin.userDetail.statPaidInvoices')}
                      value={invoices.filter((i) => i.status === 'paid').length}
                    />
                  </div>

                  <div className="overflow-x-auto rounded-2xl border border-dark-800">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-dark-950/60 text-[10px] uppercase tracking-wider text-slate-400 font-mono border-b border-dark-800">
                        <tr>
                          <th className="px-4 py-3">{t('admin.userDetail.colInvoice')}</th>
                          <th className="px-4 py-3">{t('admin.userDetail.colPeriod')}</th>
                          <th className="px-4 py-3">{t('admin.userDetail.colAmount')}</th>
                          <th className="px-4 py-3">{t('admin.userDetail.colStatus')}</th>
                          <th className="px-4 py-3">{t('admin.userDetail.colTxid')}</th>
                          <th className="px-4 py-3 text-right">{t('admin.userDetail.colPaidAt')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-dark-800 font-mono text-xs">
                        {invoices.length === 0 ? (
                          <EmptyRow colSpan={6} text={t('admin.userDetail.paymentsEmpty')} />
                        ) : (
                          invoices.map((inv) => (
                            <tr key={inv.id} className="hover:bg-dark-850/50 transition-colors align-top">
                              <td className="px-4 py-3">
                                <div className="font-bold text-white">{inv.invoice_number}</div>
                                <div className="text-slate-500 text-[10px]">
                                  {t('admin.userDetail.colDue')}: {formatDate(inv.due_date)}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-slate-400 text-[11px]">
                                {formatDate(inv.period_start)} – {formatDate(inv.period_end)}
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-bold text-honey-400">
                                  {usd(inv.total_amount_usd)}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  {t('admin.userDetail.colBase')}: {usd(inv.base_fee_usd)}
                                  {Number(inv.profit_fee_usd) > 0 && (
                                    <> • {t('admin.userDetail.colProfit')}: {usd(inv.profit_fee_usd)}</>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                <Badge value={inv.status} />
                                {inv.user_notes && (
                                  <div className="text-[10px] text-slate-500 mt-1 max-w-[180px] truncate" title={inv.user_notes}>
                                    {inv.user_notes}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {inv.tx_hash ? (
                                  <a
                                    href={explorerUrl(inv)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-honey-400 hover:underline text-[11px] inline-flex items-center gap-1"
                                  >
                                    {paymentNetwork(inv.payment_network)}:{' '}
                                    {String(inv.tx_hash).slice(0, 10)}…
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                ) : (
                                  <span className="text-slate-600 text-[11px]">{t('admin.noHash')}</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right text-slate-400 text-[11px]">
                                {inv.paid_at ? formatDateTime(inv.paid_at) : '—'}
                                {inv.approved_by_admin_id && (
                                  <div className="text-[10px] text-slate-600 mt-0.5">
                                    {t('admin.userDetail.colApprovedBy')}: {shortId(inv.approved_by_admin_id)}
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TRADES (basket) */}
              {tab === 'trades' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <StatCard label={t('admin.userDetail.statOpenTrades')} value={stats.openTrades} />
                    <StatCard label={t('admin.userDetail.statClosedTrades')} value={stats.closedTrades} />
                    <StatCard
                      label={t('admin.userDetail.statUnrealizedPnl')}
                      value={formatPnl(stats.unrealized)}
                      tone={pnlClass(stats.unrealized)}
                    />
                    <StatCard
                      label={t('admin.userDetail.statRealizedPnl')}
                      value={formatPnl(stats.realized)}
                      tone={pnlClass(stats.realized)}
                    />
                  </div>

                  <div className="overflow-x-auto rounded-2xl border border-dark-800">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-dark-950/60 text-[10px] uppercase tracking-wider text-slate-400 font-mono border-b border-dark-800">
                        <tr>
                          <th className="px-4 py-3">{t('admin.userDetail.colPair')}</th>
                          <th className="px-4 py-3">{t('admin.userDetail.colStatus')}</th>
                          <th className="px-4 py-3">{t('admin.userDetail.colRatio')}</th>
                          <th className="px-4 py-3">{t('admin.userDetail.colMargin')}</th>
                          <th className="px-4 py-3 text-right">{t('admin.userDetail.colPnl')}</th>
                          <th className="px-4 py-3">{t('admin.userDetail.colExitReason')}</th>
                          <th className="px-4 py-3 text-right">{t('admin.userDetail.colOpened')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-dark-800 font-mono text-xs">
                        {positions.length === 0 ? (
                          <EmptyRow colSpan={7} text={t('admin.userDetail.tradesEmpty')} />
                        ) : (
                          positions.map((p) => {
                            const pnl =
                              p.status === 'open'
                                ? getUnrealizedPnlUsd(p)
                                : getNetPnlUsd(p);
                            return (
                              <tr key={p.id} className="hover:bg-dark-850/50 transition-colors">
                                <td className="px-4 py-3 font-bold text-white">
                                  {p.pair_symbol}
                                  <div className="text-[10px] text-slate-500 font-normal">
                                    L:{p.long_symbol} / S:{p.short_symbol}
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  <Badge value={p.status} />
                                </td>
                                <td className="px-4 py-3 text-slate-400">
                                  {Number(p.entry_ratio || 0).toFixed(4)}
                                </td>
                                <td className="px-4 py-3 text-slate-300">
                                  {usd(p.allocated_margin_usd)}
                                </td>
                                <td className={`px-4 py-3 text-right font-bold ${pnlClass(pnl)}`}>
                                  {formatPnl(pnl)}
                                </td>
                                <td className="px-4 py-3 text-slate-400 text-[11px]">
                                  {p.exit_reason || '—'}
                                </td>
                                <td className="px-4 py-3 text-right text-slate-400 text-[11px]">
                                  {formatDateTime(p.opened_at)}
                                  {p.closed_at && (
                                    <div className="text-slate-600">
                                      {t('admin.userDetail.colClosed')}: {formatDateTime(p.closed_at)}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* SIGNALS */}
              {tab === 'signals' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <StatCard
                      label={t('admin.userDetail.statSignalTrades')}
                      value={signalPositions.length}
                    />
                    <StatCard
                      label={t('admin.userDetail.statSignalRealized')}
                      value={formatPnl(stats.signalRealized)}
                      tone={pnlClass(stats.signalRealized)}
                    />
                    <StatCard
                      label={t('admin.userDetail.statSignalUnrealized')}
                      value={formatPnl(stats.signalUnrealized)}
                      tone={pnlClass(stats.signalUnrealized)}
                    />
                    <StatCard
                      label={t('admin.userDetail.statSignalClosed')}
                      value={stats.signalClosed}
                    />
                  </div>

                  <section>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3">
                      {t('admin.userDetail.signalSettingsTitle')}
                    </h3>
                    {signalSettings.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-dark-700 bg-dark-900/50 px-4 py-6 text-center text-xs font-mono text-slate-500">
                        {t('admin.userDetail.signalSettingsEmpty')}
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-2xl border border-dark-800">
                        <table className="w-full text-left text-sm">
                          <thead className="bg-dark-950/60 text-[10px] uppercase tracking-wider text-slate-400 font-mono border-b border-dark-800">
                            <tr>
                              <th className="px-4 py-3">{t('admin.userDetail.sigSetStrategy')}</th>
                              <th className="px-4 py-3">{t('admin.userDetail.sigSetEnabled')}</th>
                              <th className="px-4 py-3">{t('admin.userDetail.sigSetBalancePct')}</th>
                              <th className="px-4 py-3">{t('admin.userDetail.sigSetAlerts')}</th>
                              <th className="px-4 py-3">{t('admin.userDetail.sigSetThresholds')}</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-dark-800 font-mono text-xs">
                            {signalSettings.map((s) => (
                              <tr key={s.id}>
                                <td className="px-4 py-3 text-white">
                                  {strategyName.get(String(s.strategy_id)) || s.strategy_id}
                                </td>
                                <td className="px-4 py-3">
                                  {s.is_enabled ? (
                                    <span className="text-emerald-400 inline-flex items-center gap-1">
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                      {t('admin.userDetail.yes')}
                                    </span>
                                  ) : (
                                    <span className="text-slate-500">
                                      {t('admin.userDetail.no')}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 text-slate-300">
                                  {Number(s.balance_pct || 0).toFixed(2)}%
                                </td>
                                <td className="px-4 py-3 text-slate-300">
                                  {s.alert_readiness_enabled
                                    ? t('admin.userDetail.yes')
                                    : t('admin.userDetail.no')}
                                </td>
                                <td className="px-4 py-3 text-slate-300">
                                  {Array.isArray(s.alert_thresholds) && s.alert_thresholds.length > 0
                                    ? `${s.alert_thresholds.join(', ')}%`
                                    : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>

                  <section>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3">
                      {t('admin.userDetail.signalTradesTitle')}
                    </h3>
                    <div className="overflow-x-auto rounded-2xl border border-dark-800">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-dark-950/60 text-[10px] uppercase tracking-wider text-slate-400 font-mono border-b border-dark-800">
                          <tr>
                            <th className="px-4 py-3">{t('admin.userDetail.sigColSymbol')}</th>
                            <th className="px-4 py-3">{t('admin.userDetail.colStatus')}</th>
                            <th className="px-4 py-3">{t('admin.userDetail.sigColLeverage')}</th>
                            <th className="px-4 py-3">{t('admin.userDetail.colMargin')}</th>
                            <th className="px-4 py-3">{t('admin.userDetail.sigColEntryExit')}</th>
                            <th className="px-4 py-3 text-right">{t('admin.userDetail.colPnl')}</th>
                            <th className="px-4 py-3">{t('admin.userDetail.colExitReason')}</th>
                            <th className="px-4 py-3 text-right">{t('admin.userDetail.colOpened')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-dark-800 font-mono text-xs">
                          {signalPositions.length === 0 ? (
                            <EmptyRow colSpan={8} text={t('admin.userDetail.signalsEmpty')} />
                          ) : (
                            signalPositions.map((p) => {
                              const pnl = Number(
                                (p.status === 'open'
                                  ? p.unrealized_pnl_usd
                                  : p.realized_pnl_usd) || 0
                              );
                              const decimals = signalPriceDecimals(p.symbol);
                              return (
                                <tr key={p.id} className="hover:bg-dark-850/50 transition-colors">
                                  <td className="px-4 py-3 font-bold text-white">
                                    {p.symbol}/USDT
                                    <div className="text-[10px] text-slate-500 font-normal">
                                      {strategyName.get(String(p.strategy_id)) || p.strategy_id}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3">
                                    <Badge value={p.status} />
                                  </td>
                                  <td className="px-4 py-3 text-honey-400 font-bold">
                                    {Number(p.leverage || 0).toFixed(2)}x
                                  </td>
                                  <td className="px-4 py-3 text-slate-300">
                                    {usd(p.allocated_margin_usd)}
                                    <div className="text-[10px] text-slate-500">
                                      {usd(p.notional_usd)} {t('admin.userDetail.sigNotional')}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-slate-300">
                                    {Number(p.entry_price || 0).toFixed(decimals)} →{' '}
                                    {p.exit_price ? Number(p.exit_price).toFixed(decimals) : '—'}
                                    <div className="text-[10px] text-slate-500">
                                      TP {p.tp_price ? Number(p.tp_price).toFixed(decimals) : '—'} / SL{' '}
                                      {p.sl_price ? Number(p.sl_price).toFixed(decimals) : '—'}
                                    </div>
                                  </td>
                                  <td className={`px-4 py-3 text-right font-bold ${pnlClass(pnl)}`}>
                                    {formatPnl(pnl)}
                                  </td>
                                  <td className="px-4 py-3 text-slate-400 text-[11px]">
                                    {p.exit_reason || '—'}
                                  </td>
                                  <td className="px-4 py-3 text-right text-slate-400 text-[11px]">
                                    {formatDateTime(p.opened_at)}
                                    {p.closed_at && (
                                      <div className="text-slate-600">
                                        {t('admin.userDetail.colClosed')}: {formatDateTime(p.closed_at)}
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </div>
              )}

              {/* EXCHANGES */}
              {tab === 'exchanges' && (
                <div className="space-y-6">
                  <div className="rounded-xl border border-honey-500/25 bg-honey-500/5 px-4 py-3 text-[11px] text-honey-200 font-mono flex items-start gap-2">
                    <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{t('admin.userDetail.securityNote')}</span>
                  </div>

                  <section>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3">
                      {t('admin.userDetail.exchangesTitle')}
                    </h3>
                    {accounts.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-dark-700 bg-dark-900/50 px-4 py-6 text-center text-xs font-mono text-slate-500">
                        {t('admin.userDetail.exchangesEmpty')}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {accounts.map((a) => (
                          <div key={a.id} className="bg-dark-900 border border-dark-800 rounded-2xl p-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-white uppercase">
                                  {a.exchange}
                                </span>
                                <Badge
                                  value={a.is_active ? 'active' : 'off'}
                                  tone={
                                    a.is_active
                                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                      : 'bg-dark-800 text-slate-400 border-dark-700'
                                  }
                                />
                              </div>
                              <span className="text-sm font-black text-honey-400 font-mono">
                                {usd(a.last_balance_usd)}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono mt-1">
                              {a.account_name || '—'}
                            </div>
                            <div className="grid grid-cols-2 gap-3 mt-3">
                              <Field
                                label={t('admin.userDetail.exValidated')}
                                value={
                                  a.is_validated
                                    ? t('admin.userDetail.yes')
                                    : t('admin.userDetail.no')
                                }
                              />
                              <Field
                                label={t('admin.userDetail.exWithdraw')}
                                value={
                                  <span
                                    className={
                                      a.can_withdraw ? 'text-rose-400 font-bold' : 'text-emerald-400'
                                    }
                                  >
                                    {a.can_withdraw
                                      ? t('admin.userDetail.yes')
                                      : t('admin.userDetail.no')}
                                  </span>
                                }
                              />
                              <Field
                                label={t('admin.userDetail.exFutures')}
                                value={
                                  a.can_trade_futures
                                    ? t('admin.userDetail.yes')
                                    : t('admin.userDetail.no')
                                }
                              />
                              <Field
                                label={t('admin.userDetail.exLastSync')}
                                value={a.last_sync_at ? formatDateTime(a.last_sync_at) : '—'}
                              />
                            </div>
                            {a.last_error_msg && (
                              <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[10px] text-rose-300 font-mono break-words flex items-start gap-1.5">
                                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                                {a.last_error_msg}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3">
                      {t('admin.userDetail.tradingSettingsTitle')}
                    </h3>
                    {!tradingSettings ? (
                      <div className="rounded-2xl border border-dashed border-dark-700 bg-dark-900/50 px-4 py-6 text-center text-xs font-mono text-slate-500">
                        {t('admin.userDetail.tradingSettingsEmpty')}
                      </div>
                    ) : (
                      <div className="bg-dark-900 border border-dark-800 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        <Field
                          label={t('admin.userDetail.tsBotActive')}
                          value={
                            tradingSettings.is_bot_active
                              ? t('admin.userDetail.yes')
                              : t('admin.userDetail.no')
                          }
                        />
                        <Field
                          label={t('admin.userDetail.tsLeverage')}
                          value={`${Number(tradingSettings.effective_leverage || 0).toFixed(2)}x`}
                        />
                        <Field
                          label={t('admin.userDetail.tsMaxMargin')}
                          value={
                            tradingSettings.max_allocated_margin_usd == null
                              ? t('admin.userDetail.tsUnlimited')
                              : usd(tradingSettings.max_allocated_margin_usd)
                          }
                        />
                        <Field
                          label={t('admin.userDetail.tsPairsBalancePct')}
                          value={`${Number(tradingSettings.pairs_balance_pct || 0).toFixed(2)}%`}
                        />
                        <Field
                          label={t('admin.userDetail.tsTp')}
                          value={`${Number(tradingSettings.take_profit_pct || 0).toFixed(2)}%`}
                        />
                        <Field
                          label={t('admin.userDetail.tsSl')}
                          value={`${Number(tradingSettings.stop_loss_pct || 0).toFixed(2)}%`}
                        />
                        <Field
                          label={t('admin.userDetail.tsExchangeAccount')}
                          value={
                            tradingSettings.exchange_account_id
                              ? accountName.get(String(tradingSettings.exchange_account_id)) ||
                                shortId(tradingSettings.exchange_account_id)
                              : '—'
                          }
                        />
                        <Field
                          label={t('admin.userDetail.tsPanicClosedAt')}
                          value={
                            tradingSettings.panic_closed_at
                              ? formatDateTime(tradingSettings.panic_closed_at)
                              : '—'
                          }
                        />
                        <div className="sm:col-span-2 lg:col-span-3">
                          <Field
                            label={t('admin.userDetail.tsActivePairs')}
                            value={
                              Array.isArray(tradingSettings.active_pairs) &&
                              tradingSettings.active_pairs.length > 0
                                ? tradingSettings.active_pairs.join(', ')
                                : '—'
                            }
                          />
                        </div>
                      </div>
                    )}
                  </section>
                </div>
              )}

              {/* ACTIVITY */}
              {tab === 'activity' && (
                <div className="overflow-x-auto rounded-2xl border border-dark-800">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-dark-950/60 text-[10px] uppercase tracking-wider text-slate-400 font-mono border-b border-dark-800">
                      <tr>
                        <th className="px-4 py-3">{t('admin.userDetail.colAction')}</th>
                        <th className="px-4 py-3">{t('admin.userDetail.colDetails')}</th>
                        <th className="px-4 py-3">{t('admin.userDetail.colIp')}</th>
                        <th className="px-4 py-3 text-right">{t('admin.userDetail.colTime')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-dark-800 font-mono text-xs">
                      {auditLogs.length === 0 ? (
                        <EmptyRow colSpan={4} text={t('admin.userDetail.activityEmpty')} />
                      ) : (
                        auditLogs.map((log) => (
                          <tr key={log.id} className="hover:bg-dark-850/50 transition-colors align-top">
                            <td className="px-4 py-3">
                              <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-dark-800 text-honey-400 border border-dark-700">
                                {log.action}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-slate-400 text-[10px] max-w-md">
                              {log.details && Object.keys(log.details).length > 0 ? (
                                <pre className="whitespace-pre-wrap break-words">
                                  {JSON.stringify(log.details, null, 2)}
                                </pre>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-4 py-3 text-slate-400 text-[11px]">
                              {log.ip_address || '—'}
                              {log.user_agent && (
                                <div className="text-slate-600 text-[10px] max-w-[220px] truncate" title={log.user_agent}>
                                  {log.user_agent}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-400 text-[11px]">
                              {formatDateTime(log.created_at)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
