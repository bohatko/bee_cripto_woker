-- Publish LIT/USDT as an active grid coin. Existing coins stay active.

INSERT INTO public.grid_templates (
    base_asset, is_active, lower_price, upper_price, grid_count, spacing, leverage,
    stop_price, take_profit_price, direction, score, metrics
)
SELECT
    'LIT', true, 3.96, 5.63, 29, 'geometric', 2,
    3.60, 6.14, 'neutral', 1,
    '{"source":"manual","stepPct":1.2}'::jsonb
WHERE NOT EXISTS (
    SELECT 1 FROM public.grid_templates WHERE base_asset = 'LIT' AND is_active = true
);
