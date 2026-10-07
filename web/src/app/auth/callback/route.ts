import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://uxsbjkymrqrmlcshizns.supabase.co';
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4c2Jqa3ltcnFybWxjc2hpem5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NjIwMzYsImV4cCI6MjEwNDAzODAzNn0.fFBh5AsEGqHnra0IMMWnAjalpCmt3wcbVVs9UOQAPWI';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const nextParam = searchParams.get('next') || '/update-password';
  const next = nextParam.startsWith('/') ? nextParam : '/update-password';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth-code-error`);
  }

  let response = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.redirect(`${origin}${next}`);
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth-code-error`);
  }

  return response;
}
