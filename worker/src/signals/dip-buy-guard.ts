import { CONFIG, supabase } from '../config.js';
import {
  ExchangeAccount,
  SignalExitReason,
  SignalPosition,
  UserProfile,
  UserSignalSettings,
} from '../types/index.js';
import { CandleBuffer } from './candle-buffer.js';
import { DipBuyExecution } from './dip-buy-execution.js';
import { createExchangeInstance } from '../exchanges/exchange-factory.js';
import { telegramNotifier } from '../notifications/telegram.js';

export class DipBuyGuard {
  private buffer: CandleBuffer;
  private timer: NodeJS.Timeout | null = null;
  private checkIntervalMs: number;
  private isChecking = false;
  private strategyId: string;
  private symbol: string;

  constructor(buffer: CandleBuffer, strategyId = 'xrp_dip_buy_v1', symbol = 'XRP', checkIntervalMs = 15000) {
    this.buffer = buffer;
    this.strategyId = strategyId;
    this.symbol = symbol.toUpperCase();
    this.checkIntervalMs = checkIntervalMs;
  }

  public start(): void {
    if (this.timer) return;
    console.log(`🛡️ [DipBuyGuard] Position Guard running every ${this.checkIntervalMs / 1000}s.`);
    this.timer = setInterval(async () => {
      try {
        await this.checkPositions();
      } catch (err: any) {
        console.error('❌ [DipBuyGuard] Error checking positions:', err?.message || err);
      }
    }, this.checkIntervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('🛑 [DipBuyGuard] Stopped.');
  }

  public async checkPositions(): Promise<void> {
    if (this.isChecking) return;
    this.isChecking = true;

    try {
      // 1. Fetch all open positions for this strategy
      const { data: positions, error } = await supabase
        .from('signal_positions')
        .select('*, exchange_accounts(*), users_profile(*)')
        .eq('strategy_id', this.strategyId)
        .eq('status', 'open');

      if (error || !positions || positions.length === 0) {
        return;
      }

      // Check current market price
      const lastCandle = this.buffer.getLastCandle();
      const currentPrice = lastCandle ? lastCandle.close : null;

      for (const pos of positions as any[]) {
        if (pos.is_master) {
          await this.reconcileMasterPaperPosition(pos);
        } else {
          await this.reconcileUserLivePosition(pos, currentPrice);
        }
      }
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Evaluates Master Paper position exits using 1m closed bars
   * low <= sl -> exit min(open, sl)
   * high >= tp -> exit tp
   * conflict on same bar -> sl takes priority
   */
  private async reconcileMasterPaperPosition(pos: SignalPosition): Promise<void> {
    const candles = this.buffer.getCandles();
    if (candles.length < 2) return;

    const closedBar = candles[candles.length - 2];
    const openTimeMs = new Date(pos.opened_at).getTime();

    // Only evaluate bars that closed AFTER position was opened
    if (closedBar.timestamp + 60000 <= openTimeMs) {
      return;
    }

    const tpPrice = Number(pos.tp_price);
    const slPrice = Number(pos.sl_price);
    const entryPrice = Number(pos.entry_price);
    const qty = Number(pos.qty);
    const allocatedMargin = Number(pos.allocated_margin_usd);

    let exitReason: SignalExitReason | null = null;
    let exitPrice = 0;

    const hitSl = closedBar.low <= slPrice;
    const hitTp = closedBar.high >= tpPrice;

    if (hitSl && hitTp) {
      // Conservative: if both hit on same 1m bar, SL takes priority
      exitReason = 'sl';
      exitPrice = Math.min(closedBar.open, slPrice);
    } else if (hitSl) {
      exitReason = 'sl';
      exitPrice = Math.min(closedBar.open, slPrice);
    } else if (hitTp) {
      exitReason = 'tp';
      exitPrice = tpPrice;
    }

    if (exitReason) {
      const grossPnl = (exitPrice - entryPrice) * qty;
      const exitFee = Number(((qty * exitPrice * (CONFIG.dipPaperFeePct / 100))).toFixed(4));
      const entryFee = Number(pos.entry_fees_usd || 0);
      const totalFees = entryFee + exitFee;
      const netRealizedPnl = Number((grossPnl - totalFees).toFixed(4));
      const pnlPct = Number(((netRealizedPnl / allocatedMargin) * 100).toFixed(2));

      await supabase
        .from('signal_positions')
        .update({
          status: 'closed',
          exit_price: exitPrice,
          exit_reason: exitReason,
          exit_fees_usd: exitFee,
          gross_pnl_usd: Number(grossPnl.toFixed(4)),
          realized_pnl_usd: netRealizedPnl,
          unrealized_pnl_usd: 0,
          pnl_pct: pnlPct,
          closed_at: new Date(closedBar.timestamp + 60000).toISOString(),
        })
        .eq('id', pos.id);

      console.log(
        `👑 [DipBuyGuard] Closed Master Paper Position #${pos.id} via ${exitReason.toUpperCase()}: Exit $${exitPrice}, Net PnL $${netRealizedPnl} (${pnlPct}%)`
      );

      await telegramNotifier.notifySignalClosed({
        isMaster: true,
        symbol: pos.symbol,
        exitReason,
        realizedPnl: netRealizedPnl,
        pnlPct,
        allocatedMargin,
        entryPrice,
        exitPrice,
        openedAt: pos.opened_at,
        closedAt: new Date(closedBar.timestamp + 60000).toISOString(),
      });
    } else {
      // Update unrealized PnL
      const currentPrice = closedBar.close;
      const grossPnl = (currentPrice - entryPrice) * qty;
      const netPnl = grossPnl - Number(pos.entry_fees_usd || 0);
      const pnlPct = Number(((netPnl / allocatedMargin) * 100).toFixed(2));

      await supabase
        .from('signal_positions')
        .update({
          unrealized_pnl_usd: Number(netPnl.toFixed(4)),
          pnl_pct: pnlPct,
        })
        .eq('id', pos.id);
    }
  }

  /**
   * Reconciles Live User Positions:
   * 1. Checks panic_close_requested_at in user_signal_settings
   * 2. Checks actual position on exchange (fetchPositions)
   * 3. If exchange position is 0 -> determine TP or SL from exchange order status, cancel remaining, close DB
   * 4. If fallback needed (no native TP/SL orders) -> trigger market exit when threshold crossed
   * 5. Updates unrealized PnL
   */
  private async reconcileUserLivePosition(pos: any, currentPrice: number | null): Promise<void> {
    const account: ExchangeAccount = pos.exchange_accounts;
    const user: UserProfile = pos.users_profile;

    if (!account || !user) return;

    const client = createExchangeInstance(account);
    const ccxtSymbol = `${pos.symbol}/USDT:USDT`;

    // 1. Check panic close request
    const { data: userSettings } = await supabase
      .from('user_signal_settings')
      .select('panic_close_requested_at')
      .eq('user_id', user.id)
      .eq('strategy_id', this.strategyId)
      .maybeSingle();

    if (userSettings?.panic_close_requested_at) {
      console.log(`🚨 [DipBuyGuard] Panic close requested for ${user.email}! Executing market exit.`);
      await this.executeUserEmergencyClose(pos, account, client, ccxtSymbol, 'panic_close');

      // Clear panic_close_requested_at and disable toggle
      await supabase
        .from('user_signal_settings')
        .update({ panic_close_requested_at: null, is_enabled: false })
        .eq('user_id', user.id)
        .eq('strategy_id', this.strategyId);
      return;
    }

    // 2. Fetch live position from exchange
    let exchangePositionQty = 0;
    try {
      let positions: any[] = [];
      if (client.fetchPositions) {
        positions = await client.fetchPositions([ccxtSymbol]);
      } else if (client.fetchPosition) {
        const p = await client.fetchPosition(ccxtSymbol);
        if (p) positions = [p];
      }

      if (positions.length > 0) {
        const found = positions.find((p: any) => p.symbol === ccxtSymbol || p.symbol?.startsWith(pos.symbol));
        if (found) {
          exchangePositionQty = Math.abs(Number(found.contracts || found.positionAmt || found.size || 0));
        }
      }
    } catch (fetchErr: any) {
      console.warn(`⚠️ [DipBuyGuard] Failed to fetch position for ${user.email}: ${fetchErr.message}`);
      return;
    }

    // 3. Position closed on exchange externally (TP / SL triggered)
    if (exchangePositionQty === 0) {
      console.log(`🏁 [DipBuyGuard] Exchange position is 0 for ${user.email}. Inspecting TP/SL orders...`);
      let exitReason: SignalExitReason = 'external_flat';
      let exitPrice = Number(pos.entry_price);
      let exitOrderId: string | null = null;

      // Check TP order
      if (pos.tp_order_id) {
        try {
          const tpOrder = await client.fetchOrder(pos.tp_order_id, ccxtSymbol);
          if (tpOrder.status === 'closed' || tpOrder.status === 'filled') {
            exitReason = 'tp';
            exitPrice = Number(tpOrder.average || tpOrder.price || pos.tp_price);
            exitOrderId = pos.tp_order_id;
          }
        } catch {}
      }

      // Check SL order
      if (exitReason === 'external_flat' && pos.sl_order_id) {
        try {
          const slOrder = await client.fetchOrder(pos.sl_order_id, ccxtSymbol);
          if (slOrder.status === 'closed' || slOrder.status === 'filled') {
            exitReason = 'sl';
            exitPrice = Number(slOrder.average || slOrder.price || pos.sl_price);
            exitOrderId = pos.sl_order_id;
          }
        } catch {}
      }

      // Cancel any remaining conditional order
      if (pos.tp_order_id) {
        await DipBuyExecution.cancelOrderSafely(client, pos.tp_order_id, ccxtSymbol);
      }
      if (pos.sl_order_id) {
        await DipBuyExecution.cancelOrderSafely(client, pos.sl_order_id, ccxtSymbol);
      }

      // Finalize position in database
      const qty = Number(pos.qty);
      const allocatedMargin = Number(pos.allocated_margin_usd);
      const grossPnl = (exitPrice - Number(pos.entry_price)) * qty;
      const exitFee = Number(((qty * exitPrice * CONFIG.takerFeePct) / 100).toFixed(4));
      const entryFee = Number(pos.entry_fees_usd || 0);
      const netRealizedPnl = Number((grossPnl - entryFee - exitFee).toFixed(4));
      const pnlPct = Number(((netRealizedPnl / allocatedMargin) * 100).toFixed(2));

      await supabase
        .from('signal_positions')
        .update({
          status: 'closed',
          exit_price: exitPrice,
          exit_order_id: exitOrderId,
          exit_reason: exitReason,
          exit_fees_usd: exitFee,
          gross_pnl_usd: Number(grossPnl.toFixed(4)),
          realized_pnl_usd: netRealizedPnl,
          unrealized_pnl_usd: 0,
          pnl_pct: pnlPct,
          closed_at: new Date().toISOString(),
        })
        .eq('id', pos.id);

      await telegramNotifier.notifySignalClosed({
        isMaster: false,
        userId: user.id,
        userEmail: user.email,
        exchange: account.exchange,
        accountName: account.account_name,
        symbol: pos.symbol,
        exitReason,
        realizedPnl: netRealizedPnl,
        pnlPct,
        allocatedMargin,
        entryPrice: Number(pos.entry_price),
        exitPrice,
        openedAt: pos.opened_at,
        closedAt: new Date().toISOString(),
      });
      return;
    }

    // 4. Fallback execution if TP/SL native orders were not successfully placed
    if (currentPrice && (!pos.tp_order_id || !pos.sl_order_id)) {
      if (pos.tp_price && currentPrice >= Number(pos.tp_price)) {
        console.log(`🎯 [DipBuyGuard] Fallback TP reached for ${user.email} ($${currentPrice} >= $${pos.tp_price})`);
        await this.executeUserEmergencyClose(pos, account, client, ccxtSymbol, 'tp');
        return;
      }
      if (pos.sl_price && currentPrice <= Number(pos.sl_price)) {
        console.log(`🛡️ [DipBuyGuard] Fallback SL reached for ${user.email} ($${currentPrice} <= $${pos.sl_price})`);
        await this.executeUserEmergencyClose(pos, account, client, ccxtSymbol, 'sl');
        return;
      }
    }

    // 5. Update unrealized PnL in database
    if (currentPrice) {
      const grossPnl = (currentPrice - Number(pos.entry_price)) * Number(pos.qty);
      const netPnl = grossPnl - Number(pos.entry_fees_usd || 0);
      const pnlPct = Number(((netPnl / Number(pos.allocated_margin_usd)) * 100).toFixed(2));

      await supabase
        .from('signal_positions')
        .update({
          unrealized_pnl_usd: Number(netPnl.toFixed(4)),
          pnl_pct: pnlPct,
        })
        .eq('id', pos.id);
    }
  }

  private async executeUserEmergencyClose(
    pos: any,
    account: ExchangeAccount,
    client: any,
    ccxtSymbol: string,
    reason: SignalExitReason
  ): Promise<void> {
    const user: UserProfile = pos.users_profile;

    // 1. Cancel open TP/SL
    if (pos.tp_order_id) await DipBuyExecution.cancelOrderSafely(client, pos.tp_order_id, ccxtSymbol);
    if (pos.sl_order_id) await DipBuyExecution.cancelOrderSafely(client, pos.sl_order_id, ccxtSymbol);

    // 2. Market sell reduce-only
    let fill: any;
    try {
      fill = await DipBuyExecution.marketSellReduceOnly(client, ccxtSymbol, Number(pos.qty), Number(pos.entry_price));
    } catch (err: any) {
      console.error(`❌ [DipBuyGuard] Emergency exit failed for ${user.email}: ${err.message}`);
      await supabase
        .from('signal_positions')
        .update({ last_error: `Emergency close failed: ${err.message}` })
        .eq('id', pos.id);
      return;
    }

    const exitPrice = fill.price;
    const exitOrderId = fill.orderId;
    const exitFee = fill.feeUsd;
    const qty = Number(pos.qty);
    const allocatedMargin = Number(pos.allocated_margin_usd);
    const grossPnl = (exitPrice - Number(pos.entry_price)) * qty;
    const entryFee = Number(pos.entry_fees_usd || 0);
    const netRealizedPnl = Number((grossPnl - entryFee - exitFee).toFixed(4));
    const pnlPct = Number(((netRealizedPnl / allocatedMargin) * 100).toFixed(2));

    await supabase
      .from('signal_positions')
      .update({
        status: 'closed',
        exit_price: exitPrice,
        exit_order_id: exitOrderId,
        exit_reason: reason,
        exit_fees_usd: exitFee,
        gross_pnl_usd: Number(grossPnl.toFixed(4)),
        realized_pnl_usd: netRealizedPnl,
        unrealized_pnl_usd: 0,
        pnl_pct: pnlPct,
        closed_at: new Date().toISOString(),
      })
      .eq('id', pos.id);

    await telegramNotifier.notifySignalClosed({
      isMaster: false,
      userId: user.id,
      userEmail: user.email,
      exchange: account.exchange,
      accountName: account.account_name,
      symbol: pos.symbol,
      exitReason: reason,
      realizedPnl: netRealizedPnl,
      pnlPct,
      allocatedMargin,
      entryPrice: Number(pos.entry_price),
      exitPrice,
      openedAt: pos.opened_at,
      closedAt: new Date().toISOString(),
    });
  }
}
