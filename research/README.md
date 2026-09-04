# Quantitative Research Suite

This directory contains empirical research, statistical tests, and strategy validation scripts for the **Bee Crypto Worker** multi-pair market-neutral trading bot.

---

## Directory Structure

```
research/
├── README.md                          # This file — quickstart for all research scripts
├── data/                              # Cached historical data (Binance USDT-M Futures; git-ignored — regenerate via download_data.py)
│   ├── 4h_*.csv                       # 4h OHLCV (cointegration study)
│   ├── 1m_*.parquet                   # 1m OHLCV (backtest engine)
│   └── funding_*.csv                  # Funding rate history (backtest)
├── cointegration/                     # Cointegration, stationarity, EMA10 signal audit
│   ├── download_data.py
│   ├── cointegration_analysis.py
│   ├── results_summary.csv
│   ├── rolling_eg.csv
│   └── RESULTS.md
└── backtest/                          # 1m simulation: Scenario A/C, grid, robustness
    ├── download_data.py
    ├── backtest.py
    ├── out/                           # CSV outputs (summary, grid, trades, equity)
    └── RESULTS.md
```

---

## Installation

Python 3.11+ with:

```bash
python -m pip install numpy pandas scipy statsmodels pyarrow ccxt
```

---

## Cointegration & Signal Audit

Fetches 18 months of 4h OHLCV and tests Engle-Granger, Johansen, ADF, Hurst, rolling hedge ratios, and EMA10 forward-return predictive power.

```powershell
$env:PYTHONIOENCODING="utf-8"
python research/cointegration/download_data.py
python research/cointegration/cointegration_analysis.py
```

Outputs: `research/cointegration/results_summary.csv`, `rolling_eg.csv`, **`RESULTS.md`**.

---

## Honest 1-Minute Backtest

Downloads 1m OHLCV and funding rates, then runs Scenario A (live logic), A0, B, C (taker/maker), parameter grid D, and robustness checks (barrier conventions, ex-ZEC, OOS, sensitivity).

### 1. Download 1m data

In-sample (2026-03-01 .. 2026-09-04) and OOS warm-up window (2025-08-20 .. 2026-03-01):

```powershell
$env:PYTHONIOENCODING="utf-8"
python research/backtest/download_data.py
```

Cached files land in `research/data/` as `1m_{COIN}.parquet` and `funding_{COIN}.csv` (OOS uses `_oos` suffix where applicable).

### 2. Run backtest engine

```powershell
$env:PYTHONIOENCODING="utf-8"
python research/backtest/backtest.py
```

Outputs: `research/backtest/out/summary.csv`, `grid_D.csv`, `per_pair_breakdown.csv`, trade/equity CSVs per scenario. Full narrative: **`research/backtest/RESULTS.md`**.

---

## Documentation Cross-References

| Document | Role |
| :--- | :--- |
| [`doc/02_STRATEGY_AND_BACKTESTS.md`](../doc/02_STRATEGY_AND_BACKTESTS.md) | User-facing strategy doc; sections 4–6 summarize honest backtest and paper-trading config |
| [`doc/04_WORKER_ENGINE_SPECIFICATION.md`](../doc/04_WORKER_ENGINE_SPECIFICATION.md) | Worker env vars (`RISK_MODE`, `TP_DISABLED`, execution modes) |
| [`worker/src/scripts/seed-6m-history.ts`](../worker/src/scripts/seed-6m-history.ts) | **Synthetic** dashboard seed data — not a backtest |
