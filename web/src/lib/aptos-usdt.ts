/** Official Aptos USDT (Tether) fungible-asset metadata. 6 decimals. */
export const APTOS_USDT_METADATA =
  '0x357b0b74bc833e95a115ad22604854d6b0fca151cecd94111770e5d6ffc9dc2b';

const APTOS_FULLNODE =
  process.env.APTOS_FULLNODE_URL || 'https://fullnode.mainnet.aptoslabs.com/v1';

export type AptosUsdtTransfer = {
  amountMicro: bigint;
  amountUsd: number;
  recipient: string;
  sender: string;
};

export type AptosVerifyCode =
  | 'ok'
  | 'invalid_hash'
  | 'not_found'
  | 'failed'
  | 'not_usdt'
  | 'lookup_failed';

export type AptosVerifyResult =
  | { code: 'ok'; transfer: AptosUsdtTransfer }
  | { code: Exclude<AptosVerifyCode, 'ok'> };

export function usdToUsdtMicro(amountUsd: number): bigint {
  return BigInt(Math.round(amountUsd * 1_000_000));
}

export function microToUsd(amountMicro: bigint): number {
  return Number(amountMicro) / 1_000_000;
}

export function normalizeTxHash(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  const hex = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed;
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  return `0x${hex}`;
}

export function normalizeAddress(raw: string): string {
  return raw.trim().toLowerCase();
}

function readAddress(value: unknown): string | null {
  if (typeof value === 'string' && value.startsWith('0x')) return normalizeAddress(value);
  if (value && typeof value === 'object' && 'inner' in value) {
    const inner = (value as { inner?: unknown }).inner;
    if (typeof inner === 'string' && inner.startsWith('0x')) return normalizeAddress(inner);
  }
  return null;
}

function readAmount(value: unknown): bigint | null {
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  return null;
}

/** Pull a USDT transfer out of an Aptos user transaction, if that is what it is. */
export function parseAptosUsdtTransfer(tx: {
  success?: boolean;
  sender?: string;
  payload?: {
    function?: string;
    arguments?: unknown[];
  };
}): AptosUsdtTransfer | null {
  if (!tx?.success || !tx.payload) return null;
  const fn = tx.payload.function || '';
  const args = tx.payload.arguments || [];
  if (fn !== '0x1::primary_fungible_store::transfer') return null;

  const metadata = readAddress(args[0]);
  const recipient = readAddress(args[1]);
  const amountMicro = readAmount(args[2]);
  if (!metadata || !recipient || amountMicro === null) return null;
  if (metadata !== APTOS_USDT_METADATA) return null;

  return {
    amountMicro,
    amountUsd: microToUsd(amountMicro),
    recipient,
    sender: normalizeAddress(tx.sender || ''),
  };
}

export async function verifyAptosUsdtTransfer(txHash: string): Promise<AptosVerifyResult> {
  const hash = normalizeTxHash(txHash);
  if (!hash) return { code: 'invalid_hash' };

  let response: Response;
  try {
    response = await fetch(`${APTOS_FULLNODE}/transactions/by_hash/${hash}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    return { code: 'lookup_failed' };
  }

  if (response.status === 404) return { code: 'not_found' };
  if (!response.ok) return { code: 'lookup_failed' };

  const tx = (await response.json()) as {
    success?: boolean;
    sender?: string;
    payload?: { function?: string; arguments?: unknown[] };
  };

  if (tx.success === false) return { code: 'failed' };

  const transfer = parseAptosUsdtTransfer(tx);
  if (!transfer || transfer.amountMicro <= BigInt(0)) return { code: 'not_usdt' };

  return { code: 'ok', transfer };
}
