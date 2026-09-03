import ccxt from 'ccxt';
import { ExchangeAccount } from '../types/index.js';
import { decryptString } from '../security/encryption.js';

export function createExchangeInstance(account: ExchangeAccount): any {
  const apiKey = decryptString(account.encrypted_api_key, account.iv_nonce, account.tag);
  const secret = decryptString(account.encrypted_secret, account.iv_nonce, account.tag);
  const password = account.encrypted_passphrase
    ? decryptString(account.encrypted_passphrase, account.iv_nonce, account.tag)
    : undefined;

  const baseConfig: Record<string, any> = {
    apiKey,
    secret,
    password,
    enableRateLimit: true,
    options: {
      defaultType: 'future',
      adjustForTimeDifference: true,
    },
  };

  switch (account.exchange) {
    case 'binance':
      return new ccxt.binanceusdm(baseConfig);
    case 'okx':
      return new ccxt.okx(baseConfig);
    case 'bybit':
      return new ccxt.bybit(baseConfig);
    default:
      throw new Error(`Unsupported exchange type: ${account.exchange}`);
  }
}
