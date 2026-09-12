ALTER TABLE public.engine_settings
ADD COLUMN IF NOT EXISTS last_rotation_applied_at TIMESTAMPTZ;
