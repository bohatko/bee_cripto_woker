import ccxt from 'ccxt';
import { supabase } from '../config.js';
import { ComponentHealthStatus } from '../types/index.js';

export class HealthCheckJob {
  private timer: NodeJS.Timeout | null = null;
  private intervalMs: number;

  constructor(intervalMs: number = 30000) {
    this.intervalMs = intervalMs;
  }

  public async pingExchanges() {
    const targets = [
      { name: 'binance_futures', client: new ccxt.binanceusdm({ enableRateLimit: true }) },
      { name: 'okx_futures', client: new ccxt.okx({ enableRateLimit: true }) },
      { name: 'bybit_futures', client: new ccxt.bybit({ enableRateLimit: true }) },
    ];

    for (const target of targets) {
      const start = Date.now();
      let status: ComponentHealthStatus = 'healthy';
      let latency = 0;
      let details: any = null;

      try {
        await target.client.fetchTime();
        latency = Date.now() - start;
        if (latency > 1500) status = 'degraded';
      } catch (err: any) {
        status = 'down';
        latency = Date.now() - start;
        details = { error: err.message };
      }

      await supabase.from('system_health_logs').upsert(
        {
          component: target.name,
          status,
          latency_ms: latency,
          details,
          pinged_at: new Date().toISOString(),
        },
        { onConflict: 'component' }
      );
    }

    // Ping worker engine itself
    await supabase.from('system_health_logs').upsert(
      {
        component: 'engine_daemon',
        status: 'healthy',
        latency_ms: 1,
        details: { uptime_sec: Math.floor(process.uptime()) },
        pinged_at: new Date().toISOString(),
      },
      { onConflict: 'component' }
    );
  }

  public start() {
    if (this.timer) return;
    console.log(`💓 Exchange Health Checker started (interval: ${this.intervalMs}ms)...`);
    // Run immediately once
    this.pingExchanges().catch((err) => console.error('Health ping error:', err));
    this.timer = setInterval(() => {
      this.pingExchanges().catch((err) => console.error('Health ping error:', err));
    }, this.intervalMs);
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
