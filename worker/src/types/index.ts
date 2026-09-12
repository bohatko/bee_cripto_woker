export type UserRole = 'user' | 'admin';
export type SubscriptionStatus = 'trial' | 'active' | 'frozen' | 'expired';
export type ExchangeType = 'binance' | 'okx' | 'bybit';
export type PositionStatus = 'open' | 'closing' | 'closed' | 'cancelled' | 'error';
export type ExitReasonType = 'tp' | 'sl' | 'trend_flip' | 'panic_close' | 'admin_close';
export type InvoiceStatus = 'issued' | 'pending_review' | 'paid' | 'frozen' | 'cancelled';
export type CryptoNetwork = 'TRC20' | 'BEP20' | 'TON';
export type ComponentHealthStatus = 'healthy' | 'degraded' | 'down';
export type ExecutionMode = 'market' | 'maker_hedge';
export type RiskMode = 'margin' | 'spread';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  subscription_status: SubscriptionStatus;
  trial_start_at: string;
  trial_end_at: string;
  subscription_paid_until: string | null;
  high_water_mark_equity: number;
  is_frozen: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExchangeAccount {
  id: string;
  user_id: string;
  exchange: ExchangeType;
  account_name: string;
  is_active: boolean;
  encrypted_api_key: string;
  encrypted_secret: string;
  encrypted_passphrase: string | null;
  iv_nonce: string;
  tag: string;
  is_validated: boolean;
  can_withdraw: boolean;
  can_trade_futures: boolean;
  last_balance_usd: number;
  free_balance_usd?: number | null;
  last_error_msg: string | null;
  last_sync_at: string | null;
}

export interface TradingSettings {
  id: string;
  user_id: string;
  exchange_account_id: string | null;
  is_bot_active: boolean;
  effective_leverage: number;
  max_allocated_margin_usd: number | null;
  active_pairs: string[];
  take_profit_pct: number;
  stop_loss_pct: number;
  panic_closed_at: string | null;
}

export interface PairMarketData {
  pair_symbol: string;
  long_coin: string;
  short_coin: string;
  current_ratio: number;
  ema_10: number;
  is_in_trend: boolean;
  readiness_pct?: number;
  long_price: number;
  short_price: number;
  last_signal_at: string;
  updated_at: string;
}

export interface BotPosition {
  id: string;
  user_id?: string | null;
  exchange_account_id?: string | null;
  pair_symbol: string;
  status: PositionStatus;
  is_master?: boolean;
  entry_ratio: number;
  current_ratio: number | null;
  exit_ratio: number | null;
  long_symbol: string;
  long_order_id: string | null;
  long_entry_price: number;
  long_exit_price: number | null;
  long_exit_order_id: string | null;
  long_qty: number;
  short_symbol: string;
  short_order_id: string | null;
  short_entry_price: number;
  short_exit_price: number | null;
  short_exit_order_id: string | null;
  short_qty: number;
  allocated_margin_usd: number;
  total_position_volume_usd: number;
  unrealized_pnl_usd: number;
  realized_pnl_usd: number | null;
  gross_pnl_usd: number | null;
  entry_fees_usd: number;
  exit_fees_usd: number;
  funding_fees_usd: number;
  execution_mode: ExecutionMode | null;
  pnl_pct: number | null;
  exit_reason: ExitReasonType | null;
  opened_at: string;
  closed_at: string | null;
}

export type PairSelectionRunStatus = 'pending' | 'running' | 'completed' | 'failed';
export type PairSelectionTrigger = 'cron' | 'admin';

export interface StrategyPairRow {
  id: string;
  pair_symbol: string;
  long_coin: string;
  short_coin: string;
  score: number | null;
  metrics: Record<string, unknown> | null;
  activated_at: string;
  deactivated_at: string | null;
  run_id: string | null;
  is_active: boolean;
}

export interface PairSelectionProgressStep {
  at: string;
  stage: string;
  message: string;
  detail?: Record<string, unknown>;
}

export interface PairSelectionRun {
  id: string;
  status: PairSelectionRunStatus;
  trigger_source: PairSelectionTrigger;
  requested_by: string | null;
  started_at: string | null;
  finished_at: string | null;
  universe_size: number | null;
  candidates: unknown | null;
  applied: boolean;
  replacements: unknown | null;
  progress_log: PairSelectionProgressStep[] | null;
  error: string | null;
  created_at: string;
}

export interface EngineSettings {
  id: number;
  auto_rotation_enabled: boolean;
  last_rotation_applied_at: string | null;
  updated_at: string;
}

export interface SimResultMetrics {
  netPnlPct: number;
  trades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  slShare: number;
  avgHoldBars: number;
  equityCurve: number[];
}

export interface CandidateMetrics {
  t_stat: number;
  drift_w1: number;
  drift_w2: number;
  drift_w3: number;
  corr: number;
  beta_long: number;
  beta_short: number;
  beta_diff: number;
  funding_long: number;
  funding_short: number;
  funding_cost_pct_8h: number;
  funding_penalty: number;
  vol_long_usd_24h: number;
  vol_short_usd_24h: number;
  spread_long_pct: number;
  spread_short_pct: number;
  funding_mean_long_8h: number;
  funding_mean_short_8h: number;
  in_trend: boolean;
  hurst: number;
  autocorr_1_3: number;
  samples: number;
  sim_insample: SimResultMetrics;
  sim_oos: SimResultMetrics;
  live_pf_30d?: number;
  live_trades_30d?: number;
  basket_corr_max?: number;
}

/** Normalized fill result from exchange execution (market or maker-hedge). */
export interface LegFillResult {
  orderId: string;
  price: number;
  qty: number;
  feeUsd: number;
  symbol: string;
  side: 'buy' | 'sell';
}

export interface PairFillResult {
  longFill: LegFillResult;
  shortFill: LegFillResult;
  mode: ExecutionMode;
  /** Sum of both leg fees for this execution (entry or exit). */
  feesUsd: number;
}
