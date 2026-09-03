import { supabase, CONFIG } from '../config.js';
import { BotPosition, ExchangeAccount, TradingSettings } from '../types/index.js';
import { OrderRouter } from './order-router.js';

export class PositionGuard {
  private orderRouter: OrderRouter;
  private timer: NodeJS.Timeout | null = null;
  private checkIntervalMs: number;

  constructor(orderRouter: OrderRouter, checkIntervalMs: number = 5000) {
    this.orderRouter = orderRouter;
    this.checkIntervalMs = checkIntervalMs;
  }

  public async checkPositions() {
    // 1. Fetch all currently open positions with exchange account and user settings
    const { data: openPositions, error } = await supabase
      .from('bot_positions')
      .select('*, exchange_accounts(*), users_profile(*)')
      .eq('status', 'open');

    if (error || !openPositions || openPositions.length === 0) {
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
      const market = marketMap.get(position.pair_symbol);

      if (!market || !account) continue;

      const currentLongPrice = Number(market.long_price);
      const currentShortPrice = Number(market.short_price);
      const currentRatio = Number(market.current_ratio);
      const isTrendActive = Boolean(market.is_in_trend);

      // Calculate current unrealized PnL
      const longPnl = (currentLongPrice - position.long_entry_price) * position.long_qty;
      const shortPnl = (position.short_entry_price - currentShortPrice) * position.short_qty;
      const netPnlUsd = longPnl + shortPnl;
      const netPnlPct = (netPnlUsd / position.allocated_margin_usd) * 100;

      // Update unrealized metrics in DB
      await supabase
        .from('bot_positions')
        .update({
          current_ratio: currentRatio,
          unrealized_pnl_usd: Number(netPnlUsd.toFixed(4)),
          pnl_pct: Number(netPnlPct.toFixed(2)),
        })
        .eq('id', position.id);

      // Check exit conditions:
      // Condition 1: Take Profit (+5.0%)
      if (netPnlPct >= CONFIG.takeProfitPct) {
        console.log(`🎯 [TP TRIGGERED] ${position.pair_symbol} PnL: +${netPnlPct.toFixed(2)}% >= ${CONFIG.takeProfitPct}%`);
        await this.orderRouter.executePairExit(position, account, 'tp', currentLongPrice, currentShortPrice);
        continue;
      }

      // Condition 2: Stop Loss (-1.5%)
      if (netPnlPct <= -CONFIG.stopLossPct) {
        console.log(`🛡️ [SL TRIGGERED] ${position.pair_symbol} PnL: ${netPnlPct.toFixed(2)}% <= -${CONFIG.stopLossPct}%`);
        await this.orderRouter.executePairExit(position, account, 'sl', currentLongPrice, currentShortPrice);
        continue;
      }

      // Condition 3: Trend Flip (Ratio dropped below EMA 10)
      if (!isTrendActive) {
        console.log(`🔄 [TREND FLIP TRIGGERED] ${position.pair_symbol} Ratio dropped below EMA10`);
        await this.orderRouter.executePairExit(position, account, 'trend_flip', currentLongPrice, currentShortPrice);
        continue;
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
