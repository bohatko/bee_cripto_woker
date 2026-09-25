import crypto from 'node:crypto';
import { formatPx } from './prices.js';
import type { GridBotSnapshot, GridOrderParams } from './okx-grid.js';

const BYBIT_BASE = 'https://api.bybit.com';

function signBybit(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

async function bybitRequest(
  creds: { apiKey: string; secret: string },
  method: 'GET' | 'POST',
  path: string,
  query: Record<string, string>,
  body?: unknown
): Promise<any> {
  const timestamp = Date.now().toString();
  const recv = '5000';
  const queryString = new URLSearchParams(query).toString();
  const payload = method === 'GET' ? queryString : JSON.stringify(body ?? {});
  const sign = signBybit(creds.secret, timestamp + creds.apiKey + recv + payload);
  const url = `${BYBIT_BASE}${path}${queryString ? `?${queryString}` : ''}`;
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-BAPI-API-KEY': creds.apiKey,
      'X-BAPI-SIGN': sign,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recv,
    },
    body: method === 'POST' ? payload : undefined,
  });
  const json = (await response.json().catch(() => ({}))) as {
    retCode?: number;
    retMsg?: string;
    result?: any;
  };
  if (!response.ok || json.retCode !== 0) {
    throw new Error(json.retMsg || `Bybit ${path} HTTP ${response.status}`);
  }
  return json.result ?? {};
}

export async function createBybitGrid(
  creds: { apiKey: string; secret: string },
  params: GridOrderParams
): Promise<string> {
  const body = {
    symbol: `${params.baseAsset}USDT`,
    grid_mode: params.direction === 'long' ? 2 : params.direction === 'short' ? 3 : 1,
    min_price: formatPx(params.lowerPrice),
    max_price: formatPx(params.upperPrice),
    cell_number: params.gridCount,
    leverage: String(params.leverage),
    grid_type: params.spacing === 'geometric' ? 2 : 1,
    total_investment: params.marginUsdt.toFixed(2),
    tp_sl_type: 2,
    stop_loss_price: formatPx(params.stopPrice),
    take_profit_price: formatPx(params.takeProfitPrice),
  };
  const validated = await bybitRequest(creds, 'POST', '/v5/fgridbot/validate', {}, {
    symbol: body.symbol,
    grid_mode: body.grid_mode,
    min_price: body.min_price,
    max_price: body.max_price,
    cell_number: body.cell_number,
    leverage: body.leverage,
    grid_type: body.grid_type,
    total_investment: body.total_investment,
  });
  const checkCode = String(validated.check_code || '');
  if (checkCode && !checkCode.includes('SUCCESS')) {
    throw new Error(checkCode);
  }
  const created = await bybitRequest(creds, 'POST', '/v5/fgridbot/create', {}, body);
  const botId = created.bot_id ?? created.botId;
  if (!botId) throw new Error(created.debug_msg || 'Bybit did not return a grid bot id');
  return String(botId);
}

export async function stopBybitGrid(creds: { apiKey: string; secret: string }, botId: string): Promise<void> {
  try {
    await bybitRequest(creds, 'POST', '/v5/fgridbot/close', {}, { bot_id: botId });
  } catch (err: any) {
    const message = String(err?.message || err).toLowerCase();
    if (message.includes('already') || message.includes('not exist') || message.includes('closed')) return;
    throw err;
  }
}

export async function readBybitGrid(
  creds: { apiKey: string; secret: string },
  botId: string
): Promise<GridBotSnapshot> {
  const result = await bybitRequest(creds, 'GET', '/v5/fgridbot/detail', { bot_id: botId }, undefined);
  const row = (result.bot || result.detail || result) as Record<string, unknown>;
  const status = String(row.status || row.bot_status || row.state || '').toLowerCase();
  const running = status === '' || status.includes('run') || status === '1' || status === 'created';
  const stopped = status.includes('stop') || status.includes('clos') || status.includes('cancel') || status === '2';
  const pnlRaw = row.pnl ?? row.total_pnl ?? row.totalPnl ?? row.realized_pnl ?? row.profit;
  const pnl = Number(pnlRaw);
  return {
    exchangeBotId: botId,
    running: running && !stopped,
    pnlUsdt: Number.isFinite(pnl) ? pnl : null,
    raw: row,
  };
}
