import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/server';
import { createServiceSupabase } from '@/lib/supabase/service';
import { isBillingInterval, planPriceUsd } from '@/lib/plans';

const ADMIN_APTOS_WALLET = (
  process.env.ADMIN_APTOS_WALLET ||
  process.env.NEXT_PUBLIC_ADMIN_APTOS_WALLET ||
  '0xccabbae52a975c1cb682643d13b970e95997e539e5c9c9443e922ba406f401e7'
).toLowerCase();

const UNPAID_INVOICE_TTL_MS = 7 * 24 * 3600 * 1000;

/** Creates (or re-creates for another interval) the first Pro invoice for an account without a plan. */
export async function POST(request: Request) {
  try {
    const { user } = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    if (!isBillingInterval(body.interval)) {
      return NextResponse.json({ error: 'Choose a billing interval: month or year.' }, { status: 400 });
    }
    const interval = body.interval;

    const admin = createServiceSupabase();
    const { data: profile, error: profileError } = await admin
      .from('users_profile')
      .select('id, subscription_status, high_water_mark_equity')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
    }
    if (profile.subscription_status !== 'none') {
      return NextResponse.json(
        { error: 'Pro is already active. Renewal invoices are issued automatically.' },
        { status: 409 }
      );
    }

    const { data: openInvoices, error: openError } = await admin
      .from('invoices')
      .select('id, status, billing_interval')
      .eq('user_id', user.id)
      .in('status', ['issued', 'pending_review']);
    if (openError) {
      return NextResponse.json({ error: openError.message }, { status: 500 });
    }

    if ((openInvoices || []).some((inv) => inv.status === 'pending_review')) {
      return NextResponse.json(
        { error: 'A payment is already under review. Wait for confirmation.' },
        { status: 409 }
      );
    }

    const sameInterval = (openInvoices || []).find((inv) => inv.billing_interval === interval);
    if (sameInterval) {
      return NextResponse.json({ ok: true, invoiceId: sameInterval.id, reused: true });
    }

    const stale = (openInvoices || []).map((inv) => inv.id);
    if (stale.length > 0) {
      await admin.from('invoices').update({ status: 'cancelled' }).in('id', stale);
    }

    const now = new Date();
    const amount = planPriceUsd('pro', interval);
    const hwm = Number(profile.high_water_mark_equity || 0);
    const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;
    const payload = {
      user_id: user.id,
      invoice_number: invoiceNumber,
      period_start: now.toISOString(),
      period_end: now.toISOString(),
      base_fee_usd: amount,
      profit_fee_usd: 0,
      total_amount_usd: amount,
      net_profit_in_period: 0,
      hwm_before: hwm,
      hwm_after: hwm,
      status: 'issued',
      payment_wallet_address: ADMIN_APTOS_WALLET,
      due_date: new Date(now.getTime() + UNPAID_INVOICE_TTL_MS).toISOString(),
      user_notes: 'Payment network: USDT on Aptos (OKX)',
      subscription_plan: 'pro',
      billing_interval: interval,
    };

    let { data: created, error } = await admin
      .from('invoices')
      .insert({ ...payload, payment_network: 'APTOS' })
      .select('id')
      .single();
    if (error && error.message?.includes('crypto_network')) {
      const fallback = await admin
        .from('invoices')
        .insert({ ...payload, payment_network: 'TRC20' })
        .select('id')
        .single();
      created = fallback.data;
      error = fallback.error;
    }
    if (error || !created) {
      return NextResponse.json({ error: error?.message || 'Failed to create invoice.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, invoiceId: created.id, invoiceNumber });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to create invoice.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
