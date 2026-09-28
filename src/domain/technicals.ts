import Decimal from "decimal.js";

export type DailyBar = { high: number; low: number; close: number };

/**
 * Average true range over `period` bars as a percentage of the last close (Wilder's smoothing),
 * following the technical-analysis skill's ATR definition. Descriptive only.
 */
export function atrPercent(bars: DailyBar[], period = 14): string | null {
  if (bars.length < period + 1) return null;
  const trueRanges: Decimal[] = [];
  for (let index = 1; index < bars.length; index += 1) {
    const { high, low } = bars[index];
    const previousClose = bars[index - 1].close;
    trueRanges.push(Decimal.max(new Decimal(high).minus(low), new Decimal(high).minus(previousClose).abs(), new Decimal(low).minus(previousClose).abs()));
  }
  let atr = trueRanges.slice(0, period).reduce((sum, value) => sum.plus(value), new Decimal(0)).div(period);
  for (const range of trueRanges.slice(period)) atr = atr.mul(period - 1).plus(range).div(period);
  const lastClose = new Decimal(bars[bars.length - 1].close);
  return atr.div(lastClose).mul(100).toDecimalPlaces(2).toString();
}

/** Relative strength index with Wilder's smoothing. */
export function rsi(closes: number[], period = 14): string | null {
  if (closes.length < period + 1) return null;
  let gain = new Decimal(0);
  let loss = new Decimal(0);
  for (let index = 1; index <= period; index += 1) {
    const change = new Decimal(closes[index]).minus(closes[index - 1]);
    if (change.gt(0)) gain = gain.plus(change); else loss = loss.plus(change.abs());
  }
  gain = gain.div(period);
  loss = loss.div(period);
  for (let index = period + 1; index < closes.length; index += 1) {
    const change = new Decimal(closes[index]).minus(closes[index - 1]);
    gain = gain.mul(period - 1).plus(change.gt(0) ? change : 0).div(period);
    loss = loss.mul(period - 1).plus(change.lt(0) ? change.abs() : 0).div(period);
  }
  if (loss.isZero()) return "100";
  const relative = gain.div(loss);
  return new Decimal(100).minus(new Decimal(100).div(relative.plus(1))).toDecimalPlaces(1).toString();
}

export function simpleAverage(values: number[], period: number): string | null {
  if (values.length < period) return null;
  return values.slice(-period).reduce((sum, value) => sum.plus(value), new Decimal(0)).div(period).toDecimalPlaces(4).toString();
}

/**
 * How a required move compares with the instrument's typical daily range. This is scale context,
 * not a probability: "your goal needs about 1.5 typical days of movement in your favour".
 */
export function requiredMoveInTypicalDays(requiredMovePercent: string, atrPercentValue: string): string | null {
  const atr = new Decimal(atrPercentValue);
  if (atr.lte(0)) return null;
  return new Decimal(requiredMovePercent).abs().div(atr).toDecimalPlaces(1).toString();
}
