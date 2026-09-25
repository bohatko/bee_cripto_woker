'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Gift } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { toast } from '@/components/ui/sonner';
import { useLanguage } from '@/lib/i18n/LanguageContext';

const NETWORKS = ['TRC20', 'BEP20', 'TON', 'APTOS'] as const;

type AttributionRow = {
  id: string;
  created_at: string;
  rewarded_at: string | null;
  unlocks_at: string | null;
  invitee_name: string;
};

type Summary = {
  invited_count: number;
  available_usd: number;
  held_usd: number;
  reserved_usd: number;
};

type WithdrawalRow = {
  id: string;
  amount_usd: number;
  network: string;
  wallet_address: string;
  status: 'requested' | 'paid' | 'rejected';
  created_at: string;
};

const emptySummary: Summary = {
  invited_count: 0,
  available_usd: 0,
  held_usd: 0,
  reserved_usd: 0,
};

export default function ReferralsPage() {
  const { t, dateLocale } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [referralCode, setReferralCode] = useState('');
  const [rows, setRows] = useState<AttributionRow[]>([]);
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([]);
  const [amount, setAmount] = useState('');
  const [network, setNetwork] = useState<(typeof NETWORKS)[number]>('TRC20');
  const [address, setAddress] = useState('');

  const referralLink = useMemo(() => {
    if (!referralCode || typeof window === 'undefined') return '';
    return `${window.location.origin}/register?ref=${referralCode}`;
  }, [referralCode]);

  const amountNumber = Number(amount);
  const available = Number(summary.available_usd) || 0;

  const load = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setLoading(false);
      return;
    }

    const [profileResult, attributionResult, summaryResult, withdrawalResult] = await Promise.all([
      supabase.from('users_profile').select('referral_code').eq('id', userId).maybeSingle(),
      supabase.rpc('list_my_referrals'),
      supabase.rpc('get_my_referral_summary'),
      supabase
        .from('referral_withdrawal_requests')
        .select('id, amount_usd, network, wallet_address, status, created_at')
        .order('created_at', { ascending: false }),
    ]);

    const error = profileResult.error || attributionResult.error || summaryResult.error || withdrawalResult.error;
    if (error) {
      toast.error(error.message || t('referrals.loadError'));
      setLoading(false);
      return;
    }

    const summaryRow = Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data;
    setReferralCode(profileResult.data?.referral_code || '');
    setRows((attributionResult.data || []) as AttributionRow[]);
    setSummary(summaryRow ? (summaryRow as Summary) : emptySummary);
    setWithdrawals((withdrawalResult.data || []) as WithdrawalRow[]);
    setLoading(false);
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(value === referralCode ? t('referrals.codeCopied') : t('referrals.linkCopied'));
    } catch {
      toast.error(t('referrals.copyFailed'));
    }
  };

  const formatDate = (value: string) =>
    new Date(value).toLocaleDateString(dateLocale, { year: 'numeric', month: 'short', day: 'numeric' });

  const formatUsd = (value: number) =>
    `$${Number(value || 0).toLocaleString(dateLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const inviteeStatus = (row: AttributionRow) => {
    if (!row.rewarded_at || !row.unlocks_at) return t('referrals.waiting');
    if (new Date(row.unlocks_at).getTime() > Date.now()) {
      return t('referrals.onHoldUntil', { date: formatDate(row.unlocks_at) });
    }
    return t('referrals.inBalance');
  };

  const requestStatus = (status: WithdrawalRow['status']) => {
    if (status === 'paid') return t('referrals.statusPaid');
    if (status === 'rejected') return t('referrals.statusRejected');
    return t('referrals.statusRequested');
  };

  const openConfirm = () => {
    if (!Number.isFinite(amountNumber) || amountNumber < 100) {
      toast.error(t('referrals.amountTooLow'));
      return;
    }
    if (amountNumber > available) {
      toast.error(t('referrals.amountTooHigh'));
      return;
    }
    if (address.trim().length < 8) {
      toast.error(t('referrals.addressRequired'));
      return;
    }
    setConfirmOpen(true);
  };

  const submitWithdrawal = async () => {
    setSubmitting(true);
    const { error } = await supabase.rpc('request_referral_withdrawal', {
      p_amount: amountNumber,
      p_network: network,
      p_address: address.trim(),
    });
    setSubmitting(false);
    setConfirmOpen(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t('referrals.withdrawSuccess'));
    setAmount('');
    setAddress('');
    await load();
  };

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center bg-dark-950 p-8">
        <p className="font-mono text-sm text-slate-400">{t('referrals.loading')}</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-8 p-4 sm:p-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-honey-500/30 bg-honey-500/10 text-honey-400">
          <Gift className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white">{t('referrals.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">{t('referrals.subtitle')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-dark-800 bg-dark-900 p-5">
          <p className="text-xs uppercase text-slate-400">{t('referrals.available')}</p>
          <p className="mt-1 font-mono text-2xl font-bold text-emerald-400">{formatUsd(available)}</p>
          <p className="mt-2 text-xs text-slate-500">{t('referrals.availableHint')}</p>
        </div>
        <div className="rounded-2xl border border-dark-800 bg-dark-900 p-5">
          <p className="text-xs uppercase text-slate-400">{t('referrals.onHold')}</p>
          <p className="mt-1 font-mono text-2xl font-bold text-honey-400">{formatUsd(Number(summary.held_usd))}</p>
          <p className="mt-2 text-xs text-slate-500">{t('referrals.onHoldHint')}</p>
        </div>
        <div className="rounded-2xl border border-dark-800 bg-dark-900 p-5">
          <p className="text-xs uppercase text-slate-400">{t('referrals.invited')}</p>
          <p className="mt-1 font-mono text-2xl font-bold text-white">{Number(summary.invited_count) || 0}</p>
          <p className="mt-2 text-xs text-slate-500">{t('referrals.invitedHint')}</p>
        </div>
      </div>

      <section className="rounded-2xl border border-dark-800 bg-dark-900 p-5 shadow-xl sm:p-6">
        <h2 className="font-bold text-white">{t('referrals.codeTitle')}</h2>
        <p className="mt-1 text-xs text-slate-400">{t('referrals.codeHint')}</p>
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-dark-700 bg-dark-950 p-3">
          <code className="flex-1 truncate font-mono text-lg tracking-[0.18em] text-honey-400">
            {referralCode || '—'}
          </code>
          <button
            type="button"
            onClick={() => copy(referralCode)}
            disabled={!referralCode}
            className="rounded-lg border border-dark-700 p-2 text-slate-300 hover:text-honey-400 disabled:opacity-40"
            aria-label={t('referrals.copyCode')}
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-xl border border-dark-700 bg-dark-950 p-3">
          <code className="flex-1 truncate font-mono text-xs text-slate-300">{referralLink || '—'}</code>
          <button
            type="button"
            onClick={() => copy(referralLink)}
            disabled={!referralLink}
            className="rounded-lg border border-dark-700 p-2 text-slate-300 hover:text-honey-400 disabled:opacity-40"
            aria-label={t('referrals.copyLink')}
          >
            <Copy className="h-4 w-4" />
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-dark-800 bg-dark-900 p-5 shadow-xl sm:p-6">
        <h2 className="font-bold text-white">{t('referrals.withdrawTitle')}</h2>
        <p className="mt-1 text-xs text-slate-400">{t('referrals.withdrawHint')}</p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-xs text-slate-300">
            {t('referrals.amountLabel')}
            <input
              type="number"
              min={100}
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-dark-700 bg-dark-950 px-3 py-2.5 font-mono text-sm text-white outline-none focus:border-honey-500"
            />
          </label>
          <label className="block text-xs text-slate-300">
            {t('referrals.networkLabel')}
            <select
              value={network}
              onChange={(event) => setNetwork(event.target.value as (typeof NETWORKS)[number])}
              className="mt-1.5 w-full rounded-xl border border-dark-700 bg-dark-950 px-3 py-2.5 font-mono text-sm text-white outline-none focus:border-honey-500"
            >
              {NETWORKS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-slate-300 sm:col-span-1">
            {t('referrals.addressLabel')}
            <input
              type="text"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder={t('referrals.addressPlaceholder')}
              className="mt-1.5 w-full rounded-xl border border-dark-700 bg-dark-950 px-3 py-2.5 font-mono text-sm text-white outline-none focus:border-honey-500"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={openConfirm}
          disabled={available < 100}
          className="mt-4 rounded-xl bg-honey-500 px-4 py-2.5 text-sm font-bold text-dark-950 hover:bg-honey-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t('referrals.requestWithdraw')}
        </button>
      </section>

      <section className="rounded-2xl border border-dark-800 bg-dark-900 p-5 shadow-xl sm:p-6">
        <h2 className="font-bold text-white">{t('referrals.listTitle')}</h2>
        {rows.length === 0 ? (
          <p className="py-8 text-left font-mono text-sm text-slate-500">{t('referrals.empty')}</p>
        ) : (
          <table className="mt-4 w-full text-left text-sm">
            <thead className="border-b border-dark-800 font-mono text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="pb-2 pr-3">{t('referrals.colName')}</th>
                <th className="pb-2 pr-3">{t('referrals.colDate')}</th>
                <th className="pb-2">{t('referrals.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const unlocked = Boolean(row.unlocks_at) && new Date(row.unlocks_at as string).getTime() <= Date.now();
                return (
                  <tr key={row.id} className="border-b border-dark-800/70">
                    <td className="py-3 pr-3 text-slate-100">{row.invitee_name}</td>
                    <td className="py-3 pr-3 font-mono text-slate-400">{formatDate(row.created_at)}</td>
                    <td className="py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 font-mono text-[11px] ${
                          unlocked
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-honey-500/10 text-honey-400'
                        }`}
                      >
                        {inviteeStatus(row)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-2xl border border-dark-800 bg-dark-900 p-5 shadow-xl sm:p-6">
        <h2 className="font-bold text-white">{t('referrals.requestsTitle')}</h2>
        {withdrawals.length === 0 ? (
          <p className="py-8 text-left font-mono text-sm text-slate-500">{t('referrals.requestsEmpty')}</p>
        ) : (
          <table className="mt-4 w-full text-left text-sm">
            <thead className="border-b border-dark-800 font-mono text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="pb-2 pr-3">{t('referrals.colDate')}</th>
                <th className="pb-2 pr-3">{t('referrals.colAmount')}</th>
                <th className="pb-2 pr-3">{t('referrals.colNetwork')}</th>
                <th className="pb-2">{t('referrals.colStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {withdrawals.map((row) => (
                <tr key={row.id} className="border-b border-dark-800/70">
                  <td className="py-3 pr-3 font-mono text-slate-400">{formatDate(row.created_at)}</td>
                  <td className="py-3 pr-3 font-mono text-slate-100">{formatUsd(Number(row.amount_usd))}</td>
                  <td className="py-3 pr-3 font-mono text-slate-300">{row.network}</td>
                  <td className="py-3 font-mono text-[11px] text-slate-300">{requestStatus(row.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <ConfirmModal
        isOpen={confirmOpen}
        title={t('referrals.confirmWithdrawTitle')}
        description={t('referrals.confirmWithdrawDesc', {
          amount: formatUsd(amountNumber),
          network,
          address: address.trim(),
        })}
        confirmText={submitting ? t('common.loading') : t('referrals.requestWithdraw')}
        onConfirm={submitWithdrawal}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
