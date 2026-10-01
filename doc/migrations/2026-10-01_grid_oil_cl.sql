-- Publish CL/USDT (WTI crude oil perpetual, Bybit only) as an active grid coin.
-- Parameters come from research/grid_oil (15m CLUSDT, 83 days, 2x leverage):
-- range ±8% around 91.15, ~1.33% geometric step, stop 7% under the lower bound.
-- Bybit-only is enforced in worker/src/grid/prices.ts (BYBIT_ONLY_ASSETS) and the /grid form.

INSERT INTO public.grid_templates (
    base_asset, is_active, lower_price, upper_price, grid_count, spacing, leverage,
    stop_price, take_profit_price, direction, score, metrics
)
SELECT
    'CL', true, 84.00, 98.50, 12, 'geometric', 2,
    78.00, 101.50, 'neutral', 1,
    '{"source":"manual","exchangeOnly":"bybit","stepPct":1.33,"avgDailyRangePct":4.1,"minMarginUsdt":40}'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM public.grid_templates WHERE base_asset = 'CL' AND is_active = true
);
