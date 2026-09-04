import { CONFIG } from '../config.js';
import { ExchangeAccount, ExecutionMode, LegFillResult, PairFillResult } from '../types/index.js';
import { StrategyPairConfig, getExchangeSymbol } from '../exchanges/symbols.js';

export type { PairFillResult } from '../types/index.js';

export interface ExecutionContext {
  pairConfig: StrategyPairConfig;
  longQty: number;
  shortQty: number;
  longPrice: number;
  shortPrice: number;
  mode: ExecutionMode;
  isEntry: boolean;
  reduceOnly?: boolean;
}

export interface ExchangeClient {
  loadMarkets: () => Promise<any>;
  markets?: Record<string, any>;
  has: Record<string, boolean>;
  amountToPrecision: (symbol: string, amount: number) => string;
  priceToPrecision: (symbol: string, price: number) => string;
  createOrder: (
    symbol: string,
    type: string,
    side: string,
    amount: number,
    price?: number,
    params?: Record<string, any>
  ) => Promise<any>;
  fetchOrder: (id: string, symbol: string) => Promise<any>;
  cancelOrder: (id: string, symbol: string) => Promise<any>;
  fetchOrderBook: (symbol: string, limit?: number) => Promise<any>;
  createMarketBuyOrder: (symbol: string, amount: number, params?: Record<string, any>) => Promise<any>;
  createMarketSellOrder: (symbol: string, amount: number, params?: Record<string, any>) => Promise<any>;
  setLeverage?: (leverage: number, symbol: string) => Promise<any>;
  fetchPositions?: (symbols?: string[]) => Promise<any[]>;
  fetchPosition?: (symbol: string) => Promise<any>;
}

const loadedMarkets = new WeakMap<object, Promise<void>>();

export async function ensureMarketsLoaded(client: ExchangeClient, accountId?: string | null): Promise<void> {
  if (client.markets && Object.keys(client.markets).length > 0) {
    return;
  }
  if (loadedMarkets.has(client)) {
    await loadedMarkets.get(client);
    return;
  }
  const key = accountId || 'anonymous';
  const promise = (async () => {
    try {
      await client.loadMarkets();
      console.log(`📚 Loaded exchange markets for account ${key}`);
    } catch (err: any) {
      console.warn(`⚠️ Failed to load markets for account ${key}: ${err.message}`);
      throw err;
    }
  })();
  loadedMarkets.set(client, promise);
  await promise;
}

export function getMarket(client: ExchangeClient, symbol: string): any {
  if (client.markets && client.markets[symbol]) return client.markets[symbol];
  return null;
}

export function preciseAmount(client: ExchangeClient, symbol: string, amount: number): number {
  try {
    return Number(client.amountToPrecision(symbol, amount));
  } catch {
    return Number(amount.toFixed(8));
  }
}

export function precisePrice(client: ExchangeClient, symbol: string, price: number): number {
  try {
    return Number(client.priceToPrecision(symbol, price));
  } catch {
    return Number(price.toFixed(8));
  }
}

export function validateMinimums(
  client: ExchangeClient,
  symbol: string,
  qty: number,
  price: number
): { ok: boolean; reason?: string } {
  const market = getMarket(client, symbol);
  if (!market) return { ok: true };
  const notional = qty * price;
  const minAmount = market.limits?.amount?.min;
  const minCost = market.limits?.cost?.min;
  if (minAmount !== undefined && minAmount !== null && qty < Number(minAmount)) {
    return { ok: false, reason: `${symbol} qty ${qty} below min amount ${minAmount}` };
  }
  if (minCost !== undefined && minCost !== null && notional < Number(minCost)) {
    return { ok: false, reason: `${symbol} notional $${notional.toFixed(2)} below min cost $${minCost}` };
  }
  return { ok: true };
}

function estimateFeeUsd(notional: number, isMaker: boolean): number {
  const rate = isMaker ? CONFIG.makerFeePct : CONFIG.takerFeePct;
  return Number(((notional * rate) / 100).toFixed(4));
}

function extractFeeUsd(order: any, symbol: string, fillPrice: number, fillQty: number, isMaker: boolean): number {
  const notional = fillPrice * fillQty;

  // Sum fee objects from both unified `fee` and `fees` array (CCXT may return either).
  const feeObjects: any[] = [];
  if (order.fee && typeof order.fee === 'object') feeObjects.push(order.fee);
  if (Array.isArray(order.fees)) feeObjects.push(...order.fees);
  if (feeObjects.length === 0) return estimateFeeUsd(notional, isMaker);

  let totalFeeUsd = 0;
  for (const fee of feeObjects) {
    const feeCurrency = (fee.currency || '').toUpperCase();
    const feeCost = Number(fee.cost || 0);
    if (!feeCurrency || !Number.isFinite(feeCost)) continue;

    if (feeCurrency === 'USDT' || feeCurrency === 'USD') {
      totalFeeUsd += feeCost;
      continue;
    }

    const base = (symbol.split('/')[0] || '').toUpperCase();
    if (feeCurrency === base && fillPrice > 0) {
      totalFeeUsd += feeCost * fillPrice;
      continue;
    }

    // Unknown fee currency: sentinel for caller to estimate and warn.
    return -1;
  }

  if (Number.isFinite(totalFeeUsd) && totalFeeUsd >= 0) {
    return Number(totalFeeUsd.toFixed(4));
  }
  return estimateFeeUsd(notional, isMaker);
}

async function fetchOrderWithFallback(
  client: ExchangeClient,
  orderId: string,
  symbol: string
): Promise<any> {
  if (!client.has['fetchOrder']) return null;
  try {
    return await client.fetchOrder(orderId, symbol);
  } catch (err: any) {
    console.warn(`⚠️ fetchOrder failed for ${symbol} (${orderId}): ${err.message}`);
    return null;
  }
}

function getFillPrice(order: any): number {
  const avg = order.average || order.price || 0;
  if (avg > 0) return Number(avg);
  return 0;
}

function getFillQty(order: any): number {
  // A filled=0 limit order is NOT filled; only fall back to amount when the order is closed.
  if (Number.isFinite(Number(order.filled))) return Number(order.filled);
  if (order.status === 'closed' && Number.isFinite(Number(order.amount))) return Number(order.amount);
  return 0;
}

async function resolveFill(
  order: any,
  client: ExchangeClient,
  symbol: string
): Promise<{ order: any; price: number; qty: number }> {
  let price = getFillPrice(order);
  let qty = getFillQty(order);
  let activeOrder = order;
  if ((!price || !qty) && order.id) {
    const fetched = await fetchOrderWithFallback(client, order.id, symbol);
    if (fetched) {
      activeOrder = fetched;
      price = getFillPrice(fetched) || price;
      qty = getFillQty(fetched) || qty;
    }
  }
  return { order: activeOrder, price, qty };
}

function buildPostOnlyParams(exchange: string): Record<string, any> {
  // Prefer ccxt unified postOnly flag; add exchange-specific fallback only if needed.
  const base: Record<string, any> = { postOnly: true };
  if (exchange === 'bybit') base.timeInForce = 'PostOnly';
  if (exchange === 'binance') base.timeInForce = 'GTX';
  if (exchange === 'okx') base.postOnly = true;
  return base;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface LegFillState {
  orderId: string | null;
  symbol: string;
  side: 'buy' | 'sell';
  targetQty: number;
  filledQty: number;
  weightedNotional: number;
  totalFeeUsd: number;
  orderIds: string[];
  fullyFilled: boolean;
  /** True when the leg is done with what is filled (e.g. remainder below minimum). */
  done: boolean;
  /** Per-orderId filled qty snapshot to correctly compute deltas across reprices. */
  orderFills: Map<string, number>;
}

function createLegState(symbol: string, side: 'buy' | 'sell', targetQty: number): LegFillState {
  return {
    orderId: null,
    symbol,
    side,
    targetQty,
    filledQty: 0,
    weightedNotional: 0,
    totalFeeUsd: 0,
    orderIds: [],
    fullyFilled: false,
    done: false,
    orderFills: new Map(),
  };
}

function recordFillDelta(state: LegFillState, price: number, qty: number, feeUsd: number, orderId: string) {
  if (qty <= 0 || !Number.isFinite(qty)) return;
  state.filledQty += qty;
  state.weightedNotional += qty * price;
  state.totalFeeUsd += feeUsd;
  if (orderId && orderId !== 'unknown') {
    const prev = state.orderFills.get(orderId) ?? 0;
    state.orderFills.set(orderId, prev + qty);
    if (!state.orderIds.includes(orderId)) {
      state.orderIds.push(orderId);
    }
  }
  if (state.filledQty >= state.targetQty * 0.9999) {
    state.fullyFilled = true;
  }
}

function buildLegFillResult(state: LegFillState): LegFillResult {
  const price = state.filledQty > 0 ? state.weightedNotional / state.filledQty : 0;
  return {
    orderId: state.orderIds.join(',') || 'unknown',
    price: Number(price.toFixed(8)),
    qty: Number(state.filledQty.toFixed(8)),
    feeUsd: Number(state.totalFeeUsd.toFixed(4)),
    symbol: state.symbol,
    side: state.side,
  };
}

async function createMarketOrderWithReduceOnlyFallback(
  client: ExchangeClient,
  side: 'buy' | 'sell',
  symbol: string,
  qty: number,
  reduceOnly: boolean
): Promise<any> {
  const params = reduceOnly ? { reduceOnly: true } : undefined;
  try {
    return side === 'buy'
      ? await client.createMarketBuyOrder(symbol, qty, params)
      : await client.createMarketSellOrder(symbol, qty, params);
  } catch (err: any) {
    if (reduceOnly && /reduceOnly|reduce only/i.test(String(err.message))) {
      console.warn(`⚠️ ${symbol} market ${side} rejected reduceOnly param, retrying without it`);
      return side === 'buy'
        ? await client.createMarketBuyOrder(symbol, qty)
        : await client.createMarketSellOrder(symbol, qty);
    }
    throw err;
  }
}

class PostOnlyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PostOnlyError';
  }
}

export async function executePairMarket(
  client: ExchangeClient,
  account: ExchangeAccount,
  ctx: ExecutionContext
): Promise<PairFillResult> {
  await ensureMarketsLoaded(client, account.id);
  const longSym = getExchangeSymbol(ctx.pairConfig.longCoin, account.exchange);
  const shortSym = getExchangeSymbol(ctx.pairConfig.shortCoin, account.exchange);

  const longQty = preciseAmount(client, longSym, ctx.longQty);
  const shortQty = preciseAmount(client, shortSym, ctx.shortQty);

  const longMin = validateMinimums(client, longSym, longQty, ctx.longPrice);
  if (!longMin.ok) throw new Error(longMin.reason);
  const shortMin = validateMinimums(client, shortSym, shortQty, ctx.shortPrice);
  if (!shortMin.ok) throw new Error(shortMin.reason);

  const longSide = ctx.isEntry ? 'buy' : 'sell';
  const shortSide = ctx.isEntry ? 'sell' : 'buy';
  // reduceOnly is used only on EXIT market orders, not on entries.
  const marketReduceOnly = ctx.reduceOnly ?? false;

  const [longResult, shortResult] = await Promise.allSettled([
    longSide === 'buy'
      ? createMarketOrderWithReduceOnlyFallback(client, 'buy', longSym, longQty, marketReduceOnly)
      : createMarketOrderWithReduceOnlyFallback(client, 'sell', longSym, longQty, marketReduceOnly),
    shortSide === 'sell'
      ? createMarketOrderWithReduceOnlyFallback(client, 'sell', shortSym, shortQty, marketReduceOnly)
      : createMarketOrderWithReduceOnlyFallback(client, 'buy', shortSym, shortQty, marketReduceOnly),
  ]);

  if (longResult.status !== 'fulfilled' || shortResult.status !== 'fulfilled') {
    // Unwind any filled leg immediately
    if (longResult.status === 'fulfilled') {
      const order = longResult.value;
      const fill = await resolveFill(order, client, longSym);
      if (fill.qty > 0) {
        const unwindSide = longSide === 'buy' ? 'sell' : 'buy';
        // For entry unwind we close the just-opened leg (reduceOnly). For exit unwind we re-open the leg (no reduceOnly).
        const unwindReduceOnly = ctx.isEntry;
        await createMarketOrderWithReduceOnlyFallback(
          client,
          unwindSide,
          longSym,
          preciseAmount(client, longSym, fill.qty),
          unwindReduceOnly
        ).catch((unwindErr: any) => {
          console.error(`❌ Failed to unwind LONG after partial fill on ${longSym}: ${unwindErr.message}`);
        });
      }
    }
    if (shortResult.status === 'fulfilled') {
      const order = shortResult.value;
      const fill = await resolveFill(order, client, shortSym);
      if (fill.qty > 0) {
        const unwindSide = shortSide === 'buy' ? 'sell' : 'buy';
        const unwindReduceOnly = ctx.isEntry;
        await createMarketOrderWithReduceOnlyFallback(
          client,
          unwindSide,
          shortSym,
          preciseAmount(client, shortSym, fill.qty),
          unwindReduceOnly
        ).catch((unwindErr: any) => {
          console.error(`❌ Failed to unwind SHORT after partial fill on ${shortSym}: ${unwindErr.message}`);
        });
      }
    }
    const longErr = longResult.status === 'rejected' ? String(longResult.reason?.message || longResult.reason) : null;
    const shortErr = shortResult.status === 'rejected' ? String(shortResult.reason?.message || shortResult.reason) : null;
    const reason = [longErr, shortErr].filter(Boolean).join(' | ') || 'Exchange rejected one or both legs';
    throw new Error(reason);
  }

  const longFill = await normalizeLegFill(longResult.value, client, longSym, longSide, false);
  const shortFill = await normalizeLegFill(shortResult.value, client, shortSym, shortSide, false);

  if (!longFill.price || !longFill.qty || !shortFill.price || !shortFill.qty) {
    throw new Error('Exchange returned incomplete fill data for one or both legs');
  }

  const feesUsd = Number((longFill.feeUsd + shortFill.feeUsd).toFixed(4));
  return {
    longFill,
    shortFill,
    mode: 'market',
    feesUsd,
  };
}

export async function executePairMakerHedge(
  client: ExchangeClient,
  account: ExchangeAccount,
  ctx: ExecutionContext
): Promise<PairFillResult> {
  await ensureMarketsLoaded(client, account.id);
  const longSym = getExchangeSymbol(ctx.pairConfig.longCoin, account.exchange);
  const shortSym = getExchangeSymbol(ctx.pairConfig.shortCoin, account.exchange);

  const longQty = preciseAmount(client, longSym, ctx.longQty);
  const shortQty = preciseAmount(client, shortSym, ctx.shortQty);

  const longMin = validateMinimums(client, longSym, longQty, ctx.longPrice);
  if (!longMin.ok) throw new Error(longMin.reason);
  const shortMin = validateMinimums(client, shortSym, shortQty, ctx.shortPrice);
  if (!shortMin.ok) throw new Error(shortMin.reason);

  const reduceOnly = ctx.reduceOnly ? { reduceOnly: true } : {};
  const baseParams = { ...buildPostOnlyParams(account.exchange), ...reduceOnly };
  const deadline = Date.now() + CONFIG.makerTimeoutMs;

  const longSide = ctx.isEntry ? 'buy' : 'sell';
  const shortSide = ctx.isEntry ? 'sell' : 'buy';

  const longState = createLegState(longSym, longSide, longQty);
  const shortState = createLegState(shortSym, shortSide, shortQty);
  let reprices = 0;

  const getLimitBookRef = (book: any, side: 'buy' | 'sell'): number | undefined => {
    // Post-only buy limit rests at the best bid; sell limit rests at the best ask.
    return side === 'buy' ? book?.bids?.[0]?.[0] : book?.asks?.[0]?.[0];
  };
  const getHedgeBookRef = (book: any, side: 'buy' | 'sell'): number | undefined => {
    // Market buy pays the best ask; market sell receives the best bid.
    return side === 'buy' ? book?.asks?.[0]?.[0] : book?.bids?.[0]?.[0];
  };

  const placeLimitOrder = async (state: LegFillState): Promise<void> => {
    if (state.fullyFilled || state.done || state.orderId) return;
    const book = await client.fetchOrderBook(state.symbol, 5).catch((err: any) => {
      console.warn(`⚠️ Order book fetch failed for ${state.symbol}: ${err.message}`);
      return null;
    });
    const ref = getLimitBookRef(book, state.side) ?? (state.symbol === longSym ? ctx.longPrice : ctx.shortPrice);
    const price = precisePrice(client, state.symbol, ref);
    try {
      const order = await client.createOrder(state.symbol, 'limit', state.side, state.targetQty, price, baseParams);
      state.orderId = order.id;
    } catch (err: any) {
      const msg = String(err.message || '');
      if (/postOnly|post-only|PostOnly|Post-Only/i.test(msg)) {
        throw new PostOnlyError(`Post-only rejected for ${state.symbol} @ ${price}: ${msg}`);
      }
      throw err;
    }
  };

  const placeBothLimitOrders = async (): Promise<void> => {
    const errors: { side: string; err: any }[] = [];
    try {
      await placeLimitOrder(longState);
    } catch (err: any) {
      errors.push({ side: 'long', err });
    }
    try {
      await placeLimitOrder(shortState);
    } catch (err: any) {
      errors.push({ side: 'short', err });
    }
    if (errors.length === 0) return;

    // If any non-post-only error occurred, fail cleanly and cancel any sibling order that did place.
    const nonPostOnly = errors.filter((e) => !(e.err instanceof PostOnlyError));
    if (nonPostOnly.length > 0) {
      if (longState.orderId) await cancelAndUpdateState(longState);
      if (shortState.orderId) await cancelAndUpdateState(shortState);
      await unwindIfNeeded();
      throw new Error(
        `Failed to place maker orders: ${errors.map((e) => `${e.side}: ${e.err.message}`).join(' | ')}`
      );
    }

    // Only post-only errors: caller will retry on next loop iteration (counts as a reprice).
    throw new PostOnlyError(`Post-only rejections: ${errors.map((e) => e.side).join(', ')}`);
  };

  const updateStateFromOrder = async (state: LegFillState, order: any) => {
    if (!order) return;
    const normalized = await normalizeLegFill(order, client, state.symbol, state.side, true);
    const orderId = normalized.orderId || order.id || 'unknown';
    const prevOrderQty = state.orderFills.get(orderId) ?? 0;
    const deltaQty = Math.max(0, normalized.qty - prevOrderQty);
    if (deltaQty > 0) {
      const deltaFee = normalized.qty > 0 ? normalized.feeUsd * (deltaQty / normalized.qty) : 0;
      recordFillDelta(state, normalized.price, deltaQty, deltaFee, orderId);
    }
  };

  const cancelAndUpdateState = async (state: LegFillState) => {
    if (!state.orderId) return;
    try {
      await client.cancelOrder(state.orderId, state.symbol);
    } catch (err: any) {
      console.warn(`⚠️ Cancel order ${state.orderId} ${state.symbol} failed: ${err.message}`);
    }
    if (client.has['fetchOrder']) {
      try {
        const order = await client.fetchOrder(state.orderId, state.symbol);
        await updateStateFromOrder(state, order);
      } catch (err: any) {
        console.warn(`⚠️ fetchOrder after cancel failed for ${state.symbol} ${state.orderId}: ${err.message}`);
      }
    }
    state.orderId = null;
  };

  const unwindIfNeeded = async () => {
    // If any leg was filled but the pair could not be completed, market-close the filled amount
    // of each leg to avoid unrecorded one-sided exposure.
    if (longState.filledQty > 0) {
      const unwindSide = longState.side === 'buy' ? 'sell' : 'buy';
      console.error(`❌ [UNWIND] ${longState.symbol} filled ${longState.filledQty} but pair failed; closing leg`);
      try {
        await createMarketOrderWithReduceOnlyFallback(
          client,
          unwindSide,
          longState.symbol,
          preciseAmount(client, longState.symbol, longState.filledQty),
          ctx.isEntry
        );
      } catch (err: any) {
        console.error(`❌ [UNWIND FAILED] ${longState.symbol}: ${err.message}`);
      }
    }
    if (shortState.filledQty > 0) {
      const unwindSide = shortState.side === 'buy' ? 'sell' : 'buy';
      console.error(`❌ [UNWIND] ${shortState.symbol} filled ${shortState.filledQty} but pair failed; closing leg`);
      try {
        await createMarketOrderWithReduceOnlyFallback(
          client,
          unwindSide,
          shortState.symbol,
          preciseAmount(client, shortState.symbol, shortState.filledQty),
          ctx.isEntry
        );
      } catch (err: any) {
        console.error(`❌ [UNWIND FAILED] ${shortState.symbol}: ${err.message}`);
      }
    }
  };

  const hedgeAndFinalize = async (firstLeg: LegFillState, secondLeg: LegFillState) => {
    await cancelAndUpdateState(secondLeg);
    const firstAvgPrice = firstLeg.filledQty > 0 ? firstLeg.weightedNotional / firstLeg.filledQty : 0;
    const firstNotional = firstLeg.filledQty * firstAvgPrice;
    const secondNotional = secondLeg.filledQty > 0 ? secondLeg.weightedNotional : 0;
    const remainingNotional = Math.max(0, firstNotional - secondNotional);

    if (remainingNotional > 0.01) {
      const book = await client.fetchOrderBook(secondLeg.symbol, 5).catch(() => null);
      const ref =
        getHedgeBookRef(book, secondLeg.side) ??
        (secondLeg.symbol === longSym ? ctx.longPrice : ctx.shortPrice);
      const hedgeQty = preciseAmount(client, secondLeg.symbol, remainingNotional / ref);
      if (hedgeQty > 0) {
        try {
          const hedgeOrder = await createMarketOrderWithReduceOnlyFallback(
            client,
            secondLeg.side,
            secondLeg.symbol,
            hedgeQty,
            ctx.reduceOnly ?? false
          );
          await updateStateFromOrder(secondLeg, hedgeOrder);
        } catch (err: any) {
          console.error(
            `❌ [HEDGE FAILED] ${secondLeg.symbol} ${secondLeg.side} qty ${hedgeQty}: ${err.message}`
          );
          // Unwind the filled first leg to avoid one-sided exposure, then fail.
          const unwindSide = firstLeg.side === 'buy' ? 'sell' : 'buy';
          console.error(`❌ [UNWIND] ${firstLeg.symbol} filled ${firstLeg.filledQty}; closing leg`);
          try {
            await createMarketOrderWithReduceOnlyFallback(
              client,
              unwindSide,
              firstLeg.symbol,
              preciseAmount(client, firstLeg.symbol, firstLeg.filledQty),
              ctx.isEntry
            );
          } catch (unwindErr: any) {
            console.error(`❌ [UNWIND FAILED] ${firstLeg.symbol}: ${unwindErr.message}`);
          }
          throw new Error(`Hedge failed for ${secondLeg.symbol}: ${err.message}`);
        }
      }
    }

    if (firstLeg.filledQty > 0) {
      firstLeg.fullyFilled = true;
    }
    if (secondLeg.filledQty > 0) {
      secondLeg.fullyFilled = true;
    }

    if (firstLeg.filledQty === 0 || secondLeg.filledQty === 0) {
      // One leg ended up with zero fill after hedging: unwind any filled quantity and fail.
      await unwindIfNeeded();
      throw new Error(
        `Hedge produced zero filled qty: ${firstLeg.symbol}=${firstLeg.filledQty}, ${secondLeg.symbol}=${secondLeg.filledQty}`
      );
    }
  };

  const checkShouldReprice = async (state: LegFillState): Promise<boolean> => {
    if (!state.orderId || state.fullyFilled) return false;
    const book = await client.fetchOrderBook(state.symbol, 5).catch(() => null);
    const ref = getLimitBookRef(book, state.side);
    if (!ref) return false;
    const market = getMarket(client, state.symbol);
    const tick = market?.tickSize || ref * 0.0001;
    // Need the currently placed price; fetch the order if available.
    let currentPrice = ref;
    if (client.has['fetchOrder']) {
      try {
        const order = await client.fetchOrder(state.orderId, state.symbol);
        currentPrice = order?.price || ref;
      } catch {}
    }
    return Math.abs(ref - currentPrice) > tick;
  };

  const isLegDone = (state: LegFillState) => state.fullyFilled || state.done;

  const prepareLegReprice = (state: LegFillState, originalQty: number, referencePrice: number): boolean => {
    const remaining = Math.max(0, originalQty - state.filledQty);
    const preciseRemaining = preciseAmount(client, state.symbol, remaining);
    if (preciseRemaining <= 0) {
      state.targetQty = state.filledQty;
      state.done = true;
      return false;
    }
    const validation = validateMinimums(client, state.symbol, preciseRemaining, referencePrice);
    if (!validation.ok) {
      console.log(
        `ℹ️ [MAKER REPRICE] ${state.symbol} remainder ${preciseRemaining} below minimum (${validation.reason}); marking leg done with filled ${state.filledQty}`
      );
      state.targetQty = state.filledQty;
      state.done = true;
      return false;
    }
    state.targetQty = preciseRemaining;
    return true;
  };

  const applyReduction = (state: LegFillState, qty: number, price: number) => {
    if (qty <= 0 || !Number.isFinite(qty)) return;
    const actualQty = Math.min(qty, state.filledQty);
    if (actualQty <= 0) return;
    state.filledQty -= actualQty;
    state.weightedNotional -= actualQty * price;
    if (state.weightedNotional < 0) state.weightedNotional = 0;
    if (state.filledQty < state.targetQty * 0.9999) {
      state.fullyFilled = false;
    }
  };

  const balancePartialFills = async () => {
    // The smaller filled notional defines the pair size; reduce the larger leg if needed.
    const longNtl = longState.weightedNotional;
    const shortNtl = shortState.weightedNotional;
    if (longNtl <= 0.01 || shortNtl <= 0.01) return;
    if (Math.abs(longNtl - shortNtl) <= 0.01) return;
    const [bigState, smallState] = longNtl > shortNtl ? [longState, shortState] : [shortState, longState];
    const excessNtl = bigState.weightedNotional - smallState.weightedNotional;
    const excessPrice = bigState.filledQty > 0 ? bigState.weightedNotional / bigState.filledQty : 0;
    if (excessPrice <= 0) return;
    const excessQty = preciseAmount(client, bigState.symbol, excessNtl / excessPrice);
    if (excessQty <= 0) return;
    const reduceSide = bigState.side === 'buy' ? 'sell' : 'buy';
    console.log(
      `🔄 [BALANCE] ${bigState.symbol} excess notional $${excessNtl.toFixed(2)}; reducing ${excessQty}`
    );
    try {
      const reduceOrder = await createMarketOrderWithReduceOnlyFallback(
        client,
        reduceSide,
        bigState.symbol,
        excessQty,
        ctx.isEntry
      );
      const reduceFill = await normalizeLegFill(reduceOrder, client, bigState.symbol, reduceSide, false);
      applyReduction(bigState, reduceFill.qty, reduceFill.price);
      bigState.totalFeeUsd += reduceFill.feeUsd;
    } catch (err: any) {
      console.error(`❌ [BALANCE FAILED] ${bigState.symbol}: ${err.message}`);
      throw new Error(`Failed to balance partial fills on ${bigState.symbol}: ${err.message}`);
    }
  };

  // Initial placement
  try {
    await placeBothLimitOrders();
  } catch (err: any) {
    if (!(err instanceof PostOnlyError)) throw err;
  }

  while (Date.now() < deadline) {
    await sleep(CONFIG.makerPollMs);

    // If an order is missing (post-only retry or after reprice), try to place it.
    if ((!longState.orderId && !isLegDone(longState)) || (!shortState.orderId && !isLegDone(shortState))) {
      if (reprices >= CONFIG.makerMaxReprices) {
        await cancelAndUpdateState(longState);
        await cancelAndUpdateState(shortState);
        await unwindIfNeeded();
        throw new Error('Max reprice attempts reached');
      }
      try {
        await placeBothLimitOrders();
        reprices++;
        continue;
      } catch (err: any) {
        if (err instanceof PostOnlyError) {
          reprices++;
          continue;
        }
        await unwindIfNeeded();
        throw err;
      }
    }

    // Poll both orders
    const [longOrder, shortOrder] = await Promise.all([
      client.has['fetchOrder'] && longState.orderId ? client.fetchOrder(longState.orderId, longSym) : null,
      client.has['fetchOrder'] && shortState.orderId ? client.fetchOrder(shortState.orderId, shortSym) : null,
    ]);

    await updateStateFromOrder(longState, longOrder);
    await updateStateFromOrder(shortState, shortOrder);

    // Hedge-on-fill (or done-with-what-is-filled)
    if (isLegDone(longState) && !isLegDone(shortState)) {
      await hedgeAndFinalize(longState, shortState);
      break;
    }
    if (isLegDone(shortState) && !isLegDone(longState)) {
      await hedgeAndFinalize(shortState, longState);
      break;
    }
    if (isLegDone(longState) && isLegDone(shortState)) break;

    // Reprice if best price moved away by more than one tick
    if (reprices < CONFIG.makerMaxReprices) {
      try {
        const [longReprice, shortReprice] = await Promise.all([
          checkShouldReprice(longState),
          checkShouldReprice(shortState),
        ]);
        if (longReprice || shortReprice) {
          await cancelAndUpdateState(longState);
          await cancelAndUpdateState(shortState);
          // Cancel may have revealed a fill; handle hedge immediately.
          if (isLegDone(longState) && !isLegDone(shortState)) {
            await hedgeAndFinalize(longState, shortState);
            break;
          }
          if (isLegDone(shortState) && !isLegDone(longState)) {
            await hedgeAndFinalize(shortState, longState);
            break;
          }
          // Compute precise remainders and mark legs done if the remainder is below minimums.
          const [longBook, shortBook] = await Promise.all([
            client.fetchOrderBook(longSym, 5).catch(() => null),
            client.fetchOrderBook(shortSym, 5).catch(() => null),
          ]);
          const longRef = getLimitBookRef(longBook, longState.side) ?? ctx.longPrice;
          const shortRef = getLimitBookRef(shortBook, shortState.side) ?? ctx.shortPrice;
          const longPlaceable = prepareLegReprice(longState, longQty, longRef);
          const shortPlaceable = prepareLegReprice(shortState, shortQty, shortRef);

          if (isLegDone(longState) && isLegDone(shortState)) {
            // Both legs are done with partial fills; balance to the smaller notional.
            await balancePartialFills();
            break;
          }

          if (!longPlaceable && !shortPlaceable) {
            // Neither leg can be repriced; both are already done and balanced above.
            break;
          }

          longState.orderId = null;
          shortState.orderId = null;
          reprices++;
          console.log(`🔄 Maker order repriced for ${ctx.pairConfig.pairSymbol} (reprice #${reprices})`);
        }
      } catch (err: any) {
        console.warn(`⚠️ Error repricing maker orders for ${ctx.pairConfig.pairSymbol}: ${err.message}`);
      }
    }
  }

  // Timeout cleanup
  if (!isLegDone(longState) && longState.orderId) await cancelAndUpdateState(longState);
  if (!isLegDone(shortState) && shortState.orderId) await cancelAndUpdateState(shortState);

  // If one leg is done while the other is not, hedge the remaining leg to the done leg's notional.
  if (isLegDone(longState) && !isLegDone(shortState)) {
    await hedgeAndFinalize(longState, shortState);
  } else if (isLegDone(shortState) && !isLegDone(longState)) {
    await hedgeAndFinalize(shortState, longState);
  }

  if (isLegDone(longState) && isLegDone(shortState)) {
    // Both legs are done; ensure final notionals are balanced to the smaller one.
    await balancePartialFills();
  }

  if (!isLegDone(longState) || !isLegDone(shortState)) {
    await unwindIfNeeded();
    throw new Error(
      longState.filledQty === 0 && shortState.filledQty === 0
        ? 'Maker orders timed out with no fills'
        : 'Maker orders did not fully fill both legs'
    );
  }

  const longFill = buildLegFillResult(longState);
  const shortFill = buildLegFillResult(shortState);

  if (longFill.qty <= 0 || longFill.price <= 0 || shortFill.qty <= 0 || shortFill.price <= 0) {
    await unwindIfNeeded();
    throw new Error(
      `Maker-hedge leg assertion failed: long qty=${longFill.qty} price=${longFill.price}, short qty=${shortFill.qty} price=${shortFill.price}`
    );
  }

  return {
    longFill,
    shortFill,
    mode: 'maker_hedge',
    feesUsd: Number((longState.totalFeeUsd + shortState.totalFeeUsd).toFixed(4)),
  };
}

async function normalizeLegFill(
  order: any,
  client: ExchangeClient,
  symbol: string,
  side: 'buy' | 'sell',
  isMaker: boolean
): Promise<LegFillResult> {
  const fill = await resolveFill(order, client, symbol);
  const activeOrder = fill.order;
  const price = fill.price || activeOrder.price || 0;
  const qty = fill.qty || activeOrder.amount || 0;
  const notional = price * qty;
  let feeUsd = extractFeeUsd(activeOrder, symbol, price, qty, isMaker);
  if (feeUsd < 0) {
    // Unknown fee currency: estimate with taker rate and warn
    feeUsd = estimateFeeUsd(notional, false);
    console.warn(
      `⚠️ Unknown fee currency for ${symbol} order ${activeOrder.id}: fee ${JSON.stringify(activeOrder.fee)}. Estimated fee $${feeUsd}.`
    );
  }

  // Fallback if exchange still returned nothing
  if (!price || !qty) {
    console.warn(`⚠️ No fill price/qty returned for ${symbol} order ${activeOrder.id}; using signal values`);
  }

  return {
    orderId: activeOrder.id || 'unknown',
    price: Number(price.toFixed(8)),
    qty: Number(qty.toFixed(8)),
    feeUsd: Number(feeUsd.toFixed(4)),
    symbol,
    side,
  };
}

export function computePositionEntry(
  fill: PairFillResult,
  allocatedMargin: number
): {
  entryRatio: number;
  longEntryPrice: number;
  shortEntryPrice: number;
  longQty: number;
  shortQty: number;
} {
  return {
    entryRatio: fill.longFill.price / fill.shortFill.price,
    longEntryPrice: fill.longFill.price,
    shortEntryPrice: fill.shortFill.price,
    longQty: fill.longFill.qty,
    shortQty: fill.shortFill.qty,
  };
}

export function computePositionExit(
  position: { long_entry_price: number; short_entry_price: number; long_qty: number; short_qty: number; allocated_margin_usd: number },
  longExitPrice: number,
  shortExitPrice: number,
  entryFeesUsd: number,
  exitFeesUsd: number
): { grossPnlUsd: number; netPnlUsd: number; pnlPct: number; exitRatio: number } {
  const longGross = (longExitPrice - position.long_entry_price) * position.long_qty;
  const shortGross = (position.short_entry_price - shortExitPrice) * position.short_qty;
  const grossPnlUsd = longGross + shortGross;
  const netPnlUsd = grossPnlUsd - entryFeesUsd - exitFeesUsd;
  const pnlPct = (netPnlUsd / position.allocated_margin_usd) * 100;
  return {
    grossPnlUsd: Number(grossPnlUsd.toFixed(4)),
    netPnlUsd: Number(netPnlUsd.toFixed(4)),
    pnlPct: Number(pnlPct.toFixed(2)),
    exitRatio: longExitPrice / shortExitPrice,
  };
}

export async function verifyLeverage(
  client: ExchangeClient,
  account: ExchangeAccount,
  leverage: number,
  longSym: string,
  shortSym: string
): Promise<void> {
  if (client.setLeverage) {
    try {
      await client.setLeverage(leverage, longSym);
      await client.setLeverage(leverage, shortSym);
    } catch (err: any) {
      console.warn(`⚠️ setLeverage warning for ${account.exchange} (${longSym}/${shortSym}): ${err.message}`);
    }
  }

  let actualLongLev: number | undefined;
  let actualShortLev: number | undefined;

  if (client.fetchPositions) {
    try {
      const positions = await client.fetchPositions([longSym, shortSym]);
      for (const p of positions) {
        const sym = p.symbol || p.market?.symbol;
        const lev = p.leverage || p.info?.leverage;
        if (Number.isFinite(lev)) {
          if (sym === longSym) actualLongLev = Number(lev);
          if (sym === shortSym) actualShortLev = Number(lev);
        }
      }
    } catch (err: any) {
      console.warn(`⚠️ fetchPositions warning for ${account.exchange}: ${err.message}`);
    }
  } else if (client.fetchPosition) {
    try {
      const lp = await client.fetchPosition(longSym);
      if (lp?.leverage) actualLongLev = Number(lp.leverage);
    } catch {}
    try {
      const sp = await client.fetchPosition(shortSym);
      if (sp?.leverage) actualShortLev = Number(sp.leverage);
    } catch {}
  }

  if (actualLongLev !== undefined && actualLongLev !== leverage) {
    console.warn(`⚠️ ${longSym} leverage mismatch: requested ${leverage}x, actual ${actualLongLev}x on ${account.exchange}`);
  }
  if (actualShortLev !== undefined && actualShortLev !== leverage) {
    console.warn(`⚠️ ${shortSym} leverage mismatch: requested ${leverage}x, actual ${actualShortLev}x on ${account.exchange}`);
  }
}
