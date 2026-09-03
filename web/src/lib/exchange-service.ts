import ccxt from 'ccxt';
import { decryptString } from './encryption';

export type SupportedExchange = 'binance' | 'okx' | 'bybit';

export interface ExchangeValidationResult {
  isValid: boolean;
  canWithdraw: boolean;
  canTradeFutures: boolean;
  freeBalanceUsd: number;
  totalBalanceUsd: number;
  errorMessage?: string;
}

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

    // Secondary fallback for raw exchange objects if standard parsing was empty
    if (free === 0 && total === 0 && balance.info) {
      // Binance raw info
      if (Array.isArray(balance.info.assets)) {
        const usdt = balance.info.assets.find((a: any) => a.asset === 'USDT');
        if (usdt) {
          free = Number(usdt.availableBalance || usdt.free || 0);
          total = Number(usdt.walletBalance || usdt.marginBalance || free);
        }
      }
      // OKX raw info
      if (Array.isArray(balance.info.data?.[0]?.details)) {
        const usdt = balance.info.data[0].details.find((d: any) => d.ccy === 'USDT');
        if (usdt) {
          free = Number(usdt.availBal || usdt.cashBal || 0);
          total = Number(usdt.eq || usdt.eqUsd || free);
        }
      }
      // Bybit raw info
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

export function createExchangeClient(
  exchange: SupportedExchange,
  apiKey: string,
  secret: string,
  passphrase?: string
): any {
  const options: Record<string, any> = {
    apiKey,
    secret,
    password: passphrase,
    enableRateLimit: true,
    timeout: 15000,
    options: {
      defaultType: 'future',
      adjustForTimeDifference: true,
    },
  };

  switch (exchange) {
    case 'binance':
      return new ccxt.binanceusdm(options);
    case 'okx':
      return new ccxt.okx(options);
    case 'bybit':
      return new ccxt.bybit(options);
    default:
      throw new Error(`Unsupported exchange: ${exchange}`);
  }
}

export async function validateAndFetchExchangeBalance(
  exchange: SupportedExchange,
  apiKey: string,
  secret: string,
  passphrase?: string
): Promise<ExchangeValidationResult> {
  let client: any;
  try {
    client = createExchangeClient(exchange, apiKey, secret, passphrase);
  } catch (err: any) {
    return {
      isValid: false,
      canWithdraw: false,
      canTradeFutures: false,
      freeBalanceUsd: 0,
      totalBalanceUsd: 0,
      errorMessage: err.message || 'Invalid exchange configuration',
    };
  }

  try {
    // 1. Strict Security Check: Verify withdrawal permission
    let canWithdraw = false;
    let canTradeFutures = false;

    try {
      if (client.has['fetchPermissions']) {
        const perms = await client.fetchPermissions();
        if (perms && typeof perms === 'object') {
          canWithdraw = Boolean((perms as any).withdraw || (perms as any).canWithdraw);
          canTradeFutures = Boolean((perms as any).trading || (perms as any).future);
        }
      }
    } catch {
      // Some API endpoints or subaccounts do not support fetchPermissions directly; continue to balance test
    }

    if (canWithdraw) {
      return {
        isValid: false,
        canWithdraw: true,
        canTradeFutures: false,
        freeBalanceUsd: 0,
        totalBalanceUsd: 0,
        errorMessage:
          'Security Error: Withdrawal permission is enabled on these API keys. For maximum fund safety, Bee Crypto Worker strictly forbids API keys with withdrawal rights. Please disable "Enable Withdrawals" in your exchange API settings and try again.',
      };
    }

    // 2. Fetch real futures balance
    const balance = await client.fetchBalance({ type: 'future' });
    const { free, total } = extractUsdtBalance(balance);

    return {
      isValid: true,
      canWithdraw: false,
      canTradeFutures: true,
      freeBalanceUsd: free,
      totalBalanceUsd: total > 0 ? total : free,
    };
  } catch (err: any) {
    const errorText = err.message || 'Failed to authenticate with exchange API';
    return {
      isValid: false,
      canWithdraw: false,
      canTradeFutures: false,
      freeBalanceUsd: 0,
      totalBalanceUsd: 0,
      errorMessage: errorText,
    };
  }
}

export async function fetchLiveBalanceFromDecryptedAccount(account: {
  exchange: SupportedExchange;
  encrypted_api_key: string;
  encrypted_secret: string;
  encrypted_passphrase?: string | null;
  iv_nonce: string;
  tag: string;
}): Promise<{ free: number; total: number; error?: string }> {
  try {
    const apiKey = decryptString(account.encrypted_api_key, account.iv_nonce, account.tag);
    const secret = decryptString(account.encrypted_secret, account.iv_nonce, account.tag);
    const passphrase = account.encrypted_passphrase
      ? decryptString(account.encrypted_passphrase, account.iv_nonce, account.tag)
      : undefined;

    const client = createExchangeClient(account.exchange, apiKey, secret, passphrase);
    const balance = await client.fetchBalance({ type: 'future' });
    const { free, total } = extractUsdtBalance(balance);

    return { free, total: total > 0 ? total : free };
  } catch (err: any) {
    return { free: 0, total: 0, error: err.message || 'Failed to fetch live balance' };
  }
}
