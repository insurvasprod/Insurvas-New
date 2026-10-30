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
