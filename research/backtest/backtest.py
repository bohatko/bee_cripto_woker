"""
Bee Crypto Worker - Quantitative Backtest & Robustness Engine.
Evaluates Live Logic (Scenario A), Zero-Cost Baseline (A0), Cooldown Variant (B),
Proposed Re-parameterization (C, C_maker), Parameter Grid (D), and Robustness Checks 1-7.
"""

import os
import sys
import argparse
from datetime import datetime, timezone
import pandas as pd
import numpy as np

DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data'))
OUT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), 'out'))

PAIRS_CONFIG = [
    {'pair_symbol': 'ZEC/AVAX', 'long_coin': 'ZEC', 'short_coin': 'AVAX', 'is_alt': True},
    {'pair_symbol': 'ENA/SUI',  'long_coin': 'ENA', 'short_coin': 'SUI',  'is_alt': True},
    {'pair_symbol': 'SOL/ADA',  'long_coin': 'SOL', 'short_coin': 'ADA',  'is_alt': False},
    {'pair_symbol': 'BNB/ETH',  'long_coin': 'BNB', 'short_coin': 'ETH',  'is_alt': False},
]

# Taker Cost Constants
TAKER_FEE_RATE = 0.00055       # 0.055% per leg per side (Binance VIP0 USDM futures taker fee)
DEFAULT_SLIPPAGE = 0.0003      # 0.03% base slippage per order
ALT_SLIPPAGE = 0.0005          # 0.05% slippage for altcoins (ZEC, AVAX, ENA, SUI)

MAKER_FEE_RATE = 0.00020       # 0.02% maker fee
MAKER_SLIPPAGE = 0.00010       # 0.01% maker slippage


class BacktestDataset:
    def __init__(self, data_dir: str = DATA_DIR, prefix: str = ''):
        self.data_dir = data_dir
        self.prefix = prefix
        self.coins = ['ZEC', 'AVAX', 'ENA', 'SUI', 'SOL', 'ADA', 'BNB', 'ETH']
        self.dfs_1m = {}
        self.dfs_funding = {}
        self.load_data()
        self.build_aligned_arrays()

    def load_data(self):
        print(f"Loading cached 1m parquet and funding CSV files (prefix='{self.prefix}')...")
        for c in self.coins:
            p_path = os.path.join(self.data_dir, f'1m_{c}{self.prefix}.parquet')
            f_path = os.path.join(self.data_dir, f'funding_{c}{self.prefix}.csv')
            if not os.path.exists(p_path):
                raise FileNotFoundError(f"Missing {p_path}. Run download_data.py first.")
            self.dfs_1m[c] = pd.read_parquet(p_path)
            if os.path.exists(f_path):
                self.dfs_funding[c] = pd.read_csv(f_path)
            else:
                self.dfs_funding[c] = pd.DataFrame(columns=['timestamp', 'funding_rate'])

    def build_aligned_arrays(self):
        print("Building synchronized data arrays and computing 4h indicators (EMA10, EMA20, ATR14)...")
        ref_df = self.dfs_1m['ZEC']
        self.timestamps = ref_df['timestamp'].values
        self.n_bars = len(self.timestamps)
        self.datetimes = pd.to_datetime(self.timestamps, unit='ms', utc=True)

        self.pairs_data = []

        for p_idx, pair in enumerate(PAIRS_CONFIG):
            l_coin = pair['long_coin']
            s_coin = pair['short_coin']

            df_l = self.dfs_1m[l_coin]
            df_s = self.dfs_1m[s_coin]

            o_l = df_l['open'].values
            h_l = df_l['high'].values
            l_l = df_l['low'].values
            c_l = df_l['close'].values

            o_s = df_s['open'].values
            h_s = df_s['high'].values
            l_s = df_s['low'].values
            c_s = df_s['close'].values

            live_ratio = c_l / c_s
            ratio_high = h_l / l_s
            ratio_low = l_l / h_s

            # Build 4h resampled candles on UTC clock boundaries
            df_pair_1m = pd.DataFrame({
                'datetime': self.datetimes,
                'o_l': o_l, 'h_l': h_l, 'l_l': l_l, 'c_l': c_l,
                'o_s': o_s, 'h_s': h_s, 'l_s': l_s, 'c_s': c_s,
            }).set_index('datetime')

            df_4h = df_pair_1m.resample('4h', closed='left', label='left').agg({
                'o_l': 'first', 'h_l': 'max', 'l_l': 'min', 'c_l': 'last',
                'o_s': 'first', 'h_s': 'max', 'l_s': 'min', 'c_s': 'last',
            }).dropna()

            r_4h_close = (df_4h['c_l'] / df_4h['c_s']).values
            r_4h_high = (df_4h['h_l'] / df_4h['l_s']).values
            r_4h_low = (df_4h['l_l'] / df_4h['h_s']).values

            # Compute 4h EMA10: alpha = 2 / 11
            alpha10 = 2.0 / 11.0
            ema10_4h = np.zeros(len(r_4h_close))
            ema10_4h[0] = r_4h_close[0]
            for i in range(1, len(r_4h_close)):
                ema10_4h[i] = alpha10 * r_4h_close[i] + (1.0 - alpha10) * ema10_4h[i - 1]

            # Compute 4h EMA20: alpha = 2 / 21
            alpha20 = 2.0 / 21.0
            ema20_4h = np.zeros(len(r_4h_close))
            ema20_4h[0] = r_4h_close[0]
            for i in range(1, len(r_4h_close)):
                ema20_4h[i] = alpha20 * r_4h_close[i] + (1.0 - alpha20) * ema20_4h[i - 1]

            # Compute 4h ATR14 of ratio
            tr_4h = np.zeros(len(r_4h_close))
            tr_4h[0] = r_4h_high[0] - r_4h_low[0]
            for i in range(1, len(r_4h_close)):
                tr1 = r_4h_high[i] - r_4h_low[i]
                tr2 = abs(r_4h_high[i] - r_4h_close[i - 1])
                tr3 = abs(r_4h_low[i] - r_4h_close[i - 1])
                tr_4h[i] = max(tr1, tr2, tr3)

            atr14_4h = np.zeros(len(r_4h_close))
            if len(tr_4h) >= 14:
                atr14_4h[13] = np.mean(tr_4h[:14])
                for i in range(14, len(tr_4h)):
                    atr14_4h[i] = (atr14_4h[i - 1] * 13.0 + tr_4h[i]) / 14.0
            else:
                atr14_4h[:] = np.mean(tr_4h)

            df_4h['r_close'] = r_4h_close
            df_4h['ema10'] = ema10_4h
            df_4h['ema20'] = ema20_4h
            df_4h['atr14'] = atr14_4h
            df_4h['candle_close_time'] = df_4h.index + pd.Timedelta(hours=4)

            df_4h_mapped = df_4h[['candle_close_time', 'r_close', 'ema10', 'ema20', 'atr14']].rename(
                columns={
                    'r_close': 'last_closed_ratio',
                    'ema10': 'ema10',
                    'ema20': 'ema20',
                    'atr14': 'atr14'
                }
            )

            df_1m_ind = pd.merge_asof(
                pd.DataFrame({'datetime': self.datetimes}),
                df_4h_mapped,
                left_on='datetime',
                right_on='candle_close_time',
                direction='backward'
            )

            df_1m_ind['last_closed_ratio'] = df_1m_ind['last_closed_ratio'].bfill().ffill()
            df_1m_ind['ema10'] = df_1m_ind['ema10'].bfill().ffill()
            df_1m_ind['ema20'] = df_1m_ind['ema20'].bfill().ffill()
            df_1m_ind['atr14'] = df_1m_ind['atr14'].bfill().ffill()

            is_4h_close = np.asarray((self.datetimes.minute == 0) & (self.datetimes.hour % 4 == 0))

            funding_l_arr = np.zeros(self.n_bars)
            funding_s_arr = np.zeros(self.n_bars)

            f_l_df = self.dfs_funding[l_coin]
            f_s_df = self.dfs_funding[s_coin]

            ts_to_idx = {ts: idx for idx, ts in enumerate(self.timestamps)}
            if not f_l_df.empty:
                for _, row in f_l_df.iterrows():
                    fts = (int(row['timestamp']) // 60000) * 60000
                    if fts in ts_to_idx:
                        funding_l_arr[ts_to_idx[fts]] = float(row['funding_rate'])

            if not f_s_df.empty:
                for _, row in f_s_df.iterrows():
                    fts = (int(row['timestamp']) // 60000) * 60000
                    if fts in ts_to_idx:
                        funding_s_arr[ts_to_idx[fts]] = float(row['funding_rate'])

            self.pairs_data.append({
                'pair_symbol': pair['pair_symbol'],
                'long_coin': l_coin,
                'short_coin': s_coin,
                'is_alt': pair['is_alt'],
                'o_l': o_l, 'h_l': h_l, 'l_l': l_l, 'c_l': c_l,
                'o_s': o_s, 'h_s': h_s, 'l_s': l_s, 'c_s': c_s,
                'live_ratio': live_ratio,
                'ratio_high': ratio_high,
                'ratio_low': ratio_low,
                'last_closed_ratio': df_1m_ind['last_closed_ratio'].values,
                'ema10': df_1m_ind['ema10'].values,
                'ema20': df_1m_ind['ema20'].values,
                'atr14': df_1m_ind['atr14'].values,
                'is_4h_close': is_4h_close,
                'funding_l': funding_l_arr,
                'funding_s': funding_s_arr,
            })
        print(f"Data arrays built successfully for {len(self.pairs_data)} pairs across {self.n_bars} bars.")


class SimulationEngine:
    def __init__(self, dataset: BacktestDataset):
        self.dataset = dataset

    def run(
        self,
        scenario_name: str,
        start_equity: float = 20000.0,
        leverage: float = 7.0,
        take_profit_pct: float | None = 5.0,
        stop_loss_pct: float | str | None = 1.5,
        entry_mode: str = '1m',                   # '1m' or '4h_close'
        slot_margin_mode: str = 'free_margin',     # 'free_margin' or 'total_equity'
        cooldown_mode: str = 'none',              # 'none', 'sl_ratio_rebound', 'scenario_c'
        cost_mode: str = 'taker',                 # 'taker', 'none', 'maker'
        barrier_convention: str = 'pessimistic',   # 'pessimistic', 'close_only', 'tp_first'
        use_alt_slippage: bool = True,
        max_consecutive_sl: int | None = None,
        atr_multiplier: float = 1.5,
        ema_period: int = 10,
        active_pairs: list[str] | None = None,
        start_date: str = '2026-03-07 00:00:00',
        end_date: str = '2026-09-03 23:59:00',
    ):
        start_dt = pd.to_datetime(start_date, utc=True)
        end_dt = pd.to_datetime(end_date, utc=True)

        datetimes = self.dataset.datetimes
        mask = (datetimes >= start_dt) & (datetimes <= end_dt)
        start_idx = np.argmax(mask)
        end_idx = len(mask) - np.argmax(mask[::-1]) - 1

        n_pairs = len(self.dataset.pairs_data)
        equity = start_equity
        trades = []
        equity_curve = []

        # Filter active pairs if specified
        allowed_pair_symbols = set(active_pairs) if active_pairs is not None else {p['pair_symbol'] for p in PAIRS_CONFIG}

        pair_state = []
        for p in range(n_pairs):
            pair_state.append({
                'in_pos': False,
                'pos': None,
                'consecutive_sl': 0,
                'blocked_until_idx': -1,
                'cooldown_active': False,
                'cooldown_exit_ratio': 0.0,
                'cooldown_atr_pct': 0.0,
                'cooldown_exit_idx': -1,
            })

        pairs = self.dataset.pairs_data

        for i in range(start_idx, end_idx + 1):
            cur_dt = datetimes[i]
            cur_ts = self.dataset.timestamps[i]

            # 1. First: evaluate open positions for exits & funding
            for p in range(n_pairs):
                state = pair_state[p]
                if not state['in_pos']:
                    continue

                p_data = pairs[p]
                pos = state['pos']

                # Funding cashflow check at this minute
                f_l = p_data['funding_l'][i]
                f_s = p_data['funding_s'][i]

                if f_l != 0.0 or f_s != 0.0:
                    notional_l = pos['long_qty'] * p_data['c_l'][i]
                    notional_s = pos['short_qty'] * p_data['c_s'][i]
                    funding_delta = (f_s * notional_s) - (f_l * notional_l)
                    pos['cum_funding'] += funding_delta

                min_pnl_usd = (p_data['l_l'][i] - pos['long_entry_signal']) * pos['long_qty'] + \
                              (pos['short_entry_signal'] - p_data['h_s'][i]) * pos['short_qty']
                max_pnl_usd = (p_data['h_l'][i] - pos['long_entry_signal']) * pos['long_qty'] + \
                              (pos['short_entry_signal'] - p_data['l_s'][i]) * pos['short_qty']
                close_pnl_usd = (p_data['c_l'][i] - pos['long_entry_signal']) * pos['long_qty'] + \
                                (pos['short_entry_signal'] - p_data['c_s'][i]) * pos['short_qty']

                slot_margin = pos['allocated_margin']
                min_pnl_pct = (min_pnl_usd / slot_margin) * 100.0
                max_pnl_pct = (max_pnl_usd / slot_margin) * 100.0
                close_pnl_pct = (close_pnl_usd / slot_margin) * 100.0

                sl_barrier = pos['sl_pct']
                tp_barrier = pos['tp_pct']

                # Barrier checks depending on convention
                if barrier_convention == 'pessimistic':
                    sl_hit = min_pnl_pct <= -sl_barrier
                    tp_hit = (tp_barrier is not None) and (max_pnl_pct >= tp_barrier)
                    if sl_hit and tp_hit:
                        exit_reason = 'sl'
                    elif sl_hit:
                        exit_reason = 'sl'
                    elif tp_hit:
                        exit_reason = 'tp'
                    else:
                        exit_reason = None
                elif barrier_convention == 'tp_first':
                    sl_hit = min_pnl_pct <= -sl_barrier
                    tp_hit = (tp_barrier is not None) and (max_pnl_pct >= tp_barrier)
                    if sl_hit and tp_hit:
                        exit_reason = 'tp'
                    elif tp_hit:
                        exit_reason = 'tp'
                    elif sl_hit:
                        exit_reason = 'sl'
                    else:
                        exit_reason = None
                elif barrier_convention == 'close_only':
                    sl_hit = close_pnl_pct <= -sl_barrier
                    tp_hit = (tp_barrier is not None) and (close_pnl_pct >= tp_barrier)
                    if sl_hit and tp_hit:
                        exit_reason = 'sl'
                    elif sl_hit:
                        exit_reason = 'sl'
                    elif tp_hit:
                        exit_reason = 'tp'
                    else:
                        exit_reason = None

                is_4h_boundary = p_data['is_4h_close'][i]
                trend_flip_hit = False
                ema_val = p_data['ema20'][i] if ema_period == 20 else p_data['ema10'][i]
                if is_4h_boundary and exit_reason is None:
                    if p_data['last_closed_ratio'][i] < ema_val:
                        trend_flip_hit = True
                        exit_reason = 'trend_flip'

                if exit_reason is not None:
                    gross_pnl_usd = 0.0
                    exit_notional = 0.0
                    exit_ratio = 0.0

                    if exit_reason == 'sl':
                        gross_pnl_usd = - (sl_barrier / 100.0) * slot_margin
                        gross_pnl_pct = - sl_barrier
                        exit_notional = pos['total_volume'] * (1.0 - (sl_barrier / 100.0) / pos['leverage'])
                        exit_ratio = pos['entry_ratio'] * (1.0 - (sl_barrier / 100.0) / pos['leverage'])
                    elif exit_reason == 'tp':
                        gross_pnl_usd = (tp_barrier / 100.0) * slot_margin
                        gross_pnl_pct = tp_barrier
                        exit_notional = pos['total_volume'] * (1.0 + (tp_barrier / 100.0) / pos['leverage'])
                        exit_ratio = pos['entry_ratio'] * (1.0 + (tp_barrier / 100.0) / pos['leverage'])
                    elif exit_reason == 'trend_flip':
                        # Look-ahead free: Trend flip triggered at 4h close fills at open of bar at T
                        # Open prices at 4h close boundary:
                        exit_long_p = p_data['o_l'][i]
                        exit_short_p = p_data['o_s'][i]
                        gross_pnl_usd = (exit_long_p - pos['long_entry_signal']) * pos['long_qty'] + \
                                        (pos['short_entry_signal'] - exit_short_p) * pos['short_qty']
                        gross_pnl_pct = (gross_pnl_usd / slot_margin) * 100.0
                        exit_notional = pos['long_qty'] * exit_long_p + pos['short_qty'] * exit_short_p
                        exit_ratio = exit_long_p / exit_short_p

                    if cost_mode == 'none':
                        exit_fee = 0.0
                        exit_slippage = 0.0
                        total_funding = 0.0
                    elif cost_mode == 'taker':
                        exit_fee = exit_notional * TAKER_FEE_RATE
                        slip_rate = ALT_SLIPPAGE if (use_alt_slippage and p_data['is_alt']) else DEFAULT_SLIPPAGE
                        exit_slippage = exit_notional * slip_rate
                        total_funding = pos['cum_funding']
                    elif cost_mode == 'maker':
                        if exit_reason == 'sl':
                            exit_fee = exit_notional * TAKER_FEE_RATE
                            exit_slippage = exit_notional * (ALT_SLIPPAGE if (use_alt_slippage and p_data['is_alt']) else DEFAULT_SLIPPAGE)
                        else:
                            exit_fee = exit_notional * MAKER_FEE_RATE
                            exit_slippage = exit_notional * MAKER_SLIPPAGE
                        total_funding = pos['cum_funding']

                    total_trade_fees = pos['entry_fee'] + exit_fee
                    total_trade_slippage = pos['entry_slippage'] + exit_slippage

                    net_pnl_usd = gross_pnl_usd - total_trade_fees - total_trade_slippage + total_funding
                    net_pnl_pct = (net_pnl_usd / slot_margin) * 100.0

                    equity += net_pnl_usd

                    holding_minutes = i - pos['entry_idx']

                    trade_record = {
                        'pair_symbol': p_data['pair_symbol'],
                        'opened_at': str(pos['opened_at']),
                        'closed_at': str(cur_dt),
                        'holding_minutes': holding_minutes,
                        'exit_reason': exit_reason,
                        'leverage': pos['leverage'],
                        'allocated_margin': slot_margin,
                        'total_volume': pos['total_volume'],
                        'entry_ratio': pos['entry_ratio'],
                        'exit_ratio': exit_ratio,
                        'gross_pnl_usd': gross_pnl_usd,
                        'gross_pnl_pct': gross_pnl_pct,
                        'net_pnl_usd': net_pnl_usd,
                        'net_pnl_pct': net_pnl_pct,
                        'fees_usd': total_trade_fees,
                        'slippage_usd': total_trade_slippage,
                        'funding_usd': total_funding,
                        'ending_equity': equity,
                    }
                    trades.append(trade_record)

                    state['in_pos'] = False
                    state['pos'] = None

                    if exit_reason == 'sl':
                        state['consecutive_sl'] += 1
                        if max_consecutive_sl and state['consecutive_sl'] >= max_consecutive_sl:
                            state['blocked_until_idx'] = i + 1440
                            state['consecutive_sl'] = 0

                        if cooldown_mode == 'sl_ratio_rebound':
                            state['cooldown_active'] = True
                            state['cooldown_exit_ratio'] = exit_ratio
                            state['cooldown_exit_idx'] = i
                        elif cooldown_mode == 'scenario_c':
                            state['cooldown_active'] = True
                            state['cooldown_exit_ratio'] = exit_ratio
                            state['cooldown_atr_pct'] = p_data['atr14'][i] / p_data['last_closed_ratio'][i]
                            state['cooldown_exit_idx'] = i
                    else:
                        state['consecutive_sl'] = 0
                        state['cooldown_active'] = False

            # 2. Second: evaluate potential entries
            occupied_margin = sum(state['pos']['allocated_margin'] for state in pair_state if state['in_pos'])
            free_margin = max(0.0, equity - occupied_margin)

            for p in range(n_pairs):
                state = pair_state[p]
                if state['in_pos']:
                    continue

                p_data = pairs[p]
                if p_data['pair_symbol'] not in allowed_pair_symbols:
                    continue

                if i < state['blocked_until_idx']:
                    continue

                live_ratio = p_data['live_ratio'][i]
                last_closed_ratio = p_data['last_closed_ratio'][i]
                ema_val = p_data['ema20'][i] if ema_period == 20 else p_data['ema10'][i]
                is_4h_boundary = p_data['is_4h_close'][i]

                if state['cooldown_active']:
                    if cooldown_mode == 'sl_ratio_rebound':
                        passed_4h_close = (i > state['cooldown_exit_idx']) and is_4h_boundary
                        if (i > state['cooldown_exit_idx'] + 240 or passed_4h_close) and (live_ratio > state['cooldown_exit_ratio'] * 1.005):
                            state['cooldown_active'] = False
                        else:
                            continue
                    elif cooldown_mode == 'scenario_c':
                        if is_4h_boundary and (last_closed_ratio > ema_val) and \
                           (last_closed_ratio > state['cooldown_exit_ratio'] * (1.0 + 0.25 * state['cooldown_atr_pct'])):
                            state['cooldown_active'] = False
                        else:
                            continue

                can_enter = False
                if entry_mode == '1m':
                    if (live_ratio > ema_val) and (last_closed_ratio >= ema_val):
                        can_enter = True
                elif entry_mode == '4h_close':
                    if is_4h_boundary and (last_closed_ratio > ema_val):
                        can_enter = True

                if not can_enter:
                    continue

                if slot_margin_mode == 'free_margin':
                    slot_margin = free_margin * 0.25
                elif slot_margin_mode == 'total_equity':
                    slot_margin = equity * 0.25

                if slot_margin <= 0 or free_margin < slot_margin * 0.5:
                    continue

                tot_vol = slot_margin * leverage
                leg_vol = tot_vol / 2.0

                # Look-ahead free fill price:
                # If entering on 4h close boundary, fill price is open of bar at T (o_l[i], o_s[i])
                # If entering on 1m bar, fill price is close of bar at i (c_l[i], c_s[i])
                if entry_mode == '4h_close':
                    entry_long_sig = p_data['o_l'][i]
                    entry_short_sig = p_data['o_s'][i]
                else:
                    entry_long_sig = p_data['c_l'][i]
                    entry_short_sig = p_data['c_s'][i]

                long_qty = leg_vol / entry_long_sig
                short_qty = leg_vol / entry_short_sig

                if cost_mode == 'none':
                    entry_fee = 0.0
                    entry_slippage = 0.0
                elif cost_mode == 'taker':
                    entry_fee = tot_vol * TAKER_FEE_RATE
                    slip_rate = ALT_SLIPPAGE if (use_alt_slippage and p_data['is_alt']) else DEFAULT_SLIPPAGE
                    entry_slippage = tot_vol * slip_rate
                elif cost_mode == 'maker':
                    entry_fee = tot_vol * MAKER_FEE_RATE
                    entry_slippage = tot_vol * MAKER_SLIPPAGE

                if stop_loss_pct == 'atr':
                    atr_ratio_pct = p_data['atr14'][i] / last_closed_ratio
                    dyn_sl = min(10.0, atr_multiplier * atr_ratio_pct * leverage * 100.0)
                    actual_sl_pct = max(0.5, dyn_sl)
                else:
                    actual_sl_pct = float(stop_loss_pct)

                actual_tp_pct = float(take_profit_pct) if take_profit_pct is not None else None

                pos_record = {
                    'entry_idx': i,
                    'opened_at': cur_dt,
                    'allocated_margin': slot_margin,
                    'total_volume': tot_vol,
                    'leverage': leverage,
                    'long_qty': long_qty,
                    'short_qty': short_qty,
                    'long_entry_signal': entry_long_sig,
                    'short_entry_signal': entry_short_sig,
                    'entry_ratio': entry_long_sig / entry_short_sig,
                    'sl_pct': actual_sl_pct,
                    'tp_pct': actual_tp_pct,
                    'entry_fee': entry_fee,
                    'entry_slippage': entry_slippage,
                    'cum_funding': 0.0,
                }

                state['in_pos'] = True
                state['pos'] = pos_record

                occupied_margin += slot_margin
                free_margin = max(0.0, equity - occupied_margin)

            if i % 60 == 0 or i == end_idx:
                equity_curve.append({
                    'timestamp': cur_ts,
                    'datetime': str(cur_dt),
                    'equity': equity,
                })

        trades_df = pd.DataFrame(trades)
        equity_df = pd.DataFrame(equity_curve)

        summary = self.calculate_summary(scenario_name, start_equity, equity, trades_df, equity_df, start_dt, end_dt)
        return summary, trades_df, equity_df

    def calculate_summary(self, scenario_name, start_equity, end_equity, trades_df, equity_df, start_dt, end_dt):
        n_trades = len(trades_df)
        days = (end_dt - start_dt).total_seconds() / 86400.0

        if n_trades == 0:
            return {
                'scenario': scenario_name,
                'start_equity': start_equity,
                'end_equity': end_equity,
                'net_profit_usd': 0.0,
                'net_profit_pct': 0.0,
                'max_drawdown_pct': 0.0,
                'trades_count': 0,
                'winrate_pct': 0.0,
                'tp_count': 0,
                'sl_count': 0,
                'trend_flip_count': 0,
                'avg_trade_net_pnl_usd': 0.0,
                'avg_trade_net_pnl_pct': 0.0,
                'ev_per_trade_usd': 0.0,
                'total_fees_usd': 0.0,
                'total_slippage_usd': 0.0,
                'total_funding_usd': 0.0,
                'avg_holding_time_min': 0.0,
                'median_holding_time_min': 0.0,
                'trades_per_day': 0.0,
                'db_gross_pnl_usd': 0.0,
                'leak_usd': 0.0,
                'leak_pct': 0.0,
                'sharpe_hourly': 0.0,
                'sharpe_daily': 0.0,
                'calmar_ratio': 0.0,
            }

        net_profit_usd = end_equity - start_equity
        net_profit_pct = (net_profit_usd / start_equity) * 100.0

        equities = equity_df['equity'].values
        cummax = np.maximum.accumulate(equities)
        drawdowns = (cummax - equities) / cummax * 100.0
        max_dd_pct = np.max(drawdowns) if len(drawdowns) > 0 else 0.0

        tp_count = len(trades_df[trades_df['exit_reason'] == 'tp'])
        sl_count = len(trades_df[trades_df['exit_reason'] == 'sl'])
        tf_count = len(trades_df[trades_df['exit_reason'] == 'trend_flip'])
        win_trades = len(trades_df[trades_df['net_pnl_usd'] > 0])
        winrate_pct = (win_trades / n_trades) * 100.0

        avg_trade_net_pnl_usd = trades_df['net_pnl_usd'].mean()
        avg_trade_net_pnl_pct = trades_df['net_pnl_pct'].mean()
        ev_per_trade = avg_trade_net_pnl_usd

        total_fees = trades_df['fees_usd'].sum()
        total_slippage = trades_df['slippage_usd'].sum()
        total_funding = trades_df['funding_usd'].sum()

        avg_holding = trades_df['holding_minutes'].mean()
        median_holding = trades_df['holding_minutes'].median()
        trades_per_day = n_trades / days

        db_gross_pnl = trades_df['gross_pnl_usd'].sum()
        leak_usd = db_gross_pnl - net_profit_usd
        leak_pct = (leak_usd / db_gross_pnl * 100.0) if db_gross_pnl != 0 else 0.0

        # Hourly returns for Sharpe
        eq_series = equity_df['equity']
        hourly_returns = eq_series.pct_change().dropna()
        if len(hourly_returns) > 1 and hourly_returns.std() > 0:
            sharpe_hourly = (hourly_returns.mean() / hourly_returns.std()) * np.sqrt(8760)
        else:
            sharpe_hourly = 0.0

        # Daily returns for Sharpe
        equity_df_copy = equity_df.copy()
        equity_df_copy['datetime_dt'] = pd.to_datetime(equity_df_copy['datetime'])
        daily_equity = equity_df_copy.set_index('datetime_dt')['equity'].resample('1D').last().dropna()
        daily_returns = daily_equity.pct_change().dropna()
        if len(daily_returns) > 1 and daily_returns.std() > 0:
            sharpe_daily = (daily_returns.mean() / daily_returns.std()) * np.sqrt(365.0)
        else:
            sharpe_daily = 0.0

        annualized_return_pct = (net_profit_pct / (days / 365.25))
        calmar = (annualized_return_pct / max_dd_pct) if max_dd_pct > 0 else 0.0

        return {
            'scenario': scenario_name,
            'start_equity': start_equity,
            'end_equity': end_equity,
            'net_profit_usd': net_profit_usd,
            'net_profit_pct': net_profit_pct,
            'max_drawdown_pct': max_dd_pct,
            'trades_count': n_trades,
            'winrate_pct': winrate_pct,
            'tp_count': tp_count,
            'sl_count': sl_count,
            'trend_flip_count': tf_count,
            'avg_trade_net_pnl_usd': avg_trade_net_pnl_usd,
            'avg_trade_net_pnl_pct': avg_trade_net_pnl_pct,
            'ev_per_trade_usd': ev_per_trade,
            'total_fees_usd': total_fees,
            'total_slippage_usd': total_slippage,
            'total_funding_usd': total_funding,
            'avg_holding_time_min': avg_holding,
            'median_holding_time_min': median_holding,
            'trades_per_day': trades_per_day,
            'db_gross_pnl_usd': db_gross_pnl,
            'leak_usd': leak_usd,
            'leak_pct': leak_pct,
            'sharpe_hourly': sharpe_hourly,
            'sharpe_daily': sharpe_daily,
            'calmar_ratio': calmar,
        }


def run_all_robustness_checks():
    os.makedirs(OUT_DIR, exist_ok=True)
    dataset_is = BacktestDataset(prefix='')
    dataset_oos = BacktestDataset(prefix='_oos')

    engine_is = SimulationEngine(dataset_is)
    engine_oos = SimulationEngine(dataset_oos)

    all_summaries = []
    per_pair_rows = []

    # =========================================================================
    # CHECK 1: Barrier-Touch Bias in Scenario A & A0 (3 Conventions)
    # =========================================================================
    print("\n==================================================================")
    print("CHECK 1: Barrier-Touch Bias in Scenario A and A0 (3 Conventions)")
    print("==================================================================")
    conventions = ['pessimistic', 'close_only', 'tp_first']

    for conv in conventions:
        print(f"\n--- Running Scenario A [Convention: {conv}] ---")
        sum_A, tr_A, eq_A = engine_is.run(
            scenario_name=f'A_live_costs_{conv}',
            start_equity=20000.0,
            leverage=7.0,
            take_profit_pct=5.0,
            stop_loss_pct=1.5,
            entry_mode='1m',
            slot_margin_mode='free_margin',
            cooldown_mode='none',
            cost_mode='taker',
            barrier_convention=conv,
            use_alt_slippage=True,
        )
        all_summaries.append(sum_A)
        if conv == 'pessimistic':
            tr_A.to_csv(os.path.join(OUT_DIR, 'trades_A.csv'), index=False)
            eq_A.to_csv(os.path.join(OUT_DIR, 'equity_A.csv'), index=False)

        print(f"\n--- Running Scenario A0 [Convention: {conv}] ---")
        sum_A0, tr_A0, eq_A0 = engine_is.run(
            scenario_name=f'A0_zero_costs_{conv}',
            start_equity=20000.0,
            leverage=7.0,
            take_profit_pct=5.0,
            stop_loss_pct=1.5,
            entry_mode='1m',
            slot_margin_mode='free_margin',
            cooldown_mode='none',
            cost_mode='none',
            barrier_convention=conv,
        )
        all_summaries.append(sum_A0)
        if conv == 'pessimistic':
            tr_A0.to_csv(os.path.join(OUT_DIR, 'trades_A0.csv'), index=False)
            eq_A0.to_csv(os.path.join(OUT_DIR, 'equity_A0.csv'), index=False)

    # Scenario B
    print("\n--- Running Scenario B (Cooldown) ---")
    sum_B, tr_B, eq_B = engine_is.run(
        scenario_name='B_cooldown',
        start_equity=20000.0,
        leverage=7.0,
        take_profit_pct=5.0,
        stop_loss_pct=1.5,
        entry_mode='1m',
        slot_margin_mode='free_margin',
        cooldown_mode='sl_ratio_rebound',
        cost_mode='taker',
        barrier_convention='pessimistic',
        use_alt_slippage=True,
    )
    all_summaries.append(sum_B)
    tr_B.to_csv(os.path.join(OUT_DIR, 'trades_B.csv'), index=False)
    eq_B.to_csv(os.path.join(OUT_DIR, 'equity_B.csv'), index=False)

    # =========================================================================
    # CHECK 2 & 3: Scenario C (Taker, Maker, Ex-ZEC/AVAX)
    # =========================================================================
    print("\n==================================================================")
    print("CHECK 2 & 3: Scenario C Baseline, Maker Variant, and Ex-ZEC/AVAX")
    print("==================================================================")

    # C Taker Baseline
    sum_C, tr_C, eq_C = engine_is.run(
        scenario_name='C_reparam_taker',
        start_equity=20000.0,
        leverage=3.0,
        take_profit_pct=None,
        stop_loss_pct='atr',
        entry_mode='4h_close',
        slot_margin_mode='total_equity',
        cooldown_mode='scenario_c',
        cost_mode='taker',
        use_alt_slippage=True,
        max_consecutive_sl=2,
        atr_multiplier=1.5,
        ema_period=10,
    )
    all_summaries.append(sum_C)
    tr_C.to_csv(os.path.join(OUT_DIR, 'trades_C.csv'), index=False)
    eq_C.to_csv(os.path.join(OUT_DIR, 'equity_C.csv'), index=False)

    # C Maker Variant
    sum_Cm, tr_Cm, eq_Cm = engine_is.run(
        scenario_name='C_reparam_maker',
        start_equity=20000.0,
        leverage=3.0,
        take_profit_pct=None,
        stop_loss_pct='atr',
        entry_mode='4h_close',
        slot_margin_mode='total_equity',
        cooldown_mode='scenario_c',
        cost_mode='maker',
        use_alt_slippage=True,
        max_consecutive_sl=2,
        atr_multiplier=1.5,
        ema_period=10,
    )
    all_summaries.append(sum_Cm)
    tr_Cm.to_csv(os.path.join(OUT_DIR, 'trades_C_maker.csv'), index=False)
    eq_Cm.to_csv(os.path.join(OUT_DIR, 'equity_C_maker.csv'), index=False)

    # C Taker Ex-ZEC/AVAX (3 pairs, 25% slot each -> 75% max allocated)
    sum_C_nozec, tr_C_nozec, eq_C_nozec = engine_is.run(
        scenario_name='C_ex_ZEC_AVAX_taker',
        start_equity=20000.0,
        leverage=3.0,
        take_profit_pct=None,
        stop_loss_pct='atr',
        entry_mode='4h_close',
        slot_margin_mode='total_equity',
        cooldown_mode='scenario_c',
        cost_mode='taker',
        use_alt_slippage=True,
        max_consecutive_sl=2,
        atr_multiplier=1.5,
        ema_period=10,
        active_pairs=['ENA/SUI', 'SOL/ADA', 'BNB/ETH'],
    )
    all_summaries.append(sum_C_nozec)
    tr_C_nozec.to_csv(os.path.join(OUT_DIR, 'trades_C_ex_zec.csv'), index=False)
    eq_C_nozec.to_csv(os.path.join(OUT_DIR, 'equity_C_ex_zec.csv'), index=False)

    # C Maker Ex-ZEC/AVAX
    sum_Cm_nozec, tr_Cm_nozec, eq_Cm_nozec = engine_is.run(
        scenario_name='C_ex_ZEC_AVAX_maker',
        start_equity=20000.0,
        leverage=3.0,
        take_profit_pct=None,
        stop_loss_pct='atr',
        entry_mode='4h_close',
        slot_margin_mode='total_equity',
        cooldown_mode='scenario_c',
        cost_mode='maker',
        use_alt_slippage=True,
        max_consecutive_sl=2,
        atr_multiplier=1.5,
        ema_period=10,
        active_pairs=['ENA/SUI', 'SOL/ADA', 'BNB/ETH'],
    )
    all_summaries.append(sum_Cm_nozec)

    # Per-pair stats for Scenario C
    for p in PAIRS_CONFIG:
        sym = p['pair_symbol']
        p_trades = tr_C[tr_C['pair_symbol'] == sym]
        if len(p_trades) > 0:
            per_pair_rows.append({
                'scenario': 'C_reparam_taker',
                'pair_symbol': sym,
                'trades_count': len(p_trades),
                'tp_count': len(p_trades[p_trades['exit_reason'] == 'tp']),
                'sl_count': len(p_trades[p_trades['exit_reason'] == 'sl']),
                'trend_flip_count': len(p_trades[p_trades['exit_reason'] == 'trend_flip']),
                'winrate_pct': len(p_trades[p_trades['net_pnl_usd'] > 0]) / len(p_trades) * 100.0,
                'gross_pnl_usd': p_trades['gross_pnl_usd'].sum(),
                'net_pnl_usd': p_trades['net_pnl_usd'].sum(),
                'fees_usd': p_trades['fees_usd'].sum(),
                'slippage_usd': p_trades['slippage_usd'].sum(),
                'funding_usd': p_trades['funding_usd'].sum(),
                'avg_holding_min': p_trades['holding_minutes'].mean(),
                'median_holding_min': p_trades['holding_minutes'].median(),
            })

    # =========================================================================
    # CHECK 4: Temporal Stability (Half 1 vs Half 2)
    # =========================================================================
    print("\n==================================================================")
    print("CHECK 4: Temporal Stability (Half 1: Mar-Jun vs Half 2: Jun-Sep)")
    print("==================================================================")
    h1_start, h1_end = '2026-03-07 00:00:00', '2026-06-04 23:59:00'
    h2_start, h2_end = '2026-06-05 00:00:00', '2026-09-03 23:59:00'

    half_configs = [
        ('C_reparam_taker', {'leverage': 3.0, 'tp': None, 'sl': 'atr', 'entry': '4h_close', 'cooldown': 'scenario_c'}),
        ('Grid_Top1_L2_SL5.0_TP_None', {'leverage': 2.0, 'tp': None, 'sl': 5.0, 'entry': '1m', 'cooldown': 'none'}),
        ('Grid_Top2_L2_SL10.0_TP_None', {'leverage': 2.0, 'tp': None, 'sl': 10.0, 'entry': '1m', 'cooldown': 'none'}),
        ('Grid_Top3_L3_SL10.0_TP_None', {'leverage': 3.0, 'tp': None, 'sl': 10.0, 'entry': '1m', 'cooldown': 'none'}),
    ]

    for name, cfg in half_configs:
        # Half 1
        sum_h1, _, _ = engine_is.run(
            scenario_name=f'{name}_Half1',
            start_equity=20000.0,
            leverage=cfg['leverage'],
            take_profit_pct=cfg['tp'],
            stop_loss_pct=cfg['sl'],
            entry_mode=cfg['entry'],
            slot_margin_mode='total_equity' if cfg['entry'] == '4h_close' else 'free_margin',
            cooldown_mode=cfg['cooldown'],
            cost_mode='taker',
            use_alt_slippage=True,
            start_date=h1_start,
            end_date=h1_end,
        )
        all_summaries.append(sum_h1)

        # Half 2
        sum_h2, _, _ = engine_is.run(
            scenario_name=f'{name}_Half2',
            start_equity=20000.0,
            leverage=cfg['leverage'],
            take_profit_pct=cfg['tp'],
            stop_loss_pct=cfg['sl'],
            entry_mode=cfg['entry'],
            slot_margin_mode='total_equity' if cfg['entry'] == '4h_close' else 'free_margin',
            cooldown_mode=cfg['cooldown'],
            cost_mode='taker',
            use_alt_slippage=True,
            start_date=h2_start,
            end_date=h2_end,
        )
        all_summaries.append(sum_h2)

    # =========================================================================
    # CHECK 5: Out-Of-Sample (OOS) for Scenario C (2025-09-01 .. 2026-02-28)
    # =========================================================================
    print("\n==================================================================")
    print("CHECK 5: Out-Of-Sample (OOS) Test for Scenario C (2025-09-01 .. 2026-02-28)")
    print("==================================================================")
    sum_C_oos, tr_C_oos, eq_C_oos = engine_oos.run(
        scenario_name='C_reparam_taker_OOS',
        start_equity=20000.0,
        leverage=3.0,
        take_profit_pct=None,
        stop_loss_pct='atr',
        entry_mode='4h_close',
        slot_margin_mode='total_equity',
        cooldown_mode='scenario_c',
        cost_mode='taker',
        use_alt_slippage=True,
        max_consecutive_sl=2,
        atr_multiplier=1.5,
        ema_period=10,
        start_date='2025-09-01 00:00:00',
        end_date='2026-02-28 23:59:00',
    )
    all_summaries.append(sum_C_oos)
    tr_C_oos.to_csv(os.path.join(OUT_DIR, 'trades_C_OOS.csv'), index=False)
    eq_C_oos.to_csv(os.path.join(OUT_DIR, 'equity_C_OOS.csv'), index=False)

    # C Maker OOS
    sum_Cm_oos, _, _ = engine_oos.run(
        scenario_name='C_reparam_maker_OOS',
        start_equity=20000.0,
        leverage=3.0,
        take_profit_pct=None,
        stop_loss_pct='atr',
        entry_mode='4h_close',
        slot_margin_mode='total_equity',
        cooldown_mode='scenario_c',
        cost_mode='maker',
        use_alt_slippage=True,
        max_consecutive_sl=2,
        atr_multiplier=1.5,
        ema_period=10,
        start_date='2025-09-01 00:00:00',
        end_date='2026-02-28 23:59:00',
    )
    all_summaries.append(sum_Cm_oos)

    # =========================================================================
    # CHECK 6: Parameter Sensitivity for Scenario C (8 Runs)
    # =========================================================================
    print("\n==================================================================")
    print("CHECK 6: Parameter Sensitivity for Scenario C (SL ATR x EMA Period)")
    print("==================================================================")
    atr_mults = [1.0, 1.5, 2.0, 3.0]
    ema_pers = [10, 20]

    for ema_p in ema_pers:
        for atr_m in atr_mults:
            s_name = f'C_sens_EMA{ema_p}_ATR{atr_m}'
            print(f"--- Running Sensitivity: {s_name} ---")
            sum_sens, _, _ = engine_is.run(
                scenario_name=s_name,
                start_equity=20000.0,
                leverage=3.0,
                take_profit_pct=None,
                stop_loss_pct='atr',
                entry_mode='4h_close',
                slot_margin_mode='total_equity',
                cooldown_mode='scenario_c',
                cost_mode='taker',
                use_alt_slippage=True,
                max_consecutive_sl=2,
                atr_multiplier=atr_m,
                ema_period=ema_p,
            )
            all_summaries.append(sum_sens)

    # Save summary and per-pair results
    summary_df = pd.DataFrame(all_summaries)
    summary_df.to_csv(os.path.join(OUT_DIR, 'summary.csv'), index=False)

    per_pair_df = pd.DataFrame(per_pair_rows)
    per_pair_df.to_csv(os.path.join(OUT_DIR, 'per_pair_breakdown.csv'), index=False)

    print("\n================ ROBUSTNESS SUMMARY ================")
    cols_display = [
        'scenario', 'net_profit_pct', 'max_drawdown_pct', 'trades_count',
        'winrate_pct', 'avg_trade_net_pnl_pct', 'sharpe_daily', 'calmar_ratio', 'median_holding_time_min'
    ]
    print(summary_df[cols_display].to_string(index=False))
    print("====================================================\n")


def run_grid_d():
    print("\n>>> Running Scenario D (Parameter Grid Search on Scenario A Architecture)...")
    dataset = BacktestDataset(prefix='')
    engine = SimulationEngine(dataset)

    leverages = [2.0, 3.0, 5.0, 7.0]
    stop_losses = [1.5, 3.0, 5.0, 10.0]
    take_profits = [5.0, 10.0, 20.0, None]

    grid_results = []
    total_runs = len(leverages) * len(stop_losses) * len(take_profits)
    run_num = 0

    for lev in leverages:
        for sl in stop_losses:
            for tp in take_profits:
                run_num += 1
                tp_name = f"TP{tp}" if tp is not None else "TP_None"
                name = f"L{int(lev)}_SL{sl}_{tp_name}"
                print(f"[{run_num}/{total_runs}] Grid run: {name}...")

                sum_res, _, _ = engine.run(
                    scenario_name=name,
                    start_equity=20000.0,
                    leverage=lev,
                    take_profit_pct=tp,
                    stop_loss_pct=sl,
                    entry_mode='1m',
                    slot_margin_mode='free_margin',
                    cooldown_mode='none',
                    cost_mode='taker',
                    barrier_convention='pessimistic',
                    use_alt_slippage=True,
                )
                sum_res['param_leverage'] = lev
                sum_res['param_sl_pct'] = sl
                sum_res['param_tp_pct'] = tp if tp is not None else -1
                grid_results.append(sum_res)

    grid_df = pd.DataFrame(grid_results)
    grid_df.to_csv(os.path.join(OUT_DIR, 'grid_D.csv'), index=False)

    print("\n>>> Scenario D Completed. Ranking by Daily Sharpe & Calmar...")
    top_sharpe = grid_df.sort_values(by='sharpe_daily', ascending=False).head(10)
    top_calmar = grid_df.sort_values(by='calmar_ratio', ascending=False).head(10)
    current_setting = grid_df[(grid_df['param_leverage'] == 7.0) & (grid_df['param_sl_pct'] == 1.5) & (grid_df['param_tp_pct'] == 5.0)]

    cols_grid = ['scenario', 'param_leverage', 'param_sl_pct', 'param_tp_pct', 'net_profit_pct', 'max_drawdown_pct', 'sharpe_daily', 'calmar_ratio', 'trades_count', 'winrate_pct', 'median_holding_time_min']
    print("\n--- TOP 10 BY DAILY SHARPE RATIO ---")
    print(top_sharpe[cols_grid].to_string(index=False))

    print("\n--- TOP 10 BY CALMAR RATIO ---")
    print(top_calmar[cols_grid].to_string(index=False))

    print("\n--- CURRENT SETTING ROW (L=7, SL=1.5%, TP=5.0%) ---")
    print(current_setting[cols_grid].to_string(index=False))


def main():
    parser = argparse.ArgumentParser(description="Bee Crypto Worker Quantitative Backtest & Robustness Suite")
    parser.add_argument('--scenario', type=str, default='all', choices=['all', 'main', 'robustness', 'D'], help="Execution mode")
    args = parser.parse_args()

    if args.scenario in ['all', 'robustness', 'main']:
        run_all_robustness_checks()
        if args.scenario in ['all', 'D']:
            run_grid_d()
    elif args.scenario == 'D':
        run_grid_d()


if __name__ == '__main__':
    main()
