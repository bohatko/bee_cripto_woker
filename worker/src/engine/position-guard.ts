import { supabase, CONFIG } from '../config.js';
import { BotPosition, ExchangeAccount } from '../types/index.js';
import { OrderRouter } from './order-router.js';
import { MarketScanner } from './market-scanner.js';
import { isUnfilledSimulation } from '../exchanges/balance.js';

export class PositionGuard {
  private orderRouter: OrderRouter;
  private scanner: MarketScanner;
  private timer: NodeJS.Timeout | null = null;
  private checkIntervalMs: number;
  private peakGrossPnlMap = new Map<string, number>();
  /**
   * Panic triggers already handled by this process (key: `user_id:panic_closed_at`).
   * Safety net against a trigger that could not be cleared in the DB: without it, the
   * 5s loop would re-close every position opened afterwards, forever.
   */
  private processedPanicKeys = new Set<string>();

  constructor(orderRouter: OrderRouter, scanner: MarketScanner, checkIntervalMs: number = 5000) {
    this.orderRouter = orderRouter;
    this.scanner = scanner;
    this.checkIntervalMs = checkIntervalMs;
  }

  public async checkPositions() {
    // 1. Fetch all currently open positions with exchange account, user profile and nested trading settings
    const { data: openPositions, error } = await supabase
      .from('bot_positions')
      .select('*, exchange_accounts(*), users_profile(*, trading_settings(*))')
      .eq('status', 'open');

    if (error) {
      console.error(`❌ checkPositions DB query failed: ${error.message}`);
      return;
    }
    if (!openPositions || openPositions.length === 0) {
      return;
    }

    // 2. Fetch latest market prices for all strategy pairs
    const { data: marketDataList } = await supabase.from('pair_market_data').select('*');
    const marketMap = new Map<string, any>();
    if (marketDataList) {
      for (const m of marketDataList) {
        marketMap.set(m.pair_symbol, m);
      }
    }

    for (const pos of openPositions as any[]) {
      const position: BotPosition = pos;
      const account: ExchangeAccount = pos.exchange_accounts;
      const nestedTradingSettings = pos.users_profile?.trading_settings;
      const tradingSettings = Array.isArray(nestedTradingSettings) ? nestedTradingSettings[0] : nestedTradingSettings;

      if (!position.is_master && isUnfilledSimulation(position)) {
        await this.orderRouter.executePairExit(
          position,
          account,
          'admin_close',
          Number(position.long_entry_price),
          Number(position.short_entry_price)
        );
        continue;
      }

      const market = marketMap.get(position.pair_symbol);

      if (!market) continue;

      const currentLongPrice = Number(market.long_price);
      const currentShortPrice = Number(market.short_price);
      const currentRatio = Number(market.current_ratio);

      // Calculate current unrealized PnL (gross mark-to-market)
      const longPnl = (currentLongPrice - position.long_entry_price) * position.long_qty;
      const shortPnl = (position.short_entry_price - currentShortPrice) * position.short_qty;
      const grossPnlUsd = longPnl + shortPnl;
      const grossPnlPct = (grossPnlUsd / position.allocated_margin_usd) * 100;

      // Displayed unrealized PnL and pnl_pct are stored net of known costs (entry fees + any funding
      // already accrued) so dashboard matches final realized PnL. Exit triggers, by default, use gross
      // PnL% to match the validated backtest barriers; set RISK_ON_NET_PNL=true to use net instead.
      const entryFeesUsd = Number(position.entry_fees_usd || 0);
      const fundingFeesUsd = Number(position.funding_fees_usd || 0);
      const netPnlUsd = grossPnlUsd - entryFeesUsd - fundingFeesUsd;
      const netPnlPct = (netPnlUsd / position.allocated_margin_usd) * 100;
      const effectiveLeverage =
        position.allocated_margin_usd > 0
          ? position.total_position_volume_usd / position.allocated_margin_usd
          : CONFIG.defaultLeverage;

      // Update unrealized metrics in DB
      await supabase
        .from('bot_positions')
        .update({
          current_ratio: currentRatio,
          unrealized_pnl_usd: Number(netPnlUsd.toFixed(4)),
          pnl_pct: Number(netPnlPct.toFixed(2)),
        })
        .eq('id', position.id);

      // Determine per-user or master risk thresholds
      const isMaster = position.is_master || !account;
      const userTakeProfitPct = isMaster ? NaN : Number(tradingSettings?.take_profit_pct);
      const userStopLossPct = isMaster ? NaN : Number(tradingSettings?.stop_loss_pct);
      const tpSpreadPct: number = Number.isFinite(userTakeProfitPct) ? userTakeProfitPct : CONFIG.takeProfitPct;
      const slSpreadPct: number = Number.isFinite(userStopLossPct) ? userStopLossPct : CONFIG.stopLossPct;

      // Convert spread thresholds to margin PnL thresholds
      let tpMarginPct = CONFIG.riskMode === 'spread' ? tpSpreadPct * effectiveLeverage : tpSpreadPct;
      let slMarginPct = CONFIG.riskMode === 'spread' ? slSpreadPct * effectiveLeverage : slSpreadPct;

      // Optional ATR-based stop: SL threshold in spread terms = SL_ATR_MULT * ATR14%,
      // converted to margin PnL% via leverage, capped by SL_MAX_MARGIN_PCT.
      // The ATR stop can only TIGHTEN the configured SL, never widen it: the user's
      // configured STOP_LOSS_PCT (1.5%) must always be respected. When SL_ATR_MULT=0
      // (default) the ATR stop is disabled and the SL is exactly the configured value.
      if (CONFIG.slAtrMult > 0) {
        const atrPct = this.scanner.getAtrPct(position.pair_symbol);
        if (atrPct !== undefined) {
          const atrSlMarginPct = CONFIG.slAtrMult * atrPct * effectiveLeverage;
          // Use the tighter (smaller) of the configured SL and the ATR-based SL.
          slMarginPct = Math.min(slMarginPct, atrSlMarginPct);
        }
      }
      slMarginPct = Math.min(slMarginPct, CONFIG.slMaxMarginPct);

      // Update peak PnL for trailing tracking
      const prevPeak = this.peakGrossPnlMap.get(position.id) ?? 0;
      const currentPeak = Math.max(prevPeak, grossPnlPct);
      this.peakGrossPnlMap.set(position.id, currentPeak);

      // Check exit conditions against gross PnL% by default (validated backtest barriers).
      // With RISK_ON_NET_PNL=true, thresholds are tested against net PnL% instead.
      const triggerPnlPct = CONFIG.riskOnNetPnl ? netPnlPct : grossPnlPct;
      let exitReason: 'tp' | 'sl' | 'trend_flip' | null = null;
      if (!CONFIG.tpDisabled && triggerPnlPct >= tpMarginPct) {
        console.log(`🎯 [TP TRIGGERED] ${position.pair_symbol} PnL: +${triggerPnlPct.toFixed(2)}% >= ${tpMarginPct.toFixed(2)}%`);
        exitReason = 'tp';
      } else if (
        !CONFIG.tpDisabled &&
        CONFIG.trailingActive &&
        currentPeak >= CONFIG.trailingActivationPct &&
        grossPnlPct <= (currentPeak - CONFIG.trailingDeltaPct)
      ) {
        console.log(`🎯 [TRAILING TP TRIGGERED] ${position.pair_symbol} Peak: +${currentPeak.toFixed(2)}%, Current: +${grossPnlPct.toFixed(2)}% (dropped > ${CONFIG.trailingDeltaPct}%)`);
        exitReason = 'tp';
      } else if (triggerPnlPct <= -slMarginPct) {
        console.log(`🛡️ [SL TRIGGERED] ${position.pair_symbol} PnL: ${triggerPnlPct.toFixed(2)}% <= -${slMarginPct.toFixed(2)}%`);
        exitReason = 'sl';
      } else if (this.scanner.isClosedFourHourBelowEma(position.pair_symbol)) {
        console.log(`🔄 [TREND FLIP TRIGGERED] ${position.pair_symbol} last closed 4h ratio dropped below EMA10`);
        exitReason = 'trend_flip';
      }

      if (exitReason) {
        this.peakGrossPnlMap.delete(position.id);
        if (position.is_master || !account) {
          // Master benchmark trade exit
          await this.orderRouter.executeMasterExit(position, exitReason, currentLongPrice, currentShortPrice);
        } else {
          // User exchange trade exit
          await this.orderRouter.executePairExit(position, account, exitReason, currentLongPrice, currentShortPrice);
        }
      }
    }
  }

  public async checkPanicCloseSignals() {
    // Check if any user triggered panic close
    const { data: panicUsers } = await supabase
      .from('trading_settings')
      .select('user_id, panic_closed_at')
      .not('panic_closed_at', 'is', null);

    if (!panicUsers || panicUsers.length === 0) return;

    const { data: marketDataList } = await supabase.from('pair_market_data').select('*');
    const marketMap = new Map<string, any>();
    if (marketDataList) {
      for (const m of marketDataList) marketMap.set(m.pair_symbol, m);
    }

    const getPrices = (pairSymbol: string, fallbackLong: number, fallbackShort: number) => {
      const market = marketMap.get(pairSymbol);
      return {
        longP: market ? Number(market.long_price) : fallbackLong,
        shortP: market ? Number(market.short_price) : fallbackShort,
      };
    };

    for (const row of panicUsers) {
      // A panic trigger is a one-shot signal. Once handled, never act on the same
      // user+timestamp again: if the flag could not be cleared (DB rejected the update),
      // re-processing it would liquidate every position opened afterwards.
      const panicKey = `${row.user_id}:${row.panic_closed_at}`;
      if (this.processedPanicKeys.has(panicKey)) continue;
      this.processedPanicKeys.add(panicKey);

      const { data: profile } = await supabase
        .from('users_profile')
        .select('email, role')
        .eq('id', row.user_id)
        .maybeSingle();

      const isAdmin = profile?.role === 'admin';
      console.log(
        `🚨 [PANIC CLOSE] Triggered by ${profile?.email || row.user_id} (admin=${isAdmin})`
      );

      // 1) Always close this user's live exchange pair positions
      const { data: userPositions } = await supabase
        .from('bot_positions')
        .select('*, exchange_accounts(*)')
        .eq('user_id', row.user_id)
        .eq('status', 'open');

      if (userPositions && userPositions.length > 0) {
        for (const pos of userPositions as any[]) {
          const { longP, shortP } = getPrices(pos.pair_symbol, pos.long_entry_price, pos.short_entry_price);
          try {
            await this.orderRouter.executePairExit(pos, pos.exchange_accounts, 'panic_close', longP, shortP);
          } catch (err: any) {
            console.error(`❌ [PANIC] Failed to close ${pos.pair_symbol} for user ${row.user_id}: ${err.message}`);
          }
        }
      } else {
        console.log(`ℹ️ [PANIC] No open user positions for ${profile?.email || row.user_id}`);
      }

      // 2) Admin panic = platform-wide: close MASTER paper + every live user account
      if (isAdmin) {
        const { data: masterPositions } = await supabase
          .from('bot_positions')
          .select('*')
          .eq('is_master', true)
          .eq('status', 'open');

        if (masterPositions && masterPositions.length > 0) {
          console.log(`🚨 [PANIC] Admin closing ${masterPositions.length} MASTER position(s)`);
          for (const pos of masterPositions as BotPosition[]) {
            const { longP, shortP } = getPrices(
              pos.pair_symbol,
              Number(pos.long_entry_price),
              Number(pos.short_entry_price)
            );
            try {
              await this.orderRouter.executeMasterExit(pos, 'panic_close', longP, shortP);
            } catch (err: any) {
              console.error(`❌ [PANIC] Failed to close MASTER ${pos.pair_symbol}: ${err.message}`);
            }
          }
        }

        const { data: allLivePositions } = await supabase
          .from('bot_positions')
          .select('*, exchange_accounts(*)')
          .eq('is_master', false)
          .eq('status', 'open')
          .neq('user_id', row.user_id);

        if (allLivePositions && allLivePositions.length > 0) {
          console.log(
            `🚨 [PANIC] Admin closing ${allLivePositions.length} live position(s) across other accounts`
          );
          for (const pos of allLivePositions as any[]) {
            const { longP, shortP } = getPrices(pos.pair_symbol, pos.long_entry_price, pos.short_entry_price);
            try {
              await this.orderRouter.executePairExit(pos, pos.exchange_accounts, 'panic_close', longP, shortP);
            } catch (err: any) {
              console.error(
                `❌ [PANIC] Failed to close ${pos.pair_symbol} for user ${pos.user_id}: ${err.message}`
              );
            }
          }
        }

        // Platform-wide panic: pause every bot and consume every pending panic trigger.
        // PostgREST rejects UPDATE without a WHERE clause ("UPDATE requires a WHERE clause",
        // code 21000), so each statement MUST carry an explicit filter. An unfiltered update
        // silently failed here before and left panic_closed_at set forever, which made this
        // 5s loop treat every newly opened position as a panic liquidation.
        const { error: pauseAllError } = await supabase
          .from('trading_settings')
          .update({ is_bot_active: false })
          .eq('is_bot_active', true);
        if (pauseAllError) {
          console.error(`❌ [PANIC] Failed to pause all bots: ${pauseAllError.message}`);
        }

        const { error: clearPanicError } = await supabase
          .from('trading_settings')
          .update({ panic_closed_at: null })
          .not('panic_closed_at', 'is', null);
        if (clearPanicError) {
          console.error(`❌ [PANIC] Failed to clear panic triggers: ${clearPanicError.message}`);
        }
      } else {
        // Reset panic trigger for this user only
        const { error: resetPanicError } = await supabase
          .from('trading_settings')
          .update({ panic_closed_at: null, is_bot_active: false })
          .eq('user_id', row.user_id);
        if (resetPanicError) {
          console.error(`❌ [PANIC] Failed to reset panic trigger for ${row.user_id}: ${resetPanicError.message}`);
        }
      }
    }
  }

  public start() {
    if (this.timer) return;
    console.log(`🛡️ Position Risk Guard started (interval: ${this.checkIntervalMs}ms)...`);
    this.timer = setInterval(async () => {
      await this.checkPositions().catch((err) => console.error('Position check error:', err));
      await this.checkPanicCloseSignals().catch((err) => console.error('Panic close error:', err));
    }, this.checkIntervalMs);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
