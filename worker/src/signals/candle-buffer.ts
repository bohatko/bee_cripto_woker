export interface Candle1m {
  timestamp: number; // millisecond open time
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class CandleBuffer {
  private capacity: number;
  private candles: Candle1m[] = [];

  constructor(capacity = 2000) {
    this.capacity = capacity;
  }

  public size(): number {
    return this.candles.length;
  }

  public getCandles(): readonly Candle1m[] {
    return this.candles;
  }

  public getLastCandle(): Candle1m | null {
    if (this.candles.length === 0) return null;
    return this.candles[this.candles.length - 1];
  }

  public addCandle(candle: Candle1m): void {
    const len = this.candles.length;
    if (len > 0) {
      const last = this.candles[len - 1];
      if (last.timestamp === candle.timestamp) {
        this.candles[len - 1] = candle;
        return;
      }
      if (candle.timestamp < last.timestamp) {
        const idx = this.candles.findIndex((c) => c.timestamp === candle.timestamp);
        if (idx >= 0) {
          this.candles[idx] = candle;
        }
        return;
      }
    }

    this.candles.push(candle);
    if (this.candles.length > this.capacity) {
      this.candles.splice(0, this.candles.length - this.capacity);
    }
  }

  public addCandles(candles: Candle1m[]): void {
    const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
    for (const c of sorted) {
      this.addCandle(c);
    }
  }

  /**
   * Calculates rolling max of HIGH prices in the last `windowMinutes` closed bars,
   * EXCLUDING the currently forming/last bar.
   * If `exclusiveOfLast` is true, takes bars up to length - 2 (or length - 1 for closed bar check).
   */
  public getRollingMaxHigh(windowMinutes = 1440, exclusiveOfLast = true): number | null {
    const len = this.candles.length;
    const endIndex = exclusiveOfLast ? len - 2 : len - 1;
    if (endIndex < 0) return null;

    const startIndex = Math.max(0, endIndex - windowMinutes + 1);
    if (endIndex < startIndex) return null;

    let maxHigh = -Infinity;
    for (let i = startIndex; i <= endIndex; i++) {
      const h = this.candles[i].high;
      if (h > maxHigh) {
        maxHigh = h;
      }
    }

    return maxHigh > -Infinity ? maxHigh : null;
  }

  /**
   * Drop percentage: (rollingMax - currentPrice) / rollingMax * 100
   */
  public calculateDropPct(currentPrice: number, rollingMax: number): number {
    if (rollingMax <= 0 || currentPrice <= 0) return 0;
    const drop = ((rollingMax - currentPrice) / rollingMax) * 100;
    return Math.max(0, drop);
  }

  public detectGaps(maxGapMinutes = 5): number[] {
    const gaps: number[] = [];
    for (let i = 1; i < this.candles.length; i++) {
      const diffMinutes = (this.candles[i].timestamp - this.candles[i - 1].timestamp) / 60000;
      if (diffMinutes > maxGapMinutes) {
        gaps.push(this.candles[i - 1].timestamp);
      }
    }
    return gaps;
  }
}
