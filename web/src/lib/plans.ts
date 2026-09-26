export type SubscriptionPlan = 'lite' | 'pro';
export type BillingInterval = 'month' | 'year';

export const PLAN_PRICE_USD: Record<SubscriptionPlan, Record<BillingInterval, number>> = {
  lite: { month: 70, year: 700 },
  pro: { month: 200, year: 2000 },
};

export function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  return value === 'lite' || value === 'pro';
}

export function isBillingInterval(value: unknown): value is BillingInterval {
  return value === 'month' || value === 'year';
}

export function planPriceUsd(plan: SubscriptionPlan, interval: BillingInterval): number {
  return PLAN_PRICE_USD[plan][interval];
}

/** Twelve monthly payments versus the prepaid year. Two months are free on both plans. */
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
  if (amountUsd === PLAN_PRICE_USD.lite.year) return 'lite';
  if (amountUsd === PLAN_PRICE_USD.pro.year) return 'pro';
  return null;
}

export const PLAN_FEATURE_KEYS: Record<SubscriptionPlan, readonly string[]> = {
  lite: [
    'landing.liteFeature1',
    'landing.liteFeature2',
    'landing.liteFeature3',
    'landing.liteFeature4',
  ],
  pro: [
    'landing.proFeature1',
    'landing.proFeature2',
    'landing.proFeature3',
    'landing.proFeature4',
    'landing.proFeature5',
  ],
};

/** Lite is Dip-Buy only. Pair entries and extra exchanges require Pro. */
export function planAllowsPairTrading(plan: string | null | undefined): boolean {
  return plan === 'pro';
}

export function maxExchangesForPlan(plan: string | null | undefined): number {
  return plan === 'pro' ? 3 : 1;
}
