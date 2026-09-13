-- Add BTC Dip-Buy 7m signal strategy
INSERT INTO public.signal_strategies (
    id,
    name,
    symbol,
    side,
    leverage,
    config,
    is_enabled,
    live_state
)
VALUES (
    'btc_dip_buy_v1',
    'BTC Dip-Buy 7m',
    'BTC',
    'long',
    3.0,
    '{"drop_pct": 3, "window_minutes": 7, "tp_pct": 3, "sl_pct": 12, "reference_margin_usd": 20000}'::jsonb,
    true,
    '{
        "price": 0,
        "rolling_max": 0,
        "drop_pct": 0,
        "readiness_pct": 0,
        "state": "flat",
        "updated_at": null,
        "alerted_thresholds": []
    }'::jsonb
)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    symbol = EXCLUDED.symbol,
    side = EXCLUDED.side,
    leverage = EXCLUDED.leverage,
    config = EXCLUDED.config,
    is_enabled = EXCLUDED.is_enabled;
