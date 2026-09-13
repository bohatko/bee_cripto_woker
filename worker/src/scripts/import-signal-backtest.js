const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const SOURCE =
  'C:/Projects/PET-projects/dump_cripto_bot/research/dip_buy/out/db_exports/backtest_trades_BTC_ETH_XRP.json';
const outDir = path.resolve(__dirname, '../../../doc/migrations/signal_backtest_import');

const STRATEGY = { XRP: 'xrp_dip_buy_v1', BTC: 'btc_dip_buy_v1', ETH: 'eth_dip_buy_v1' };
const DROP = { XRP: 15, BTC: 3, ETH: 5 };
const FEE = 0.001;

function uuidFrom(seed) {
  const h = crypto.createHash('sha256').update(seed).digest();
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function sqlNum(v, d = 6) {
  return Number(Number(v).toFixed(d)).toString();
}

function sqlStr(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

const j = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
const eventRows = [];
const posRows = [];

for (const run of j.runs) {
  const coin = run.config.coin;
  const strategyId = STRATEGY[coin];
  const dropPct = DROP[coin];

  for (const t of run.trades) {
    const eventId = uuidFrom(`signal-event-backtest-${coin}-${t.trade_id}`);
    const posId = uuidFrom(`signal-pos-backtest-${coin}-${t.trade_id}`);
    const entry = Number(t.entry_price);
    const exit = Number(t.exit_price);
    const lev = Number(t.leverage);
    const margin = Number(t.margin_usd);
    const notional = Number(t.notional_usd);
    const qty = notional / entry;
    const tpPct = Number(t.tp_pct);
    const slPct = Number(t.sl_pct);
    const tpPrice = entry * (1 + tpPct / 100);
    const slPrice = entry * (1 - slPct / 100);
    const entryFee = notional * FEE;
    const exitFee = notional * FEE;
    const rollingMax = entry / (1 - dropPct / 100);
    const exitReason = t.exit_reason === 'sl' ? 'sl' : 'tp';
    const orderId = `backtest_${coin}_${t.trade_id}`;

    eventRows.push({
      id: eventId,
      strategy_id: strategyId,
      symbol: coin,
      signal_bar_ts: t.entry_time,
      rolling_max: rollingMax,
      signal_close: entry,
      drop_pct: dropPct,
      reference_entry_price: entry,
      status: 'fired',
      created_at: t.entry_time,
    });

    posRows.push({
      id: posId,
      signal_event_id: eventId,
      strategy_id: strategyId,
      is_master: true,
      symbol: coin,
      side: 'long',
      status: 'closed',
      leverage: lev,
      allocated_margin_usd: margin,
      notional_usd: notional,
      qty,
      entry_price: entry,
      entry_order_id: orderId,
      tp_price: tpPrice,
      sl_price: slPrice,
      exit_price: exit,
      exit_order_id: `${orderId}_exit`,
      exit_reason: exitReason,
      entry_fees_usd: entryFee,
      exit_fees_usd: exitFee,
      funding_fees_usd: 0,
      gross_pnl_usd: Number(t.pnl_usd) + entryFee + exitFee,
      realized_pnl_usd: Number(t.pnl_usd),
      unrealized_pnl_usd: 0,
      pnl_pct: Number(t.pnl_pct_on_margin),
      last_error: 'historical_backtest_import',
      opened_at: t.entry_time,
      closed_at: t.exit_time,
    });
  }
}

fs.mkdirSync(outDir, { recursive: true });

const allEventIds = eventRows.map((e) => sqlStr(e.id)).join(',');
const cleanup = [
  "DELETE FROM public.signal_positions WHERE entry_order_id LIKE 'backtest_%' OR last_error = 'historical_backtest_import';",
  `DELETE FROM public.signal_events WHERE id IN (${allEventIds});`,
  '',
].join('\n');
fs.writeFileSync(path.join(outDir, '00_cleanup.sql'), cleanup);

const batchSize = 40;
const batches = [];
for (let i = 0; i < eventRows.length; i += batchSize) {
  const evSlice = eventRows.slice(i, i + batchSize);
  const posSlice = posRows.slice(i, i + batchSize);
  let sql = '';

  sql +=
    'INSERT INTO public.signal_events (id, strategy_id, symbol, signal_bar_ts, rolling_max, signal_close, drop_pct, reference_entry_price, status, created_at) VALUES\n';
  sql += evSlice
    .map(
      (e) =>
        `(${sqlStr(e.id)},${sqlStr(e.strategy_id)},${sqlStr(e.symbol)},${sqlStr(e.signal_bar_ts)},${sqlNum(e.rolling_max, 6)},${sqlNum(e.signal_close, 6)},${sqlNum(e.drop_pct, 2)},${sqlNum(e.reference_entry_price, 6)},${sqlStr(e.status)},${sqlStr(e.created_at)})`
    )
    .join(',\n');
  sql +=
    '\nON CONFLICT (id) DO UPDATE SET strategy_id=EXCLUDED.strategy_id, symbol=EXCLUDED.symbol, signal_bar_ts=EXCLUDED.signal_bar_ts, rolling_max=EXCLUDED.rolling_max, signal_close=EXCLUDED.signal_close, drop_pct=EXCLUDED.drop_pct, reference_entry_price=EXCLUDED.reference_entry_price, status=EXCLUDED.status, created_at=EXCLUDED.created_at;\n\n';

  sql +=
    'INSERT INTO public.signal_positions (id, signal_event_id, strategy_id, user_id, exchange_account_id, is_master, symbol, side, status, leverage, allocated_margin_usd, notional_usd, qty, entry_price, entry_order_id, tp_price, sl_price, exit_price, exit_order_id, exit_reason, entry_fees_usd, exit_fees_usd, funding_fees_usd, gross_pnl_usd, realized_pnl_usd, unrealized_pnl_usd, pnl_pct, last_error, opened_at, closed_at) VALUES\n';
  sql += posSlice
    .map((p) => {
      const cols = [
        sqlStr(p.id),
        sqlStr(p.signal_event_id),
        sqlStr(p.strategy_id),
        'NULL',
        'NULL',
        'true',
        sqlStr(p.symbol),
        sqlStr(p.side),
        `${sqlStr(p.status)}::signal_position_status`,
        sqlNum(p.leverage, 2),
        sqlNum(p.allocated_margin_usd, 4),
        sqlNum(p.notional_usd, 4),
        sqlNum(p.qty, 6),
        sqlNum(p.entry_price, 6),
        sqlStr(p.entry_order_id),
        sqlNum(p.tp_price, 6),
        sqlNum(p.sl_price, 6),
        sqlNum(p.exit_price, 6),
        sqlStr(p.exit_order_id),
        `${sqlStr(p.exit_reason)}::signal_exit_reason`,
        sqlNum(p.entry_fees_usd, 4),
        sqlNum(p.exit_fees_usd, 4),
        '0',
        sqlNum(p.gross_pnl_usd, 4),
        sqlNum(p.realized_pnl_usd, 4),
        '0',
        sqlNum(p.pnl_pct, 2),
        sqlStr(p.last_error),
        sqlStr(p.opened_at),
        sqlStr(p.closed_at),
      ];
      return `(${cols.join(',')})`;
    })
    .join(',\n');
  sql +=
    '\nON CONFLICT (id) DO UPDATE SET signal_event_id=EXCLUDED.signal_event_id, strategy_id=EXCLUDED.strategy_id, is_master=EXCLUDED.is_master, symbol=EXCLUDED.symbol, side=EXCLUDED.side, status=EXCLUDED.status, leverage=EXCLUDED.leverage, allocated_margin_usd=EXCLUDED.allocated_margin_usd, notional_usd=EXCLUDED.notional_usd, qty=EXCLUDED.qty, entry_price=EXCLUDED.entry_price, entry_order_id=EXCLUDED.entry_order_id, tp_price=EXCLUDED.tp_price, sl_price=EXCLUDED.sl_price, exit_price=EXCLUDED.exit_price, exit_order_id=EXCLUDED.exit_order_id, exit_reason=EXCLUDED.exit_reason, entry_fees_usd=EXCLUDED.entry_fees_usd, exit_fees_usd=EXCLUDED.exit_fees_usd, funding_fees_usd=EXCLUDED.funding_fees_usd, gross_pnl_usd=EXCLUDED.gross_pnl_usd, realized_pnl_usd=EXCLUDED.realized_pnl_usd, unrealized_pnl_usd=EXCLUDED.unrealized_pnl_usd, pnl_pct=EXCLUDED.pnl_pct, last_error=EXCLUDED.last_error, opened_at=EXCLUDED.opened_at, closed_at=EXCLUDED.closed_at;\n';

  const name = `batch_${String(batches.length + 1).padStart(2, '0')}.sql`;
  fs.writeFileSync(path.join(outDir, name), sql);
  batches.push(name);
}

fs.writeFileSync(
  path.join(outDir, 'meta.json'),
  JSON.stringify(
    {
      events: eventRows.length,
      positions: posRows.length,
      batches: batches.length,
      start_equity_per_coin_usd: j.start_equity_per_coin_usd,
      runs: j.runs.map((r) => ({
        coin: r.config.coin,
        n_trades: r.summary.n_trades,
        final_equity_usd: r.summary.final_equity_usd,
      })),
    },
    null,
    2
  )
);

console.log(
  JSON.stringify(
    { outDir, events: eventRows.length, positions: posRows.length, batches: batches.length },
    null,
    2
  )
);
