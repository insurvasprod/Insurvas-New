import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * A job sheet's recent calls (admin round 1, monitoring.html screen 6): the database's own dispatch record for one
 * /api/cron route (app_cron_dispatch, 20261015500000 — service_role may read it) and the answer to the latest call
 * (app_cron_status(), the read Platform health already makes). pg_net keeps answers for about six hours and only the
 * latest is joined by app_cron_status, so older calls show their time and whether they were skipped, not their answer.
 * Read-only.
 */

export type JobCall = { at: string; skippedReason: string | null };
export type JobCalls = {
  calls: JobCall[];
  latest: { at: string | null; httpStatus: number | null; timedOut: boolean | null; skippedReason: string | null; excerpt: string | null } | null;
};

// app_cron_dispatch and app_cron_status are not in the generated types (as lib/adminDashboard/healthQueries.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

const RECENT = 12;

/** Throws when neither read answers; a failed answer read alone leaves `latest` null. */
export async function fetchJobCalls(path: string): Promise<JobCalls> {
  const [dispatch, status] = await Promise.all([
    db().from("app_cron_dispatch").select("dispatched_at, skipped_reason").eq("path", path).order("dispatched_at", { ascending: false }).limit(RECENT),
    db().rpc("app_cron_status"),
  ]);
  if (dispatch.error && status.error) throw new Error(`job calls: ${dispatch.error.message}`);
  const calls = dispatch.error
    ? []
    : ((dispatch.data ?? []) as Array<{ dispatched_at: string; skipped_reason: string | null }>).map((row) => ({ at: row.dispatched_at, skippedReason: row.skipped_reason }));
  const row = status.error
    ? null
    : ((status.data ?? []) as Array<{ path: string; last_dispatched_at: string | null; skipped_reason: string | null; http_status: number | null; response_excerpt: string | null; timed_out: boolean | null }>).find((item) => item.path === path) ?? null;
  return {
    calls,
    latest: row ? { at: row.last_dispatched_at, httpStatus: row.http_status, timedOut: row.timed_out, skippedReason: row.skipped_reason, excerpt: row.response_excerpt } : null,
  };
}
