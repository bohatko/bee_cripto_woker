import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/supabase/server';
import { createServiceSupabase } from '@/lib/supabase/service';
import {
  normalizeAddress,
  normalizeTxHash,
  usdToUsdtMicro,
  verifyAptosUsdtTransfer,
} from '@/lib/aptos-usdt';
import { isBillingInterval, isSubscriptionPlan } from '@/lib/plans';

const ADMIN_APTOS_WALLET = (
  process.env.ADMIN_APTOS_WALLET ||
  process.env.NEXT_PUBLIC_ADMIN_APTOS_WALLET ||
  '0xccabbae52a975c1cb682643d13b970e95997e539e5c9c9443e922ba406f401e7'
).toLowerCase();

function addInterval(base: Date, interval: string | null): Date {
  const next = new Date(base);
  if (interval === 'year') next.setUTCMonth(next.getUTCMonth() + 12);
  else if (interval === 'month') next.setUTCMonth(next.getUTCMonth() + 1);
  else next.setUTCDate(next.getUTCDate() + 7);
  return next;
}

export async function POST(request: Request) {
  try {
    const { user } = await getAuthenticatedUser(request);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized. Please sign in.' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const invoiceId = typeof body.invoiceId === 'string' ? body.invoiceId : '';
    const txHashRaw = typeof body.txHash === 'string' ? body.txHash.trim() : '';
    const paymentMethod = body.paymentMethod === 'okx' ? 'okx' : 'aptos';
    if (!invoiceId || !txHashRaw) {
      return NextResponse.json({ error: 'Invoice and transaction hash are required.' }, { status: 400 });
    }

    const admin = createServiceSupabase();
    const { data: invoice, error: invoiceError } = await admin
      .from('invoices')
      .select(
        'id, user_id, invoice_number, status, total_amount_usd, subscription_plan, billing_interval, payment_wallet_address, hwm_after'
      )
      .eq('id', invoiceId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (invoiceError) {
      return NextResponse.json({ error: invoiceError.message }, { status: 500 });
    }
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
    }
    if (!['issued', 'pending_review', 'frozen'].includes(invoice.status)) {
      return NextResponse.json({ error: 'This invoice is not awaiting payment.' }, { status: 409 });
    }

    const { data: profile } = await admin
      .from('users_profile')
      .select('external_uid, subscription_paid_until')
      .eq('id', user.id)
      .maybeSingle();

    const beeId = profile?.external_uid || 'n/a';
    const note =
      paymentMethod === 'okx'
        ? `Paid via OKX internal transfer | Bee ID: ${beeId}`
        : `Paid via USDT (Aptos) | Bee ID: ${beeId}`;

    const hash = normalizeTxHash(txHashRaw);
    if (!hash) {
      await admin
        .from('invoices')
        .update({
          tx_hash: txHashRaw,
          status: 'pending_review',
          user_notes: `${note} | Manual review: hash is not an Aptos transaction.`,
        })
        .eq('id', invoice.id);
      return NextResponse.json({ code: 'pending_manual' });
    }

    const { data: reused } = await admin
      .from('invoices')
      .select('id')
      .eq('tx_hash', hash)
      .neq('id', invoice.id)
      .limit(1);
    if (reused && reused.length > 0) {
      return NextResponse.json({ code: 'already_used' }, { status: 409 });
    }

    const verified = await verifyAptosUsdtTransfer(hash);
    if (verified.code !== 'ok') {
      return NextResponse.json({ code: verified.code }, { status: 422 });
    }

    const expectedWallet = normalizeAddress(invoice.payment_wallet_address || ADMIN_APTOS_WALLET);
    const allowedWallets = new Set([expectedWallet, ADMIN_APTOS_WALLET]);
    if (!allowedWallets.has(verified.transfer.recipient)) {
      return NextResponse.json({ code: 'wrong_recipient' }, { status: 422 });
    }

    const expectedMicro = usdToUsdtMicro(Number(invoice.total_amount_usd));
    const chainUsd = verified.transfer.amountUsd;
    const invoiceUsd = Number(invoice.total_amount_usd);
    if (verified.transfer.amountMicro !== expectedMicro) {
      await admin
        .from('invoices')
        .update({
          tx_hash: hash,
          status: 'pending_review',
          payment_network: 'APTOS',
          user_notes: `${note} | Chain amount ${chainUsd.toFixed(2)} USDT does not match invoice ${invoiceUsd.toFixed(2)} USDT.`,
        })
        .eq('id', invoice.id);
      return NextResponse.json({
        code: 'amount_mismatch',
        chainAmount: chainUsd,
        invoiceAmount: invoiceUsd,
      });
    }

    const plan = invoice.subscription_plan;
    const interval = invoice.billing_interval;
    if (!isSubscriptionPlan(plan) || !isBillingInterval(interval)) {
      await admin
        .from('invoices')
        .update({
          tx_hash: hash,
          status: 'pending_review',
          payment_network: 'APTOS',
          user_notes: `${note} | Chain amount matches, but the invoice has no plan. Manual review required.`,
        })
        .eq('id', invoice.id);
      return NextResponse.json({ code: 'no_plan', chainAmount: chainUsd, invoiceAmount: invoiceUsd });
    }

    const now = new Date();
    const currentPaidUntil = profile?.subscription_paid_until
      ? new Date(profile.subscription_paid_until)
      : null;
    const base =
      currentPaidUntil && currentPaidUntil.getTime() > now.getTime() ? currentPaidUntil : now;
    const paidUntil = addInterval(base, interval);

    const { error: payError } = await admin
      .from('invoices')
      .update({
        tx_hash: hash,
        status: 'paid',
        paid_at: now.toISOString(),
        payment_network: 'APTOS',
        user_notes: `${note} | Verified on Aptos: ${chainUsd.toFixed(2)} USDT.`,
      })
      .eq('id', invoice.id);
    if (payError) {
      return NextResponse.json({ error: payError.message }, { status: 500 });
    }

    const profileUpdate: Record<string, unknown> = {
      subscription_status: 'active',
      is_frozen: false,
      subscription_paid_until: paidUntil.toISOString(),
      subscription_plan: plan,
      billing_interval: interval,
      pending_subscription_plan: null,
      pending_billing_interval: null,
      high_water_mark_equity: invoice.hwm_after || 0,
    };
    const { error: profileError } = await admin
      .from('users_profile')
      .update(profileUpdate)
      .eq('id', user.id);
    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 500 });
    }

    if (plan === 'lite') {
      await admin.from('trading_settings').update({ is_bot_active: false }).eq('user_id', user.id);
    }

    return NextResponse.json({
      code: 'paid',
      chainAmount: chainUsd,
      paidUntil: paidUntil.toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Payment check failed.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
