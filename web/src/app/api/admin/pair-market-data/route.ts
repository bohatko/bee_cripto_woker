import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/server';
import { createServiceSupabase } from '@/lib/supabase/service';

async function requireAdmin(request: Request) {
  const { user, supabase } = await getAuthenticatedUser(request);
  if (!user || !supabase) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const { data: profile } = await supabase
    .from('users_profile')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profile?.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { user, supabase };
}

/**
 * Admin-only: upsert/delete pair_market_data via service role.
 * Browser clients cannot write this table (RLS is SELECT-only for authenticated).
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin(request);
    if ('error' in auth && auth.error) return auth.error;

    const body = await request.json();
    const action = body?.action as string;
    const service = createServiceSupabase();

    if (action === 'upsert') {
      const row = body?.row;
      if (!row?.pair_symbol || !row?.long_coin || !row?.short_coin) {
        return NextResponse.json(
          { error: 'row.pair_symbol, long_coin, and short_coin are required.' },
          { status: 400 }
        );
      }

      const { error } = await service.from('pair_market_data').upsert(
        {
          pair_symbol: row.pair_symbol,
          long_coin: row.long_coin,
          short_coin: row.short_coin,
          current_ratio: Number(row.current_ratio) || 0,
          ema_10: Number(row.ema_10) || 0,
          is_in_trend: Boolean(row.is_in_trend),
          long_price: Number(row.long_price) || 0,
          short_price: Number(row.short_price) || 0,
          updated_at: row.updated_at || new Date().toISOString(),
        },
        { onConflict: 'pair_symbol' }
      );

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    if (action === 'delete') {
      const pairSymbol = typeof body?.pair_symbol === 'string' ? body.pair_symbol.trim() : '';
      if (!pairSymbol) {
        return NextResponse.json({ error: 'pair_symbol is required.' }, { status: 400 });
      }

      const { error } = await service.from('pair_market_data').delete().eq('pair_symbol', pairSymbol);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
