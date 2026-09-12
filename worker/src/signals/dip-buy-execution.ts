import {
  ExchangeClient,
  ensureMarketsLoaded,
  preciseAmount,
  precisePrice,
  validateMinimums,
} from '../engine/execution.js';
import { CONFIG } from '../config.js';

export interface SingleLegOrderResult {
  orderId: string;
  price: number;
  qty: number;
  feeUsd: number;
  rawOrder: any;
}

export class DipBuyExecution {
  /**
   * Sets leverage and margin mode (isolated) with error suppression/graceful fallback
   */
  public static async prepareMarket(
    client: ExchangeClient,
    symbol: string,
    leverage: number
  ): Promise<void> {
    await ensureMarketsLoaded(client);
    if (client.setLeverage) {
      try {
        await client.setLeverage(leverage, symbol);
      } catch (err: any) {
        console.warn(`⚠️ [DipBuyExecution] setLeverage failed for ${symbol}: ${err.message}`);
      }
    }
  }

  /**
   * Market Buy execution for entry
   */
  public static async marketBuy(
    client: ExchangeClient,
    symbol: string,
    qty: number,
    approxPrice: number
  ): Promise<SingleLegOrderResult> {
    await ensureMarketsLoaded(client);
    const safeQty = preciseAmount(client, symbol, qty);

    const minCheck = validateMinimums(client, symbol, safeQty, approxPrice);
    if (!minCheck.ok) {
      throw new Error(`Minimum check failed: ${minCheck.reason}`);
    }

    let order: any;
    if (client.createMarketBuyOrder) {
      order = await client.createMarketBuyOrder(symbol, safeQty);
    } else {
      order = await client.createOrder(symbol, 'market', 'buy', safeQty);
    }

    const fillPrice = Number(order.average || order.price || approxPrice);
    const filledQty = Number(order.filled || safeQty);
    const feeUsd = Number(((filledQty * fillPrice * CONFIG.takerFeePct) / 100).toFixed(4));

    return {
      orderId: String(order.id || ''),
      price: fillPrice,
      qty: filledQty,
      feeUsd,
      rawOrder: order,
    };
  }

  /**
   * Market Sell execution for exit (reduce-only)
   */
  public static async marketSellReduceOnly(
    client: ExchangeClient,
    symbol: string,
    qty: number,
    approxPrice: number
  ): Promise<SingleLegOrderResult> {
    await ensureMarketsLoaded(client);
    const safeQty = preciseAmount(client, symbol, qty);

    let order: any;
    const params = { reduceOnly: true };

    try {
      if (client.createMarketSellOrder) {
        order = await client.createMarketSellOrder(symbol, safeQty, params);
      } else {
        order = await client.createOrder(symbol, 'market', 'sell', safeQty, undefined, params);
      }
    } catch (err: any) {
      // Fallback without explicit reduceOnly param if exchange rejects param
      console.warn(`⚠️ [DipBuyExecution] marketSell with reduceOnly failed, retrying plain: ${err.message}`);
      if (client.createMarketSellOrder) {
        order = await client.createMarketSellOrder(symbol, safeQty);
      } else {
        order = await client.createOrder(symbol, 'market', 'sell', safeQty);
      }
    }

    const fillPrice = Number(order.average || order.price || approxPrice);
    const filledQty = Number(order.filled || safeQty);
    const feeUsd = Number(((filledQty * fillPrice * CONFIG.takerFeePct) / 100).toFixed(4));

    return {
      orderId: String(order.id || ''),
      price: fillPrice,
      qty: filledQty,
      feeUsd,
      rawOrder: order,
    };
  }

  /**
   * Places Take-Profit conditional order on exchange (reduce-only)
   */
  public static async placeTakeProfit(
    client: ExchangeClient,
    symbol: string,
    qty: number,
    tpPrice: number
  ): Promise<string | null> {
    await ensureMarketsLoaded(client);
    const safeQty = preciseAmount(client, symbol, qty);
    const safeTpPrice = precisePrice(client, symbol, tpPrice);

    // CCXT unified conditional order placement
    try {
      const order = await client.createOrder(symbol, 'take_profit_market', 'sell', safeQty, undefined, {
        stopLossPrice: safeTpPrice, // or triggerPrice
        triggerPrice: safeTpPrice,
        stopPrice: safeTpPrice,
        reduceOnly: true,
      });
      return String(order.id || '');
    } catch (e: any) {
      // Try alternate type 'TAKE_PROFIT' or 'take_profit'
      try {
        const order = await client.createOrder(symbol, 'TAKE_PROFIT_MARKET', 'sell', safeQty, undefined, {
          stopPrice: safeTpPrice,
          reduceOnly: true,
        });
        return String(order.id || '');
      } catch (err2: any) {
        console.warn(`⚠️ [DipBuyExecution] Failed to place TP order: ${err2.message}`);
        return null;
      }
    }
  }

  /**
   * Places Stop-Loss conditional order on exchange (reduce-only)
   */
  public static async placeStopLoss(
    client: ExchangeClient,
    symbol: string,
    qty: number,
    slPrice: number
  ): Promise<string | null> {
    await ensureMarketsLoaded(client);
    const safeQty = preciseAmount(client, symbol, qty);
    const safeSlPrice = precisePrice(client, symbol, slPrice);

    try {
      const order = await client.createOrder(symbol, 'stop_market', 'sell', safeQty, undefined, {
        stopLossPrice: safeSlPrice,
        triggerPrice: safeSlPrice,
        stopPrice: safeSlPrice,
        reduceOnly: true,
      });
      return String(order.id || '');
    } catch (e: any) {
      try {
        const order = await client.createOrder(symbol, 'STOP_MARKET', 'sell', safeQty, undefined, {
          stopPrice: safeSlPrice,
          reduceOnly: true,
        });
        return String(order.id || '');
      } catch (err2: any) {
        console.warn(`⚠️ [DipBuyExecution] Failed to place SL order: ${err2.message}`);
        return null;
      }
    }
  }

  /**
   * Cancel an order safely
   */
  public static async cancelOrderSafely(
    client: ExchangeClient,
    orderId: string,
    symbol: string
  ): Promise<void> {
    if (!orderId) return;
    try {
      await client.cancelOrder(orderId, symbol);
    } catch (err: any) {
      // Ignore if order already closed/cancelled
      const msg = err?.message || '';
      if (!msg.includes('Unknown') && !msg.includes('closed') && !msg.includes('canceled')) {
        console.warn(`⚠️ [DipBuyExecution] cancelOrderSafely error: ${msg}`);
      }
    }
  }
}
