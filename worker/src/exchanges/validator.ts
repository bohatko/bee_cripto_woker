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
    },
  };

  switch (exchange) {
    case 'binance':
      return new ccxt.binanceusdm(options);
    case 'okx':
      return new ccxt.okx(options);
    case 'bybit':
      return new ccxt.bybit(options);
    default: {
      const _exhaustive: never = exchange;
      throw new Error(`Unsupported exchange: ${_exhaustive}`);
    }
  }
}

/**
 * Withdrawal permission probe.
 * Binance sapi / Bybit asset endpoints are often blocked from cloud IPs and are
 * optional — failure must not abort futures balance validation.
 */
async function probeWithdrawPermission(client: any, exchange: ExchangeType): Promise<{
  canWithdraw: boolean;
  canTradeFutures: boolean;
  probed: boolean;
}> {
  let canWithdraw = false;
  let canTradeFutures = false;
  let probed = false;

  if (!client.has?.['fetchPermissions']) {
    return { canWithdraw, canTradeFutures, probed };
  }

  // Prefer futures-native checks; skip cloud-hostile wallet endpoints when possible.
  if (exchange === 'binance' || exchange === 'bybit') {
    try {
      if (exchange === 'binance' && typeof client.fapiPrivateGetAccount === 'function') {
        await client.fapiPrivateGetAccount();
        canTradeFutures = true;
        probed = true;
        return { canWithdraw: false, canTradeFutures, probed };
      }
    } catch {
      // Fall through to optional fetchPermissions / balance.
    }
  }

  try {
    const perms = await client.fetchPermissions();
    probed = true;
    if (perms && typeof perms === 'object') {
      canWithdraw = Boolean((perms as any).withdraw || (perms as any).canWithdraw);
      canTradeFutures = Boolean((perms as any).trading || (perms as any).future);
    }
  } catch (err: any) {
    const msg = String(err?.message || err || '');
    // CloudFront / sapi blocks are expected from shared PaaS IPs; ignore.
    if (!/403|cloudfront|forbidden|sapi\/v1\/capital|query-info/i.test(msg)) {
      console.warn(`[Validator] fetchPermissions soft-fail (${exchange}):`, msg.slice(0, 200));
    }
  }

  return { canWithdraw, canTradeFutures, probed };
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

    const balance = await client.fetchBalance({ type: 'future' });
    const { free, total } = extractUsdtBalance(balance);
    const totalBalanceUsd = total > 0 ? total : free;

    return {
      isValid: true,
      canWithdraw: false,
      canTradeFutures: true,
      freeBalanceUsd: free,
      totalBalanceUsd,
      balanceUsd: totalBalanceUsd,
    };
  } catch (err: any) {
    const raw = err.message || 'Failed to authenticate with exchange API';
    let errorMessage = raw;
    if (/403|cloudfront|forbidden/i.test(raw)) {
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
    const balance = await client.fetchBalance({ type: 'future' });
    const { free, total } = extractUsdtBalance(balance);
    return { free, total: total > 0 ? total : free };
  } catch (err: any) {
    return { free: 0, total: 0, error: err.message || 'Failed to fetch live balance' };
  }
}
