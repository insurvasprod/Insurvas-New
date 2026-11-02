import { NextResponse } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { QUEUE_TYPES } from "@/lib/ingestion/exceptionQueues";
import type { DataInStepCounts } from "@/lib/dataIn/steps";

/**
 * The live counts on the one Data in page's rail (owner 2026-11-02): what waits on a person, per step.
 * Head counts only, each under the rule its own step applies, and each on its own: a read that fails (or
 * a table not there yet) leaves its step out, and the rail shows no badge for it.
 *
 *   files       carrier files that failed to read and are not just waiting for a layout (owner, bookkeeper)
 *   matching    policies waiting for a person to pick the right client (owner, bookkeeper)
 *   exceptions  open exception items; the owner and bookkeepers see all, a producer their own, a narrow
 *               agency session none (the Exceptions page refuses it)
 */
const ROLES = ["owner", "bookkeeper", "producer"] as const;

type Count = PromiseLike<{ count: number | null; error: { message: string } | null }>;
type Q = Count & { eq(c: string, v: unknown): Q; is(c: string, v: null): Q; in(c: string, v: readonly unknown[]): Q; or(f: string): Q };
type Db = { from(table: string): { select(columns: string, options: { count: "exact"; head: true }): Q } };

const head = async (query: Count): Promise<number | null> => {
  const { count, error } = await query;
  return error ? null : (count ?? 0);
};

export async function GET() {
  const auth = await requireFeatureRole("statement_ingestion", ROLES, { prefetchScope: true });
  if (auth instanceof NextResponse) return auth;
  const { tenantId, userId, role } = auth.context;
  const db = getSupabaseServiceClient() as unknown as Db;
  const count = (table: string) => db.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  const keeper = role === "owner" || role === "bookkeeper";
  const narrow = (await refuseNarrowInAgency(auth.context, "Exceptions")) !== null;

  const [files, matching, exceptions] = await Promise.all([
    keeper ? head(count("file_registry").eq("status", "failed").is("superseded_by_file_id", null).or("parse_block.is.null,parse_block.neq.no_layout_map")).catch(() => null) : null,
    keeper ? head(count("policy_match_review").eq("status", "open")).catch(() => null) : null,
    narrow ? null : head((keeper ? count("queue_item") : count("queue_item").eq("assigned_to_user_id", userId)).eq("status", "open").in("queue_type", QUEUE_TYPES)).catch(() => null),
  ]);
  const counts: DataInStepCounts = {};
  if (files !== null) counts.files = files;
  if (matching !== null) counts.matching = matching;
  if (exceptions !== null) counts.exceptions = exceptions;
  return NextResponse.json({ counts }, { headers: { "Cache-Control": "no-store" } });
}
