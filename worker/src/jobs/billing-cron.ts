import { supabase, CONFIG } from '../config.js';
import { UserProfile } from '../types/index.js';

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
          await this.generateWeeklyInvoice(u);
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
          await this.generateWeeklyInvoice(u);
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

  private async generateWeeklyInvoice(user: UserProfile) {
    const periodEnd = new Date();
    const periodStart = new Date(Date.now() - 7 * 86400000);
    const dueDate = new Date(Date.now() + 48 * 3600000); // 48h Grace Period

    // Calculate realized PnL in the last 7 days
    const { data: closedPositions } = await supabase
      .from('bot_positions')
      .select('realized_pnl_usd, long_order_id, short_order_id')
      .eq('user_id', user.id)
      .eq('status', 'closed')
      .gte('closed_at', periodStart.toISOString());

    const realizedProfit = (closedPositions || [])
      .filter((p) => {
        const longId = String(p.long_order_id || '');
        const shortId = String(p.short_order_id || '');
        return !longId.startsWith('sim-') && !shortId.startsWith('sim-');
      })
      .reduce((sum, p) => sum + (Number(p.realized_pnl_usd) || 0), 0);

    const baseFee = 20.0;
    // Flat weekly subscription only: no performance / profit share fee.
    const profitFee = 0;
    const totalAmount = baseFee;

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
