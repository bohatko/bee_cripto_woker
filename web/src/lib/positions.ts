/** Worker used to persist rejected exchange orders with synthetic `sim-*` IDs. */
export function isUnfilledSimulation(pos: {
  long_order_id?: string | null;
  short_order_id?: string | null;
}): boolean {
  const longId = pos.long_order_id ?? '';
  const shortId = pos.short_order_id ?? '';
  return longId.startsWith('sim-') || shortId.startsWith('sim-');
}

/**
 * Prefer DB realized_pnl; if missing/zero but exit prices differ from entry, recompute.
 */
export function resolveRealizedPnl(pos: {
  realized_pnl_usd?: number | string | null;
  pnl_pct?: number | string | null;
  allocated_margin_usd?: number | string | null;
  long_qty?: number | string | null;
  short_qty?: number | string | null;
  long_entry_price?: number | string | null;
  short_entry_price?: number | string | null;
  long_exit_price?: number | string | null;
  short_exit_price?: number | string | null;
}): { pnlUsd: number; pnlPct: number } {
  const storedUsd = Number(pos.realized_pnl_usd);
  const storedPct = Number(pos.pnl_pct);
  const margin = Number(pos.allocated_margin_usd) || 0;

  const longEntry = Number(pos.long_entry_price) || 0;
  const shortEntry = Number(pos.short_entry_price) || 0;
  const longExit = Number(pos.long_exit_price) || 0;
  const shortExit = Number(pos.short_exit_price) || 0;
  const longQty = Number(pos.long_qty) || 0;
  const shortQty = Number(pos.short_qty) || 0;

  const pricesMoved =
    longExit > 0 &&
    shortExit > 0 &&
    (Math.abs(longExit - longEntry) > 1e-12 || Math.abs(shortExit - shortEntry) > 1e-12);

  if (Number.isFinite(storedUsd) && (storedUsd !== 0 || !pricesMoved)) {
    return {
      pnlUsd: Number.isFinite(storedUsd) ? storedUsd : 0,
      pnlPct: Number.isFinite(storedPct) ? storedPct : margin > 0 ? (storedUsd / margin) * 100 : 0,
    };
  }

  if (pricesMoved && longQty > 0 && shortQty > 0) {
    const longPnl = (longExit - longEntry) * longQty;
    const shortPnl = (shortEntry - shortExit) * shortQty;
    const pnlUsd = Number((longPnl + shortPnl).toFixed(2));
    const pnlPct = margin > 0 ? Number(((pnlUsd / margin) * 100).toFixed(2)) : 0;
    return { pnlUsd, pnlPct };
  }

  return {
    pnlUsd: Number.isFinite(storedUsd) ? storedUsd : 0,
    pnlPct: Number.isFinite(storedPct) ? storedPct : 0,
  };
}
