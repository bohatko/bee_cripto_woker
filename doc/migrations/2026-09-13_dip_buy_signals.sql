-- ==============================================================================
-- MIGRATION: 2026-09-13_dip_buy_signals.sql
-- Dip-Buy XRP Signals Engine (Tables, Types, RLS, Realtime)
-- ==============================================================================

-- 1. ENUM types for signal positions
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'signal_position_status') THEN
        CREATE TYPE signal_position_status AS ENUM ('open', 'closed', 'error');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'signal_exit_reason') THEN
        CREATE TYPE signal_exit_reason AS ENUM ('tp', 'sl', 'panic_close', 'admin_close', 'external_flat');
    END IF;
END $$;

-- 2. Table: signal_strategies
CREATE TABLE IF NOT EXISTS public.signal_strategies (
    id TEXT PRIMARY KEY, -- e.g. 'xrp_dip_buy_v1'
    name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL DEFAULT 'long',
    leverage NUMERIC(4, 1) NOT NULL DEFAULT 3.0,
    config JSONB NOT NULL DEFAULT '{
        "drop_pct": 15,
        "window_minutes": 1440,
        "tp_pct": 4,
        "sl_pct": 30,
        "reference_margin_usd": 20000
    }'::jsonb,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    live_state JSONB NOT NULL DEFAULT '{
        "price": 0,
        "rolling_max": 0,
        "drop_pct": 0,
        "readiness_pct": 0,
        "state": "flat",
        "updated_at": null,
        "alerted_thresholds": []
    }'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed initial xrp_dip_buy_v1 strategy if not exists
INSERT INTO public.signal_strategies (id, name, symbol, side, leverage, config, is_enabled)
VALUES (
    'xrp_dip_buy_v1',
    'XRP Dip-Buy 24h',
    'XRP',
    'long',
    3.0,
    '{"drop_pct": 15, "window_minutes": 1440, "tp_pct": 4, "sl_pct": 30, "reference_margin_usd": 20000}'::jsonb,
    true
), (
    'eth_dip_buy_v1',
    'ETH Dip-Buy 1h',
    'ETH',
    'long',
    1.75,
    '{"drop_pct": 5, "window_minutes": 60, "tp_pct": 2, "sl_pct": 15, "reference_margin_usd": 20000}'::jsonb,
    true
)
ON CONFLICT (id) DO NOTHING;

-- 3. Table: user_signal_settings
CREATE TABLE IF NOT EXISTS public.user_signal_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
    strategy_id TEXT NOT NULL REFERENCES public.signal_strategies(id) ON DELETE CASCADE,
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    balance_pct NUMERIC(5, 2) NOT NULL DEFAULT 50.00 CHECK (balance_pct >= 1.0 AND balance_pct <= 100.0),
    alert_readiness_enabled BOOLEAN NOT NULL DEFAULT true,
    alert_thresholds SMALLINT[] NOT NULL DEFAULT '{80,90}'::SMALLINT[],
    panic_close_requested_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_user_signal_strategy UNIQUE (user_id, strategy_id)
);

-- 4. Table: signal_events (Global events triggered by scanner)
CREATE TABLE IF NOT EXISTS public.signal_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strategy_id TEXT NOT NULL REFERENCES public.signal_strategies(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    signal_bar_ts TIMESTAMPTZ NOT NULL,
    rolling_max NUMERIC(18, 6) NOT NULL,
    signal_close NUMERIC(18, 6) NOT NULL,
    drop_pct NUMERIC(6, 2) NOT NULL,
    reference_entry_price NUMERIC(18, 6) NOT NULL,
    status TEXT NOT NULL DEFAULT 'fired', -- 'fired' | 'skipped_in_position'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signal_events_strategy_ts ON public.signal_events(strategy_id, signal_bar_ts DESC);

-- 5. Table: signal_positions (Master paper + real user executions)
CREATE TABLE IF NOT EXISTS public.signal_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    signal_event_id UUID REFERENCES public.signal_events(id) ON DELETE SET NULL,
    strategy_id TEXT NOT NULL REFERENCES public.signal_strategies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users_profile(id) ON DELETE CASCADE,
    exchange_account_id UUID REFERENCES public.exchange_accounts(id) ON DELETE SET NULL,
    is_master BOOLEAN NOT NULL DEFAULT false,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL DEFAULT 'long',
    status signal_position_status NOT NULL DEFAULT 'open',
    leverage NUMERIC(4, 1) NOT NULL DEFAULT 3.0,
    allocated_margin_usd NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    notional_usd NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    qty NUMERIC(18, 6) NOT NULL DEFAULT 0.000000,
    entry_price NUMERIC(18, 6) NOT NULL DEFAULT 0.000000,
    entry_order_id TEXT,
    tp_price NUMERIC(18, 6),
    sl_price NUMERIC(18, 6),
    tp_order_id TEXT,
    sl_order_id TEXT,
    exit_price NUMERIC(18, 6),
    exit_order_id TEXT,
    exit_reason signal_exit_reason,
    entry_fees_usd NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    exit_fees_usd NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    funding_fees_usd NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    gross_pnl_usd NUMERIC(18, 4),
    realized_pnl_usd NUMERIC(18, 4),
    unrealized_pnl_usd NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    pnl_pct NUMERIC(8, 2),
    last_error TEXT,
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_signal_positions_user_status ON public.signal_positions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_signal_positions_master ON public.signal_positions(is_master, status);
CREATE INDEX IF NOT EXISTS idx_signal_positions_event ON public.signal_positions(signal_event_id);

-- 6. Row-Level Security (RLS)
ALTER TABLE public.signal_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_signal_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signal_positions ENABLE ROW LEVEL SECURITY;

-- signal_strategies policies
CREATE POLICY "Anyone authenticated can read signal strategies" ON public.signal_strategies
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins have full access to signal strategies" ON public.signal_strategies
    FOR ALL USING (public.is_admin());

-- user_signal_settings policies
CREATE POLICY "Users can view own signal settings" ON public.user_signal_settings
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own signal settings" ON public.user_signal_settings
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own signal settings" ON public.user_signal_settings
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Admins have full access to user signal settings" ON public.user_signal_settings
    FOR ALL USING (public.is_admin());

-- signal_events policies
CREATE POLICY "Anyone authenticated can read signal events" ON public.signal_events
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins have full access to signal events" ON public.signal_events
    FOR ALL USING (public.is_admin());

-- signal_positions policies
CREATE POLICY "Users can view own signal positions or master positions" ON public.signal_positions
    FOR SELECT USING (auth.uid() = user_id OR is_master = true);
CREATE POLICY "Admins have full access to signal positions" ON public.signal_positions
    FOR ALL USING (public.is_admin());

-- 7. Realtime Publication
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.signal_strategies;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_signal_settings;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.signal_events;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.signal_positions;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
