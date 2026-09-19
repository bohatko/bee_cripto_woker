-- Migration: Add users_profile.external_uid (unique 7-digit payment identifier)
-- Apply: Supabase SQL Editor (project uxsbjkymrqrmlcshizns)
-- Purpose: OKX internal transfer (UID 547059395797258432, 0% fee) requires the payer
--          to reference their Bee Crypto ID so the admin can match the incoming payment.
--
-- The value is DETERMINISTIC (derived from the user UUID) so the frontend can display
-- and copy the same ID even before this migration runs. Formula (must stay in sync with
-- web/src/lib/externalUid.ts):
--   (((('x' || substr(replace(user_id::text,'-',''),1,8))::bit(32)::bigint) % 9000000) + 1000000)

-- 1. Deterministic derivation from the user UUID
CREATE OR REPLACE FUNCTION public.external_uid_for(p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT (
        (((('x' || substr(replace(p_user_id::text, '-', ''), 1, 8))::bit(32)::bigint) % 9000000) + 1000000)
    )::TEXT;
$$;

-- 2. Random fallback, used only if the deterministic value is already taken
CREATE OR REPLACE FUNCTION public.generate_external_uid()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    candidate TEXT;
    attempts  INT := 0;
BEGIN
    LOOP
        candidate := (FLOOR(RANDOM() * 9000000) + 1000000)::BIGINT::TEXT;
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM public.users_profile WHERE external_uid = candidate
        );
        attempts := attempts + 1;
        IF attempts > 200 THEN
            RAISE EXCEPTION 'Could not generate a unique external_uid after % attempts', attempts;
        END IF;
    END LOOP;
    RETURN candidate;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_external_uid() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.generate_external_uid() TO authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.external_uid_for(UUID) TO anon, authenticated, service_role, postgres;

-- 3. Column
ALTER TABLE public.users_profile
    ADD COLUMN IF NOT EXISTS external_uid TEXT;

-- 4. Backfill every existing user (deterministic value, random only on collision)
DO $$
DECLARE
    r RECORD;
    v TEXT;
BEGIN
    FOR r IN SELECT id FROM public.users_profile WHERE external_uid IS NULL ORDER BY created_at LOOP
        v := public.external_uid_for(r.id);
        IF EXISTS (SELECT 1 FROM public.users_profile WHERE external_uid = v AND id <> r.id) THEN
            v := public.generate_external_uid();
        END IF;
        UPDATE public.users_profile SET external_uid = v WHERE id = r.id;
    END LOOP;
END $$;

-- 5. Integrity constraints
ALTER TABLE public.users_profile
    ALTER COLUMN external_uid SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_profile_external_uid_key'
    ) THEN
        ALTER TABLE public.users_profile
            ADD CONSTRAINT users_profile_external_uid_key UNIQUE (external_uid);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_profile_external_uid_format'
    ) THEN
        ALTER TABLE public.users_profile
            ADD CONSTRAINT users_profile_external_uid_format CHECK (external_uid ~ '^[0-9]{7}$');
    END IF;
END $$;

-- 6. Auto-fill for every new registration (handles the collision case too)
CREATE OR REPLACE FUNCTION public.set_external_uid()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.external_uid IS NULL OR NEW.external_uid = '' THEN
        NEW.external_uid := public.external_uid_for(NEW.id);
        IF EXISTS (SELECT 1 FROM public.users_profile WHERE external_uid = NEW.external_uid) THEN
            NEW.external_uid := public.generate_external_uid();
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_profile_external_uid ON public.users_profile;
CREATE TRIGGER trg_users_profile_external_uid
    BEFORE INSERT ON public.users_profile
    FOR EACH ROW EXECUTE FUNCTION public.set_external_uid();
