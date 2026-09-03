import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

export const CONFIG = {
  supabaseUrl: process.env.SUPABASE_URL || 'https://uxsbjkymrqrmlcshizns.supabase.co',
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '',
  encryptionKey: process.env.ENCRYPTION_MASTER_KEY || '7a0e2e8468c1008f22a662bd17dee64128a8ebbf91d5b2ebfe36eff9e4e91bc6',
  scannerIntervalMs: Number(process.env.SCANNER_INTERVAL_MS || 10000),
  healthPingIntervalMs: Number(process.env.HEALTH_PING_INTERVAL_MS || 30000),
  billingCronIntervalMs: Number(process.env.BILLING_CRON_INTERVAL_MS || 3600000),
  defaultLeverage: Number(process.env.DEFAULT_LEVERAGE || 7.0),
  takeProfitPct: Number(process.env.TAKE_PROFIT_PCT || 5.0),
  stopLossPct: Number(process.env.STOP_LOSS_PCT || 1.5),
  adminTrc20Wallet: process.env.ADMIN_TRC20_WALLET || 'TFakeWalletAddressForTRC20USDTRechargeXXXX',
  adminBep20Wallet: process.env.ADMIN_BEP20_WALLET || '0xFakeWalletAddressForBEP20USDTRechargeXXXX',
};

if (!CONFIG.supabaseKey) {
  console.warn('⚠️ WARNING: SUPABASE_KEY is missing. Database operations will fail.');
}

export const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});
