import crypto from 'node:crypto';
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
  const symbol = `${params.baseAsset}USDT`;
  const px = await bybitPrice(symbol);
  const body = {
    symbol,
    grid_mode: params.direction === 'long' ? 2 : params.direction === 'short' ? 3 : 1,
    min_price: px(params.lowerPrice),
    max_price: px(params.upperPrice),
    cell_number: params.gridCount,
    leverage: String(Math.round(params.leverage)),
    grid_type: params.spacing === 'geometric' ? 2 : 1,
    total_investment: params.marginUsdt.toFixed(2),
    tp_sl_type: 2,
    stop_loss_price: px(params.stopPrice),
    take_profit_price: px(params.takeProfitPrice),
  };
  const validated = await bybitRequest(creds, 'POST', '/v5/fgridbot/validate', {}, {
    symbol: body.symbol,
    grid_mode: body.grid_mode,
    min_price: body.min_price,
    max_price: body.max_price,
    cell_number: body.cell_number,
    leverage: body.leverage,
    grid_type: body.grid_type,
    init_margin: body.total_investment,
    tp_sl_type: body.tp_sl_type,
    stop_loss_price: body.stop_loss_price,
    take_profit_price: body.take_profit_price,
  });
  assertBybitGridCheck(validated, 'validate');
  const created = await bybitRequest(creds, 'POST', '/v5/fgridbot/create', {}, body);
  const botId = created.bot_id ?? created.botId;
  if (botId && isBybitGridOk(String(created.check_code || ''))) return String(botId);
  assertBybitGridCheck(created, 'create');
  throw new Error(created.debug_msg || 'Bybit did not return a grid bot id');
}

const tickCache = new Map<string, { tick: number; decimals: number }>();

async function bybitPrice(symbol: string): Promise<(price: number) => string> {
  let spec = tickCache.get(symbol);
  if (!spec) {
    const response = await fetch(`${BYBIT_BASE}/v5/market/instruments-info?category=linear&symbol=${symbol}`);
    const json = (await response.json().catch(() => ({}))) as {
      result?: { list?: Array<{ priceFilter?: { tickSize?: string } }> };
    };
    const tickSize = json.result?.list?.[0]?.priceFilter?.tickSize || '0.01';
    const tick = Number(tickSize);
    spec = {
      tick: Number.isFinite(tick) && tick > 0 ? tick : 0.01,
      decimals: (tickSize.split('.')[1] || '').length,
    };
    tickCache.set(symbol, spec);
  }
  const { tick, decimals } = spec;
  return (price: number) => (Math.round(price / tick) * tick).toFixed(decimals);
}

/** Bybit leaves check_code as UNSPECIFIED on a valid response. Only named codes are failures. */
function isBybitGridOk(code: string): boolean {
  return code === '' || code === 'FGRID_CHECK_CODE_SUCCESS' || code === 'FGRID_CHECK_CODE_UNSPECIFIED';
}

function assertBybitGridCheck(result: Record<string, any>, stage: string): void {
  const status = Number(result.status_code ?? 0);
  if (status === 421) {
    throw new Error(String(result.ban_reason_text || 'Bybit account cannot create a futures grid'));
  }
  if (status !== 0 && status !== 200) {
    throw new Error(String(result.debug_msg || `Bybit grid ${stage} status ${status}`));
  }
  const code = String(result.check_code || '');
  if (isBybitGridOk(code)) return;
  const hint = bybitRangeHint(code, result);
  throw new Error(hint ? `Bybit grid ${stage}: ${code} (${hint})` : `Bybit grid ${stage}: ${code}`);
}

function bybitRangeHint(code: string, result: Record<string, any>): string {
  const field = code.includes('INVESTMENT')
    ? 'investment'
    : code.includes('LOW_PRICE')
      ? 'min_price'
      : code.includes('HIGH_PRICE')
        ? 'max_price'
        : code.includes('GRID_NO')
          ? 'cell_number'
          : code.includes('LEVERAGE')
            ? 'leverage'
            : code.includes('_TP_')
              ? 'take_profit_price'
              : code.includes('_SL_')
                ? 'stop_loss_price'
                : '';
  const band = field ? result[field] : null;
  if (!band || band.from == null || band.to == null) return '';
  return `allowed ${band.from}-${band.to}`;
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
