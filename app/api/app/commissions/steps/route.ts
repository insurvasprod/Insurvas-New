import { NextResponse, type NextRequest } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { readOverrides } from "@/lib/agency/overrideStore";
import { periodOf } from "@/lib/agency/http";
import type { CommissionsStepCounts } from "@/lib/commissions/steps";

/**
 * The live counts on the one Commissions page's rail (owner 2026-11-02): what waits on a person, per step.
 * Counts only — never an amount — for the owner and bookkeepers, who work these queues. Each read stands
 * alone: one that fails (or a table not there yet) leaves its step out, and the rail shows no badge.
 *
 *   statements     statement lines proposed or unmatched, on statements not voided (Statements' "Lines waiting")
 *   discrepancies  findings open or disputed, from carrier files and from imported statements
 *   hierarchy      producer-carrier rows with no contract level, or a negative spread (under team_hierarchy)
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

export async function GET(request: NextRequest) {
  const auth = await requireFeatureRole("statement_ingestion", ROLES);
  if (auth instanceof NextResponse) return auth;
  const tenantId = auth.context.tenantId;
  const db = getSupabaseServiceClient() as unknown as Db;
  const count = (table: string) => db.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);

  // Statements and the Attribution queue left Commissions (owner 2026-11-02): Discrepancies is the one queue left.
  const [fromFiles, fromStatements] = await Promise.all([
    head(count("commission_discrepancy").in("status", WORKING)).catch(() => null),
    head(count("tenant_commission_discrepancies").in("status", WORKING)).catch(() => null),
  ]);
  const counts: CommissionsStepCounts = {};
  if (fromFiles !== null || fromStatements !== null) counts.discrepancies = (fromFiles ?? 0) + (fromStatements ?? 0);
  // Hierarchy & overrides (from Team, 2026-11-03): producer-carrier rows with no contract level or a negative spread,
  // this month, under the step's own gate and through the scoped store. Left out when that gate refuses.
  const team = await requireFeatureRole("team_hierarchy", ROLES, { prefetchScope: true }).catch(() => null);
  if (team && !(team instanceof NextResponse)) {
    const period = periodOf(new URL(request.url));
    const overrides = period instanceof NextResponse ? null : await readOverrides(team.context, period).catch(() => null);
    if (overrides) counts.hierarchy = overrides.filter((row) => row.producerLevelBps === null || (row.spreadBps !== null && row.spreadBps < 0)).length;
  }
  return NextResponse.json({ counts }, { headers: { "Cache-Control": "no-store" } });
}
