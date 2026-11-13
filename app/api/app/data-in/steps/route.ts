import { NextResponse } from "next/server";

import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";
import { refuseNarrowInAgency } from "@/lib/agency/routeScope";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { QUEUE_TYPES } from "@/lib/ingestion/exceptionQueues";
import type { DataInStepCounts } from "@/lib/dataIn/steps";
import { hasFeature } from "@/lib/entitlements/types";
import { hiddenOpenFindings, unmappedAgentCodes } from "@/lib/needsYou/store";
import { countRuleHolds } from "@/lib/pipelineRules/store";
import { setupTabCounts } from "@/lib/pipelineRules/setupCounts";

/**
 * The live counts on the Book of business rail (owner 2026-11-02, round 2): what waits on a person, per step.
 * Head counts only, each under the rule its own screen applies, and each on its own: a read that fails (or
 * a table not there yet) adds nothing, and a step with nothing read shows no badge.
 *
 *   files      carrier files that failed to read and are not just waiting for a layout (owner, bookkeeper)
 *   needs-you  every open decision: policies waiting for a client (owner, bookkeeper), open exception items (the
 *              owner and bookkeepers all, a producer their own, a narrow agency session none), and for the owner
 *              and bookkeepers open commission findings and rows to attribute (each only with its own feature on
 *              the plan), agent codes that map to nobody and two rules that disagree: the Agency view of Needs you (lib/needsYou/store.ts),
 *              less the status words that wait on Insurvas
 */
const ROLES = ["owner", "bookkeeper", "producer"] as const;
const WORKING = ["open", "disputed"] as const;

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

  // Money and credit count only where their own screens open: the feature on the plan, as their APIs require.
  // The entitlement requireFeature already read for this request (perf pass 2026-11-09: not a second trip).
  const entitlement = keeper ? auth.entitlement : null;
  const money = Boolean(entitlement && hasFeature(entitlement, "discrepancy_report"));
  const credit = Boolean(entitlement && hasFeature(entitlement, "producer_payouts"));

  const [files, matching, exceptions, findings, attribution, agentCodes, ruleHolds, setup] = await Promise.all([
    keeper ? head(count("file_registry").eq("status", "failed").is("superseded_by_file_id", null).or("parse_block.is.null,parse_block.neq.no_layout_map")).catch(() => null) : null,
    keeper ? head(count("policy_match_review").eq("status", "open")).catch(() => null) : null,
    narrow ? null : head((keeper ? count("queue_item") : count("queue_item").eq("assigned_to_user_id", userId)).eq("status", "open").in("queue_type", QUEUE_TYPES)).catch(() => null),
    // Less the findings the list hides because their trace is broken (LA-4.20), so the badge says what the list shows.
    // The count and the trace check are read together, not one after the other (perf pass 2026-11-09).
    keeper && money ? Promise.all([head(count("commission_discrepancy").in("status", WORKING)), hiddenOpenFindings(tenantId)]).then(([n, hidden]) => (n === null ? null : Math.max(0, n - hidden))).catch(() => null) : null,
    keeper && credit ? head(count("agency_attribution_item").eq("status", "open")).catch(() => null) : null,
    keeper ? unmappedAgentCodes(tenantId).then((codes) => codes.length).catch(() => null) : null,
    // Two rules disagree: null before 20261102100000, which adds nothing.
    keeper ? countRuleHolds(tenantId).catch(() => null) : null,
    // Setup's tabs are rail steps (2026-11-05): what each is missing, as their tabs counted it. Owner and bookkeeper.
    keeper ? setupTabCounts(tenantId).catch(() => null) : null,
  ]);
  const counts: DataInStepCounts = {};
  if (files !== null) counts.files = files;
  const decisions = [matching, exceptions, findings, attribution, agentCodes, ruleHolds].filter((n): n is number => n !== null);
  if (decisions.length) counts["needs-you"] = decisions.reduce((sum, n) => sum + n, 0);
  for (const key of ["rate-card", "carrier-rules", "agent-codes"] as const) {
    const n = setup?.[key];
    if (typeof n === "number" && n > 0) counts[key] = n;
  }
  return NextResponse.json({ counts }, { headers: { "Cache-Control": "no-store" } });
}
