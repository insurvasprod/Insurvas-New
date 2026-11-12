/**
 * The vertical scale a bar chart is drawn against.
 *
 * It came from the agent dashboard's calls chart (lib/dashboard/homeView.ts), which still re-exports
 * `niceMax` so its own callers and tests are undisturbed. It lives here because the partner charts
 * need the same gridlines: two charts that round their axis differently look like two products.
 */

/**
 * The gridline to draw the top of the chart at: the next round number above the tallest bar, so the
 * tallest bar fills most of the chart and the halfway line still lands somewhere readable.
 */
export function niceMax(value: number): number {
  if (value <= 5) return 5;
  // Half the order of magnitude as the step (50 for hundreds, 5 for tens).
  const step = 10 ** Math.floor(Math.log10(value)) / 2;
  return Math.ceil(value / step) * step;
}

/**
 * The top of a chart's scale, with the halfway gridline landing somewhere a person would write.
 *
 * `niceMax` alone can return an odd number — nine leads gives gridlines at 9 and **4.5**, and half
 * a lead is not a thing. One more makes the midpoint whole without changing what the bars say.
 */
export function chartTop(max: number): number {
  const top = niceMax(max);
  return Number.isInteger(top) && top % 2 === 1 ? top + 1 : top;
}

/** The horizontal lines, top down: the scale's top, its middle, and the baseline. */
export function ticks(top: number): number[] {
  return [top, top / 2, 0];
}

/**
 * A bar chart's scale when some periods go below zero (net by week: advances above the line, chargebacks
 * below). Each side is rounded on its own, so a small chargeback does not squash the advances; `zero` is
 * where the zero line sits, as a fraction of the plot's height from the top.
 */
export function signedScale(ups: readonly number[], downs: readonly number[]): {
  top: number;
  bottom: number;
  zero: number;
  ticks: Array<{ value: number; at: number }>;
} {
  const high = Math.max(0, ...ups.map((value) => (Number.isFinite(value) ? value : 0)));
  const low = Math.max(0, ...downs.map((value) => (Number.isFinite(value) ? Math.abs(value) : 0)));
  const bottom = low > 0 ? chartTop(low) : 0;
  const top = high > 0 || bottom === 0 ? chartTop(high) : 0;
  const zero = top + bottom > 0 ? top / (top + bottom) : 1;
  const list: Array<{ value: number; at: number }> = [];
  if (top > 0) list.push({ value: top, at: 0 });
  if (top > 0 && bottom === 0) list.push({ value: top / 2, at: 0.5 });
  list.push({ value: 0, at: zero });
  if (bottom > 0 && top === 0) list.push({ value: -bottom / 2, at: 0.5 });
  if (bottom > 0) list.push({ value: -bottom, at: 1 });
  return { top, bottom, zero, ticks: list };
}

/**
 * The length a horizontal bar list measures against: its longest row (an outer value, a row's segments
 * together, or the top of an interval), so the longest bar fills its track. `max` overrides it, for two
 * lists that must share a scale. Never 0, so an all-zero list draws empty tracks rather than NaN.
 */
export function barListScale(
  rows: ReadonlyArray<{ value: number; inner?: number; segments?: ReadonlyArray<{ value: number }>; interval?: readonly [number, number] }>,
  max?: number,
): number {
  if (max !== undefined && Number.isFinite(max) && max > 0) return max;
  let high = 0;
  for (const row of rows) {
    const segments = row.segments?.reduce((sum, segment) => sum + Math.max(0, segment.value), 0) ?? 0;
    high = Math.max(high, Math.abs(row.value) || 0, Math.abs(row.inner ?? 0), segments, row.interval ? Math.abs(row.interval[1]) : 0);
  }
  return high > 0 ? high : 1;
}
