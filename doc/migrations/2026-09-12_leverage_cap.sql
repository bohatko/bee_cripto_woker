UPDATE public.trading_settings
SET effective_leverage = LEAST(effective_leverage, 3.0)
WHERE effective_leverage > 3.0;
