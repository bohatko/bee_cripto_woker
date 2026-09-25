import { supabase, CONFIG } from '../config.js';
import { telegramNotifier } from '../notifications/telegram.js';
import { UserProfile } from '../types/index.js';
import {
  isBillingInterval,
  isSubscriptionPlan,
  planPriceUsd,
  type BillingInterval,
  type SubscriptionPlan,
} from '../plans.js';

const HOUR_MS = 60 * 60 * 1000;

type PaymentReminderRow = {
  id: string;
  email: string | null;
  subscription_status: 'trial' | 'active';
  subscription_plan: string | null;
  billing_interval: string | null;
  pending_subscription_plan: string | null;
  pending_billing_interval: string | null;
  trial_end_at: string | null;
  subscription_paid_until: string | null;
  billing_notice_24h_for: string | null;
  billing_notice_12h_for: string | null;
};

export class BillingCronJob {
  private timer: NodeJS.Timeout | null = null;
  private intervalMs: number;

  constructor(intervalMs: number = 3600000) {
    this.intervalMs = intervalMs;
  }

  public async runAudit() {
    console.log('💳 [BILLING] Running billing audit cycle...');
    const now = new Date();

    // 1. Check expired trials (subscription_status === 'trial' and trial_end_at <= now)
    const { data: expiredTrialUsers } = await supabase
      .from('users_profile')
      .select('*, exchange_accounts(*)')
      .eq('subscription_status', 'trial')
      .lte('trial_end_at', now.toISOString());

    if (expiredTrialUsers && expiredTrialUsers.length > 0) {
      for (const u of expiredTrialUsers) {
        // Prevent duplicate invoices if user already has an issued or pending_review invoice
        const { data: openInvs } = await supabase
          .from('invoices')
          .select('id')
          .eq('user_id', u.id)
          .in('status', ['issued', 'pending_review'])
          .limit(1);

        if (!openInvs || openInvs.length === 0) {
          await this.generatePlanInvoice(u);
        }
      }
    }

    // 2. Check expired active subscriptions (subscription_status === 'active' and subscription_paid_until <= now)
    const { data: expiredActiveUsers } = await supabase
      .from('users_profile')
      .select('*, exchange_accounts(*)')
      .eq('subscription_status', 'active')
      .eq('is_frozen', false)
      .not('subscription_paid_until', 'is', null)
      .lte('subscription_paid_until', now.toISOString());

    if (expiredActiveUsers && expiredActiveUsers.length > 0) {
      for (const u of expiredActiveUsers) {
        // Prevent duplicate invoices if user already has an issued or pending_review invoice
        const { data: openInvs } = await supabase
          .from('invoices')
          .select('id')
          .eq('user_id', u.id)
          .in('status', ['issued', 'pending_review'])
          .limit(1);

        if (!openInvs || openInvs.length === 0) {
          await this.generatePlanInvoice(u);
        }
      }
    }

    // 3. Check overdue invoices and apply Variant A safe freeze
    // An invoice is overdue if status is 'issued' and due_date <= now
    const { data: overdueInvoices } = await supabase
      .from('invoices')
      .select('id, user_id, invoice_number')
      .eq('status', 'issued')
      .lte('due_date', now.toISOString());

    if (overdueInvoices && overdueInvoices.length > 0) {
      for (const inv of overdueInvoices) {
        console.warn(`❄️ [BILLING FREEZE] Invoice ${inv.invoice_number} overdue. Freezing user ${inv.user_id} (Variant A: no new entries)`);
        await supabase
          .from('users_profile')
          .update({ is_frozen: true, subscription_status: 'frozen' })
          .eq('id', inv.user_id);
        
        await supabase
          .from('invoices')
          .update({ status: 'frozen' })
          .eq('id', inv.id);
      }
    }

    await this.sendPaymentReminders(now);
  }

  private async sendPaymentReminders(now: Date) {
    const horizon = new Date(now.getTime() + 24 * HOUR_MS).toISOString();
    const [{ data: activeRows, error: activeError }, { data: trialRows, error: trialError }] = await Promise.all([
      supabase
        .from('users_profile')
        .select('id, email, subscription_status, subscription_plan, billing_interval, pending_subscription_plan, pending_billing_interval, trial_end_at, subscription_paid_until, billing_notice_24h_for, billing_notice_12h_for')
        .eq('subscription_status', 'active')
        .eq('is_frozen', false)
        .eq('telegram_enabled', true)
        .not('telegram_chat_id', 'is', null)
        .not('subscription_paid_until', 'is', null)
        .gt('subscription_paid_until', now.toISOString())
        .lte('subscription_paid_until', horizon),
      supabase
        .from('users_profile')
        .select('id, email, subscription_status, subscription_plan, billing_interval, pending_subscription_plan, pending_billing_interval, trial_end_at, subscription_paid_until, billing_notice_24h_for, billing_notice_12h_for')
        .eq('subscription_status', 'trial')
        .eq('is_frozen', false)
        .eq('telegram_enabled', true)
        .not('telegram_chat_id', 'is', null)
        .not('trial_end_at', 'is', null)
        .gt('trial_end_at', now.toISOString())
        .lte('trial_end_at', horizon),
    ]);

    if (activeError) console.error(`❌ [BILLING] Payment reminder query failed: ${activeError.message}`);
    if (trialError) console.error(`❌ [BILLING] Trial reminder query failed: ${trialError.message}`);

    const rows = [...((activeRows || []) as PaymentReminderRow[]), ...((trialRows || []) as PaymentReminderRow[])];
    for (const user of rows) {
      const endsAtIso = user.subscription_status === 'trial' ? user.trial_end_at : user.subscription_paid_until;
      if (!endsAtIso) continue;
      const remaining = new Date(endsAtIso).getTime() - now.getTime();
      if (remaining <= 0 || remaining > 24 * HOUR_MS) continue;

      const withinHours: 24 | 12 = remaining <= 12 * HOUR_MS ? 12 : 24;
      const sentFor = withinHours === 12 ? user.billing_notice_12h_for : user.billing_notice_24h_for;
      if (sentFor && new Date(sentFor).getTime() === new Date(endsAtIso).getTime()) continue;

      const plan: SubscriptionPlan = isSubscriptionPlan(user.pending_subscription_plan)
        ? user.pending_subscription_plan
        : isSubscriptionPlan(user.subscription_plan)
          ? user.subscription_plan
          : 'lite';
      const interval: BillingInterval = isBillingInterval(user.pending_billing_interval)
        ? user.pending_billing_interval
        : isBillingInterval(user.billing_interval)
          ? user.billing_interval
          : 'month';

      await telegramNotifier.notifySubscriptionEnding({
        userId: user.id,
        withinHours,
        period: user.subscription_status === 'trial' ? 'trial' : 'subscription',
        plan: plan === 'pro' ? 'Pro' : 'Lite',
        intervalLabel: interval === 'year' ? 'год' : 'месяц',
        amountUsd: planPriceUsd(plan, interval),
        endsAtIso,
      });

      const column = withinHours === 12 ? 'billing_notice_12h_for' : 'billing_notice_24h_for';
      const { error } = await supabase.from('users_profile').update({ [column]: endsAtIso }).eq('id', user.id);
      if (error) {
        console.error(`❌ [BILLING] Failed to store ${column} for ${user.email || user.id}: ${error.message}`);
        continue;
      }
      console.log(`💳 [BILLING] Sent ${withinHours}h payment reminder to ${user.email || user.id}`);
    }
  }

  private async generatePlanInvoice(user: UserProfile) {
    const periodEnd = new Date();
    const periodStart = new Date(Date.now() - 7 * 86400000);
    const dueDate = new Date(Date.now() + 48 * 3600000); // 48h Grace Period

    const plan: SubscriptionPlan = isSubscriptionPlan(user.pending_subscription_plan)
      ? user.pending_subscription_plan
      : isSubscriptionPlan(user.subscription_plan)
        ? user.subscription_plan
        : 'lite';
    const interval: BillingInterval = isBillingInterval(user.pending_billing_interval)
      ? user.pending_billing_interval
      : isBillingInterval(user.billing_interval)
        ? user.billing_interval
        : 'month';
    const baseFee = planPriceUsd(plan, interval);
    const profitFee = 0;
    const totalAmount = baseFee;
    const realizedProfit = 0;

    const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;

    const invoicePayload: Record<string, any> = {
      user_id: user.id,
      invoice_number: invoiceNumber,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      base_fee_usd: baseFee,
      profit_fee_usd: profitFee,
      total_amount_usd: totalAmount,
      net_profit_in_period: realizedProfit,
      hwm_before: user.high_water_mark_equity || 0,
      hwm_after: (user.high_water_mark_equity || 0) + Math.max(0, realizedProfit),
      status: 'issued',
      payment_wallet_address: CONFIG.adminAptosWallet,
      due_date: dueDate.toISOString(),
      user_notes: 'Payment network: USDT on Aptos (OKX)',
      subscription_plan: plan,
      billing_interval: interval,
    };

    // Defensively try inserting with payment_network: 'APTOS'.
    // If the DB enum does not include 'APTOS' yet, fall back to 'TRC20'.
    let { error } = await supabase.from('invoices').insert({
      ...invoicePayload,
      payment_network: 'APTOS',
    });

    if (error && error.message?.includes('crypto_network')) {
      const fallback = await supabase.from('invoices').insert({
        ...invoicePayload,
        payment_network: 'TRC20',
      });
      error = fallback.error;
    }

    if (!error) {
      console.log(`🧾 [INVOICE GENERATED] ${invoiceNumber} for user ${user.email} (Total: $${totalAmount.toFixed(2)} USDT on Aptos)`);
    } else {
      console.error(`❌ [INVOICE ERROR] Failed to generate invoice for ${user.email}:`, error.message);
    }
  }

  public start() {
    if (this.timer) return;
    void this.runAudit().catch((err) => console.error('Billing audit error:', err));
    this.timer = setInterval(() => {
      this.runAudit().catch((err) => console.error('Billing audit error:', err));
    }, this.intervalMs);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
