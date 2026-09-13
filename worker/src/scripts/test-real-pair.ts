import ccxt from 'ccxt';
import { simulatePairEngine, RatioBar } from '../jobs/pair-simulator.js';
import { CONFIG } from '../config.js';

async function main() {
  console.log('📡 Fetching Binance 4h OHLCV for SOL/USDT and ADA/USDT...');
  const binance = new ccxt.binanceusdm({ enableRateLimit: true, options: { defaultType: 'future' } });
  
  const now = Date.now();
  const since = now - 150 * 24 * 3600 * 1000; // 150 days

  const solBars = await binance.fetchOHLCV('SOL/USDT', '4h', since, 900);
  const adaBars = await binance.fetchOHLCV('ADA/USDT', '4h', since, 900);

  const solMap = new Map<number, number[]>();
  for (const b of solBars) {
    if (b[0] !== undefined) solMap.set(b[0] as number, b as number[]);
  }

  const ratioBars: RatioBar[] = [];
  for (const ada of adaBars) {
    const ts = ada[0] as number;
    const sol = solMap.get(ts);
    if (!sol) continue;

    const [so, sh, sl, sc] = [sol[1] as number, sol[2] as number, sol[3] as number, sol[4] as number];
    const [ao, ah, al, ac] = [ada[1] as number, ada[2] as number, ada[3] as number, ada[4] as number];
    if (!ao || !ah || !al || !ac || ao <= 0 || ah <= 0 || al <= 0 || ac <= 0) continue;
    if (!so || !sh || !sl || !sc || so <= 0 || sh <= 0 || sl <= 0 || sc <= 0) continue;

    const open = so / ao;
    const close = sc / ac;
    const high = Math.max(sh / al, open, close);
    const low = Math.min(sl / ah, open, close);
    ratioBars.push({
      ts,
      open,
      high,
      low,
      close,
    });
  }

  console.log(`📊 Formed ${ratioBars.length} ratio bars for SOL/ADA`);

  const params = {
    leverage: CONFIG.defaultLeverage,
    emaSpan: 10,
    slAtrMult: CONFIG.slAtrMult,
    slMaxMarginPct: CONFIG.slMaxMarginPct,
    tpDisabled: CONFIG.tpDisabled,
    takeProfitPct: CONFIG.takeProfitPct,
    stopLossPct: CONFIG.stopLossPct,
    trailingActive: CONFIG.trailingActive,
    trailingActivationPct: CONFIG.trailingActivationPct,
    trailingDeltaPct: CONFIG.trailingDeltaPct,
    takerFeePct: CONFIG.takerFeePct,
    simSlippagePct: CONFIG.simSlippagePct,
    fundingLong8h: 0.0001,
    fundingShort8h: 0.0001,
  };

  const sim = simulatePairEngine(ratioBars, params);
  console.log('📈 Simulation Result on REAL SOL/ADA 4h data:');
  console.log({
    netPnlPct: sim.netPnlPct,
    trades: sim.trades,
    winRate: `${sim.winRate}%`,
    profitFactor: sim.profitFactor,
    maxDrawdownPct: `${sim.maxDrawdownPct}%`,
    slShare: sim.slShare,
    avgHoldBars: sim.avgHoldBars,
  });
}

main().catch(console.error);
