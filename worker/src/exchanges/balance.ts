/** Minimum USDT slot margin required to attempt a pair entry (20% of free × leverage). */
export const MIN_SLOT_MARGIN_USD = 10;

export function extractUsdtBalance(balance: any): { free: number; total: number } {
  let free = 0;
  let total = 0;

  if (balance) {
    if (balance.USDT) {
      free = Number(balance.USDT.free ?? balance.USDT.available ?? 0);
      total = Number(balance.USDT.total ?? balance.USDT.equity ?? free);
    } else if (balance.free?.USDT !== undefined || balance.total?.USDT !== undefined) {
      free = Number(balance.free?.USDT ?? 0);
      total = Number(balance.total?.USDT ?? free);
    }

    if (free === 0 && total === 0 && balance.info) {
      if (Array.isArray(balance.info.assets)) {
        const usdt = balance.info.assets.find((a: any) => a.asset === 'USDT');
        if (usdt) {
          free = Number(usdt.availableBalance || usdt.free || 0);
          total = Number(usdt.walletBalance || usdt.marginBalance || free);
        }
      }
      // Binance USD-M account root fields (fapiPrivateV2GetAccount)
      if (free === 0 && total === 0) {
        const rootFree = Number(balance.info.availableBalance);
        const rootTotal = Number(
          balance.info.totalMarginBalance ?? balance.info.totalWalletBalance
        );
        if (Number.isFinite(rootFree) && rootFree > 0) free = rootFree;
        if (Number.isFinite(rootTotal) && rootTotal > 0) total = rootTotal;
      }
      if (Array.isArray(balance.info.data?.[0]?.details)) {
        const usdt = balance.info.data[0].details.find((d: any) => d.ccy === 'USDT');
        if (usdt) {
          free = Number(usdt.availBal || usdt.cashBal || 0);
          total = Number(usdt.eq || usdt.eqUsd || free);
        }
      }
      if (Array.isArray(balance.info.result?.list?.[0]?.coin)) {
        const usdt = balance.info.result.list[0].coin.find((c: any) => c.coin === 'USDT');
        if (usdt) {
          free = Number(
            usdt.availableToTrade ||
              usdt.availableBalance ||
              usdt.availableToWithdraw ||
              usdt.walletBalance ||
              0
          );
          total = Number(usdt.equity || usdt.walletBalance || free);
        }
      }
    }
  }

  return {
    free: Number.isFinite(free) ? free : 0,
    total: Number.isFinite(total) ? total : 0,
  };
}

export function isSimulatedOrderId(orderId: string | null | undefined): boolean {
  return typeof orderId === 'string' && orderId.startsWith('sim-');
}

export function isUnfilledSimulation(pos: {
  long_order_id?: string | null;
  short_order_id?: string | null;
}): boolean {
  return isSimulatedOrderId(pos.long_order_id) || isSimulatedOrderId(pos.short_order_id);
}
