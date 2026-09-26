'use client';

import { planForYearlyCharge, yearlyComparedToMonthly, type SubscriptionPlan } from '@/lib/plans';
import { useLanguage } from '@/lib/i18n/LanguageContext';

export function PlanIntervalSwitch({
  yearly,
  onYearlyChange,
  track = 'raised',
}: {
  yearly: boolean;
  onYearlyChange: (yearly: boolean) => void;
  /** `raised` sits on the page background. `inset` sits inside a dark-900 card. */
  track?: 'raised' | 'inset';
}) {
  const { t } = useLanguage();

  return (
    <div
      className={`inline-flex rounded-xl border border-dark-700 p-1 ${
        track === 'inset' ? 'bg-dark-950' : 'bg-dark-900'
      }`}
    >
      <button
        type="button"
        onClick={() => onYearlyChange(false)}
        className={`rounded-lg px-4 py-2 text-sm font-semibold ${
          yearly ? 'text-slate-400' : 'bg-honey-500 text-dark-950'
        }`}
      >
        {t('landing.monthly')}
      </button>
      <button
        type="button"
        onClick={() => onYearlyChange(true)}
        className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${
          yearly ? 'bg-honey-500 text-dark-950' : 'text-slate-400'
        }`}
      >
        {t('landing.yearly')}
        <span
          className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold leading-none ${
            yearly ? 'bg-dark-950 text-emerald-400' : 'bg-emerald-500/15 text-emerald-400'
          }`}
        >
          {t('landing.yearlyDiscountBadge')}
        </span>
      </button>
    </div>
  );
}

export function YearlySavingsNote({
  plan,
  className = '',
}: {
  plan: SubscriptionPlan;
  className?: string;
}) {
  const { t, dateLocale } = useLanguage();
  const { monthlyTotal, saved } = yearlyComparedToMonthly(plan);

  return (
    <p className={`flex flex-wrap items-baseline gap-x-2 text-xs ${className}`}>
      <span className="text-slate-500">{t('landing.yearMonthlyCaption')}</span>
      <span className="font-mono text-slate-500 line-through">
        ${monthlyTotal.toLocaleString(dateLocale)}
      </span>
      <span className="font-mono font-semibold text-emerald-400">
        {t('landing.yearSave', { amount: saved.toLocaleString(dateLocale) })}
      </span>
    </p>
  );
}

/** Shown on a yearly invoice. Hidden for monthly bills and unknown amounts. */
export function YearlyInvoiceNote({
  interval,
  plan,
  amountUsd,
  className = '',
}: {
  interval: unknown;
  plan: unknown;
  amountUsd?: number | null;
  className?: string;
}) {
  const resolved = planForYearlyCharge(interval, plan, amountUsd);
  if (!resolved) return null;
  return <YearlySavingsNote plan={resolved} className={className} />;
}
