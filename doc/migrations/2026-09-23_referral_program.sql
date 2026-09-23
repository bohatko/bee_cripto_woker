-- Referral program: one-level 10% weekly reward on invitees' positive realised PnL.
-- Apply this migration in the Supabase SQL Editor before deploying the web/worker changes.

-- A short immutable code is safer to share than an internal user ID.
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

ALTER TABLE public.users_profile
    ADD COLUMN IF NOT EXISTS referral_code TEXT;

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
        RAISE EXCEPTION 'Referral code cannot be changed.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_profile_referral_code_immutable ON public.users_profile;
CREATE TRIGGER trg_users_profile_referral_code_immutable
    BEFORE UPDATE ON public.users_profile
    FOR EACH ROW EXECUTE FUNCTION public.prevent_referral_code_change();

-- Attribution is immutable, single-level, and intentionally keeps invitee PII out of the referrer's UI.
CREATE TABLE IF NOT EXISTS public.referral_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inviter_user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE RESTRICT,
    invitee_user_id UUID NOT NULL UNIQUE REFERENCES public.users_profile(id) ON DELETE CASCADE,
    referral_code TEXT NOT NULL,
    activated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT referral_relationships_no_self_referral CHECK (inviter_user_id <> invitee_user_id),
    CONSTRAINT referral_relationships_code_format CHECK (referral_code ~ '^[A-Z0-9]{10}$')
);

CREATE INDEX IF NOT EXISTS idx_referral_relationships_inviter
    ON public.referral_relationships(inviter_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_relationships_activation
    ON public.referral_relationships(activated_at)
    WHERE activated_at IS NULL;

CREATE TABLE IF NOT EXISTS public.referral_wallets (
    user_id UUID PRIMARY KEY REFERENCES public.users_profile(id) ON DELETE CASCADE,
    available_balance_usd NUMERIC(18, 4) NOT NULL DEFAULT 0.0000 CHECK (available_balance_usd >= 0),
    pending_withdrawal_usd NUMERIC(18, 4) NOT NULL DEFAULT 0.0000 CHECK (pending_withdrawal_usd >= 0),
    total_earned_usd NUMERIC(18, 4) NOT NULL DEFAULT 0.0000 CHECK (total_earned_usd >= 0),
    total_spent_usd NUMERIC(18, 4) NOT NULL DEFAULT 0.0000 CHECK (total_spent_usd >= 0),
    total_paid_out_usd NUMERIC(18, 4) NOT NULL DEFAULT 0.0000 CHECK (total_paid_out_usd >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.referral_payout_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
    amount_usd NUMERIC(18, 4) NOT NULL CHECK (amount_usd > 0),
    payout_network public.crypto_network NOT NULL,
    payout_address TEXT NOT NULL CHECK (LENGTH(BTRIM(payout_address)) BETWEEN 5 AND 160),
    status TEXT NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'approved', 'rejected', 'paid', 'cancelled')),
    tx_hash TEXT,
    admin_note TEXT,
    reviewed_by_admin_id UUID REFERENCES public.users_profile(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_payout_requests_user
    ON public.referral_payout_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_referral_payout_requests_status
    ON public.referral_payout_requests(status, created_at ASC);

CREATE TABLE IF NOT EXISTS public.referral_ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
    referral_id UUID REFERENCES public.referral_relationships(id) ON DELETE SET NULL,
    payout_request_id UUID REFERENCES public.referral_payout_requests(id) ON DELETE SET NULL,
    invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
    entry_type TEXT NOT NULL CHECK (entry_type IN (
        'weekly_reward', 'subscription_payment', 'withdrawal_hold',
        'withdrawal_release', 'withdrawal_paid', 'adjustment'
    )),
    amount_usd NUMERIC(18, 4) NOT NULL,
    source_profit_usd NUMERIC(18, 4),
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT referral_ledger_period_complete CHECK (
        (period_start IS NULL AND period_end IS NULL) OR (period_start IS NOT NULL AND period_end IS NOT NULL)
    ),
    CONSTRAINT referral_ledger_reward_period CHECK (
        entry_type <> 'weekly_reward' OR (referral_id IS NOT NULL AND period_start IS NOT NULL AND period_end IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_weekly_reward
    ON public.referral_ledger_entries(referral_id, entry_type, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_referral_ledger_entries_user
    ON public.referral_ledger_entries(user_id, created_at DESC);

-- Attribute a referral only during the first creation of an auth user. A typo or a
-- forged code simply results in no relationship; it never creates a user-controlled link.
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
        id,
        email,
        full_name,
        role,
        subscription_status
    )
    VALUES (
        NEW.id,
        COALESCE(NEW.email, ''),
        COALESCE(NEW.raw_user_meta_data->>'full_name', 'Trader'),
        'user'::public.user_role,
        'trial'::public.subscription_status
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

    IF inviter_id IS NOT NULL AND inviter_id <> NEW.id THEN
        INSERT INTO public.referral_relationships (
            inviter_user_id, invitee_user_id, referral_code
        )
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

-- Referral money can be moved only by the RPCs below; browser clients receive SELECT-only access.
ALTER TABLE public.referral_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_payout_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_ledger_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Referrers can view own referrals" ON public.referral_relationships;
CREATE POLICY "Referrers can view own referrals" ON public.referral_relationships
    FOR SELECT TO authenticated USING (auth.uid() = inviter_user_id);
DROP POLICY IF EXISTS "Admins manage referral relationships" ON public.referral_relationships;
CREATE POLICY "Admins manage referral relationships" ON public.referral_relationships
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users can view own referral wallet" ON public.referral_wallets;
CREATE POLICY "Users can view own referral wallet" ON public.referral_wallets
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins manage referral wallets" ON public.referral_wallets;
CREATE POLICY "Admins manage referral wallets" ON public.referral_wallets
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users can view own referral payouts" ON public.referral_payout_requests;
CREATE POLICY "Users can view own referral payouts" ON public.referral_payout_requests
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins manage referral payouts" ON public.referral_payout_requests;
CREATE POLICY "Admins manage referral payouts" ON public.referral_payout_requests
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users can view own referral ledger" ON public.referral_ledger_entries;
CREATE POLICY "Users can view own referral ledger" ON public.referral_ledger_entries
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins manage referral ledger" ON public.referral_ledger_entries;
CREATE POLICY "Admins manage referral ledger" ON public.referral_ledger_entries
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- The worker calls this once per completed UTC week. The unique ledger key makes a
-- retry harmless even if the process is restarted mid-run.
CREATE OR REPLACE FUNCTION public.credit_referral_weekly_reward(
    p_referral_id UUID,
    p_period_start TIMESTAMPTZ,
    p_period_end TIMESTAMPTZ,
    p_source_profit_usd NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    relationship_row public.referral_relationships%ROWTYPE;
    reward_usd NUMERIC(18, 4);
    ledger_id UUID;
BEGIN
    IF p_period_start >= p_period_end OR p_source_profit_usd IS NULL OR p_source_profit_usd <= 0 THEN
        RETURN 0;
    END IF;

    SELECT * INTO relationship_row
    FROM public.referral_relationships
    WHERE id = p_referral_id AND activated_at IS NOT NULL;

    IF NOT FOUND THEN
        RETURN 0;
    END IF;

    reward_usd := ROUND(p_source_profit_usd * 0.10, 4);
    IF reward_usd <= 0 THEN
        RETURN 0;
    END IF;

    INSERT INTO public.referral_wallets (user_id)
    VALUES (relationship_row.inviter_user_id)
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.referral_ledger_entries (
        user_id, referral_id, entry_type, amount_usd, source_profit_usd, period_start, period_end, note
    )
    VALUES (
        relationship_row.inviter_user_id, p_referral_id, 'weekly_reward', reward_usd,
        p_source_profit_usd, p_period_start, p_period_end, '10% weekly referral reward'
    )
    ON CONFLICT (referral_id, entry_type, period_start, period_end) DO NOTHING
    RETURNING id INTO ledger_id;

    IF ledger_id IS NULL THEN
        RETURN 0;
    END IF;

    UPDATE public.referral_wallets
    SET available_balance_usd = available_balance_usd + reward_usd,
        total_earned_usd = total_earned_usd + reward_usd,
        updated_at = NOW()
    WHERE user_id = relationship_row.inviter_user_id;

    RETURN reward_usd;
END;
$$;

REVOKE ALL ON FUNCTION public.credit_referral_weekly_reward(UUID, TIMESTAMPTZ, TIMESTAMPTZ, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_referral_weekly_reward(UUID, TIMESTAMPTZ, TIMESTAMPTZ, NUMERIC) TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.request_referral_withdrawal(
    p_amount_usd NUMERIC,
    p_network public.crypto_network,
    p_payout_address TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    requesting_user_id UUID := auth.uid();
    request_id UUID;
    wallet_row public.referral_wallets%ROWTYPE;
    withdrawal_amount NUMERIC(18, 4) := ROUND(p_amount_usd, 4);
    normalized_address TEXT := BTRIM(COALESCE(p_payout_address, ''));
BEGIN
    IF requesting_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication is required.';
    END IF;
    IF withdrawal_amount IS NULL OR withdrawal_amount <= 0 THEN
        RAISE EXCEPTION 'Withdrawal amount must be greater than zero.';
    END IF;
    IF LENGTH(normalized_address) < 5 OR LENGTH(normalized_address) > 160 THEN
        RAISE EXCEPTION 'A valid payout address is required.';
    END IF;

    INSERT INTO public.referral_wallets (user_id)
    VALUES (requesting_user_id)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT * INTO wallet_row
    FROM public.referral_wallets
    WHERE user_id = requesting_user_id
    FOR UPDATE;

    IF wallet_row.available_balance_usd < withdrawal_amount THEN
        RAISE EXCEPTION 'Insufficient available referral balance.';
    END IF;

    INSERT INTO public.referral_payout_requests (user_id, amount_usd, payout_network, payout_address)
    VALUES (requesting_user_id, withdrawal_amount, p_network, normalized_address)
    RETURNING id INTO request_id;

    UPDATE public.referral_wallets
    SET available_balance_usd = available_balance_usd - withdrawal_amount,
        pending_withdrawal_usd = pending_withdrawal_usd + withdrawal_amount,
        updated_at = NOW()
    WHERE user_id = requesting_user_id;

    INSERT INTO public.referral_ledger_entries (
        user_id, payout_request_id, entry_type, amount_usd, note
    )
    VALUES (
        requesting_user_id, request_id, 'withdrawal_hold', -withdrawal_amount,
        'Funds reserved for withdrawal request'
    );

    RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_referral_withdrawal(NUMERIC, public.crypto_network, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_referral_withdrawal(NUMERIC, public.crypto_network, TEXT) TO authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.pay_invoice_with_referral_balance(p_invoice_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    requesting_user_id UUID := auth.uid();
    invoice_row public.invoices%ROWTYPE;
    wallet_row public.referral_wallets%ROWTYPE;
    profile_row public.users_profile%ROWTYPE;
    base_date TIMESTAMPTZ;
BEGIN
    IF requesting_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication is required.';
    END IF;

    SELECT * INTO invoice_row
    FROM public.invoices
    WHERE id = p_invoice_id AND user_id = requesting_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invoice not found.';
    END IF;
    IF invoice_row.status NOT IN ('issued', 'frozen') THEN
        RAISE EXCEPTION 'This invoice is no longer payable.';
    END IF;

    INSERT INTO public.referral_wallets (user_id)
    VALUES (requesting_user_id)
    ON CONFLICT (user_id) DO NOTHING;

    SELECT * INTO wallet_row
    FROM public.referral_wallets
    WHERE user_id = requesting_user_id
    FOR UPDATE;

    IF wallet_row.available_balance_usd < invoice_row.total_amount_usd THEN
        RAISE EXCEPTION 'Insufficient available referral balance.';
    END IF;

    SELECT * INTO profile_row
    FROM public.users_profile
    WHERE id = requesting_user_id
    FOR UPDATE;

    base_date := CASE
        WHEN profile_row.subscription_paid_until IS NOT NULL
             AND profile_row.subscription_paid_until > NOW()
        THEN profile_row.subscription_paid_until
        ELSE NOW()
    END;

    UPDATE public.referral_wallets
    SET available_balance_usd = available_balance_usd - invoice_row.total_amount_usd,
        total_spent_usd = total_spent_usd + invoice_row.total_amount_usd,
        updated_at = NOW()
    WHERE user_id = requesting_user_id;

    UPDATE public.invoices
    SET status = 'paid',
        paid_at = NOW(),
        user_notes = CONCAT_WS(' | ', NULLIF(user_notes, ''), 'Paid with referral balance')
    WHERE id = invoice_row.id;

    UPDATE public.users_profile
    SET subscription_status = 'active',
        is_frozen = FALSE,
        subscription_paid_until = base_date + INTERVAL '7 days',
        high_water_mark_equity = invoice_row.hwm_after
    WHERE id = requesting_user_id;

    INSERT INTO public.referral_ledger_entries (
        user_id, invoice_id, entry_type, amount_usd, note
    )
    VALUES (
        requesting_user_id, invoice_row.id, 'subscription_payment', -invoice_row.total_amount_usd,
        CONCAT('Subscription invoice ', invoice_row.invoice_number, ' paid from referral balance')
    );
END;
$$;

REVOKE ALL ON FUNCTION public.pay_invoice_with_referral_balance(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pay_invoice_with_referral_balance(UUID) TO authenticated, service_role, postgres;

-- Manual payout processing stays with an authenticated administrator; rejection releases the held funds.
CREATE OR REPLACE FUNCTION public.review_referral_withdrawal(
    p_request_id UUID,
    p_action TEXT,
    p_tx_hash TEXT DEFAULT NULL,
    p_admin_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    admin_user_id UUID := auth.uid();
    request_row public.referral_payout_requests%ROWTYPE;
BEGIN
    IF admin_user_id IS NULL OR NOT public.is_admin() THEN
        RAISE EXCEPTION 'Administrator access is required.';
    END IF;
    IF p_action NOT IN ('approved', 'rejected', 'paid') THEN
        RAISE EXCEPTION 'Unsupported withdrawal action.';
    END IF;

    SELECT * INTO request_row
    FROM public.referral_payout_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Withdrawal request not found.';
    END IF;

    IF p_action = 'approved' THEN
        IF request_row.status <> 'requested' THEN
            RAISE EXCEPTION 'Only requested withdrawals can be approved.';
        END IF;
        UPDATE public.referral_payout_requests
        SET status = 'approved', reviewed_by_admin_id = admin_user_id, reviewed_at = NOW(),
            admin_note = COALESCE(p_admin_note, admin_note), updated_at = NOW()
        WHERE id = request_row.id;
        RETURN;
    END IF;

    IF p_action = 'rejected' THEN
        IF request_row.status NOT IN ('requested', 'approved') THEN
            RAISE EXCEPTION 'Only pending withdrawals can be rejected.';
        END IF;
        UPDATE public.referral_wallets
        SET available_balance_usd = available_balance_usd + request_row.amount_usd,
            pending_withdrawal_usd = pending_withdrawal_usd - request_row.amount_usd,
            updated_at = NOW()
        WHERE user_id = request_row.user_id;
        INSERT INTO public.referral_ledger_entries (user_id, payout_request_id, entry_type, amount_usd, note)
        VALUES (request_row.user_id, request_row.id, 'withdrawal_release', request_row.amount_usd,
                COALESCE(p_admin_note, 'Withdrawal request rejected; funds released'));
        UPDATE public.referral_payout_requests
        SET status = 'rejected', reviewed_by_admin_id = admin_user_id, reviewed_at = NOW(),
            admin_note = COALESCE(p_admin_note, admin_note), updated_at = NOW()
        WHERE id = request_row.id;
        RETURN;
    END IF;

    IF request_row.status <> 'approved' THEN
        RAISE EXCEPTION 'Only approved withdrawals can be marked paid.';
    END IF;
    IF BTRIM(COALESCE(p_tx_hash, '')) = '' THEN
        RAISE EXCEPTION 'A transaction hash is required before marking a withdrawal paid.';
    END IF;

    UPDATE public.referral_wallets
    SET pending_withdrawal_usd = pending_withdrawal_usd - request_row.amount_usd,
        total_paid_out_usd = total_paid_out_usd + request_row.amount_usd,
        updated_at = NOW()
    WHERE user_id = request_row.user_id;
    INSERT INTO public.referral_ledger_entries (user_id, payout_request_id, entry_type, amount_usd, note)
    VALUES (request_row.user_id, request_row.id, 'withdrawal_paid', 0,
            'Withdrawal paid on-chain');
    UPDATE public.referral_payout_requests
    SET status = 'paid', reviewed_by_admin_id = admin_user_id, reviewed_at = NOW(), paid_at = NOW(),
        tx_hash = BTRIM(p_tx_hash), admin_note = COALESCE(p_admin_note, admin_note), updated_at = NOW()
    WHERE id = request_row.id;
END;
$$;

REVOKE ALL ON FUNCTION public.review_referral_withdrawal(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_referral_withdrawal(UUID, TEXT, TEXT, TEXT) TO authenticated, service_role, postgres;

-- Keep timestamps consistent with the rest of the schema.
DROP TRIGGER IF EXISTS trg_referral_wallets_upd ON public.referral_wallets;
CREATE TRIGGER trg_referral_wallets_upd
    BEFORE UPDATE ON public.referral_wallets
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_referral_payout_requests_upd ON public.referral_payout_requests;
CREATE TRIGGER trg_referral_payout_requests_upd
    BEFORE UPDATE ON public.referral_payout_requests
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
