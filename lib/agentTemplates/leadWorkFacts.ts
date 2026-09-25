import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Facts the lead workspace needs that the lead row does not carry: who is holding each lead (its
 * work item's owner — "unassigned" is a lead nobody holds) and their name, the last disposition
 * recorded on it, and what it was quoted at (the deal-flow row's monthly premium, which the board
 * annualises per stage).
 *
 * Read for the leads already returned, in chunks — never the whole queue or the whole deal flow.
 * The premium is money, so the caller decides whether to ask for it at all.
 */
export type LeadWorkFacts = {
  ownerUserId: string | null;
  ownerName: string | null;
  disposition: string | null;
  dispositionAt: string | null;
  /** When the lead entered its current stage; null until migration 20260925100000. */
  stageEnteredAt: string | null;
  monthlyPremiumCents: number | null;
};

type Row = Record<string, unknown>;
type Query = PromiseLike<{ data: Row[] | null; error: { message: string } | null }> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
};

/** A uuid is 36 characters; 150 of them keep the request line well under PostgREST's limit. */
const CHUNK = 150;

export async function leadWorkFacts(tenantId: string, leadIds: string[], withPremium: boolean): Promise<Map<string, LeadWorkFacts>> {
  const db = getSupabaseServiceClient() as unknown as { from(table: string): Query };
  const chunks: string[][] = [];
  for (let start = 0; start < leadIds.length; start += CHUNK) chunks.push(leadIds.slice(start, start + CHUNK));
  const read = (table: string, columns: string, ids: string[]) =>
    db.from(table).select(columns).eq("tenant_id", tenantId).in("lead_id", ids).then(({ data, error }) => {
      if (error) throw new Error(`Could not load ${table === "lead_queue" ? "who holds these leads" : "the quoted premiums"}: ${error.message}`);
      return data ?? [];
    });
  const [queue, deals] = await Promise.all([
    Promise.all(chunks.map((ids) => read("lead_queue", "lead_id, owner_user_id, disposition, disposition_at", ids))),
    withPremium ? Promise.all(chunks.map((ids) => read("deal_flow", "lead_id, monthly_premium_cents", ids))) : Promise.resolve([] as Row[][]),
  ]);
  const facts = new Map<string, LeadWorkFacts>(leadIds.map((id) => [id, { ownerUserId: null, ownerName: null, disposition: null, dispositionAt: null, stageEnteredAt: null, monthlyPremiumCents: null }]));
  for (const row of queue.flat()) {
    const entry = facts.get(String(row.lead_id));
    if (!entry) continue;
    if (typeof row.owner_user_id === "string") entry.ownerUserId = row.owner_user_id;
    if (typeof row.disposition === "string") entry.disposition = row.disposition;
    if (typeof row.disposition_at === "string") entry.dispositionAt = row.disposition_at;
  }
  for (const row of deals.flat()) {
    const entry = facts.get(String(row.lead_id));
    if (entry && row.monthly_premium_cents != null) entry.monthlyPremiumCents = Number(row.monthly_premium_cents);
  }
  // When each lead entered its stage (migration 20260925100000). Absent before it is applied, and
  // then "in stage" is simply unknown — never guessed from another timestamp.
  const entered = await Promise.all(chunks.map((ids) => db.from("agent_leads").select("id, stage_entered_at").eq("tenant_id", tenantId).in("id", ids)));
  for (const page of entered) {
    if (page.error) break;
    for (const row of page.data ?? []) {
      const entry = facts.get(String(row.id));
      if (entry && typeof row.stage_entered_at === "string") entry.stageEnteredAt = row.stage_entered_at;
    }
  }
  // Owner names, for the table and list: one read for the distinct owners.
  const ownerIds = [...new Set([...facts.values()].map((fact) => fact.ownerUserId).filter((id): id is string => Boolean(id)))];
  if (ownerIds.length) {
    const users = await db.from("users").select("id, name").in("id", ownerIds);
    const names = new Map((users.error ? [] : users.data ?? []).map((row) => [String(row.id), String(row.name ?? "")]));
    for (const fact of facts.values()) if (fact.ownerUserId) fact.ownerName = names.get(fact.ownerUserId) || null;
  }
  return facts;
}
