import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { loadScorecards } from "@/lib/ingestion/scorecardsStore";
import { historyStart, issued as isIssued, persistency, placed as isPlaced, type Bucket, type ScorePolicy } from "@/lib/ingestion/scorecards";
import { perPolicy, persisting, chargebackTax, type PerPolicy, type Persisting } from "@/lib/accounting/pnlCore";
import { allocateLeadCost, countOrPercent, type Assignment } from "./scorecardCore";
import { scopeFor } from "./visibility";
import { allRows } from "@/lib/ingestion/pages";

/**
 * AG-1.9 / AG-0.11 · per-producer figures, grouped from the engines that already compute them (see scorecardCore).
 * Scoped by AG-0.4: a producer sees his own row, a manager his reports', owner / admin / bookkeeper everyone's —
 * nobody sees a ranking he is not in.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseServiceClient() as any;

export type ProducerScore = {
  producerUserId: string;
  name: string;
  submitted: number;
  issued: number;
  placed: number;
  placement: string;
  m4: { alive: number; eligible: number; building: boolean; text: string };
  m13: { alive: number; eligible: number; building: boolean; text: string };
  chargebackCents: number;
  advanceAtRiskCents: number;
  leadSpendCents: number;
  costPerIssued: PerPolicy;
  costPerPersisting: Persisting;
  chargebackTaxCents: number | null;
};

/** Every row of an ordered read, in the `{ data }` shape the reads around it use; a failed read is empty, as before. */
async function readAll(build: () => unknown): Promise<{ data: unknown[] | null }> {
  const { rows, error } = await allRows(build);
  return { data: error ? null : rows };
}

export async function producerScores(context: { tenantId: string; userId: string; role: string }, period: { from: string; to: string }, minSampleOverride?: number): Promise<{ available: boolean; rows: ProducerScore[]; minSample: number }> {
  // LA-4.18 is asked for the whole book (its own producer filter keys on role "producer" only); the AG-0.4 scope
  // below then keeps exactly the producers this person may see, managers' reports included.
  // None of these reads depends on another, so they are one round trip (they used to be four in a row).
  // lead spend per campaign in the period (LA-7 cost ledger, positive), and who each lead was ASSIGNED to
  const [scope, data, { data: producers }, { data: costs }, { data: queue }, { data: risk }, { data: subs }] = await Promise.all([
    scopeFor(context),
    loadScorecards({ tenantId: context.tenantId, userId: context.userId, role: "owner" }, period, { withSpend: false }),
    db().from("producer").select("user_id, display_name, status").eq("tenant_id", context.tenantId).neq("status", "invited"),
    // The API answers at most 1,000 rows a request, so the sums below read every page, each ordered along a
    // tenant-leading index with a unique tail (a .limit() above 1,000 used to stop at 1,000 without saying so).
    readAll(() => db().from("cost_entry").select("campaign_id, amount_cents").eq("tenant_id", context.tenantId).eq("entry_type", "lead_cost").gte("incurred_on", period.from).lte("incurred_on", period.to).order("incurred_on").order("id")),
    readAll(() => db().from("lead_queue").select("owner_user_id, agent_leads(campaign_id)").eq("tenant_id", context.tenantId).not("owner_user_id", "is", null).gte("created_at", `${period.from}T00:00:00Z`).lte("created_at", `${period.to}T23:59:59Z`).order("status").order("queued_at").order("lead_id")),
    readAll(() => db().from("policy_current").select("agent_user_id, unearned_advance_cents").eq("tenant_id", context.tenantId).eq("in_clawback_window", true).order("carrier_id").order("policy_number")),
    readAll(() => db().from("tenant_application_submissions").select("application_id, tenant_applications(case_id, tenant_application_cases(opened_by))").eq("tenant_id", context.tenantId).gte("submitted_at", `${period.from}T00:00:00Z`).lte("submitted_at", `${period.to}T23:59:59Z`).order("submitted_at").order("application_id")),
  ]);
  if (!("policies" in data)) return { available: false, rows: [], minSample: 0 };
  const minSample = minSampleOverride ?? data.minSample;
  const today = data.today;
  const start = historyStart(data.policies);

  const visible = ((producers ?? []) as Array<{ user_id: string; display_name: string }>).filter((p) => scope === null || scope.includes(p.user_id));

  const spend = new Map<string, number>();
  for (const c of (costs ?? []) as Array<{ campaign_id: string | null; amount_cents: number }>) if (c.campaign_id) spend.set(c.campaign_id, (spend.get(c.campaign_id) ?? 0) - Number(c.amount_cents));
  const assignments: Assignment[] = ((queue ?? []) as Array<{ owner_user_id: string; agent_leads: { campaign_id: string | null } | null }>)
    .filter((q) => q.agent_leads?.campaign_id)
    .map((q) => ({ campaignId: q.agent_leads!.campaign_id as string, producerUserId: q.owner_user_id }));
  const leadSpend = allocateLeadCost(spend, assignments);
  const atRisk = new Map<string, number>();
  for (const r of (risk ?? []) as Array<{ agent_user_id: string | null; unearned_advance_cents: number | null }>) if (r.agent_user_id) atRisk.set(r.agent_user_id, (atRisk.get(r.agent_user_id) ?? 0) + Number(r.unearned_advance_cents ?? 0));
  const submittedBy = new Map<string, number>();
  for (const s of (subs ?? []) as Array<Record<string, unknown>>) {
    const opener = ((s.tenant_applications as { tenant_application_cases?: { opened_by?: string } } | null)?.tenant_application_cases?.opened_by) ?? null;
    if (opener) submittedBy.set(opener, (submittedBy.get(opener) ?? 0) + 1);
  }

  const rows = visible.map((p) => {
    const mine = data.policies.filter((x: ScorePolicy) => x.agentKey === p.user_id);
    const inPeriod = mine.filter((x) => x.issueDate && x.issueDate >= period.from && x.issueDate <= period.to);
    const issuedN = inPeriod.filter(isIssued).length;
    const placedN = inPeriod.filter(isPlaced).length;
    const m4 = persistency(mine, 4 as Bucket, today, start);
    const m13 = persistency(mine, 13 as Bucket, today, start);
    const chargeback = mine.reduce((s, x) => s + (x.chargedBackCents ?? 0), 0);
    const spendCents = leadSpend.get(p.user_id) ?? 0;
    const costIssued = perPolicy(-spendCents, issuedN, minSample);
    const alive4 = persistency(inPeriod, 4 as Bucket, today, start);
    const costLasting = persisting({ range: { from: period.from, to: period.to, label: "" }, horizon: 4, today, acquisitionCents: -spendCents, issued: issuedN, alive: alive4.alive, cohortBuilding: alive4.building, threshold: minSample });
    return {
      producerUserId: p.user_id,
      name: p.display_name,
      submitted: submittedBy.get(p.user_id) ?? 0,
      issued: issuedN,
      placed: placedN,
      placement: countOrPercent(placedN, issuedN, minSample),
      m4: { alive: m4.alive, eligible: m4.eligible, building: m4.building, text: m4.building ? "Building" : countOrPercent(m4.alive, m4.eligible, minSample) },
      m13: { alive: m13.alive, eligible: m13.eligible, building: m13.building, text: m13.building ? "Building" : countOrPercent(m13.alive, m13.eligible, minSample) },
      chargebackCents: chargeback,
      advanceAtRiskCents: atRisk.get(p.user_id) ?? 0,
      leadSpendCents: spendCents,
      costPerIssued: costIssued,
      costPerPersisting: costLasting,
      chargebackTaxCents: chargebackTax(costIssued, costLasting),
    };
  });
  return { available: true, rows: rows.sort((a, b) => a.name.localeCompare(b.name)), minSample };
}
