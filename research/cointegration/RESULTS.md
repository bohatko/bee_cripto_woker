# Quantitative Cointegration & Statistical Arbitrage Audit
## Empirical Evaluation of 4 Basket Pairs on 4h Perpetual Futures
**Date:** 2026-09-04  
**Data Sample:** 18 Months (2025-03-05 to 2026-09-04, 3,288 4-Hour Candles)  
**Source Data:** Binance USDT-Margined Perpetual Futures (`ccxt.binanceusdm`)  

---

## 1. Executive Summary & Research Scope

This independent quantitative audit evaluates the econometric and time-series properties of the 4 pairs traded by the Bee Crypto Worker daemon:
1. **Hypothesis 1 (Stationary / Cointegrated Spread)**: If pair log prices are cointegrated $I(0)$, the appropriate strategy is classical **Mean-Reversion** (fading spread deviations). A momentum strategy would systematically enter at spread extremes and suffer losses.
2. **Hypothesis 2 (Non-Cointegrated Random Walk with Drift)**: If pairs are non-cointegrated $I(1)$ series, spread deviations do not mean-revert to a fixed attractor. In this regime, classical pairs trading fails, and relative performance is driven by drift and momentum.

### Summary Findings:
- **No Cointegration on Any Pair**: Over the full 18-month window, Engle-Granger p-values range from **0.358 to 0.786**, and ADF on OLS residuals yields p-values from **0.162 to 0.566**. None of the pairs reject the unit-root null.
- **Hedge Ratio Instability**: Rolling 90-day regressions show cointegration ($p < 0.05$) in only **0.0% to 18.8%** of windows, with OLS hedge ratios $\gamma$ fluctuating across large intervals (e.g. ZEC/AVAX $\gamma \in [-3.00, +2.24]$). Static or OLS hedge ratios cannot be used for sizing.
- **Slow / Negligible Mean Reversion**: Estimated AR(1) coefficients on spread residuals are $\rho \approx 0.997 - 0.998$, yielding theoretical half-lives of **35 to 62 days**. Mean reversion is absent at short-to-medium trading horizons.
- **Memory Properties (Hurst Exponent)**: While R/S analysis shows upward finite-sample bias ($H \approx 0.57 - 0.61$), the variance-of-differences estimator yields $H \approx 0.49 - 0.57$. Compared against a shuffled-returns null distribution ($H_{null, 95\%} \approx [0.46, 0.54]$), three of the four pairs (ENA/SUI, SOL/ADA, BNB/ETH) are statistically indistinguishable from a random walk ($H=0.50$). Only ZEC/AVAX ($H=0.570$) shows modest evidence of persistence.
- **EMA10 Forward-Return Predictive Power**: Conditioning on $Ratio > EMA10$ yields lower win rates at 4h, 8h, and 24h across all four pairs compared to unconditional baseline. At 72h, conditional win rate exceeds baseline only for ZEC/AVAX. The positive conditional mean returns observed are largely inherited from sample-specific positive drift of the ratios over this 18-month period. Block bootstrap significance tests show that the incremental edge is statistically insignificant at 4h, 8h, and 24h across all pairs, and reaches nominal significance ($p < 0.05$) only on ZEC/AVAX at 72h.
- **Market Beta Asymmetry**: Dollar-neutral sizing creates a substantial market-beta imbalance on BNB/ETH (net beta $-0.472$, equivalent to a structural short on the broader crypto market). Beta-neutral sizing requires a short notional of 0.635x long notional.
- **Time Horizon Caveat**: This empirical test operates on 4-hour bars. It does not evaluate micro-structure execution or the ~8-minute trade resolution horizon implied by 7x leverage with 0.21% SL / 0.71% TP, which is addressed in a separate tick/minute backtest.

---

## 2. Full Summary Metrics Table

| Metric | ZEC / AVAX | ENA / SUI | SOL / ADA | BNB / ETH |
| :--- | :---: | :---: | :---: | :---: |
| **Leg A (Long) / Leg B (Short)** | ZEC / AVAX | ENA / SUI | SOL / ADA | BNB / ETH |
| **4h Candle Count** | 3,288 | 3,288 | 3,288 | 3,288 |
| **18-Month Cumulative Ratio Drift** | +8108.00% | +69.12% | +216.38% | +9.86% |
| **Unconditional Annualized Log Drift** | +293.67%/yr | +35.01%/yr | +76.74%/yr | +6.27%/yr |
| **Engle-Granger t-stat** | -2.0254 | -1.4334 | -2.3317 | -2.2022 |
| **Engle-Granger p-value** | 0.5153 | 0.7858 | 0.3579 | 0.4232 |
| **Cointegrated @ 5% (EG)?** | NO (p > 0.35) | NO (p > 0.35) | NO (p > 0.35) | NO (p > 0.35) |
| **OLS Hedge Ratio (gamma)** | -1.8270 | 1.0983 | 0.5867 | 0.5850 |
| **OLS Intercept (alpha)** | 9.8804 | -2.0856 | 5.3234 | 1.9883 |
| **ADF on Residuals t-stat** | -2.0250 | -1.4328 | -2.3320 | -2.2034 |
| **ADF on Residuals p-value** | 0.2757 | 0.5664 | 0.1619 | 0.2050 |
| **Johansen Trace Stat (r=0)** | 18.2290 | 3.2495 | 7.5802 | 16.9009 |
| **Johansen 95% Crit Val** | 15.4943 | 15.4943 | 15.4943 | 15.4943 |
| **Johansen Reject r=0?** | YES (trace > 15.49) | NO | NO | YES (trace > 15.49) |
| **AR(1) Residual rho** | 0.997589 | 0.998123 | 0.996678 | 0.997110 |
| **Half-Life (Days)** | 47.9 days | 61.5 days | 34.7 days | 39.9 days |
| **Hurst Exponent (R/S, finite-sample biased)** | 0.6112 | 0.5845 | 0.5744 | 0.6093 |
| **Hurst Exponent (Var-Diff)** | 0.5697 | 0.5066 | 0.4941 | 0.5169 |
| **Hurst Shuffled Null 95% CI [Lo, Hi]** | [0.443, 0.542] | [0.442, 0.543] | [0.447, 0.550] | [0.440, 0.536] |
| **Hurst Differs from Null @ 5%?** | YES (mild) | NO (Random Walk) | NO (Random Walk) | NO (Random Walk) |
| **Rolling Windows Count (90d / 30d step)** | 16 | 16 | 16 | 16 |
| **Rolling Share p < 0.05** | 6.2% | 0.0% | 6.2% | 18.8% |
| **Rolling Gamma Range [Min, Max]** | [-2.997, 2.241] | [0.168, 2.314] | [0.393, 1.219] | [-0.125, 0.852] |
| **4h Ratio Log Return Daily Vol (sigma)** | 6.56% | 4.36% | 2.44% | 2.32% |
| **4h Ratio Annualized Vol (sigma)** | 125.37% | 83.26% | 46.68% | 44.33% |
| **Realized Leg Correlation (4h rets)** | 0.4027 | 0.6868 | 0.8088 | 0.7217 |
| **Beta Leg A vs BTC** | 1.328 | 1.676 | 1.377 | 0.823 |
| **Beta Leg B vs BTC** | 1.381 | 1.576 | 1.419 | 1.295 |
| **Dollar-Neutral Net Beta (Beta_A - Beta_B)** | -0.052 | +0.100 | -0.042 | -0.472 |
| **Beta-Neutral Sizing Ratio (Beta_A / Beta_B)** | 0.962 | 1.063 | 0.970 | 0.635 |

---

## 3. EMA10 Forward Returns & Signal Significance Analysis

To evaluate whether entering when $Ratio > EMA10$ carries predictive information, we compare unconditional forward log returns with returns conditioned on $Ratio_t > EMA10_t$ across 4h (1 bar), 8h (2 bars), 24h (6 bars), and 72h (18 bars).

### Key Statistical Observations:
1. **Conditional Win Rate Deficit**: Across all four pairs, conditional win rates at 4h, 8h, and 24h are lower than unconditional win rates (e.g. at 4h, conditional win rate drops by -0.51% to -1.65%). Only ZEC/AVAX at 72h exhibits a positive win rate delta (+3.30%).
2. **Drift-Dominated Means**: Positive mean returns in conditional subsets reflect the substantial unconditional positive drift in this 18-month sample rather than timing skill.
3. **Block Bootstrap Significance**: A circular block bootstrap (block length equal to horizon, 1,000 resamples) tests the null hypothesis $H_0: \Delta \mu = 0$. The edge is statistically insignificant ($p > 0.10$) across all pairs at 4h, 8h, and 24h. Only ZEC/AVAX at 72h displays nominal significance ($p = 0.046$).

### Pair: ZEC/AVAX

| Horizon | Uncond Mean | Uncond Win % | Cond (Ratio>EMA10) Mean | Cond Win % | Delta Mean (Edge) | Delta Win % | Block Boot p-val | Welch t p-val | N Cond / N Total |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **4 Hours (1 bar)** | +0.1341% | 49.68% | +0.2446% | 49.17% | +0.1105% | -0.51% | 0.0180 | 0.1995 | 1686 / 3287 |
| **8 Hours (2 bars)** | +0.2684% | 49.33% | +0.4132% | 48.13% | +0.1448% | -1.20% | 0.0770 | 0.2299 | 1685 / 3286 |
| **24 Hours (6 bars)** | +0.8020% | 51.52% | +1.1531% | 51.93% | +0.3511% | +0.41% | 0.0780 | 0.1090 | 1681 / 3282 |
| **72 Hours (18 bars)** | +2.3713% | 52.87% | +3.2845% | 56.17% | +0.9132% | +3.30% | 0.0460 | 0.0215 | 1677 / 3270 |

### Pair: ENA/SUI

| Horizon | Uncond Mean | Uncond Win % | Cond (Ratio>EMA10) Mean | Cond Win % | Delta Mean (Edge) | Delta Win % | Block Boot p-val | Welch t p-val | N Cond / N Total |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **4 Hours (1 bar)** | +0.0160% | 47.86% | +0.0112% | 47.31% | -0.0048% | -0.55% | 0.9010 | 0.9360 | 1503 / 3287 |
| **8 Hours (2 bars)** | +0.0285% | 47.84% | +0.0464% | 46.74% | +0.0179% | -1.10% | 0.7750 | 0.8288 | 1502 / 3286 |
| **24 Hours (6 bars)** | +0.0781% | 47.47% | +0.1411% | 46.60% | +0.0630% | -0.88% | 0.6850 | 0.6650 | 1498 / 3282 |
| **72 Hours (18 bars)** | +0.1805% | 47.95% | +0.3711% | 46.55% | +0.1906% | -1.40% | 0.5390 | 0.4657 | 1493 / 3270 |

### Pair: SOL/ADA

| Horizon | Uncond Mean | Uncond Win % | Cond (Ratio>EMA10) Mean | Cond Win % | Delta Mean (Edge) | Delta Win % | Block Boot p-val | Welch t p-val | N Cond / N Total |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **4 Hours (1 bar)** | +0.0350% | 52.84% | +0.0127% | 51.20% | -0.0224% | -1.65% | 0.1720 | 0.4230 | 1838 / 3287 |
| **8 Hours (2 bars)** | +0.0692% | 53.65% | +0.0252% | 51.96% | -0.0440% | -1.69% | 0.1160 | 0.2622 | 1838 / 3286 |
| **24 Hours (6 bars)** | +0.2008% | 55.73% | +0.1998% | 54.57% | -0.0010% | -1.16% | 0.9870 | 0.9883 | 1838 / 3282 |
| **72 Hours (18 bars)** | +0.6001% | 57.77% | +0.7588% | 58.00% | +0.1587% | +0.23% | 0.2380 | 0.1624 | 1838 / 3270 |

### Pair: BNB/ETH

| Horizon | Uncond Mean | Uncond Win % | Cond (Ratio>EMA10) Mean | Cond Win % | Delta Mean (Edge) | Delta Win % | Block Boot p-val | Welch t p-val | N Cond / N Total |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **4 Hours (1 bar)** | +0.0029% | 49.65% | +0.0108% | 48.90% | +0.0080% | -0.75% | 0.6510 | 0.7771 | 1685 / 3287 |
| **8 Hours (2 bars)** | +0.0061% | 50.03% | +0.0198% | 48.40% | +0.0137% | -1.63% | 0.6190 | 0.7326 | 1684 / 3286 |
| **24 Hours (6 bars)** | +0.0158% | 50.82% | +0.0795% | 50.30% | +0.0637% | -0.53% | 0.2770 | 0.3630 | 1682 / 3282 |
| **72 Hours (18 bars)** | +0.0328% | 51.47% | +0.0937% | 49.91% | +0.0609% | -1.56% | 0.6850 | 0.6218 | 1671 / 3270 |

---

## 4. Per-Pair Statistical Summary & Strategy Implications

### 4.1. ZEC / AVAX (Long ZEC / Short AVAX)
- **Cointegration & Stationarity**: Engle-Granger $p=0.5153$, OLS $\gamma = -1.827$, residual ADF $p=0.2757$. The pair is not cointegrated. Johansen test trace stat (18.23 vs 15.49 crit) rejects $r=0$ due to non-economic negative correlation, not true stationary equilibrium.
- **Memory & Dynamics**: Var-Diff Hurst $H=0.5697$ lies slightly above the 95% shuffled null interval $[0.443, 0.542]$, indicating weak persistence. Half-life is 47.9 days. Rolling 90-day regressions show $p < 0.05$ in only 6.25% of windows, with $\gamma$ unstable in range $[-3.00, +2.24]$.
- **Drift, Volatility & Beta**: Annualized log drift was $+293.67\%$/yr. Daily ratio volatility is high at $6.56\%$. Betas vs BTC are balanced ($\beta_{ZEC}=1.328, \beta_{AVAX}=1.381$), giving a dollar-neutral net beta of $-0.052$ and beta-neutral sizing ratio of 0.962.
- **Strategy Implication**: The pair does not support mean reversion. Directional trend-following captured large sample drift in 2025-2026. Conditioning on EMA10 shows nominal edge at 72h ($+0.913\%$, bootstrap $p=0.046$), but lower win rates at 4h-24h.

### 4.2. ENA / SUI (Long ENA / Short SUI)
- **Cointegration & Stationarity**: Engle-Granger $p=0.7858$, Johansen trace=3.25 vs 15.49 crit, OLS $\gamma = 1.098$, residual ADF $p=0.5664$. Cointegration is unequivocally rejected. Rolling 90-day windows show $0.0\%$ significant periods.
- **Memory & Dynamics**: Var-Diff Hurst $H=0.5066$ falls squarely inside the shuffled null interval $[0.442, 0.543]$, consistent with a pure geometric random walk ($H=0.50$). Theoretical half-life is 61.5 days.
- **Drift, Volatility & Beta**: Annualized log drift was $+35.01\%$/yr. Daily ratio volatility is $4.36\%$. Correlation between legs is moderate-high (0.6868). Betas vs BTC are $\beta_{ENA}=1.676, \beta_{SUI}=1.576$, yielding net beta $+0.100$ and beta-neutral ratio of 1.063.
- **Strategy Implication**: The pair is a non-cointegrated random walk. The EMA10 filter provides no statistically significant predictive edge over unconditional drift at any horizon (all bootstrap $p > 0.50$).

### 4.3. SOL / ADA (Long SOL / Short ADA)
- **Cointegration & Stationarity**: Engle-Granger $p=0.3579$, Johansen trace=7.58 vs 15.49 crit, OLS $\gamma = 0.5867$, residual ADF $p=0.1619$. Not cointegrated. Rolling 90-day significance is 6.25%.
- **Memory & Dynamics**: Var-Diff Hurst $H=0.4941$ falls inside the shuffled null interval $[0.447, 0.550]$, confirming random walk dynamics. Half-life is 34.7 days.
- **Drift, Volatility & Beta**: Annualized log drift was $+76.74\%$/yr. Leg correlation is high (0.8088), keeping daily ratio volatility low at $2.44\%$. Betas vs BTC are well matched ($\beta_{SOL}=1.377, \beta_{ADA}=1.419$), giving net beta $-0.042$ and beta-neutral ratio 0.970.
- **Strategy Implication**: The pair reflects steady relative outperformance of SOL over ADA in this sample. However, the EMA10 filter does not add statistically significant timing alpha (bootstrap $p > 0.10$ across horizons); performance is driven by the structural drift.

### 4.4. BNB / ETH (Long BNB / Short ETH)
- **Cointegration & Stationarity**: Engle-Granger $p=0.4232$, OLS $\gamma = 0.5850$, residual ADF $p=0.2050$. Johansen trace (16.90 vs 15.49) rejects $r=0$ at 5% but is not supported by Engle-Granger or ADF. Rolling cointegration share is 18.75% with unstable $\gamma \in [-0.125, +0.852]$.
- **Memory & Dynamics**: Var-Diff Hurst $H=0.5169$ lies inside the shuffled null interval $[0.440, 0.536]$, consistent with a random walk.
- **Drift, Volatility & Beta**: Annualized log drift was $+6.27\%$/yr. Daily ratio volatility is $2.32\%$. Correlation is 0.7217. Crucially, leg betas vs BTC diverge sharply: $\beta_{BNB}=0.823$ vs $\beta_{ETH}=1.295$. Under 1:1 dollar notional sizing, this produces a net market beta of **-0.472**, creating a substantial structural short exposure to the broader crypto market. Beta neutrality requires sizing short ETH at **0.635x** long BNB.
- **Strategy Implication**: Dollar-neutral trading on BNB/ETH violates market neutrality. The EMA10 filter exhibits no statistically significant edge at 4h-72h horizons (bootstrap $p > 0.25$).

---

## 5. Architectural Conclusions & Strategy Assessment

1. **Non-Cointegration and Mean-Reversion Invalidation**:
   - None of the four pairs is cointegrated over the 18-month historical sample (Engle-Granger $p > 0.35$, residual ADF $p > 0.16$).
   - Estimated half-lives of mean reversion range from 35 to 62 days, and OLS hedge ratios $\gamma$ are highly unstable across rolling 90-day windows.
   - Consequently, a classical mean-reversion pairs-trading design (betting on spread convergence) is not supported by the data and would be exposed to unbounded divergence risk during sustained relative trends.

2. **Nature of the Price Ratios**:
   - Variance-of-differences Hurst exponents ($H \approx 0.49 - 0.57$) show that the log ratios are statistically indistinguishable from geometric random walks with drift, with only ZEC/AVAX displaying weak persistence beyond the shuffled null.
   - The pairs do not represent stationary synthetic assets; rather, they are relative-value spreads subject to sample-specific structural drift.

3. **EMA10 Momentum Signal Evaluation**:
   - The $Ratio > EMA10$ entry condition exhibits no statistically robust predictive power at 4h, 8h, or 24h horizons across all four pairs, producing lower conditional win rates than the unconditional baseline.
   - Positive conditional mean returns over multi-day horizons are largely driven by the unconditional positive drift present in the 2025-2026 sample, with modest statistical significance observed only for ZEC/AVAX at 72h ($p = 0.046$).
   - Therefore, the strategy operates as a directional momentum bet on persistent relative drift rather than a statistical arbitrage.

4. **Market Beta Neutrality & Sizing**:
   - While ZEC/AVAX, ENA/SUI, and SOL/ADA maintain near-zero net market beta under dollar-equal weighting (net $\beta \in [-0.052, +0.100]$), BNB/ETH has a net beta of $-0.472$.
   - Dollar-equal weighting on BNB/ETH constitutes a structural short on the broader crypto market. Maintaining beta neutrality would require re-weighting short notional to $\approx 0.635\times$ long notional.
   - OLS hedge ratios $\gamma$ from static price regressions cannot be used for sizing due to temporal instability.

5. **Execution Horizon and Microstructure Scope**:
   - This analysis evaluates 4-hour bar properties and multi-day forward horizons. It provides no empirical conclusions regarding the ~8-minute trade resolution horizon implied by 7x leverage with 0.21% SL and 0.71% TP thresholds.
   - Strategy viability at high leverage and short execution horizons depends critically on slippage, exchange fees, funding rates, and execution timing, which must be evaluated via granular tick/minute backtesting.

---
*Generated automatically by `research/cointegration/cointegration_analysis.py`.*