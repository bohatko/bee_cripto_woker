-- Percent of free futures USDT margin allocated to the pair-trading basket.
-- Default 100 = current behavior (use all free margin); slot size remains 25% of that budget.
ALTER TABLE public.trading_settings
  ADD COLUMN IF NOT EXISTS pairs_balance_pct NUMERIC(5, 2) NOT NULL DEFAULT 100.00;

ALTER TABLE public.trading_settings
  DROP CONSTRAINT IF EXISTS trading_settings_pairs_balance_pct_check;

ALTER TABLE public.trading_settings
  ADD CONSTRAINT trading_settings_pairs_balance_pct_check
  CHECK (pairs_balance_pct >= 5 AND pairs_balance_pct <= 100);

COMMENT ON COLUMN public.trading_settings.pairs_balance_pct IS
  'Percent of free futures USDT margin allocated to pair-trading basket (split 25% per slot). Default 100 = use all free margin.';
