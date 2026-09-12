import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { user, supabase } = await getAuthenticatedUser(request);
  if (!user || !supabase) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('users_profile')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const baseUrl = (process.env.WORKER_INTERNAL_URL || '').trim().replace(/\/$/, '');
  const secret = (process.env.WORKER_INTERNAL_SECRET || process.env.INTERNAL_API_SECRET || '').trim();
  if (!baseUrl || !secret) {
    return NextResponse.json({ error: 'Worker internal API is not configured' }, { status: 500 });
  }

  try {
    const res = await fetch(`${baseUrl}/internal/config`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: payload?.error || 'Worker request failed' }, { status: res.status });
    }
    return NextResponse.json(payload);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Worker unreachable' }, { status: 502 });
  }
}
