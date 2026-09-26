'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import {
  CreditCard,
  Clock,
  Copy,
  Check,
  FileText,
  DollarSign,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  Send,
  CheckCircle2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { resolveExternalUid } from '@/lib/externalUid';
import { ConfirmModal } from '@/components/modals/ConfirmModal';
import { toast } from '@/components/ui/sonner';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { BillingSkeleton } from '@/components/skeletons/PageSkeletons';
import { PLAN_PRICE_USD, PLAN_FEATURE_KEYS, isBillingInterval, isSubscriptionPlan, type BillingInterval, type SubscriptionPlan } from '@/lib/plans';
import { PlanIntervalSwitch, YearlyInvoiceNote, YearlySavingsNote } from '@/components/pricing/PlanPricing';
import { supportTelegramUrl } from '@/lib/support';

const APTOS_WALLET_ADDRESS =
  process.env.NEXT_PUBLIC_ADMIN_APTOS_WALLET ||
  '0xccabbae52a975c1cb682643d13b970e95997e539e5c9c9443e922ba406f401e7';

const OKX_DEPOSIT_UID = process.env.NEXT_PUBLIC_OKX_DEPOSIT_UID || '547059395797258432';

type PaymentMethod = 'aptos' | 'okx';

export default function BillingPage() {
  const router = useRouter();
  const { t, formatDate } = useLanguage();
  const [profile, setProfile] = useState<any>(null);
  const [planDraft, setPlanDraft] = useState<SubscriptionPlan>('lite');
  const [intervalDraft, setIntervalDraft] = useState<BillingInterval>('month');
  const [savingPlan, setSavingPlan] = useState(false);
  const [userId, setUserId] = useState<string>('');
  const [invoices, setInvoices] = useState<any[]>([]);
  const [txHash, setTxHash] = useState('');
  const [copied, setCopied] = useState(false);
  const [uidCopied, setUidCopied] = useState(false);
  const [okxUidCopied, setOkxUidCopied] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('aptos');
  const [submitting, setSubmitting] = useState(false);
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  async function loadBilling() {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/login');
        return;
      }

      setUserId(user.id);

      const { data: prof } = await supabase
        .from('users_profile')
        .select('*')
        .eq('id', user.id)
        .single();

      if (prof) {
        setProfile(prof);
        const selectedPlan = prof.pending_subscription_plan || prof.subscription_plan;
        const selectedInterval = prof.pending_billing_interval || prof.billing_interval;
        if (isSubscriptionPlan(selectedPlan)) setPlanDraft(selectedPlan);
        if (isBillingInterval(selectedInterval)) setIntervalDraft(selectedInterval);
      }

      const { data: invs } = await supabase
        .from('invoices')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (invs) setInvoices(invs);
      setLoading(false);
    } catch {
      router.replace('/login');
    }
  }

  useEffect(() => {
    loadBilling();
  }, []);

  // Include frozen invoices so user can submit payment to unpause account
  const activeInvoice = invoices.find((i) =>
    ['issued', 'pending_review', 'frozen'].includes(i.status)
  );

  const displayWalletAddress =
    activeInvoice?.payment_wallet_address &&
    !activeInvoice.payment_wallet_address.includes('Fake')
      ? activeInvoice.payment_wallet_address
      : APTOS_WALLET_ADDRESS;

  const handleCopyWallet = () => {
    navigator.clipboard.writeText(displayWalletAddress);
    setCopied(true);
    toast.success(t('billing.copied', { network: 'Aptos' }));
    setTimeout(() => setCopied(false), 2000);
  };

  const externalUid: string = resolveExternalUid(userId, profile?.external_uid);

  const handleCopyUid = () => {
    if (!externalUid) return;
    navigator.clipboard.writeText(externalUid);
    setUidCopied(true);
    toast.success(t('billing.uidCopied'));
    setTimeout(() => setUidCopied(false), 2000);
  };

  const handleCopyOkxUid = () => {
    navigator.clipboard.writeText(OKX_DEPOSIT_UID);
    setOkxUidCopied(true);
    toast.success(t('billing.okxUidCopied'));
    setTimeout(() => setOkxUidCopied(false), 2000);
  };

  const handleSubmitPayment = async () => {
    if (!activeInvoice || !txHash.trim()) return;
    setSubmitting(true);
    setIsSubmitModalOpen(false);

    try {
      const response = await fetch('/api/billing/submit-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: activeInvoice.id,
          txHash: txHash.trim(),
          paymentMethod,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && !payload.code) {
        toast.error(payload.error || t('billing.submitError'));
        return;
      }

      if (payload.code === 'paid') {
        toast.success(t('billing.verified'));
      } else if (payload.code === 'amount_mismatch') {
        toast.error(
          t('billing.amountMismatch', {
            chain: Number(payload.chainAmount).toFixed(2),
            invoice: Number(payload.invoiceAmount).toFixed(2),
          })
        );
      } else if (payload.code === 'pending_manual' || payload.code === 'no_plan') {
        toast.success(t('billing.submitted'));
      } else if (payload.code) {
        toast.error(t(`billing.verify_${payload.code}`));
      } else {
        toast.error(payload.error || t('billing.submitError'));
        return;
      }

      setTxHash('');
      await loadBilling();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('billing.submitError'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <BillingSkeleton />;
  }

  const savePlan = async () => {
    setSavingPlan(true);
    const { error } = await supabase.rpc('select_subscription_plan', {
      p_plan: planDraft,
      p_interval: intervalDraft,
    });
    setSavingPlan(false);
    if (error) {
      toast.error(error.message || t('billing.planSaveError'));
      return;
    }
    toast.success(t('billing.planSaved'));
    await loadBilling();
  };

  const isFrozen = profile?.is_frozen || profile?.subscription_status === 'frozen';
  const entitledPlan: SubscriptionPlan = isSubscriptionPlan(profile?.subscription_plan)
    ? profile.subscription_plan
    : 'lite';
  const planAppliesNow = profile?.subscription_status === 'trial' && !isFrozen;
  const isPendingReview = activeInvoice?.status === 'pending_review';
  const currentInterval: BillingInterval = isBillingInterval(profile?.billing_interval)
    ? profile.billing_interval
    : 'month';
  const upgradeDifference = PLAN_PRICE_USD.pro[currentInterval] - PLAN_PRICE_USD.lite[currentInterval];
  const showUpgradeNow = entitledPlan === 'lite' && !planAppliesNow;
  const upgradeIntervalLabel = t(currentInterval === 'year' ? 'billing.intervalYear' : 'billing.intervalMonth');
  const upgradeHref = supportTelegramUrl(
    t('billing.upgradeMessage', {
      interval: upgradeIntervalLabel,
      beeId: externalUid || 'n/a',
      amount: upgradeDifference,
    })
  );

  return (
    <div className="p-4 sm:p-8 max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
          {t('billing.title')}
        </h1>
        <p className="text-xs sm:text-sm text-slate-400 mt-1">
          {t('billing.subtitle')}
        </p>
      </div>

      {/* Subscription Summary Card */}
      <div className="bg-dark-900 border border-dark-800 rounded-2xl p-6 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs text-slate-400 uppercase font-medium">
            {t('billing.subscriptionStatus')}
          </span>
          <div className="flex items-center gap-3 mt-1">
            <span
              className={`text-lg font-bold uppercase font-mono px-2.5 py-0.5 rounded-lg ${
                isFrozen
                  ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                  : profile?.subscription_status === 'trial'
                  ? 'bg-honey-500/15 text-honey-400 border border-honey-500/30'
                  : profile?.subscription_status === 'active'
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                  : 'bg-dark-800 text-slate-400'
              }`}
            >
              {isFrozen ? 'PAUSED / FROZEN' : profile?.subscription_status || t('common.trial')}
            </span>
            <span className="text-xs text-slate-400 font-mono">
              {profile?.subscription_status === 'trial'
                ? t('billing.trialUntil', {
                    date: formatDate(profile?.trial_end_at || Date.now()),
                  })
                : profile?.subscription_paid_until
                ? t('billing.paidUntil', {
                    date: formatDate(profile.subscription_paid_until),
                  })
                : t('billing.paymentPending')}
            </span>
          </div>
        </div>

        {isFrozen && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs font-mono">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Trading paused. Pay invoice to unpause.</span>
          </div>
        )}
      </div>

      <section className="bg-dark-900 border border-dark-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div>
          <h2 className="font-bold text-white">{t('billing.choosePlan')}</h2>
          <p className="text-xs text-slate-400 mt-1">
            {t('billing.currentPlan', { plan: t(entitledPlan === 'pro' ? 'billing.planPro' : 'billing.planLite') })}
            {' · '}
            {planAppliesNow ? t('billing.planAppliesNow') : t('billing.planAppliesNext')}
          </p>
        </div>
        <div className="flex justify-center">
          <PlanIntervalSwitch
            yearly={intervalDraft === 'year'}
            onYearlyChange={(yearly) => setIntervalDraft(yearly ? 'year' : 'month')}
            track="inset"
          />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2" role="radiogroup">
          {(['lite', 'pro'] as const).map((plan) => {
            const selected = planDraft === plan;
            const yearly = intervalDraft === 'year';
            return (
              <article
                key={plan}
                role="radio"
                aria-checked={selected}
                tabIndex={0}
                onClick={() => setPlanDraft(plan)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setPlanDraft(plan);
                  }
                }}
                className={`relative flex cursor-pointer flex-col rounded-3xl border-2 bg-dark-950 p-6 text-left transition-colors ${
                  selected
                    ? 'border-honey-500 shadow-2xl'
                    : 'border-dark-800 hover:border-dark-700'
                }`}
              >
                {selected && (
                  <span className="absolute right-5 top-5 flex h-6 w-6 items-center justify-center rounded-full bg-honey-500 text-dark-950">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                )}
                <h3 className="text-2xl font-bold text-white">
                  {t(plan === 'pro' ? 'landing.proName' : 'landing.liteName')}
                </h3>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="font-mono text-4xl font-black text-honey-400 sm:text-5xl">
                    {t(
                      plan === 'pro'
                        ? yearly
                          ? 'landing.proPriceYear'
                          : 'landing.proPriceMonth'
                        : yearly
                          ? 'landing.litePriceYear'
                          : 'landing.litePriceMonth'
                    )}
                  </span>
                  <span className="text-slate-400">
                    {yearly ? t('landing.perYear') : t('landing.perMonth')}
                  </span>
                </div>
                {yearly && (
                  <>
                    <YearlySavingsNote plan={plan} className="mt-2" />
                    <p className="mt-1 text-xs text-slate-500">{t('landing.billedYearly')}</p>
                  </>
                )}
                <ul className="mt-6 space-y-3 text-sm text-slate-300">
                  {PLAN_FEATURE_KEYS[plan].map((key) => (
                    <li key={key} className="flex items-start gap-3">
                      <CheckCircle2
                        className={`mt-0.5 h-4 w-4 shrink-0 ${
                          plan === 'pro' ? 'text-emerald-400' : 'text-slate-400'
                        }`}
                      />
                      <span>{t(key)}</span>
                    </li>
                  ))}
                </ul>
                {plan === 'pro' && (
                  <p className="mt-4 text-xs leading-relaxed text-slate-500">{t('landing.insuranceNote')}</p>
                )}
              </article>
            );
          })}
        </div>
        <button
          type="button"
          onClick={savePlan}
          disabled={savingPlan}
          className="px-4 py-2.5 rounded-xl text-sm font-bold bg-honey-500 hover:bg-honey-400 text-dark-950 disabled:opacity-50"
        >
          {savingPlan ? t('billing.submitting') : t('billing.choosePlan')}
        </button>
        {showUpgradeNow && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-honey-500/30 bg-honey-500/5 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white">{t('billing.upgradeTitle')}</p>
              <p className="mt-1 text-xs text-slate-400">
                {t('billing.upgradeDesc', {
                  interval: upgradeIntervalLabel,
                  amount: upgradeDifference,
                })}
              </p>
            </div>
            <a
              href={upgradeHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-honey-500 px-4 py-2.5 text-sm font-bold text-dark-950 hover:bg-honey-400"
            >
              <Send className="h-4 w-4" />
              {t('billing.upgradeCta')}
            </a>
          </div>
        )}
      </section>

      {/* Active Invoice & Payment Screen */}
      {activeInvoice ? (
        <div
          className={`bg-dark-900 rounded-2xl p-6 sm:p-8 shadow-2xl border ${
            activeInvoice.status === 'frozen'
              ? 'border-rose-500/40'
              : 'border-honey-500/30'
          }`}
        >
          {activeInvoice.status === 'frozen' && (
            <div className="mb-6 p-4 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-rose-300">
                  Account is currently paused
                </p>
                <p className="text-xs text-rose-300/80 mt-0.5">
                  This invoice is overdue. To resume automatic trading, transfer $
                  {Number(activeInvoice.total_amount_usd).toFixed(2)} USDT (Aptos) and submit your transaction hash below.
                </p>
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-dark-800">
            <div>
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-honey-400" />
                <h2 className="text-lg font-bold text-white">
                  {t('billing.invoice', { number: activeInvoice.invoice_number })}
                </h2>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {t('billing.period')} {formatDate(activeInvoice.period_start)} –{' '}
                {formatDate(activeInvoice.period_end)}
              </p>
            </div>

            <div className="text-left sm:text-right">
              <span className="text-xs text-slate-400">{t('billing.totalDue')}</span>
              <p className="text-3xl font-black text-honey-400 font-mono">
                ${Number(activeInvoice.total_amount_usd).toFixed(2)}{' '}
                <span className="text-sm font-normal text-slate-500">USDT</span>
              </p>
              <YearlyInvoiceNote
                interval={activeInvoice.billing_interval}
                plan={activeInvoice.subscription_plan}
                amountUsd={Number(activeInvoice.total_amount_usd)}
                className="mt-1 sm:justify-end"
              />
            </div>
          </div>

          {/* Bee ID — always visible payment reference */}
          <div className="mt-5 flex flex-wrap items-center gap-2 p-3 rounded-xl bg-honey-500/5 border border-honey-500/30">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              {t('billing.yourBeeId')}
            </span>
            <span className="text-xl font-mono font-black text-honey-400 tracking-[0.3em] select-all">
              {externalUid || '•••••••'}
            </span>
            <button
              type="button"
              onClick={handleCopyUid}
              disabled={!externalUid}
              className="ml-auto px-3 py-1.5 rounded-lg text-[11px] font-bold bg-honey-500 hover:bg-honey-400 text-dark-950 flex items-center gap-1.5 transition-colors disabled:opacity-40"
            >
              {uidCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {uidCopied ? t('billing.uidCopiedShort') : t('billing.copyBeeId')}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-6">
            {/* Payment Details */}
            <div className="flex flex-col items-center p-6 bg-dark-950 rounded-xl border border-dark-800 text-center">
              {/* Payment Method Selector */}
              <div className="flex gap-2 w-full mb-4">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('aptos')}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold font-mono transition-colors ${
                    paymentMethod === 'aptos'
                      ? 'bg-honey-500 text-dark-950'
                      : 'bg-dark-850 text-slate-400 hover:text-white'
                  }`}
                >
                  {t('billing.methodAptos')}
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('okx')}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-bold font-mono transition-colors ${
                    paymentMethod === 'okx'
                      ? 'bg-honey-500 text-dark-950'
                      : 'bg-dark-850 text-slate-400 hover:text-white'
                  }`}
                >
                  {t('billing.methodOkx')}
                </button>
              </div>

              {paymentMethod === 'aptos' ? (
                <>
                  <span className="text-xs text-slate-400 mb-3 font-medium">
                    {t('billing.scanToPay', {
                      amount: Number(activeInvoice.total_amount_usd).toFixed(2),
                    })}
                  </span>

                  {/* QR Code */}
                  <div className="p-3 bg-white rounded-xl shadow-lg">
                    <QRCodeSVG value={displayWalletAddress} size={160} level="H" />
                  </div>

                  {/* Network Badge */}
                  <div className="flex items-center gap-2 mt-5">
                    <span className="px-3 py-1 rounded-lg text-xs font-bold font-mono bg-honey-500 text-dark-950">
                      USDT (Aptos)
                    </span>
                    <span className="px-2.5 py-1 rounded-lg text-[11px] font-mono bg-dark-850 text-slate-300 border border-dark-700">
                      OKX Deposit
                    </span>
                  </div>

                  {/* Copy Address */}
                  <div className="w-full mt-4 flex items-center gap-2 bg-dark-900 border border-dark-800 rounded-xl p-2.5">
                    <span className="text-xs font-mono text-slate-300 truncate flex-1 text-left select-all">
                      {displayWalletAddress}
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyWallet}
                      className="p-1.5 hover:bg-dark-800 rounded-lg text-slate-400 hover:text-white transition-colors shrink-0 flex items-center gap-1 text-xs font-mono"
                      title="Copy wallet address"
                    >
                      {copied ? (
                        <>
                          <Check className="w-4 h-4 text-emerald-400" />
                          <span className="text-emerald-400 text-[10px]">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4 text-honey-400" />
                          <span className="text-slate-300 text-[10px]">Copy</span>
                        </>
                      )}
                    </button>
                  </div>

                  <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
                    Send only <strong className="text-slate-300">USDT</strong> via{' '}
                    <strong className="text-honey-400">Aptos</strong> network to this address.
                  </p>
                </>
              ) : (
                <>
                  <span className="text-xs text-slate-400 mb-3 font-medium">
                    {t('billing.okxDesc')}
                  </span>

                  {/* OKX deposit UID */}
                  <div className="w-full text-left">
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      {t('billing.okxDepositUid')}
                    </p>
                    <div className="flex items-center gap-2 bg-dark-900 border border-honey-500/30 rounded-xl p-2.5">
                      <span className="text-sm font-mono text-honey-400 font-bold flex-1 select-all">
                        {OKX_DEPOSIT_UID}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyOkxUid}
                        className="p-1.5 hover:bg-dark-800 rounded-lg text-slate-400 hover:text-white transition-colors shrink-0"
                        title="Copy OKX UID"
                      >
                        {okxUidCopied ? (
                          <Check className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Copy className="w-4 h-4 text-honey-400" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Bee ID (external_uid) — required reference */}
                  <div className="w-full text-left mt-4">
                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                      {t('billing.yourBeeId')}
                    </p>
                    <div className="flex items-center gap-2 bg-honey-500/5 border border-honey-500/40 rounded-xl p-2.5">
                      <span className="text-lg font-mono text-honey-400 font-black tracking-[0.25em] flex-1 select-all">
                        {externalUid || '•••••••'}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyUid}
                        disabled={!externalUid}
                        className="p-1.5 hover:bg-dark-800 rounded-lg text-slate-400 hover:text-white transition-colors shrink-0 disabled:opacity-40"
                        title="Copy Bee ID"
                      >
                        {uidCopied ? (
                          <Check className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Copy className="w-4 h-4 text-honey-400" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 p-3 rounded-xl bg-honey-500/10 border border-honey-500/25 text-left">
                    <p className="text-[11px] text-honey-200/90 leading-relaxed">
                      {t('billing.okxInstruction')}
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Submission Form */}
            <div className="space-y-5 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold text-white mb-2">{t('billing.breakdown')}</h3>
                <div className="bg-dark-950 p-4 rounded-xl border border-dark-800 space-y-2 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-400">{t('billing.weeklyFee')}</span>
                    <span className="text-white">
                      ${Number(activeInvoice.base_fee_usd).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Network / Currency:</span>
                    <span className="text-honey-400 font-semibold">USDT (Aptos)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">{t('billing.profitFee')}</span>
                    <span className="text-slate-500">{t('billing.noPerformanceFee')}</span>
                  </div>
                </div>

                <div className="mt-5">
                  <label className="block text-xs font-medium text-slate-300 uppercase mb-1.5">
                    {t('billing.txHashLabel')}
                  </label>
                  <input
                    type="text"
                    required
                    disabled={isPendingReview}
                    value={isPendingReview && activeInvoice.tx_hash ? activeInvoice.tx_hash : txHash}
                    onChange={(e) => setTxHash(e.target.value)}
                    placeholder={t('billing.txHashPlaceholder')}
                    className="w-full px-4 py-2.5 bg-dark-950 border border-dark-700 rounded-xl text-white text-xs font-mono outline-none focus:border-honey-500 transition-colors disabled:opacity-60"
                  />
                  {isPendingReview && (
                    <p className="text-[11px] text-amber-400/90 mt-1.5 flex items-center gap-1.5 font-mono">
                      <Clock className="w-3.5 h-3.5" />
                      Submitted for verification. Admin approval usually takes less than 1 hour.
                    </p>
                  )}
                </div>
              </div>

              <button
                type="button"
                disabled={!txHash.trim() || submitting || isPendingReview}
                onClick={() => setIsSubmitModalOpen(true)}
                className="w-full py-3.5 rounded-xl font-bold text-sm bg-honey-500 hover:bg-honey-400 text-dark-950 shadow-lg shadow-honey-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isPendingReview
                  ? t('billing.underReview')
                  : submitting
                  ? t('billing.submitting')
                  : t('billing.submitPayment')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-dark-900 border border-dark-800 rounded-2xl p-8 text-center">
          <ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
          <h3 className="text-base font-bold text-white">{t('billing.allSettled')}</h3>
          <p className="text-xs text-slate-400 mt-1">
            {t('billing.allSettledDesc')}
          </p>
        </div>
      )}

      {/* Invoices History Table */}
      {invoices.length > 0 && (
        <div className="bg-dark-900 border border-dark-800 rounded-2xl overflow-hidden shadow-xl">
          <div className="px-6 py-4 border-b border-dark-800 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">Invoice History</h3>
            <span className="text-xs font-mono text-slate-400">{invoices.length} total</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-dark-950/60 text-[11px] uppercase tracking-wider text-slate-400 border-b border-dark-800">
                <tr>
                  <th className="px-5 py-3">Invoice</th>
                  <th className="px-5 py-3">Period</th>
                  <th className="px-5 py-3">Amount</th>
                  <th className="px-5 py-3">Network</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">TxHash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-dark-800">
                {invoices.map((inv) => {
                  const isAptos =
                    inv.payment_network === 'APTOS' ||
                    inv.user_notes?.toLowerCase().includes('aptos') ||
                    inv.payment_wallet_address?.startsWith('0x');
                  const explorerUrl = isAptos
                    ? `https://explorer.aptoslabs.com/txn/${inv.tx_hash}`
                    : inv.payment_network === 'TRC20'
                    ? `https://tronscan.org/#/transaction/${inv.tx_hash}`
                    : `https://bscscan.com/tx/${inv.tx_hash}`;

                  return (
                    <tr key={inv.id} className="hover:bg-dark-850/40 transition-colors">
                      <td className="px-5 py-3.5 font-bold text-white">
                        {inv.invoice_number}
                      </td>
                      <td className="px-5 py-3.5 text-slate-400">
                        {formatDate(inv.period_start)} – {formatDate(inv.period_end)}
                      </td>
                      <td className="px-5 py-3.5 text-honey-400 font-bold">
                        ${Number(inv.total_amount_usd).toFixed(2)} USDT
                        <YearlyInvoiceNote
                          interval={inv.billing_interval}
                          plan={inv.subscription_plan}
                          amountUsd={Number(inv.total_amount_usd)}
                          className="mt-1 font-normal"
                        />
                      </td>
                      <td className="px-5 py-3.5 text-slate-300">
                        USDT (Aptos)
                      </td>
                      <td className="px-5 py-3.5">
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
                      <td className="px-5 py-3.5">
                        {inv.tx_hash ? (
                          <a
                            href={explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-honey-400 hover:underline flex items-center gap-1"
                          >
                            <span>
                              {inv.tx_hash.substring(0, 8)}...{inv.tx_hash.substring(inv.tx_hash.length - 6)}
                            </span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span className="text-slate-600">—</span>
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

      {/* Confirmation Modal */}
      <ConfirmModal
        isOpen={isSubmitModalOpen}
        title={t('billing.confirmTitle')}
        description={t('billing.confirmDesc', {
          network: 'USDT (Aptos)',
          amount: Number(activeInvoice?.total_amount_usd || 0).toFixed(2),
        })}
        confirmText={t('billing.submitTxid')}
        onConfirm={handleSubmitPayment}
        onCancel={() => setIsSubmitModalOpen(false)}
      />
    </div>
  );
}
