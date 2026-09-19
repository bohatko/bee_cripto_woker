-- Migration: Add APTOS to crypto_network enum and register OKX Aptos deposit address
-- Apply: Supabase SQL Editor (project uxsbjkymrqrmlcshizns)

-- 1. Add APTOS to crypto_network enum
ALTER TYPE public.crypto_network ADD VALUE IF NOT EXISTS 'APTOS';

-- 2. Update existing issued invoices to the official OKX Aptos USDT wallet
UPDATE public.invoices
SET 
  payment_wallet_address = '0xccabbae52a975c1cb682643d13b970e95997e539e5c9c9443e922ba406f401e7',
  user_notes = COALESCE(user_notes, '') || ' [Network: USDT on Aptos (OKX)]'
WHERE status IN ('issued', 'frozen')
  AND (payment_wallet_address LIKE '%Fake%' OR payment_wallet_address IS NULL);
