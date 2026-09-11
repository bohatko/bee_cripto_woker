-- ==============================================================================
-- MIGRATION: Dynamic pair selection (momentum screener + auto-rotation)
-- Date: 2026-09-07
-- Apply: Supabase SQL Editor / Supabase MCP (project uxsbjkymrqrmlcshizns)
-- Idempotent: safe to re-run.
-- ==============================================================================

-- ==============================================================================
-- TABLE: pair_selection_runs (screener runs: daily cron + admin trigger)
-- Created BEFORE strategy_pairs (FK target).
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.pair_selection_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
    trigger_source TEXT NOT NULL CHECK (trigger_source IN ('cron','admin')),
    requested_by UUID REFERENCES public.users_profile(id) ON DELETE SET NULL, -- admin trigger only
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    universe_size INTEGER,
    candidates JSONB,           -- full ranked candidate list with metrics
    applied BOOLEAN NOT NULL DEFAULT FALSE,
    replacements JSONB,         -- [{ removed: 'X/Y', added: 'A/B', old_score, new_score }]
    progress_log JSONB NOT NULL DEFAULT '[]'::jsonb, -- live admin trace [{at, stage, message, detail?}]
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- TABLE: strategy_pairs (global active trading basket, replaces hardcode)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.strategy_pairs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pair_symbol TEXT NOT NULL,  -- 'ZEC/AVAX'
    long_coin TEXT NOT NULL,
    short_coin TEXT NOT NULL,
    score NUMERIC(18, 6),       -- final screener score (drift t-stat - funding penalty)
    metrics JSONB,              -- t_stat, corr, beta_diff, funding, volumes, etc.
    activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deactivated_at TIMESTAMPTZ,
    run_id UUID REFERENCES public.pair_selection_runs(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- ==============================================================================
-- TABLE: engine_settings (singleton: global engine toggles)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.engine_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    auto_rotation_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed singleton row. auto_rotation_enabled starts FALSE in production until the
-- momentum screener validation (research/pair_selection/momentum_screener_validation.py)
-- passes; flip it in the admin panel afterwards.
INSERT INTO public.engine_settings (id, auto_rotation_enabled)
VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;

-- Seed current 4 static pairs (only when the table is empty)
INSERT INTO public.strategy_pairs (pair_symbol, long_coin, short_coin, is_active)
SELECT v.pair_symbol, v.long_coin, v.short_coin, TRUE
FROM (VALUES
    ('ZEC/AVAX', 'ZEC', 'AVAX'),
    ('ENA/SUI',  'ENA', 'SUI'),
    ('SOL/ADA',  'SOL', 'ADA'),
    ('BNB/ETH',  'BNB', 'ETH')
) AS v(pair_symbol, long_coin, short_coin)
WHERE NOT EXISTS (SELECT 1 FROM public.strategy_pairs);

-- ==============================================================================
-- audit_logs: allow system (worker cron) entries without a user
-- ==============================================================================
ALTER TABLE public.audit_logs ALTER COLUMN user_id DROP NOT NULL;

-- ==============================================================================
-- INDEXES
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_strategy_pairs_active ON public.strategy_pairs(is_active) WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_strategy_pairs_active_symbol ON public.strategy_pairs(pair_symbol) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_pair_selection_runs_status ON public.pair_selection_runs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pair_selection_runs_created ON public.pair_selection_runs(created_at DESC);

-- ==============================================================================
-- TRIGGER: engine_settings.updated_at
-- ==============================================================================
DO $$
BEGIN
    CREATE TRIGGER trg_engine_settings_upd BEFORE UPDATE ON public.engine_settings
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ==============================================================================
-- ROW LEVEL SECURITY
-- Worker uses service role (bypasses RLS). Authenticated users read-only;
-- admin can trigger runs and toggle auto-rotation.
-- ==============================================================================
ALTER TABLE public.strategy_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pair_selection_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engine_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    CREATE POLICY "Authenticated users can read strategy pairs" ON public.strategy_pairs
        FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
    CREATE POLICY "Admins have full access to strategy pairs" ON public.strategy_pairs
        FOR ALL USING (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE POLICY "Authenticated users can read selection runs" ON public.pair_selection_runs
        FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
    CREATE POLICY "Admins can trigger selection runs" ON public.pair_selection_runs
        FOR INSERT TO authenticated
        WITH CHECK (public.is_admin() AND trigger_source = 'admin' AND status = 'pending');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
    CREATE POLICY "Admins have full access to selection runs" ON public.pair_selection_runs
        FOR ALL USING (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE POLICY "Authenticated users can read engine settings" ON public.engine_settings
        FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
    CREATE POLICY "Admins can update engine settings" ON public.engine_settings
        FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ==============================================================================
-- SUPABASE REALTIME (admin panel live updates)
-- ==============================================================================
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.strategy_pairs;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pair_selection_runs;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
