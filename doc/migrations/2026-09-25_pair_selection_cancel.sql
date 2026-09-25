-- ==============================================================================
-- MIGRATION: cancel an in-progress pair selection run from the admin UI
-- Date: 2026-09-25
-- ==============================================================================
ALTER TABLE public.pair_selection_runs
  ADD COLUMN IF NOT EXISTS cancel_requested BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.pair_selection_runs
  DROP CONSTRAINT IF EXISTS pair_selection_runs_status_check;

ALTER TABLE public.pair_selection_runs
  ADD CONSTRAINT pair_selection_runs_status_check
  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled'));

COMMENT ON COLUMN public.pair_selection_runs.cancel_requested IS
  'Set by an admin Stop action. The worker aborts the run at the next checkpoint and does not apply basket changes.';

CREATE OR REPLACE FUNCTION public.pair_selection_runs_keep_cancelled()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled' THEN
    NEW.status := 'cancelled';
    NEW.finished_at := COALESCE(OLD.finished_at, NEW.finished_at, now());
    NEW.error := COALESCE(OLD.error, 'Cancelled by admin');
    NEW.applied := FALSE;
    NEW.cancel_requested := TRUE;
  ELSIF COALESCE(OLD.cancel_requested, FALSE) IS TRUE AND NEW.status = 'completed' THEN
    NEW.status := 'cancelled';
    NEW.finished_at := COALESCE(NEW.finished_at, now());
    NEW.error := COALESCE(NULLIF(NEW.error, ''), 'Cancelled by admin');
    NEW.applied := FALSE;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pair_selection_runs_keep_cancelled ON public.pair_selection_runs;
CREATE TRIGGER trg_pair_selection_runs_keep_cancelled
  BEFORE UPDATE ON public.pair_selection_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.pair_selection_runs_keep_cancelled();
