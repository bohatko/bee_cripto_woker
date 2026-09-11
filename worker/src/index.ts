import type http from 'node:http';
import { CONFIG } from './config.js';
import { startInternalApiServer } from './api/internal-server.js';
import { MarketScanner } from './engine/market-scanner.js';
import { OrderRouter } from './engine/order-router.js';
import { PositionGuard } from './engine/position-guard.js';
import { HealthCheckJob } from './jobs/health-check.js';
import { BillingCronJob } from './jobs/billing-cron.js';
import { PairSelectionJob } from './jobs/pair-selection.js';
import { pairRegistry } from './exchanges/pair-registry.js';

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
  const pairSelection = new PairSelectionJob(60_000);

  // Wire signal listener to order router
  scanner.onSignal(async (signal) => {
    await orderRouter.handleEntrySignal(signal);
  });

  try {
    // 1. Load the dynamic basket from strategy_pairs (fallback: defaults)
    await pairRegistry.init();

    // 2. Initialize EMA 10 history from past klines
    await scanner.initEmaHistory();

    // 3. Perform initial scan
    await scanner.scanOnce();

    // 4. Start background processes
    pairRegistry.start();
    scanner.start();
    guard.start();
    healthCheck.start();
    billingCron.start();
    pairSelection.start();

    console.log('🚀 All worker modules initialized and running successfully.');

    // Graceful shutdown handling
    const shutdown = () => {
      console.log('\n🛑 Gracefully shutting down worker...');
      scanner.stop();
      guard.stop();
      healthCheck.stop();
      billingCron.stop();
      pairSelection.stop();
      pairRegistry.stop();
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
