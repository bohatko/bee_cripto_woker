import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { hasProModules } from '@/lib/pro-access';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://uxsbjkymrqrmlcshizns.supabase.co';
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4c2Jqa3ltcnFybWxjc2hpem5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NjIwMzYsImV4cCI6MjEwNDAzODAzNn0.fFBh5AsEGqHnra0IMMWnAjalpCmt3wcbVVs9UOQAPWI';

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const isProtectedPath =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/billing') ||
    pathname.startsWith('/signals') ||
    pathname.startsWith('/history') ||
    pathname.startsWith('/grid') ||
    pathname.startsWith('/settings') ||
    pathname.startsWith('/admin');

  if (isProtectedPath && !user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const isAuthPath = pathname === '/login' || pathname === '/register';
  if (isAuthPath && user) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  const isProSection = pathname.startsWith('/grid') || pathname.startsWith('/history');
  if (user && isProSection) {
    const { data: profile, error } = await supabase
      .from('users_profile')
      .select('subscription_plan, subscription_status, is_frozen')
      .eq('id', user.id)
      .maybeSingle();

    if (!error && !hasProModules(profile)) {
      return NextResponse.redirect(new URL('/billing', request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/billing/:path*',
    '/signals/:path*',
    '/history',
    '/history/:path*',
    '/grid',
    '/grid/:path*',
    '/settings/:path*',
    '/admin/:path*',
    '/login',
    '/register',
  ],
};
