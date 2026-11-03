import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

type Result = { data: unknown; error: { message: string; code?: string } | null };
type Db = { rpc(name: string, args: Record<string, unknown>): Promise<Result> };

export type RotationReport = { checked: number; rotated: number; kept: number; kept_reasons: Record<string, number> };

/**
 * "Attempts before rotate" (assignment_settings.attempts_before_rotate), run on a schedule.
 *
 * All of the deciding happens in rotate_unanswered_assignments (20260924300000): which owned leads
 * qualify, the live-call and callback exclusions, and the move itself through the ordinary router
 * with the current owner excluded. This only calls it and reports.
 *
 * Deliberately a scheduled job rather than a trigger on tenant_call_attempts: the dialer's
 * disposition path stays exactly as fast as it was.
 *
 * Before the migration is applied the function does not exist; that is reported as a skipped run,
 * not a failure, so the cron does not page anyone about a database update nobody has run yet.
 */
export async function runAssignmentRotationJob(limit = 200) {
  const client = getSupabaseServiceClient() as unknown as Db;
  const result = await client.rpc("rotate_unanswered_assignments", { p_limit: limit });
  if (result.error) {
    const missing = ["42883", "PGRST202", "42P01", "42703"].includes(result.error.code ?? "") || /schema cache|does not exist/i.test(result.error.message);
    if (missing) {
      return { ok: true as const, status: 200, body: { skipped: true, reason: "rotate_unanswered_assignments is not in the database yet (migration 20260924300000)." } };
    }
    return { ok: false as const, status: 503, body: { error: "Lead rotation could not run.", detail: result.error.message.slice(0, 500) } };
  }
  const report = (result.data ?? { checked: 0, rotated: 0, kept: 0, kept_reasons: {} }) as RotationReport;
  return { ok: true as const, status: 200, body: report };
}
