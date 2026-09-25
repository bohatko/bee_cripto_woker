-- Fixed $50 partner bonus. Paid once, only after the invitee pays a subscription
-- at least as large as Lite monthly (70 USDT). Trial signups do not pay the bonus.

ALTER TABLE public.users_profile
    ADD COLUMN IF NOT EXISTS referral_code TEXT;

CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    candidate TEXT;
BEGIN
    LOOP
        candidate := UPPER(SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 10));
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.users_profile WHERE referral_code = candidate
        );
    END LOOP;
    RETURN candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_referral_code() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_referral_code() TO service_role, postgres;

DO $$
DECLARE
    profile_row RECORD;
BEGIN
    FOR profile_row IN
        SELECT id FROM public.users_profile WHERE referral_code IS NULL OR referral_code = ''
    LOOP
        UPDATE public.users_profile
        SET referral_code = public.generate_referral_code()
        WHERE id = profile_row.id;
    END LOOP;
END;
$$;

ALTER TABLE public.users_profile
    ALTER COLUMN referral_code SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_profile_referral_code_key'
    ) THEN
        ALTER TABLE public.users_profile
            ADD CONSTRAINT users_profile_referral_code_key UNIQUE (referral_code);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_profile_referral_code_format'
    ) THEN
        ALTER TABLE public.users_profile
            ADD CONSTRAINT users_profile_referral_code_format
            CHECK (referral_code ~ '^[A-Z0-9]{10}$');
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_referral_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.referral_code IS NULL OR BTRIM(NEW.referral_code) = '' THEN
        NEW.referral_code := public.generate_referral_code();
    ELSE
        NEW.referral_code := UPPER(REGEXP_REPLACE(NEW.referral_code, '[^A-Za-z0-9]', '', 'g'));
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_profile_referral_code ON public.users_profile;
CREATE TRIGGER trg_users_profile_referral_code
    BEFORE INSERT ON public.users_profile
    FOR EACH ROW EXECUTE FUNCTION public.set_referral_code();

CREATE OR REPLACE FUNCTION public.prevent_referral_code_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.referral_code IS DISTINCT FROM OLD.referral_code THEN
        NEW.referral_code := OLD.referral_code;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_profile_referral_code_immutable ON public.users_profile;
CREATE TRIGGER trg_users_profile_referral_code_immutable
    BEFORE UPDATE ON public.users_profile
    FOR EACH ROW EXECUTE FUNCTION public.prevent_referral_code_change();

CREATE TABLE IF NOT EXISTS public.referral_attributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inviter_user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE RESTRICT,
    invitee_user_id UUID NOT NULL UNIQUE REFERENCES public.users_profile(id) ON DELETE CASCADE,
    referral_code TEXT NOT NULL,
    reward_usd NUMERIC(10, 2),
    rewarded_at TIMESTAMPTZ,
    rewarded_invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT referral_attributions_no_self CHECK (inviter_user_id <> invitee_user_id),
    CONSTRAINT referral_attributions_code_format CHECK (referral_code ~ '^[A-Z0-9]{10}$'),
    CONSTRAINT referral_attributions_reward_amount CHECK (reward_usd IS NULL OR reward_usd = 50),
    CONSTRAINT referral_attributions_reward_pair CHECK (
        (reward_usd IS NULL AND rewarded_at IS NULL) OR (reward_usd IS NOT NULL AND rewarded_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_referral_attributions_inviter
    ON public.referral_attributions(inviter_user_id, created_at DESC);

ALTER TABLE public.referral_attributions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Referrers can view own attributions" ON public.referral_attributions;
CREATE POLICY "Referrers can view own attributions" ON public.referral_attributions
    FOR SELECT TO authenticated USING (auth.uid() = inviter_user_id);
DROP POLICY IF EXISTS "Admins manage referral attributions" ON public.referral_attributions;
CREATE POLICY "Admins manage referral attributions" ON public.referral_attributions
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

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
        'trial'::public.subscription_status,
        'lite',
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

-- One $50 credit per invitee. Lite monthly is the floor; yearly Lite and any Pro plan also qualify.
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

    IF COALESCE(invoice_row.total_amount_usd, 0) < 70
       OR COALESCE(invoice_row.subscription_plan, '') NOT IN ('lite', 'pro')
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

CREATE OR REPLACE FUNCTION public.credit_referral_on_paid_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
        PERFORM public.credit_referral_subscription_bonus(NEW.id);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_referral_bonus ON public.invoices;
CREATE TRIGGER trg_invoices_referral_bonus
    AFTER UPDATE OF status ON public.invoices
    FOR EACH ROW EXECUTE FUNCTION public.credit_referral_on_paid_invoice();

GRANT SELECT ON public.referral_attributions TO authenticated;
GRANT ALL ON public.referral_attributions TO service_role;
