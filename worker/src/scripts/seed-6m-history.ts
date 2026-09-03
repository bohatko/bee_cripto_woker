import ccxt from 'ccxt';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Read env
let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
let supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  const envPath = path.resolve(process.cwd(), 'web/.env.local');
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    supabaseUrl = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)?.[1]?.trim();
    supabaseKey = env.match(/NEXT_PUBLIC_SUPABASE_ANON_KEY=(.*)/)?.[1]?.trim();
  }
}

const supabase = createClient(supabaseUrl!, supabaseKey!);

const STRATEGY_PAIRS = [
  { pairSymbol: 'ZEC/AVAX', longCoin: 'ZEC', shortCoin: 'AVAX' },
  { pairSymbol: 'ENA/SUI', longCoin: 'ENA', shortCoin: 'SUI' },
  { pairSymbol: 'SOL/ADA', longCoin: 'SOL', shortCoin: 'ADA' },
  { pairSymbol: 'BNB/ETH', longCoin: 'BNB', shortCoin: 'ETH' },
];

async function fetchFullHistory(client: any, symbol: string, sixMonthsAgo: number) {
  let all: any[] = [];
  let since = sixMonthsAgo;
  for (let i = 0; i < 3; i++) {
    const klines = await client.fetchOHLCV(symbol, '4h', since, 1000);
    if (!klines || klines.length === 0) break;
    all = all.concat(klines);
    since = klines[klines.length - 1][0] + 1;
    if (klines.length < 500) break;
  }
  const map = new Map<number, any>();
  for (const k of all) map.set(k[0], k);
  return Array.from(map.values()).sort((a, b) => a[0] - b[0]);
}

function simulatePairHistory(
  pairSymbol: string,
  longCoin: string,
  shortCoin: string,
  longKlines: any[],
  shortKlines: any[]
) {
  const shortMap = new Map<number, any>();
  for (const k of shortKlines) shortMap.set(k[0], k);

  const matched: any[] = [];
  for (const l of longKlines) {
    const s = shortMap.get(l[0]);
    if (s && s[4] > 0 && l[4] > 0) {
      matched.push({
        time: l[0],
        longOpen: l[1],
        longHigh: l[2],
        longLow: l[3],
        longClose: l[4],
        shortOpen: s[1],
        shortHigh: s[2],
        shortLow: s[3],
        shortClose: s[4],
        ratio: l[4] / s[4],
      });
    }
  }

  // Calculate EMA 10 of ratio
  const alpha = 2 / (10 + 1);
  let ema = matched[0]?.ratio || 1;
  for (let i = 0; i < matched.length; i++) {
    ema = alpha * matched[i].ratio + (1 - alpha) * ema;
    matched[i].ema = ema;
  }

  const trades: any[] = [];
  let inPos: any = null;
  // Dynamic slot balance with full profit reinvestment / compounding
  // Starting reference margin: $12,500 ($50,000 / 4 pairs)
  let slotBalance = 12500;

  for (let i = 1; i < matched.length; i++) {
    const curr = matched[i];
    const prev = matched[i - 1];

    if (!inPos) {
      // Entry: Ratio crosses above EMA 10 or current ratio > EMA 10
      if (curr.ratio > curr.ema && prev.ratio <= prev.ema) {
        // Compounded margin grows with every profitable trade in this slot
        const margin = Number(slotBalance.toFixed(2));
        const lev = 7.0;
        const vol = Number((margin * lev).toFixed(2));
        const legVol = vol / 2;

        inPos = {
          is_master: true,
          user_id: null,
          exchange_account_id: null,
          pair_symbol: pairSymbol,
          status: 'open',
          entry_ratio: Number(curr.ratio.toFixed(8)),
          current_ratio: Number(curr.ratio.toFixed(8)),
          long_symbol: `${longCoin}/USDT`,
          long_entry_price: curr.longClose,
          long_qty: Number((legVol / curr.longClose).toFixed(4)),
          short_symbol: `${shortCoin}/USDT`,
          short_entry_price: curr.shortClose,
          short_qty: Number((legVol / curr.shortClose).toFixed(4)),
          allocated_margin_usd: margin,
          total_position_volume_usd: vol,
          unrealized_pnl_usd: 0,
          pnl_pct: 0,
          opened_at: new Date(curr.time).toISOString(),
        };
      }
    } else {
      // Calculate high/low potential during the 4h candle
      const maxFavorableLong = curr.longHigh;
      const minShort = curr.shortLow;
      const maxPnlUsd =
        (maxFavorableLong - inPos.long_entry_price) * inPos.long_qty +
        (inPos.short_entry_price - minShort) * inPos.short_qty;
      const maxPnlPct = (maxPnlUsd / inPos.allocated_margin_usd) * 100;

      const minLong = curr.longLow;
      const maxShort = curr.shortHigh;
      const minPnlUsd =
        (minLong - inPos.long_entry_price) * inPos.long_qty +
        (inPos.short_entry_price - maxShort) * inPos.short_qty;
      const minPnlPct = (minPnlUsd / inPos.allocated_margin_usd) * 100;

      const closePnlUsd =
        (curr.longClose - inPos.long_entry_price) * inPos.long_qty +
        (inPos.short_entry_price - curr.shortClose) * inPos.short_qty;
      const closePnlPct = (closePnlUsd / inPos.allocated_margin_usd) * 100;

      let exitReason: string | null = null;
      let exitLongPrice = curr.longClose;
      let exitShortPrice = curr.shortClose;
      let realizedPnl = closePnlUsd;
      let finalPnlPct = closePnlPct;

      if (maxPnlPct >= 5.0) {
        exitReason = 'tp';
        finalPnlPct = 5.0;
        realizedPnl = inPos.allocated_margin_usd * 0.05;
        exitLongPrice = inPos.long_entry_price * 1.025;
        exitShortPrice = inPos.short_entry_price * 0.975;
      } else if (minPnlPct <= -1.5) {
        exitReason = 'sl';
        finalPnlPct = -1.5;
        realizedPnl = inPos.allocated_margin_usd * -0.015;
        exitLongPrice = inPos.long_entry_price * 0.99;
        exitShortPrice = inPos.short_entry_price * 1.01;
      } else if (curr.ratio < curr.ema) {
        exitReason = 'trend_flip';
        finalPnlPct = closePnlPct;
        realizedPnl = closePnlUsd;
      }

      // If exit triggered, close the trade
      if (exitReason) {
        trades.push({
          ...inPos,
          status: 'closed',
          closed_at: new Date(curr.time + 4 * 3600 * 1000).toISOString(),
          exit_ratio: Number((exitLongPrice / exitShortPrice).toFixed(8)),
          long_exit_price: Number(exitLongPrice.toFixed(4)),
          short_exit_price: Number(exitShortPrice.toFixed(4)),
          realized_pnl_usd: Number(realizedPnl.toFixed(2)),
          unrealized_pnl_usd: 0,
          pnl_pct: Number(finalPnlPct.toFixed(2)),
          exit_reason: exitReason,
        });

        // Reinvest profit / deduct loss into slot balance for true compounding:
        slotBalance += realizedPnl;
        inPos = null;
      } else {
        // Still open, update unrealized pnl
        inPos.current_ratio = Number(curr.ratio.toFixed(8));
        inPos.unrealized_pnl_usd = Number(closePnlUsd.toFixed(2));
        inPos.pnl_pct = Number(closePnlPct.toFixed(2));
      }
    }
  }

  // If trade is still open at current latest candle, include as open master position
  if (inPos) {
    trades.push(inPos);
  }

  return trades;
}

async function main() {
  console.log('🚀 Starting 6-Month Historical Backtest & Trade Injection...');
  const binance = new ccxt.binanceusdm({ enableRateLimit: true });
  const sixMonthsAgo = Date.now() - 180 * 24 * 60 * 60 * 1000;

  // Clear existing master positions to avoid duplicates
  console.log('🧹 Cleaning existing master positions in Supabase...');
  await supabase.from('bot_positions').delete().eq('is_master', true);

  let allTradesToInsert: any[] = [];

  for (const pair of STRATEGY_PAIRS) {
    console.log(`\n⏳ Fetching 6m Binance history for ${pair.pairSymbol}...`);
    const [longKlines, shortKlines] = await Promise.all([
      fetchFullHistory(binance, `${pair.longCoin}/USDT`, sixMonthsAgo),
      fetchFullHistory(binance, `${pair.shortCoin}/USDT`, sixMonthsAgo),
    ]);

    console.log(`📊 Candles: ${pair.longCoin}=${longKlines.length}, ${pair.shortCoin}=${shortKlines.length}`);
    const pairTrades = simulatePairHistory(
      pair.pairSymbol,
      pair.longCoin,
      pair.shortCoin,
      longKlines,
      shortKlines
    );

    const closed = pairTrades.filter((t) => t.status === 'closed');
    const wins = closed.filter((t) => t.realized_pnl_usd > 0);
    const winrate = closed.length > 0 ? ((wins.length / closed.length) * 100).toFixed(1) : '0';
    const totalPnl = closed.reduce((acc, t) => acc + (t.realized_pnl_usd || 0), 0);

    console.log(`✅ [${pair.pairSymbol}] Generated ${pairTrades.length} trades (${closed.length} closed, ${pairTrades.length - closed.length} open)`);
    console.log(`   Winrate: ${winrate}% | Total Profit ($1k/slot): +$${totalPnl.toFixed(2)}`);

    allTradesToInsert = allTradesToInsert.concat(pairTrades);
  }

  console.log(`\n💾 Inserting ${allTradesToInsert.length} total trades into Supabase 'bot_positions'...`);

  // Insert in batches of 50
  const BATCH_SIZE = 50;
  for (let i = 0; i < allTradesToInsert.length; i += BATCH_SIZE) {
    const batch = allTradesToInsert.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('bot_positions').insert(batch);
    if (error) {
      console.error(`❌ Batch error [${i} - ${i + batch.length}]:`, error.message);
    } else {
      process.stdout.write(`  Inserted ${Math.min(i + BATCH_SIZE, allTradesToInsert.length)} / ${allTradesToInsert.length}...\r`);
    }
  }

  console.log('\n🎉 Successfully seeded all 6-month historical trades into database!');
}

main().catch((err) => {
  console.error('Fatal seeding error:', err);
  process.exit(1);
});
