import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

type Result = { data: unknown; error: { message: string; code?: string } | null };
type Db = { rpc(name: string, args: Record<string, unknown>): Promise<Result> };

export type LicenceLapseReport = { checked: number; returned: number; kept: number } | { skipped: true; reason: string };

/**
 * When an agent's own licence in a state lapses (Team & access › Licensed in, expires_on), their
 * open leads in that state go back to the pool. Run on a schedule.
 *
 * All of the deciding happens in return_lapsed_licence_assignments (20260925702200): which leads
 * qualify, the rotation job's guards (no live call, no open attempt, no booked callback, no dialer
 * lock, never a live transfer), the licence gate's own verdict, the event and the audit row.
 *
 * Before the migration is applied the function does not exist; that is a skipped run, not a
 * failure, so the cron does not page anyone about a database update nobody has run yet.
 */
export async function runLicenceLapseJob(limit = 200) {
  const client = getSupabaseServiceClient() as unknown as Db;
  const result = await client.rpc("return_lapsed_licence_assignments", { p_limit: limit });
  if (result.error) {
    const missing = ["42883", "PGRST202", "42P01", "42703"].includes(result.error.code ?? "") || /schema cache|does not exist/i.test(result.error.message);
    if (missing) {
      return { ok: true as const, status: 200, body: { skipped: true, reason: "return_lapsed_licence_assignments is not in the database yet (migration 20260925702200)." } };
    }
    return { ok: false as const, status: 503, body: { error: "The licence lapse job could not run.", detail: result.error.message.slice(0, 500) } };
  }
  const report = (result.data ?? { checked: 0, returned: 0, kept: 0 }) as LicenceLapseReport;
  return { ok: true as const, status: 200, body: report };
}
