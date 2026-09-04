import { supabase, CONFIG } from '../config.js';
import {
  BotPosition,
  ExchangeAccount,
  ExitReasonType,
  TradingSettings,
  UserProfile,
  ExecutionMode,
} from '../types/index.js';
import { MarketScanner, MarketSignal } from './market-scanner.js';
import { createExchangeInstance } from '../exchanges/exchange-factory.js';
import {
  executePairMarket,
  executePairMakerHedge,
  ensureMarketsLoaded,
  verifyLeverage,
  computePositionEntry,
  computePositionExit,
  PairFillResult,
} from './execution.js';
import { extractUsdtBalance, isUnfilledSimulation, MIN_SLOT_MARGIN_USD } from '../exchanges/balance.js';
import { getExchangeSymbol } from '../exchanges/symbols.js';
import { telegramNotifier } from '../notifications/telegram.js';

const SKIP_LOG_COOLDOWN_MS = 60_000;

export class OrderRouter {
  private scanner: MarketScanner;
  private lastSkipLogAt = new Map<string, number>();
  private lastQuietSkipLogAt = new Map<string, number>();
  private last4hCloseLogAt = new Map<string, number>();
  private inFlightEntries = new Set<string>();

  constructor(scanner: MarketScanner) {
    this.scanner = scanner;
  }

  /**
   * When ENTRY_ON_4H_CLOSE_ONLY is enabled, only allow entries on the first scan tick
   * after a new 4h candle has closed AND its closed ratio is above EMA10.
   * Logs at most once per pair per closed candle to avoid scanner spam.
   */
  private is4hCloseEntryAllowed(signal: MarketSignal): boolean {
    if (!CONFIG.entryOn4hCloseOnly) return true;
    if (!signal.closedCandleIsNew || signal.closedRatio === null || signal.closedRatio <= signal.ema10) {
      const pairSymbol = signal.pairConfig.pairSymbol;
      const candleTs = signal.lastClosedOpenTs ?? 0;
      if (this.last4hCloseLogAt.get(pairSymbol) !== candleTs) {
        this.last4hCloseLogAt.set(pairSymbol, candleTs);
        console.log(
          `🔍 [4H ENTRY MODE] ${pairSymbol}: waiting for new closed candle above EMA10 (new=${signal.closedCandleIsNew}, closedRatio=${signal.closedRatio?.toFixed(6)}, ema10=${signal.ema10.toFixed(6)})`
        );
      }
      return false;
    }
    return true;
  }

  /**
   * Handle entry signal:
   * 1. ALWAYS ensures master platform trade is opened and recorded in DB (regardless of user count)
   * 2. If eligible users exist with active connected exchanges, mirrors orders to their exchange accounts
   *
   * User exchange executions are fired concurrently via Promise.allSettled and are NOT awaited
   * in the scanner path so that market data updates and the PositionGuard keep running.
   */
  public async handleEntrySignal(signal: MarketSignal) {
    if (!signal.isInTrend) return; // Only enter when trend is active (Ratio > EMA10)
    if (!this.is4hCloseEntryAllowed(signal)) return;

    // 1. Always record & manage Master Bot reference position in DB (synchronous, fast)
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

    const entryPromises: Promise<void>[] = [];

    for (const setting of eligibleSettings as any[]) {
      const user: UserProfile = setting.users_profile;
      const account: ExchangeAccount = setting.exchange_accounts;
      const pairSymbol = signal.pairConfig.pairSymbol;
      const inFlightKey = `${user.id}:${pairSymbol}`;

      // In-flight concurrency guard: do not start a second entry attempt for the same key.
      if (this.inFlightEntries.has(inFlightKey)) {
        console.log(`⏳ [ENTRY IN FLIGHT] Skipping ${pairSymbol} for ${user.email} - execution already in progress`);
        continue;
      }

      // Add the key synchronously BEFORE any await in this per-user block.
      this.inFlightEntries.add(inFlightKey);

      const userPromise = (async () => {
        try {
          if (!user || user.is_frozen) return;
          if (!['trial', 'active'].includes(user.subscription_status)) return;

          // Strict requirement: User MUST have an active & validated exchange account connected
          if (!account || !account.is_active || !account.is_validated) {
            // Auto-pause bot if user has no valid exchange keys
            await supabase
              .from('trading_settings')
              .update({ is_bot_active: false })
              .eq('id', setting.id);
            console.warn(`⚠️ [GUARD] Paused bot for ${user.email}: no active validated exchange connected.`);
            return;
          }

          // Check if user already has an OPEN position for this pair
          const { data: existingPos } = await supabase
            .from('bot_positions')
            .select('id')
            .eq('user_id', user.id)
            .eq('pair_symbol', pairSymbol)
            .eq('status', 'open')
            .maybeSingle();

          if (existingPos) {
            // Already in position for this pair
            return;
          }

          // Re-entry guard before opening a new position
          const guardKey = `user:${user.id}:${pairSymbol}`;
          const guard = await this.checkReentryGuard(guardKey, signal, setting, false);
          if (!guard.allow) {
            this.skipEntryQuiet(guardKey, `[REENTRY GUARD] ${user.email} ${pairSymbol}: ${guard.reason}`);
            return;
          }

          // Execute order on user's exchange (do not block the scanner; the outer promise is fire-and-forget)
          await this.executePairEntry(user, account, setting, signal)
            .then(() => {
              console.log(`✅ [ASYNC ENTRY COMPLETE] ${pairSymbol} for ${user.email}`);
            })
            .catch((err: any) => {
              console.error(`❌ [ASYNC ENTRY FAILED] ${pairSymbol} for ${user.email}: ${err.message}`);
            });
        } finally {
          // Remove in-flight key on every path: guard rejection, existing position, or completed execution.
          this.inFlightEntries.delete(inFlightKey);
        }
      })();
      entryPromises.push(userPromise);
    }

    // Fire and forget the user entry batch; individual errors are handled above.
    Promise.allSettled(entryPromises).catch((err: any) => {
      console.error('Unexpected error in async entry batch:', err.message);
    });
  }

  /**
   * Ensure master platform strategy trade is active and recorded in DB
   */
  public async ensureMasterEntry(signal: MarketSignal) {
    if (!this.is4hCloseEntryAllowed(signal)) return;
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

    // Re-entry guard for master benchmark
    const guardKey = `master:${pairSymbol}`;
    const guard = await this.checkReentryGuard(guardKey, signal, null, true);
    if (!guard.allow) {
      this.skipEntryQuiet(guardKey, `[MASTER REENTRY GUARD] ${pairSymbol}: ${guard.reason}`);
      return;
    }

    // Master strategy uses $50,000 reference capital (4 pairs = $12,500 margin per slot, 7x = $87,500 volume)
    const refMargin = 12500;
    const lev = CONFIG.defaultLeverage;
    const vol = refMargin * lev; // 87,500 USDT
    const legVol = vol / 2; // 43,750 USDT per leg

    const longQty = Number((legVol / signal.longPrice).toFixed(8));
    const shortQty = Number((legVol / signal.shortPrice).toFixed(8));

    // Simulated taker fee on each of the 4 legs so master is not fee-free
    const longNotional = longQty * signal.longPrice;
    const shortNotional = shortQty * signal.shortPrice;
    // Master benchmark: simulate taker fees on the 2 entry legs (long + short)
    const entryFeesUsd = Number(((longNotional + shortNotional) * (CONFIG.takerFeePct / 100)).toFixed(4));

    const entryRatio = signal.longPrice / signal.shortPrice;
    const masterRecord: Partial<BotPosition> = {
      is_master: true,
      user_id: null,
      exchange_account_id: null,
      pair_symbol: pairSymbol,
      status: 'open',
      entry_ratio: Number(entryRatio.toFixed(8)),
      current_ratio: Number(entryRatio.toFixed(8)),
      long_symbol: `${signal.pairConfig.longCoin}/USDT`,
      long_entry_price: signal.longPrice,
      long_qty: longQty,
      short_symbol: `${signal.pairConfig.shortCoin}/USDT`,
      short_entry_price: signal.shortPrice,
      short_qty: shortQty,
        allocated_margin_usd: refMargin,
        total_position_volume_usd: vol,
        entry_fees_usd: entryFeesUsd,
        exit_fees_usd: 0,
        execution_mode: CONFIG.entryExecutionMode,
        gross_pnl_usd: 0,
      unrealized_pnl_usd: 0,
      pnl_pct: 0,
      opened_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('bot_positions').insert(masterRecord);
    if (!error) {
      console.log(
        `🐝 [MASTER BOT ENTRY] Recorded new basket trade: ${pairSymbol} @ ratio ${entryRatio.toFixed(4)}`
      );
      telegramNotifier
        .notifyTradeOpened({
          isMaster: true,
          pairSymbol,
          longSymbol: masterRecord.long_symbol!,
          longQty,
          longPrice: signal.longPrice,
          shortSymbol: masterRecord.short_symbol!,
          shortQty,
          shortPrice: signal.shortPrice,
          entryRatio,
          allocatedMargin: refMargin,
          totalVolume: vol,
          leverage: lev,
        })
        .catch((err) => console.error('Telegram notification error:', err.message));
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

    const longNotional = position.long_qty * currentLongPrice;
    const shortNotional = position.short_qty * currentShortPrice;
    // Master benchmark: simulate taker fees on the 2 exit legs (long + short)
    const exitFeesUsd = Number(((longNotional + shortNotional) * (CONFIG.takerFeePct / 100)).toFixed(4));

    const { grossPnlUsd, netPnlUsd, pnlPct } = computePositionExit(
      position,
      currentLongPrice,
      currentShortPrice,
      position.entry_fees_usd || 0,
      exitFeesUsd
    );

    await supabase
      .from('bot_positions')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString(),
        exit_ratio: Number(exitRatio.toFixed(8)),
        long_exit_price: currentLongPrice,
        short_exit_price: currentShortPrice,
        gross_pnl_usd: grossPnlUsd,
        exit_fees_usd: exitFeesUsd,
        realized_pnl_usd: netPnlUsd,
        unrealized_pnl_usd: 0,
        pnl_pct: pnlPct,
        exit_reason: exitReason,
      })
      .eq('id', position.id);

    console.log(
      `🏁 [MASTER BOT EXIT] Closed ${position.pair_symbol} (${exitReason.toUpperCase()}) | Gross: $${grossPnlUsd.toFixed(2)} | Net: ${netPnlUsd >= 0 ? '+' : ''}$${netPnlUsd.toFixed(2)} (${pnlPct}%)`
    );
    telegramNotifier
      .notifyTradeClosed({
        isMaster: true,
        pairSymbol: position.pair_symbol,
        exitReason,
        realizedPnl: netPnlUsd,
        pnlPct,
        allocatedMargin: Number(position.allocated_margin_usd),
        longSymbol: position.long_symbol,
        longEntryPrice: Number(position.long_entry_price),
        longExitPrice: currentLongPrice,
        shortSymbol: position.short_symbol,
        shortEntryPrice: Number(position.short_entry_price),
        shortExitPrice: currentShortPrice,
        entryRatio: Number(position.entry_ratio),
        exitRatio: Number(exitRatio.toFixed(8)),
        openedAt: position.opened_at,
        closedAt: new Date().toISOString(),
      })
      .catch((err) => console.error('Telegram notification error:', err.message));
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
      await ensureMarketsLoaded(exchangeClient, account.id);

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

      const leverage = Number(settings.effective_leverage || CONFIG.defaultLeverage);
      const totalVolume = slotMargin * leverage;
      const legVolume = totalVolume / 2;

      const longQty = legVolume / signal.longPrice;
      const shortQty = legVolume / signal.shortPrice;
      if (longQty <= 0 || shortQty <= 0) {
        await this.skipEntry(
          user,
          account,
          pairSymbol,
          `Calculated order size is zero for ${pairSymbol} (free margin $${freeUsdt.toFixed(2)}).`
        );
        return;
      }

      await verifyLeverage(
        exchangeClient,
        account,
        leverage,
        getExchangeSymbol(signal.pairConfig.longCoin, account.exchange),
        getExchangeSymbol(signal.pairConfig.shortCoin, account.exchange)
      );

      const mode: ExecutionMode = CONFIG.entryExecutionMode;
      let fill: PairFillResult;
      try {
        if (mode === 'maker_hedge') {
          fill = await executePairMakerHedge(exchangeClient, account, {
            pairConfig: signal.pairConfig,
            longQty,
            shortQty,
            longPrice: signal.longPrice,
            shortPrice: signal.shortPrice,
            mode,
            isEntry: true,
          });
        } else {
          fill = await executePairMarket(exchangeClient, account, {
            pairConfig: signal.pairConfig,
            longQty,
            shortQty,
            longPrice: signal.longPrice,
            shortPrice: signal.shortPrice,
            mode,
            isEntry: true,
          });
        }
      } catch (execErr: any) {
        await this.skipEntry(user, account, pairSymbol, `Execution failed: ${execErr.message}`);
        return;
      }

      const entry = computePositionEntry(fill, slotMargin);
      const totalPositionVolume = fill.longFill.qty * fill.longFill.price + fill.shortFill.qty * fill.shortFill.price;

      const newPosition: Partial<BotPosition> = {
        user_id: user.id,
        exchange_account_id: account.id,
        pair_symbol: pairSymbol,
        status: 'open',
        entry_ratio: Number(entry.entryRatio.toFixed(8)),
        current_ratio: Number(entry.entryRatio.toFixed(8)),
        long_symbol: fill.longFill.symbol,
        long_order_id: fill.longFill.orderId,
        long_entry_price: entry.longEntryPrice,
        long_qty: entry.longQty,
        short_symbol: fill.shortFill.symbol,
        short_order_id: fill.shortFill.orderId,
        short_entry_price: entry.shortEntryPrice,
        short_qty: entry.shortQty,
        allocated_margin_usd: slotMargin,
        total_position_volume_usd: Number(totalPositionVolume.toFixed(4)),
        entry_fees_usd: fill.feesUsd,
        exit_fees_usd: 0,
        execution_mode: fill.mode,
        gross_pnl_usd: 0,
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
          `✅ [ENTRY SUCCESS] ${pairSymbol} opened for ${user.email} (Mode: ${fill.mode}, Margin: $${slotMargin.toFixed(2)}, Vol: $${totalVolume.toFixed(2)})`
        );
        telegramNotifier
          .notifyTradeOpened({
            isMaster: false,
            userEmail: user.email,
            exchange: account.exchange,
            accountName: account.account_name,
            pairSymbol,
            longSymbol: fill.longFill.symbol,
            longQty: entry.longQty,
            longPrice: entry.longEntryPrice,
            shortSymbol: fill.shortFill.symbol,
            shortQty: entry.shortQty,
            shortPrice: entry.shortEntryPrice,
            entryRatio: entry.entryRatio,
            allocatedMargin: slotMargin,
            totalVolume,
            leverage,
            takeProfitPct: Number(settings.take_profit_pct),
            stopLossPct: Number(settings.stop_loss_pct),
          })
          .catch((err) => console.error('Telegram notification error:', err.message));
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
        console.warn(
          `🗑️ Discarded unfilled simulated position ${position.pair_symbol} (${position.id}) — never filled on exchange`
        );
      }
      return;
    }

    try {
      const exchangeClient = createExchangeInstance(account);
      await ensureMarketsLoaded(exchangeClient, account.id);

      const mode: ExecutionMode = reason === 'sl' || reason === 'panic_close' ? 'market' : CONFIG.exitExecutionMode;

      let fill: PairFillResult;
      try {
        if (mode === 'maker_hedge') {
          fill = await executePairMakerHedge(exchangeClient, account, {
            pairConfig: {
              pairSymbol: position.pair_symbol,
              longCoin: position.long_symbol.split('/')[0],
              shortCoin: position.short_symbol.split('/')[0],
            },
            longQty: position.long_qty,
            shortQty: position.short_qty,
            longPrice: currentLongPrice,
            shortPrice: currentShortPrice,
            mode,
            isEntry: false,
            reduceOnly: true,
          });
        } else {
          fill = await executePairMarket(exchangeClient, account, {
            pairConfig: {
              pairSymbol: position.pair_symbol,
              longCoin: position.long_symbol.split('/')[0],
              shortCoin: position.short_symbol.split('/')[0],
            },
            longQty: position.long_qty,
            shortQty: position.short_qty,
            longPrice: currentLongPrice,
            shortPrice: currentShortPrice,
            mode,
            isEntry: false,
            reduceOnly: true,
          });
        }
      } catch (execErr: any) {
        console.error(`❌ [EXIT ABORTED] ${position.pair_symbol} not marked closed: ${execErr.message}`);
        await this.recordAccountError(account.id, `Failed to close ${position.pair_symbol}: ${execErr.message}`);
        return;
      }

      const { grossPnlUsd, netPnlUsd, pnlPct, exitRatio } = computePositionExit(
        position,
        fill.longFill.price,
        fill.shortFill.price,
        position.entry_fees_usd || 0,
        fill.feesUsd
      );

      const { error } = await supabase
        .from('bot_positions')
        .update({
          status: 'closed',
          exit_ratio: Number(exitRatio.toFixed(8)),
          long_exit_price: fill.longFill.price,
          short_exit_price: fill.shortFill.price,
          gross_pnl_usd: grossPnlUsd,
          exit_fees_usd: fill.feesUsd,
          realized_pnl_usd: netPnlUsd,
          unrealized_pnl_usd: 0,
          pnl_pct: pnlPct,
          exit_reason: reason,
          closed_at: new Date().toISOString(),
        })
        .eq('id', position.id);

      if (error) {
        console.error(`❌ DB error updating closed position ${position.id}:`, error.message);
      } else {
        await this.clearAccountError(account.id);
        console.log(
          `🏁 [EXIT CLOSED] ${position.pair_symbol} Gross: $${grossPnlUsd.toFixed(2)} | Net: ${netPnlUsd >= 0 ? '+' : ''}$${netPnlUsd.toFixed(2)} (${pnlPct}%) | Reason: ${reason} | Mode: ${mode}`
        );
        telegramNotifier
          .notifyTradeClosed({
            isMaster: false,
            exchange: account.exchange,
            accountName: account.account_name,
            pairSymbol: position.pair_symbol,
            exitReason: reason,
            realizedPnl: netPnlUsd,
            pnlPct,
            allocatedMargin: Number(position.allocated_margin_usd),
            longSymbol: position.long_symbol,
            longEntryPrice: Number(position.long_entry_price),
            longExitPrice: fill.longFill.price,
            shortSymbol: position.short_symbol,
            shortEntryPrice: Number(position.short_entry_price),
            shortExitPrice: fill.shortFill.price,
            entryRatio: Number(position.entry_ratio),
            exitRatio: Number(exitRatio.toFixed(8)),
            openedAt: position.opened_at,
            closedAt: new Date().toISOString(),
          })
          .catch((err) => console.error('Telegram notification error:', err.message));
      }
    } catch (err: any) {
      console.error(`❌ Failed to close position ${position.id}:`, err.message);
      await this.recordAccountError(account.id, err.message || 'Failed to close position');
    }
  }

  /**
   * Re-entry guard for a given key (user+pair or master+pair).
   * Returns { allow: true } if entry is allowed, otherwise { allow: false, reason }.
   */
  private async checkReentryGuard(
    key: string,
    signal: MarketSignal,
    settings: TradingSettings | null,
    isMaster: boolean
  ): Promise<{ allow: boolean; reason: string }> {
    if (!CONFIG.reentryGuardEnabled) return { allow: true, reason: '' };

    const userId = isMaster ? null : settings?.user_id;
    let query = supabase
      .from('bot_positions')
      .select('*')
      .eq('pair_symbol', signal.pairConfig.pairSymbol)
      .eq('status', 'closed')
      .not('closed_at', 'is', null)
      .order('closed_at', { ascending: false, nullsFirst: false })
      .limit(1);

    if (isMaster) {
      query = query.eq('is_master', true);
    } else if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data: lastClosed } = await query.maybeSingle();
    if (!lastClosed) return { allow: true, reason: '' };

    const last = lastClosed as BotPosition;
    if (last.exit_reason !== 'sl') return { allow: true, reason: '' };

    const closedAt = new Date(last.closed_at || 0).getTime();
    if (!Number.isFinite(closedAt) || closedAt <= 0) {
      return { allow: true, reason: '' };
    }

    const now = Date.now();

    // Cooldown rule
    if (now - closedAt < CONFIG.reentryCooldownAfterSlMs) {
      const remainingMin = Math.ceil((CONFIG.reentryCooldownAfterSlMs - (now - closedAt)) / 60000);
      return { allow: false, reason: `SL cooldown active (${remainingMin} min remaining)` };
    }

    // Require new 4h candle close since SL
    if (CONFIG.reentryRequireNew4hClose) {
      const lastClosedOpenTs = this.scanner.getLastClosedOpenTs(signal.pairConfig.pairSymbol);
      if (lastClosedOpenTs !== undefined) {
        // Need at least one 4h candle closed after the SL exit: lastClosedOpenTs + 4h > closed_at
        if (lastClosedOpenTs + 4 * 60 * 60 * 1000 <= closedAt) {
          return { allow: false, reason: 'No new 4h candle closed since last SL' };
        }
      }
    }

    // Hysteresis rule
    const lastExitRatio = last.exit_ratio ?? last.entry_ratio;
    if (!Number.isFinite(lastExitRatio)) {
      return { allow: true, reason: '' };
    }
    const hysteresisThreshold = lastExitRatio * (1 + CONFIG.reentryHysteresisPct / 100);
    if (signal.currentRatio <= hysteresisThreshold) {
      return {
        allow: false,
        reason: `Ratio ${signal.currentRatio.toFixed(4)} not above SL exit ratio ${hysteresisThreshold.toFixed(4)}`,
      };
    }

    // Consecutive SL streak block
    let streakQuery = supabase
      .from('bot_positions')
      .select('*')
      .eq('pair_symbol', signal.pairConfig.pairSymbol)
      .eq('status', 'closed')
      .not('closed_at', 'is', null)
      .order('closed_at', { ascending: false, nullsFirst: false })
      .limit(5);

    if (isMaster) {
      streakQuery = streakQuery.eq('is_master', true);
    } else if (userId) {
      streakQuery = streakQuery.eq('user_id', userId);
    }

    const { data: recentClosed } = await streakQuery;
    if (recentClosed && recentClosed.length > 0) {
      let consecutiveSl = 0;
      for (const pos of recentClosed) {
        if (pos.exit_reason === 'sl') consecutiveSl++;
        else break;
      }
      if (consecutiveSl >= CONFIG.maxConsecutiveSl) {
        const latestSl = recentClosed[0] as BotPosition;
        const latestClosedAt = new Date(latestSl.closed_at || 0).getTime();
        if (now - latestClosedAt < CONFIG.slStreakBlockMs) {
          return {
            allow: false,
            reason: `Consecutive SL streak (${consecutiveSl}) within ${CONFIG.slStreakBlockMs / 3600000}h block window`,
          };
        }
      }
    }

    return { allow: true, reason: '' };
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

  private skipEntryQuiet(key: string, message: string) {
    const now = Date.now();
    const last = this.lastQuietSkipLogAt.get(key) || 0;
    if (now - last < SKIP_LOG_COOLDOWN_MS) return;
    this.lastQuietSkipLogAt.set(key, now);
    console.warn(`⏭️ ${message}`);
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
