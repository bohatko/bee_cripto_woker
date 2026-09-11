-- Migration: Add exit order id columns for future fee reconciliation (2026-09-04)
-- Stores the exchange order id(s) used to close each leg (comma-joined for multi-order exits).
-- Idempotent: safe to re-run.

ALTER TABLE public.bot_positions
  ADD COLUMN IF NOT EXISTS long_exit_order_id TEXT,
  ADD COLUMN IF NOT EXISTS short_exit_order_id TEXT;
