-- Migration: Add actual fill and fee tracking columns to bot_positions (2026-09-04)
-- Adds gross_pnl_usd, entry_fees_usd, exit_fees_usd and execution_mode.
-- Idempotent: safe to re-run.

ALTER TABLE public.bot_positions
  ADD COLUMN IF NOT EXISTS gross_pnl_usd NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS entry_fees_usd NUMERIC(18, 4) DEFAULT 0.0000,
  ADD COLUMN IF NOT EXISTS exit_fees_usd NUMERIC(18, 4) DEFAULT 0.0000,
  ADD COLUMN IF NOT EXISTS execution_mode TEXT;
