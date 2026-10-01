"""Sensitivity of the oil grid to stop distance and holding period (see simulate.py)."""
import math

from simulate import fetch, run_grid


def main():
    candles = fetch()
    per_day = 96
    print("hold_d down/up step cells stopMult  mean%  median%  worst%  stop%")
    for hold_d in (7, 14, 21):
        hold_len = hold_d * per_day
        starts = range(0, len(candles) - hold_len, 24 * 4)
        for half in (6, 8):
            for step in (1.0, 1.4):
                n = max(5, round(math.log((1 + half / 100) / (1 - half / 100)) / math.log(1 + step / 100)))
                for stop_mult in (0.97, 0.93, 0.88):
                    rets, stops = [], 0
                    for s in starts:
                        w = candles[s : s + hold_len]
                        p0 = w[0][0]
                        lo, hi = p0 * (1 - half / 100), p0 * (1 + half / 100)
                        pnl, _, reason, _ = run_grid(w, lo, hi, n, lo * stop_mult, hi * 1.03)
                        rets.append(pnl * 100)
                        stops += reason == "stop"
                    rs = sorted(rets)
                    print(
                        f"{hold_d:>6} {half:>4}/{half:<4} {step:>4} {n:>5} {stop_mult:>8} "
                        f"{sum(rets)/len(rets):>6.2f} {rs[len(rs)//2]:>8.2f} {rs[0]:>7.2f} {100*stops/len(rets):>6.1f}"
                    )


if __name__ == "__main__":
    main()
