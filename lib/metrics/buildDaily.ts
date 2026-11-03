// SA-3.9 · Builds the metrics_daily snapshot — the one implementation behind `npm run metrics:build`
// (scripts/build-metrics.mjs) and the scheduled /api/cron/metrics-daily route.
//
// Re-runnable for any date: compute_metrics_for_date upserts, so rebuilding a day is free and a
// corrected calculation can be backfilled without duplicating rows. Stops at the first failing day,
// as the script always has, so a broken calculation is not written across the whole range.
//
// The client is an argument and nothing here is `server-only`, so plain Node loads it from the script.

import type { SupabaseClient } from "@supabase/supabase-js";

/** The nightly window: yesterday (now complete) and today (so far). A backfill is the script's job. */
export const NIGHTLY_METRICS_DAYS = 1;
/** The most a single request may rebuild; longer backfills go through the script. */
export const MAX_METRICS_DAYS = 400;

export type MetricsBuild = { built: number; from: string; to: string; failedOn: string | null; error: string | null };

/** The UTC dates, oldest first, for "the last `days` days and today". */
export function metricsDates(days: number, now: Date = new Date()): string[] {
  const span = Math.max(0, Math.min(MAX_METRICS_DAYS, Math.trunc(days)));
  const dates: string[] = [];
  for (let i = span; i >= 0; i--) dates.push(new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10));
  return dates;
}

export async function buildMetricsDays(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the script passes an untyped client
  supabase: SupabaseClient<any>,
  days: number,
  options: { now?: Date; log?: (line: string) => void } = {},
): Promise<MetricsBuild> {
  const dates = metricsDates(days, options.now);
  let built = 0;
  for (const date of dates) {
    const { error } = await supabase.rpc("compute_metrics_for_date", { p_date: date });
    if (error) {
      options.log?.(`  ${date}: ${error.message}`);
      return { built, from: dates[0], to: dates[dates.length - 1], failedOn: date, error: error.message };
    }
    built++;
  }
  return { built, from: dates[0], to: dates[dates.length - 1], failedOn: null, error: null };
}
