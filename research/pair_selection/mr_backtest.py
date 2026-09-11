import os
import math
import numpy as np
import pandas as pd
from datetime import datetime, timezone

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT_DIR, exist_ok=True)

FORMATION_BARS = 540   # 90 days (6 bars/day)
REBALANCE_BARS = 180   # 30 days
LEVERAGE = 2.0
TAKER_FEE = 0.00055    # 0.055%
SLIPPAGE = 0.00030     # 0.030%
COST_PER_SIDE = TAKER_FEE + SLIPPAGE  # 0.085% per leg per side
INITIAL_CAPITAL = 10000.0

HAND_PICKED_PAIRS = [
    ("ZEC", "AVAX"),
    ("ENA", "SUI"),
    ("SOL", "ADA"),
    ("BNB", "ETH")
]

def load_master_dataframe():
    files = [f for f in os.listdir(DATA_DIR) if f.startswith("4h_") and f.endswith(".csv")]
    dfs = {}
    for f in files:
        base = f.replace("4h_", "").replace(".csv", "")
        filepath = os.path.join(DATA_DIR, f)
        df = pd.read_csv(filepath)[["timestamp", "close"]].rename(columns={"close": base})
        dfs[base] = df
        
    master_df = dfs["BTC"][["timestamp"]].copy()
    for base, df in dfs.items():
        master_df = pd.merge(master_df, df, on="timestamp", how="left")
        
    master_df["dt"] = pd.to_datetime(master_df["timestamp"], unit="ms", utc=True)
    master_df.sort_values(by="timestamp", inplace=True)
    master_df.reset_index(drop=True, inplace=True)
    return master_df

def compute_formation_stats(df_form, legA, legB):
    """
    Compute OLS hedge ratio gamma, alpha, spread mean & std, and beta ratio vs BTC
    strictly on the formation window (no lookahead).
    """
    assert len(df_form) == FORMATION_BARS, f"Expected {FORMATION_BARS} bars for formation window, got {len(df_form)}"
    
    pA = df_form[legA].values
    pB = df_form[legB].values
    pBTC = df_form["BTC"].values
    
    log_pA = np.log(pA)
    log_pB = np.log(pB)
    log_pBTC = np.log(pBTC)
    
    # OLS on log prices: log(pA) = alpha + gamma * log(pB)
    var_b = np.var(log_pB)
    if var_b < 1e-12:
        gamma = 1.0
        alpha = 0.0
    else:
        gamma = float(np.cov(log_pA, log_pB)[0, 1] / var_b)
        alpha = float(np.mean(log_pA) - gamma * np.mean(log_pB))
        
    # Spread series in formation window
    spread = log_pA - gamma * log_pB
    mu_s = float(np.mean(spread))
    sigma_s = float(np.std(spread))
    if sigma_s < 1e-8:
        sigma_s = 1e-4
        
    # Betas vs BTC using 4h log returns
    rA = np.diff(log_pA)
    rB = np.diff(log_pB)
    rBTC = np.diff(log_pBTC)
    var_btc = np.var(rBTC)
    
    if var_btc > 1e-12:
        beta_A = float(np.cov(rA, rBTC)[0, 1] / var_btc)
        beta_B = float(np.cov(rB, rBTC)[0, 1] / var_btc)
    else:
        beta_A = 1.0
        beta_B = 1.0
        
    beta_ratio = float(beta_A / max(beta_B, 1e-5)) if beta_B > 0 else 1.0
    
    return {
        "gamma": gamma,
        "alpha": alpha,
        "mu_s": mu_s,
        "sigma_s": sigma_s,
        "beta_A": beta_A,
        "beta_B": beta_B,
        "beta_ratio": beta_ratio
    }

def run_screener_mr_backtest(master_df, selected_pairs_df):
    """
    Variant 1: Out-of-sample Mean-Reversion backtest on walk-forward selected pairs.
    """
    total_bars = len(master_df)
    rebalance_indices = list(range(FORMATION_BARS, total_bars, REBALANCE_BARS))
    
    equity = INITIAL_CAPITAL
    equity_curve = []
    trades = []
    period_stats = []
    
    for r_idx, reb_bar in enumerate(rebalance_indices):
        reb_dt = master_df["dt"].iloc[reb_bar]
        reb_dt_str = reb_dt.strftime("%Y-%m-%d %H:%M")
        oos_start = reb_bar
        oos_end = min(reb_bar + REBALANCE_BARS, total_bars)
        
        # Formation slice strictly prior to oos_start
        form_start = reb_bar - FORMATION_BARS
        df_form = master_df.iloc[form_start:reb_bar]
        
        # Get selected pairs for this rebalance period
        cur_sel = selected_pairs_df[selected_pairs_df["rebalance_idx"] == (r_idx + 1)]
        pairs_to_trade = []
        
        for _, row in cur_sel.iterrows():
            legA = row["pairA"]
            legB = row["pairB"]
            stats = compute_formation_stats(df_form, legA, legB)
            pairs_to_trade.append({
                "legA": legA,
                "legB": legB,
                "gamma": stats["gamma"],
                "mu_s": stats["mu_s"],
                "sigma_s": stats["sigma_s"],
                "beta_ratio": stats["beta_ratio"]
            })
            
        n_pairs = len(pairs_to_trade)
        start_period_equity = equity
        
        if n_pairs == 0:
            # 100% cash
            for b_idx in range(oos_start, oos_end):
                bar_dt = master_df["dt"].iloc[b_idx]
                equity_curve.append({
                    "bar_idx": b_idx,
                    "timestamp": master_df["timestamp"].iloc[b_idx],
                    "dt": bar_dt.strftime("%Y-%m-%d %H:%M"),
                    "equity": round(equity, 2),
                    "active_pairs": 0,
                    "in_position_count": 0
                })
            period_stats.append({
                "period_idx": r_idx + 1,
                "rebalance_date": reb_dt_str,
                "n_pairs": 0,
                "start_equity": round(start_period_equity, 2),
                "end_equity": round(equity, 2),
                "return_pct": 0.0,
                "trade_count": 0
            })
            continue
            
        margin_per_pair = start_period_equity / n_pairs
        positions = [None] * n_pairs
        period_trade_count = 0
        
        for b_idx in range(oos_start, oos_end):
            bar_dt = master_df["dt"].iloc[b_idx]
            is_period_last_bar = (b_idx == oos_end - 1)
            
            unrealized_pnl_total = 0.0
            in_pos_count = 0
            
            for p_idx, p_info in enumerate(pairs_to_trade):
                legA = p_info["legA"]
                legB = p_info["legB"]
                gamma = p_info["gamma"]
                mu_s = p_info["mu_s"]
                sigma_s = p_info["sigma_s"]
                beta_ratio = p_info["beta_ratio"]
                
                cur_pA = master_df[legA].iloc[b_idx]
                cur_pB = master_df[legB].iloc[b_idx]
                
                # Out-of-sample z-score
                cur_s = math.log(cur_pA) - gamma * math.log(cur_pB)
                z_t = (cur_s - mu_s) / sigma_s
                
                pos = positions[p_idx]
                
                if pos is None:
                    # Valid entry zone: 2.0 < |z| < 4.0 (do not enter if already in blowout |z| >= 4.0)
                    notional_pair = LEVERAGE * margin_per_pair
                    notional_A = notional_pair / (1.0 + beta_ratio)
                    notional_B = notional_A * beta_ratio
                    
                    qA = notional_A / cur_pA
                    qB = notional_B / cur_pB
                    entry_cost = (notional_A + notional_B) * COST_PER_SIDE
                    
                    if 2.0 < z_t < 4.0:
                        # Short spread: Short A, Long B
                        positions[p_idx] = {
                            "direction": -1,  # short spread
                            "entry_bar": b_idx,
                            "entry_dt": bar_dt.strftime("%Y-%m-%d %H:%M"),
                            "entry_z": z_t,
                            "entry_pA": cur_pA,
                            "entry_pB": cur_pB,
                            "notional_A": notional_A,
                            "notional_B": notional_B,
                            "qA": qA,
                            "qB": qB,
                            "entry_cost": entry_cost
                        }
                    elif -4.0 < z_t < -2.0:
                        # Long spread: Long A, Short B
                        positions[p_idx] = {
                            "direction": +1,  # long spread
                            "entry_bar": b_idx,
                            "entry_dt": bar_dt.strftime("%Y-%m-%d %H:%M"),
                            "entry_z": z_t,
                            "entry_pA": cur_pA,
                            "entry_pB": cur_pB,
                            "notional_A": notional_A,
                            "notional_B": notional_B,
                            "qA": qA,
                            "qB": qB,
                            "entry_cost": entry_cost
                        }
                else:
                    # Position is open, check Exit or Mark-to-Market
                    in_pos_count += 1
                    pos_dir = pos["direction"]
                    qA = pos["qA"]
                    qB = pos["qB"]
                    
                    # Gross PnL
                    if pos_dir == +1:
                        # Long A, Short B
                        gross_pnl = qA * (cur_pA - pos["entry_pA"]) + qB * (pos["entry_pB"] - cur_pB)
                    else:
                        # Short A, Long B
                        gross_pnl = qA * (pos["entry_pA"] - cur_pA) + qB * (cur_pB - pos["entry_pB"])
                        
                    exit_notional = qA * cur_pA + qB * cur_pB
                    exit_cost = exit_notional * COST_PER_SIDE
                    
                    exit_reason = None
                    if pos_dir == +1:
                        if z_t >= 0.0:
                            exit_reason = "take_profit_reversion"
                        elif z_t <= -4.0:
                            exit_reason = "stop_loss_blowout"
                        elif is_period_last_bar:
                            exit_reason = "period_end_close"
                    else:
                        if z_t <= 0.0:
                            exit_reason = "take_profit_reversion"
                        elif z_t >= 4.0:
                            exit_reason = "stop_loss_blowout"
                        elif is_period_last_bar:
                            exit_reason = "period_end_close"
                            
                    if exit_reason is not None:
                        # Close position
                        net_pnl = gross_pnl - pos["entry_cost"] - exit_cost
                        equity += net_pnl
                        hold_bars = b_idx - pos["entry_bar"]
                        hold_days = hold_bars / 6.0
                        
                        trades.append({
                            "period_idx": r_idx + 1,
                            "pair": f"{legA}/{legB}",
                            "legA": legA,
                            "legB": legB,
                            "direction": "LONG_SPREAD" if pos_dir == +1 else "SHORT_SPREAD",
                            "entry_dt": pos["entry_dt"],
                            "exit_dt": bar_dt.strftime("%Y-%m-%d %H:%M"),
                            "entry_bar": pos["entry_bar"],
                            "exit_bar": b_idx,
                            "hold_bars": hold_bars,
                            "hold_days": round(hold_days, 2),
                            "entry_z": round(pos["entry_z"], 2),
                            "exit_z": round(z_t, 2),
                            "exit_reason": exit_reason,
                            "gross_pnl": round(gross_pnl, 2),
                            "total_cost": round(pos["entry_cost"] + exit_cost, 2),
                            "net_pnl": round(net_pnl, 2),
                            "return_on_margin": round(net_pnl / margin_per_pair * 100, 2),
                            "gamma": round(gamma, 4),
                            "beta_ratio": round(beta_ratio, 4)
                        })
                        positions[p_idx] = None
                        period_trade_count += 1
                    else:
                        # Still open, mark to market
                        unrealized_pnl_total += (gross_pnl - pos["entry_cost"] - exit_cost)
                        
            current_bar_equity = equity + unrealized_pnl_total
            equity_curve.append({
                "bar_idx": b_idx,
                "timestamp": master_df["timestamp"].iloc[b_idx],
                "dt": bar_dt.strftime("%Y-%m-%d %H:%M"),
                "equity": round(current_bar_equity, 2),
                "active_pairs": n_pairs,
                "in_position_count": in_pos_count
            })
            
        period_ret = (equity - start_period_equity) / start_period_equity * 100.0
        period_stats.append({
            "period_idx": r_idx + 1,
            "rebalance_date": reb_dt_str,
            "n_pairs": n_pairs,
            "start_equity": round(start_period_equity, 2),
            "end_equity": round(equity, 2),
            "return_pct": round(period_ret, 2),
            "trade_count": period_trade_count
        })
        
    df_equity = pd.DataFrame(equity_curve)
    df_trades = pd.DataFrame(trades)
    df_periods = pd.DataFrame(period_stats)
    return df_equity, df_trades, df_periods

def run_baseline_handpicked_mr(master_df):
    """
    Variant 2: Current 4 hand-picked pairs with the same walk-forward MR rules.
    """
    total_bars = len(master_df)
    rebalance_indices = list(range(FORMATION_BARS, total_bars, REBALANCE_BARS))
    
    equity = INITIAL_CAPITAL
    equity_curve = []
    trades = []
    period_stats = []
    
    for r_idx, reb_bar in enumerate(rebalance_indices):
        reb_dt = master_df["dt"].iloc[reb_bar]
        reb_dt_str = reb_dt.strftime("%Y-%m-%d %H:%M")
        oos_start = reb_bar
        oos_end = min(reb_bar + REBALANCE_BARS, total_bars)
        
        form_start = reb_bar - FORMATION_BARS
        df_form = master_df.iloc[form_start:reb_bar]
        
        pairs_to_trade = []
        for legA, legB in HAND_PICKED_PAIRS:
            stats = compute_formation_stats(df_form, legA, legB)
            pairs_to_trade.append({
                "legA": legA,
                "legB": legB,
                "gamma": stats["gamma"],
                "mu_s": stats["mu_s"],
                "sigma_s": stats["sigma_s"],
                "beta_ratio": stats["beta_ratio"]
            })
            
        n_pairs = len(pairs_to_trade)
        start_period_equity = equity
        margin_per_pair = start_period_equity / n_pairs
        positions = [None] * n_pairs
        period_trade_count = 0
        
        for b_idx in range(oos_start, oos_end):
            bar_dt = master_df["dt"].iloc[b_idx]
            is_period_last_bar = (b_idx == oos_end - 1)
            unrealized_pnl_total = 0.0
            in_pos_count = 0
            
            for p_idx, p_info in enumerate(pairs_to_trade):
                legA = p_info["legA"]
                legB = p_info["legB"]
                gamma = p_info["gamma"]
                mu_s = p_info["mu_s"]
                sigma_s = p_info["sigma_s"]
                beta_ratio = p_info["beta_ratio"]
                
                cur_pA = master_df[legA].iloc[b_idx]
                cur_pB = master_df[legB].iloc[b_idx]
                
                cur_s = math.log(cur_pA) - gamma * math.log(cur_pB)
                z_t = (cur_s - mu_s) / sigma_s
                
                pos = positions[p_idx]
                
                if pos is None:
                    notional_pair = LEVERAGE * margin_per_pair
                    notional_A = notional_pair / (1.0 + beta_ratio)
                    notional_B = notional_A * beta_ratio
                    qA = notional_A / cur_pA
                    qB = notional_B / cur_pB
                    entry_cost = (notional_A + notional_B) * COST_PER_SIDE
                    
                    if 2.0 < z_t < 4.0:
                        positions[p_idx] = {
                            "direction": -1,
                            "entry_bar": b_idx,
                            "entry_dt": bar_dt.strftime("%Y-%m-%d %H:%M"),
                            "entry_z": z_t,
                            "entry_pA": cur_pA,
                            "entry_pB": cur_pB,
                            "notional_A": notional_A,
                            "notional_B": notional_B,
                            "qA": qA,
                            "qB": qB,
                            "entry_cost": entry_cost
                        }
                    elif -4.0 < z_t < -2.0:
                        positions[p_idx] = {
                            "direction": +1,
                            "entry_bar": b_idx,
                            "entry_dt": bar_dt.strftime("%Y-%m-%d %H:%M"),
                            "entry_z": z_t,
                            "entry_pA": cur_pA,
                            "entry_pB": cur_pB,
                            "notional_A": notional_A,
                            "notional_B": notional_B,
                            "qA": qA,
                            "qB": qB,
                            "entry_cost": entry_cost
                        }
                else:
                    in_pos_count += 1
                    pos_dir = pos["direction"]
                    qA = pos["qA"]
                    qB = pos["qB"]
                    
                    if pos_dir == +1:
                        gross_pnl = qA * (cur_pA - pos["entry_pA"]) + qB * (pos["entry_pB"] - cur_pB)
                    else:
                        gross_pnl = qA * (pos["entry_pA"] - cur_pA) + qB * (cur_pB - pos["entry_pB"])
                        
                    exit_notional = qA * cur_pA + qB * cur_pB
                    exit_cost = exit_notional * COST_PER_SIDE
                    
                    exit_reason = None
                    if pos_dir == +1:
                        if z_t >= 0.0:
                            exit_reason = "take_profit_reversion"
                        elif z_t <= -4.0:
                            exit_reason = "stop_loss_blowout"
                        elif is_period_last_bar:
                            exit_reason = "period_end_close"
                    else:
                        if z_t <= 0.0:
                            exit_reason = "take_profit_reversion"
                        elif z_t >= 4.0:
                            exit_reason = "stop_loss_blowout"
                        elif is_period_last_bar:
                            exit_reason = "period_end_close"
                            
                    if exit_reason is not None:
                        net_pnl = gross_pnl - pos["entry_cost"] - exit_cost
                        equity += net_pnl
                        hold_bars = b_idx - pos["entry_bar"]
                        hold_days = hold_bars / 6.0
                        trades.append({
                            "period_idx": r_idx + 1,
                            "pair": f"{legA}/{legB}",
                            "legA": legA,
                            "legB": legB,
                            "direction": "LONG_SPREAD" if pos_dir == +1 else "SHORT_SPREAD",
                            "entry_dt": pos["entry_dt"],
                            "exit_dt": bar_dt.strftime("%Y-%m-%d %H:%M"),
                            "entry_bar": pos["entry_bar"],
                            "exit_bar": b_idx,
                            "hold_bars": hold_bars,
                            "hold_days": round(hold_days, 2),
                            "entry_z": round(pos["entry_z"], 2),
                            "exit_z": round(z_t, 2),
                            "exit_reason": exit_reason,
                            "gross_pnl": round(gross_pnl, 2),
                            "total_cost": round(pos["entry_cost"] + exit_cost, 2),
                            "net_pnl": round(net_pnl, 2),
                            "return_on_margin": round(net_pnl / margin_per_pair * 100, 2),
                            "gamma": round(gamma, 4),
                            "beta_ratio": round(beta_ratio, 4)
                        })
                        positions[p_idx] = None
                        period_trade_count += 1
                    else:
                        unrealized_pnl_total += (gross_pnl - pos["entry_cost"] - exit_cost)
                        
            current_bar_equity = equity + unrealized_pnl_total
            equity_curve.append({
                "bar_idx": b_idx,
                "timestamp": master_df["timestamp"].iloc[b_idx],
                "dt": bar_dt.strftime("%Y-%m-%d %H:%M"),
                "equity": round(current_bar_equity, 2),
                "active_pairs": n_pairs,
                "in_position_count": in_pos_count
            })
            
        period_ret = (equity - start_period_equity) / start_period_equity * 100.0
        period_stats.append({
            "period_idx": r_idx + 1,
            "rebalance_date": reb_dt_str,
            "n_pairs": n_pairs,
            "start_equity": round(start_period_equity, 2),
            "end_equity": round(equity, 2),
            "return_pct": round(period_ret, 2),
            "trade_count": period_trade_count
        })
        
    return pd.DataFrame(equity_curve), pd.DataFrame(trades), pd.DataFrame(period_stats)

def run_baseline_handpicked_momentum(master_df):
    """
    Variant 3: Current 4 hand-picked pairs with the live Momentum rule (Ratio > EMA10, exit Ratio < EMA10) at 2x leverage.
    """
    total_bars = len(master_df)
    rebalance_indices = list(range(FORMATION_BARS, total_bars, REBALANCE_BARS))
    
    # Precompute EMA10 of Ratio across entire master_df
    pair_series = {}
    for legA, legB in HAND_PICKED_PAIRS:
        ratio = master_df[legA] / master_df[legB]
        ema10 = ratio.ewm(span=10, adjust=False).mean()
        pair_series[(legA, legB)] = {
            "ratio": ratio,
            "ema10": ema10
        }
        
    equity = INITIAL_CAPITAL
    equity_curve = []
    trades = []
    period_stats = []
    
    for r_idx, reb_bar in enumerate(rebalance_indices):
        reb_dt = master_df["dt"].iloc[reb_bar]
        reb_dt_str = reb_dt.strftime("%Y-%m-%d %H:%M")
        oos_start = reb_bar
        oos_end = min(reb_bar + REBALANCE_BARS, total_bars)
        
        n_pairs = len(HAND_PICKED_PAIRS)
        start_period_equity = equity
        margin_per_pair = start_period_equity / n_pairs
        positions = [None] * n_pairs
        period_trade_count = 0
        
        for b_idx in range(oos_start, oos_end):
            bar_dt = master_df["dt"].iloc[b_idx]
            is_period_last_bar = (b_idx == oos_end - 1)
            unrealized_pnl_total = 0.0
            in_pos_count = 0
            
            for p_idx, (legA, legB) in enumerate(HAND_PICKED_PAIRS):
                cur_pA = master_df[legA].iloc[b_idx]
                cur_pB = master_df[legB].iloc[b_idx]
                cur_ratio = pair_series[(legA, legB)]["ratio"].iloc[b_idx]
                cur_ema = pair_series[(legA, legB)]["ema10"].iloc[b_idx]
                
                pos = positions[p_idx]
                
                if pos is None:
                    # Entry condition: Ratio > EMA10
                    if cur_ratio > cur_ema:
                        notional_pair = LEVERAGE * margin_per_pair
                        notional_leg = notional_pair / 2.0
                        qA = notional_leg / cur_pA
                        qB = notional_leg / cur_pB
                        entry_cost = notional_pair * COST_PER_SIDE
                        
                        positions[p_idx] = {
                            "direction": "MOMENTUM_LONG_RATIO",
                            "entry_bar": b_idx,
                            "entry_dt": bar_dt.strftime("%Y-%m-%d %H:%M"),
                            "entry_ratio": cur_ratio,
                            "entry_pA": cur_pA,
                            "entry_pB": cur_pB,
                            "qA": qA,
                            "qB": qB,
                            "entry_cost": entry_cost
                        }
                else:
                    in_pos_count += 1
                    qA = pos["qA"]
                    qB = pos["qB"]
                    gross_pnl = qA * (cur_pA - pos["entry_pA"]) + qB * (pos["entry_pB"] - cur_pB)
                    exit_notional = qA * cur_pA + qB * cur_pB
                    exit_cost = exit_notional * COST_PER_SIDE
                    
                    exit_reason = None
                    if cur_ratio < cur_ema:
                        exit_reason = "trend_flip_below_ema10"
                    elif is_period_last_bar:
                        exit_reason = "period_end_close"
                        
                    if exit_reason is not None:
                        net_pnl = gross_pnl - pos["entry_cost"] - exit_cost
                        equity += net_pnl
                        hold_bars = b_idx - pos["entry_bar"]
                        hold_days = hold_bars / 6.0
                        trades.append({
                            "period_idx": r_idx + 1,
                            "pair": f"{legA}/{legB}",
                            "legA": legA,
                            "legB": legB,
                            "direction": "MOM_LONG_RATIO",
                            "entry_dt": pos["entry_dt"],
                            "exit_dt": bar_dt.strftime("%Y-%m-%d %H:%M"),
                            "entry_bar": pos["entry_bar"],
                            "exit_bar": b_idx,
                            "hold_bars": hold_bars,
                            "hold_days": round(hold_days, 2),
                            "entry_ratio": round(pos["entry_ratio"], 4),
                            "exit_ratio": round(cur_ratio, 4),
                            "exit_reason": exit_reason,
                            "gross_pnl": round(gross_pnl, 2),
                            "total_cost": round(pos["entry_cost"] + exit_cost, 2),
                            "net_pnl": round(net_pnl, 2),
                            "return_on_margin": round(net_pnl / margin_per_pair * 100, 2)
                        })
                        positions[p_idx] = None
                        period_trade_count += 1
                    else:
                        unrealized_pnl_total += (gross_pnl - pos["entry_cost"] - exit_cost)
                        
            current_bar_equity = equity + unrealized_pnl_total
            equity_curve.append({
                "bar_idx": b_idx,
                "timestamp": master_df["timestamp"].iloc[b_idx],
                "dt": bar_dt.strftime("%Y-%m-%d %H:%M"),
                "equity": round(current_bar_equity, 2),
                "active_pairs": n_pairs,
                "in_position_count": in_pos_count
            })
            
        period_ret = (equity - start_period_equity) / start_period_equity * 100.0
        period_stats.append({
            "period_idx": r_idx + 1,
            "rebalance_date": reb_dt_str,
            "n_pairs": n_pairs,
            "start_equity": round(start_period_equity, 2),
            "end_equity": round(equity, 2),
            "return_pct": round(period_ret, 2),
            "trade_count": period_trade_count
        })
        
    return pd.DataFrame(equity_curve), pd.DataFrame(trades), pd.DataFrame(period_stats)

def run_sanity_shuffled_screener(master_df, selected_pairs_df, n_trials=50):
    """
    Sanity Check: Shuffle pair pairings or random pair selection to confirm edge is destroyed.
    """
    np.random.seed(42)
    tradable_coins = [c for c in master_df.columns if c not in ["timestamp", "dt", "BTC", "ETH"]]
    
    shuffled_sharpes = []
    shuffled_returns = []
    
    for trial in range(n_trials):
        shuffled_sel = selected_pairs_df.copy()
        for idx in range(len(shuffled_sel)):
            sampled = np.random.choice(tradable_coins, size=2, replace=False)
            shuffled_sel.at[idx, "pairA"] = sampled[0]
            shuffled_sel.at[idx, "pairB"] = sampled[1]
            
        eq_df, tr_df, _ = run_screener_mr_backtest(master_df, shuffled_sel)
        stats = compute_summary_metrics(eq_df, tr_df, "Shuffled_Null")
        shuffled_sharpes.append(stats["sharpe_ratio"])
        shuffled_returns.append(stats["total_return_pct"])
        
    mean_shuffled_sharpe = float(np.mean(shuffled_sharpes))
    mean_shuffled_return = float(np.mean(shuffled_returns))
    return mean_shuffled_sharpe, mean_shuffled_return

def compute_summary_metrics(df_equity, df_trades, name):
    eq = df_equity["equity"].values
    n_bars = len(eq)
    total_days = n_bars / 6.0
    
    total_return = (eq[-1] - eq[0]) / eq[0] * 100.0
    years = total_days / 365.25
    cagr = ((eq[-1] / eq[0]) ** (1.0 / years) - 1.0) * 100.0 if years > 0 and eq[-1] > 0 else -100.0
    
    bar_rets = np.diff(np.log(np.maximum(eq, 1e-8)))
    ann_vol = float(np.std(bar_rets) * math.sqrt(6 * 365.25) * 100.0)
    ann_ret = float(np.mean(bar_rets) * 6 * 365.25 * 100.0)
    sharpe = float(ann_ret / ann_vol) if ann_vol > 1e-8 else 0.0
    
    peak = np.maximum.accumulate(eq)
    dd = (eq - peak) / peak * 100.0
    max_dd = float(np.min(dd))
    calmar = float(abs(cagr / max_dd)) if abs(max_dd) > 1e-6 else 0.0
    
    n_trades = len(df_trades)
    if n_trades > 0:
        win_trades = df_trades[df_trades["net_pnl"] > 0]
        loss_trades = df_trades[df_trades["net_pnl"] <= 0]
        win_rate = len(win_trades) / n_trades * 100.0
        
        gross_profit = win_trades["net_pnl"].sum()
        gross_loss = abs(loss_trades["net_pnl"].sum())
        profit_factor = float(gross_profit / max(gross_loss, 1e-5)) if gross_loss > 0 else np.inf
        
        avg_trade_pnl = float(df_trades["net_pnl"].mean())
        avg_hold_days = float(df_trades["hold_days"].mean())
        
        total_costs = float(df_trades["total_cost"].sum())
        total_gross_pnl = float(df_trades["gross_pnl"].sum())
        fee_drag_pct = float(total_costs / max(abs(total_gross_pnl), 1e-5) * 100.0)
    else:
        win_rate = 0.0
        profit_factor = 0.0
        avg_trade_pnl = 0.0
        avg_hold_days = 0.0
        total_costs = 0.0
        fee_drag_pct = 0.0
        
    return {
        "strategy": name,
        "total_return_pct": round(total_return, 2),
        "cagr_pct": round(cagr, 2),
        "ann_vol_pct": round(ann_vol, 2),
        "sharpe_ratio": round(sharpe, 3),
        "max_drawdown_pct": round(max_dd, 2),
        "calmar_ratio": round(calmar, 3),
        "total_trades": n_trades,
        "win_rate_pct": round(win_rate, 2),
        "profit_factor": round(profit_factor, 3),
        "avg_trade_pnl_usd": round(avg_trade_pnl, 2),
        "avg_hold_days": round(avg_hold_days, 2),
        "total_fees_slippage_usd": round(total_costs, 2),
        "fee_drag_pct": round(fee_drag_pct, 2)
    }

def main():
    print("=" * 80)
    print("STARTING OUT-OF-SAMPLE MEAN-REVERSION & MOMENTUM BACKTEST")
    print("=" * 80)
    
    master_df = load_master_dataframe()
    selected_pairs_path = os.path.join(OUT_DIR, "selected_pairs.csv")
    if not os.path.exists(selected_pairs_path):
        raise RuntimeError(f"selected_pairs.csv not found at {selected_pairs_path}. Run screener.py first.")
        
    df_selected_pairs = pd.read_csv(selected_pairs_path)
    print(f"Loaded {len(df_selected_pairs)} walk-forward pair selection records across 16 rebalance periods.\n")
    
    # 1. Variant 1: Walk-Forward Screener MR
    print("Running Variant 1: Statistically Selected Pairs Mean-Reversion (OOS)...")
    eq_v1, tr_v1, per_v1 = run_screener_mr_backtest(master_df, df_selected_pairs)
    summary_v1 = compute_summary_metrics(eq_v1, tr_v1, "Screener_MR_WalkForward")
    
    eq_v1.to_csv(os.path.join(OUT_DIR, "mr_equity_screener.csv"), index=False)
    tr_v1.to_csv(os.path.join(OUT_DIR, "mr_trades_screener.csv"), index=False)
    
    # 2. Variant 2: Baseline Hand-Picked MR
    print("Running Variant 2: Current 4 Hand-Picked Pairs Mean-Reversion (Baseline 1)...")
    eq_v2, tr_v2, per_v2 = run_baseline_handpicked_mr(master_df)
    summary_v2 = compute_summary_metrics(eq_v2, tr_v2, "HandPicked_MR_Baseline")
    
    eq_v2.to_csv(os.path.join(OUT_DIR, "mr_equity_baseline_mr.csv"), index=False)
    tr_v2.to_csv(os.path.join(OUT_DIR, "mr_trades_baseline_mr.csv"), index=False)
    
    # 3. Variant 3: Baseline Hand-Picked Momentum (Ratio > EMA10 at 2x)
    print("Running Variant 3: Current 4 Hand-Picked Pairs Momentum (Baseline 2: Ratio > EMA10)...")
    eq_v3, tr_v3, per_v3 = run_baseline_handpicked_momentum(master_df)
    summary_v3 = compute_summary_metrics(eq_v3, tr_v3, "HandPicked_Momentum_Baseline")
    
    eq_v3.to_csv(os.path.join(OUT_DIR, "mr_equity_baseline_mom.csv"), index=False)
    tr_v3.to_csv(os.path.join(OUT_DIR, "mr_trades_baseline_mom.csv"), index=False)
    
    # 4. Shuffled Null Sanity Check
    print("\nRunning Sanity Check: Shuffled Pairs Null Model (50 Monte Carlo runs)...")
    null_sharpe, null_ret = run_sanity_shuffled_screener(master_df, df_selected_pairs, n_trials=50)
    print(f"  -> Shuffled Null Mean Return: {null_ret:.2f}%, Mean Sharpe: {null_sharpe:.3f}")
    
    # Combine summaries
    summaries = [summary_v1, summary_v2, summary_v3]
    df_summary = pd.DataFrame(summaries)
    summary_path = os.path.join(OUT_DIR, "mr_summary.csv")
    df_summary.to_csv(summary_path, index=False)
    print(f"\nSaved MR Summary -> {summary_path}")
    
    # Combine period-by-period returns
    periods_combined = per_v1[["period_idx", "rebalance_date"]].copy()
    periods_combined["Screener_MR_Return_%"] = per_v1["return_pct"]
    periods_combined["Baseline_MR_Return_%"] = per_v2["return_pct"]
    periods_combined["Baseline_Mom_Return_%"] = per_v3["return_pct"]
    periods_path = os.path.join(OUT_DIR, "mr_period_returns.csv")
    periods_combined.to_csv(periods_path, index=False)
    print(f"Saved Period Returns -> {periods_path}")
    
    print("\n" + "=" * 80)
    print("BACKTEST COMPARISON SUMMARY (18 Months OOS, 2x Leverage, 0.085% Cost/Side)")
    print("=" * 80)
    print(df_summary.to_string(index=False))
    print("\n" + "=" * 80)
    print("PERIOD-BY-PERIOD RETURN COMPARISON (% per 30-day window):")
    print("=" * 80)
    print(periods_combined.to_string(index=False))
    print("=" * 80)
    
    return df_summary, periods_combined

if __name__ == "__main__":
    main()
