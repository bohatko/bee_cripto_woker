-- Step A of the single-plan migration. ALTER TYPE ... ADD VALUE must be committed
-- before the new value can be used, so it lives in its own migration.
-- 'none' = registered user without a paid Pro subscription (view-only mode).
ALTER TYPE public.subscription_status ADD VALUE IF NOT EXISTS 'none';
