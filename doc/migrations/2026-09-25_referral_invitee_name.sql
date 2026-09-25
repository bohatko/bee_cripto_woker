-- Let an inviter read the invitee's display name only. Profile RLS stays closed.

CREATE OR REPLACE FUNCTION public.list_my_referrals()
RETURNS TABLE (
    id UUID,
    created_at TIMESTAMPTZ,
    rewarded_at TIMESTAMPTZ,
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
        COALESCE(NULLIF(BTRIM(profile.full_name), ''), 'Trader')
    FROM public.referral_attributions AS attribution
    JOIN public.users_profile AS profile ON profile.id = attribution.invitee_user_id
    WHERE attribution.inviter_user_id = auth.uid()
    ORDER BY attribution.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.list_my_referrals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_referrals() TO authenticated;
