import ccxt from 'ccxt';
import { simulatePairEngine, RatioBar } from '../jobs/pair-simulator.js';
import { CONFIG } from '../config.js';

async function testPair(binance: any, coinA: string, coinB: string) {
  const since = Date.now() - 150 * 24 * 3600 * 1000;
  const aBars = await binance.fetchOHLCV(`${coinA}/USDT`, '4h', since, 900);
  const bBars = await binance.fetchOHLCV(`${coinB}/USDT`, '4h', since, 900);

  const aMap = new Map<number, number[]>();
  for (const b of aBars) {
    if (b[0] !== undefined) aMap.set(b[0] as number, b as number[]);
  }

  const ratioBars: RatioBar[] = [];
  for (const b of bBars) {
    const ts = b[0] as number;
    const a = aMap.get(ts);
    if (!a) continue;

    const [ao, ah, al, ac] = [a[1] as number, a[2] as number, a[3] as number, a[4] as number];
    const [bo, bh, bl, bc] = [b[1] as number, b[2] as number, b[3] as number, b[4] as number];
    if (!bo || !bh || !bl || !bc || bo <= 0 || bh <= 0 || bl <= 0 || bc <= 0) continue;
    if (!ao || !ah || !al || !ac || ao <= 0 || ah <= 0 || al <= 0 || ac <= 0) continue;

    const open = ao / bo;
    const close = ac / bc;
    const high = Math.max(open, close, Math.min(ah / bl, (ao / bo) * 1.05));
    const low = Math.min(open, close, Math.max(al / bh, (ao / bo) * 0.95));
    ratioBars.push({
      ts,
      open,
      high,
      low,
      close,
    });
  }

  const inSampleSlice = ratioBars.slice(0, Math.floor(ratioBars.length * 0.75));
  const oosSlice = ratioBars.slice(Math.floor(ratioBars.length * 0.75));

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

  const simIs = simulatePairEngine(inSampleSlice, params);
  const simOos = simulatePairEngine(oosSlice, params);

  console.log(`Pair: ${coinA}/${coinB} | IS: Net=${simIs.netPnlPct.toFixed(1)}%, PF=${simIs.profitFactor}, Trades=${simIs.trades}, MaxDD=${simIs.maxDrawdownPct}% | OOS: Net=${simOos.netPnlPct.toFixed(1)}%, PF=${simOos.profitFactor}`);
}

async function main() {
  const binance = new ccxt.binanceusdm({ enableRateLimit: true, options: { defaultType: 'future' } });
  const pairs = [
    ['ZEC', 'AVAX'],
    ['ENA', 'SUI'],
    ['BNB', 'ETH'],
    ['SOL', 'ADA'],
    ['ETH', 'BTC'],
    ['AVAX', 'SOL'],
    ['NEAR', 'APT'],
    ['UNI', 'AAVE'],
    ['SUI', 'APT'],
    ['SOL', 'ETH'],
    ['DOGE', 'SHIB'],
    ['PEPE', 'WIF'],
    ['AAVE', 'MKR'],
    ['NEAR', 'SOL'],
    ['TAO', 'RENDER'],
    ['LINK', 'UNI'],
  ];

  for (const [a, b] of pairs) {
    try {
      await testPair(binance, a, b);
    } catch (e: any) {
      console.log(`Failed ${a}/${b}:`, e.message);
    }
  }
}

main().catch(console.error);
