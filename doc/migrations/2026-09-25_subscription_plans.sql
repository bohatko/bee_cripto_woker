-- Drop the percentage referral payout system and switch billing to Lite / Pro plans.
-- Lite: 70 USDT / month or 700 USDT / year. Dip-Buy only, one exchange.
-- Pro: 200 USDT / month or 2000 USDT / year. All modules, priority support, deposit insurance.

DROP TABLE IF EXISTS public.referral_ledger_entries CASCADE;
DROP TABLE IF EXISTS public.referral_payout_requests CASCADE;
DROP TABLE IF EXISTS public.referral_wallets CASCADE;
DROP TABLE IF EXISTS public.referral_relationships CASCADE;

DROP TRIGGER IF EXISTS trg_users_profile_referral_code ON public.users_profile;
DROP TRIGGER IF EXISTS trg_users_profile_referral_code_immutable ON public.users_profile;

DROP FUNCTION IF EXISTS public.review_referral_withdrawal(UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.pay_invoice_with_referral_balance(UUID);
DROP FUNCTION IF EXISTS public.request_referral_withdrawal(NUMERIC, public.crypto_network, TEXT);
DROP FUNCTION IF EXISTS public.credit_referral_weekly_reward(UUID, TIMESTAMPTZ, TIMESTAMPTZ, NUMERIC);
DROP FUNCTION IF EXISTS public.prevent_referral_code_change();
DROP FUNCTION IF EXISTS public.set_referral_code();
DROP FUNCTION IF EXISTS public.generate_referral_code();

ALTER TABLE public.users_profile DROP COLUMN IF EXISTS referral_code;

ALTER TABLE public.users_profile
    ADD COLUMN IF NOT EXISTS subscription_plan TEXT NOT NULL DEFAULT 'lite'
        CHECK (subscription_plan IN ('lite', 'pro')),
    ADD COLUMN IF NOT EXISTS billing_interval TEXT NOT NULL DEFAULT 'month'
        CHECK (billing_interval IN ('month', 'year')),
    ADD COLUMN IF NOT EXISTS pending_subscription_plan TEXT
        CHECK (pending_subscription_plan IS NULL OR pending_subscription_plan IN ('lite', 'pro')),
    ADD COLUMN IF NOT EXISTS pending_billing_interval TEXT
        CHECK (pending_billing_interval IS NULL OR pending_billing_interval IN ('month', 'year'));

-- Current customers already have the full product. New signups stay on the lite default.
UPDATE public.users_profile
SET subscription_plan = 'pro',
    billing_interval = 'month'
WHERE subscription_status IN ('trial', 'active', 'frozen');

ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS subscription_plan TEXT
        CHECK (subscription_plan IS NULL OR subscription_plan IN ('lite', 'pro')),
    ADD COLUMN IF NOT EXISTS billing_interval TEXT
        CHECK (billing_interval IS NULL OR billing_interval IN ('month', 'year'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.users_profile (
        id,
        email,
        full_name,
        role,
        subscription_status,
        subscription_plan,
        billing_interval
    )
    VALUES (
        NEW.id,
        COALESCE(NEW.email, ''),
        COALESCE(NEW.raw_user_meta_data->>'full_name', 'Trader'),
        'user'::public.user_role,
        'trial'::public.subscription_status,
        'lite',
        'month'
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, public.users_profile.full_name),
        updated_at = NOW();

    INSERT INTO public.trading_settings (
        user_id,
        is_bot_active,
        effective_leverage
    )
    VALUES (NEW.id, FALSE, 3.0)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user error for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin, postgres, service_role;

-- Browser clients must not rewrite billing entitlements. Trial switches go through the RPC.
CREATE OR REPLACE FUNCTION public.protect_billing_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF current_user IN ('postgres', 'supabase_admin', 'service_role')
       OR COALESCE(auth.role(), '') = 'service_role'
       OR current_setting('app.allow_plan_change', true) = '1'
       OR public.is_admin() THEN
        RETURN NEW;
    END IF;

    NEW.subscription_plan := OLD.subscription_plan;
    NEW.billing_interval := OLD.billing_interval;
    NEW.pending_subscription_plan := OLD.pending_subscription_plan;
    NEW.pending_billing_interval := OLD.pending_billing_interval;
    NEW.subscription_status := OLD.subscription_status;
    NEW.subscription_paid_until := OLD.subscription_paid_until;
    NEW.is_frozen := OLD.is_frozen;
    NEW.trial_start_at := OLD.trial_start_at;
    NEW.trial_end_at := OLD.trial_end_at;
    NEW.role := OLD.role;
    NEW.high_water_mark_equity := OLD.high_water_mark_equity;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_profile_protect_billing ON public.users_profile;
CREATE TRIGGER trg_users_profile_protect_billing
    BEFORE UPDATE ON public.users_profile
    FOR EACH ROW EXECUTE FUNCTION public.protect_billing_fields();

CREATE OR REPLACE FUNCTION public.select_subscription_plan(p_plan TEXT, p_interval TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    profile_row public.users_profile%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication is required.';
    END IF;
    IF p_plan NOT IN ('lite', 'pro') THEN
        RAISE EXCEPTION 'Unsupported subscription plan.';
    END IF;
    IF p_interval NOT IN ('month', 'year') THEN
        RAISE EXCEPTION 'Unsupported billing interval.';
    END IF;

    SELECT * INTO profile_row
    FROM public.users_profile
    WHERE id = auth.uid()
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Profile not found.';
    END IF;

    PERFORM set_config('app.allow_plan_change', '1', true);

    IF profile_row.subscription_status = 'trial' AND profile_row.is_frozen = FALSE THEN
        UPDATE public.users_profile
        SET subscription_plan = p_plan,
            billing_interval = p_interval,
            pending_subscription_plan = NULL,
            pending_billing_interval = NULL
        WHERE id = profile_row.id;

        IF p_plan = 'lite' THEN
            UPDATE public.trading_settings
            SET is_bot_active = FALSE
            WHERE user_id = profile_row.id;
        END IF;
    ELSE
        UPDATE public.users_profile
        SET pending_subscription_plan = p_plan,
            pending_billing_interval = p_interval
        WHERE id = profile_row.id;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.select_subscription_plan(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.select_subscription_plan(TEXT, TEXT) TO authenticated, service_role, postgres;
