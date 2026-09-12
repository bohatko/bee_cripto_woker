import { CONFIG, supabase } from '../config.js';
import {
  ExchangeAccount,
  SignalEvent,
  SignalPosition,
  UserProfile,
  UserSignalSettings,
} from '../types/index.js';
import { DipSignalPayload } from './dip-buy-scanner.js';
import { DipBuyExecution } from './dip-buy-execution.js';
import { createExchangeInstance } from '../exchanges/exchange-factory.js';
import { extractUsdtBalance } from '../exchanges/balance.js';
import { telegramNotifier } from '../notifications/telegram.js';

export class DipBuyRouter {
  private inFlightEntries = new Set<string>();

  /**
   * Handle fired signal:
   * 1. Send telegram alert to subscribers that signal fired
   * 2. Ensure master paper entry is created in signal_positions
   * 3. Fan-out execution to all users who have is_enabled = true
   */
  public async handleSignal(event: DipSignalPayload): Promise<void> {
    console.log(`📡 [DipBuyRouter] Processing signal for ${event.symbol} (Event ID: ${event.signalEventId})`);

    // 1. Fetch user ids subscribed to readiness/signals alerts
    try {
      const { data: subscribers } = await supabase
        .from('user_signal_settings')
        .select('user_id')
        .eq('strategy_id', event.strategyId)
        .eq('alert_readiness_enabled', true);

      const targetUids = subscribers ? (subscribers as any[]).map((s) => s.user_id) : [];
      await telegramNotifier.notifySignalFired(
        {
          symbol: event.symbol,
          signal_close: event.signalClose,
          rolling_max: event.rollingMax,
          drop_pct: event.dropPct,
          reference_entry_price: event.referenceEntryPrice,
        },
        targetUids
      );
    } catch (e: any) {
      console.warn('⚠️ [DipBuyRouter] Failed to broadcast signal fired alert:', e?.message || e);
    }

    // 2. Master Paper Entry
    await this.ensureMasterEntry(event);

    // 3. Real User Fan-out
    await this.fanOutToUsers(event);
  }

  /**
   * Creates or records Master Paper position in DB
   */
  public async ensureMasterEntry(event: DipSignalPayload): Promise<void> {
    // Check if there is already an open master position for this strategy
    const { data: existingOpen, error: checkErr } = await supabase
      .from('signal_positions')
      .select('id')
      .eq('strategy_id', event.strategyId)
      .eq('is_master', true)
      .eq('status', 'open')
      .maybeSingle();

    if (checkErr) {
      console.error('❌ [DipBuyRouter] Error checking master position:', checkErr.message);
      return;
    }

    if (existingOpen) {
      console.log('ℹ️ [DipBuyRouter] Master position is already open. Skipping master entry.');
      return;
    }

    // Load strategy config & leverage
    const { data: strat } = await supabase
      .from('signal_strategies')
      .select('leverage, config')
      .eq('id', event.strategyId)
      .maybeSingle();

    const stratConfig = (strat?.config as any) || {};
    const leverage = Number(strat?.leverage || CONFIG.dipLeverage);
    const tpPct = Number(stratConfig.tp_pct || CONFIG.dipTpPct);
    const slPct = Number(stratConfig.sl_pct || CONFIG.dipSlPct);

    // Master Paper math:
    // Entry price with 0.05% slippage
    const paperEntryPrice = Number((event.referenceEntryPrice * (1 + CONFIG.dipPaperSlippagePct / 100)).toFixed(4));
    const allocatedMargin = Number(stratConfig.reference_margin_usd || CONFIG.dipReferenceMarginUsd); // $20,000 reference
    const notional = allocatedMargin * leverage;
    const qty = Number((notional / paperEntryPrice).toFixed(4));

    const tpPrice = Number((paperEntryPrice * (1 + tpPct / 100)).toFixed(4));
    const slPrice = Number((paperEntryPrice * (1 - slPct / 100)).toFixed(4));

    const entryFee = Number(((notional * (CONFIG.dipPaperFeePct / 100))).toFixed(4));

    const { data: inserted, error: insertErr } = await supabase
      .from('signal_positions')
      .insert({
        signal_event_id: event.signalEventId,
        strategy_id: event.strategyId,
        is_master: true,
        symbol: event.symbol,
        side: 'long',
        status: 'open',
        leverage,
        allocated_margin_usd: allocatedMargin,
        notional_usd: notional,
        qty,
        entry_price: paperEntryPrice,
        tp_price: tpPrice,
        sl_price: slPrice,
        entry_fees_usd: entryFee,
        opened_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error('❌ [DipBuyRouter] Failed to insert master position:', insertErr.message);
      return;
    }

    console.log(`👑 [DipBuyRouter] Opened Master Paper Position #${inserted.id}: ${qty} ${event.symbol} @ $${paperEntryPrice}`);

    // Notify Admins
    await telegramNotifier.notifySignalOpened({
      isMaster: true,
      symbol: event.symbol,
      entryPrice: paperEntryPrice,
      qty,
      allocatedMargin,
      notional,
      leverage,
      tpPrice,
      slPrice,
    });
  }

  /**
   * Fan out live trades to users with active settings
   */
  public async fanOutToUsers(event: DipSignalPayload): Promise<void> {
    // 1. Query users with active signal settings
    const { data: activeSettings, error } = await supabase
      .from('user_signal_settings')
      .select('*, users_profile(*, trading_settings(*, exchange_accounts(*)))')
      .eq('strategy_id', event.strategyId)
      .eq('is_enabled', true);

    if (error || !activeSettings || activeSettings.length === 0) {
      console.log('ℹ️ [DipBuyRouter] No active user subscriptions for dip-buy.');
      return;
    }

    const tasks: Promise<void>[] = [];

    for (const item of activeSettings as any[]) {
      const user = item.users_profile;
      const settings: UserSignalSettings = item;
      const tSettings = Array.isArray(user?.trading_settings) ? user.trading_settings[0] : user?.trading_settings;
      const account: ExchangeAccount = tSettings?.exchange_accounts;

      if (!user || !account) continue;

      const inFlightKey = `${user.id}:${event.symbol}`;
      if (this.inFlightEntries.has(inFlightKey)) continue;

      this.inFlightEntries.add(inFlightKey);

      tasks.push(
        (async () => {
          try {
            await this.executeUserEntry(event, user, settings, account);
          } catch (err: any) {
            console.error(`❌ [DipBuyRouter] User entry error for ${user.email}:`, err?.message || err);
          } finally {
            this.inFlightEntries.delete(inFlightKey);
          }
        })()
      );
    }

    await Promise.allSettled(tasks);
  }

  private async executeUserEntry(
    event: DipSignalPayload,
    user: UserProfile,
    settings: UserSignalSettings,
    account: ExchangeAccount
  ): Promise<void> {
    // 1. Guard checks: frozen, subscription status, account validation
    if (user.is_frozen || user.subscription_status === 'frozen' || user.subscription_status === 'expired') {
      console.log(`⛔ [DipBuyRouter] User ${user.email} is frozen/expired. Skipping.`);
      return;
    }

    if (!account.is_validated || !account.is_active || account.can_withdraw || !account.can_trade_futures) {
      console.log(`⛔ [DipBuyRouter] Account for ${user.email} is not valid/active for futures. Auto-disabling signal toggle.`);
      await supabase
        .from('user_signal_settings')
        .update({ is_enabled: false })
        .eq('id', settings.id);
      return;
    }

    // 2. Check if user already has open signal position for this symbol
    const { data: openUserSignal } = await supabase
      .from('signal_positions')
      .select('id')
      .eq('user_id', user.id)
      .eq('symbol', event.symbol)
      .eq('status', 'open')
      .maybeSingle();

    if (openUserSignal) {
      console.log(`ℹ️ [DipBuyRouter] User ${user.email} already has open signal position. Skipping.`);
      return;
    }

    // 3. One-Way position mode guard: check if user has open bot_positions with the same coin leg
    const { data: openBotPositions } = await supabase
      .from('bot_positions')
      .select('id, long_symbol, short_symbol')
      .eq('user_id', user.id)
      .eq('status', 'open');

    if (openBotPositions && openBotPositions.length > 0) {
      const symUpper = event.symbol.toUpperCase();
      const hasConflictingLeg = (openBotPositions as any[]).some((bp) => {
        const l = (bp.long_symbol || '').toUpperCase();
        const s = (bp.short_symbol || '').toUpperCase();
        return l.includes(symUpper) || s.includes(symUpper);
      });

      if (hasConflictingLeg) {
        console.warn(`⚠️ [DipBuyRouter] User ${user.email} has open pair position containing ${symUpper} leg. Skipping to avoid one-way hedge conflict.`);
        return;
      }
    }

    // 4. Initialize exchange client
    const client = createExchangeInstance(account);
    const ccxtSymbol = `${event.symbol}/USDT:USDT`;

    // Fetch free futures balance
    const balance = await client.fetchBalance({ type: 'future' });
    const balanceInfo = extractUsdtBalance(balance);
    const freeUsdt = balanceInfo.free;

    const balancePct = Number(settings.balance_pct || 50);
    const allocatedMargin = Number(((freeUsdt * balancePct) / 100).toFixed(2));

    if (allocatedMargin < CONFIG.dipMinMarginUsd) {
      console.log(`⚠️ [DipBuyRouter] User ${user.email} free margin $${freeUsdt} * ${balancePct}% = $${allocatedMargin} < min $${CONFIG.dipMinMarginUsd}. Skipping.`);
      return;
    }

    // Load strategy config & leverage
    const { data: strat } = await supabase
      .from('signal_strategies')
      .select('leverage, config')
      .eq('id', event.strategyId)
      .maybeSingle();

    const stratConfig = (strat?.config as any) || {};
    const leverage = Number(strat?.leverage || CONFIG.dipLeverage);
    const tpPct = Number(stratConfig.tp_pct || CONFIG.dipTpPct);
    const slPct = Number(stratConfig.sl_pct || CONFIG.dipSlPct);

    const notional = allocatedMargin * leverage;
    const approxQty = notional / event.referenceEntryPrice;

    // 5. Prepare leverage & margin mode
    await DipBuyExecution.prepareMarket(client, ccxtSymbol, leverage);

    // 6. Execute market buy
    console.log(`⚡ [DipBuyRouter] Executing LIVE entry for ${user.email}: ${approxQty.toFixed(4)} ${event.symbol} (~$${notional})`);
    let fillResult: any;
    try {
      fillResult = await DipBuyExecution.marketBuy(client, ccxtSymbol, approxQty, event.referenceEntryPrice);
    } catch (execErr: any) {
      console.error(`❌ [DipBuyRouter] Market Buy failed for ${user.email}: ${execErr.message}`);
      return;
    }

    const actualEntryPrice = fillResult.price;
    const actualQty = fillResult.qty;
    const actualNotional = actualEntryPrice * actualQty;
    const actualMargin = Number((actualNotional / leverage).toFixed(4));
    const entryFee = fillResult.feeUsd;

    const tpPrice = Number((actualEntryPrice * (1 + tpPct / 100)).toFixed(4));
    const slPrice = Number((actualEntryPrice * (1 - slPct / 100)).toFixed(4));

    // 7. Place native reduce-only TP/SL conditional orders
    let tpOrderId: string | null = null;
    let slOrderId: string | null = null;
    let lastError: string | null = null;

    try {
      tpOrderId = await DipBuyExecution.placeTakeProfit(client, ccxtSymbol, actualQty, tpPrice);
    } catch (tpErr: any) {
      lastError = `TP order failed: ${tpErr.message}`;
      console.warn(`⚠️ [DipBuyRouter] Native TP order placement failed for ${user.email}: ${tpErr.message}`);
    }

    try {
      slOrderId = await DipBuyExecution.placeStopLoss(client, ccxtSymbol, actualQty, slPrice);
    } catch (slErr: any) {
      lastError = lastError ? `${lastError}; SL order failed: ${slErr.message}` : `SL order failed: ${slErr.message}`;
      console.warn(`⚠️ [DipBuyRouter] Native SL order placement failed for ${user.email}: ${slErr.message}`);
    }

    // 8. Insert into signal_positions
    const { data: posRow, error: posErr } = await supabase
      .from('signal_positions')
      .insert({
        signal_event_id: event.signalEventId,
        strategy_id: event.strategyId,
        user_id: user.id,
        exchange_account_id: account.id,
        is_master: false,
        symbol: event.symbol,
        side: 'long',
        status: 'open',
        leverage,
        allocated_margin_usd: actualMargin,
        notional_usd: actualNotional,
        qty: actualQty,
        entry_price: actualEntryPrice,
        entry_order_id: fillResult.orderId,
        tp_price: tpPrice,
        sl_price: slPrice,
        tp_order_id: tpOrderId,
        sl_order_id: slOrderId,
        entry_fees_usd: entryFee,
        last_error: lastError,
        opened_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (posErr) {
      console.error(`❌ [DipBuyRouter] Failed to record user position in DB: ${posErr.message}`);
    }

    // 9. Send Telegram notification to user
    await telegramNotifier.notifySignalOpened({
      isMaster: false,
      userId: user.id,
      userEmail: user.email,
      exchange: account.exchange,
      accountName: account.account_name,
      symbol: event.symbol,
      entryPrice: actualEntryPrice,
      qty: actualQty,
      allocatedMargin: actualMargin,
      notional: actualNotional,
      leverage,
      tpPrice,
      slPrice,
    });
  }
}
