export type SubscriptionPlan = 'pro';
export type BillingInterval = 'month' | 'year';

export const PLAN_PRICE_USD: Record<SubscriptionPlan, Record<BillingInterval, number>> = {
  pro: { month: 200, year: 2000 },
};

export function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  return value === 'pro';
}

export function isBillingInterval(value: unknown): value is BillingInterval {
  return value === 'month' || value === 'year';
}

export function planPriceUsd(plan: SubscriptionPlan, interval: BillingInterval): number {
  return PLAN_PRICE_USD[plan][interval];
}

/** Twelve monthly payments versus the prepaid year. Two months are free. */
export function yearlyComparedToMonthly(plan: SubscriptionPlan): { monthlyTotal: number; saved: number } {
  const monthlyTotal = PLAN_PRICE_USD[plan].month * 12;
  return { monthlyTotal, saved: monthlyTotal - PLAN_PRICE_USD[plan].year };
}

/** Yearly invoice label. Falls back to the prepaid amount when the plan column is empty. */
export function planForYearlyCharge(
  interval: unknown,
  plan: unknown,
  amountUsd?: number | null
): SubscriptionPlan | null {
  if (interval !== 'year') return null;
  if (isSubscriptionPlan(plan)) return plan;
  if (amountUsd === PLAN_PRICE_USD.pro.year) return 'pro';
  return null;
}

export const PRO_FEATURE_KEYS: readonly string[] = [
  'landing.proFeature1',
  'landing.proFeature2',
  'landing.proFeature3',
  'landing.proFeature4',
  'landing.proFeature5',
];
