import { supabase, CONFIG } from '../config.js';
import { UserProfile } from '../types/index.js';
import {
  isBillingInterval,
  isSubscriptionPlan,
  planPriceUsd,
  type BillingInterval,
  type SubscriptionPlan,
} from '../plans.js';

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
