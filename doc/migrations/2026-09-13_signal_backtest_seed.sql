-- Signal leverage precision for research configs (2.25x / 1.75x)
ALTER TABLE public.signal_positions
  ALTER COLUMN leverage TYPE NUMERIC(5, 2);

ALTER TABLE public.signal_strategies
  ALTER COLUMN leverage TYPE NUMERIC(5, 2);

UPDATE public.signal_strategies SET leverage = 2.25 WHERE id = 'xrp_dip_buy_v1';
UPDATE public.signal_strategies SET leverage = 1.75 WHERE id = 'eth_dip_buy_v1';
UPDATE public.signal_strategies SET leverage = 3.00 WHERE id = 'btc_dip_buy_v1';

UPDATE public.signal_strategies
SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{reference_margin_usd}', '10000'::jsonb)
WHERE id IN ('xrp_dip_buy_v1', 'eth_dip_buy_v1', 'btc_dip_buy_v1');
