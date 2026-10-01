"""Walk-forward parameter search for the neutral CLUSDT futures grid.

Improvements over simulate.py: taker fees on the initial position and on forced exits,
historical funding, ATR-based stop / take-profit, and a train/test split by launch time.
Usage: python optimize.py
"""
import itertools
import json
import math
import time
import urllib.request
from bisect import bisect_left, bisect_right

SYMBOL = "CLUSDT"
LEVERAGE = 2.0
MAKER = 0.0002
TAKER = 0.00055
PER_DAY = 96
TRAIN_SHARE = 0.6


def get(url):
    return json.load(urllib.request.urlopen(url))["result"]["list"]


def fetch_candles(days=95):
    out, end = {}, int(time.time() * 1000)
    while len(out) < days * PER_DAY:
        rows = get(
            "https://api.bybit.com/v5/market/kline?category=linear"
            f"&symbol={SYMBOL}&interval=15&limit=1000&end={end}"
        )
        if not rows:
            break
        for r in rows:
            out[int(r[0])] = tuple(float(x) for x in r[1:5])
        end = min(int(r[0]) for r in rows) - 1
    keys = sorted(out)
    return keys, [out[k] for k in keys]


def fetch_funding(start_ms):
    out, end = {}, int(time.time() * 1000)
    while end > start_ms:
        rows = get(
            "https://api.bybit.com/v5/market/funding/history?category=linear"
            f"&symbol={SYMBOL}&limit=200&endTime={end}"
        )
        if not rows:
            break
        for r in rows:
            out[int(r["fundingRateTimestamp"])] = float(r["fundingRate"])
        end = min(int(r["fundingRateTimestamp"]) for r in rows) - 1
    return sorted(out.items())


def daily_atr(times, candles, idx, n=14):
    """Mean daily true range (as a fraction of price) over the n days before candle idx."""
    trs, close_prev = [], None
    start = max(0, idx - n * PER_DAY)
    for d in range(start, idx - PER_DAY + 1, PER_DAY):
        day = candles[d : d + PER_DAY]
        hi, lo = max(c[1] for c in day), min(c[2] for c in day)
        tr = hi - lo if close_prev is None else max(hi, close_prev) - min(lo, close_prev)
        trs.append(tr)
        close_prev = day[-1][3]
    return sum(trs) / len(trs) if trs else None


def run_grid(times, candles, funding, lo, hi, n, stop, tp):
    ratio = (hi / lo) ** (1.0 / n)
    lv = [lo * ratio**i for i in range(n + 1)]
    cell = LEVERAGE / n
    last = candles[0][0]
    hold = [lv[k] > last for k in range(n)]
    realized = -sum(hold) * cell * TAKER
    fills = 0
    f_times = [t for t, _ in funding]
    f_idx = bisect_left(f_times, times[0])

    def unreal(p):
        return sum(cell / lv[k] * (p - lv[k]) for k in range(n) if hold[k])

    def exit_cost():
        return sum(hold) * cell * TAKER

    worst = 0.0
    for i, (o, h, l, c) in enumerate(candles):
        while f_idx < len(funding) and funding[f_idx][0] <= times[i]:
            realized -= sum(hold) * cell * funding[f_idx][1]
            f_idx += 1
        path = [o, l, h, c] if c >= o else [o, h, l, c]
        for target in path:
            p = last
            if target < p:
                for k in range(bisect_left(lv, target), min(bisect_left(lv, p), n)):
                    if not hold[k]:
                        hold[k] = True
                        realized -= cell * MAKER
            elif target > p:
                for k in range(max(bisect_right(lv, p) - 1, 0), min(bisect_right(lv, target) - 1, n)):
                    if hold[k]:
                        hold[k] = False
                        realized += cell * (lv[k + 1] - lv[k]) / lv[k] - cell * MAKER
                        fills += 1
            last = target
            if last <= stop:
                return realized + unreal(stop) - exit_cost(), "stop", worst
            if last >= tp:
                return realized + unreal(tp) - exit_cost(), "tp", worst
        worst = min(worst, realized + unreal(last))
    return realized + unreal(last) - exit_cost(), "time", worst


def evaluate(times, candles, funding, starts, hold_len, half, step, stop_k, tp_k):
    n = max(5, round(math.log((1 + half / 100) / (1 - half / 100)) / math.log(1 + step / 100)))
    rets, stops = [], 0
    for s in starts:
        atr = daily_atr(times, candles, s)
        w, t = candles[s : s + hold_len], times[s : s + hold_len]
        p0 = w[0][0]
        lo, hi = p0 * (1 - half / 100), p0 * (1 + half / 100)
        stop = lo - stop_k * atr
        tp = hi + tp_k * atr if tp_k else float("inf")
        pnl, reason, _ = run_grid(t, w, funding, lo, hi, n, stop, tp)
        rets.append(pnl * 100)
        stops += reason == "stop"
    rs = sorted(rets)
    return {
        "n": n,
        "mean": sum(rets) / len(rets),
        "median": rs[len(rs) // 2],
        "p10": rs[max(0, len(rs) // 10)],
        "worst": rs[0],
        "stop%": 100 * stops / len(rets),
        "cnt": len(rets),
    }


def score(r):
    return r["mean"] / max(5.0, -r["p10"])


def main():
    times, candles = fetch_candles()
    funding = fetch_funding(times[0])
    print(f"candles={len(candles)} days={len(candles)/PER_DAY:.1f} funding_points={len(funding)}")
    if funding:
        rates = [r for _, r in funding]
        print(f"funding mean={sum(rates)/len(rates):.6f} min={min(rates):.6f} max={max(rates):.6f}")

    warmup = 15 * PER_DAY
    combos = list(itertools.product((6, 8, 10), (1.0, 1.3, 1.6), (1.0, 1.5, 2.0, 3.0), (0.0, 1.5), (7, 14, 21)))
    rows = []
    for half, step, stop_k, tp_k, hold_d in combos:
        hold_len = hold_d * PER_DAY
        starts = list(range(warmup, len(candles) - hold_len, PER_DAY // 2))
        if len(starts) < 10:
            continue
        cut = int(len(starts) * TRAIN_SHARE)
        tr = evaluate(times, candles, funding, starts[:cut], hold_len, half, step, stop_k, tp_k)
        te = evaluate(times, candles, funding, starts[cut:], hold_len, half, step, stop_k, tp_k)
        rows.append(((half, step, stop_k, tp_k, hold_d), tr, te))

    rows.sort(key=lambda r: score(r[1]), reverse=True)
    print("\nTop 15 by TRAIN score (mean / max(5, |p10|)); TEST columns are out-of-sample")
    print("half step stopATR tpATR hold cells | TRAIN mean med p10 worst stop% | TEST mean med p10 worst stop%")
    for (half, step, sk, tk, hd), tr, te in rows[:15]:
        print(
            f"{half:>4} {step:>4} {sk:>7} {tk:>5} {hd:>4} {tr['n']:>5} | "
            f"{tr['mean']:>6.2f} {tr['median']:>6.2f} {tr['p10']:>6.2f} {tr['worst']:>6.2f} {tr['stop%']:>5.1f} | "
            f"{te['mean']:>6.2f} {te['median']:>6.2f} {te['p10']:>6.2f} {te['worst']:>6.2f} {te['stop%']:>5.1f}"
        )
    rows.sort(key=lambda r: score(r[2]), reverse=True)
    print("\nTop 10 by TEST score (diagnostic only, do not select on this)")
    for (half, step, sk, tk, hd), tr, te in rows[:10]:
        print(
            f"{half:>4} {step:>4} {sk:>7} {tk:>5} {hd:>4} {tr['n']:>5} | "
            f"{tr['mean']:>6.2f} {tr['p10']:>6.2f} | {te['mean']:>6.2f} {te['median']:>6.2f} {te['p10']:>6.2f} {te['worst']:>6.2f}"
        )

    avg = {}
    for key, tr, te in rows:
        for i, name in enumerate(("half", "step", "stopATR", "tpATR", "hold")):
            avg.setdefault((name, key[i]), []).append((tr["mean"] + te["mean"]) / 2)
    print("\nMarginal average of (train+test)/2 mean return by parameter value")
    for (name, val), v in sorted(avg.items()):
        print(f"{name:>8} {val:>5}: {sum(v)/len(v):>6.2f}")


if __name__ == "__main__":
    main()
