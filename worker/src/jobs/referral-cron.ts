import { supabase } from '../config.js';

type ReferralRelationship = {
  id: string;
  invitee_user_id: string;
  activated_at?: string | null;
};

type ClosedPosition = {
  realized_pnl_usd: number | string | null;
  long_order_id?: string | null;
  short_order_id?: string | null;
};

/**
 * Activates referrals after an invitee connects a funded, validated futures account
 * and credits 10% of the invitee's positive realised weekly PnL to the referrer's
 * internal referral wallet. The database RPC owns the idempotency guarantee.
 */
export class ReferralCronJob {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly intervalMs: number = 3_600_000) {}

  public async runAudit(): Promise<void> {
    await this.activateFundedReferrals();

    const { periodStart, periodEnd } = this.getPreviousCompletedUtcWeek();
    await this.creditCompletedWeek(periodStart, periodEnd);
  }

  private getPreviousCompletedUtcWeek(): { periodStart: Date; periodEnd: Date } {
    const now = new Date();
    const currentWeekStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
    );
    const daysSinceMonday = (currentWeekStart.getUTCDay() + 6) % 7;
    currentWeekStart.setUTCDate(currentWeekStart.getUTCDate() - daysSinceMonday);

    const periodEnd = currentWeekStart;
    const periodStart = new Date(periodEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { periodStart, periodEnd };
  }

  private async activateFundedReferrals(): Promise<void> {
    const { data: inactiveRelationships, error } = await supabase
      .from('referral_relationships')
      .select('id, invitee_user_id')
      .is('activated_at', null);

    if (error) {
      console.error(`[REFERRALS] Failed to load inactive referrals: ${error.message}`);
      return;
    }

    const relationships = (inactiveRelationships || []) as ReferralRelationship[];
    if (relationships.length === 0) return;

    const inviteeIds = relationships.map((relationship) => relationship.invitee_user_id);
    const { data: accounts, error: accountsError } = await supabase
      .from('exchange_accounts')
      .select('user_id, is_active, is_validated, can_trade_futures, can_withdraw, last_balance_usd')
      .in('user_id', inviteeIds)
      .eq('is_active', true)
      .eq('is_validated', true)
      .eq('can_trade_futures', true)
      .eq('can_withdraw', false);

    if (accountsError) {
      console.error(`[REFERRALS] Failed to check funded accounts: ${accountsError.message}`);
      return;
    }

    const fundedUserIds = new Set(
      (accounts || [])
        .filter((account) => Number(account.last_balance_usd || 0) > 0)
        .map((account) => String(account.user_id))
    );

    if (fundedUserIds.size === 0) return;

    const activatedAt = new Date().toISOString();
    for (const relationship of relationships) {
      if (!fundedUserIds.has(relationship.invitee_user_id)) continue;

      const { error: updateError } = await supabase
        .from('referral_relationships')
        .update({ activated_at: activatedAt })
        .eq('id', relationship.id)
        .is('activated_at', null);

      if (updateError) {
        console.error(`[REFERRALS] Failed to activate referral ${relationship.id}: ${updateError.message}`);
      } else {
        console.log(`[REFERRALS] Activated funded referral ${relationship.id}.`);
      }
    }
  }

  private async creditCompletedWeek(periodStart: Date, periodEnd: Date): Promise<void> {
    const { data: activeRelationships, error } = await supabase
      .from('referral_relationships')
      .select('id, invitee_user_id, activated_at')
      .not('activated_at', 'is', null);

    if (error) {
      console.error(`[REFERRALS] Failed to load active referrals: ${error.message}`);
      return;
    }

    for (const relationship of (activeRelationships || []) as ReferralRelationship[]) {
      try {
        // Do not credit PnL that predates the funded-account activation.
        if (!relationship.activated_at || new Date(relationship.activated_at) > periodStart) {
          continue;
        }

        const realisedProfit = await this.getNetRealisedProfit(
          relationship.invitee_user_id,
          periodStart,
          periodEnd
        );

        if (realisedProfit <= 0) continue;

        const { data: rewardUsd, error: rewardError } = await supabase.rpc(
          'credit_referral_weekly_reward',
          {
            p_referral_id: relationship.id,
            p_period_start: periodStart.toISOString(),
            p_period_end: periodEnd.toISOString(),
            p_source_profit_usd: realisedProfit,
          }
        );

        if (rewardError) {
          console.error(`[REFERRALS] Failed to credit referral ${relationship.id}: ${rewardError.message}`);
        } else if (Number(rewardUsd || 0) > 0) {
          console.log(
            `[REFERRALS] Credited $${Number(rewardUsd).toFixed(4)} for referral ${relationship.id} ` +
              `from $${realisedProfit.toFixed(4)} weekly realised profit.`
          );
        }
      } catch (err: any) {
        console.error(
          `[REFERRALS] Unexpected error for referral ${relationship.id}: ${err?.message || err}`
        );
      }
    }
  }

  private async getNetRealisedProfit(userId: string, periodStart: Date, periodEnd: Date): Promise<number> {
    const start = periodStart.toISOString();
    const end = periodEnd.toISOString();

    const [botPositionsResult, signalPositionsResult] = await Promise.all([
      supabase
        .from('bot_positions')
        .select('realized_pnl_usd, long_order_id, short_order_id')
        .eq('user_id', userId)
        .eq('is_master', false)
        .eq('status', 'closed')
        .not('exchange_account_id', 'is', null)
        .gte('closed_at', start)
        .lt('closed_at', end),
      supabase
        .from('signal_positions')
        .select('realized_pnl_usd')
        .eq('user_id', userId)
        .eq('is_master', false)
        .eq('status', 'closed')
        .not('exchange_account_id', 'is', null)
        .gte('closed_at', start)
        .lt('closed_at', end),
    ]);

    if (botPositionsResult.error) {
      throw new Error(`Could not load pair-trading PnL: ${botPositionsResult.error.message}`);
    }
    if (signalPositionsResult.error) {
      throw new Error(`Could not load signal PnL: ${signalPositionsResult.error.message}`);
    }

    const pairPnl = ((botPositionsResult.data || []) as ClosedPosition[])
      .filter((position) => {
        const longId = String(position.long_order_id || '');
        const shortId = String(position.short_order_id || '');
        return !longId.startsWith('sim-') && !shortId.startsWith('sim-');
      })
      .reduce((total, position) => total + (Number(position.realized_pnl_usd) || 0), 0);

    const signalPnl = ((signalPositionsResult.data || []) as ClosedPosition[]).reduce(
      (total, position) => total + (Number(position.realized_pnl_usd) || 0),
      0
    );

    return Number((pairPnl + signalPnl).toFixed(4));
  }

  public start(): void {
    if (this.timer) return;
    this.runAudit().catch((err) => console.error(`[REFERRALS] Initial audit failed: ${err?.message || err}`));
    this.timer = setInterval(() => {
      this.runAudit().catch((err) => console.error(`[REFERRALS] Audit failed: ${err?.message || err}`));
    }, this.intervalMs);
  }

  public stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }
}
