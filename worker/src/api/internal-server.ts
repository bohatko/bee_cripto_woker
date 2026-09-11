import http from 'node:http';
import { CONFIG } from '../config.js';
import { decryptString } from '../security/encryption.js';
import {
  fetchFuturesBalance,
  validateExchangeCredentials,
} from '../exchanges/validator.js';
import { ExchangeType } from '../types/index.js';

type JsonRecord = Record<string, unknown>;

function isExchange(value: unknown): value is ExchangeType {
  return value === 'binance' || value === 'okx' || value === 'bybit';
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, payload: JsonRecord): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function authorize(req: http.IncomingMessage): boolean {
  const expected = CONFIG.internalApiSecret;
  if (!expected) return false;
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const alt = String(req.headers['x-internal-secret'] || '').trim();
  return token === expected || alt === expected;
}

async function handleValidate(body: JsonRecord): Promise<{ status: number; payload: JsonRecord }> {
  const exchange = body.exchange;
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const apiSecret = typeof body.apiSecret === 'string' ? body.apiSecret.trim() : '';
  const passphrase =
    typeof body.passphrase === 'string' && body.passphrase.trim()
      ? body.passphrase.trim()
      : undefined;

  if (!isExchange(exchange) || !apiKey || !apiSecret) {
    return {
      status: 400,
      payload: { error: 'exchange, apiKey, and apiSecret are required.' },
    };
  }

  if (exchange === 'okx' && !passphrase) {
    return { status: 400, payload: { error: 'OKX requires an API passphrase.' } };
  }

  const result = await validateExchangeCredentials(exchange, apiKey, apiSecret, passphrase);
  if (!result.isValid) {
    return {
      status: 400,
      payload: {
        error: result.errorMessage || 'Failed to authenticate with exchange API',
        canWithdraw: result.canWithdraw,
        isValid: false,
      },
    };
  }

  return {
    status: 200,
    payload: {
      success: true,
      isValid: true,
      canWithdraw: false,
      canTradeFutures: true,
      freeBalanceUsd: result.freeBalanceUsd,
      totalBalanceUsd: result.totalBalanceUsd,
      balanceUsd: result.balanceUsd,
    },
  };
}

async function handleFetchBalance(
  body: JsonRecord
): Promise<{ status: number; payload: JsonRecord }> {
  const exchange = body.exchange;
  if (!isExchange(exchange)) {
    return { status: 400, payload: { error: 'Unsupported or missing exchange.' } };
  }

  let apiKey = '';
  let apiSecret = '';
  let passphrase: string | undefined;

  if (typeof body.apiKey === 'string' && typeof body.apiSecret === 'string') {
    apiKey = body.apiKey.trim();
    apiSecret = body.apiSecret.trim();
    passphrase =
      typeof body.passphrase === 'string' && body.passphrase.trim()
        ? body.passphrase.trim()
        : undefined;
  } else if (
    typeof body.encrypted_api_key === 'string' &&
    typeof body.encrypted_secret === 'string'
  ) {
    const iv = typeof body.iv_nonce === 'string' ? body.iv_nonce : undefined;
    const tag = typeof body.tag === 'string' ? body.tag : undefined;
    apiKey = decryptString(body.encrypted_api_key, iv, tag);
    apiSecret = decryptString(body.encrypted_secret, iv, tag);
    if (typeof body.encrypted_passphrase === 'string' && body.encrypted_passphrase) {
      passphrase = decryptString(body.encrypted_passphrase, iv, tag);
    }
  } else {
    return {
      status: 400,
      payload: { error: 'Provide plaintext keys or encrypted credential fields.' },
    };
  }

  const balance = await fetchFuturesBalance(exchange, apiKey, apiSecret, passphrase);
  if (balance.error) {
    return {
      status: 400,
      payload: { error: balance.error, free: 0, total: 0 },
    };
  }

  return {
    status: 200,
    payload: { success: true, free: balance.free, total: balance.total },
  };
}

export function startInternalApiServer(): http.Server | null {
  if (!CONFIG.internalApiEnabled) {
    console.log('ℹ️ Internal exchange API server disabled (INTERNAL_API_ENABLED=false).');
    return null;
  }

  if (!CONFIG.internalApiSecret) {
    console.warn(
      '⚠️ INTERNAL_API_SECRET is missing — exchange validate/sync proxy will reject requests.'
    );
  }

  const server = http.createServer(async (req, res) => {
    const method = req.method || 'GET';
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { ok: true, service: 'bee-crypto-worker' });
      return;
    }

    if (!authorize(req)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    try {
      if (method === 'POST' && url.pathname === '/internal/exchange/validate') {
        const raw = await readBody(req);
        const body = raw ? (JSON.parse(raw) as JsonRecord) : {};
        const result = await handleValidate(body);
        sendJson(res, result.status, result.payload);
        return;
      }

      if (method === 'POST' && url.pathname === '/internal/exchange/fetch-balance') {
        const raw = await readBody(req);
        const body = raw ? (JSON.parse(raw) as JsonRecord) : {};
        const result = await handleFetchBalance(body);
        sendJson(res, result.status, result.payload);
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err: any) {
      console.error('[InternalAPI] Unhandled error:', err?.message || err);
      sendJson(res, 500, { error: err?.message || 'Internal server error' });
    }
  });

  server.listen(CONFIG.internalApiPort, '0.0.0.0', () => {
    console.log(
      `🌐 Internal exchange API listening on 0.0.0.0:${CONFIG.internalApiPort} (validate/sync via static egress IP)`
    );
  });

  return server;
}
