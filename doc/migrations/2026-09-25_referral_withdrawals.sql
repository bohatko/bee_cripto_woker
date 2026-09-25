-- Referral balance and withdrawal requests.
-- A $50 credit stays on hold for one calendar month after the invitee pays.
-- A withdrawal request must be at least 100 USDT and cannot exceed the unlocked balance.

DROP FUNCTION IF EXISTS public.list_my_referrals();

CREATE OR REPLACE FUNCTION public.list_my_referrals()
RETURNS TABLE (
    id UUID,
    created_at TIMESTAMPTZ,
    rewarded_at TIMESTAMPTZ,
    unlocks_at TIMESTAMPTZ,
    invitee_name TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT
        attribution.id,
        attribution.created_at,
        attribution.rewarded_at,
        CASE
            WHEN attribution.rewarded_at IS NULL THEN NULL
            ELSE attribution.rewarded_at + INTERVAL '1 month'
        END,
        COALESCE(NULLIF(BTRIM(profile.full_name), ''), 'Trader')
    FROM public.referral_attributions AS attribution
    JOIN public.users_profile AS profile ON profile.id = attribution.invitee_user_id
    WHERE attribution.inviter_user_id = auth.uid()
    ORDER BY attribution.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_my_referrals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_referrals() TO authenticated;

CREATE TABLE IF NOT EXISTS public.referral_withdrawal_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE RESTRICT,
    amount_usd NUMERIC(10, 2) NOT NULL,
    network public.crypto_network NOT NULL,
    wallet_address TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    CONSTRAINT referral_withdrawal_min CHECK (amount_usd >= 100),
    CONSTRAINT referral_withdrawal_address CHECK (char_length(BTRIM(wallet_address)) BETWEEN 8 AND 200),
    CONSTRAINT referral_withdrawal_status CHECK (status IN ('requested', 'paid', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_referral_withdrawals_user
    ON public.referral_withdrawal_requests(user_id, created_at DESC);

ALTER TABLE public.referral_withdrawal_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own referral withdrawals" ON public.referral_withdrawal_requests;
CREATE POLICY "Users view own referral withdrawals" ON public.referral_withdrawal_requests
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins manage referral withdrawals" ON public.referral_withdrawal_requests;
CREATE POLICY "Admins manage referral withdrawals" ON public.referral_withdrawal_requests
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT ON public.referral_withdrawal_requests TO authenticated;
GRANT ALL ON public.referral_withdrawal_requests TO service_role;

CREATE OR REPLACE FUNCTION public.referral_available_usd(p_user_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT
        COALESCE((
            SELECT SUM(reward_usd)
            FROM public.referral_attributions
            WHERE inviter_user_id = p_user_id
              AND rewarded_at IS NOT NULL
              AND rewarded_at <= NOW() - INTERVAL '1 month'
        ), 0)
        - COALESCE((
            SELECT SUM(amount_usd)
            FROM public.referral_withdrawal_requests
            WHERE user_id = p_user_id
              AND status IN ('requested', 'paid')
        ), 0);
$$;

REVOKE ALL ON FUNCTION public.referral_available_usd(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.referral_available_usd(UUID) TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.get_my_referral_summary()
RETURNS TABLE (
    invited_count INTEGER,
    available_usd NUMERIC,
    held_usd NUMERIC,
    reserved_usd NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT
        (SELECT COUNT(*)::INTEGER FROM public.referral_attributions WHERE inviter_user_id = auth.uid()),
        public.referral_available_usd(auth.uid()),
        COALESCE((
            SELECT SUM(reward_usd)
            FROM public.referral_attributions
            WHERE inviter_user_id = auth.uid()
              AND rewarded_at IS NOT NULL
              AND rewarded_at > NOW() - INTERVAL '1 month'
        ), 0),
        COALESCE((
            SELECT SUM(amount_usd)
            FROM public.referral_withdrawal_requests
            WHERE user_id = auth.uid()
              AND status = 'requested'
        ), 0);
$$;

REVOKE ALL ON FUNCTION public.get_my_referral_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_referral_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.request_referral_withdrawal(
    p_amount NUMERIC,
    p_network TEXT,
    p_address TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    request_id UUID;
    available NUMERIC;
    clean_address TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication is required.';
    END IF;

    clean_address := BTRIM(COALESCE(p_address, ''));

    IF p_amount IS NULL OR p_amount < 100 THEN
        RAISE EXCEPTION 'Amount must be at least 100 USDT.';
    END IF;

    IF p_network IS NULL OR p_network NOT IN ('TRC20', 'BEP20', 'TON', 'APTOS') THEN
        RAISE EXCEPTION 'Network is not supported.';
    END IF;

    IF char_length(clean_address) < 8 OR char_length(clean_address) > 200 THEN
        RAISE EXCEPTION 'Wallet address is required.';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

    available := public.referral_available_usd(auth.uid());
    IF p_amount > available THEN
        RAISE EXCEPTION 'Available balance is too low.';
    END IF;

    INSERT INTO public.referral_withdrawal_requests (user_id, amount_usd, network, wallet_address)
    VALUES (auth.uid(), p_amount, p_network::public.crypto_network, clean_address)
    RETURNING id INTO request_id;

    RETURN request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_referral_withdrawal(NUMERIC, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_referral_withdrawal(NUMERIC, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.review_referral_withdrawal(p_id UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Admin access is required.';
    END IF;

    IF p_status NOT IN ('paid', 'rejected') THEN
        RAISE EXCEPTION 'Status is not supported.';
    END IF;

    UPDATE public.referral_withdrawal_requests
    SET status = p_status,
        reviewed_at = NOW()
    WHERE id = p_id
      AND status = 'requested';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Withdrawal request was not found.';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.review_referral_withdrawal(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_referral_withdrawal(UUID, TEXT) TO authenticated;
