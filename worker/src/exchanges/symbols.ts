import { ExchangeType } from '../types/index.js';

export interface StrategyPairConfig {
  pairSymbol: string;
  longCoin: string;
  shortCoin: string;
}

/**
 * Fallback basket used only when the strategy_pairs table is empty or unreachable.
 * The live basket is managed dynamically by PairRegistry (see pair-registry.ts).
 */
export const DEFAULT_STRATEGY_PAIRS: StrategyPairConfig[] = [
  { pairSymbol: 'HYPE/DOGE', longCoin: 'HYPE', shortCoin: 'DOGE' },
  { pairSymbol: 'NEAR/XPL', longCoin: 'NEAR', shortCoin: 'XPL' },
];

export function getExchangeSymbol(coin: string, exchange: ExchangeType): string {
  const upper = coin.toUpperCase();
  switch (exchange) {
    case 'binance':
      return `${upper}/USDT`;
    case 'okx':
      return `${upper}/USDT:USDT`;
    case 'bybit':
      return `${upper}/USDT:USDT`;
    default:
      return `${upper}/USDT`;
  }
}
