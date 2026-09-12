import { supabase } from '../config.js';
import { telegramNotifier } from '../notifications/telegram.js';

export interface ReadinessState {
  price: number;
  rolling_max: number;
  drop_pct: number;
  readiness_pct: number;
}

export class ReadinessAlerter {
  private strategyId: string;
  private symbol: string;
  private lastAlertedThresholds: Set<number> = new Set();
  private isLoadedFromDb = false;

  constructor(strategyId = 'xrp_dip_buy_v1', symbol = 'XRP') {
    this.strategyId = strategyId;
    this.symbol = symbol;
  }

  public async initFromDb(): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('signal_strategies')
        .select('live_state')
        .eq('id', this.strategyId)
        .maybeSingle();

      if (!error && data?.live_state?.alerted_thresholds) {
        const arr = data.live_state.alerted_thresholds as number[];
        this.lastAlertedThresholds = new Set(arr);
      }
      this.isLoadedFromDb = true;
    } catch (err: any) {
      console.warn('⚠️ [ReadinessAlerter] Failed to restore alerted_thresholds:', err?.message || err);
      this.isLoadedFromDb = true;
    }
  }

  public resetEpisode(): void {
    this.lastAlertedThresholds.clear();
  }

  public getAlertedThresholds(): number[] {
    return Array.from(this.lastAlertedThresholds);
  }

  public async checkAndAlert(state: ReadinessState): Promise<void> {
    if (!this.isLoadedFromDb) {
      await this.initFromDb();
    }

    const { readiness_pct } = state;

    // Reset hysteresis: when readiness drops below (threshold - 10), clear that threshold
    for (const th of Array.from(this.lastAlertedThresholds)) {
      if (readiness_pct < th - 10) {
        this.lastAlertedThresholds.delete(th);
      }
    }

    // Standard check thresholds to monitor: 80, 90
    const candidateThresholds = [80, 90];

    for (const threshold of candidateThresholds) {
      if (readiness_pct >= threshold && !this.lastAlertedThresholds.has(threshold)) {
        this.lastAlertedThresholds.add(threshold);

        // Fetch subscribers with alert_readiness_enabled = true and matching alert_thresholds
        const targetUserIds: string[] = [];
        try {
          const { data: userSettings, error } = await supabase
            .from('user_signal_settings')
            .select('user_id, alert_readiness_enabled, alert_thresholds')
            .eq('strategy_id', this.strategyId)
            .eq('alert_readiness_enabled', true);

          if (!error && userSettings) {
            for (const s of userSettings as any[]) {
              const thresholds: number[] = Array.isArray(s.alert_thresholds)
                ? s.alert_thresholds
                : [80, 90];
              if (thresholds.includes(threshold)) {
                targetUserIds.push(s.user_id);
              }
            }
          }
        } catch (err: any) {
          console.warn('⚠️ [ReadinessAlerter] Error querying subscribers:', err?.message || err);
        }

        console.log(
          `🔔 [ReadinessAlerter] Threshold ${threshold}% reached for ${this.symbol} (readiness=${readiness_pct.toFixed(1)}%). Alerting admins and ${targetUserIds.length} users.`
        );

        await telegramNotifier.notifySignalReadiness(threshold, state, targetUserIds, this.symbol);
      }
    }
  }
}
