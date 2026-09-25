-- Grid module: one global futures-grid template, per-user margin, exchange-hosted bots.

CREATE TABLE IF NOT EXISTS public.grid_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    base_asset TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    lower_price NUMERIC(24, 8) NOT NULL,
    upper_price NUMERIC(24, 8) NOT NULL,
    grid_count INTEGER NOT NULL CHECK (grid_count >= 2 AND grid_count <= 200),
    spacing TEXT NOT NULL DEFAULT 'geometric' CHECK (spacing IN ('geometric', 'arithmetic')),
    leverage NUMERIC(6, 2) NOT NULL DEFAULT 2 CHECK (leverage >= 1 AND leverage <= 5),
    stop_price NUMERIC(24, 8) NOT NULL,
    take_profit_price NUMERIC(24, 8) NOT NULL,
    direction TEXT NOT NULL DEFAULT 'neutral' CHECK (direction IN ('neutral', 'long', 'short')),
    score NUMERIC(12, 6),
    metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    params_hash TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT grid_templates_range_chk CHECK (upper_price > lower_price),
    CONSTRAINT grid_templates_stop_chk CHECK (stop_price < lower_price AND take_profit_price > upper_price)
);

CREATE UNIQUE INDEX IF NOT EXISTS grid_templates_one_active
    ON public.grid_templates (is_active)
    WHERE is_active;

CREATE TABLE IF NOT EXISTS public.grid_engine (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    scan_requested BOOLEAN NOT NULL DEFAULT FALSE,
    last_scan_at TIMESTAMPTZ,
    last_scan_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.grid_engine (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.grid_screener_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
    error TEXT
);

CREATE TABLE IF NOT EXISTS public.grid_user_settings (
    user_id UUID PRIMARY KEY REFERENCES public.users_profile(id) ON DELETE CASCADE,
    margin_usdt NUMERIC(20, 2) NOT NULL DEFAULT 50 CHECK (margin_usdt >= 0),
    exchange TEXT CHECK (exchange IS NULL OR exchange IN ('okx', 'bybit')),
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.grid_bots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
    template_id UUID REFERENCES public.grid_templates(id) ON DELETE SET NULL,
    exchange_account_id UUID REFERENCES public.exchange_accounts(id) ON DELETE SET NULL,
    exchange TEXT NOT NULL CHECK (exchange IN ('okx', 'bybit')),
    exchange_bot_id TEXT,
    margin_usdt NUMERIC(20, 2) NOT NULL,
    params_hash TEXT NOT NULL DEFAULT '',
    control_status TEXT NOT NULL DEFAULT 'controlled' CHECK (control_status IN ('controlled', 'released')),
    run_status TEXT NOT NULL DEFAULT 'starting' CHECK (run_status IN ('starting', 'running', 'stopped', 'error')),
    stop_reason TEXT,
    pnl_usdt NUMERIC(20, 4),
    last_error TEXT,
    snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    released_notified_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    stopped_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grid_bots_user_status ON public.grid_bots (user_id, run_status);
CREATE INDEX IF NOT EXISTS idx_grid_bots_live ON public.grid_bots (run_status) WHERE run_status IN ('starting', 'running');

CREATE OR REPLACE FUNCTION public.grid_template_touch()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.params_hash := md5(
        NEW.base_asset || '|' ||
        round(NEW.lower_price, 8)::text || '|' ||
        round(NEW.upper_price, 8)::text || '|' ||
        NEW.grid_count::text || '|' ||
        NEW.spacing || '|' ||
        round(NEW.leverage, 2)::text || '|' ||
        round(NEW.stop_price, 8)::text || '|' ||
        round(NEW.take_profit_price, 8)::text || '|' ||
        NEW.direction
    );
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_grid_templates_touch ON public.grid_templates;
CREATE TRIGGER trg_grid_templates_touch
    BEFORE INSERT OR UPDATE ON public.grid_templates
    FOR EACH ROW EXECUTE FUNCTION public.grid_template_touch();

DROP TRIGGER IF EXISTS trg_grid_user_settings_upd ON public.grid_user_settings;
CREATE TRIGGER trg_grid_user_settings_upd
    BEFORE UPDATE ON public.grid_user_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_grid_bots_upd ON public.grid_bots;
CREATE TRIGGER trg_grid_bots_upd
    BEFORE UPDATE ON public.grid_bots
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_grid_engine_upd ON public.grid_engine;
CREATE TRIGGER trg_grid_engine_upd
    BEFORE UPDATE ON public.grid_engine
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

REVOKE ALL ON FUNCTION public.grid_template_touch() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.grid_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grid_engine ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grid_screener_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grid_user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grid_bots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view grid templates" ON public.grid_templates;
CREATE POLICY "Authenticated can view grid templates" ON public.grid_templates
    FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Admins manage grid templates" ON public.grid_templates;
CREATE POLICY "Admins manage grid templates" ON public.grid_templates
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins manage grid engine" ON public.grid_engine;
CREATE POLICY "Admins manage grid engine" ON public.grid_engine
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins view grid screener runs" ON public.grid_screener_runs;
CREATE POLICY "Admins view grid screener runs" ON public.grid_screener_runs
    FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "Users manage own grid settings" ON public.grid_user_settings;
CREATE POLICY "Users manage own grid settings" ON public.grid_user_settings
    FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins manage grid user settings" ON public.grid_user_settings;
CREATE POLICY "Admins manage grid user settings" ON public.grid_user_settings
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users view own grid bots" ON public.grid_bots;
CREATE POLICY "Users view own grid bots" ON public.grid_bots
    FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Admins manage grid bots" ON public.grid_bots;
CREATE POLICY "Admins manage grid bots" ON public.grid_bots
    FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
