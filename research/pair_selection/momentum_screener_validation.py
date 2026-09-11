"""
Walk-forward validation of the daily MOMENTUM pair screener vs the static baseline basket.

Context
-------
The live engine trades 4 market-neutral pairs (long A / short B on USDT-M perps):
entry only when Ratio = P_A / P_B > EMA10 on 4h closes; exits: TP +5% margin,
SL -1.5% margin at 7x leverage, or trend-flip (4h close below EMA10).

A production TypeScript job will re-select the 4-pair basket using a MOMENTUM
screener (NOT cointegration -- that was proven -34.8% OOS, see RESULTS.md).
This script replicates the production screener logic, walks it forward weekly,
and simulates BOTH the dynamic basket and the static baseline basket
[ZEC/AVAX, ENA/SUI, SOL/ADA, BNB/ETH] with the SAME simple 4h close engine.

Determinism: no randomness anywhere. Pure pandas/numpy. Run from this directory:
    python momentum_screener_validation.py

Outputs:
    - console summary table
    - research/pair_selection/MOMENTUM_VALIDATION_RESULTS.md
"""

import os
import re
import sys
import math
from datetime import datetime, timezone

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Paths & constants
# ---------------------------------------------------------------------------

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(HERE), "data")
REPORT_PATH = os.path.join(HERE, "MOMENTUM_VALIDATION_RESULTS.md")

BASELINE_BASKET = [("ZEC", "AVAX"), ("ENA", "SUI"), ("SOL", "ADA"), ("BNB", "ETH")]

FORMATION_BARS = 540        # 90 days x 6 bars/day, trailing selection window
REBALANCE_BARS = 42         # weekly rebalance (7 days x 6 bars/day)
MAX_HISTORY_BARS = int(18 * 30.4375 * 6)  # cap at ~18 months of 4h bars

LEVERAGE = 7.0
TP_MARGIN = 0.05            # +5% on slot margin
SL_MARGIN = -0.015          # -1.5% on slot margin
EMA_SPAN = 10
TAKER_FEE_PER_LEG = 0.00055 # 0.055% taker fee per leg notional per side
# Fee approximation: 2 legs on entry + 2 legs on exit = 4 leg-sides per round
# trip. Each leg notional ~= (margin * leverage) / 2, so total fee on margin
# ~= 4 * 0.055% * leverage / 2 * 2  -- we use the documented flat approximation
# 4 * fee * leverage on margin per round trip (leg notional drift ignored):
ROUND_TRIP_FEE_MARGIN = 4.0 * TAKER_FEE_PER_LEG * LEVERAGE  # = 1.54% of margin

# Screener thresholds (mirror of the production momentum job)
TSTAT_MIN = 2.0
CORR_MIN = 0.5
BETA_DIFF_MAX = 0.15
HYSTERESIS_FACTOR = 1.25
MAX_REPLACEMENTS_PER_REBALANCE = 2
BASKET_SIZE = 4

# Verdict tolerance: dynamic is declared NOT WORSE if its total return is
# within this many percentage points below the static baseline (or better).
VERDICT_TOLERANCE_PP = 1.0

BENCHMARK = "BTC"
VALID_COIN_RE = re.compile(r"^[A-Z0-9]+$")


# ---------------------------------------------------------------------------
# Data loading (same approach as screener.py: merge everything on BTC bars)
# ---------------------------------------------------------------------------

def load_master_dataframe():
    if not os.path.isdir(DATA_DIR):
        raise RuntimeError(
            f"Data directory not found: {DATA_DIR}. "
            "Run research/pair_selection/download_universe.py first."
        )
    files = [f for f in os.listdir(DATA_DIR) if f.startswith("4h_") and f.endswith(".csv")]
    if not files:
        raise RuntimeError(
            "No 4h_*.csv files found in research/data. "
            "Run research/pair_selection/download_universe.py first."
        )

    dfs = {}
    skipped = []
    for f in files:
        base = f[len("4h_"):-len(".csv")]
        # Exclude garbage/non-standard tickers (non-ASCII names, pure digits).
        if not VALID_COIN_RE.match(base) or base.isdigit():
            skipped.append(base)
            continue
        path = os.path.join(DATA_DIR, f)
        try:
            df = pd.read_csv(path)[["timestamp", "close"]].rename(columns={"close": base})
        except Exception as exc:  # unreadable file -> skip, not fatal
            skipped.append(f"{base} (read error: {exc})")
            continue
        dfs[base] = df

    if BENCHMARK not in dfs:
        raise RuntimeError("4h_BTC.csv is required for beta-neutrality checks.")

    master = dfs[BENCHMARK][["timestamp"]].copy()
    for base, df in dfs.items():
        master = pd.merge(master, df, on="timestamp", how="left")

    master["dt"] = pd.to_datetime(master["timestamp"], unit="ms", utc=True)
    master.sort_values(by="timestamp", inplace=True)
    master.reset_index(drop=True, inplace=True)

    # Cap history at ~18 months (keep the most recent bars).
    if len(master) > MAX_HISTORY_BARS:
        master = master.iloc[-MAX_HISTORY_BARS:].reset_index(drop=True)

    return master, skipped


# ---------------------------------------------------------------------------
# Momentum screener (mirror of the production job, trailing window only)
# ---------------------------------------------------------------------------

def compute_pair_tstat(rets_a, rets_b):
    """Drift t-stat of ratio log-returns r = rA - rB (sample std, ddof=1)."""
    r = rets_a - rets_b
    n = len(r)
    sd = r.std(ddof=1)
    if sd < 1e-12 or n < 2:
        return 0.0
    return float(r.mean() / (sd / math.sqrt(n)))


def screen_candidates(window_df, tradable_coins, btc_available):
    """
    Run the momentum screener on ONE trailing 90d (540-bar) window.
    Returns a list of dicts {pairA, pairB, score, ...} sorted by score desc,
    plus per-coin stats needed to score incumbents.
    """
    n_bars = len(window_df)
    valid = [
        c for c in tradable_coins
        if window_df[c].notna().sum() == n_bars and (window_df[c] > 0).all()
    ]
    if len(valid) < 2:
        return [], {}, valid

    prices = window_df[valid].to_numpy(dtype=float)          # (540, n)
    logp = np.log(prices)
    rets = np.diff(logp, axis=0)                              # (539, n)
    n_ret = rets.shape[0]
    half = n_ret // 2

    means = rets.mean(axis=0)
    means_h1 = rets[:half].mean(axis=0)
    means_h2 = rets[half:].mean(axis=0)
    cov = np.cov(rets.T, ddof=1)                              # (n, n)
    var = np.diag(cov)
    with np.errstate(invalid="ignore", divide="ignore"):
        corr = cov / np.sqrt(np.outer(var, var))

    betas = None
    if btc_available:
        btc = window_df[BENCHMARK].to_numpy(dtype=float)
        if np.isfinite(btc).all() and (btc > 0).all():
            btc_rets = np.diff(np.log(btc))
            var_btc = btc_rets.var(ddof=1)
            if var_btc > 1e-12:
                # Covariance-based betas: cov(coin, BTC) / var(BTC), ddof=1.
                centered = rets - means
                btc_c = btc_rets - btc_rets.mean()
                betas = (centered.T @ btc_c) / (n_ret - 1) / var_btc

    idx = {c: i for i, c in enumerate(valid)}
    candidates = []
    for a in range(len(valid)):
        for b in range(len(valid)):
            if a == b:
                continue
            mean_r = means[a] - means[b]
            if mean_r <= 0:
                continue  # t-stat cannot exceed +2.0 with non-positive drift
            var_r = var[a] + var[b] - 2.0 * cov[a, b]
            if var_r < 1e-14:
                continue
            tstat = mean_r / math.sqrt(var_r / n_ret)
            if tstat <= TSTAT_MIN:
                continue
            # Stability: positive ratio drift in BOTH 45d halves.
            if (means_h1[a] - means_h1[b]) <= 0 or (means_h2[a] - means_h2[b]) <= 0:
                continue
            # Legs' 4h log-return correlation >= 0.5.
            if not np.isfinite(corr[a, b]) or corr[a, b] < CORR_MIN:
                continue
            # Beta-neutrality vs BTC (skipped upstream with warning if no BTC).
            if betas is not None and abs(betas[a] - betas[b]) > BETA_DIFF_MAX:
                continue
            candidates.append({"a": a, "b": b, "score": float(tstat),
                               "corr": float(corr[a, b])})

    # In-trend filter (last closed ratio > EMA10 of the 4h ratio) applied only
    # to survivors of the cheap filters to keep this fast.
    survivors = []
    for cand in candidates:
        ratio = prices[:, cand["a"]] / prices[:, cand["b"]]
        ema = pd.Series(ratio).ewm(span=EMA_SPAN, adjust=False).mean().to_numpy()
        if ratio[-1] > ema[-1]:
            cand["pairA"] = valid[cand["a"]]
            cand["pairB"] = valid[cand["b"]]
            survivors.append(cand)

    survivors.sort(key=lambda c: (-c["score"], c["pairA"], c["pairB"]))

    stats = {
        "valid": valid,
        "idx": idx,
        "means": means,
        "var": var,
        "cov": cov,
        "n_ret": n_ret,
    }
    return survivors, stats, valid


def incumbent_score(pair, stats):
    """Recompute the raw t-stat score of an incumbent pair on the current
    window (no filters applied -- hysteresis only compares scores).
    Returns -inf when window data is missing for either leg."""
    if not stats:
        return float("-inf")
    idx = stats["idx"]
    a, b = pair
    if a not in idx or b not in idx:
        return float("-inf")
    ia, ib = idx[a], idx[b]
    mean_r = stats["means"][ia] - stats["means"][ib]
    var_r = stats["var"][ia] + stats["var"][ib] - 2.0 * stats["cov"][ia, ib]
    if var_r < 1e-14:
        return 0.0
    return float(mean_r / math.sqrt(var_r / stats["n_ret"]))


def greedy_top4(survivors):
    """Greedy top-4 by score, each coin used at most once across the basket."""
    picked = []
    used = set()
    for c in survivors:
        if len(picked) >= BASKET_SIZE:
            break
        if c["pairA"] in used or c["pairB"] in used:
            continue
        picked.append(c)
        used.add(c["pairA"])
        used.add(c["pairB"])
    return picked


def rotate_basket(incumbents, inc_scores, challengers):
    """
    Hysteresis rotation. `incumbents` is the slot-ordered list of 4 pairs.
    A challenger replaces an incumbent only if:
      challenger.score >= 1.25 * incumbent.score  (or incumbent.score <= 0 and
      challenger.score > 0), max 2 replacements, coin-uniqueness preserved.
    Challengers identical to an incumbent pair simply retain that incumbent.
    Returns (new_basket, replacements) where replacements is a list of
    (slot, old_pair, old_score, new_pair, new_score).
    """
    basket = list(incumbents)
    scores = list(inc_scores)
    locked = set()   # slots freshly filled this rebalance -> not replaceable
    replacements = []

    inc_set = set(incumbents)
    pending = [c for c in challengers if (c["pairA"], c["pairB"]) not in inc_set]

    for cand in pending:
        if len(replacements) >= MAX_REPLACEMENTS_PER_REBALANCE:
            break
        new_pair = (cand["pairA"], cand["pairB"])
        # Try to replace the weakest qualifying incumbent slot.
        order = sorted(range(len(basket)), key=lambda i: scores[i])
        target = None
        for slot in order:
            if slot in locked:
                continue
            inc_sc = scores[slot]
            if inc_sc <= 0:
                qualifies = cand["score"] > 0
            else:
                qualifies = cand["score"] >= HYSTERESIS_FACTOR * inc_sc
            if not qualifies:
                continue
            # Coin-uniqueness vs the rest of the basket.
            other_coins = set()
            for j, p in enumerate(basket):
                if j != slot:
                    other_coins.update(p)
            if new_pair[0] in other_coins or new_pair[1] in other_coins:
                continue
            target = slot
            break
        if target is not None:
            replacements.append((target, basket[target], scores[target],
                                 new_pair, cand["score"]))
            basket[target] = new_pair
            scores[target] = cand["score"]
            locked.add(target)

    return basket, replacements


# ---------------------------------------------------------------------------
# Simple 4h close trading engine (identical for both strategies)
# ---------------------------------------------------------------------------

class RatioCache:
    """Lazy per-pair ratio and EMA10 series over the full master frame."""

    def __init__(self, master):
        self.master = master
        self.cache = {}

    def get(self, pair):
        if pair not in self.cache:
            a, b = pair
            ratio = (self.master[a] / self.master[b]).to_numpy(dtype=float)
            ema = pd.Series(ratio).ewm(span=EMA_SPAN, adjust=False).mean().to_numpy()
            self.cache[pair] = (ratio, ema)
        return self.cache[pair]


def simulate(master, start_bar, basket_schedule, strategy_name, ratio_cache):
    """
    Simulate 4 slots on 4h closes from `start_bar` to the end of `master`.

    basket_schedule: dict {bar_index -> slot-ordered list of 4 pairs}.
    Slots keep managing an open position on a rotated-out pair to its natural
    exit; new entries only use the slot's currently assigned pair.

    Accounting: additive PnL in % of slot margin (no compounding).
    Portfolio equity = sum over slots of 0.25 * slot cumulative PnL%.
    """
    n = len(master)
    assigned = [None] * BASKET_SIZE               # currently assigned pair per slot
    positions = [None] * BASKET_SIZE              # {pair, entry_ratio, entry_bar}
    realized = [0.0] * BASKET_SIZE                # cumulative realized pnl % per slot
    trades = []
    equity = np.zeros(n - start_bar)

    for bar in range(start_bar, n):
        if bar in basket_schedule:
            assigned = list(basket_schedule[bar])

        just_exited = [False] * BASKET_SIZE

        for s in range(BASKET_SIZE):
            pos = positions[s]

            # --- exit management -------------------------------------------
            if pos is not None:
                ratio, ema = ratio_cache.get(pos["pair"])
                r_now, e_now = ratio[bar], ema[bar]
                if np.isfinite(r_now) and np.isfinite(e_now):
                    gross = LEVERAGE * (r_now / pos["entry_ratio"] - 1.0)
                    reason = None
                    # Close-only evaluation. SL checked first (conservative:
                    # if both barriers were crossed intrabar we assume SL).
                    if gross <= SL_MARGIN:
                        reason = "SL"
                    elif gross >= TP_MARGIN:
                        reason = "TP"
                    elif r_now < e_now:
                        reason = "trend_flip"
                    if reason is not None:
                        net = gross - ROUND_TRIP_FEE_MARGIN
                        realized[s] += net
                        trades.append({
                            "strategy": strategy_name, "slot": s,
                            "pair": f"{pos['pair'][0]}/{pos['pair'][1]}",
                            "entry_bar": pos["entry_bar"], "exit_bar": bar,
                            "entry_dt": master["dt"].iloc[pos["entry_bar"]],
                            "exit_dt": master["dt"].iloc[bar],
                            "bars_held": bar - pos["entry_bar"],
                            "gross_pct": gross * 100.0,
                            "net_pct": net * 100.0,
                            "reason": reason,
                        })
                        positions[s] = None
                        just_exited[s] = True

            # --- entry (next bar after an exit at the earliest) -------------
            if positions[s] is None and not just_exited[s] and assigned[s] is not None:
                pair = assigned[s]
                ratio, ema = ratio_cache.get(pair)
                r_now, e_now = ratio[bar], ema[bar]
                if np.isfinite(r_now) and np.isfinite(e_now) and r_now > e_now:
                    positions[s] = {"pair": pair, "entry_ratio": r_now,
                                    "entry_bar": bar}

        # --- mark-to-market equity (gross for open positions) ---------------
        eq = 0.0
        for s in range(BASKET_SIZE):
            eq += 0.25 * realized[s]
            pos = positions[s]
            if pos is not None:
                ratio, _ = ratio_cache.get(pos["pair"])
                r_now = ratio[bar]
                if np.isfinite(r_now):
                    eq += 0.25 * LEVERAGE * (r_now / pos["entry_ratio"] - 1.0)
        equity[bar - start_bar] = eq

    # Force-close remaining open positions at the last close (with fees).
    last = n - 1
    for s in range(BASKET_SIZE):
        pos = positions[s]
        if pos is None:
            continue
        ratio, _ = ratio_cache.get(pos["pair"])
        r_now = ratio[last]
        if not np.isfinite(r_now):
            # No final price -> close flat (data gap); document as limitation.
            r_now = pos["entry_ratio"]
        gross = LEVERAGE * (r_now / pos["entry_ratio"] - 1.0)
        net = gross - ROUND_TRIP_FEE_MARGIN
        realized[s] += net
        trades.append({
            "strategy": strategy_name, "slot": s,
            "pair": f"{pos['pair'][0]}/{pos['pair'][1]}",
            "entry_bar": pos["entry_bar"], "exit_bar": last,
            "entry_dt": master["dt"].iloc[pos["entry_bar"]],
            "exit_dt": master["dt"].iloc[last],
            "bars_held": last - pos["entry_bar"],
            "gross_pct": gross * 100.0, "net_pct": net * 100.0,
            "reason": "end_of_data",
        })
        positions[s] = None
    equity[-1] = sum(0.25 * realized[s] for s in range(BASKET_SIZE))

    return {
        "strategy": strategy_name,
        "trades": pd.DataFrame(trades),
        "equity": equity,
        "realized": realized,
    }


def compute_metrics(result):
    trades = result["trades"]
    equity = result["equity"]  # portfolio pnl in fraction of total margin
    total_return_pp = float(equity[-1]) * 100.0 if len(equity) else 0.0
    peak = np.maximum.accumulate(equity)
    max_dd_pp = float(np.max(peak - equity)) * 100.0 if len(equity) else 0.0

    n_trades = len(trades)
    win_rate = float((trades["net_pct"] > 0).mean()) * 100.0 if n_trades else 0.0
    avg_trade = float(trades["net_pct"].mean()) if n_trades else 0.0
    per_slot = trades.groupby("slot").size().to_dict() if n_trades else {}
    reasons = trades["reason"].value_counts().to_dict() if n_trades else {}

    return {
        "total_return_pp": total_return_pp,
        "max_dd_pp": max_dd_pp,
        "n_trades": n_trades,
        "win_rate_pct": win_rate,
        "avg_trade_pp": avg_trade,
        "per_slot_trades": per_slot,
        "exit_reasons": reasons,
    }


# ---------------------------------------------------------------------------
# Main walk-forward driver
# ---------------------------------------------------------------------------

def main():
    print("=" * 88)
    print("MOMENTUM SCREENER WALK-FORWARD VALIDATION (dynamic basket vs static baseline)")
    print("=" * 88)

    master, skipped_files = load_master_dataframe()
    n_bars = len(master)
    if n_bars <= FORMATION_BARS + REBALANCE_BARS:
        raise RuntimeError(
            f"Insufficient history: {n_bars} bars loaded, need > "
            f"{FORMATION_BARS + REBALANCE_BARS}. Re-run download_universe.py."
        )

    all_coins = [c for c in master.columns if c not in ("timestamp", "dt")]
    # BTC is the beta benchmark and excluded from the tradable universe.
    # ETH stays tradable because the static baseline shorts it (BNB/ETH).
    tradable = [c for c in all_coins if c != BENCHMARK]
    btc_available = BENCHMARK in master.columns

    span_from = master["dt"].iloc[0].strftime("%Y-%m-%d %H:%M")
    span_to = master["dt"].iloc[-1].strftime("%Y-%m-%d %H:%M")
    print(f"Loaded {n_bars} 4h bars x {len(all_coins)} coins "
          f"({span_from} -> {span_to} UTC)")
    if skipped_files:
        print(f"Skipped non-standard data files: {', '.join(skipped_files)}")
    if not btc_available:
        print("WARNING: BTC 4h data unavailable -> beta-neutrality filter SKIPPED.")

    # Verify baseline coins exist.
    missing_base = [c for p in BASELINE_BASKET for c in p if c not in master.columns]
    if missing_base:
        raise RuntimeError(
            f"Baseline coins missing from research/data: {missing_base}. "
            "Re-run download_universe.py."
        )

    rebalance_bars = list(range(FORMATION_BARS, n_bars, REBALANCE_BARS))
    print(f"Warmup: {FORMATION_BARS} bars (90d). Weekly rebalances: "
          f"{len(rebalance_bars)} (every {REBALANCE_BARS} bars).")

    # ---- walk the screener forward -----------------------------------------
    dynamic_schedule = {}
    static_schedule = {rebalance_bars[0]: list(BASELINE_BASKET)}
    rotation_log = []
    basket = list(BASELINE_BASKET)  # initial dynamic basket = static baseline

    for k, bar in enumerate(rebalance_bars):
        window = master.iloc[bar - FORMATION_BARS:bar]
        survivors, stats, valid = screen_candidates(window, tradable, btc_available)
        challengers = greedy_top4(survivors)
        inc_scores = [incumbent_score(p, stats) for p in basket]
        basket, replacements = rotate_basket(basket, inc_scores, challengers)
        dynamic_schedule[bar] = list(basket)

        dt_str = master["dt"].iloc[bar].strftime("%Y-%m-%d")
        rotation_log.append({
            "idx": k + 1,
            "date": dt_str,
            "universe": len(valid),
            "n_candidates": len(survivors),
            "basket": " | ".join(f"{a}/{b}" for a, b in basket),
            "replacements": "; ".join(
                f"{o[0]}/{o[1]} (t={osc:.2f}) -> {np_[0]}/{np_[1]} (t={nsc:.2f})"
                for _, o, osc, np_, nsc in replacements
            ) or "-",
            "n_replacements": len(replacements),
        })
        if replacements or k == 0 or k == len(rebalance_bars) - 1:
            print(f"[{k+1:02d}/{len(rebalance_bars)}] {dt_str} | univ={len(valid):2d} "
                  f"| cands={len(survivors):3d} | basket: {rotation_log[-1]['basket']}"
                  + (f" | swaps: {rotation_log[-1]['replacements']}" if replacements else ""))

    # ---- simulate both strategies ------------------------------------------
    ratio_cache = RatioCache(master)
    start_bar = rebalance_bars[0]
    res_dyn = simulate(master, start_bar, dynamic_schedule, "dynamic", ratio_cache)
    res_stat = simulate(master, start_bar, static_schedule, "static", ratio_cache)
    m_dyn = compute_metrics(res_dyn)
    m_stat = compute_metrics(res_stat)

    # ---- verdict -------------------------------------------------------------
    not_worse = m_dyn["total_return_pp"] >= m_stat["total_return_pp"] - VERDICT_TOLERANCE_PP
    verdict_line = (
        "VERDICT: dynamic momentum selection is NOT WORSE than the static baseline "
        f"(dynamic {m_dyn['total_return_pp']:+.2f}pp vs static "
        f"{m_stat['total_return_pp']:+.2f}pp, tolerance {VERDICT_TOLERANCE_PP:.1f}pp) "
        "-- gate for enabling auto-rotation in production: PASS."
        if not_worse else
        "VERDICT: dynamic momentum selection is WORSE than the static baseline "
        f"(dynamic {m_dyn['total_return_pp']:+.2f}pp vs static "
        f"{m_stat['total_return_pp']:+.2f}pp, tolerance {VERDICT_TOLERANCE_PP:.1f}pp) "
        "-- gate for enabling auto-rotation in production: FAIL."
    )

    # ---- console summary ------------------------------------------------------
    def fmt_row(name, m):
        return (f"{name:<18} | {m['total_return_pp']:>+9.2f} | {m['max_dd_pp']:>7.2f} | "
                f"{m['n_trades']:>6d} | {m['win_rate_pct']:>7.2f} | {m['avg_trade_pp']:>+8.3f}")

    print()
    print("-" * 88)
    print(f"{'Strategy':<18} | {'TotRet pp':>9} | {'MaxDD pp':>7} | {'Trades':>6} | "
          f"{'Win %':>7} | {'AvgTrd pp':>8}")
    print("-" * 88)
    print(fmt_row("Dynamic screener", m_dyn))
    print(fmt_row("Static baseline", m_stat))
    print("-" * 88)
    print(verdict_line)

    # ---- write MD report -------------------------------------------------------
    write_report(master, span_from, span_to, n_bars, all_coins, skipped_files,
                 btc_available, rebalance_bars, rotation_log,
                 res_dyn, res_stat, m_dyn, m_stat, verdict_line)
    print(f"\nReport written -> {REPORT_PATH}")


def write_report(master, span_from, span_to, n_bars, all_coins, skipped_files,
                 btc_available, rebalance_bars, rotation_log,
                 res_dyn, res_stat, m_dyn, m_stat, verdict_line):
    trade_start = master["dt"].iloc[rebalance_bars[0]].strftime("%Y-%m-%d")
    lines = []
    a = lines.append

    a("# Momentum Screener Walk-Forward Validation")
    a("## Dynamic Daily-Reselected Basket vs Static Baseline [ZEC/AVAX, ENA/SUI, SOL/ADA, BNB/ETH]")
    a(f"**Date:** {datetime.now(timezone.utc).strftime('%Y-%m-%d')}  ")
    a(f"**Generated by:** `research/pair_selection/momentum_screener_validation.py` "
      "(deterministic, pure pandas/numpy)")
    a("")
    a("---")
    a("")
    a("## 1. Methodology")
    a("")
    a("This study validates the production **momentum** pair screener (NOT the "
      "cointegration funnel, which was proven -34.8% OOS in "
      "`research/pair_selection/RESULTS.md`) before enabling automatic daily basket "
      "rotation in the live worker.")
    a("")
    a("### 1.1 Screener (replicates the production TypeScript job)")
    a("At each rebalance date, using ONLY the trailing 90 days (540 4h bars, no lookahead):")
    a("")
    a("1. For each ordered pair (A=long, B=short), A != B:")
    a("   - ratio log-returns `r_t = log(P_A,t/P_A,t-1) - log(P_B,t/P_B,t-1)`")
    a(f"   - drift t-stat `mean(r) / (std(r, ddof=1) / sqrt(N)) > {TSTAT_MIN}`")
    a("   - stability: `mean(r) > 0` in BOTH 45d halves of the window")
    a(f"   - legs' 4h log-return correlation `>= {CORR_MIN}`")
    a(f"   - beta-neutrality: `|beta_A - beta_B|` vs BTC `<= {BETA_DIFF_MAX}` "
      "(4h log-return betas over the same window)")
    a(f"   - in-trend now: last closed ratio > EMA{EMA_SPAN} of the 4h ratio "
      "(EMA span 10, `adjust=False`)")
    a("   - score = t-stat")
    a("2. Greedy top-4 by score, each coin used at most once across the basket.")
    a(f"3. Hysteresis vs the previous basket: an incumbent is replaced only if the "
      f"challenger's score >= {HYSTERESIS_FACTOR} x the incumbent's recomputed score "
      "(if the incumbent score <= 0, any positive challenger qualifies); max "
      f"{MAX_REPLACEMENTS_PER_REBALANCE} replacements per rebalance. With fewer than 4 "
      "valid candidates, incumbents keep their slots.")
    a("")
    a("**Skipped production filters (historical data unavailable):** funding-rate "
      "filter and 24h-volume filter. See Limitations.")
    a("")
    a("### 1.2 Walk-forward protocol")
    a(f"- Rebalance weekly (every {REBALANCE_BARS} 4h bars) after a "
      f"{FORMATION_BARS}-bar (90d) warmup, across up to 18 months of history.")
    a("- Initial dynamic basket = static baseline; the screener is applied from the "
      "first rebalance date onward.")
    a("- BOTH strategies are simulated with the SAME simple engine on 4h closes:")
    a(f"  - enter a slot's pair when `ratio > EMA{EMA_SPAN}` on close; 25% margin per "
      f"slot at {LEVERAGE:.0f}x leverage;")
    a("  - gross PnL% on margin = `leverage * (ratio_now / ratio_entry - 1)`;")
    a(f"  - exit at TP >= {TP_MARGIN*100:+.1f}% margin, SL <= {SL_MARGIN*100:+.1f}% "
      "margin (close-only; SL checked first as the conservative intrabar assumption), "
      "or trend-flip (close < EMA10);")
    a(f"  - taker fees {TAKER_FEE_PER_LEG*100:.3f}% per leg notional on entry and exit; "
      "4 leg-sides per round trip approximated as a flat "
      f"`4 x {TAKER_FEE_PER_LEG*100:.3f}% x {LEVERAGE:.0f}` = "
      f"**{ROUND_TRIP_FEE_MARGIN*100:.2f}% of slot margin per round trip** "
      "(leg-notional drift between entry and exit is ignored);")
    a("  - re-entry allowed at the earliest on the bar after an exit;")
    a("  - when the dynamic basket rotates a pair out, its open position is managed to "
      "its natural exit; new entries only use the currently assigned pair;")
    a("  - remaining open positions are force-closed (with fees) on the last bar;")
    a("  - PnL is accumulated additively in % of margin (no compounding); portfolio "
      "equity = sum over slots of 0.25 x slot cumulative PnL%.")
    a("")
    a("---")
    a("")
    a("## 2. Data Coverage Actually Used")
    a("")
    a(f"- **Source:** `research/data/4h_*.csv` (Binance USDT-M perpetuals, produced by "
      "`download_universe.py`).")
    a(f"- **Sample:** {n_bars} 4h bars, {span_from} to {span_to} UTC "
      "(aligned on BTC timestamps, left-joined).")
    a(f"- **Universe:** {len(all_coins)} coins loaded; {len(all_coins) - 1} tradable "
      "(BTC reserved as the beta benchmark; ETH kept tradable because the static "
      "baseline shorts it). Per-rebalance universe = coins with a full 540-bar window.")
    if skipped_files:
        a(f"- **Excluded non-standard data files:** {', '.join(skipped_files)}.")
    a(f"- **Trading starts:** {trade_start} (after warmup); "
      f"{len(rebalance_bars)} weekly rebalances.")
    if not btc_available:
        a("- **WARNING:** BTC data unavailable; the beta-neutrality filter was SKIPPED.")
    a("")
    a("---")
    a("")
    a("## 3. Results: Dynamic Screener vs Static Baseline")
    a("")
    a("| Metric | Dynamic screener | Static baseline |")
    a("| :--- | ---: | ---: |")
    a(f"| **Total return on margin** | **{m_dyn['total_return_pp']:+.2f}%** | "
      f"**{m_stat['total_return_pp']:+.2f}%** |")
    a(f"| Max drawdown of cumulative PnL | {m_dyn['max_dd_pp']:.2f}pp | "
      f"{m_stat['max_dd_pp']:.2f}pp |")
    a(f"| Closed trades | {m_dyn['n_trades']} | {m_stat['n_trades']} |")
    a(f"| Win rate | {m_dyn['win_rate_pct']:.2f}% | {m_stat['win_rate_pct']:.2f}% |")
    a(f"| Avg trade net PnL (% slot margin) | {m_dyn['avg_trade_pp']:+.3f}% | "
      f"{m_stat['avg_trade_pp']:+.3f}% |")

    def slot_str(m):
        return ", ".join(f"slot{k}: {v}" for k, v in sorted(m["per_slot_trades"].items()))

    def reason_str(m):
        return ", ".join(f"{k}: {v}" for k, v in sorted(m["exit_reasons"].items()))

    a(f"| Trades per slot | {slot_str(m_dyn)} | {slot_str(m_stat)} |")
    a(f"| Exit reasons | {reason_str(m_dyn)} | {reason_str(m_stat)} |")
    a("")
    a("Notes: returns and drawdowns are in percentage points of total allocated margin "
      "(additive accounting, no compounding). Per-trade PnL is in % of the slot's "
      "margin; each slot is 25% of the portfolio.")
    a("")

    # Per-pair attribution
    a("### 3.1 Per-pair net PnL attribution (% slot margin summed over trades)")
    a("")
    for name, res in (("Dynamic", res_dyn), ("Static", res_stat)):
        trades = res["trades"]
        if len(trades) == 0:
            a(f"**{name}:** no trades.")
            continue
        agg = trades.groupby("pair")["net_pct"].agg(["sum", "count", "mean"])
        agg = agg.sort_values("sum", ascending=False)
        a(f"**{name} strategy:**")
        a("")
        a("| Pair | Net PnL sum (%) | Trades | Avg (%) |")
        a("| :--- | ---: | ---: | ---: |")
        for pair, row in agg.iterrows():
            a(f"| {pair} | {row['sum']:+.2f} | {int(row['count'])} | {row['mean']:+.3f} |")
        a("")

    a("---")
    a("")
    a("## 4. Basket Rotation History (Dynamic Strategy)")
    a("")
    a("| # | Date | Universe | Candidates | Basket | Replacements |")
    a("| :---: | :--- | ---: | ---: | :--- | :--- |")
    for row in rotation_log:
        a(f"| {row['idx']} | {row['date']} | {row['universe']} | "
          f"{row['n_candidates']} | {row['basket']} | {row['replacements']} |")
    total_swaps = sum(r["n_replacements"] for r in rotation_log)
    a("")
    a(f"Total pair replacements across {len(rotation_log)} rebalances: "
      f"**{total_swaps}**.")
    a("")
    a("---")
    a("")
    a("## 5. Honest Limitations")
    a("")
    a("1. **No funding-rate filter and no 24h-volume filter**: the production screener "
      "applies both, but historical funding/volume snapshots for the full universe are "
      "unavailable; results may overstate the tradability of thin or expensive-to-carry "
      "pairs. Funding PnL itself is also NOT modeled.")
    a("2. **Close-only simulation**: entries, exits, TP/SL and trend-flips are "
      "evaluated on 4h closes only. Real intrabar barrier touches (and the live "
      "engine's faster risk guard) are not modeled; when both barriers could have been "
      "crossed intrabar we conservatively assume SL, but close-only evaluation still "
      "understates barrier hits in both directions.")
    a("3. **Survivorship bias of available CSVs**: the universe is the coin set "
      "downloaded by `download_universe.py` (top-volume perps as of the download date). "
      "Delisted or formerly-popular coins are missing, which flatters any selection "
      "method operating on this universe.")
    a("4. **Fee approximation**: a flat "
      f"{ROUND_TRIP_FEE_MARGIN*100:.2f}% of margin per round trip "
      "(4 leg-sides x 0.055% taker x 7x leverage) computed on entry notional; slippage "
      "and leg-notional drift are ignored.")
    a("5. **Weekly (not daily) rebalance cadence** is used here to keep the validation "
      "tractable; the production job re-selects daily, so live rotation can only be "
      "faster than modeled. Hysteresis (1.25x, max 2 swaps) limits the difference.")
    a("6. **EMA computed over the full history** in the engine vs the 540-bar window "
      "in the screener's in-trend check; span-10 EMA memory is short, so the "
      "difference is negligible.")
    a("7. **Single history, one market regime** (up to 18 months). The static "
      "baseline's PnL is known to be dominated by the historic ZEC drift "
      "(see `RESULTS.md` section 5.3); any conclusion inherits that regime dependence.")
    a("")
    a("---")
    a("")
    a("## 6. Verdict")
    a("")
    a(f"**{verdict_line}**")
    a("")

    with open(REPORT_PATH, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as exc:
        print(f"FATAL: {exc}", file=sys.stderr)
        sys.exit(1)
