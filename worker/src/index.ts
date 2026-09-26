import type http from 'node:http';
import { CONFIG, supabase } from './config.js';
import { startInternalApiServer } from './api/internal-server.js';
import { MarketScanner } from './engine/market-scanner.js';
import { OrderRouter } from './engine/order-router.js';
import { PositionGuard } from './engine/position-guard.js';
import { HealthCheckJob } from './jobs/health-check.js';
import { BillingCronJob } from './jobs/billing-cron.js';
import { PairSelectionJob } from './jobs/pair-selection-engine-aware.js';
import { pairRegistry } from './exchanges/pair-registry.js';
import { DipBuyScanner } from './signals/dip-buy-scanner.js';
import { DipBuyRouter } from './signals/dip-buy-router.js';
import { DipBuyGuard } from './signals/dip-buy-guard.js';
import { GridSupervisor } from './grid/supervisor.js';

type DipBuyEngine = {
  strategyId: string;
  symbol: string;
  scanner: DipBuyScanner;
  guard: DipBuyGuard;
};

async function loadDipBuyEngines(dipRouter: DipBuyRouter): Promise<DipBuyEngine[]> {
  const { data, error } = await supabase
    .from('signal_strategies')
    .select('id, symbol, is_enabled')
    .eq('is_enabled', true);

  if (error) {
    throw new Error(`Failed to load signal_strategies: ${error.message}`);
  }

  const engines: DipBuyEngine[] = [];
  for (const row of data || []) {
    const strategyId = String(row.id);
    const symbol = String(row.symbol || '').toUpperCase();
    if (!strategyId || !symbol) continue;

    const scanner = new DipBuyScanner(strategyId, symbol);
    const guard = new DipBuyGuard(scanner.getBuffer(), strategyId, symbol, CONFIG.dipGuardIntervalMs);
    scanner.onSignal(async (signalPayload) => {
      await dipRouter.handleSignal(signalPayload);
    });
    engines.push({ strategyId, symbol, scanner, guard });
  }

  return engines;
}

async function main() {
  console.log('====================================================');
  console.log('🐝 BEE CRYPTO WORKER - AUTONOMOUS TRADING DAEMON');
  console.log('   Target Architecture: Railway (Static Egress IP)');
  console.log('   Strategy: Multi-Pair Market-Neutral Alpha Basket');
  console.log('   Supabase Project: uxsbjkymrqrmlcshizns');
  console.log('====================================================');

  let apiServer: http.Server | null = null;
  try {
    apiServer = startInternalApiServer();
  } catch (err: any) {
    console.error('💥 Failed to start internal API server:', err.message);
    process.exit(1);
  }

  const scanner = new MarketScanner(CONFIG.scannerIntervalMs);
  const orderRouter = new OrderRouter(scanner);
  const guard = new PositionGuard(orderRouter, scanner, 5000);
  const healthCheck = new HealthCheckJob(CONFIG.healthPingIntervalMs);
  const billingCron = new BillingCronJob(CONFIG.billingCronIntervalMs);
  const pairSelection = new PairSelectionJob(10_000);
  const gridSupervisor = new GridSupervisor(30_000);

  // Dip-Buy Signals Engines (loaded from signal_strategies)
  const dipRouter = new DipBuyRouter();
  let dipEngines: DipBuyEngine[] = [];

  // Wire signal listener to order router
  scanner.onSignal(async (signal) => {
    await orderRouter.handleEntrySignal(signal);
  });

  try {
    // 1. Load the dynamic basket from strategy_pairs (fallback: defaults)
    await pairRegistry.init();

    // 2. Initialize EMA 10 history from past klines
    await scanner.initEmaHistory();

    // 3. Pre-load 1m history for Dip-Buy Signals engines
    if (CONFIG.dipBuyEnabled) {
      dipEngines = await loadDipBuyEngines(dipRouter);
      for (const engine of dipEngines) {
        await engine.scanner.initHistory();
      }
    }

    // 4. Perform initial scan
    await scanner.scanOnce();

    // 5. Start background processes
    pairRegistry.start();
    scanner.start();
    guard.start();
    healthCheck.start();
    billingCron.start();
    pairSelection.start();
    gridSupervisor.start();

    if (CONFIG.dipBuyEnabled) {
      for (const engine of dipEngines) {
        engine.scanner.start();
        engine.guard.start();
      }
      const symbols = dipEngines.map((e) => e.symbol).join(', ') || 'none';
      console.log(`📡 Dip-Buy Signals Engines started (${symbols}).`);
    }

    console.log('🚀 All worker modules initialized and running successfully.');

    // Graceful shutdown handling
    const shutdown = () => {
      console.log('\n🛑 Gracefully shutting down worker...');
      scanner.stop();
      guard.stop();
      healthCheck.stop();
      billingCron.stop();
      pairSelection.stop();
      gridSupervisor.stop();
      pairRegistry.stop();
      if (CONFIG.dipBuyEnabled) {
        for (const engine of dipEngines) {
          engine.scanner.stop();
          engine.guard.stop();
        }
      }
      if (apiServer) {
        apiServer.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 3000).unref();
        return;
      }
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err: any) {
    console.error('💥 Fatal error starting Worker Engine:', err.message);
    process.exit(1);
  }
}

main();
