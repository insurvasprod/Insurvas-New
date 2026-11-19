import "server-only";

import { readFoundRow, type ExistenceRead } from "@/lib/dashboard/checklist";
import { loadSetupProgress } from "@/lib/dashboard/setupProgress";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- several of these tables aren't in database.types.ts (shared; not ours to regenerate)
const db = () => getSupabaseServiceClient() as any;

/** A read that throws, or returns an error (a table not migrated yet), proves nothing. */
async function proves(read: PromiseLike<ExistenceRead>): Promise<boolean> {
  try { return readFoundRow(await read); } catch { return false; }
}

/**
 * Which Docs tasks this agency has done at least once (lib/docs/tasks.ts `done`), R6 (owner 2026-11-16: progress
 * means done in Insurvas). Each fact is one `limit 1` existence read, all in parallel, every one filtered by the
 * tenant: the service role has no RLS predicate, and an unfiltered read would walk every tenant's rows. The tables
 * are the ones each task's own screen writes.
 */
export async function loadTaskFacts(tenantId: string): Promise<Set<string>> {
  const one = (table: string) => db().from(table).select("id").eq("tenant_id", tenantId);
  const checks: Record<string, PromiseLike<unknown>> = {
    recycled: one("tenant_recycle_batches").limit(1),
    duplicates: proves(one("merge_log").limit(1)).then(async (merged) => merged || proves(one("contact_duplicate_reviews").neq("status", "pending").limit(1))),
    called: one("tenant_lead_activity").limit(1),
    claimed: one("tenant_lead_activity").not("work_item_id", "is", null).limit(1),
    callback: one("tenant_callbacks").limit(1),
    quoted: one("tenant_quotes").limit(1),
    submitted: one("tenant_application_submissions").limit(1),
    chased: one("tenant_application_requirements").not("last_chased_at", "is", null).limit(1),
    agentCodes: one("carrier_agent_map").limit(1),
    carrierTerms: one("carrier_retention_rule").limit(1),
    needsYou: one("queue_item").neq("status", "open").limit(1),
    payIssue: proves(one("commission_discrepancy").in("status", ["resolved", "dismissed"]).limit(1)).then(async (settled) => settled || proves(one("commission_dispute").limit(1))),
    producerPaid: one("producer_payout_run").is("voided_at", null).limit(1),
    partnerPaid: one("payout_run").eq("status", "paid").limit(1),
    split: one("policy_split").is("superseded_at", null).limit(1),
    billChecked: one("vendor_invoice").in("status", ["approved", "paid"]).limit(1),
    bankMatched: one("bank_transaction").eq("match_status", "matched").limit(1),
    expense: one("expense").limit(1),
    saveCase: one("retention_case_event").eq("kind", "call").limit(1),
    deletion: one("deletion_request").eq("status", "completed").limit(1),
    evidence: one("compliance_report_log").limit(1),
    partnerChat: one("partner_messages").limit(1),
  };
  const [results, progress] = await Promise.all([
    Promise.all(Object.entries(checks).map(async ([key, check]) => {
      // A query builder resolves to { data, error }; the two combined checks resolve to a boolean already.
      const found = await Promise.resolve(check)
        .then((value) => (typeof value === "boolean" ? value : readFoundRow(value as ExistenceRead)))
        .catch(() => false);
      return [key, found] as const;
    })),
    loadSetupProgress(tenantId).catch(() => null),
  ]);
  const facts = new Set(results.filter(([, found]) => found).map(([key]) => key));
  if (progress?.bookImported) facts.add("book");
  return facts;
}
