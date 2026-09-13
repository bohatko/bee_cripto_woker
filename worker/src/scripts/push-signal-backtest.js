/**
 * Pushes generated SQL batches to Supabase via the Management SQL endpoint
 * is not available locally — this script uses @supabase/supabase-js service role
 * for reliable bulk upsert of the pre-built backtest rows.
 *
 * Prefer MCP execute_sql when available; this is a fallback runner.
 */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

async function main() {
  const env = {
    ...loadEnv(path.resolve(__dirname, '../../.env')),
    ...loadEnv(path.resolve(__dirname, '../../../.env')),
  };
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const SOURCE =
    'C:/Projects/PET-projects/dump_cripto_bot/research/dip_buy/out/db_exports/backtest_trades_BTC_ETH_XRP.json';
  const crypto = require('crypto');
  const j = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));

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

  const events = [];
  const positions = [];

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
      const qty = Number((notional / entry).toFixed(6));
      const tpPct = Number(t.tp_pct);
      const slPct = Number(t.sl_pct);
      const entryFee = Number((notional * FEE).toFixed(4));
      const exitFee = Number((notional * FEE).toFixed(4));
      const orderId = `backtest_${coin}_${t.trade_id}`;

      events.push({
        id: eventId,
        strategy_id: strategyId,
        symbol: coin,
        signal_bar_ts: t.entry_time,
        rolling_max: Number((entry / (1 - dropPct / 100)).toFixed(6)),
        signal_close: Number(entry.toFixed(6)),
        drop_pct: dropPct,
        reference_entry_price: Number(entry.toFixed(6)),
        status: 'fired',
        created_at: t.entry_time,
      });

      positions.push({
        id: posId,
        signal_event_id: eventId,
        strategy_id: strategyId,
        user_id: null,
        exchange_account_id: null,
        is_master: true,
        symbol: coin,
        side: 'long',
        status: 'closed',
        leverage: lev,
        allocated_margin_usd: Number(margin.toFixed(4)),
        notional_usd: Number(notional.toFixed(4)),
        qty,
        entry_price: Number(entry.toFixed(6)),
        entry_order_id: orderId,
        tp_price: Number((entry * (1 + tpPct / 100)).toFixed(6)),
        sl_price: Number((entry * (1 - slPct / 100)).toFixed(6)),
        exit_price: Number(exit.toFixed(6)),
        exit_order_id: `${orderId}_exit`,
        exit_reason: t.exit_reason === 'sl' ? 'sl' : 'tp',
        entry_fees_usd: entryFee,
        exit_fees_usd: exitFee,
        funding_fees_usd: 0,
        gross_pnl_usd: Number((Number(t.pnl_usd) + entryFee + exitFee).toFixed(4)),
        realized_pnl_usd: Number(Number(t.pnl_usd).toFixed(4)),
        unrealized_pnl_usd: 0,
        pnl_pct: Number(Number(t.pnl_pct_on_margin).toFixed(2)),
        last_error: 'historical_backtest_import',
        opened_at: t.entry_time,
        closed_at: t.exit_time,
      });
    }
  }

  console.log(`Preparing upsert: ${events.length} events, ${positions.length} positions`);

  await supabase
    .from('signal_positions')
    .delete()
    .like('entry_order_id', 'backtest_%');

  // Delete prior deterministic event ids in chunks
  for (let i = 0; i < events.length; i += 100) {
    const ids = events.slice(i, i + 100).map((e) => e.id);
    const { error } = await supabase.from('signal_events').delete().in('id', ids);
    if (error) throw error;
  }

  for (let i = 0; i < events.length; i += 50) {
    const slice = events.slice(i, i + 50);
    const { error } = await supabase.from('signal_events').upsert(slice, { onConflict: 'id' });
    if (error) throw new Error(`events batch ${i}: ${error.message}`);
    console.log(`events upserted ${Math.min(i + 50, events.length)}/${events.length}`);
  }

  for (let i = 0; i < positions.length; i += 50) {
    const slice = positions.slice(i, i + 50);
    const { error } = await supabase.from('signal_positions').upsert(slice, { onConflict: 'id' });
    if (error) throw new Error(`positions batch ${i}: ${error.message}`);
    console.log(`positions upserted ${Math.min(i + 50, positions.length)}/${positions.length}`);
  }

  const { count: evCount } = await supabase
    .from('signal_events')
    .select('*', { count: 'exact', head: true });
  const { count: masterCount } = await supabase
    .from('signal_positions')
    .select('*', { count: 'exact', head: true })
    .eq('is_master', true)
    .eq('status', 'closed');

  console.log(JSON.stringify({ signal_events: evCount, master_closed: masterCount }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
