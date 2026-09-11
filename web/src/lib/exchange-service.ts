/**
 * Legacy helpers kept for shared balance parsing.
 * Live exchange API calls must go through the worker (see worker-client.ts).
 */

export type SupportedExchange = 'binance' | 'okx' | 'bybit';

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
          free = Number(usdt.availableToWithdraw || usdt.walletBalance || 0);
          total = Number(usdt.equity || usdt.walletBalance || free);
        }
      }
    }
  }

  return {
    free: isNaN(free) ? 0 : free,
    total: isNaN(total) ? 0 : total,
  };
}
