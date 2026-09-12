import ccxt from 'ccxt';
import { CONFIG, supabase } from '../config.js';
import { CandleBuffer, Candle1m } from './candle-buffer.js';
import { ReadinessAlerter } from './readiness-alerter.js';
import { SignalEvent, SignalStrategyLiveState } from '../types/index.js';

export interface DipSignalPayload {
  strategyId: string;
  symbol: string;
  signalBarTs: string;
  rollingMax: number;
  signalClose: number;
  dropPct: number;
  referenceEntryPrice: number;
  signalEventId: string;
}

export type DipSignalCallback = (payload: DipSignalPayload) => Promise<void>;

export class DipBuyScanner {
  private client: any;
  private buffer: CandleBuffer;
  private alerter: ReadinessAlerter;
  private timer: NodeJS.Timeout | null = null;
  private isScanning = false;
  private signalCallbacks: DipSignalCallback[] = [];
  private lastProcessedBarTs = 0;
  private symbol: string;
  private ccxtSymbol: string;
  private strategyId: string;
  private strategyConfig: {
    drop_pct: number;
    window_minutes: number;
    tp_pct: number;
    sl_pct: number;
    reference_margin_usd: number;
  };

  constructor(strategyId = 'xrp_dip_buy_v1', symbol = 'XRP') {
    this.strategyId = strategyId;
    this.symbol = symbol.toUpperCase();
    this.ccxtSymbol = `${this.symbol}/USDT:USDT`;
    this.buffer = new CandleBuffer(2000);
    this.alerter = new ReadinessAlerter(this.strategyId, this.symbol);

    this.strategyConfig = {
      drop_pct: CONFIG.dipDropPct,
      window_minutes: CONFIG.dipWindowMinutes,
      tp_pct: CONFIG.dipTpPct,
      sl_pct: CONFIG.dipSlPct,
      reference_margin_usd: CONFIG.dipReferenceMarginUsd,
    };

    this.client = new ccxt.binanceusdm({
      enableRateLimit: true,
      options: { defaultType: 'future' },
    });
  }

  public onSignal(callback: DipSignalCallback): void {
    this.signalCallbacks.push(callback);
  }

  public getBuffer(): CandleBuffer {
    return this.buffer;
  }

  public getAlerter(): ReadinessAlerter {
    return this.alerter;
  }

  public async loadConfigFromDb(): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('signal_strategies')
        .select('config')
        .eq('id', this.strategyId)
        .maybeSingle();

      if (!error && data?.config) {
        this.strategyConfig = {
          ...this.strategyConfig,
          ...(data.config as any),
        };
        console.log(
          `⚙️ [DipBuyScanner] Loaded config for ${this.strategyId}: Drop ${this.strategyConfig.drop_pct}%, Window ${this.strategyConfig.window_minutes}m, TP ${this.strategyConfig.tp_pct}%, SL ${this.strategyConfig.sl_pct}%`
        );
      }
    } catch (err: any) {
      console.warn(`⚠️ [DipBuyScanner] Failed to load strategy config for ${this.strategyId}:`, err?.message || err);
    }
  }

  public async initHistory(): Promise<void> {
    await this.loadConfigFromDb();
    console.log(`📊 [DipBuyScanner] Pre-loading historical 1m candles for ${this.symbol}...`);
    try {
      // Binance limit per request is up to 1500
      const ohlcv = await this.client.fetchOHLCV(this.ccxtSymbol, '1m', undefined, 1500);
      if (Array.isArray(ohlcv) && ohlcv.length > 0) {
        const candles: Candle1m[] = ohlcv.map((bar: any) => ({
          timestamp: bar[0],
          open: bar[1],
          high: bar[2],
          low: bar[3],
          close: bar[4],
          volume: bar[5],
        }));
        this.buffer.addCandles(candles);
        console.log(`✅ [DipBuyScanner] Loaded ${candles.length} initial 1m bars for ${this.symbol}.`);
      }
    } catch (err: any) {
      console.warn(`⚠️ [DipBuyScanner] Failed to pre-load 1m history:`, err?.message || err);
    }
  }

  public start(): void {
    if (this.timer) return;
    console.log(`🚀 [DipBuyScanner] Starting 1-minute ticker for ${this.symbol} dip-buy.`);

    // Run first tick immediately, then align with minute boundary + 2 seconds
    this.tick().catch((e) => console.error('❌ [DipBuyScanner] Error in initial tick:', e));

    const scheduleNext = () => {
      const now = Date.now();
      const msIntoMinute = now % 60000;
      // Target next minute boundary + 2000ms delay to let exchange close the bar
      let delay = 60000 - msIntoMinute + 2000;
      if (delay < 1000) delay += 60000;

      this.timer = setTimeout(async () => {
        try {
          await this.tick();
        } catch (err: any) {
          console.error('❌ [DipBuyScanner] Error during tick:', err?.message || err);
        } finally {
          scheduleNext();
        }
      }, delay);
    };

    scheduleNext();
  }

  public stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('🛑 [DipBuyScanner] Stopped.');
  }

  public async tick(): Promise<void> {
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      // 1. Fetch recent bars and ticker
      const [ohlcv, ticker] = await Promise.all([
        this.client.fetchOHLCV(this.ccxtSymbol, '1m', undefined, 15),
        this.client.fetchTicker(this.ccxtSymbol),
      ]);

      if (Array.isArray(ohlcv) && ohlcv.length > 0) {
        const candles: Candle1m[] = ohlcv.map((bar: any) => ({
          timestamp: bar[0],
          open: bar[1],
          high: bar[2],
          low: bar[3],
          close: bar[4],
          volume: bar[5],
        }));
        this.buffer.addCandles(candles);
      }

      const currentPrice = Number(ticker.last || ticker.close || 0);
      if (currentPrice <= 0 || this.buffer.size() < 100) {
        return;
      }

      // Check master position state to determine if in_position
      const { data: openMasterPos, error: masterErr } = await supabase
        .from('signal_positions')
        .select('id, status, entry_price')
        .eq('strategy_id', this.strategyId)
        .eq('is_master', true)
        .eq('status', 'open')
        .maybeSingle();

      const isMasterInPosition = !masterErr && Boolean(openMasterPos);

      // Rolling max of last N closed bars (excluding forming bar)
      const windowMinutes = this.strategyConfig.window_minutes || CONFIG.dipWindowMinutes;
      const rollingMax = this.buffer.getRollingMaxHigh(windowMinutes, true);
      if (!rollingMax) {
        return;
      }

      const dropPct = this.buffer.calculateDropPct(currentPrice, rollingMax);
      const targetDrop = this.strategyConfig.drop_pct || CONFIG.dipDropPct;
      const readinessPct = isMasterInPosition
        ? 0
        : Math.min(100, Math.max(0, (dropPct / targetDrop) * 100));

      const liveState: SignalStrategyLiveState = {
        price: Number(currentPrice.toFixed(4)),
        rolling_max: Number(rollingMax.toFixed(4)),
        drop_pct: Number(dropPct.toFixed(2)),
        readiness_pct: Number(readinessPct.toFixed(1)),
        state: isMasterInPosition ? 'in_position' : 'flat',
        updated_at: new Date().toISOString(),
        alerted_thresholds: this.alerter.getAlertedThresholds(),
      };

      // 2. Persist live_state to signal_strategies for UI Realtime
      await supabase
        .from('signal_strategies')
        .update({ live_state: liveState, updated_at: new Date().toISOString() })
        .eq('id', this.strategyId);

      // 3. If in_position, we don't alert readiness or look for new entries
      if (isMasterInPosition) {
        return;
      }

      // 4. Check readiness alerts (80%, 90%)
      await this.alerter.checkAndAlert({
        price: currentPrice,
        rolling_max: rollingMax,
        drop_pct: dropPct,
        readiness_pct: readinessPct,
      });

      // 5. Evaluate entry condition on the last CLOSED bar t
      const allCandles = this.buffer.getCandles();
      if (allCandles.length < 2) return;

      const closedBar = allCandles[allCandles.length - 2];
      const now = Date.now();

      // Guard cold-start: do not fire signal if bar closed > 2 minutes ago
      const isRecent = now - (closedBar.timestamp + 60000) <= 2 * 60000;
      if (!isRecent) return;

      // Ensure we process each closed bar timestamp only once
      if (closedBar.timestamp <= this.lastProcessedBarTs) return;

      const closedDropPct = this.buffer.calculateDropPct(closedBar.close, rollingMax);

      if (closedDropPct >= targetDrop) {
        this.lastProcessedBarTs = closedBar.timestamp;
        const referenceEntryPrice = currentPrice; // immediate market entry at open of t+1

        console.log(
          `🔥 [DipBuyScanner] SIGNAL FIRED for ${this.symbol}! Drop = ${closedDropPct.toFixed(2)}% >= ${targetDrop}% at bar ${new Date(closedBar.timestamp).toISOString()}! Ref entry = $${referenceEntryPrice}`
        );

        // 6. Record signal_event in database
        const { data: eventData, error: eventErr } = await supabase
          .from('signal_events')
          .insert({
            strategy_id: this.strategyId,
            symbol: this.symbol,
            signal_bar_ts: new Date(closedBar.timestamp).toISOString(),
            rolling_max: rollingMax,
            signal_close: closedBar.close,
            drop_pct: Number(closedDropPct.toFixed(2)),
            reference_entry_price: referenceEntryPrice,
            status: 'fired',
          })
          .select('id')
          .single();

        if (eventErr || !eventData) {
          console.error('❌ [DipBuyScanner] Failed to insert signal_event:', eventErr?.message);
          return;
        }

        const payload: DipSignalPayload = {
          strategyId: this.strategyId,
          symbol: this.symbol,
          signalBarTs: new Date(closedBar.timestamp).toISOString(),
          rollingMax,
          signalClose: closedBar.close,
          dropPct: closedDropPct,
          referenceEntryPrice,
          signalEventId: eventData.id,
        };

        // Notify subscribers
        for (const cb of this.signalCallbacks) {
          try {
            await cb(payload);
          } catch (cbErr: any) {
            console.error('❌ [DipBuyScanner] Signal callback error:', cbErr?.message || cbErr);
          }
        }

        // Reset episode for alerter
        this.alerter.resetEpisode();
      }
    } catch (err: any) {
      console.error('❌ [DipBuyScanner] Scan tick error:', err?.message || err);
    } finally {
      this.isScanning = false;
    }
  }
}
