import { ExchangeType } from '../types/index.js';

export interface StrategyPairConfig {
  pairSymbol: string;
  longCoin: string;
  shortCoin: string;
}

export const STRATEGY_PAIRS: StrategyPairConfig[] = [
  { pairSymbol: 'ZEC/AVAX', longCoin: 'ZEC', shortCoin: 'AVAX' },
  { pairSymbol: 'ENA/SUI', longCoin: 'ENA', shortCoin: 'SUI' },
  { pairSymbol: 'SOL/ADA', longCoin: 'SOL', shortCoin: 'ADA' },
  { pairSymbol: 'BNB/ETH', longCoin: 'BNB', shortCoin: 'ETH' },
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
