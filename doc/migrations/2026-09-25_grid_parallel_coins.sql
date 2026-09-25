-- Several grid coins can run at once. A new coin does not stop the previous ones.

DROP INDEX IF EXISTS public.grid_templates_one_active;

INSERT INTO public.grid_templates (
    base_asset, is_active, lower_price, upper_price, grid_count, spacing, leverage,
    stop_price, take_profit_price, direction, score, metrics
)
SELECT
    'BNB', true, 740, 810, 15, 'geometric', 2,
    725, 825, 'neutral', 1,
    '{"lastPrice":773,"netReturnPct":5.4,"efficiency":0.19,"rangePos":0.45,"avgDailyRangePct":3.5,"widthPct":9.7}'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM public.grid_templates WHERE base_asset = 'BNB' AND is_active = true
);
