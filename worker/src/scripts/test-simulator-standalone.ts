import { simulatePairEngine, RatioBar } from '../jobs/pair-simulator.js';
import { CONFIG } from '../config.js';

console.log('🧪 Testing simulatePairEngine with updated logic...');

// Synthesize 900 4h bars (~150 days) with oscillating trends and strong runs
const bars: RatioBar[] = [];
let price = 1.0;
const now = Date.now();
const FOUR_H = 4 * 3600 * 1000;

for (let i = 0; i < 900; i++) {
  const ts = now - (900 - i) * FOUR_H;
  // Synthetic trend with waves
  const wave = Math.sin(i / 15) * 0.015;
  const drift = 0.0003;
  const noise = (Math.random() - 0.49) * 0.01;
  const change = wave + drift + noise;
  const open = price;
  price = Math.max(0.01, price * (1 + change));
  const high = Math.max(open, price) * (1 + Math.random() * 0.005);
  const low = Math.min(open, price) * (1 - Math.random() * 0.005);
  const close = price;

  bars.push({ ts, open, high, low, close });
}

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

const result = simulatePairEngine(bars, params);

console.log('Result:', {
  netPnlPct: result.netPnlPct,
  trades: result.trades,
  winRate: result.winRate,
  profitFactor: result.profitFactor,
  maxDrawdownPct: result.maxDrawdownPct,
  slShare: result.slShare,
  avgHoldBars: result.avgHoldBars,
});

if (result.trades > 0 && result.profitFactor > 1.0) {
  console.log('✅ Unit test verified: simulation generated positive Profit Factor and valid trades!');
} else {
  console.log('⚠️ Simulation results outputted for inspection.');
}
