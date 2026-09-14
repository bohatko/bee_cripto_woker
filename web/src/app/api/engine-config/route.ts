import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/server';

/**
 * Authenticated (any user) proxy to worker /internal/config.
 * Exposes only non-secret engine risk parameters for dashboard UI.
 */
export async function GET(request: Request) {
  const { user } = await getAuthenticatedUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const baseUrl = (
    process.env.WORKER_INTERNAL_URL ||
    'https://bee-crypto-worker-production.up.railway.app'
  )
    .trim()
    .replace(/\/$/, '');

  try {
    const res = await fetch(`${baseUrl}/internal/config`, {
      method: 'GET',
      cache: 'no-store',
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: payload?.error || 'Worker request failed' },
        { status: res.status }
      );
    }

    return NextResponse.json({
      defaultLeverage: Number(payload.defaultLeverage ?? 3),
      maxLeverage: Number(payload.maxLeverage ?? 3),
      tpDisabled: Boolean(payload.tpDisabled),
      takeProfitPct: Number(payload.takeProfitPct ?? 4.5),
      stopLossPct: Number(payload.stopLossPct ?? 2.5),
      slAtrMult: Number(payload.slAtrMult ?? 1.5),
      slMaxMarginPct: Number(payload.slMaxMarginPct ?? 10),
      entryOn4hCloseOnly: Boolean(payload.entryOn4hCloseOnly),
    });
  } catch (err: any) {
    return NextResponse.json({
      defaultLeverage: 3,
      maxLeverage: 3,
      tpDisabled: true,
      takeProfitPct: 4.5,
      stopLossPct: 2.5,
      slAtrMult: 1.5,
      slMaxMarginPct: 10,
      entryOn4hCloseOnly: true,
      warning: err?.message || 'Worker unreachable — using Scenario C defaults',
    });
  }
}
