import crypto from 'node:crypto';
import { formatPx } from './prices.js';

const OKX_BASE = 'https://www.okx.com';

export interface GridOrderParams {
  baseAsset: string;
  lowerPrice: number;
  upperPrice: number;
  gridCount: number;
  leverage: number;
  stopPrice: number;
  takeProfitPrice: number;
  spacing: 'geometric' | 'arithmetic';
  direction: 'neutral' | 'long' | 'short';
  marginUsdt: number;
}

export interface GridBotSnapshot {
  exchangeBotId: string;
  running: boolean;
  pnlUsdt: number | null;
  raw: Record<string, unknown>;
}

function signOkx(secret: string, timestamp: string, method: string, path: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(timestamp + method + path + body).digest('base64');
}

async function okxRequest(
  creds: { apiKey: string; secret: string; passphrase: string },
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<any> {
  const payload = body ? JSON.stringify(body) : '';
  const timestamp = new Date().toISOString();
  const response = await fetch(`${OKX_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'OK-ACCESS-KEY': creds.apiKey,
      'OK-ACCESS-SIGN': signOkx(creds.secret, timestamp, method, path, payload),
      'OK-ACCESS-TIMESTAMP': timestamp,
      'OK-ACCESS-PASSPHRASE': creds.passphrase,
    },
    body: method === 'POST' ? payload : undefined,
  });
  const json = (await response.json().catch(() => ({}))) as {
    code?: string;
    msg?: string;
    data?: Array<{ sMsg?: string; algoId?: string }>;
  };
  if (!response.ok || json.code !== '0') {
    throw new Error(json.msg || json.data?.[0]?.sMsg || `OKX ${path} HTTP ${response.status}`);
  }
  return json;
}

export async function createOkxGrid(
  creds: { apiKey: string; secret: string; passphrase: string },
  params: GridOrderParams
): Promise<string> {
  const json = await okxRequest(creds, 'POST', '/api/v5/tradingBot/grid/order-algo', {
    instId: `${params.baseAsset}-USDT-SWAP`,
    algoOrdType: 'contract_grid',
    maxPx: formatPx(params.upperPrice),
    minPx: formatPx(params.lowerPrice),
    gridNum: String(params.gridCount),
    runType: params.spacing === 'geometric' ? '2' : '1',
    sz: params.marginUsdt.toFixed(2),
    direction: params.direction,
    lever: String(params.leverage),
    basePos: false,
    tpTriggerPx: formatPx(params.takeProfitPrice),
    slTriggerPx: formatPx(params.stopPrice),
  });
  const algoId = json.data?.[0]?.algoId;
  if (!algoId) throw new Error('OKX did not return a grid algo id');
  return String(algoId);
}

export async function stopOkxGrid(
  creds: { apiKey: string; secret: string; passphrase: string },
  baseAsset: string,
  algoId: string
): Promise<void> {
  try {
    await okxRequest(creds, 'POST', '/api/v5/tradingBot/grid/stop-order-algo', [
      {
        algoId,
        instId: `${baseAsset}-USDT-SWAP`,
        algoOrdType: 'contract_grid',
        stopType: '1',
      },
    ]);
  } catch (err: any) {
    const message = String(err?.message || err).toLowerCase();
    if (message.includes('already') || message.includes('not exist') || message.includes('does not exist')) return;
    throw err;
  }
}

function readPnl(row: Record<string, unknown>): number | null {
  const raw = row.totalPnl ?? row.pnl ?? row.totalProfit ?? row.gridProfit;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export async function readOkxGrid(
  creds: { apiKey: string; secret: string; passphrase: string },
  algoId: string
): Promise<GridBotSnapshot> {
  const pendingPath = `/api/v5/tradingBot/grid/orders-algo-pending?algoOrdType=contract_grid&algoId=${algoId}`;
  const pending = await okxRequest(creds, 'GET', pendingPath);
  const live = (pending.data || []).find((row: any) => String(row.algoId) === algoId);
  if (live) {
    return { exchangeBotId: algoId, running: true, pnlUsdt: readPnl(live), raw: live };
  }
  const historyPath = `/api/v5/tradingBot/grid/orders-algo-history?algoOrdType=contract_grid&algoId=${algoId}`;
  const history = await okxRequest(creds, 'GET', historyPath);
  const past = (history.data || []).find((row: any) => String(row.algoId) === algoId) || history.data?.[0];
  return {
    exchangeBotId: algoId,
    running: false,
    pnlUsdt: past ? readPnl(past) : null,
    raw: past || {},
  };
}
