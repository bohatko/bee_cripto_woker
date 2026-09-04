-- ==============================================================================
-- БАЗА ДАННЫХ SUPABASE POSTGRESQL ДЛЯ ПРОЕКТА "BEE CRYPTO WORKER"
-- ==============================================================================
-- Стек: PostgreSQL 15+, Supabase Auth, Row-Level Security (RLS), Realtime
-- Запуск: Выполнить в SQL Editor консоли Supabase
-- ==============================================================================

-- 1. Создание расширений
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Пользовательские типы (ENUMs)
CREATE TYPE user_role AS ENUM ('user', 'admin');
CREATE TYPE subscription_status AS ENUM ('trial', 'active', 'frozen', 'expired');
CREATE TYPE exchange_type AS ENUM ('binance', 'okx', 'bybit');
CREATE TYPE position_status AS ENUM ('open', 'closing', 'closed', 'cancelled', 'error');
CREATE TYPE exit_reason_type AS ENUM ('tp', 'sl', 'trend_flip', 'panic_close', 'admin_close');
CREATE TYPE invoice_status AS ENUM ('issued', 'pending_review', 'paid', 'frozen', 'cancelled');
CREATE TYPE crypto_network AS ENUM ('TRC20', 'BEP20', 'TON');
CREATE TYPE component_health_status AS ENUM ('healthy', 'degraded', 'down');

-- ==============================================================================
-- ТАБЛИЦА 1: users_profile (Профиль пользователя и подписка)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.users_profile (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    role user_role DEFAULT 'user'::user_role NOT NULL,
    subscription_status subscription_status DEFAULT 'trial'::subscription_status NOT NULL,
    trial_start_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    trial_end_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days') NOT NULL,
    subscription_paid_until TIMESTAMPTZ,
    high_water_mark_equity NUMERIC(18, 4) DEFAULT 0.0000 NOT NULL,
    is_frozen BOOLEAN DEFAULT FALSE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ==============================================================================
-- ТАБЛИЦА 2: exchange_accounts (Подключенные API-ключи бирж)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.exchange_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
    exchange exchange_type NOT NULL,
    account_name TEXT DEFAULT 'Основной аккаунт' NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    
    -- Шифрованные учетные данные (AES-256-GCM)
    encrypted_api_key TEXT NOT NULL,
    encrypted_secret TEXT NOT NULL,
    encrypted_passphrase TEXT, -- Для OKX
    iv_nonce TEXT NOT NULL,     -- Уникальный вектор инициализации
    tag TEXT NOT NULL,          -- Auth Tag шифрования
    
    is_validated BOOLEAN DEFAULT FALSE NOT NULL,
    can_withdraw BOOLEAN DEFAULT FALSE NOT NULL, -- Должно быть строго FALSE
    can_trade_futures BOOLEAN DEFAULT FALSE NOT NULL,
    last_balance_usd NUMERIC(18, 4) DEFAULT 0.0000,
    last_error_msg TEXT,
    last_sync_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    CONSTRAINT unique_user_exchange UNIQUE (user_id, exchange)
);

-- ==============================================================================
-- ТАБЛИЦА 3: trading_settings (Настройки торгового бота пользователя)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.trading_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE UNIQUE,
    exchange_account_id UUID REFERENCES public.exchange_accounts(id) ON DELETE SET NULL,
    is_bot_active BOOLEAN DEFAULT FALSE NOT NULL,
    effective_leverage NUMERIC(4, 1) DEFAULT 7.0 NOT NULL, -- 5.0 - 10.0x
    max_allocated_margin_usd NUMERIC(18, 4), -- NULL = использовать 100% свободного депозита
    active_pairs TEXT[] DEFAULT ARRAY['ZEC/AVAX', 'ENA/SUI', 'SOL/ADA', 'BNB/ETH']::TEXT[] NOT NULL,
    take_profit_pct NUMERIC(5, 2) DEFAULT 5.00 NOT NULL,
    stop_loss_pct NUMERIC(5, 2) DEFAULT 1.50 NOT NULL,
    panic_closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ==============================================================================
-- ТАБЛИЦА 4: pair_market_data (Кэш рыночных цен и тренда от Master Engine)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.pair_market_data (
    pair_symbol TEXT PRIMARY KEY, -- 'ZEC/AVAX', 'ENA/SUI', 'SOL/ADA', 'BNB/ETH'
    long_coin TEXT NOT NULL,      -- 'ZEC'
    short_coin TEXT NOT NULL,     -- 'AVAX'
    current_ratio NUMERIC(18, 8) NOT NULL,
    ema_10 NUMERIC(18, 8) NOT NULL,
    is_in_trend BOOLEAN NOT NULL, -- ratio > ema_10
    readiness_pct NUMERIC(5, 2) DEFAULT 0.00, -- Готовность сделки к входу (0-100%)
    long_price NUMERIC(18, 8) NOT NULL,
    short_price NUMERIC(18, 8) NOT NULL,
    last_signal_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ==============================================================================
-- ТАБЛИЦА 5: bot_positions (Связки парных позиций пользователей)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.bot_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users_profile(id) ON DELETE CASCADE,
    exchange_account_id UUID REFERENCES public.exchange_accounts(id) ON DELETE CASCADE,
    pair_symbol TEXT NOT NULL,
    status position_status DEFAULT 'open'::position_status NOT NULL,
    is_master BOOLEAN DEFAULT FALSE NOT NULL,
    
    -- Метрики соотношения
    entry_ratio NUMERIC(18, 8) NOT NULL,
    current_ratio NUMERIC(18, 8),
    exit_ratio NUMERIC(18, 8),
    
    -- Нога LONG
    long_symbol TEXT NOT NULL,
    long_order_id TEXT,
    long_entry_price NUMERIC(18, 8) NOT NULL,
    long_exit_price NUMERIC(18, 8),
    long_qty NUMERIC(18, 8) NOT NULL,
    
    -- Нога SHORT
    short_symbol TEXT NOT NULL,
    short_order_id TEXT,
    short_entry_price NUMERIC(18, 8) NOT NULL,
    short_exit_price NUMERIC(18, 8),
    short_qty NUMERIC(18, 8) NOT NULL,
    
    -- Финансовые показатели
    allocated_margin_usd NUMERIC(18, 4) NOT NULL,
    total_position_volume_usd NUMERIC(18, 4) NOT NULL,
    unrealized_pnl_usd NUMERIC(18, 4) DEFAULT 0.0000,
    realized_pnl_usd NUMERIC(18, 4),
    gross_pnl_usd NUMERIC(18, 4),
    entry_fees_usd NUMERIC(18, 4) DEFAULT 0.0000,
    exit_fees_usd NUMERIC(18, 4) DEFAULT 0.0000,
    execution_mode TEXT,
    pnl_pct NUMERIC(8, 4),

    exit_reason exit_reason_type,
    opened_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ==============================================================================
-- ТАБЛИЦА 6: invoices (Биллинг: Абонплата $20/нед + 10% от чистой прибыли)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
    invoice_number TEXT UNIQUE NOT NULL, -- e.g. 'INV-2026-09-001'
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,
    
    -- Расчет платежа
    base_fee_usd NUMERIC(10, 2) DEFAULT 20.00 NOT NULL,
    profit_fee_usd NUMERIC(10, 2) DEFAULT 0.00 NOT NULL,
    total_amount_usd NUMERIC(10, 2) NOT NULL,
    
    net_profit_in_period NUMERIC(18, 4) DEFAULT 0.0000 NOT NULL,
    hwm_before NUMERIC(18, 4) NOT NULL,
    hwm_after NUMERIC(18, 4) NOT NULL,
    
    status invoice_status DEFAULT 'issued'::invoice_status NOT NULL,
    
    -- Реквизиты оплаты (полуручной режим)
    payment_network crypto_network DEFAULT 'TRC20'::crypto_network,
    payment_wallet_address TEXT NOT NULL,
    tx_hash TEXT,
    user_notes TEXT,
    
    due_date TIMESTAMPTZ NOT NULL, -- +48 часов Grace Period
    paid_at TIMESTAMPTZ,
    approved_by_admin_id UUID REFERENCES public.users_profile(id),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ==============================================================================
-- ТАБЛИЦА 7: system_health_logs (Мониторинг здоровья бирж и торгового ядра)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.system_health_logs (
    id BIGSERIAL PRIMARY KEY,
    component TEXT NOT NULL UNIQUE, -- 'binance_ws', 'okx_ws', 'bybit_ws', 'engine_daemon'
    status component_health_status NOT NULL,
    latency_ms INTEGER,
    details JSONB,
    pinged_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ==============================================================================
-- ТАБЛИЦА 8: audit_logs (Логирование критических модалок подтверждения)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
    action TEXT NOT NULL, -- 'start_bot', 'stop_bot', 'panic_close', 'delete_keys', 'logout'
    ip_address TEXT,
    user_agent TEXT,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ==============================================================================
-- ИНДЕКСЫ ДЛЯ СКОРОСТИ ЗАПРОСОВ
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_bot_positions_user_status ON public.bot_positions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_bot_positions_pair_status ON public.bot_positions(pair_symbol, status);
CREATE INDEX IF NOT EXISTS idx_invoices_user_status ON public.invoices(user_id, status);
CREATE INDEX IF NOT EXISTS idx_exchange_accounts_user ON public.exchange_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_health_component_time ON public.system_health_logs(component, pinged_at DESC);

-- ==============================================================================
-- ТРИГГЕРЫ: Автоматическое обновление updated_at
-- ==============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER 
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DO $$ 
BEGIN
    CREATE TRIGGER trg_users_profile_upd BEFORE UPDATE ON public.users_profile FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    CREATE TRIGGER trg_exchange_accounts_upd BEFORE UPDATE ON public.exchange_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    CREATE TRIGGER trg_trading_settings_upd BEFORE UPDATE ON public.trading_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    CREATE TRIGGER trg_bot_positions_upd BEFORE UPDATE ON public.bot_positions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    CREATE TRIGGER trg_invoices_upd BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ==============================================================================
-- ТРИГГЕР: Создание профиля и настроек при регистрации через Supabase Auth
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = public, pg_temp
AS $$
BEGIN
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
        COALESCE(NEW.raw_user_meta_data->>'full_name', 'Трейдер'),
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
    VALUES (
        NEW.id, 
        FALSE, 
        7.0
    )
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user error for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin, postgres, service_role;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) ПОЛИТИКИ БЕЗОПАСНОСТИ
-- ==============================================================================
ALTER TABLE public.users_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trading_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pair_market_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_health_logs ENABLE ROW LEVEL SECURITY;

-- 1. users_profile
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.users_profile
        WHERE id = auth.uid() AND role = 'admin'::public.user_role
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role, postgres;

CREATE POLICY "Users can view own profile" ON public.users_profile
    FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.users_profile
    FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.users_profile
    FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins have full access to profiles" ON public.users_profile
    FOR ALL USING (public.is_admin());

-- 2. exchange_accounts
CREATE POLICY "Users can view own exchange accounts" ON public.exchange_accounts
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own exchange accounts" ON public.exchange_accounts
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own exchange accounts" ON public.exchange_accounts
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own exchange accounts" ON public.exchange_accounts
    FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Admins have full access to exchange accounts" ON public.exchange_accounts
    FOR ALL USING (public.is_admin());

-- 3. trading_settings
CREATE POLICY "Users can view own settings" ON public.trading_settings
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own settings" ON public.trading_settings
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Admins have full access to trading settings" ON public.trading_settings
    FOR ALL USING (public.is_admin());

-- 4. bot_positions
CREATE POLICY "Users can view own positions" ON public.bot_positions
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins have full access to bot positions" ON public.bot_positions
    FOR ALL USING (public.is_admin());

-- 5. invoices
CREATE POLICY "Users can view own invoices" ON public.invoices
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can submit payment details on own invoices" ON public.invoices
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage all invoices" ON public.invoices
    FOR ALL USING (public.is_admin());

-- 6. audit_logs
CREATE POLICY "Users can view own audit logs" ON public.audit_logs
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own audit logs" ON public.audit_logs
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins have full access to audit logs" ON public.audit_logs
    FOR ALL USING (public.is_admin());

-- 7. Публичные данные рынка и здоровье (чтение доступно всем авторизованным)
CREATE POLICY "Authenticated users can read market data" ON public.pair_market_data
    FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can read health status" ON public.system_health_logs
    FOR SELECT TO authenticated USING (true);

-- ==============================================================================
-- ВКЛЮЧЕНИЕ SUPABASE REALTIME ДЛЯ ДАШБОРДА
-- ==============================================================================
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bot_positions;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trading_settings;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pair_market_data;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.invoices;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.system_health_logs;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
