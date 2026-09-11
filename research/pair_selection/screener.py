import os
import itertools
import time
from datetime import datetime, timezone
import pandas as pd
import numpy as np
from statsmodels.tsa.stattools import coint

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT_DIR, exist_ok=True)

FORMATION_BARS = 540  # 90 days * 6 bars/day
REBALANCE_BARS = 180  # 30 days * 6 bars/day
MAX_SELECTED_PAIRS = 6
PERMUTATION_RUNS = 200

def load_master_dataframe():
    files = [f for f in os.listdir(DATA_DIR) if f.startswith("4h_") and f.endswith(".csv")]
    if not files:
        raise RuntimeError("No 4h_*.csv files found in data directory. Run download_universe.py first.")
        
    dfs = {}
    for f in files:
        base = f.replace("4h_", "").replace(".csv", "")
        filepath = os.path.join(DATA_DIR, f)
        df = pd.read_csv(filepath)[["timestamp", "close"]].rename(columns={"close": base})
        dfs[base] = df
        
    if "BTC" not in dfs:
        raise RuntimeError("4h_BTC.csv is required for beta calculations.")
        
    master_df = dfs["BTC"][["timestamp"]].copy()
    for base, df in dfs.items():
        master_df = pd.merge(master_df, df, on="timestamp", how="left")
        
    master_df["dt"] = pd.to_datetime(master_df["timestamp"], unit="ms", utc=True)
    master_df.sort_values(by="timestamp", inplace=True)
    master_df.reset_index(drop=True, inplace=True)
    return master_df

def fit_ols(y, x):
    """
    Fit y = alpha + gamma * x using standard OLS formulas.
    """
    var_x = np.var(x)
    if var_x < 1e-12:
        return 0.0, 0.0
    gamma = float(np.cov(y, x)[0, 1] / var_x)
    alpha = float(np.mean(y) - gamma * np.mean(x))
    return alpha, gamma

def calc_half_life(residuals):
    """
    Fit AR(1) on spread residual: Delta eps_t = theta * eps_{t-1} + u_t
    rho = 1 + theta
    HL (bars) = -ln(2) / ln(rho)
    HL (days) = HL (bars) / 6.0
    """
    eps_lag = residuals[:-1]
    eps_diff = residuals[1:] - eps_lag
    var_lag = np.var(eps_lag)
    if var_lag < 1e-12:
        return np.inf, 1.0
    theta = float(np.cov(eps_diff, eps_lag)[0, 1] / var_lag)
    rho = 1.0 + theta
    if rho <= 0.0 or rho >= 1.0:
        return np.inf, rho
    hl_bars = -np.log(2.0) / np.log(rho)
    hl_days = float(hl_bars / 6.0)
    return hl_days, rho

def run_permutation_null(candidates, log_returns, log_prices, n_perms=200):
    """
    Run permutation null test by shuffling returns of Leg B, reconstructing synthetic price path,
    and running Engle-Granger coint. Returns pass rate at p < 0.05.
    """
    if not candidates:
        return 0.0
        
    np.random.seed(42)
    sample_size = min(n_perms, len(candidates))
    sample_indices = np.random.choice(len(candidates), size=sample_size, replace=False)
    
    null_p_vals = []
    for idx in sample_indices:
        c1, c2 = candidates[idx][0], candidates[idx][1]
        y = log_prices[c1]
        r2 = log_returns[c2].copy()
        
        # Shuffle returns of leg B
        np.random.shuffle(r2)
        p2_synth = log_prices[c2][0] + np.concatenate([[0], np.cumsum(r2)])
        
        try:
            _, p_val, _ = coint(y, p2_synth)
            null_p_vals.append(p_val)
        except Exception:
            null_p_vals.append(1.0)
            
    null_p_vals = np.array(null_p_vals)
    null_pass_rate = float(np.mean(null_p_vals < 0.05)) if len(null_p_vals) > 0 else 0.0
    return null_pass_rate

def run_screener():
    print("=" * 80)
    print("STARTING WALK-FORWARD PAIR SELECTION SCREENER")
    print("=" * 80)
    
    master_df = load_master_dataframe()
    total_bars = len(master_df)
    print(f"Loaded master price matrix: {master_df.shape[0]} bars x {master_df.shape[1] - 2} coins")
    print(f"Sample span: {master_df['dt'].iloc[0].strftime('%Y-%m-%d %H:%M')} to {master_df['dt'].iloc[-1].strftime('%Y-%m-%d %H:%M')} UTC")
    
    tradable_coins = [c for c in master_df.columns if c not in ["timestamp", "dt", "BTC", "ETH"]]
    print(f"Tradable universe candidate pool: {len(tradable_coins)} coins (excluding BTC & ETH benchmarks)")
    
    rebalance_indices = list(range(FORMATION_BARS, total_bars, REBALANCE_BARS))
    print(f"Total rebalance periods: {len(rebalance_indices)} (90d formation window, 30d rebalance cadence)\n")
    
    persistence_tracker = {}  # canonical_pair -> consecutive_passes
    selection_history = {}    # canonical_pair -> list of rebalance dates selected
    
    funnel_stats_records = []
    selected_pairs_records = []
    
    for r_idx, reb_bar in enumerate(rebalance_indices):
        reb_dt_str = master_df["dt"].iloc[reb_bar].strftime("%Y-%m-%d %H:%M")
        form_start = reb_bar - FORMATION_BARS
        form_df = master_df.iloc[form_start:reb_bar]
        
        # 1. Filter coins with full data in formation window
        valid_coins = [
            c for c in tradable_coins
            if form_df[c].notna().sum() == FORMATION_BARS and (form_df[c] > 0).all()
        ]
        n_univ = len(valid_coins)
        all_pairs = list(itertools.combinations(valid_coins, 2))
        n_pairs = len(all_pairs)
        
        # Compute 4h log returns & log prices
        log_prices = {c: np.log(form_df[c].values) for c in valid_coins}
        log_returns = {c: np.diff(log_prices[c]) for c in valid_coins}
        btc_log_ret = np.diff(np.log(form_df["BTC"].values))
        var_btc = np.var(btc_log_ret)
        
        # BTC Betas for all valid coins
        betas = {}
        for c in valid_coins:
            betas[c] = float(np.cov(log_returns[c], btc_log_ret)[0, 1] / var_btc) if var_btc > 1e-12 else 1.0
            
        # STEP A: Correlation >= 0.6
        pass_corr = []
        for c1, c2 in all_pairs:
            r1, r2 = log_returns[c1], log_returns[c2]
            std1, std2 = np.std(r1), np.std(r2)
            if std1 > 1e-8 and std2 > 1e-8:
                corr = float(np.corrcoef(r1, r2)[0, 1])
                if corr >= 0.6:
                    pass_corr.append((c1, c2, corr))
                    
        # Permutation Null & FDR estimate
        null_pass_rate = run_permutation_null(pass_corr, log_returns, log_prices, n_perms=PERMUTATION_RUNS)
        
        # STEP B: Engle-Granger Cointegration & Hedge Ratio bounds
        pass_eg = []
        for c1, c2, corr in pass_corr:
            y1, y2 = log_prices[c1], log_prices[c2]
            try:
                t1, p1, _ = coint(y1, y2)
                t2, p2, _ = coint(y2, y1)
            except Exception:
                continue
                
            if p1 <= p2:
                dep, indep, p_val = c1, c2, float(p1)
            else:
                dep, indep, p_val = c2, c1, float(p2)
                
            if p_val < 0.05:
                alpha, gamma = fit_ols(log_prices[dep], log_prices[indep])
                if 0.3 <= gamma <= 3.0:
                    pass_eg.append({
                        "dep": dep,
                        "indep": indep,
                        "p_val": p_val,
                        "alpha": alpha,
                        "gamma": gamma,
                        "corr": corr
                    })
                    
        # STEP C: Half-Life Filter (1d <= HL <= 10d)
        pass_hl = []
        for item in pass_eg:
            dep, indep = item["dep"], item["indep"]
            alpha, gamma = item["alpha"], item["gamma"]
            res = log_prices[dep] - (alpha + gamma * log_prices[indep])
            hl_days, rho = calc_half_life(res)
            if 1.0 <= hl_days <= 10.0:
                item_hl = dict(item)
                item_hl["hl_days"] = hl_days
                item_hl["rho"] = rho
                pass_hl.append(item_hl)
                
        # STEP D: Hedge-Ratio Stability (relative change < 30% between halves)
        pass_stab = []
        half_len = FORMATION_BARS // 2
        for item in pass_hl:
            dep, indep = item["dep"], item["indep"]
            y_h1, x_h1 = log_prices[dep][:half_len], log_prices[indep][:half_len]
            y_h2, x_h2 = log_prices[dep][half_len:], log_prices[indep][half_len:]
            _, g1 = fit_ols(y_h1, x_h1)
            _, g2 = fit_ols(y_h2, x_h2)
            if g1 > 0 and g2 > 0:
                rel_change = abs(g2 - g1) / max(abs(g1), 1e-5)
                if rel_change < 0.30:
                    item_stab = dict(item)
                    item_stab["gamma_h1"] = g1
                    item_stab["gamma_h2"] = g2
                    item_stab["rel_change"] = rel_change
                    pass_stab.append(item_stab)
                    
        # STEP E: Persistence Filter (passed A-D >= 2 consecutive periods)
        passed_canon_keys = set()
        for item in pass_stab:
            canon_key = tuple(sorted([item["dep"], item["indep"]]))
            passed_canon_keys.add(canon_key)
            
        # Update persistence tracker
        for k in list(persistence_tracker.keys()):
            if k in passed_canon_keys:
                persistence_tracker[k] += 1
            else:
                persistence_tracker[k] = 0
        for k in passed_canon_keys:
            if k not in persistence_tracker:
                persistence_tracker[k] = 1
                
        pass_pers = []
        for item in pass_stab:
            canon_key = tuple(sorted([item["dep"], item["indep"]]))
            p_count = persistence_tracker[canon_key]
            if p_count >= 2:
                beta_A = betas[item["dep"]]
                beta_B = betas[item["indep"]]
                beta_ratio = float(beta_A / max(beta_B, 1e-5)) if beta_B > 0 else 1.0
                item_pers = dict(item)
                item_pers["beta_ratio"] = beta_ratio
                item_pers["persistence_count"] = p_count
                pass_pers.append(item_pers)
                
        # Rank by lowest EG p-value then shortest half-life
        pass_pers.sort(key=lambda x: (x["p_val"], x["hl_days"]))
        selected = pass_pers[:MAX_SELECTED_PAIRS]
        
        # Record selected pairs
        for s in selected:
            canon_key = tuple(sorted([s["dep"], s["indep"]]))
            if canon_key not in selection_history:
                selection_history[canon_key] = []
            selection_history[canon_key].append(reb_dt_str)
            
            selected_pairs_records.append({
                "rebalance_idx": r_idx + 1,
                "rebalance_date": reb_dt_str,
                "pairA": s["dep"],
                "pairB": s["indep"],
                "gamma": round(s["gamma"], 4),
                "alpha": round(s["alpha"], 4),
                "p_value": round(s["p_val"], 6),
                "half_life_days": round(s["hl_days"], 2),
                "beta_ratio": round(s["beta_ratio"], 4),
                "correlation": round(s["corr"], 4),
                "persistence_count": s["persistence_count"]
            })
            
        funnel_stats_records.append({
            "rebalance_idx": r_idx + 1,
            "rebalance_date": reb_dt_str,
            "universe_size": n_univ,
            "n_pairs": n_pairs,
            "n_pass_corr": len(pass_corr),
            "n_pass_eg": len(pass_eg),
            "n_pass_hl": len(pass_hl),
            "n_pass_stability": len(pass_stab),
            "n_persistent": len(pass_pers),
            "permutation_null_pass_rate": round(null_pass_rate, 4),
            "n_selected": len(selected)
        })
        
        print(f"[{r_idx+1:02d}/16] {reb_dt_str} | Univ: {n_univ:2d} | Pairs: {n_pairs:4d} | Corr: {len(pass_corr):3d} | EG: {len(pass_eg):2d} | HL: {len(pass_hl):2d} | Stab: {len(pass_stab):2d} | Persist: {len(pass_pers):2d} | Sel: {len(selected):2d} (Null Pass: {null_pass_rate*100:.1f}%)")
        for s in selected:
            print(f"      -> {s['dep']}/{s['indep']} | gamma={s['gamma']:.3f} | p={s['p_val']:.4f} | HL={s['hl_days']:.1f}d | BetaRatio={s['beta_ratio']:.3f} | Persist={s['persistence_count']}")

    # Save Funnel Stats
    df_funnel = pd.DataFrame(funnel_stats_records)
    funnel_path = os.path.join(OUT_DIR, "funnel_stats.csv")
    df_funnel.to_csv(funnel_path, index=False)
    print(f"\nSaved Funnel Stats -> {funnel_path}")
    
    # Save Selected Pairs
    df_selected = pd.DataFrame(selected_pairs_records)
    selected_path = os.path.join(OUT_DIR, "selected_pairs.csv")
    df_selected.to_csv(selected_path, index=False)
    print(f"Saved Selected Pairs ({len(df_selected)} rows) -> {selected_path}")
    
    # Compute Pair Survival / Lifetime Distribution
    pair_survival_records = []
    for (c1, c2), dates in selection_history.items():
        total_selected = len(dates)
        first_date = dates[0]
        last_date = dates[-1]
        pair_survival_records.append({
            "pair": f"{c1}/{c2}",
            "legA": c1,
            "legB": c2,
            "total_periods_selected": total_selected,
            "first_selected_date": first_date,
            "last_selected_date": last_date,
            "selected_dates": "; ".join(dates)
        })
        
    df_survival = pd.DataFrame(pair_survival_records).sort_values(by="total_periods_selected", ascending=False)
    survival_path = os.path.join(OUT_DIR, "pair_survival.csv")
    df_survival.to_csv(survival_path, index=False)
    print(f"Saved Pair Survival Stats ({len(df_survival)} distinct pairs) -> {survival_path}")
    
    print("\nSummary of Funnel Averages across 16 Rebalances:")
    print(f"  Avg Universe Size:     {df_funnel['universe_size'].mean():.1f} coins")
    print(f"  Avg Pair Combinations: {df_funnel['n_pairs'].mean():.1f} pairs")
    print(f"  Avg Pass Corr >= 0.6:  {df_funnel['n_pass_corr'].mean():.1f} ({df_funnel['n_pass_corr'].mean()/df_funnel['n_pairs'].mean()*100:.2f}%)")
    print(f"  Avg Pass EG (p<0.05):  {df_funnel['n_pass_eg'].mean():.1f} ({df_funnel['n_pass_eg'].mean()/df_funnel['n_pairs'].mean()*100:.2f}%)")
    print(f"  Avg Pass HL (1-10d):   {df_funnel['n_pass_hl'].mean():.1f}")
    print(f"  Avg Pass Stability:    {df_funnel['n_pass_stability'].mean():.1f}")
    print(f"  Avg Pass Persistence:  {df_funnel['n_persistent'].mean():.1f}")
    print(f"  Avg Selected:          {df_funnel['n_selected'].mean():.1f}")
    print(f"  Avg Permutation Null:  {df_funnel['permutation_null_pass_rate'].mean()*100:.2f}%")
    print("=" * 80)
    
    return df_funnel, df_selected, df_survival

if __name__ == "__main__":
    run_screener()
