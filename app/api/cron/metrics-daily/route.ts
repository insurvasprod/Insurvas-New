import { NextResponse } from "next/server";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { buildMetricsDays, MAX_METRICS_DAYS, NIGHTLY_METRICS_DAYS } from "@/lib/metrics/buildDaily";

/**
 * SA-3.9 · The nightly metrics_daily snapshot (pg_cron calls it through call_app_cron,
 * 20261015500000). The same function as `npm run metrics:build`: compute_metrics_for_date per day,
 * which upserts, so a rerun is free. Nightly it rebuilds yesterday and today; `?days=N` (at most
 * 400) rebuilds more, though a long backfill belongs to the script — the dispatcher waits 60s.
 *
 * Same shape as /api/cron/period-billing. Fails closed: with no CRON_SECRET set this answers 401
 * to everybody, including the scheduler.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const asked = Number(new URL(request.url).searchParams.get("days") ?? NIGHTLY_METRICS_DAYS);
  const days = Number.isFinite(asked) ? Math.max(0, Math.min(MAX_METRICS_DAYS, Math.trunc(asked))) : NIGHTLY_METRICS_DAYS;
  try {
    const run = await buildMetricsDays(getSupabaseServiceClient(), days);
    return NextResponse.json(run, { status: run.error ? 500 : 200 });
  } catch (error) {
    console.error("[cron/metrics-daily]", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Metrics build failed" }, { status: 500 });
  }
}
