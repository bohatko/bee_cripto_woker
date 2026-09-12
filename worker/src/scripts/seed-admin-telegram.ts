/**
 * One-time seed: migrate TELEGRAM_* from .env onto bohatkovictor@gmail.com profile.
 * Does not print the token. Safe to re-run (overwrites that user's telegram fields).
 *
 * Usage: npx tsx src/scripts/seed-admin-telegram.ts
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { encryptPayload } from '../security/encryption.js';

const ADMIN_EMAIL = 'bohatkovictor@gmail.com';

async function main() {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID || '').trim();
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

  if (!token || !chatId) {
    console.error('TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required in env for seed.');
    process.exit(1);
  }
  if (!supabaseUrl || !supabaseKey) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
    process.exit(1);
  }

  const encrypted = encryptPayload(token);
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from('users_profile')
    .update({
      telegram_bot_token_enc: encrypted,
      telegram_chat_id: chatId,
      telegram_enabled: true,
    })
    .eq('email', ADMIN_EMAIL)
    .select('id, email, telegram_enabled, telegram_chat_id')
    .maybeSingle();

  if (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  }
  if (!data) {
    console.error(`User ${ADMIN_EMAIL} not found.`);
    process.exit(1);
  }

  console.log(
    `Seeded Telegram for ${data.email} (chat_ids configured, enabled=${data.telegram_enabled}). Token not logged.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
