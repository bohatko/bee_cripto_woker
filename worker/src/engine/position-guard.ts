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

      // Calculate current unrealized PnL
      const longPnl = (currentLongPrice - position.long_entry_price) * position.long_qty;
      const shortPnl = (position.short_entry_price - currentShortPrice) * position.short_qty;
      const netPnlUsd = longPnl + shortPnl;
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
      if (CONFIG.slAtrMult > 0) {
        const atrPct = this.scanner.getAtrPct(position.pair_symbol);
        if (atrPct !== undefined) {
          const atrSlMarginPct = CONFIG.slAtrMult * atrPct * effectiveLeverage;
          // Use the more conservative (larger) of the configured SL and the ATR-based SL
          slMarginPct = Math.max(slMarginPct, atrSlMarginPct);
        }
      }
      slMarginPct = Math.min(slMarginPct, CONFIG.slMaxMarginPct);

      // Check exit conditions:
      let exitReason: 'tp' | 'sl' | 'trend_flip' | null = null;
      if (!CONFIG.tpDisabled && netPnlPct >= tpMarginPct) {
        console.log(`🎯 [TP TRIGGERED] ${position.pair_symbol} PnL: +${netPnlPct.toFixed(2)}% >= ${tpMarginPct.toFixed(2)}%`);
        exitReason = 'tp';
      } else if (netPnlPct <= -slMarginPct) {
        console.log(`🛡️ [SL TRIGGERED] ${position.pair_symbol} PnL: ${netPnlPct.toFixed(2)}% <= -${slMarginPct.toFixed(2)}%`);
        exitReason = 'sl';
      } else if (this.scanner.isClosedFourHourBelowEma(position.pair_symbol)) {
        console.log(`🔄 [TREND FLIP TRIGGERED] ${position.pair_symbol} last closed 4h ratio dropped below EMA10`);
        exitReason = 'trend_flip';
      }

      if (exitReason) {
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

    for (const row of panicUsers) {
      // Find open positions for this user
      const { data: positions } = await supabase
        .from('bot_positions')
        .select('*, exchange_accounts(*)')
        .eq('user_id', row.user_id)
        .eq('status', 'open');

      if (positions && positions.length > 0) {
        const { data: marketDataList } = await supabase.from('pair_market_data').select('*');
        const marketMap = new Map<string, any>();
        if (marketDataList) {
          for (const m of marketDataList) marketMap.set(m.pair_symbol, m);
        }

        for (const pos of positions as any[]) {
          const market = marketMap.get(pos.pair_symbol);
          const longP = market ? Number(market.long_price) : pos.long_entry_price;
          const shortP = market ? Number(market.short_price) : pos.short_entry_price;

          await this.orderRouter.executePairExit(pos, pos.exchange_accounts, 'panic_close', longP, shortP);
        }
      }

      // Reset panic trigger in settings
      await supabase
        .from('trading_settings')
        .update({ panic_closed_at: null, is_bot_active: false })
        .eq('user_id', row.user_id);
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
