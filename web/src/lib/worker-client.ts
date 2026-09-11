export type SupportedExchange = 'binance' | 'okx' | 'bybit';

export interface WorkerValidateResult {
  success: true;
  isValid: true;
  canWithdraw: false;
  canTradeFutures: true;
  freeBalanceUsd: number;
  totalBalanceUsd: number;
  balanceUsd: number;
}

export interface WorkerBalanceResult {
  success: true;
  free: number;
  total: number;
}

export class WorkerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerConfigError';
  }
}

function getWorkerConfig(): { baseUrl: string; secret: string } {
  const baseUrl = (process.env.WORKER_INTERNAL_URL || '')
    .trim()
    .replace(/[\r\n]+/g, '')
    .replace(/\/$/, '');
  const secret = (
    process.env.WORKER_INTERNAL_SECRET ||
    process.env.INTERNAL_API_SECRET ||
    ''
  )
    .trim()
    .replace(/[\r\n]+/g, '');
  if (!baseUrl) {
    throw new WorkerConfigError(
      'WORKER_INTERNAL_URL is not configured. Exchange validation must run on the worker static egress IP.'
    );
  }
  if (!secret) {
    throw new WorkerConfigError('WORKER_INTERNAL_SECRET is not configured.');
  }
  return { baseUrl, secret };
}

async function workerFetch<T>(
  path: string,
  body: Record<string, unknown>
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string; canWithdraw?: boolean }> {
  const { baseUrl, secret } = getWorkerConfig();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch (err: any) {
    return {
      ok: false,
      status: 502,
      error: `Worker unreachable (${err?.message || 'network error'}). Check WORKER_INTERNAL_URL and that the worker is running.`,
    };
  }

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload?.error || `Worker request failed with HTTP ${response.status}`,
      canWithdraw: payload?.canWithdraw,
    };
  }

  return { ok: true, data: payload as T };
}

export async function validateExchangeViaWorker(
  exchange: SupportedExchange,
  apiKey: string,
  apiSecret: string,
  passphrase?: string
): Promise<
  | { ok: true; data: WorkerValidateResult }
  | { ok: false; status: number; error: string; canWithdraw?: boolean }
> {
  return workerFetch<WorkerValidateResult>('/internal/exchange/validate', {
    exchange,
    apiKey,
    apiSecret,
    passphrase,
  });
}

export async function fetchBalanceViaWorker(account: {
  exchange: SupportedExchange;
  encrypted_api_key: string;
  encrypted_secret: string;
  encrypted_passphrase?: string | null;
  iv_nonce: string;
  tag: string;
}): Promise<
  | { ok: true; data: WorkerBalanceResult }
  | { ok: false; status: number; error: string }
> {
  return workerFetch<WorkerBalanceResult>('/internal/exchange/fetch-balance', {
    exchange: account.exchange,
    encrypted_api_key: account.encrypted_api_key,
    encrypted_secret: account.encrypted_secret,
    encrypted_passphrase: account.encrypted_passphrase,
    iv_nonce: account.iv_nonce,
    tag: account.tag,
  });
}
