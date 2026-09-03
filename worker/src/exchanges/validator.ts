import ccxt from 'ccxt';
import { ExchangeType } from '../types/index.js';

export interface ValidationResult {
  isValid: boolean;
  canWithdraw: boolean;
  canTradeFutures: boolean;
  balanceUsd: number;
  errorMessage?: string;
}

export async function validateExchangeCredentials(
  exchange: ExchangeType,
  apiKey: string,
  secret: string,
  passphrase?: string
): Promise<ValidationResult> {
  const options: Record<string, any> = {
    apiKey,
    secret,
    password: passphrase,
    enableRateLimit: true,
    options: {
      defaultType: 'future',
      adjustForTimeDifference: true,
    },
  };

  let client: any;
  try {
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
      default:
        return {
          isValid: false,
          canWithdraw: false,
          canTradeFutures: false,
          balanceUsd: 0,
          errorMessage: 'Unsupported exchange',
        };
    }

    // 1. Check API key permissions
    let canWithdraw = false;
    let canTradeFutures = false;

    try {
      if (client.has['fetchPermissions']) {
        const perms = await client.fetchPermissions();
        if (perms && typeof perms === 'object') {
          // If exchange reports permissions directly
          canWithdraw = Boolean((perms as any).withdraw || (perms as any).canWithdraw);
          canTradeFutures = Boolean((perms as any).trading || (perms as any).future);
        }
      }
    } catch {
      // Some exchanges do not support fetchPermissions; fallback to balance probe
    }

    // 2. Fetch Balance to test API connectivity & futures permission
    const balance = await client.fetchBalance({ type: 'future' });
    const freeUsdt = Number(balance.free?.USDT || balance.total?.USDT || 0);

    canTradeFutures = true;

    return {
      isValid: true,
      canWithdraw,
      canTradeFutures,
      balanceUsd: freeUsdt,
    };
  } catch (err: any) {
    return {
      isValid: false,
      canWithdraw: false,
      canTradeFutures: false,
      balanceUsd: 0,
      errorMessage: err.message || 'Failed to authenticate with exchange API',
    };
  }
}
