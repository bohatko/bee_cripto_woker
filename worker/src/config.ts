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
  defaultLeverage: Number(process.env.DEFAULT_LEVERAGE || 3.0),
  maxLeverage: Number(process.env.MAX_LEVERAGE || 3.0),
  takeProfitPct: Number(process.env.TAKE_PROFIT_PCT || 4.5),
  stopLossPct: Number(process.env.STOP_LOSS_PCT || 2.5),
  trailingActive: parseBool(process.env.TRAILING_ACTIVE, true),
  trailingActivationPct: Number(process.env.TRAILING_ACTIVATION_PCT || 2.5),
  trailingDeltaPct: Number(process.env.TRAILING_DELTA_PCT || 1.0),
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
  slAtrMult: Number(process.env.SL_ATR_MULT || 1.5),
  slMaxMarginPct: Number(process.env.SL_MAX_MARGIN_PCT || 10),
  tpDisabled: parseBool(process.env.TP_DISABLED, false),
  entryOn4hCloseOnly: parseBool(process.env.ENTRY_ON_4H_CLOSE_ONLY, true),
  entry4hCloseGraceMs: Number(process.env.ENTRY_4H_CLOSE_GRACE_MS || 600000),
  riskOnNetPnl: parseBool(process.env.RISK_ON_NET_PNL, false),
  // Dynamic pair selection (momentum screener + auto-rotation)
  pairSelectionEnabled: parseBool(process.env.PAIR_SELECTION_ENABLED, true),
  pairSelectionUtcHour: Number(process.env.PAIR_SELECTION_UTC_HOUR || 0),
  pairSelectionUtcMinute: Number(process.env.PAIR_SELECTION_UTC_MINUTE || 10),
  rotationMaxReplacements: Number(process.env.ROTATION_MAX_REPLACEMENTS || 2),
  rotationHysteresis: Number(process.env.ROTATION_HYSTERESIS || 1.5),
  universeSize: Number(process.env.UNIVERSE_SIZE || 60),
  minLegVolumeUsd: Number(process.env.MIN_LEG_VOLUME_USD || 100_000_000),
  minListingAgeDays: Number(process.env.MIN_LISTING_AGE_DAYS || 180),
  maxSpreadPct: Number(process.env.MAX_SPREAD_PCT || 0.03),
  maxFundingMean8hPct: Number(process.env.MAX_FUNDING_MEAN_8H_PCT || 0.02),
  maxFundingAbsMax8hPct: Number(process.env.MAX_FUNDING_ABS_MAX_8H_PCT || 0.1),
  universeBlacklist: (process.env.UNIVERSE_BLACKLIST || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
  minHurst: Number(process.env.MIN_HURST || 0.50),
  minLegCorrelation: Number(process.env.MIN_LEG_CORRELATION || 0.40),
  maxBetaDiff: Number(process.env.MAX_BETA_DIFF || 0.35),
  // Require this many of the 3 equal time windows to have positive ratio drift (1..3).
  minStabilityWindows: Math.min(3, Math.max(1, Number(process.env.MIN_STABILITY_WINDOWS || 1))),
  requireAutocorr: parseBool(process.env.REQUIRE_AUTOCORR, false),
  requireInTrend: parseBool(process.env.REQUIRE_IN_TREND, false),
  basketMaxRatioCorr: Number(process.env.BASKET_MAX_RATIO_CORR || 0.4),
  anchorCoins: (process.env.ANCHOR_COINS || 'BTC,ETH,SOL,BNB')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
  rotationMinIntervalDays: Number(process.env.ROTATION_MIN_INTERVAL_DAYS || 14),
  simSlippagePct: Number(process.env.SIM_SLIPPAGE_PCT || 0.04),
  simInsampleDays: Number(process.env.SIM_INSAMPLE_DAYS || 120),
  simOosDays: Number(process.env.SIM_OOS_DAYS || 30),
  simMinTrades: Number(process.env.SIM_MIN_TRADES || 8),
  simMinProfitFactor: Number(process.env.SIM_MIN_PROFIT_FACTOR || 0.90),
  simMaxDrawdownPct: Number(process.env.SIM_MAX_DRAWDOWN_PCT || 40.0),
  simMaxSlShare: Number(process.env.SIM_MAX_SL_SHARE || 0.5),
  simMaxCandidates: Number(process.env.SIM_MAX_CANDIDATES || 400),
  // Always run Scenario C sim for top-N by Hurst even if structure rejected (fills admin UI metrics).
  simNearMissTopN: Number(process.env.SIM_NEAR_MISS_TOP_N || 50),
  liveDemotionMinTrades: Number(process.env.LIVE_DEMOTION_MIN_TRADES || 5),
  liveDemotionPf: Number(process.env.LIVE_DEMOTION_PF || 0.8),
  adminTrc20Wallet: process.env.ADMIN_TRC20_WALLET || 'TFakeWalletAddressForTRC20USDTRechargeXXXX',
  adminBep20Wallet: process.env.ADMIN_BEP20_WALLET || '0xFakeWalletAddressForBEP20USDTRechargeXXXX',
  adminAptosWallet: process.env.ADMIN_APTOS_WALLET || '0xccabbae52a975c1cb682643d13b970e95997e539e5c9c9443e922ba406f401e7',
  // Telegram is per-user (users_profile.telegram_*). TELEGRAM_* env vars are deprecated.
  // Internal HTTP API for Next.js → worker exchange validate/sync (static egress IP)
  internalApiEnabled: parseBool(process.env.INTERNAL_API_ENABLED, true),
  internalApiPort: Number(process.env.PORT || process.env.INTERNAL_API_PORT || 8080),
  internalApiSecret: process.env.INTERNAL_API_SECRET || '',

  // Dip-Buy XRP Signals Engine
  dipBuyEnabled: parseBool(process.env.DIP_BUY_ENABLED, true),
  dipSymbol: (process.env.DIP_SYMBOL || 'XRP').toUpperCase(),
  dipDropPct: Number(process.env.DIP_DROP_PCT || 15),
  dipWindowMinutes: Number(process.env.DIP_WINDOW_MINUTES || 1440),
  dipLeverage: Number(process.env.DIP_LEVERAGE || 3.0),
  dipTpPct: Number(process.env.DIP_TP_PCT || 4.0),
  dipSlPct: Number(process.env.DIP_SL_PCT || 30.0),
  dipPaperSlippagePct: Number(process.env.DIP_PAPER_SLIPPAGE_PCT || 0.05),
  dipPaperFeePct: Number(process.env.DIP_PAPER_FEE_PCT || 0.10),
  dipReferenceMarginUsd: Number(process.env.DIP_REFERENCE_MARGIN_USD || 20000),
  dipMinMarginUsd: Number(process.env.DIP_MIN_MARGIN_USD || 20),
  dipGuardIntervalMs: Number(process.env.DIP_GUARD_INTERVAL_MS || 15000),
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
