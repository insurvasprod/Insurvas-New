import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { TenantRole } from "@/lib/tenantAuth/roles";
import type { LeadsInStep } from "./steps";

/**
 * The live count under each step of the one Leads page's rail (owner 2026-10-28, "yes, live counts").
 * Read-only head counts, one per step, each behind the gate its step's page applies, so the rail
 * never says a number about a screen this person cannot open. A failed read is left out: the rail
 * keeps that step's plain line.
 *
 *   source   active campaigns                      tenant_campaigns
 *   review   files staged and waiting for review     agent_lead_import_batches  (processing, touched this week:
 *                                                  an older staged file is one somebody walked away from)
 *   clean    duplicate pairs waiting for a person  contact_duplicate_reviews  (status pending)
 *   lists    active lists not scrubbed yet         tenant_campaigns           (nobody can dial them)
 *   route    leads nobody owns yet                 lead_queue                 (unclaimed, no owner)
 *   recycle  leads out of tries or parked          agent_leads                (exhausted, nurture)
 */
type Chain = PromiseLike<{ count: number | null; error: unknown }> & {
  eq(column: string, value: unknown): Chain;
  in(column: string, values: unknown[]): Chain;
  is(column: string, value: null): Chain;
  gte(column: string, value: string): Chain;
};
type Loose = { from(table: string): { select(columns: string, options: { count: "exact"; head: true }): Chain } };

const head = (table: string) => (getSupabaseServiceClient() as unknown as Loose).from(table).select("id", { count: "exact", head: true });
const count = async (query: Chain) => {
  const result = await query;
  return result.error ? null : result.count ?? 0;
};

export type StepCounts = Partial<Record<LeadsInStep, number>>;

export async function readStepCounts(input: { tenantId: string; roles: readonly TenantRole[]; available: readonly string[]; narrow: boolean; hidden: readonly string[]; now?: number; /** Solo mode: no Route step, so no route count. */ solo?: boolean }): Promise<StepCounts> {
  const has = (feature: string) => input.available.includes(feature);
  const may = (...roles: TenantRole[]) => input.roles.some((role) => roles.includes(role));
  const shown = (key: string) => !input.hidden.includes(key);
  const t = input.tenantId;
  const weekAgo = new Date((input.now ?? Date.now()) - 7 * 24 * 60 * 60 * 1000).toISOString();
  const reads: Array<[LeadsInStep, Promise<number | null>]> = [];
  // AG-0.5: inside an agency a narrow session opens none of these but routing (owner only there).
  if (has("outbound_dialing") && may("owner", "producer") && !input.narrow && shown("leads.campaigns"))
    reads.push(["source", count(head("tenant_campaigns").eq("tenant_id", t).eq("status", "active"))]);
  if (has("lead_import") && may("owner", "producer", "assistant") && !input.narrow && shown("leads.import"))
    reads.push(["review", count(head("agent_lead_import_batches").eq("tenant_id", t).eq("status", "processing").gte("updated_at", weekAgo))]);
  if (has("duplicate_detection") && may("owner", "producer", "assistant") && !input.narrow && shown("leads.duplicates"))
    reads.push(["clean", count(head("contact_duplicate_reviews").eq("tenant_id", t).eq("status", "pending"))]);
  if (has("lead_import") && may("owner", "producer", "assistant") && !input.narrow && shown("leads.lists"))
    reads.push(["lists", count(head("tenant_campaigns").eq("tenant_id", t).eq("status", "active").eq("scrub_status", "unscrubbed"))]);
  if (((has("outbound_dialing") && may("owner", "producer", "assistant", "setter")) || (has("lead_assignment") && may("owner"))) && (!input.narrow || may("owner")) && shown("leads.assignments") && !input.solo)
    reads.push(["route", count(head("lead_queue").eq("tenant_id", t).eq("status", "unclaimed").is("owner_user_id", null))]);
  if (has("outbound_dialing") && may("owner", "producer") && !input.narrow && shown("leads.nurture"))
    reads.push(["recycle", count(head("agent_leads").eq("tenant_id", t).in("lead_state", ["exhausted", "nurture"]))]);

  const settled = await Promise.all(reads.map(([key, read]) => read.then((value) => [key, value] as const, () => [key, null] as const)));
  const counts: StepCounts = {};
  for (const [key, value] of settled) if (value !== null) counts[key] = value;
  return counts;
}

/** The newest file staged this week and not imported yet: where the rail's Review step opens. */
export async function readLatestReviewBatch(tenantId: string, now = Date.now()): Promise<string | null> {
  type Rows = PromiseLike<{ data: Array<{ id: string }> | null; error: unknown }> & {
    eq(column: string, value: unknown): Rows;
    gte(column: string, value: string): Rows;
    order(column: string, options: { ascending: boolean }): Rows;
    limit(n: number): Rows;
  };
  const db = getSupabaseServiceClient() as unknown as { from(table: string): { select(columns: string): Rows } };
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await db.from("agent_lead_import_batches").select("id").eq("tenant_id", tenantId).eq("status", "processing").gte("updated_at", weekAgo).order("updated_at", { ascending: false }).limit(1);
  return result.error ? null : result.data?.[0]?.id ?? null;
}
