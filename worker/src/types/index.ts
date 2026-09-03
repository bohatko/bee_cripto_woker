export type UserRole = 'user' | 'admin';
export type SubscriptionStatus = 'trial' | 'active' | 'frozen' | 'expired';
export type ExchangeType = 'binance' | 'okx' | 'bybit';
export type PositionStatus = 'open' | 'closing' | 'closed' | 'cancelled' | 'error';
export type ExitReasonType = 'tp' | 'sl' | 'trend_flip' | 'panic_close' | 'admin_close';
export type InvoiceStatus = 'issued' | 'pending_review' | 'paid' | 'frozen' | 'cancelled';
export type CryptoNetwork = 'TRC20' | 'BEP20' | 'TON';
export type ComponentHealthStatus = 'healthy' | 'degraded' | 'down';

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
  long_price: number;
  short_price: number;
  last_signal_at: string;
  updated_at: string;
}

export interface BotPosition {
  id: string;
  user_id: string;
  exchange_account_id: string;
  pair_symbol: string;
  status: PositionStatus;
  entry_ratio: number;
  current_ratio: number | null;
  exit_ratio: number | null;
  long_symbol: string;
  long_order_id: string | null;
  long_entry_price: number;
  long_exit_price: number | null;
  long_qty: number;
  short_symbol: string;
  short_order_id: string | null;
  short_entry_price: number;
  short_exit_price: number | null;
  short_qty: number;
  allocated_margin_usd: number;
  total_position_volume_usd: number;
  unrealized_pnl_usd: number;
  realized_pnl_usd: number | null;
  pnl_pct: number | null;
  exit_reason: ExitReasonType | null;
  opened_at: string;
  closed_at: string | null;
}
