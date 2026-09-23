'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  Clock3,
  Copy,
  CreditCard,
  Gift,
  Link2,
  Send,
  UsersRound,
  Wallet,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { toast } from '@/components/ui/sonner';
import { useLanguage } from '@/lib/i18n/LanguageContext';

type ReferralWallet = {
  available_balance_usd: number | string;
  pending_withdrawal_usd: number | string;
  total_earned_usd: number | string;
  total_spent_usd: number | string;
  total_paid_out_usd: number | string;
};

type ReferralRelationship = {
  id: string;
  created_at: string;
  activated_at: string | null;
};

type LedgerEntry = {
  id: string;
  entry_type: string;
  amount_usd: number | string;
  source_profit_usd: number | string | null;
  period_start: string | null;
  period_end: string | null;
  note: string | null;
  created_at: string;
};

type PayoutRequest = {
  id: string;
  amount_usd: number | string;
  payout_network: string;
  payout_address: string;
  status: string;
  tx_hash: string | null;
  created_at: string;
};

type PayableInvoice = {
  id: string;
  invoice_number: string;
  total_amount_usd: number | string;
  status: 'issued' | 'frozen';
};

const EMPTY_WALLET: ReferralWallet = {
  available_balance_usd: 0,
  pending_withdrawal_usd: 0,
  total_earned_usd: 0,
  total_spent_usd: 0,
  total_paid_out_usd: 0,
};

const money = (value: number | string | null | undefined) =>
  `$${Number(value || 0).toFixed(2)}`;

export default function ReferralsPage() {
  const router = useRouter();
  const { t, formatDate } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [referralCode, setReferralCode] = useState('');
  const [wallet, setWallet] = useState<ReferralWallet>(EMPTY_WALLET);
  const [relationships, setRelationships] = useState<ReferralRelationship[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [payableInvoices, setPayableInvoices] = useState<PayableInvoice[]>([]);
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [withdrawalNetwork, setWithdrawalNetwork] = useState('TRC20');
  const [withdrawalAddress, setWithdrawalAddress] = useState('');
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [pendingAction, setPendingAction] = useState<
    | { type: 'withdraw' }
    | { type: 'invoice'; invoice: PayableInvoice }
    | null
  >(null);

  const availableBalance = Number(wallet.available_balance_usd || 0);
  const referralLink = useMemo(
    () => (typeof window === 'undefined' || !referralCode ? '' : `${window.location.origin}/register?ref=${referralCode}`),
    [referralCode]
  );

  const ledgerLabel = (entryType: string): string => {
    const labels: Record<string, string> = {
      weekly_reward: t('referrals.ledgerWeeklyReward'),
      subscription_payment: t('referrals.ledgerSubscriptionPayment'),
      withdrawal_hold: t('referrals.ledgerWithdrawalHold'),
      withdrawal_release: t('referrals.ledgerWithdrawalRelease'),
      withdrawal_paid: t('referrals.ledgerWithdrawalPaid'),
      adjustment: t('referrals.ledgerAdjustment'),
    };
    return labels[entryType] || entryType.replace(/_/g, ' ');
  };

  const invoiceStatusLabel = (status: PayableInvoice['status']): string => {
    switch (status) {
      case 'issued':
        return t('referrals.invoiceStatusIssued');
      case 'frozen':
        return t('referrals.invoiceStatusFrozen');
      default: {
        const _exhaustive: never = status;
        return _exhaustive;
      }
    }
  };

  const payoutStatusLabel = (status: string): string => {
    const labels: Record<string, string> = {
      requested: t('referrals.statusRequested'),
      approved: t('referrals.statusApproved'),
      rejected: t('referrals.statusRejected'),
      paid: t('referrals.statusPaid'),
      cancelled: t('referrals.statusCancelled'),
    };
    return labels[status] || status;
  };

  const loadReferralData = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login');
        return;
      }

      const [profileResult, walletResult, relationshipsResult, ledgerResult, payoutsResult, invoicesResult] =
        await Promise.all([
          supabase.from('users_profile').select('referral_code').eq('id', user.id).maybeSingle(),
          supabase.from('referral_wallets').select('*').eq('user_id', user.id).maybeSingle(),
          supabase
            .from('referral_relationships')
            .select('id, created_at, activated_at')
            .eq('inviter_user_id', user.id)
            .order('created_at', { ascending: false }),
          supabase
            .from('referral_ledger_entries')
            .select('id, entry_type, amount_usd, source_profit_usd, period_start, period_end, note, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(30),
          supabase
            .from('referral_payout_requests')
            .select('id, amount_usd, payout_network, payout_address, status, tx_hash, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(10),
          supabase
            .from('invoices')
            .select('id, invoice_number, total_amount_usd, status')
            .eq('user_id', user.id)
            .in('status', ['issued', 'frozen'])
            .order('created_at', { ascending: false }),
        ]);

      const failedResult = [
        profileResult,
        walletResult,
        relationshipsResult,
        ledgerResult,
        payoutsResult,
        invoicesResult,
      ].find((result) => result.error);

      if (failedResult?.error) {
        throw failedResult.error;
      }

      setReferralCode(profileResult.data?.referral_code || '');
      setWallet((walletResult.data as ReferralWallet | null) || EMPTY_WALLET);
      setRelationships((relationshipsResult.data as ReferralRelationship[] | null) || []);
      setLedger((ledgerResult.data as LedgerEntry[] | null) || []);
      setPayouts((payoutsResult.data as PayoutRequest[] | null) || []);
      setPayableInvoices((invoicesResult.data as PayableInvoice[] | null) || []);
    } catch (error: any) {
      toast.error(error?.message || t('referrals.loadError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReferralData();
  }, [router]);

  const copy = async (value: string, type: 'code' | 'link') => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(type);
      toast.success(type === 'code' ? t('referrals.codeCopied') : t('referrals.linkCopied'));
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      toast.error(t('referrals.copyFailed'));
    }
  };

  const beginWithdrawal = () => {
    const amount = Number(withdrawalAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(t('referrals.invalidAmount'));
      return;
    }
    if (amount > availableBalance) {
      toast.error(t('referrals.amountExceeds'));
      return;
    }
    if (withdrawalAddress.trim().length < 5) {
      toast.error(t('referrals.invalidAddress'));
      return;
    }
    setPendingAction({ type: 'withdraw' });
  };

  const beginInvoicePayment = (invoice: PayableInvoice) => {
    if (availableBalance < Number(invoice.total_amount_usd)) {
      toast.error(t('referrals.balanceTooLow'));
      return;
    }
    setPendingAction({ type: 'invoice', invoice });
  };

  const confirmAction = async () => {
    if (!pendingAction) return;
    setSubmitting(true);

    try {
      if (pendingAction.type === 'withdraw') {
        const { error } = await supabase.rpc('request_referral_withdrawal', {
          p_amount_usd: Number(withdrawalAmount),
          p_network: withdrawalNetwork,
          p_payout_address: withdrawalAddress.trim(),
        });
        if (error) throw error;
        setWithdrawalAmount('');
        setWithdrawalAddress('');
        toast.success(t('referrals.withdrawSuccess'));
      } else {
        const { error } = await supabase.rpc('pay_invoice_with_referral_balance', {
          p_invoice_id: pendingAction.invoice.id,
        });
        if (error) throw error;
        toast.success(t('referrals.invoicePaidSuccess'));
      }

      setPendingAction(null);
      await loadReferralData();
    } catch (error: any) {
      toast.error(error?.message || t('referrals.actionFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const activeReferrals = relationships.filter((relationship) => relationship.activated_at).length;

  if (loading) {
    return (
      <div className="min-h-full p-8 bg-dark-950 flex items-center justify-center">
        <div className="text-sm font-mono text-slate-400">{t('referrals.loading')}</div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-8 max-w-6xl space-y-7">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-honey-400 mb-2">
            <UsersRound className="w-5 h-5" />
            <span className="text-xs font-mono font-bold uppercase tracking-wider">{t('referrals.badge')}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">{t('referrals.title')}</h1>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl">{t('referrals.subtitle')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-dark-900 border border-honey-500/30 rounded-2xl p-5 shadow-xl">
          <div className="flex justify-between gap-3 text-xs text-slate-400 uppercase font-mono">
            {t('referrals.availableBalance')} <Wallet className="w-4 h-4 text-honey-400" />
          </div>
          <p className="text-3xl font-black font-mono text-honey-400 mt-3">{money(availableBalance)}</p>
          <p className="text-[11px] text-slate-500 mt-1">{t('referrals.availableHint')}</p>
        </div>
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-xl">
          <div className="flex justify-between gap-3 text-xs text-slate-400 uppercase font-mono">
            {t('referrals.invitedTraders')} <UsersRound className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-3xl font-black font-mono text-white mt-3">{relationships.length}</p>
          <p className="text-[11px] text-slate-500 mt-1">
            {t('referrals.activatedHint', { count: activeReferrals })}
          </p>
        </div>
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-5 shadow-xl">
          <div className="flex justify-between gap-3 text-xs text-slate-400 uppercase font-mono">
            {t('referrals.lifetimeEarned')} <Gift className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-3xl font-black font-mono text-emerald-400 mt-3">{money(wallet.total_earned_usd)}</p>
          <p className="text-[11px] text-slate-500 mt-1">
            {t('referrals.reservedHint', { amount: money(wallet.pending_withdrawal_usd) })}
          </p>
        </div>
      </div>

      <section className="bg-dark-900 border border-dark-800 rounded-2xl p-5 sm:p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-xl bg-honey-500/10 border border-honey-500/20 text-honey-400">
            <Link2 className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-white">{t('referrals.codeTitle')}</h2>
            <p className="text-xs text-slate-400 mt-1">{t('referrals.codeHint')}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-5">
          <div className="flex items-center gap-2 p-3 rounded-xl bg-dark-950 border border-dark-700">
            <code className="flex-1 font-mono text-lg tracking-[0.18em] text-honey-400 truncate">{referralCode || '—'}</code>
            <button
              type="button"
              onClick={() => copy(referralCode, 'code')}
              disabled={!referralCode}
              className="p-2 rounded-lg hover:bg-dark-800 text-slate-400 hover:text-white disabled:opacity-40"
              aria-label={t('referrals.copyCode')}
            >
              {copied === 'code' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <div className="flex items-center gap-2 p-3 rounded-xl bg-dark-950 border border-dark-700">
            <code className="flex-1 font-mono text-xs text-slate-300 truncate">{referralLink || '—'}</code>
            <button
              type="button"
              onClick={() => copy(referralLink, 'link')}
              disabled={!referralLink}
              className="p-2 rounded-lg hover:bg-dark-800 text-slate-400 hover:text-white disabled:opacity-40"
              aria-label={t('referrals.copyLink')}
            >
              {copied === 'link' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </section>

      {payableInvoices.length > 0 && (
        <section className="bg-dark-900 border border-honey-500/25 rounded-2xl p-5 sm:p-6 shadow-xl">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="w-5 h-5 text-honey-400" />
            <div>
              <h2 className="font-bold text-white">{t('referrals.payTitle')}</h2>
              <p className="text-xs text-slate-400 mt-0.5">{t('referrals.payHint')}</p>
            </div>
          </div>
          <div className="space-y-2">
            {payableInvoices.map((invoice) => {
              const amount = Number(invoice.total_amount_usd);
              const canPay = availableBalance >= amount;
              return (
                <div key={invoice.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-xl bg-dark-950 border border-dark-800">
                  <div className="flex-1">
                    <p className="text-sm font-mono font-bold text-white">{invoice.invoice_number}</p>
                    <p className="text-[11px] uppercase text-slate-500 mt-0.5">{invoiceStatusLabel(invoice.status)}</p>
                  </div>
                  <span className="font-mono text-lg text-honey-400 font-bold">{money(amount)}</span>
                  <button
                    type="button"
                    disabled={!canPay}
                    onClick={() => beginInvoicePayment(invoice)}
                    className="px-4 py-2 rounded-xl text-xs font-bold bg-honey-500 hover:bg-honey-400 text-dark-950 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {t('referrals.payFromBalance')}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <section className="xl:col-span-2 bg-dark-900 border border-dark-800 rounded-2xl p-5 sm:p-6 shadow-xl">
          <div className="flex items-center gap-2">
            <Send className="w-5 h-5 text-honey-400" />
            <div>
              <h2 className="font-bold text-white">{t('referrals.withdrawTitle')}</h2>
              <p className="text-xs text-slate-400 mt-0.5">{t('referrals.withdrawHint')}</p>
            </div>
          </div>
          <div className="space-y-3 mt-5">
            <label className="block text-xs font-medium text-slate-300">{t('referrals.amountLabel')}</label>
            <input
              type="number"
              min="0.0001"
              step="0.0001"
              value={withdrawalAmount}
              onChange={(event) => setWithdrawalAmount(event.target.value)}
              placeholder={t('referrals.amountPlaceholder', { amount: money(availableBalance) })}
              className="w-full px-3 py-2.5 bg-dark-950 border border-dark-700 rounded-xl text-white font-mono text-sm outline-none focus:border-honey-500"
            />
            <label className="block text-xs font-medium text-slate-300">{t('referrals.networkLabel')}</label>
            <select
              value={withdrawalNetwork}
              onChange={(event) => setWithdrawalNetwork(event.target.value)}
              className="w-full px-3 py-2.5 bg-dark-950 border border-dark-700 rounded-xl text-white font-mono text-sm outline-none focus:border-honey-500"
            >
              <option value="TRC20">USDT (TRC20)</option>
              <option value="BEP20">USDT (BEP20)</option>
              <option value="TON">USDT (TON)</option>
              <option value="APTOS">USDT (Aptos)</option>
            </select>
            <label className="block text-xs font-medium text-slate-300">{t('referrals.addressLabel')}</label>
            <input
              type="text"
              value={withdrawalAddress}
              onChange={(event) => setWithdrawalAddress(event.target.value)}
              placeholder={t('referrals.addressPlaceholder')}
              className="w-full px-3 py-2.5 bg-dark-950 border border-dark-700 rounded-xl text-white font-mono text-sm outline-none focus:border-honey-500"
            />
            <button
              type="button"
              onClick={beginWithdrawal}
              disabled={availableBalance <= 0}
              className="w-full px-4 py-3 rounded-xl text-sm font-bold bg-honey-500 hover:bg-honey-400 text-dark-950 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('referrals.createWithdraw')}
            </button>
          </div>
        </section>

        <section className="xl:col-span-3 bg-dark-900 border border-dark-800 rounded-2xl p-5 sm:p-6 shadow-xl">
          <div className="flex items-center gap-2 mb-4">
            <Clock3 className="w-5 h-5 text-honey-400" />
            <div>
              <h2 className="font-bold text-white">{t('referrals.activityTitle')}</h2>
              <p className="text-xs text-slate-400 mt-0.5">{t('referrals.activityHint')}</p>
            </div>
          </div>
          {ledger.length === 0 ? (
            <div className="py-10 text-center text-sm font-mono text-slate-500">{t('referrals.activityEmpty')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-slate-500 font-mono border-b border-dark-800">
                  <tr>
                    <th className="pb-2 pr-3">{t('referrals.colDate')}</th>
                    <th className="pb-2 pr-3">{t('referrals.colActivity')}</th>
                    <th className="pb-2 pr-3">{t('referrals.colSourcePnl')}</th>
                    <th className="pb-2 text-right">{t('referrals.colAmount')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-800/70">
                  {ledger.map((entry) => {
                    const amount = Number(entry.amount_usd);
                    return (
                      <tr key={entry.id}>
                        <td className="py-3 pr-3 text-slate-500 font-mono whitespace-nowrap">{formatDate(entry.created_at) || '—'}</td>
                        <td className="py-3 pr-3 text-slate-200">
                          <p className="font-semibold">{ledgerLabel(entry.entry_type)}</p>
                          {entry.period_start && (
                            <p className="text-[10px] font-mono text-slate-500 mt-0.5">
                              {formatDate(entry.period_start) || '—'} – {formatDate(entry.period_end) || '—'}
                            </p>
                          )}
                        </td>
                        <td className="py-3 pr-3 font-mono text-slate-400">
                          {entry.source_profit_usd == null ? '—' : money(entry.source_profit_usd)}
                        </td>
                        <td
                          className={`py-3 text-right font-mono font-bold ${
                            amount > 0 ? 'text-emerald-400' : amount < 0 ? 'text-rose-400' : 'text-slate-400'
                          }`}
                        >
                          {amount > 0 ? '+' : ''}
                          {money(amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="bg-dark-900 border border-dark-800 rounded-2xl p-5 sm:p-6 shadow-xl">
        <h2 className="font-bold text-white">{t('referrals.payoutsTitle')}</h2>
        {payouts.length === 0 ? (
          <p className="py-5 text-sm font-mono text-slate-500">{t('referrals.payoutsEmpty')}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500 font-mono border-b border-dark-800">
                <tr>
                  <th className="pb-2 pr-3">{t('referrals.colRequested')}</th>
                  <th className="pb-2 pr-3">{t('referrals.colAmount')}</th>
                  <th className="pb-2 pr-3">{t('referrals.colNetwork')}</th>
                  <th className="pb-2 pr-3">{t('referrals.colAddress')}</th>
                  <th className="pb-2">{t('referrals.colStatus')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-800/70 font-mono">
                {payouts.map((payout) => (
                  <tr key={payout.id}>
                    <td className="py-3 pr-3 text-slate-500 whitespace-nowrap">{formatDate(payout.created_at) || '—'}</td>
                    <td className="py-3 pr-3 text-white font-bold">{money(payout.amount_usd)}</td>
                    <td className="py-3 pr-3 text-slate-300">{payout.payout_network}</td>
                    <td className="py-3 pr-3 text-slate-400 max-w-44 truncate">{payout.payout_address}</td>
                    <td className="py-3">
                      <span
                        className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${
                          payout.status === 'paid'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : payout.status === 'rejected'
                              ? 'bg-rose-500/10 text-rose-400'
                              : 'bg-honey-500/10 text-honey-400'
                        }`}
                      >
                        {payoutStatusLabel(payout.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmModal
        isOpen={pendingAction !== null}
        title={
          pendingAction?.type === 'withdraw'
            ? t('referrals.confirmWithdrawTitle')
            : t('referrals.confirmInvoiceTitle')
        }
        description={
          pendingAction?.type === 'withdraw'
            ? t('referrals.confirmWithdrawDesc', {
                amount: money(withdrawalAmount),
                network: withdrawalNetwork,
                address: withdrawalAddress.trim(),
              })
            : pendingAction?.type === 'invoice'
              ? t('referrals.confirmInvoiceDesc', {
                  amount: money(pendingAction.invoice.total_amount_usd),
                  invoice: pendingAction.invoice.invoice_number,
                })
              : ''
        }
        confirmText={
          submitting
            ? t('referrals.processing')
            : pendingAction?.type === 'withdraw'
              ? t('referrals.confirmCreateRequest')
              : t('referrals.confirmPayInvoice')
        }
        onConfirm={confirmAction}
        onCancel={() => !submitting && setPendingAction(null)}
      />
    </div>
  );
}
