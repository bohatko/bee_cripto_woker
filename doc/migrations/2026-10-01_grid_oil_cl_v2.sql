-- CL/USDT grid v2: parameters from research/grid_oil/optimize.py (walk-forward, taker fees, funding).
-- * 11 cells (~1.45% geometric step) instead of 12.
-- * Stop is computed by the worker at launch as lower bound - 3 x daily ATR(14); stop_price 78.00 is only a fallback.
-- * Take profit pushed far above the range (effectively disabled; the column is NOT NULL and must exceed the upper bound).
-- * Recommended minimum margin raised to 100 USDT.
-- The params_hash trigger recomputes automatically; running bots are not restarted.

UPDATE public.grid_templates
SET grid_count = 11,
    stop_price = 78.00,
    take_profit_price = 120.00,
    metrics = '{"source":"optimize.py","exchangeOnly":"bybit","stepPct":1.45,"avgDailyRangePct":4.1,"minMarginUsdt":100,"stopAtrMult":3,"takeProfit":"disabled"}'::jsonb
WHERE base_asset = 'CL' AND is_active = true;
