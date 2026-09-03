import { supabase } from '../config.js';
import { BotPosition, ExchangeAccount, ExitReasonType, TradingSettings, UserProfile } from '../types/index.js';
import { MarketSignal } from './market-scanner.js';
import { createExchangeInstance } from '../exchanges/exchange-factory.js';
import { getExchangeSymbol } from '../exchanges/symbols.js';
import { extractUsdtBalance, isUnfilledSimulation, MIN_SLOT_MARGIN_USD } from '../exchanges/balance.js';

const SKIP_LOG_COOLDOWN_MS = 60_000;

export class OrderRouter {
  private lastSkipLogAt = new Map<string, number>();

  /**
   * Handle entry signal:
   * 1. ALWAYS ensures master platform trade is opened and recorded in DB (regardless of user count)
   * 2. If eligible users exist with active connected exchanges, mirrors orders to their exchange accounts
   */
  public async handleEntrySignal(signal: MarketSignal) {
    if (!signal.isInTrend) return; // Only enter when trend is active (Ratio > EMA10)

    // 1. Always record & manage Master Bot reference position in DB
    await this.ensureMasterEntry(signal);

    // 2. Fetch eligible users who have bot active and active_pairs containing this pair
    const { data: eligibleSettings, error } = await supabase
      .from('trading_settings')
      .select('*, users_profile(*), exchange_accounts(*)')
      .eq('is_bot_active', true)
      .contains('active_pairs', [signal.pairConfig.pairSymbol]);

    if (error || !eligibleSettings || eligibleSettings.length === 0) {
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

      // 3. Check if user already has an OPEN position for this pair
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

      // 4. Execute order on user's exchange
      await this.executePairEntry(user, account, setting, signal);
    }
  }

  /**
   * Ensure master platform strategy trade is active and recorded in DB
   */
  public async ensureMasterEntry(signal: MarketSignal) {
    const pairSymbol = signal.pairConfig.pairSymbol;

    const { data: existingMaster } = await supabase
      .from('bot_positions')
      .select('id')
      .eq('is_master', true)
      .eq('pair_symbol', pairSymbol)
      .eq('status', 'open')
      .maybeSingle();

    if (existingMaster) {
      return; // Master position already open
    }

    // Master strategy uses $50,000 reference capital (4 pairs = $12,500 margin per slot, 7x = $87,500 volume)
    const refMargin = 12500;
    const lev = 7.0;
    const vol = refMargin * lev; // 87,500 USDT
    const legVol = vol / 2; // 43,750 USDT per leg

    const longQty = Number((legVol / signal.longPrice).toFixed(4));
    const shortQty = Number((legVol / signal.shortPrice).toFixed(4));

    const masterRecord: Partial<BotPosition> = {
      is_master: true,
      user_id: null,
      exchange_account_id: null,
      pair_symbol: pairSymbol,
      status: 'open',
      entry_ratio: Number(signal.currentRatio.toFixed(8)),
      current_ratio: Number(signal.currentRatio.toFixed(8)),
      long_symbol: `${signal.pairConfig.longCoin}/USDT`,
      long_entry_price: signal.longPrice,
      long_qty: longQty,
      short_symbol: `${signal.pairConfig.shortCoin}/USDT`,
      short_entry_price: signal.shortPrice,
      short_qty: shortQty,
      allocated_margin_usd: refMargin,
      total_position_volume_usd: vol,
      unrealized_pnl_usd: 0,
      pnl_pct: 0,
      opened_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('bot_positions').insert(masterRecord);
    if (!error) {
      console.log(`🐝 [MASTER BOT ENTRY] Recorded new basket trade: ${pairSymbol} @ ratio ${signal.currentRatio.toFixed(4)}`);
    }
  }

  /**
   * Close a master platform strategy trade in DB
   */
  public async executeMasterExit(
    position: BotPosition,
    exitReason: ExitReasonType,
    currentLongPrice: number,
    currentShortPrice: number
  ) {
    const exitRatio = currentLongPrice / currentShortPrice;
    const longPnl = (currentLongPrice - position.long_entry_price) * position.long_qty;
    const shortPnl = (position.short_entry_price - currentShortPrice) * position.short_qty;
    const realizedPnl = Number((longPnl + shortPnl).toFixed(2));
    const pnlPct = Number(((realizedPnl / position.allocated_margin_usd) * 100).toFixed(2));

    await supabase
      .from('bot_positions')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
        exit_ratio: Number(exitRatio.toFixed(8)),
        long_exit_price: currentLongPrice,
        short_exit_price: currentShortPrice,
        realized_pnl_usd: realizedPnl,
        unrealized_pnl_usd: 0,
        pnl_pct: pnlPct,
        exit_reason: exitReason,
      })
      .eq('id', position.id);

    console.log(`🏁 [MASTER BOT EXIT] Closed ${position.pair_symbol} (${exitReason.toUpperCase()}) | PnL: ${realizedPnl >= 0 ? '+' : ''}$${realizedPnl} (${pnlPct}%)`);
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

      const balance = await exchangeClient.fetchBalance({ type: 'future' });
      const { free: freeUsdt, total: totalUsdt } = extractUsdtBalance(balance);
      const equityUsdt = totalUsdt > 0 ? totalUsdt : freeUsdt;

      if (equityUsdt > 0 || freeUsdt >= 0) {
        await supabase
          .from('exchange_accounts')
          .update({
            last_balance_usd: equityUsdt,
            free_balance_usd: freeUsdt,
            last_sync_at: new Date().toISOString(),
          })
          .eq('id', account.id);
      }

      // 4 pairs in basket => 25% of FREE (not occupied) USDT margin per pair
      const slotMargin = freeUsdt * 0.25;
      if (!Number.isFinite(freeUsdt) || slotMargin < MIN_SLOT_MARGIN_USD) {
        await this.skipEntry(
          user,
          account,
          pairSymbol,
          `Insufficient free USDT futures margin to open ${pairSymbol}. Free: $${freeUsdt.toFixed(2)}, occupied equity: $${equityUsdt.toFixed(2)}. New entries are skipped until free margin is available.`
        );
        return;
      }

      const leverage = Number(settings.effective_leverage || 7.0);
      const totalVolume = slotMargin * leverage;
      const legVolume = totalVolume / 2;

      const longQty = Number((legVolume / signal.longPrice).toFixed(4));
      const shortQty = Number((legVolume / signal.shortPrice).toFixed(4));
      if (longQty <= 0 || shortQty <= 0) {
        await this.skipEntry(
          user,
          account,
          pairSymbol,
          `Calculated order size is zero for ${pairSymbol} (free margin $${freeUsdt.toFixed(2)}).`
        );
        return;
      }

      const longSym = getExchangeSymbol(signal.pairConfig.longCoin, account.exchange);
      const shortSym = getExchangeSymbol(signal.pairConfig.shortCoin, account.exchange);

      try {
        if (exchangeClient.has['setLeverage']) {
          await exchangeClient.setLeverage(leverage, longSym).catch(() => {});
          await exchangeClient.setLeverage(leverage, shortSym).catch(() => {});
        }
      } catch {}

      const [longResult, shortResult] = await Promise.allSettled([
        exchangeClient.createMarketBuyOrder(longSym, longQty),
        exchangeClient.createMarketSellOrder(shortSym, shortQty),
      ]);

      if (longResult.status !== 'fulfilled' || shortResult.status !== 'fulfilled') {
        if (longResult.status === 'fulfilled') {
          await exchangeClient.createMarketSellOrder(longSym, longQty).catch((unwindErr: any) => {
            console.error(`❌ Failed to unwind LONG after partial fill on ${pairSymbol}: ${unwindErr.message}`);
          });
        }
        if (shortResult.status === 'fulfilled') {
          await exchangeClient.createMarketBuyOrder(shortSym, shortQty).catch((unwindErr: any) => {
            console.error(`❌ Failed to unwind SHORT after partial fill on ${pairSymbol}: ${unwindErr.message}`);
          });
        }

        const longErr = longResult.status === 'rejected' ? String(longResult.reason?.message || longResult.reason) : null;
        const shortErr = shortResult.status === 'rejected' ? String(shortResult.reason?.message || shortResult.reason) : null;
        const reason = [longErr, shortErr].filter(Boolean).join(' | ') || 'Exchange rejected one or both legs';
        await this.skipEntry(
          user,
          account,
          pairSymbol,
          `Exchange rejected ${pairSymbol} live orders (no fill recorded): ${reason}`
        );
        return;
      }

      const longOrderId = longResult.value?.id;
      const shortOrderId = shortResult.value?.id;
      if (!longOrderId || !shortOrderId) {
        await this.skipEntry(
          user,
          account,
          pairSymbol,
          `Exchange returned an empty order id for ${pairSymbol}. Position was not recorded.`
        );
        return;
      }

      const newPosition: Partial<BotPosition> = {
        user_id: user.id,
        exchange_account_id: account.id,
        pair_symbol: pairSymbol,
        status: 'open',
        entry_ratio: signal.currentRatio,
        current_ratio: signal.currentRatio,
        long_symbol: longSym,
        long_order_id: String(longOrderId),
        long_entry_price: signal.longPrice,
        long_qty: longQty,
        short_symbol: shortSym,
        short_order_id: String(shortOrderId),
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
        await this.clearAccountError(account.id);
        console.log(
          `✅ [ENTRY SUCCESS] ${pairSymbol} opened for ${user.email} (Margin: $${slotMargin.toFixed(2)}, Vol: $${totalVolume.toFixed(2)})`
        );
      }
    } catch (err: any) {
      console.error(`❌ Failed to execute pair entry for ${user.email}:`, err.message);
      await this.recordAccountError(account.id, err.message || 'Failed to execute pair entry');
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

    if (isUnfilledSimulation(position)) {
      const { error } = await supabase.from('bot_positions').delete().eq('id', position.id);
      if (error) {
        console.error(`❌ Failed to discard unfilled simulated position ${position.id}:`, error.message);
      } else {
        console.warn(`🗑️ Discarded unfilled simulated position ${position.pair_symbol} (${position.id}) — never filled on exchange`);
      }
      return;
    }

    try {
      const exchangeClient = createExchangeInstance(account);

      const [sellLong, buyShort] = await Promise.allSettled([
        exchangeClient.createMarketSellOrder(position.long_symbol, position.long_qty),
        exchangeClient.createMarketBuyOrder(position.short_symbol, position.short_qty),
      ]);

      if (sellLong.status !== 'fulfilled' || buyShort.status !== 'fulfilled') {
        const sellErr = sellLong.status === 'rejected' ? String(sellLong.reason?.message || sellLong.reason) : null;
        const buyErr = buyShort.status === 'rejected' ? String(buyShort.reason?.message || buyShort.reason) : null;
        const reasonText = [sellErr, buyErr].filter(Boolean).join(' | ') || 'Exchange rejected close orders';
        console.error(`❌ [EXIT ABORTED] ${position.pair_symbol} not marked closed: ${reasonText}`);
        await this.recordAccountError(account.id, `Failed to close ${position.pair_symbol}: ${reasonText}`);
        return;
      }

      const longPnl = (currentLongPrice - position.long_entry_price) * position.long_qty;
      const shortPnl = (position.short_entry_price - currentShortPrice) * position.short_qty;
      const totalPnlUsd = longPnl + shortPnl;
      const pnlPct = (totalPnlUsd / position.allocated_margin_usd) * 100;
      const exitRatio = currentLongPrice / currentShortPrice;

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
        await this.clearAccountError(account.id);
        console.log(
          `🏁 [EXIT CLOSED] ${position.pair_symbol} PnL: $${totalPnlUsd.toFixed(2)} (${pnlPct.toFixed(2)}%) Reason: ${reason}`
        );
      }
    } catch (err: any) {
      console.error(`❌ Failed to close position ${position.id}:`, err.message);
      await this.recordAccountError(account.id, err.message || 'Failed to close position');
    }
  }

  private async skipEntry(user: UserProfile, account: ExchangeAccount, pairSymbol: string, message: string) {
    await this.recordAccountError(account.id, message);
    const key = `${user.id}:${pairSymbol}`;
    const now = Date.now();
    const last = this.lastSkipLogAt.get(key) || 0;
    if (now - last < SKIP_LOG_COOLDOWN_MS) return;
    this.lastSkipLogAt.set(key, now);
    console.warn(`⏭️ [ENTRY SKIPPED] ${user.email} ${pairSymbol}: ${message}`);
  }

  private async recordAccountError(accountId: string, message: string) {
    await supabase
      .from('exchange_accounts')
      .update({
        last_error_msg: message.slice(0, 500),
        last_sync_at: new Date().toISOString(),
      })
      .eq('id', accountId);
  }

  private async clearAccountError(accountId: string) {
    await supabase.from('exchange_accounts').update({ last_error_msg: null }).eq('id', accountId);
  }
}
