-- In-app notification inbox. Triggers record user-visible state changes.
-- The site translates event_type + payload. Users can read and mark rows read.
-- Inserts come from triggers (security definer) and the service role.

CREATE TABLE IF NOT EXISTS public.user_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users_profile(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK (category IN ('billing', 'trading', 'signals', 'grid', 'exchange', 'account', 'partners')),
    event_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('info', 'success', 'warning', 'critical')),
    href TEXT,
    dedupe_key TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_notifications_dedupe UNIQUE (user_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_time
    ON public.user_notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_notifications_unread
    ON public.user_notifications (user_id, created_at DESC)
    WHERE read_at IS NULL;

ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own notifications" ON public.user_notifications;
CREATE POLICY "Users read own notifications" ON public.user_notifications
    FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users mark own notifications read" ON public.user_notifications;
CREATE POLICY "Users mark own notifications read" ON public.user_notifications
    FOR UPDATE TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON public.user_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_notifications TO authenticated;
GRANT UPDATE (read_at) ON public.user_notifications TO authenticated;
GRANT ALL ON public.user_notifications TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_user_notification(
    p_user_id UUID,
    p_category TEXT,
    p_event_type TEXT,
    p_severity TEXT,
    p_href TEXT,
    p_dedupe_key TEXT,
    p_payload JSONB
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_user_id IS NULL OR p_dedupe_key IS NULL OR btrim(p_dedupe_key) = '' THEN
        RETURN;
    END IF;
    INSERT INTO public.user_notifications (
        user_id, category, event_type, severity, href, dedupe_key, payload
    ) VALUES (
        p_user_id,
        p_category,
        p_event_type,
        p_severity,
        p_href,
        p_dedupe_key,
        COALESCE(p_payload, '{}'::jsonb)
    )
    ON CONFLICT (user_id, dedupe_key) DO NOTHING;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'enqueue_user_notification failed: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_user_notification(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_user_notification(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_user_notifications_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_plan TEXT;
    v_interval TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM public.enqueue_user_notification(
            NEW.id, 'account', 'account.registered', 'success', '/dashboard',
            'account.registered:' || NEW.id::text,
            jsonb_build_object('email', NEW.email)
        );
        RETURN NEW;
    END IF;

    IF NEW.billing_notice_24h_for IS DISTINCT FROM OLD.billing_notice_24h_for
       AND NEW.billing_notice_24h_for IS NOT NULL THEN
        PERFORM public.enqueue_user_notification(
            NEW.id, 'billing', 'billing.ending_24h', 'info', '/billing',
            'billing.ending_24h:' || NEW.billing_notice_24h_for::text,
            jsonb_build_object(
                'period', CASE WHEN NEW.subscription_status::text = 'trial' THEN 'trial' ELSE 'subscription' END,
                'plan', COALESCE(NEW.pending_subscription_plan, NEW.subscription_plan, 'lite'),
                'endsAt', NEW.billing_notice_24h_for
            )
        );
    END IF;

    IF NEW.billing_notice_12h_for IS DISTINCT FROM OLD.billing_notice_12h_for
       AND NEW.billing_notice_12h_for IS NOT NULL THEN
        PERFORM public.enqueue_user_notification(
            NEW.id, 'billing', 'billing.ending_12h', 'warning', '/billing',
            'billing.ending_12h:' || NEW.billing_notice_12h_for::text,
            jsonb_build_object(
                'period', CASE WHEN NEW.subscription_status::text = 'trial' THEN 'trial' ELSE 'subscription' END,
                'plan', COALESCE(NEW.pending_subscription_plan, NEW.subscription_plan, 'lite'),
                'endsAt', NEW.billing_notice_12h_for
            )
        );
    END IF;

    IF NEW.telegram_enabled IS DISTINCT FROM OLD.telegram_enabled THEN
        PERFORM public.enqueue_user_notification(
            NEW.id,
            'account',
            CASE WHEN NEW.telegram_enabled THEN 'account.telegram_on' ELSE 'account.telegram_off' END,
            'info',
            '/settings/profile',
            'account.telegram:' || NEW.telegram_enabled::text || ':' || clock_timestamp()::text,
            '{}'::jsonb
        );
    END IF;

    IF (NEW.pending_subscription_plan IS DISTINCT FROM OLD.pending_subscription_plan
        OR NEW.pending_billing_interval IS DISTINCT FROM OLD.pending_billing_interval)
       AND NEW.pending_subscription_plan IS NOT NULL THEN
        v_plan := NEW.pending_subscription_plan;
        v_interval := COALESCE(NEW.pending_billing_interval, NEW.billing_interval, 'month');
        PERFORM public.enqueue_user_notification(
            NEW.id, 'billing', 'billing.plan_saved', 'info', '/billing',
            'billing.plan_saved:' || v_plan || ':' || v_interval || ':' || clock_timestamp()::text,
            jsonb_build_object('plan', v_plan, 'interval', v_interval)
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_notifications_profile ON public.users_profile;
CREATE TRIGGER trg_user_notifications_profile
    AFTER INSERT OR UPDATE ON public.users_profile
    FOR EACH ROW EXECUTE FUNCTION public.trg_user_notifications_profile();

CREATE OR REPLACE FUNCTION public.trg_user_notifications_invoices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_payload JSONB;
BEGIN
    v_payload := jsonb_build_object(
        'invoiceNumber', NEW.invoice_number,
        'amount', to_char(COALESCE(NEW.total_amount_usd, 0), 'FM999999990.00'),
        'plan', COALESCE(NEW.subscription_plan, 'lite'),
        'interval', COALESCE(NEW.billing_interval, 'month'),
        'dueAt', NEW.due_date
    );

    IF TG_OP = 'INSERT' AND NEW.status::text = 'issued' THEN
        PERFORM public.enqueue_user_notification(
            NEW.user_id, 'billing', 'invoice.issued', 'warning', '/billing',
            'invoice.issued:' || NEW.id::text, v_payload
        );
        RETURN NEW;
    END IF;

    IF TG_OP <> 'UPDATE' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
        RETURN NEW;
    END IF;

    IF NEW.status::text = 'pending_review' THEN
        PERFORM public.enqueue_user_notification(
            NEW.user_id, 'billing', 'invoice.submitted', 'info', '/billing',
            'invoice.submitted:' || NEW.id::text, v_payload
        );
    ELSIF NEW.status::text = 'paid' THEN
        PERFORM public.enqueue_user_notification(
            NEW.user_id, 'billing', 'invoice.paid', 'success', '/billing',
            'invoice.paid:' || NEW.id::text, v_payload
        );
    ELSIF NEW.status::text = 'frozen' THEN
        PERFORM public.enqueue_user_notification(
            NEW.user_id, 'billing', 'subscription.frozen', 'critical', '/billing',
            'subscription.frozen:' || NEW.id::text, v_payload
        );
    ELSIF OLD.status::text = 'pending_review' AND NEW.status::text = 'issued' THEN
        PERFORM public.enqueue_user_notification(
            NEW.user_id, 'billing', 'invoice.rejected', 'critical', '/billing',
            'invoice.rejected:' || NEW.id::text || ':' || clock_timestamp()::text, v_payload
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_notifications_invoices ON public.invoices;
CREATE TRIGGER trg_user_notifications_invoices
    AFTER INSERT OR UPDATE ON public.invoices
    FOR EACH ROW EXECUTE FUNCTION public.trg_user_notifications_invoices();

CREATE OR REPLACE FUNCTION public.trg_user_notifications_trading_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_exchange TEXT;
BEGIN
    IF TG_OP <> 'UPDATE' THEN
        RETURN NEW;
    END IF;

    IF NEW.is_bot_active IS DISTINCT FROM OLD.is_bot_active THEN
        PERFORM public.enqueue_user_notification(
            NEW.user_id,
            'trading',
            CASE WHEN NEW.is_bot_active THEN 'bot.started' ELSE 'bot.paused' END,
            CASE WHEN NEW.is_bot_active THEN 'success' ELSE 'info' END,
            '/dashboard',
            'bot.state:' || NEW.is_bot_active::text || ':' || clock_timestamp()::text,
            '{}'::jsonb
        );
    END IF;

    IF NEW.exchange_account_id IS DISTINCT FROM OLD.exchange_account_id
       AND OLD.exchange_account_id IS NOT NULL
       AND NEW.exchange_account_id IS NOT NULL THEN
        SELECT e.exchange::text INTO v_exchange
        FROM public.exchange_accounts e
        WHERE e.id = NEW.exchange_account_id;
        PERFORM public.enqueue_user_notification(
            NEW.user_id, 'exchange', 'exchange.primary_changed', 'info', '/settings/exchange',
            'exchange.primary:' || NEW.exchange_account_id::text,
            jsonb_build_object('exchange', upper(COALESCE(v_exchange, '')))
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_notifications_trading_settings ON public.trading_settings;
CREATE TRIGGER trg_user_notifications_trading_settings
    AFTER UPDATE ON public.trading_settings
    FOR EACH ROW EXECUTE FUNCTION public.trg_user_notifications_trading_settings();

CREATE OR REPLACE FUNCTION public.trg_user_notifications_exchange_accounts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_exchange TEXT;
    v_norm TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM public.enqueue_user_notification(
            OLD.user_id, 'exchange', 'exchange.removed', 'warning', '/settings/exchange',
            'exchange.removed:' || OLD.id::text,
            jsonb_build_object('exchange', upper(OLD.exchange::text))
        );
        RETURN OLD;
    END IF;

    v_exchange := upper(NEW.exchange::text);

    IF NEW.can_withdraw IS TRUE AND (TG_OP = 'INSERT' OR OLD.can_withdraw IS DISTINCT FROM TRUE) THEN
        PERFORM public.enqueue_user_notification(
            NEW.user_id, 'exchange', 'exchange.withdraw_blocked', 'critical', '/settings/exchange',
            'exchange.withdraw_blocked:' || NEW.id::text,
            jsonb_build_object('exchange', v_exchange)
        );
    ELSIF NEW.is_validated IS TRUE
          AND NEW.can_trade_futures IS NOT TRUE
          AND (TG_OP = 'INSERT' OR OLD.is_validated IS DISTINCT FROM TRUE OR OLD.can_trade_futures IS DISTINCT FROM NEW.can_trade_futures) THEN
        PERFORM public.enqueue_user_notification(
            NEW.user_id, 'exchange', 'exchange.futures_denied', 'critical', '/settings/exchange',
            'exchange.futures_denied:' || NEW.id::text,
            jsonb_build_object('exchange', v_exchange, 'message', COALESCE(NEW.last_error_msg, ''))
        );
    ELSIF NEW.is_validated IS TRUE
          AND NEW.can_withdraw IS NOT TRUE
          AND (TG_OP = 'INSERT' OR OLD.is_validated IS DISTINCT FROM TRUE) THEN
        PERFORM public.enqueue_user_notification(
            NEW.user_id, 'exchange', 'exchange.connected', 'success', '/settings/exchange',
            'exchange.connected:' || NEW.id::text || ':' || to_char(now() AT TIME ZONE 'utc', 'YYYYMMDD'),
            jsonb_build_object('exchange', v_exchange)
        );
    END IF;

    IF TG_OP = 'UPDATE'
       AND COALESCE(btrim(NEW.last_error_msg), '') <> ''
       AND NEW.last_error_msg IS DISTINCT FROM OLD.last_error_msg THEN
        v_norm := md5(regexp_replace(NEW.last_error_msg, '[0-9.]+', '', 'g'));
        PERFORM public.enqueue_user_notification(
            NEW.user_id, 'exchange', 'exchange.error', 'warning', '/settings/exchange',
            'exchange.error:' || NEW.id::text || ':' || v_norm || ':' || to_char(now() AT TIME ZONE 'utc', 'YYYYMMDD'),
            jsonb_build_object('exchange', v_exchange, 'message', left(NEW.last_error_msg, 500))
        );
    ELSIF TG_OP = 'UPDATE'
          AND COALESCE(btrim(NEW.last_error_msg), '') = ''
          AND COALESCE(btrim(OLD.last_error_msg), '') <> '' THEN
        PERFORM public.enqueue_user_notification(
            NEW.user_id, 'exchange', 'exchange.recovered', 'success', '/settings/exchange',
            'exchange.recovered:' || NEW.id::text || ':' || md5(OLD.last_error_msg),
            jsonb_build_object('exchange', v_exchange)
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_notifications_exchange_accounts ON public.exchange_accounts;
CREATE TRIGGER trg_user_notifications_exchange_accounts
    AFTER INSERT OR UPDATE OR DELETE ON public.exchange_accounts
    FOR EACH ROW EXECUTE FUNCTION public.trg_user_notifications_exchange_accounts();

CREATE OR REPLACE FUNCTION public.trg_user_notifications_bot_positions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_reason TEXT;
    v_severity TEXT;
BEGIN
    IF NEW.user_id IS NULL OR NEW.is_master IS TRUE THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' AND NEW.status::text = 'open' THEN
        PERFORM public.enqueue_user_notification(
            NEW.user_id, 'trading', 'trade.opened', 'success', '/dashboard',
            'trade.opened:' || NEW.id::text,
            jsonb_build_object(
                'pair', NEW.pair_symbol,
                'margin', to_char(COALESCE(NEW.allocated_margin_usd, 0), 'FM999999990.00')
            )
        );
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.status::text = 'closed'
       AND OLD.status::text IS DISTINCT FROM 'closed' THEN
        v_reason := COALESCE(NEW.exit_reason::text, 'other');
        v_severity := CASE v_reason
            WHEN 'tp' THEN 'success'
            WHEN 'panic_close' THEN 'critical'
            WHEN 'sl' THEN 'warning'
            WHEN 'admin_close' THEN 'warning'
            ELSE 'info'
        END;
        PERFORM public.enqueue_user_notification(
            NEW.user_id, 'trading', 'trade.closed', v_severity, '/pair',
            'trade.closed:' || NEW.id::text,
            jsonb_build_object(
                'pair', NEW.pair_symbol,
                'reason', v_reason,
                'pnl', to_char(COALESCE(NEW.realized_pnl_usd, 0), 'FM999999990.00'),
                'pnlPct', to_char(COALESCE(NEW.pnl_pct, 0), 'FM999990.00')
            )
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_notifications_bot_positions ON public.bot_positions;
CREATE TRIGGER trg_user_notifications_bot_positions
    AFTER INSERT OR UPDATE ON public.bot_positions
    FOR EACH ROW EXECUTE FUNCTION public.trg_user_notifications_bot_positions();

CREATE OR REPLACE FUNCTION public.trg_user_notifications_signal_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.is_enabled IS NOT TRUE THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.is_enabled IS NOT DISTINCT FROM OLD.is_enabled THEN
        RETURN NEW;
    END IF;

    PERFORM public.enqueue_user_notification(
        NEW.user_id,
        'signals',
        CASE WHEN NEW.is_enabled THEN 'signal.toggled_on' ELSE 'signal.toggled_off' END,
        'info',
        '/signals',
        'signal.toggled:' || NEW.id::text || ':' || NEW.is_enabled::text || ':' || clock_timestamp()::text,
        jsonb_build_object('strategy', NEW.strategy_id)
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_notifications_signal_settings ON public.user_signal_settings;
CREATE TRIGGER trg_user_notifications_signal_settings
    AFTER INSERT OR UPDATE ON public.user_signal_settings
    FOR EACH ROW EXECUTE FUNCTION public.trg_user_notifications_signal_settings();

CREATE OR REPLACE FUNCTION public.trg_user_notifications_signal_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.user_notifications (
        user_id, category, event_type, severity, href, dedupe_key, payload
    )
    SELECT
        settings.user_id,
        'signals',
        'signal.fired',
        'success',
        '/signals',
        'signal.fired:' || NEW.id::text,
        jsonb_build_object(
            'symbol', NEW.symbol,
            'dropPct', to_char(COALESCE(NEW.drop_pct, 0), 'FM990.00'),
            'strategy', NEW.strategy_id
        )
    FROM public.user_signal_settings AS settings
    WHERE settings.strategy_id = NEW.strategy_id
      AND settings.is_enabled IS TRUE
    ON CONFLICT (user_id, dedupe_key) DO NOTHING;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'signal.fired notification failed: %', SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_notifications_signal_events ON public.signal_events;
CREATE TRIGGER trg_user_notifications_signal_events
    AFTER INSERT ON public.signal_events
    FOR EACH ROW EXECUTE FUNCTION public.trg_user_notifications_signal_events();

CREATE OR REPLACE FUNCTION public.trg_user_notifications_signal_positions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_reason TEXT;
    v_severity TEXT;
BEGIN
    IF NEW.user_id IS NULL OR NEW.is_master IS TRUE THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' AND NEW.status::text = 'open' THEN
        PERFORM public.enqueue_user_notification(
            NEW.user_id, 'signals', 'signal.opened', 'success', '/signals',
            'signal.opened:' || NEW.id::text,
            jsonb_build_object(
                'symbol', NEW.symbol,
                'margin', to_char(COALESCE(NEW.allocated_margin_usd, 0), 'FM999999990.00'),
                'leverage', to_char(COALESCE(NEW.leverage, 0), 'FM990.0')
            )
        );
        IF COALESCE(btrim(NEW.last_error), '') <> '' THEN
            PERFORM public.enqueue_user_notification(
                NEW.user_id, 'signals', 'signal.protection_failed', 'warning', '/signals',
                'signal.protection_failed:' || NEW.id::text,
                jsonb_build_object('symbol', NEW.symbol, 'message', left(NEW.last_error, 500))
            );
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.status::text = 'error'
       AND OLD.status::text IS DISTINCT FROM 'error' THEN
        PERFORM public.enqueue_user_notification(
            NEW.user_id, 'signals', 'signal.error', 'critical', '/signals',
            'signal.error:' || NEW.id::text,
            jsonb_build_object('symbol', NEW.symbol, 'message', left(COALESCE(NEW.last_error, ''), 500))
        );
    END IF;

    IF TG_OP = 'UPDATE'
       AND NEW.status::text = 'closed'
       AND OLD.status::text IS DISTINCT FROM 'closed' THEN
        v_reason := COALESCE(NEW.exit_reason::text, 'other');
        v_severity := CASE v_reason
            WHEN 'tp' THEN 'success'
            WHEN 'panic_close' THEN 'critical'
            WHEN 'sl' THEN 'warning'
            WHEN 'admin_close' THEN 'warning'
            WHEN 'external_flat' THEN 'warning'
            ELSE 'info'
        END;
        PERFORM public.enqueue_user_notification(
            NEW.user_id, 'signals', 'signal.closed', v_severity, '/signals',
            'signal.closed:' || NEW.id::text,
            jsonb_build_object(
                'symbol', NEW.symbol,
                'reason', v_reason,
                'pnl', to_char(COALESCE(NEW.realized_pnl_usd, 0), 'FM999999990.00'),
                'pnlPct', to_char(COALESCE(NEW.pnl_pct, 0), 'FM999990.00')
            )
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_notifications_signal_positions ON public.signal_positions;
CREATE TRIGGER trg_user_notifications_signal_positions
    AFTER INSERT OR UPDATE ON public.signal_positions
    FOR EACH ROW EXECUTE FUNCTION public.trg_user_notifications_signal_positions();

CREATE OR REPLACE FUNCTION public.trg_user_notifications_grid_bots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_symbol TEXT;
    v_payload JSONB;
BEGIN
    SELECT t.base_asset INTO v_symbol
    FROM public.grid_templates t
    WHERE t.id = NEW.template_id;

    v_payload := jsonb_build_object(
        'symbol', COALESCE(v_symbol, ''),
        'exchange', upper(COALESCE(NEW.exchange, '')),
        'margin', to_char(COALESCE(NEW.margin_usdt, 0), 'FM999999990.00'),
        'pnl', CASE WHEN NEW.pnl_usdt IS NULL THEN '' ELSE to_char(NEW.pnl_usdt, 'FM999999990.00') END,
        'message', left(COALESCE(NEW.last_error, ''), 500)
    );

    IF NEW.run_status = 'running'
       AND (TG_OP = 'INSERT' OR OLD.run_status IS DISTINCT FROM 'running') THEN
        PERFORM public.enqueue_user_notification(
            NEW.user_id, 'grid', 'grid.started', 'success', '/grid',
            'grid.started:' || NEW.id::text,
            v_payload
        );
    END IF;

    IF NEW.run_status = 'stopped'
       AND (TG_OP = 'INSERT' OR OLD.run_status IS DISTINCT FROM 'stopped') THEN
        PERFORM public.enqueue_user_notification(
            NEW.user_id,
            'grid',
            CASE WHEN NEW.stop_reason = 'exchange' THEN 'grid.exchange_stopped' ELSE 'grid.stopped' END,
            CASE WHEN NEW.stop_reason = 'exchange' THEN 'critical' ELSE 'info' END,
            '/grid',
            'grid.stopped:' || NEW.id::text,
            v_payload
        );
    END IF;

    IF NEW.run_status = 'error'
       AND (TG_OP = 'INSERT' OR OLD.run_status IS DISTINCT FROM 'error') THEN
        PERFORM public.enqueue_user_notification(
            NEW.user_id, 'grid', 'grid.start_failed', 'critical', '/grid',
            'grid.start_failed:' || NEW.id::text,
            v_payload
        );
    END IF;

    IF NEW.control_status = 'released'
       AND (TG_OP = 'INSERT' OR OLD.control_status IS DISTINCT FROM 'released') THEN
        PERFORM public.enqueue_user_notification(
            NEW.user_id, 'grid', 'grid.released', 'warning', '/billing',
            'grid.released:' || NEW.id::text,
            v_payload
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_notifications_grid_bots ON public.grid_bots;
CREATE TRIGGER trg_user_notifications_grid_bots
    AFTER INSERT OR UPDATE ON public.grid_bots
    FOR EACH ROW EXECUTE FUNCTION public.trg_user_notifications_grid_bots();

CREATE OR REPLACE FUNCTION public.trg_user_notifications_grid_settings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_symbol TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    IF COALESCE(btrim(NEW.last_error), '') = '' THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.last_error IS NOT DISTINCT FROM OLD.last_error THEN
        RETURN NEW;
    END IF;

    SELECT t.base_asset INTO v_symbol
    FROM public.grid_templates t
    WHERE t.id = NEW.template_id;

    PERFORM public.enqueue_user_notification(
        NEW.user_id, 'grid', 'grid.start_failed', 'critical', '/grid',
        'grid.settings_error:' || NEW.id::text || ':' || md5(NEW.last_error),
        jsonb_build_object(
            'symbol', COALESCE(v_symbol, ''),
            'exchange', upper(COALESCE(NEW.exchange, '')),
            'message', left(NEW.last_error, 500)
        )
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_notifications_grid_settings ON public.grid_user_settings;
CREATE TRIGGER trg_user_notifications_grid_settings
    AFTER INSERT OR UPDATE ON public.grid_user_settings
    FOR EACH ROW EXECUTE FUNCTION public.trg_user_notifications_grid_settings();

CREATE OR REPLACE FUNCTION public.trg_user_notifications_referrals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.rewarded_at IS NOT NULL
       AND OLD.rewarded_at IS NULL THEN
        PERFORM public.enqueue_user_notification(
            NEW.inviter_user_id, 'partners', 'referral.rewarded', 'success', '/referrals',
            'referral.rewarded:' || NEW.id::text,
            jsonb_build_object('amount', to_char(COALESCE(NEW.reward_usd, 50), 'FM999990.00'))
        );
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_notifications_referrals ON public.referral_attributions;
CREATE TRIGGER trg_user_notifications_referrals
    AFTER UPDATE ON public.referral_attributions
    FOR EACH ROW EXECUTE FUNCTION public.trg_user_notifications_referrals();

CREATE OR REPLACE FUNCTION public.trg_user_notifications_withdrawals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event TEXT;
    v_severity TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_event := 'referral.withdrawal_requested';
        v_severity := 'info';
    ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'paid' THEN
        v_event := 'referral.withdrawal_paid';
        v_severity := 'success';
    ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'rejected' THEN
        v_event := 'referral.withdrawal_rejected';
        v_severity := 'warning';
    ELSE
        RETURN NEW;
    END IF;

    PERFORM public.enqueue_user_notification(
        NEW.user_id, 'partners', v_event, v_severity, '/referrals',
        v_event || ':' || NEW.id::text,
        jsonb_build_object(
            'amount', to_char(COALESCE(NEW.amount_usd, 0), 'FM999999990.00'),
            'network', NEW.network::text
        )
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_notifications_withdrawals ON public.referral_withdrawal_requests;
CREATE TRIGGER trg_user_notifications_withdrawals
    AFTER INSERT OR UPDATE ON public.referral_withdrawal_requests
    FOR EACH ROW EXECUTE FUNCTION public.trg_user_notifications_withdrawals();

GRANT EXECUTE ON FUNCTION public.trg_user_notifications_profile() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_user_notifications_invoices() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_user_notifications_trading_settings() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_user_notifications_exchange_accounts() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_user_notifications_bot_positions() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_user_notifications_signal_settings() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_user_notifications_signal_events() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_user_notifications_signal_positions() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_user_notifications_grid_bots() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_user_notifications_grid_settings() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_user_notifications_referrals() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_user_notifications_withdrawals() TO PUBLIC;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
