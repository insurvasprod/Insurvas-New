import { NextResponse } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { CommissionsStepCounts } from "@/lib/commissions/steps";

/**
 * The live counts on the one Commissions page's rail (owner 2026-11-02): what waits on a person, per step.
 * Counts only — never an amount — for the owner and bookkeepers, who work these queues. Each read stands
 * alone: one that fails (or a table not there yet) leaves its step out, and the rail shows no badge.
 *
 *   statements     statement lines proposed or unmatched, on statements not voided (Statements' "Lines waiting")
 *   discrepancies  findings open or disputed, from carrier files and from imported statements
 *   attribution    open rows: disagreements and unattributed (the Attribution queue's two tabs)
 */
const ROLES = ["owner", "bookkeeper"] as const;
const WORKING = ["open", "disputed"] as const;

type Result = { data?: unknown; count?: number | null; error: { message: string } | null };
type Q = PromiseLike<Result> & { eq(c: string, v: unknown): Q; in(c: string, v: readonly unknown[]): Q; neq(c: string, v: unknown): Q; limit(n: number): Q };
type Db = { from(table: string): { select(columns: string, options?: { count: "exact"; head: true }): Q } };

const head = async (query: PromiseLike<Result>): Promise<number | null> => {
  const { count, error } = await query;
  return error ? null : (count ?? 0);
};

export async function GET() {
  const auth = await requireFeatureRole("statement_ingestion", ROLES);
  if (auth instanceof NextResponse) return auth;
  const tenantId = auth.context.tenantId;
  const db = getSupabaseServiceClient() as unknown as Db;
  const count = (table: string) => db.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);

  const [statements, fromFiles, fromStatements, attribution] = await Promise.all([
    // One summary row per statement; the lines waiting are its proposed and unmatched counts.
    db.from("tenant_commission_statement_summaries").select("proposed_count, unmatched_count").eq("tenant_id", tenantId).neq("status", "voided").limit(5000)
      .then((read) => (read.error || !Array.isArray(read.data) ? null : (read.data as Array<{ proposed_count: number | null; unmatched_count: number | null }>).reduce((sum, row) => sum + Number(row.proposed_count ?? 0) + Number(row.unmatched_count ?? 0), 0)), () => null),
    head(count("commission_discrepancy").in("status", WORKING)).catch(() => null),
    head(count("tenant_commission_discrepancies").in("status", WORKING)).catch(() => null),
    head(count("agency_attribution_item").eq("status", "open")).catch(() => null),
  ]);
  const counts: CommissionsStepCounts = {};
  if (statements !== null) counts.statements = statements;
  if (fromFiles !== null || fromStatements !== null) counts.discrepancies = (fromFiles ?? 0) + (fromStatements ?? 0);
  if (attribution !== null) counts.attribution = attribution;
  return NextResponse.json({ counts }, { headers: { "Cache-Control": "no-store" } });
}
