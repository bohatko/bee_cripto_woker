-- Per-user Telegram notification settings on users_profile.
-- Bot token is stored AES-256-GCM encrypted (iv:tag:ciphertext), same as exchange API keys.
ALTER TABLE public.users_profile
  ADD COLUMN IF NOT EXISTS telegram_bot_token_enc TEXT,
  ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT,
  ADD COLUMN IF NOT EXISTS telegram_enabled BOOLEAN NOT NULL DEFAULT false;
