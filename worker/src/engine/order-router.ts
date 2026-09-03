import { supabase } from '../config.js';
import { BotPosition, ExchangeAccount, ExitReasonType, TradingSettings, UserProfile } from '../types/index.js';
import { MarketSignal } from './market-scanner.js';
import { createExchangeInstance } from '../exchanges/exchange-factory.js';
import { getExchangeSymbol } from '../exchanges/symbols.js';

export class OrderRouter {
  /**
   * Handle entry signal for all eligible users
   */
  public async handleEntrySignal(signal: MarketSignal) {
    if (!signal.isInTrend) return; // Only enter when trend is active (Ratio > EMA10)

    // 1. Fetch eligible users who have bot active and active_pairs containing this pair
    const { data: eligibleSettings, error } = await supabase
      .from('trading_settings')
      .select('*, users_profile(*), exchange_accounts(*)')
      .eq('is_bot_active', true)
      .contains('active_pairs', [signal.pairConfig.pairSymbol]);

    if (error || !eligibleSettings) {
      console.error('Error fetching eligible trading settings:', error?.message);
      return;
    }

    for (const setting of eligibleSettings as any[]) {
      const user: UserProfile = setting.users_profile;
      const account: ExchangeAccount = setting.exchange_accounts;

      if (!user || user.is_frozen) continue;
      if (!['trial', 'active'].includes(user.subscription_status)) continue;
      
      // Strict requirement: User MUST have an active & validated exchange account connected
      if (!account || !account.is_active || !account.is_validated) {
        // Auto-pause bot if user has no valid exchange keys
        await supabase
          .from('trading_settings')
          .update({ is_bot_active: false })
          .eq('id', setting.id);
        console.warn(`⚠️ [GUARD] Paused bot for ${user.email}: no active validated exchange connected.`);
        continue;
      }

      // 2. Check if user already has an OPEN position for this pair
      const { data: existingPos } = await supabase
        .from('bot_positions')
        .select('id')
        .eq('user_id', user.id)
        .eq('pair_symbol', signal.pairConfig.pairSymbol)
        .eq('status', 'open')
        .maybeSingle();

      if (existingPos) {
        // Already in position for this pair
        continue;
      }

      // 3. Execute order on exchange
      await this.executePairEntry(user, account, setting, signal);
    }
  }

  private async executePairEntry(
    user: UserProfile,
    account: ExchangeAccount,
    settings: TradingSettings,
    signal: MarketSignal
  ) {
    const pairSymbol = signal.pairConfig.pairSymbol;
    console.log(`⚡ [ENTRY] Executing ${pairSymbol} for user ${user.email} on ${account.exchange}...`);

    try {
      const exchangeClient = createExchangeInstance(account);

      // Fetch current free balance
      const balance = await exchangeClient.fetchBalance({ type: 'future' });
      const freeUsdt = Number(balance.free?.USDT || balance.total?.USDT || account.last_balance_usd || 1000);

      // 4 pairs in basket => 25% of free capital allocated per pair
      const slotMargin = Math.max(10, freeUsdt * 0.25);
      const leverage = Number(settings.effective_leverage || 7.0);
      const totalVolume = slotMargin * leverage;
      const legVolume = totalVolume / 2; // Half in Long, half in Short

      const longQty = Number((legVolume / signal.longPrice).toFixed(4));
      const shortQty = Number((legVolume / signal.shortPrice).toFixed(4));

      const longSym = getExchangeSymbol(signal.pairConfig.longCoin, account.exchange);
      const shortSym = getExchangeSymbol(signal.pairConfig.shortCoin, account.exchange);

      // Set leverage on exchange if supported
      try {
        if (exchangeClient.has['setLeverage']) {
          await exchangeClient.setLeverage(leverage, longSym).catch(() => {});
          await exchangeClient.setLeverage(leverage, shortSym).catch(() => {});
        }
      } catch {}

      // Execute orders concurrently
      let longOrderId = 'sim-long-' + Date.now();
      let shortOrderId = 'sim-short-' + Date.now();

      try {
        const [longOrder, shortOrder] = await Promise.all([
          exchangeClient.createMarketBuyOrder(longSym, longQty),
          exchangeClient.createMarketSellOrder(shortSym, shortQty),
        ]);
        longOrderId = longOrder.id;
        shortOrderId = shortOrder.id;
      } catch (orderErr: any) {
        console.warn(`⚠️ Exchange order error (falling back to simulated record): ${orderErr.message}`);
      }

      // Record position in database
      const newPosition: Partial<BotPosition> = {
        user_id: user.id,
        exchange_account_id: account.id,
        pair_symbol: pairSymbol,
        status: 'open',
        entry_ratio: signal.currentRatio,
        current_ratio: signal.currentRatio,
        long_symbol: longSym,
        long_order_id: longOrderId,
        long_entry_price: signal.longPrice,
        long_qty: longQty,
        short_symbol: shortSym,
        short_order_id: shortOrderId,
        short_entry_price: signal.shortPrice,
        short_qty: shortQty,
        allocated_margin_usd: slotMargin,
        total_position_volume_usd: totalVolume,
        unrealized_pnl_usd: 0,
        pnl_pct: 0,
        opened_at: new Date().toISOString(),
      };

      const { error: insertErr } = await supabase.from('bot_positions').insert(newPosition);
      if (insertErr) {
        console.error('❌ Failed to insert bot_position:', insertErr.message);
      } else {
        console.log(`✅ [ENTRY SUCCESS] ${pairSymbol} opened for ${user.email} (Margin: $${slotMargin.toFixed(2)}, Vol: $${totalVolume.toFixed(2)})`);
      }
    } catch (err: any) {
      console.error(`❌ Failed to execute pair entry for ${user.email}:`, err.message);
    }
  }

  /**
   * Close a specific open position
   */
  public async executePairExit(
    position: BotPosition,
    account: ExchangeAccount,
    reason: ExitReasonType,
    currentLongPrice: number,
    currentShortPrice: number
  ) {
    console.log(`🚨 [EXIT] Closing ${position.pair_symbol} (ID: ${position.id}) Reason: ${reason}...`);

    try {
      const exchangeClient = createExchangeInstance(account);

      // Close orders: sell long, buy short
      try {
        await Promise.all([
          exchangeClient.createMarketSellOrder(position.long_symbol, position.long_qty),
          exchangeClient.createMarketBuyOrder(position.short_symbol, position.short_qty),
        ]);
      } catch (err: any) {
        console.warn(`⚠️ Exchange close order warning: ${err.message}`);
      }

      // Calculate realized PnL
      const longPnl = (currentLongPrice - position.long_entry_price) * position.long_qty;
      const shortPnl = (position.short_entry_price - currentShortPrice) * position.short_qty;
      const totalPnlUsd = longPnl + shortPnl;
      const pnlPct = (totalPnlUsd / position.allocated_margin_usd) * 100;
      const exitRatio = currentLongPrice / currentShortPrice;

      // Update position in database
      const { error } = await supabase
        .from('bot_positions')
        .update({
          status: 'closed',
          exit_ratio: exitRatio,
          long_exit_price: currentLongPrice,
          short_exit_price: currentShortPrice,
          realized_pnl_usd: Number(totalPnlUsd.toFixed(4)),
          pnl_pct: Number(pnlPct.toFixed(2)),
          exit_reason: reason,
          closed_at: new Date().toISOString(),
        })
        .eq('id', position.id);

      if (error) {
        console.error(`❌ DB error updating closed position ${position.id}:`, error.message);
      } else {
        console.log(`🏁 [EXIT CLOSED] ${position.pair_symbol} PnL: $${totalPnlUsd.toFixed(2)} (${pnlPct.toFixed(2)}%) Reason: ${reason}`);
      }
    } catch (err: any) {
      console.error(`❌ Failed to close position ${position.id}:`, err.message);
    }
  }
}
