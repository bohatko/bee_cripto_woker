-- Step B of the single-plan migration (run after step A is committed).
--
-- Business model:
--   * One paid plan: Pro (200 USDT / month or 2000 USDT / year). Lite and the 7-day trial are removed.
--   * subscription_status = 'none' means "no plan": the user sees the whole platform but cannot connect
--     exchanges or Telegram, and cannot run pairs, grid or auto-trading of /signals.
--   * Overdue Pro keeps Variant A (Safe Freeze): no new entries, open positions are managed to exit.

-- 1. Legacy accounts: trial and paid Lite lose access immediately.
UPDATE public.users_profile
SET subscription_status = 'none',
    is_frozen = FALSE,
    subscription_paid_until = NULL,
    pending_subscription_plan = NULL,
    pending_billing_interval = NULL,
    billing_notice_24h_for = NULL,
    billing_notice_12h_for = NULL,
    telegram_enabled = FALSE
WHERE subscription_status::text = 'trial'
   OR (subscription_status::text = 'active' AND subscription_plan = 'lite');

UPDATE public.exchange_accounts
SET is_active = FALSE
WHERE user_id IN (SELECT id FROM public.users_profile WHERE subscription_status::text = 'none');

UPDATE public.trading_settings
SET is_bot_active = FALSE
WHERE user_id IN (SELECT id FROM public.users_profile WHERE subscription_status::text = 'none');

UPDATE public.user_signal_settings
SET is_enabled = FALSE
WHERE user_id IN (SELECT id FROM public.users_profile WHERE subscription_status::text = 'none');

UPDATE public.grid_user_settings
SET is_enabled = FALSE
WHERE user_id IN (SELECT id FROM public.users_profile WHERE subscription_status::text = 'none');

-- Unpaid invoices of removed plans are void.
UPDATE public.invoices
SET status = 'cancelled'
WHERE status::text = 'issued'
  AND user_id IN (SELECT id FROM public.users_profile WHERE subscription_status::text = 'none');

-- 2. Schema: Pro is the only plan, no trial.
ALTER TABLE public.users_profile DROP CONSTRAINT IF EXISTS users_profile_subscription_plan_check;
ALTER TABLE public.users_profile DROP CONSTRAINT IF EXISTS users_profile_pending_subscription_plan_check;
UPDATE public.users_profile SET subscription_plan = 'pro' WHERE subscription_plan <> 'pro';
UPDATE public.users_profile SET pending_subscription_plan = NULL;
ALTER TABLE public.users_profile
    ALTER COLUMN subscription_plan SET DEFAULT 'pro',
    ALTER COLUMN subscription_status SET DEFAULT 'none'::public.subscription_status,
    ADD CONSTRAINT users_profile_subscription_plan_check CHECK (subscription_plan = 'pro'),
    ADD CONSTRAINT users_profile_pending_subscription_plan_check
        CHECK (pending_subscription_plan IS NULL OR pending_subscription_plan = 'pro');

-- Protect trigger references trial columns, so replace it before dropping them.
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
    NEW.role := OLD.role;
    NEW.high_water_mark_equity := OLD.high_water_mark_equity;
    RETURN NEW;
END;
$$;

ALTER TABLE public.users_profile
    DROP COLUMN IF EXISTS trial_start_at,
    DROP COLUMN IF EXISTS trial_end_at;

-- 3. Signup: every new account starts without a plan.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    normalized_referral_code TEXT;
    inviter_id UUID;
BEGIN
    normalized_referral_code := UPPER(REGEXP_REPLACE(
        COALESCE(NEW.raw_user_meta_data->>'referral_code', ''),
        '[^A-Za-z0-9]', '', 'g'
    ));

    IF normalized_referral_code ~ '^[A-Z0-9]{10}$' THEN
        SELECT id INTO inviter_id
        FROM public.users_profile
        WHERE referral_code = normalized_referral_code;
    END IF;

    INSERT INTO public.users_profile (
        id, email, full_name, role, subscription_status, subscription_plan, billing_interval
    )
    VALUES (
        NEW.id,
        COALESCE(NEW.email, ''),
        COALESCE(NEW.raw_user_meta_data->>'full_name', 'Trader'),
        'user'::public.user_role,
        'none'::public.subscription_status,
        'pro',
        'month'
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        full_name = COALESCE(EXCLUDED.full_name, public.users_profile.full_name),
        updated_at = NOW();

    INSERT INTO public.trading_settings (user_id, is_bot_active, effective_leverage)
    VALUES (NEW.id, FALSE, 3.0)
    ON CONFLICT (user_id) DO NOTHING;

    IF inviter_id IS NOT NULL AND inviter_id <> NEW.id THEN
        INSERT INTO public.referral_attributions (inviter_user_id, invitee_user_id, referral_code)
        VALUES (inviter_id, NEW.id, normalized_referral_code)
        ON CONFLICT (invitee_user_id) DO NOTHING;
    END IF;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user error for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin, postgres, service_role;

-- 4. Interval choice replaces the Lite/Pro selector. Unpaid users only pick the interval of their first invoice
--    through the billing API; paying users pick the interval of the next invoice here.
DROP FUNCTION IF EXISTS public.select_subscription_plan(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.select_billing_interval(p_interval TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication is required.';
    END IF;
    IF p_interval NOT IN ('month', 'year') THEN
        RAISE EXCEPTION 'Unsupported billing interval.';
    END IF;

    PERFORM set_config('app.allow_plan_change', '1', true);

    UPDATE public.users_profile
    SET pending_billing_interval = p_interval
    WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.select_billing_interval(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.select_billing_interval(TEXT) TO authenticated, service_role, postgres;

-- 5. Referral: $50 once, after the invitee pays Pro for at least one month (a yearly payment also counts).
CREATE OR REPLACE FUNCTION public.credit_referral_subscription_bonus(p_invoice_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    invoice_row public.invoices%ROWTYPE;
    attribution_id UUID;
BEGIN
    SELECT * INTO invoice_row
    FROM public.invoices
    WHERE id = p_invoice_id AND status = 'paid';

    IF NOT FOUND THEN
        RETURN 0;
    END IF;

    IF COALESCE(invoice_row.total_amount_usd, 0) < 200
       OR COALESCE(invoice_row.subscription_plan, '') <> 'pro'
       OR COALESCE(invoice_row.billing_interval, '') NOT IN ('month', 'year') THEN
        RETURN 0;
    END IF;

    UPDATE public.referral_attributions
    SET reward_usd = 50,
        rewarded_at = NOW(),
        rewarded_invoice_id = invoice_row.id
    WHERE invitee_user_id = invoice_row.user_id
      AND rewarded_at IS NULL
    RETURNING id INTO attribution_id;

    IF attribution_id IS NULL THEN
        RETURN 0;
    END IF;

    RETURN 50;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_referral_subscription_bonus(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_referral_subscription_bonus(UUID) TO service_role, postgres;

-- 6. Profile notifications: no trial period, single plan.
CREATE OR REPLACE FUNCTION public.trg_user_notifications_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_interval TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM public.enqueue_user_notification(
            NEW.id, 'account', 'account.registered', 'success', '/dashboard',
            'account.registered:' || NEW.id::text,
            jsonb_build_object('email', NEW.email)
        );
        RETURN NEW;
    END IF;

    IF NEW.billing_notice_24h_for IS DISTINCT FROM OLD.billing_notice_24h_for
       AND NEW.billing_notice_24h_for IS NOT NULL THEN
        PERFORM public.enqueue_user_notification(
            NEW.id, 'billing', 'billing.ending_24h', 'info', '/billing',
            'billing.ending_24h:' || NEW.billing_notice_24h_for::text,
            jsonb_build_object('period', 'subscription', 'plan', 'pro', 'endsAt', NEW.billing_notice_24h_for)
        );
    END IF;

    IF NEW.billing_notice_12h_for IS DISTINCT FROM OLD.billing_notice_12h_for
       AND NEW.billing_notice_12h_for IS NOT NULL THEN
        PERFORM public.enqueue_user_notification(
            NEW.id, 'billing', 'billing.ending_12h', 'warning', '/billing',
            'billing.ending_12h:' || NEW.billing_notice_12h_for::text,
            jsonb_build_object('period', 'subscription', 'plan', 'pro', 'endsAt', NEW.billing_notice_12h_for)
        );
    END IF;

    IF NEW.telegram_enabled IS DISTINCT FROM OLD.telegram_enabled THEN
        PERFORM public.enqueue_user_notification(
            NEW.id,
            'account',
            CASE WHEN NEW.telegram_enabled THEN 'account.telegram_on' ELSE 'account.telegram_off' END,
            'info',
            '/settings/profile',
            'account.telegram:' || NEW.telegram_enabled::text || ':' || clock_timestamp()::text,
            '{}'::jsonb
        );
    END IF;

    IF NEW.pending_billing_interval IS DISTINCT FROM OLD.pending_billing_interval
       AND NEW.pending_billing_interval IS NOT NULL THEN
        v_interval := NEW.pending_billing_interval;
        PERFORM public.enqueue_user_notification(
            NEW.id, 'billing', 'billing.plan_saved', 'info', '/billing',
            'billing.plan_saved:pro:' || v_interval || ':' || clock_timestamp()::text,
            jsonb_build_object('plan', 'pro', 'interval', v_interval)
        );
    END IF;

    RETURN NEW;
END;
$$;

-- 7. Defense in depth: a user without active Pro cannot switch automation on or add exchanges,
--    even by calling the REST API directly. Switching OFF is always allowed.
CREATE OR REPLACE FUNCTION public.user_has_pro_access(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users_profile
        WHERE id = p_user_id
          AND subscription_plan = 'pro'
          AND subscription_status::text = 'active'
          AND is_frozen = FALSE
    );
$$;

REVOKE ALL ON FUNCTION public.user_has_pro_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_pro_access(UUID) TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.enforce_pro_for_automation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    flag_column TEXT := TG_ARGV[0];
    new_flag BOOLEAN;
    old_flag BOOLEAN := FALSE;
    owner_id UUID;
BEGIN
    IF current_user IN ('postgres', 'supabase_admin', 'service_role')
       OR COALESCE(auth.role(), '') = 'service_role' THEN
        RETURN NEW;
    END IF;

    new_flag := COALESCE((to_jsonb(NEW) ->> flag_column)::BOOLEAN, FALSE);
    IF TG_OP = 'UPDATE' THEN
        old_flag := COALESCE((to_jsonb(OLD) ->> flag_column)::BOOLEAN, FALSE);
    END IF;

    IF new_flag AND NOT old_flag THEN
        owner_id := COALESCE((to_jsonb(NEW) ->> 'user_id')::UUID, (to_jsonb(NEW) ->> 'id')::UUID);
        IF NOT public.user_has_pro_access(owner_id) THEN
            RAISE EXCEPTION 'An active Pro subscription is required.' USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pro_gate_trading_settings ON public.trading_settings;
CREATE TRIGGER trg_pro_gate_trading_settings
    BEFORE INSERT OR UPDATE ON public.trading_settings
    FOR EACH ROW EXECUTE FUNCTION public.enforce_pro_for_automation('is_bot_active');

DROP TRIGGER IF EXISTS trg_pro_gate_signal_settings ON public.user_signal_settings;
CREATE TRIGGER trg_pro_gate_signal_settings
    BEFORE INSERT OR UPDATE ON public.user_signal_settings
    FOR EACH ROW EXECUTE FUNCTION public.enforce_pro_for_automation('is_enabled');

DROP TRIGGER IF EXISTS trg_pro_gate_grid_settings ON public.grid_user_settings;
CREATE TRIGGER trg_pro_gate_grid_settings
    BEFORE INSERT OR UPDATE ON public.grid_user_settings
    FOR EACH ROW EXECUTE FUNCTION public.enforce_pro_for_automation('is_enabled');

DROP TRIGGER IF EXISTS trg_pro_gate_telegram ON public.users_profile;
CREATE TRIGGER trg_pro_gate_telegram
    BEFORE UPDATE ON public.users_profile
    FOR EACH ROW EXECUTE FUNCTION public.enforce_pro_for_automation('telegram_enabled');

CREATE OR REPLACE FUNCTION public.enforce_pro_for_new_exchange()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF current_user IN ('postgres', 'supabase_admin', 'service_role')
       OR COALESCE(auth.role(), '') = 'service_role' THEN
        RETURN NEW;
    END IF;

    IF NOT public.user_has_pro_access(NEW.user_id) THEN
        RAISE EXCEPTION 'An active Pro subscription is required to connect an exchange.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pro_gate_exchange_accounts ON public.exchange_accounts;
CREATE TRIGGER trg_pro_gate_exchange_accounts
    BEFORE INSERT ON public.exchange_accounts
    FOR EACH ROW EXECUTE FUNCTION public.enforce_pro_for_new_exchange();
