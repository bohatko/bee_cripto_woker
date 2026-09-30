type ProProfile = {
  subscription_plan?: string | null;
  subscription_status?: string | null;
  is_frozen?: boolean | null;
} | null | undefined;

/** Paid Pro in good standing. Unlocks exchanges, Telegram, pairs, grid and auto-trading. */
export function hasProModules(profile: ProProfile): boolean {
  return profile?.subscription_plan === 'pro' && profile?.subscription_status === 'active' && !profile?.is_frozen;
}

/** Account with no paid plan: the whole platform is visible, automation is locked. */
export function isViewOnly(profile: ProProfile): boolean {
  return !hasProModules(profile);
}
