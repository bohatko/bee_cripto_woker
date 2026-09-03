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

    // 1. Check expired trials
    const { data: usersToCharge } = await supabase
      .from('users_profile')
      .select('*, exchange_accounts(*)')
      .eq('subscription_status', 'trial')
      .lte('trial_end_at', now.toISOString());

    if (usersToCharge && usersToCharge.length > 0) {
      for (const u of usersToCharge) {
        await this.generateWeeklyInvoice(u);
      }
    }

    // 2. Check overdue invoices and apply Variant A safe freeze
    const { data: overdueInvoices } = await supabase
      .from('invoices')
      .select('id, user_id')
      .eq('status', 'issued')
      .lte('due_date', now.toISOString());

    if (overdueInvoices && overdueInvoices.length > 0) {
      for (const inv of overdueInvoices) {
        console.warn(`❄️ [BILLING FREEZE] Invoice ${inv.id} overdue. Freezing user ${inv.user_id} (Variant A: no new entries)`);
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
      .select('realized_pnl_usd')
      .eq('user_id', user.id)
      .eq('status', 'closed')
      .gte('closed_at', periodStart.toISOString());

    const realizedProfit = (closedPositions || []).reduce(
      (sum, p) => sum + (Number(p.realized_pnl_usd) || 0),
      0
    );

    const baseFee = 20.0;
    // 10% fee on net profit above HWM
    const profitFee = realizedProfit > 0 ? Number((realizedProfit * 0.10).toFixed(2)) : 0;
    const totalAmount = baseFee + profitFee;

    const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;

    const { error } = await supabase.from('invoices').insert({
      user_id: user.id,
      invoice_number: invoiceNumber,
      period_start: periodStart.toISOString(),
      period_end: periodEnd.toISOString(),
      base_fee_usd: baseFee,
      profit_fee_usd: profitFee,
      total_amount_usd: totalAmount,
      net_profit_in_period: realizedProfit,
      hwm_before: user.high_water_mark_equity,
      hwm_after: user.high_water_mark_equity + Math.max(0, realizedProfit),
      status: 'issued',
      payment_network: 'TRC20',
      payment_wallet_address: CONFIG.adminTrc20Wallet,
      due_date: dueDate.toISOString(),
    });

    if (!error) {
      console.log(`🧾 [INVOICE GENERATED] ${invoiceNumber} for user ${user.email} (Total: $${totalAmount.toFixed(2)})`);
      // Update subscription status to active waiting for payment
      await supabase
        .from('users_profile')
        .update({ subscription_status: 'active' })
        .eq('id', user.id);
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
