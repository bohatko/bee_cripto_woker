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

/** Lite is Dip-Buy only. Pair entries and extra exchanges require Pro. */
export function planAllowsPairTrading(plan: string | null | undefined): boolean {
  return plan === 'pro';
}

export function maxExchangesForPlan(plan: string | null | undefined): number {
  return plan === 'pro' ? 3 : 1;
}
