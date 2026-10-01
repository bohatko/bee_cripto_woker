"""Neutral geometric futures-grid simulation on Bybit CLUSDT (WTI crude) 15m candles.

Usage: python simulate.py
Fetches ~90 days of 15m candles, then rolls a grid started every 12h and held for HOLD_DAYS.
The range is expressed relative to the launch price (the worker re-centers on launch anyway).
"""
import json
import math
from bisect import bisect_left, bisect_right
import time
import urllib.request

SYMBOL = "CLUSDT"
LEVERAGE = 2.0
FEE = 0.0002  # maker fee per side
HOLD_DAYS = 14
START_EVERY_H = 24


def fetch(interval="15", days=75):
    out = {}
    end = int(time.time() * 1000)
    need = days * 24 * 60 // int(interval)
    while len(out) < need:
        url = (
            "https://api.bybit.com/v5/market/kline?category=linear"
            f"&symbol={SYMBOL}&interval={interval}&limit=1000&end={end}"
        )
        rows = json.load(urllib.request.urlopen(url))["result"]["list"]
        if not rows:
            break
        for r in rows:
            out[int(r[0])] = tuple(float(x) for x in r[1:5])
        end = min(int(r[0]) for r in rows) - 1
    return [out[k] for k in sorted(out)]


def run_grid(candles, lo, hi, n, stop, tp, margin=1.0):
    ratio = (hi / lo) ** (1.0 / n)
    lv = [lo * ratio**i for i in range(n + 1)]
    per_cell = margin * LEVERAGE / n
    price0 = candles[0][0]
    hold = [lv[k] > price0 for k in range(n)]
    realized = 0.0
    fills = 0
    exit_reason = "time"
    last = price0

    def unreal(p):
        return sum(per_cell / lv[k] * (p - lv[k]) for k in range(n) if hold[k])

    min_eq = 0.0
    for o, h, l, c in candles:
        path = [o, l, h, c] if c >= o else [o, h, l, c]
        for target in path:
            p = last
            if target < p:
                a = bisect_left(lv, target)
                b = min(bisect_left(lv, p), n)
                for k in range(a, b):
                    if not hold[k]:
                        hold[k] = True
                        realized -= per_cell * FEE
            elif target > p:
                a = max(bisect_right(lv, p) - 1, 0)
                b = min(bisect_right(lv, target) - 1, n)
                for k in range(a, b):
                    if hold[k]:
                        hold[k] = False
                        realized += per_cell * (lv[k + 1] - lv[k]) / lv[k] - per_cell * FEE
                        fills += 1
            last = target
            if last <= stop:
                return realized + unreal(stop), fills, "stop", min_eq
            if last >= tp:
                return realized + unreal(tp), fills, "tp", min_eq
        min_eq = min(min_eq, realized + unreal(last))
    return realized + unreal(last), fills, exit_reason, min_eq


def main():
    candles = fetch()
    per_day = 96
    print(f"candles={len(candles)} days={len(candles)/per_day:.1f}")
    hold_len = HOLD_DAYS * per_day
    starts = range(0, len(candles) - hold_len, START_EVERY_H * 4)

    print("down%  up%  step%  cells  meanRet%  median%  worst%  best%  stop%  fills/14d  maxDD%")
    results = []
    for down, up in ((5, 5), (6, 6), (7, 7), (8, 8), (10, 10), (6, 9), (8, 12), (12, 12)):
        if True:
            width = math.log((1 + up / 100) / (1 - down / 100))
            for step in (0.5, 0.7, 1.0, 1.4):
                n = max(5, round(width / math.log(1 + step / 100)))
                rets, stops, fills_all, dds = [], 0, [], []
                for s in starts:
                    window = candles[s : s + hold_len]
                    p0 = window[0][0]
                    lo, hi = p0 * (1 - down / 100), p0 * (1 + up / 100)
                    stop, tp = lo * 0.97, hi * 1.03
                    pnl, fills, reason, dd = run_grid(window, lo, hi, n, stop, tp)
                    rets.append(pnl * 100)
                    dds.append(dd * 100)
                    fills_all.append(fills)
                    stops += reason == "stop"
                rets_sorted = sorted(rets)
                results.append(
                    (
                        sum(rets) / len(rets),
                        down,
                        up,
                        step,
                        n,
                        rets_sorted[len(rets) // 2],
                        rets_sorted[0],
                        rets_sorted[-1],
                        100 * stops / len(rets),
                        sum(fills_all) / len(fills_all),
                        min(dds),
                    )
                )
    results.sort(reverse=True)
    for r in results[:25]:
        print(
            f"{r[1]:>4} {r[2]:>4} {r[3]:>5} {r[4]:>6} {r[0]:>9.2f} {r[5]:>8.2f} {r[6]:>7.2f} {r[7]:>6.2f} {r[8]:>6.1f} {r[9]:>9.1f} {r[10]:>7.2f}"
        )
    print("\nBest risk-adjusted (mean / |worst|, stop% <= 25):")
    safe = [r for r in results if r[8] <= 25 and r[6] < 0]
    safe.sort(key=lambda r: r[0] / abs(r[6]), reverse=True)
    for r in safe[:10]:
        print(
            f"{r[1]:>4} {r[2]:>4} {r[3]:>5} {r[4]:>6} {r[0]:>9.2f} {r[5]:>8.2f} {r[6]:>7.2f} {r[7]:>6.2f} {r[8]:>6.1f} {r[9]:>9.1f} {r[10]:>7.2f}"
        )


if __name__ == "__main__":
    main()
