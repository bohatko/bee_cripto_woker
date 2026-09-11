-- Migration: Add funding fee tracking column to bot_positions (2026-09-04)
-- Tracks funding paid/received while a position was open. Positive = cost to user, negative = rebate.
-- Idempotent: safe to re-run.

ALTER TABLE public.bot_positions
  ADD COLUMN IF NOT EXISTS funding_fees_usd NUMERIC(18, 4) DEFAULT 0.0000;
