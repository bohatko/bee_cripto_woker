/** Worker used to persist rejected exchange orders with synthetic `sim-*` IDs. */
export function isUnfilledSimulation(pos: {
  long_order_id?: string | null;
  short_order_id?: string | null;
}): boolean {
  const longId = pos.long_order_id ?? '';
  const shortId = pos.short_order_id ?? '';
  return longId.startsWith('sim-') || shortId.startsWith('sim-');
}

export type ExecutionMode = 'market' | 'maker_hedge';

/** PnL-related fields from `bot_positions` (Supabase). */
export type BotPositionPnlFields = {
  status?: string | null;
  unrealized_pnl_usd?: number | string | null;
  realized_pnl_usd?: number | string | null;
  pnl_pct?: number | string | null;
  gross_pnl_usd?: number | string | null;
  entry_fees_usd?: number | string | null;
  exit_fees_usd?: number | string | null;
  funding_fees_usd?: number | string | null;
  execution_mode?: ExecutionMode | string | null;
  allocated_margin_usd?: number | string | null;
  long_qty?: number | string | null;
  short_qty?: number | string | null;
  long_entry_price?: number | string | null;
  short_entry_price?: number | string | null;
  long_exit_price?: number | string | null;
  short_exit_price?: number | string | null;
};

/** Common row shape for closed/open bot positions in the web app. */
export type BotPosition = BotPositionPnlFields & {
  id: string;
  user_id?: string;
  pair_symbol?: string;
  long_symbol?: string;
  short_symbol?: string;
  status?: string;
  exit_reason?: string | null;
  opened_at?: string;
  closed_at?: string | null;
  entry_ratio?: number | string | null;
  exit_ratio?: number | string | null;
  allocated_margin_usd?: number | string | null;
  total_position_volume_usd?: number | string | null;
  long_order_id?: string | null;
  short_order_id?: string | null;
  is_master?: boolean;
  exchange_accounts?: { exchange?: string; account_name?: string } | null;
};

function parseUsd(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function feeComponent(value: unknown): number {
  return parseUsd(value) ?? 0;
}

function computeGrossFromPrices(pos: BotPositionPnlFields): number | null {
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

  if (!pricesMoved || longQty <= 0 || shortQty <= 0) {
    return null;
  }

  const longPnl = (longExit - longEntry) * longQty;
  const shortPnl = (shortEntry - shortExit) * shortQty;
  return Number((longPnl + shortPnl).toFixed(2));
}

/** Sum of entry, exit, and funding fees (nulls treated as 0). */
export function getTotalFeesUsd(pos: BotPositionPnlFields): number {
  return Number(
    (
      feeComponent(pos.entry_fees_usd) +
      feeComponent(pos.exit_fees_usd) +
      feeComponent(pos.funding_fees_usd)
    ).toFixed(2)
  );
}

/** Gross PnL before exchange fees. */
export function getGrossPnlUsd(pos: BotPositionPnlFields): number {
  const storedGross = parseUsd(pos.gross_pnl_usd);
  if (storedGross !== null) return storedGross;
  return Number((getNetPnlUsd(pos) + getTotalFeesUsd(pos)).toFixed(2));
}

/**
 * Net realized PnL after exchange fees.
 * Uses DB `realized_pnl_usd` when present (including legitimate zero).
 * For closed rows with null realized, falls back to gross-from-prices minus fees.
 */
export function getNetPnlUsd(pos: BotPositionPnlFields): number {
  const storedNet = parseUsd(pos.realized_pnl_usd);
  if (storedNet !== null) return storedNet;

  if (pos.status !== 'closed') return 0;

  const gross = computeGrossFromPrices(pos) ?? 0;
  const fees = getTotalFeesUsd(pos);
  return Number((gross - fees).toFixed(2));
}

/** Unrealized PnL for open positions (zero when not open or not recorded). */
export function getUnrealizedPnlUsd(pos: BotPositionPnlFields): number {
  if (pos.status !== 'open') return 0;
  return parseUsd(pos.unrealized_pnl_usd) ?? 0;
}

/** Net PnL for display: unrealized when open, net realized when closed. */
export function getDisplayPnlUsd(pos: BotPositionPnlFields): number {
  if (pos.status === 'open') {
    return getUnrealizedPnlUsd(pos);
  }
  return getNetPnlUsd(pos);
}

/**
 * Net realized PnL and margin-based percentage for closed positions.
 * Prefer stored `pnl_pct` when net is persisted in DB.
 */
export function resolveRealizedPnl(pos: BotPositionPnlFields): { pnlUsd: number; pnlPct: number } {
  const pnlUsd = getNetPnlUsd(pos);
  const margin = Number(pos.allocated_margin_usd) || 0;
  const storedPct = parseUsd(pos.pnl_pct);
  const hasStoredNet = parseUsd(pos.realized_pnl_usd) !== null;

  if (hasStoredNet && storedPct !== null) {
    return { pnlUsd, pnlPct: storedPct };
  }

  const pnlPct = margin > 0 ? Number(((pnlUsd / margin) * 100).toFixed(2)) : 0;
  return { pnlUsd, pnlPct };
}
