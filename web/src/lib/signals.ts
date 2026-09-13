/** Decimal places for signal price display by coin. */
export function signalPriceDecimals(symbol: string | null | undefined): number {
  const s = (symbol || '').toUpperCase();
  if (s === 'BTC' || s === 'ETH') return 2;
  return 4;
}
