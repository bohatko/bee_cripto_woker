type ProProfile = {
  subscription_plan?: string | null;
  subscription_status?: string | null;
  is_frozen?: boolean | null;
} | null | undefined;

/** Paid Pro only. Lite, trial, and a frozen account do not open Pro modules. */
export function hasProModules(profile: ProProfile): boolean {
  return profile?.subscription_plan === 'pro' && profile?.subscription_status === 'active' && !profile?.is_frozen;
}
