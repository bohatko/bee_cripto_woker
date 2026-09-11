-- Fix: admin UI upsert/delete on pair_market_data was blocked by RLS (SELECT-only).
-- Worker already writes via service_role. This allows admins to sync basket placeholders.

DROP POLICY IF EXISTS "Admins have full access to market data" ON public.pair_market_data;

CREATE POLICY "Admins have full access to market data"
  ON public.pair_market_data
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
