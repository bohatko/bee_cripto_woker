import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

function parseBool(val: string | undefined, fallback: boolean): boolean {
  if (val === undefined || val === null) return fallback;
  return ['true', '1', 'yes'].includes(val.trim().toLowerCase());
}

function parseEnum<T extends string>(val: string | undefined, allowed: T[], fallback: T): T {
  if (!val) return fallback;
  const normalized = val.trim().toLowerCase() as T;
  return allowed.includes(normalized) ? normalized : fallback;
}

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
  takerFeePct: Number(process.env.TAKER_FEE_PCT || 0.055),
  makerFeePct: Number(process.env.MAKER_FEE_PCT || 0.02),
  entryExecutionMode: parseEnum(process.env.ENTRY_EXECUTION_MODE, ['market', 'maker_hedge'] as const, 'market'),
  exitExecutionMode: parseEnum(process.env.EXIT_EXECUTION_MODE, ['market', 'maker_hedge'] as const, 'market'),
  makerPollMs: Number(process.env.MAKER_POLL_MS || 1500),
  makerMaxReprices: Number(process.env.MAKER_MAX_REPRICES || 5),
  makerTimeoutMs: Number(process.env.MAKER_TIMEOUT_MS || 45000),
  reentryGuardEnabled: parseBool(process.env.REENTRY_GUARD_ENABLED, true),
  reentryCooldownAfterSlMs: Number(process.env.REENTRY_COOLDOWN_AFTER_SL_MS || 4 * 60 * 60 * 1000),
  reentryRequireNew4hClose: parseBool(process.env.REENTRY_REQUIRE_NEW_4H_CLOSE, true),
  reentryHysteresisPct: Number(process.env.REENTRY_HYSTERESIS_PCT || 0.5),
  maxConsecutiveSl: Number(process.env.MAX_CONSECUTIVE_SL || 2),
  slStreakBlockMs: Number(process.env.SL_STREAK_BLOCK_MS || 24 * 60 * 60 * 1000),
  riskMode: parseEnum(process.env.RISK_MODE, ['margin', 'spread'] as const, 'margin'),
  slAtrMult: Number(process.env.SL_ATR_MULT || 0),
  slMaxMarginPct: Number(process.env.SL_MAX_MARGIN_PCT || 10),
  tpDisabled: parseBool(process.env.TP_DISABLED, false),
  entryOn4hCloseOnly: parseBool(process.env.ENTRY_ON_4H_CLOSE_ONLY, false),
  entry4hCloseGraceMs: Number(process.env.ENTRY_4H_CLOSE_GRACE_MS || 600000),
  adminTrc20Wallet: process.env.ADMIN_TRC20_WALLET || 'TFakeWalletAddressForTRC20USDTRechargeXXXX',
  adminBep20Wallet: process.env.ADMIN_BEP20_WALLET || '0xFakeWalletAddressForBEP20USDTRechargeXXXX',
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatIds: (process.env.TELEGRAM_CHAT_ID || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
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
