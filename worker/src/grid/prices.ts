export function formatPx(price: number): string {
  const abs = Math.abs(price);
  const digits = abs >= 1000 ? 2 : abs >= 100 ? 3 : abs >= 1 ? 4 : abs >= 0.01 ? 5 : 6;
  return price.toFixed(digits);
}

export function roundPx(price: number): number {
  return Number(formatPx(price));
}
