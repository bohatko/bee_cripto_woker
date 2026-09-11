-- ==============================================================================
-- MIGRATION: pair_selection_runs.progress_log for live admin tracing
-- Date: 2026-09-07
-- ==============================================================================
ALTER TABLE public.pair_selection_runs
  ADD COLUMN IF NOT EXISTS progress_log JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.pair_selection_runs.progress_log IS
  'Ordered list of {at, stage, message, detail?} steps written by PairSelectionJob for live admin tracing.';
