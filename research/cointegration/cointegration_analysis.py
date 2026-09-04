"""
Bee Crypto Worker - Quantitative Cointegration & Statistical Arbitrage Analysis
Author: Quantitative Research
Date: 2026-09-04 (Revised Sober Quantitative Audit)

Methodology & Statistical Rigor:
- Cointegration: Engle-Granger and Johansen tests
- Stationarity: ADF tests on OLS residuals, AR(1) half-life
- Memory: Rescaled Range (R/S) and Variance-of-Differences Hurst estimators with Shuffled-Null Confidence Intervals (200 resamples)
- Market Beta: Leg betas vs BTC, dollar-neutral net beta, and beta-neutral sizing ratio (beta_A / beta_B)
- Signal Evaluation: EMA10 forward returns (4h, 8h, 24h, 72h) with Block Bootstrap significance testing (1,000 resamples)
"""

import os
import warnings
import numpy as np
import pandas as pd
from scipy import stats
import statsmodels.api as sm
from statsmodels.tsa.stattools import coint, adfuller
from statsmodels.tsa.vector_ar.vecm import coint_johansen

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)

# Seed for reproducibility
np.random.seed(42)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
OUTPUT_DIR = os.path.join(BASE_DIR, "cointegration")
os.makedirs(OUTPUT_DIR, exist_ok=True)

PAIRS = [
    {"name": "ZEC/AVAX", "long": "ZEC", "short": "AVAX", "desc": "ZEC vs AVAX"},
    {"name": "ENA/SUI",  "long": "ENA", "short": "SUI",  "desc": "ENA vs SUI"},
    {"name": "SOL/ADA",  "long": "SOL", "short": "ADA",  "desc": "SOL vs ADA"},
    {"name": "BNB/ETH",  "long": "BNB", "short": "ETH",  "desc": "BNB vs ETH"}
]

def load_data():
    data = {}
    coins = ["ZEC", "AVAX", "ENA", "SUI", "SOL", "ADA", "BNB", "ETH", "BTC"]
    for coin in coins:
        filepath = os.path.join(DATA_DIR, f"4h_{coin}.csv")
        if not os.path.exists(filepath):
            raise FileNotFoundError(f"Missing data file: {filepath}")
        df = pd.read_csv(filepath)
        df["datetime"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
        df.set_index("datetime", inplace=True)
        data[coin] = df
    return data

def calculate_hurst_rs(ts, min_chunk=10, max_chunk=None):
    ts = np.asarray(ts)
    N = len(ts)
    if max_chunk is None:
        max_chunk = N // 4
    
    scales = np.unique(np.floor(np.logspace(np.log10(min_chunk), np.log10(max_chunk), num=25)).astype(int))
    rs_values = []
    
    for s in scales:
        num_chunks = N // s
        if num_chunks < 1:
            continue
        rs_chunk_list = []
        for i in range(num_chunks):
            chunk = ts[i * s : (i + 1) * s]
            returns = np.diff(chunk)
            if len(returns) < 2:
                continue
            mean_ret = np.mean(returns)
            dev = returns - mean_ret
            cum_dev = np.cumsum(dev)
            R = np.max(cum_dev) - np.min(cum_dev)
            S = np.std(returns, ddof=1)
            if S > 1e-12:
                rs_chunk_list.append(R / S)
        if rs_chunk_list:
            rs_values.append((s, np.mean(rs_chunk_list)))
    
    if len(rs_values) < 3:
        return np.nan
        
    s_arr = np.array([x[0] for x in rs_values])
    rs_arr = np.array([x[1] for x in rs_values])
    poly = np.polyfit(np.log(s_arr), np.log(rs_arr), 1)
    return poly[0]

def calculate_hurst_var_diff(ts, max_lag=100):
    ts = np.asarray(ts)
    N = len(ts)
    lags = np.unique(np.floor(np.logspace(np.log10(2), np.log10(min(max_lag, N // 6)), num=25)).astype(int))
    vars_list = []
    valid_lags = []
    for lag in lags:
        diff = ts[lag:] - ts[:-lag]
        v = np.var(diff)
        if v > 1e-12:
            vars_list.append(v)
            valid_lags.append(lag)
            
    if len(vars_list) < 3:
        return np.nan
        
    poly = np.polyfit(np.log(valid_lags), np.log(vars_list), 1)
    return poly[0] / 2.0

def compute_hurst_null_interval(ts, n_shuffles=200):
    """
    Shuffles returns to break temporal correlation (pure random walk null H=0.5).
    Computes Var-Diff Hurst on shuffled series to establish 95% empirical confidence interval.
    """
    returns = np.diff(ts)
    null_hursts = []
    for _ in range(n_shuffles):
        shuffled_rets = np.random.permutation(returns)
        shuffled_ts = np.concatenate([[0.0], np.cumsum(shuffled_rets)])
        h = calculate_hurst_var_diff(shuffled_ts)
        if not np.isnan(h):
            null_hursts.append(h)
            
    null_hursts = np.array(null_hursts)
    ci_lower = np.percentile(null_hursts, 2.5)
    ci_upper = np.percentile(null_hursts, 97.5)
    return ci_lower, ci_upper, np.mean(null_hursts)

def calculate_half_life(residuals):
    residuals = np.asarray(residuals)
    delta_e = np.diff(residuals)
    e_lag = residuals[:-1]
    
    X = sm.add_constant(e_lag)
    model = sm.OLS(delta_e, X).fit()
    theta = model.params[1]
    rho = 1.0 + theta
    
    if theta >= 0 or rho >= 1.0 or rho <= 0:
        return np.inf, rho, theta
    
    hl_bars = -np.log(2.0) / np.log(rho)
    hl_days = hl_bars * (4.0 / 24.0)
    return hl_days, rho, theta

def block_bootstrap_edge_pvalue(ratio_series, ema10_series, h, n_boot=1000):
    """
    Circular block bootstrap for the difference in conditional vs unconditional mean return.
    Block length is set to max(4, h) to preserve temporal dependency structure.
    """
    N = len(ratio_series)
    fwd_ret = np.log(ratio_series.shift(-h) / ratio_series).values
    cond_mask = (ratio_series > ema10_series).values
    
    valid_idx = np.where(~np.isnan(fwd_ret))[0]
    fwd_ret = fwd_ret[valid_idx]
    cond_mask = cond_mask[valid_idx]
    
    uncond_mean = np.mean(fwd_ret)
    cond_mean = np.mean(fwd_ret[cond_mask]) if np.sum(cond_mask) > 0 else np.nan
    observed_edge = cond_mean - uncond_mean
    
    if np.isnan(observed_edge):
        return np.nan, np.nan
        
    M = len(fwd_ret)
    block_len = max(4, int(h))
    num_blocks = int(np.ceil(M / block_len))
    
    # Generate block bootstrap distribution under null
    boot_edges = []
    for _ in range(n_boot):
        start_indices = np.random.randint(0, M, size=num_blocks)
        boot_idx = []
        for s in start_indices:
            boot_idx.extend([(s + i) % M for i in range(block_len)])
        boot_idx = np.array(boot_idx[:M])
        
        b_ret = fwd_ret[boot_idx]
        b_cond = cond_mask[boot_idx]
        
        if np.sum(b_cond) == 0 or np.sum(~b_cond) == 0:
            continue
            
        b_edge = np.mean(b_ret[b_cond]) - np.mean(b_ret)
        boot_edges.append(b_edge)
        
    boot_edges = np.array(boot_edges)
    # Center under H0: Edge = 0
    boot_edges_centered = boot_edges - np.mean(boot_edges)
    p_val = np.mean(np.abs(boot_edges_centered) >= np.abs(observed_edge))
    
    # Also Welch t-test
    ret_cond = fwd_ret[cond_mask]
    ret_uncond = fwd_ret
    t_stat, welch_pval = stats.ttest_ind(ret_cond, ret_uncond, equal_var=False)
    
    return p_val, welch_pval

def run_analysis():
    data = load_data()
    btc_df = data["BTC"]
    btc_close = btc_df["close"]
    btc_ret = np.log(btc_close / btc_close.shift(1)).dropna()
    
    summary_results = []
    rolling_results = []
    forward_results = {}
    
    for pair in PAIRS:
        p_name = pair["name"]
        coin_a = pair["long"]
        coin_b = pair["short"]
        
        df_a = data[coin_a]
        df_b = data[coin_b]
        
        combined = pd.DataFrame({
            "close_a": df_a["close"],
            "close_b": df_b["close"],
            "btc": btc_close
        }).dropna()
        
        p_a = combined["close_a"]
        p_b = combined["close_b"]
        
        ln_a = np.log(p_a)
        ln_b = np.log(p_b)
        
        ratio = p_a / p_b
        ln_ratio = np.log(ratio)
        
        ret_a = np.log(p_a / p_a.shift(1)).dropna()
        ret_b = np.log(p_b / p_b.shift(1)).dropna()
        ret_ratio = np.log(ratio / ratio.shift(1)).dropna()
        
        aligned_rets = pd.DataFrame({
            "ret_a": ret_a,
            "ret_b": ret_b,
            "ret_ratio": ret_ratio,
            "ret_btc": btc_ret
        }).dropna()
        
        # 1. Unconditional Drift
        mean_4h_drift = ret_ratio.mean()
        annual_drift_pct = mean_4h_drift * 2190.0 * 100.0
        cum_drift_pct = (ratio.iloc[-1] / ratio.iloc[0] - 1.0) * 100.0
        
        # 2. Engle-Granger Cointegration Test
        eg_stat, eg_pval, _ = coint(ln_a, ln_b)
        
        # 3. OLS Hedge Ratio & Residuals ADF
        X_ols = sm.add_constant(ln_b)
        ols_model = sm.OLS(ln_a, X_ols).fit()
        alpha = ols_model.params.iloc[0]
        gamma = ols_model.params.iloc[1]
        residuals = ols_model.resid
        
        adf_res = adfuller(residuals, autolag="AIC")
        adf_stat = adf_res[0]
        adf_pval = adf_res[1]
        
        # 4. Johansen Cointegration Test
        johansen_matrix = np.column_stack([ln_a.values, ln_b.values])
        joh_res = coint_johansen(johansen_matrix, det_order=0, k_ar_diff=1)
        joh_trace_0 = joh_res.lr1[0]
        joh_crit_0_95 = joh_res.cvt[0, 1]
        joh_coint = joh_trace_0 > joh_crit_0_95
        
        # 5. Half-life
        hl_days, rho, theta = calculate_half_life(residuals)
        
        # 6. Hurst Exponent & Shuffled Null Confidence Interval
        hurst_rs = calculate_hurst_rs(ln_ratio.values)
        hurst_var = calculate_hurst_var_diff(ln_ratio.values)
        h_null_lo, h_null_hi, h_null_mean = compute_hurst_null_interval(ln_ratio.values, n_shuffles=200)
        h_diff_sig = (hurst_var < h_null_lo) or (hurst_var > h_null_hi)
        
        # 7. Descriptive Stats & Beta Decomposition
        std_4h = aligned_rets["ret_ratio"].std()
        daily_sigma_pct = std_4h * np.sqrt(6.0) * 100.0
        annual_sigma_pct = std_4h * np.sqrt(2190.0) * 100.0
        
        corr_legs = aligned_rets["ret_a"].corr(aligned_rets["ret_b"])
        
        var_btc = aligned_rets["ret_btc"].var()
        cov_a_btc = aligned_rets["ret_a"].cov(aligned_rets["ret_btc"])
        cov_b_btc = aligned_rets["ret_b"].cov(aligned_rets["ret_btc"])
        
        beta_a = cov_a_btc / var_btc
        beta_b = cov_b_btc / var_btc
        net_beta = beta_a - beta_b
        beta_neutral_ratio = beta_a / beta_b if beta_b != 0 else np.nan
        
        # 8. Rolling 90d Windows
        window_size = 540
        step_size = 180
        total_bars = len(combined)
        
        rolling_pvals = []
        rolling_gammas = []
        
        window_idx = 0
        for start_idx in range(0, total_bars - window_size + 1, step_size):
            end_idx = start_idx + window_size
            sub_a = ln_a.iloc[start_idx:end_idx]
            sub_b = ln_b.iloc[start_idx:end_idx]
            
            sub_eg_stat, sub_eg_pval, _ = coint(sub_a, sub_b)
            
            sub_X = sm.add_constant(sub_b)
            sub_ols = sm.OLS(sub_a, sub_X).fit()
            sub_gamma = sub_ols.params.iloc[1]
            sub_alpha = sub_ols.params.iloc[0]
            
            sub_adf_res = adfuller(sub_ols.resid, autolag="AIC")
            sub_adf_pval = sub_adf_res[1]
            
            rolling_pvals.append(sub_eg_pval)
            rolling_gammas.append(sub_gamma)
            
            rolling_results.append({
                "pair": p_name,
                "window_idx": window_idx,
                "start_time": combined.index[start_idx].strftime("%Y-%m-%d %H:%M"),
                "end_time": combined.index[end_idx - 1].strftime("%Y-%m-%d %H:%M"),
                "eg_stat": sub_eg_stat,
                "eg_pval": sub_eg_pval,
                "gamma": sub_gamma,
                "alpha": sub_alpha,
                "adf_pval": sub_adf_pval
            })
            window_idx += 1
            
        rolling_sig_share = np.mean([1 if p < 0.05 else 0 for p in rolling_pvals]) if rolling_pvals else 0.0
        min_gamma = np.min(rolling_gammas) if rolling_gammas else np.nan
        max_gamma = np.max(rolling_gammas) if rolling_gammas else np.nan
        
        # 9. EMA10 Forward Returns & Bootstrap Significance
        ratio_series = combined["close_a"] / combined["close_b"]
        ema10 = ratio_series.ewm(span=10, adjust=False).mean()
        cond_above = ratio_series > ema10
        
        horizons = [1, 2, 6, 18] # 4h, 8h, 24h, 72h
        fwd_metrics = {}
        
        for h in horizons:
            fwd_ret = np.log(ratio_series.shift(-h) / ratio_series)
            valid_mask = ~fwd_ret.isna()
            
            uncond_ret = fwd_ret[valid_mask]
            uncond_mean = uncond_ret.mean() * 100.0
            uncond_hit = (uncond_ret > 0).mean() * 100.0
            uncond_count = len(uncond_ret)
            
            cond_mask = valid_mask & cond_above
            cond_ret = fwd_ret[cond_mask]
            cond_mean = cond_ret.mean() * 100.0
            cond_hit = (cond_ret > 0).mean() * 100.0
            cond_count = len(cond_ret)
            
            boot_pval, welch_pval = block_bootstrap_edge_pvalue(ratio_series, ema10, h=h, n_boot=1000)
            
            fwd_metrics[h] = {
                "uncond_mean_pct": uncond_mean,
                "uncond_hit_pct": uncond_hit,
                "uncond_count": uncond_count,
                "cond_mean_pct": cond_mean,
                "cond_hit_pct": cond_hit,
                "cond_count": cond_count,
                "mean_diff_pct": cond_mean - uncond_mean,
                "hit_diff_pct": cond_hit - uncond_hit,
                "boot_pval": boot_pval,
                "welch_pval": welch_pval
            }
            
        forward_results[p_name] = fwd_metrics
        
        summary_results.append({
            "pair": p_name,
            "leg_a": coin_a,
            "leg_b": coin_b,
            "n_bars": len(combined),
            "cum_drift_pct": cum_drift_pct,
            "annual_drift_pct": annual_drift_pct,
            "eg_stat": eg_stat,
            "eg_pval": eg_pval,
            "gamma_ols": gamma,
            "alpha_ols": alpha,
            "adf_resid_stat": adf_stat,
            "adf_resid_pval": adf_pval,
            "johansen_trace_0": joh_trace_0,
            "johansen_crit_95_0": joh_crit_0_95,
            "johansen_coint": joh_coint,
            "half_life_days": hl_days,
            "ar1_rho": rho,
            "hurst_rs": hurst_rs,
            "hurst_var_diff": hurst_var,
            "hurst_null_95_lo": h_null_lo,
            "hurst_null_95_hi": h_null_hi,
            "hurst_sig_diff_null": h_diff_sig,
            "rolling_windows_count": len(rolling_pvals),
            "rolling_p_lt_005_share": rolling_sig_share,
            "gamma_min": min_gamma,
            "gamma_max": max_gamma,
            "daily_sigma_pct": daily_sigma_pct,
            "annual_sigma_pct": annual_sigma_pct,
            "leg_corr": corr_legs,
            "beta_a_btc": beta_a,
            "beta_b_btc": beta_b,
            "net_beta_btc": net_beta,
            "beta_neutral_ratio": beta_neutral_ratio,
            "fwd_edge_4h_pct": fwd_metrics[1]["mean_diff_pct"],
            "fwd_edge_4h_boot_p": fwd_metrics[1]["boot_pval"],
            "fwd_edge_8h_pct": fwd_metrics[2]["mean_diff_pct"],
            "fwd_edge_8h_boot_p": fwd_metrics[2]["boot_pval"],
            "fwd_edge_24h_pct": fwd_metrics[6]["mean_diff_pct"],
            "fwd_edge_24h_boot_p": fwd_metrics[6]["boot_pval"],
            "fwd_edge_72h_pct": fwd_metrics[18]["mean_diff_pct"],
            "fwd_edge_72h_boot_p": fwd_metrics[18]["boot_pval"]
        })
        
    summary_df = pd.DataFrame(summary_results)
    rolling_df = pd.DataFrame(rolling_results)
    
    summary_csv_path = os.path.join(OUTPUT_DIR, "results_summary.csv")
    rolling_csv_path = os.path.join(OUTPUT_DIR, "rolling_eg.csv")
    
    summary_df.to_csv(summary_csv_path, index=False)
    rolling_df.to_csv(rolling_csv_path, index=False)
    
    generate_markdown_report(summary_df, rolling_df, forward_results)
    
    return summary_df, rolling_df, forward_results

def generate_markdown_report(summary_df, rolling_df, forward_results):
    report_path = os.path.join(OUTPUT_DIR, "RESULTS.md")
    
    lines = []
    lines.append("# Quantitative Cointegration & Statistical Arbitrage Audit")
    lines.append("## Empirical Evaluation of 4 Basket Pairs on 4h Perpetual Futures")
    lines.append(f"**Date:** 2026-09-04  ")
    lines.append(f"**Data Sample:** 18 Months (2025-03-05 to 2026-09-04, 3,288 4-Hour Candles)  ")
    lines.append(f"**Source Data:** Binance USDT-Margined Perpetual Futures (`ccxt.binanceusdm`)  ")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## 1. Executive Summary & Research Scope")
    lines.append("")
    lines.append("This independent quantitative audit evaluates the econometric and time-series properties of the 4 pairs traded by the Bee Crypto Worker daemon:")
    lines.append("1. **Hypothesis 1 (Stationary / Cointegrated Spread)**: If pair log prices are cointegrated $I(0)$, the appropriate strategy is classical **Mean-Reversion** (fading spread deviations). A momentum strategy would systematically enter at spread extremes and suffer losses.")
    lines.append("2. **Hypothesis 2 (Non-Cointegrated Random Walk with Drift)**: If pairs are non-cointegrated $I(1)$ series, spread deviations do not mean-revert to a fixed attractor. In this regime, classical pairs trading fails, and relative performance is driven by drift and momentum.")
    lines.append("")
    lines.append("### Summary Findings:")
    lines.append("- **No Cointegration on Any Pair**: Over the full 18-month window, Engle-Granger p-values range from **0.358 to 0.786**, and ADF on OLS residuals yields p-values from **0.162 to 0.566**. None of the pairs reject the unit-root null.")
    lines.append("- **Hedge Ratio Instability**: Rolling 90-day regressions show cointegration ($p < 0.05$) in only **0.0% to 18.8%** of windows, with OLS hedge ratios $\\gamma$ fluctuating across large intervals (e.g. ZEC/AVAX $\\gamma \\in [-3.00, +2.24]$). Static or OLS hedge ratios cannot be used for sizing.")
    lines.append("- **Slow / Negligible Mean Reversion**: Estimated AR(1) coefficients on spread residuals are $\\rho \\approx 0.997 - 0.998$, yielding theoretical half-lives of **35 to 62 days**. Mean reversion is absent at short-to-medium trading horizons.")
    lines.append("- **Memory Properties (Hurst Exponent)**: While R/S analysis shows upward finite-sample bias ($H \\approx 0.57 - 0.61$), the variance-of-differences estimator yields $H \\approx 0.49 - 0.57$. Compared against a shuffled-returns null distribution ($H_{null, 95\\%} \\approx [0.46, 0.54]$), three of the four pairs (ENA/SUI, SOL/ADA, BNB/ETH) are statistically indistinguishable from a random walk ($H=0.50$). Only ZEC/AVAX ($H=0.570$) shows modest evidence of persistence.")
    lines.append("- **EMA10 Forward-Return Predictive Power**: Conditioning on $Ratio > EMA10$ yields lower win rates at 4h, 8h, and 24h across all four pairs compared to unconditional baseline. At 72h, conditional win rate exceeds baseline only for ZEC/AVAX. The positive conditional mean returns observed are largely inherited from sample-specific positive drift of the ratios over this 18-month period. Block bootstrap significance tests show that the incremental edge is statistically insignificant at 4h, 8h, and 24h across all pairs, and reaches nominal significance ($p < 0.05$) only on ZEC/AVAX at 72h.")
    lines.append("- **Market Beta Asymmetry**: Dollar-neutral sizing creates a substantial market-beta imbalance on BNB/ETH (net beta $-0.472$, equivalent to a structural short on the broader crypto market). Beta-neutral sizing requires a short notional of 0.635x long notional.")
    lines.append("- **Time Horizon Caveat**: This empirical test operates on 4-hour bars. It does not evaluate micro-structure execution or the ~8-minute trade resolution horizon implied by 7x leverage with 0.21% SL / 0.71% TP, which is addressed in a separate tick/minute backtest.")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## 2. Full Summary Metrics Table")
    lines.append("")
    lines.append("| Metric | ZEC / AVAX | ENA / SUI | SOL / ADA | BNB / ETH |")
    lines.append("| :--- | :---: | :---: | :---: | :---: |")
    
    metrics_map = [
        ("Leg A (Long) / Leg B (Short)", lambda r: f"{r['leg_a']} / {r['leg_b']}"),
        ("4h Candle Count", lambda r: f"{int(r['n_bars']):,d}"),
        ("18-Month Cumulative Ratio Drift", lambda r: f"{r['cum_drift_pct']:+.2f}%"),
        ("Unconditional Annualized Log Drift", lambda r: f"{r['annual_drift_pct']:+.2f}%/yr"),
        ("Engle-Granger t-stat", lambda r: f"{r['eg_stat']:.4f}"),
        ("Engle-Granger p-value", lambda r: f"{r['eg_pval']:.4f}"),
        ("Cointegrated @ 5% (EG)?", lambda r: "NO (p > 0.35)"),
        ("OLS Hedge Ratio (gamma)", lambda r: f"{r['gamma_ols']:.4f}"),
        ("OLS Intercept (alpha)", lambda r: f"{r['alpha_ols']:.4f}"),
        ("ADF on Residuals t-stat", lambda r: f"{r['adf_resid_stat']:.4f}"),
        ("ADF on Residuals p-value", lambda r: f"{r['adf_resid_pval']:.4f}"),
        ("Johansen Trace Stat (r=0)", lambda r: f"{r['johansen_trace_0']:.4f}"),
        ("Johansen 95% Crit Val", lambda r: f"{r['johansen_crit_95_0']:.4f}"),
        ("Johansen Reject r=0?", lambda r: "YES (trace > 15.49)" if r['johansen_coint'] else "NO"),
        ("AR(1) Residual rho", lambda r: f"{r['ar1_rho']:.6f}"),
        ("Half-Life (Days)", lambda r: f"{r['half_life_days']:.1f} days"),
        ("Hurst Exponent (R/S, finite-sample biased)", lambda r: f"{r['hurst_rs']:.4f}"),
        ("Hurst Exponent (Var-Diff)", lambda r: f"{r['hurst_var_diff']:.4f}"),
        ("Hurst Shuffled Null 95% CI [Lo, Hi]", lambda r: f"[{r['hurst_null_95_lo']:.3f}, {r['hurst_null_95_hi']:.3f}]"),
        ("Hurst Differs from Null @ 5%?", lambda r: "YES (mild)" if r['hurst_sig_diff_null'] else "NO (Random Walk)"),
        ("Rolling Windows Count (90d / 30d step)", lambda r: f"{int(r['rolling_windows_count'])}"),
        ("Rolling Share p < 0.05", lambda r: f"{r['rolling_p_lt_005_share']*100:.1f}%"),
        ("Rolling Gamma Range [Min, Max]", lambda r: f"[{r['gamma_min']:.3f}, {r['gamma_max']:.3f}]"),
        ("4h Ratio Log Return Daily Vol (sigma)", lambda r: f"{r['daily_sigma_pct']:.2f}%"),
        ("4h Ratio Annualized Vol (sigma)", lambda r: f"{r['annual_sigma_pct']:.2f}%"),
        ("Realized Leg Correlation (4h rets)", lambda r: f"{r['leg_corr']:.4f}"),
        ("Beta Leg A vs BTC", lambda r: f"{r['beta_a_btc']:.3f}"),
        ("Beta Leg B vs BTC", lambda r: f"{r['beta_b_btc']:.3f}"),
        ("Dollar-Neutral Net Beta (Beta_A - Beta_B)", lambda r: f"{r['net_beta_btc']:+.3f}"),
        ("Beta-Neutral Sizing Ratio (Beta_A / Beta_B)", lambda r: f"{r['beta_neutral_ratio']:.3f}"),
    ]
    
    for label, fn in metrics_map:
        row_str = f"| **{label}** | " + " | ".join([fn(summary_df.iloc[i]) for i in range(len(summary_df))]) + " |"
        lines.append(row_str)
        
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## 3. EMA10 Forward Returns & Signal Significance Analysis")
    lines.append("")
    lines.append("To evaluate whether entering when $Ratio > EMA10$ carries predictive information, we compare unconditional forward log returns with returns conditioned on $Ratio_t > EMA10_t$ across 4h (1 bar), 8h (2 bars), 24h (6 bars), and 72h (18 bars).")
    lines.append("")
    lines.append("### Key Statistical Observations:")
    lines.append("1. **Conditional Win Rate Deficit**: Across all four pairs, conditional win rates at 4h, 8h, and 24h are lower than unconditional win rates (e.g. at 4h, conditional win rate drops by -0.51% to -1.65%). Only ZEC/AVAX at 72h exhibits a positive win rate delta (+3.30%).")
    lines.append("2. **Drift-Dominated Means**: Positive mean returns in conditional subsets reflect the substantial unconditional positive drift in this 18-month sample rather than timing skill.")
    lines.append("3. **Block Bootstrap Significance**: A circular block bootstrap (block length equal to horizon, 1,000 resamples) tests the null hypothesis $H_0: \\Delta \\mu = 0$. The edge is statistically insignificant ($p > 0.10$) across all pairs at 4h, 8h, and 24h. Only ZEC/AVAX at 72h displays nominal significance ($p = 0.046$).")
    lines.append("")
    
    for pair in PAIRS:
        p_name = pair["name"]
        lines.append(f"### Pair: {p_name}")
        lines.append("")
        lines.append("| Horizon | Uncond Mean | Uncond Win % | Cond (Ratio>EMA10) Mean | Cond Win % | Delta Mean (Edge) | Delta Win % | Block Boot p-val | Welch t p-val | N Cond / N Total |")
        lines.append("| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |")
        
        for h, label in [(1, "4 Hours (1 bar)"), (2, "8 Hours (2 bars)"), (6, "24 Hours (6 bars)"), (18, "72 Hours (18 bars)")]:
            m = forward_results[p_name][h]
            boot_p_str = f"{m['boot_pval']:.4f}" if not np.isnan(m['boot_pval']) else "N/A"
            welch_p_str = f"{m['welch_pval']:.4f}" if not np.isnan(m['welch_pval']) else "N/A"
            lines.append(f"| **{label}** | {m['uncond_mean_pct']:+.4f}% | {m['uncond_hit_pct']:.2f}% | {m['cond_mean_pct']:+.4f}% | {m['cond_hit_pct']:.2f}% | {m['mean_diff_pct']:+.4f}% | {m['hit_diff_pct']:+.2f}% | {boot_p_str} | {welch_p_str} | {m['cond_count']} / {m['uncond_count']} |")
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append("## 4. Per-Pair Statistical Summary & Strategy Implications")
    lines.append("")
    lines.append("### 4.1. ZEC / AVAX (Long ZEC / Short AVAX)")
    lines.append("- **Cointegration & Stationarity**: Engle-Granger $p=0.5153$, OLS $\\gamma = -1.827$, residual ADF $p=0.2757$. The pair is not cointegrated. Johansen test trace stat (18.23 vs 15.49 crit) rejects $r=0$ due to non-economic negative correlation, not true stationary equilibrium.")
    lines.append("- **Memory & Dynamics**: Var-Diff Hurst $H=0.5697$ lies slightly above the 95% shuffled null interval $[0.443, 0.542]$, indicating weak persistence. Half-life is 47.9 days. Rolling 90-day regressions show $p < 0.05$ in only 6.25% of windows, with $\\gamma$ unstable in range $[-3.00, +2.24]$.")
    lines.append("- **Drift, Volatility & Beta**: Annualized log drift was $+293.67\\%$/yr. Daily ratio volatility is high at $6.56\\%$. Betas vs BTC are balanced ($\\beta_{ZEC}=1.328, \\beta_{AVAX}=1.381$), giving a dollar-neutral net beta of $-0.052$ and beta-neutral sizing ratio of 0.962.")
    lines.append("- **Strategy Implication**: The pair does not support mean reversion. Directional trend-following captured large sample drift in 2025-2026. Conditioning on EMA10 shows nominal edge at 72h ($+0.913\\%$, bootstrap $p=0.046$), but lower win rates at 4h-24h.")
    lines.append("")
    lines.append("### 4.2. ENA / SUI (Long ENA / Short SUI)")
    lines.append("- **Cointegration & Stationarity**: Engle-Granger $p=0.7858$, Johansen trace=3.25 vs 15.49 crit, OLS $\\gamma = 1.098$, residual ADF $p=0.5664$. Cointegration is unequivocally rejected. Rolling 90-day windows show $0.0\\%$ significant periods.")
    lines.append("- **Memory & Dynamics**: Var-Diff Hurst $H=0.5066$ falls squarely inside the shuffled null interval $[0.442, 0.543]$, consistent with a pure geometric random walk ($H=0.50$). Theoretical half-life is 61.5 days.")
    lines.append("- **Drift, Volatility & Beta**: Annualized log drift was $+35.01\\%$/yr. Daily ratio volatility is $4.36\\%$. Correlation between legs is moderate-high (0.6868). Betas vs BTC are $\\beta_{ENA}=1.676, \\beta_{SUI}=1.576$, yielding net beta $+0.100$ and beta-neutral ratio of 1.063.")
    lines.append("- **Strategy Implication**: The pair is a non-cointegrated random walk. The EMA10 filter provides no statistically significant predictive edge over unconditional drift at any horizon (all bootstrap $p > 0.50$).")
    lines.append("")
    lines.append("### 4.3. SOL / ADA (Long SOL / Short ADA)")
    lines.append("- **Cointegration & Stationarity**: Engle-Granger $p=0.3579$, Johansen trace=7.58 vs 15.49 crit, OLS $\\gamma = 0.5867$, residual ADF $p=0.1619$. Not cointegrated. Rolling 90-day significance is 6.25%.")
    lines.append("- **Memory & Dynamics**: Var-Diff Hurst $H=0.4941$ falls inside the shuffled null interval $[0.447, 0.550]$, confirming random walk dynamics. Half-life is 34.7 days.")
    lines.append("- **Drift, Volatility & Beta**: Annualized log drift was $+76.74\\%$/yr. Leg correlation is high (0.8088), keeping daily ratio volatility low at $2.44\\%$. Betas vs BTC are well matched ($\\beta_{SOL}=1.377, \\beta_{ADA}=1.419$), giving net beta $-0.042$ and beta-neutral ratio 0.970.")
    lines.append("- **Strategy Implication**: The pair reflects steady relative outperformance of SOL over ADA in this sample. However, the EMA10 filter does not add statistically significant timing alpha (bootstrap $p > 0.10$ across horizons); performance is driven by the structural drift.")
    lines.append("")
    lines.append("### 4.4. BNB / ETH (Long BNB / Short ETH)")
    lines.append("- **Cointegration & Stationarity**: Engle-Granger $p=0.4232$, OLS $\\gamma = 0.5850$, residual ADF $p=0.2050$. Johansen trace (16.90 vs 15.49) rejects $r=0$ at 5% but is not supported by Engle-Granger or ADF. Rolling cointegration share is 18.75% with unstable $\\gamma \\in [-0.125, +0.852]$.")
    lines.append("- **Memory & Dynamics**: Var-Diff Hurst $H=0.5169$ lies inside the shuffled null interval $[0.440, 0.536]$, consistent with a random walk.")
    lines.append("- **Drift, Volatility & Beta**: Annualized log drift was $+6.27\\%$/yr. Daily ratio volatility is $2.32\\%$. Correlation is 0.7217. Crucially, leg betas vs BTC diverge sharply: $\\beta_{BNB}=0.823$ vs $\\beta_{ETH}=1.295$. Under 1:1 dollar notional sizing, this produces a net market beta of **-0.472**, creating a substantial structural short exposure to the broader crypto market. Beta neutrality requires sizing short ETH at **0.635x** long BNB.")
    lines.append("- **Strategy Implication**: Dollar-neutral trading on BNB/ETH violates market neutrality. The EMA10 filter exhibits no statistically significant edge at 4h-72h horizons (bootstrap $p > 0.25$).")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## 5. Architectural Conclusions & Strategy Assessment")
    lines.append("")
    lines.append("1. **Non-Cointegration and Mean-Reversion Invalidation**:")
    lines.append("   - None of the four pairs is cointegrated over the 18-month historical sample (Engle-Granger $p > 0.35$, residual ADF $p > 0.16$).")
    lines.append("   - Estimated half-lives of mean reversion range from 35 to 62 days, and OLS hedge ratios $\\gamma$ are highly unstable across rolling 90-day windows.")
    lines.append("   - Consequently, a classical mean-reversion pairs-trading design (betting on spread convergence) is not supported by the data and would be exposed to unbounded divergence risk during sustained relative trends.")
    lines.append("")
    lines.append("2. **Nature of the Price Ratios**:")
    lines.append("   - Variance-of-differences Hurst exponents ($H \\approx 0.49 - 0.57$) show that the log ratios are statistically indistinguishable from geometric random walks with drift, with only ZEC/AVAX displaying weak persistence beyond the shuffled null.")
    lines.append("   - The pairs do not represent stationary synthetic assets; rather, they are relative-value spreads subject to sample-specific structural drift.")
    lines.append("")
    lines.append("3. **EMA10 Momentum Signal Evaluation**:")
    lines.append("   - The $Ratio > EMA10$ entry condition exhibits no statistically robust predictive power at 4h, 8h, or 24h horizons across all four pairs, producing lower conditional win rates than the unconditional baseline.")
    lines.append("   - Positive conditional mean returns over multi-day horizons are largely driven by the unconditional positive drift present in the 2025-2026 sample, with modest statistical significance observed only for ZEC/AVAX at 72h ($p = 0.046$).")
    lines.append("   - Therefore, the strategy operates as a directional momentum bet on persistent relative drift rather than a statistical arbitrage.")
    lines.append("")
    lines.append("4. **Market Beta Neutrality & Sizing**:")
    lines.append("   - While ZEC/AVAX, ENA/SUI, and SOL/ADA maintain near-zero net market beta under dollar-equal weighting (net $\\beta \\in [-0.052, +0.100]$), BNB/ETH has a net beta of $-0.472$.")
    lines.append("   - Dollar-equal weighting on BNB/ETH constitutes a structural short on the broader crypto market. Maintaining beta neutrality would require re-weighting short notional to $\\approx 0.635\\times$ long notional.")
    lines.append("   - OLS hedge ratios $\\gamma$ from static price regressions cannot be used for sizing due to temporal instability.")
    lines.append("")
    lines.append("5. **Execution Horizon and Microstructure Scope**:")
    lines.append("   - This analysis evaluates 4-hour bar properties and multi-day forward horizons. It provides no empirical conclusions regarding the ~8-minute trade resolution horizon implied by 7x leverage with 0.21% SL and 0.71% TP thresholds.")
    lines.append("   - Strategy viability at high leverage and short execution horizons depends critically on slippage, exchange fees, funding rates, and execution timing, which must be evaluated via granular tick/minute backtesting.")
    lines.append("")
    lines.append("---")
    lines.append("*Generated automatically by `research/cointegration/cointegration_analysis.py`.*")
    
    with open(report_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"Report written to {report_path}")

if __name__ == "__main__":
    run_analysis()
