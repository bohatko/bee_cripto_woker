import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase client (service role). Bypasses RLS.
 * Never import this module into client components.
 */
export function createServiceSupabase(): SupabaseClient {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    'https://uxsbjkymrqrmlcshizns.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!key) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured.');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
