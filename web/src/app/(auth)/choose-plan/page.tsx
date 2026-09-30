'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { toast } from '@/components/ui/sonner';
import { useLanguage } from '@/lib/i18n/LanguageContext';
import { LanguageSwitcher } from '@/lib/i18n/LanguageSwitcher';
import { PlanIntervalSwitch, YearlySavingsNote } from '@/components/pricing/PlanPricing';
import { PRO_FEATURE_KEYS, type BillingInterval } from '@/lib/plans';

export default function ChoosePlanPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const [interval, setInterval] = useState<BillingInterval>('month');
  const [submitting, setSubmitting] = useState(false);
  const yearly = interval === 'year';

  useEffect(() => {
    let active = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!active || !user) return;
      const { data: profile } = await supabase
        .from('users_profile')
        .select('subscription_status')
        .eq('id', user.id)
        .maybeSingle();
      if (active && profile && profile.subscription_status !== 'none') {
        router.replace('/dashboard');
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  const handleSubscribe = async () => {
    setSubmitting(true);
    try {
      const response = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(payload.error || t('billing.subscribeError'));
        return;
      }
      router.push('/billing');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('billing.subscribeError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-dark-950 flex flex-col justify-center py-12 px-4 relative">
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
        <LanguageSwitcher variant="compact" />
      </div>

      <div className="mx-auto w-full max-w-lg text-center">
        <div className="inline-flex items-center gap-2 mb-4">
          <div className="w-10 h-10 rounded-xl bg-honey-500/10 border border-honey-500/30 flex items-center justify-center text-honey-500 font-bold text-2xl">
            🐝
          </div>
          <span className="font-extrabold text-xl text-white tracking-tight">
            CRYPTO <span className="text-honey-400">BEE</span>
          </span>
        </div>
        <h1 className="text-2xl font-bold text-white tracking-tight">{t('choosePlan.title')}</h1>
        <p className="mt-2 text-sm text-slate-400">{t('choosePlan.subtitle')}</p>

        <div className="mt-6 flex justify-center">
          <PlanIntervalSwitch yearly={yearly} onYearlyChange={(y) => setInterval(y ? 'year' : 'month')} />
        </div>

        <article className="mt-6 rounded-3xl border-2 border-honey-500 bg-dark-900 p-6 text-left shadow-2xl">
          <h2 className="text-2xl font-bold text-white">{t('landing.proName')}</h2>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="font-mono text-4xl font-black text-honey-400 sm:text-5xl">
              {yearly ? t('landing.proPriceYear') : t('landing.proPriceMonth')}
            </span>
            <span className="text-slate-400">{yearly ? t('landing.perYear') : t('landing.perMonth')}</span>
          </div>
          {yearly && (
            <>
              <YearlySavingsNote plan="pro" className="mt-2" />
              <p className="mt-1 text-xs text-slate-500">{t('landing.billedYearly')}</p>
            </>
          )}
          <ul className="mt-6 space-y-3 text-sm text-slate-300">
            {PRO_FEATURE_KEYS.map((key) => (
              <li key={key} className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                <span>{t(key)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-slate-500">{t('landing.insuranceNote')}</p>
        </article>

        <button
          type="button"
          onClick={handleSubscribe}
          disabled={submitting}
          className="mt-6 w-full py-3 px-4 rounded-xl font-bold text-sm bg-honey-500 hover:bg-honey-400 text-dark-950 shadow-lg shadow-honey-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {submitting ? t('billing.submitting') : t('choosePlan.cta')}
          <ArrowRight className="w-4 h-4" />
        </button>
        <Link
          href="/dashboard"
          className="mt-3 inline-block text-sm font-medium text-slate-400 hover:text-white"
        >
          {t('choosePlan.skip')}
        </Link>
        <p className="mt-3 text-xs text-slate-500">{t('choosePlan.skipHint')}</p>
      </div>
    </div>
  );
}
