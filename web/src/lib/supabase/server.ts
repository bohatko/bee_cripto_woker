import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://uxsbjkymrqrmlcshizns.supabase.co';
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4c2Jqa3ltcnFybWxjc2hpem5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NjIwMzYsImV4cCI6MjEwNDAzODAzNn0.fFBh5AsEGqHnra0IMMWnAjalpCmt3wcbVVs9UOQAPWI';

export async function getAuthenticatedUser(request: Request) {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.replace(/^Bearer\s+/i, '');

  if (token) {
    const client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const {
      data: { user },
      error,
    } = await client.auth.getUser(token);
    if (!error && user) {
      return { user, supabase: client };
    }
  }

  // Fallback to cookie check via @supabase/ssr
  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    const cookieClient = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return parseCookieHeader(cookieHeader);
        },
        setAll() {},
      },
    });
    const {
      data: { user },
      error,
    } = await cookieClient.auth.getUser();
    if (!error && user) {
      return { user, supabase: cookieClient };
    }
  }

  return { user: null, supabase: null };
}
