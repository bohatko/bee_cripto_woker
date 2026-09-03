import { CONFIG } from './config.js';
import { MarketScanner } from './engine/market-scanner.js';
import { OrderRouter } from './engine/order-router.js';
import { PositionGuard } from './engine/position-guard.js';
import { HealthCheckJob } from './jobs/health-check.js';
import { BillingCronJob } from './jobs/billing-cron.js';

async function main() {
  console.log('====================================================');
  console.log('🐝 BEE CRYPTO WORKER - AUTONOMOUS TRADING DAEMON');
  console.log('   Target Architecture: Railway (Static Egress IP)');
  console.log('   Strategy: Multi-Pair Market-Neutral Alpha Basket');
  console.log('   Supabase Project: uxsbjkymrqrmlcshizns');
  console.log('====================================================');

  const orderRouter = new OrderRouter();
  const scanner = new MarketScanner(CONFIG.scannerIntervalMs);
  const guard = new PositionGuard(orderRouter, 5000);
  const healthCheck = new HealthCheckJob(CONFIG.healthPingIntervalMs);
  const billingCron = new BillingCronJob(CONFIG.billingCronIntervalMs);

  // Wire signal listener to order router
  scanner.onSignal(async (signal) => {
    await orderRouter.handleEntrySignal(signal);
  });

  try {
    // 1. Initialize EMA 10 history from past klines
    await scanner.initEmaHistory();

    // 2. Perform initial scan
    await scanner.scanOnce();

    // 3. Start background processes
    scanner.start();
    guard.start();
    healthCheck.start();
    billingCron.start();

    console.log('🚀 All worker modules initialized and running successfully.');

    // Graceful shutdown handling
    const shutdown = () => {
      console.log('\n🛑 Gracefully shutting down worker...');
      scanner.stop();
      guard.stop();
      healthCheck.stop();
      billingCron.stop();
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
