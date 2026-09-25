-- One Telegram reminder per period end: 24h before, then 12h before.
-- The stored timestamp is the period end we already notified about.
-- A renewed subscription_paid_until / trial_end_at no longer matches, so the next period can remind again.

ALTER TABLE public.users_profile
    ADD COLUMN IF NOT EXISTS billing_notice_24h_for TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS billing_notice_12h_for TIMESTAMPTZ;

COMMENT ON COLUMN public.users_profile.billing_notice_24h_for IS
    'Period end already covered by the 24-hour payment reminder.';
COMMENT ON COLUMN public.users_profile.billing_notice_12h_for IS
    'Period end already covered by the 12-hour payment reminder.';
