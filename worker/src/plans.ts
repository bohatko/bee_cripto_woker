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

interface EntitlementProfile {
  subscription_status?: string | null;
  subscription_plan?: string | null;
  is_frozen?: boolean | null;
}

/** Paid Pro in good standing. Only this state may open new positions or start automation. */
export function canOpenNewTrades(profile: EntitlementProfile | null | undefined): boolean {
  return (
    profile?.subscription_plan === 'pro' &&
    profile.subscription_status === 'active' &&
    !profile.is_frozen
  );
}
