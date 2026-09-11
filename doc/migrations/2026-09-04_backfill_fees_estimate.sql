-- Fallback only; prefer scripts/backfill-fees.ts
-- Backfill: Estimate fees for already-closed live positions recorded before fee tracking.
-- Scope: closed user positions (not master, not simulated) with no recorded fees and no gross_pnl.
-- Sets gross = old realized, estimates entry/exit taker fees (0.055% of total volume per side),
-- then recomputes realized_pnl and pnl_pct net of fees. Idempotent because gross_pnl_usd IS NULL guard.

-- DRY-RUN preview (uncomment to inspect rows that would be affected):
-- SELECT id, pair_symbol, realized_pnl_usd, total_position_volume_usd, allocated_margin_usd
-- FROM public.bot_positions
-- WHERE status = 'closed'
--   AND is_master = FALSE
--   AND COALESCE(entry_fees_usd, 0) = 0
--   AND COALESCE(exit_fees_usd, 0) = 0
--   AND gross_pnl_usd IS NULL
--   AND long_order_id NOT LIKE 'sim-%';

UPDATE public.bot_positions
SET
  gross_pnl_usd = realized_pnl_usd,
  entry_fees_usd = total_position_volume_usd * 0.00055,
  exit_fees_usd = total_position_volume_usd * 0.00055,
  funding_fees_usd = 0,
  realized_pnl_usd = realized_pnl_usd
                     - (total_position_volume_usd * 0.00055)
                     - (total_position_volume_usd * 0.00055),
  pnl_pct = ((realized_pnl_usd
              - (total_position_volume_usd * 0.00055)
              - (total_position_volume_usd * 0.00055)) / NULLIF(allocated_margin_usd, 0)) * 100,
  execution_mode = 'market'
WHERE status = 'closed'
  AND is_master = FALSE
  AND COALESCE(entry_fees_usd, 0) = 0
  AND COALESCE(exit_fees_usd, 0) = 0
  AND gross_pnl_usd IS NULL
  AND long_order_id NOT LIKE 'sim-%';
