import ccxt from 'ccxt';
import { ExchangeType } from '../types/index.js';
import { extractUsdtBalance } from './balance.js';

export interface ValidationResult {
  isValid: boolean;
  canWithdraw: boolean;
  canTradeFutures: boolean;
  freeBalanceUsd: number;
  totalBalanceUsd: number;
  balanceUsd: number;
  errorMessage?: string;
}

function createClient(
  exchange: ExchangeType,
  apiKey: string,
  secret: string,
  passphrase?: string
): any {
  const options: Record<string, any> = {
    apiKey,
    secret,
    password: passphrase,
    enableRateLimit: true,
    timeout: 20000,
    options: {
      defaultType: 'future',
      adjustForTimeDifference: true,
      // Avoid CCXT loadMarkets → fetchCurrencies (Bybit query-info / Binance sapi).
      fetchCurrencies: false,
    },
  };

  let client: any;
  switch (exchange) {
    case 'binance':
      client = new ccxt.binanceusdm(options);
      break;
    case 'okx':
      client = new ccxt.okx(options);
      break;
    case 'bybit':
      client = new ccxt.bybit(options);
      break;
    default: {
      const _exhaustive: never = exchange;
      throw new Error(`Unsupported exchange: ${_exhaustive}`);
    }
  }

  // Hard-disable currency metadata calls that hit wallet/asset endpoints blocked on many IPs.
  if (client.has && typeof client.has === 'object') {
    client.has['fetchCurrencies'] = false;
  }

  return client;
}

function fromBalancePayload(balance: any): { free: number; total: number } {
  const { free, total } = extractUsdtBalance(balance);
  return { free, total: total > 0 ? total : free };
}

/**
 * Futures USDT balance via exchange-native account endpoints.
 * Never calls fetchBalance/loadMarkets (those pull Bybit query-info / Binance sapi).
 */
async function fetchFuturesBalanceNative(
  exchange: ExchangeType,
  client: any
): Promise<{ free: number; total: number }> {
  switch (exchange) {
    case 'binance': {
      const info =
        typeof client.fapiPrivateV2GetAccount === 'function'
          ? await client.fapiPrivateV2GetAccount()
          : await client.fapiPrivateGetAccount();
      return fromBalancePayload({ info, USDT: undefined });
    }
    case 'bybit': {
      // Prefer UNIFIED; fall back to CONTRACT for classic accounts.
      let info: any;
      try {
        info = await client.privateGetV5AccountWalletBalance({ accountType: 'UNIFIED' });
      } catch (unifiedErr: any) {
        try {
          info = await client.privateGetV5AccountWalletBalance({ accountType: 'CONTRACT' });
        } catch {
          throw unifiedErr;
        }
      }
      return fromBalancePayload({ info });
    }
    case 'okx': {
      const info = await client.privateGetAccountBalance();
      return fromBalancePayload({ info });
    }
    default: {
      const _exhaustive: never = exchange;
      throw new Error(`Unsupported exchange: ${_exhaustive}`);
    }
  }
}

/**
 * Soft withdraw-permission probe without wallet/asset endpoints.
 * Binance sapi and Bybit query-info are intentionally never called.
 */
async function probeWithdrawPermission(
  client: any,
  exchange: ExchangeType
): Promise<{ canWithdraw: boolean }> {
  try {
    if (exchange === 'bybit' && typeof client.privateGetV5UserQueryApi === 'function') {
      const res = await client.privateGetV5UserQueryApi();
      const wallet = res?.result?.permissions?.Wallet;
      if (Array.isArray(wallet) && wallet.some((p: string) => /withdraw/i.test(String(p)))) {
        return { canWithdraw: true };
      }
      return { canWithdraw: false };
    }

    if (exchange === 'okx' && typeof client.privateGetAccountConfig === 'function') {
      const res = await client.privateGetAccountConfig();
      const perm = String(res?.data?.[0]?.perm || '');
      if (/withdraw/i.test(perm)) {
        return { canWithdraw: true };
      }
      return { canWithdraw: false };
    }

    // Binance: no reliable futures-only withdraw probe without sapi — assume safe.
    return { canWithdraw: false };
  } catch (err: any) {
    const msg = String(err?.message || err || '');
    if (!/403|cloudfront|forbidden|sapi\/v1\/capital|query-info|451/i.test(msg)) {
      console.warn(`[Validator] withdraw probe soft-fail (${exchange}):`, msg.slice(0, 200));
    }
    return { canWithdraw: false };
  }
}

export async function validateExchangeCredentials(
  exchange: ExchangeType,
  apiKey: string,
  secret: string,
  passphrase?: string
): Promise<ValidationResult> {
  let client: any;
  try {
    client = createClient(exchange, apiKey, secret, passphrase);
  } catch (err: any) {
    return {
      isValid: false,
      canWithdraw: false,
      canTradeFutures: false,
      freeBalanceUsd: 0,
      totalBalanceUsd: 0,
      balanceUsd: 0,
      errorMessage: err.message || 'Invalid exchange configuration',
    };
  }

  try {
    const perm = await probeWithdrawPermission(client, exchange);
    if (perm.canWithdraw) {
      return {
        isValid: false,
        canWithdraw: true,
        canTradeFutures: false,
        freeBalanceUsd: 0,
        totalBalanceUsd: 0,
        balanceUsd: 0,
        errorMessage:
          'Security Error: Withdrawal permission is enabled on these API keys. For maximum fund safety, Bee Crypto Worker strictly forbids API keys with withdrawal rights. Please disable "Enable Withdrawals" in your exchange API settings and try again.',
      };
    }

    const { free, total } = await fetchFuturesBalanceNative(exchange, client);
    return {
      isValid: true,
      canWithdraw: false,
      canTradeFutures: true,
      freeBalanceUsd: free,
      totalBalanceUsd: total,
      balanceUsd: total,
    };
  } catch (err: any) {
    const raw = err.message || 'Failed to authenticate with exchange API';
    let errorMessage = raw;
    if (/451|restricted location|eligibility/i.test(raw)) {
      errorMessage =
        `${raw} — Binance blocks this worker region. Move the Railway service to an EU region (or use Bybit/OKX for market data).`;
    } else if (/403|cloudfront|forbidden/i.test(raw)) {
      errorMessage =
        `${raw} — Exchange blocked this IP. Ensure the worker static egress IP is allowlisted on the API key.`;
    }
    return {
      isValid: false,
      canWithdraw: false,
      canTradeFutures: false,
      freeBalanceUsd: 0,
      totalBalanceUsd: 0,
      balanceUsd: 0,
      errorMessage,
    };
  }
}

export async function fetchFuturesBalance(
  exchange: ExchangeType,
  apiKey: string,
  secret: string,
  passphrase?: string
): Promise<{ free: number; total: number; error?: string }> {
  try {
    const client = createClient(exchange, apiKey, secret, passphrase);
    const { free, total } = await fetchFuturesBalanceNative(exchange, client);
    return { free, total };
  } catch (err: any) {
    return { free: 0, total: 0, error: err.message || 'Failed to fetch live balance' };
  }
}
