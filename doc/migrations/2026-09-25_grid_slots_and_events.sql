-- One grid slot per user, coin and exchange, plus a server activity log.

ALTER TABLE public.grid_user_settings ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
ALTER TABLE public.grid_user_settings ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.grid_templates(id) ON DELETE CASCADE;

UPDATE public.grid_user_settings s
SET template_id = sub.template_id,
    exchange = COALESCE(s.exchange, sub.exchange)
FROM (
    SELECT DISTINCT ON (user_id) user_id, template_id, exchange
    FROM public.grid_bots
    WHERE template_id IS NOT NULL
    ORDER BY user_id, created_at DESC
) sub
WHERE s.user_id = sub.user_id
  AND s.template_id IS NULL;

UPDATE public.grid_user_settings s
SET template_id = (
    SELECT id FROM public.grid_templates WHERE is_active = true ORDER BY created_at LIMIT 1
)
WHERE s.template_id IS NULL;

DELETE FROM public.grid_user_settings WHERE template_id IS NULL OR exchange IS NULL;

ALTER TABLE public.grid_user_settings DROP CONSTRAINT IF EXISTS grid_user_settings_pkey;
ALTER TABLE public.grid_user_settings ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.grid_user_settings ALTER COLUMN template_id SET NOT NULL;
ALTER TABLE public.grid_user_settings ALTER COLUMN exchange SET NOT NULL;
ALTER TABLE public.grid_user_settings ADD PRIMARY KEY (id);
CREATE UNIQUE INDEX IF NOT EXISTS grid_user_settings_slot
    ON public.grid_user_settings (user_id, template_id, exchange);

CREATE TABLE IF NOT EXISTS public.grid_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
    bot_id UUID REFERENCES public.grid_bots(id) ON DELETE SET NULL,
    template_id UUID,
    exchange TEXT,
    event TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_grid_events_user_time ON public.grid_events (user_id, created_at DESC);
ALTER TABLE public.grid_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users view own grid events" ON public.grid_events;
CREATE POLICY "Users view own grid events" ON public.grid_events
    FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.is_admin());
