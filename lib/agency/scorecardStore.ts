import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { advanceAtRiskByPolicy } from "@/lib/ingestion/commissionLedgerStore";
import { loadScorecards } from "@/lib/ingestion/scorecardsStore";
import { historyStart, issued as isIssued, persistency, placed as isPlaced, type Bucket, type ScorePolicy } from "@/lib/ingestion/scorecards";
import { perPolicy, persisting, chargebackTax, type PerPolicy, type Persisting } from "@/lib/accounting/pnlCore";
import { allocateLeadCost, countOrPercent, type Assignment } from "./scorecardCore";
import { scopeFor, type ProducerScope } from "./visibility";
import { allRows } from "@/lib/ingestion/pages";
import { bucketOf, issueMonths, periodBuckets, type Bucket as PeriodBucket } from "./scorecardView";

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
  m4: { alive: number; eligible: number; building: boolean; readyOn: string | null; text: string };
  m13: { alive: number; eligible: number; building: boolean; readyOn: string | null; text: string };
  chargebackCents: number;
  advanceAtRiskCents: number;
  leadSpendCents: number;
  costPerIssued: PerPolicy;
  costPerPersisting: Persisting;
  chargebackTaxCents: number | null;
};

/**
 * Reports round 7 (owner pick 0·C, 2026-11-11): the series under the cards, for the producers shown. Submitted and
 * issued by week of the period (months past 26 weeks), on the dates the cards count them; chargebacks and the
 * advance at risk, which carry no date of their own, by the ISSUE month of the policy they belong to (the twelve
 * months to the period's end).
 */
export type ScoreSeries = {
  buckets: PeriodBucket[];
  submitted: number[];
  issued: number[];
  months: PeriodBucket[];
  chargebackCents: number[];
  atRiskCents: number[];
};

/** Every row of an ordered read, in the `{ data }` shape the reads around it use; a failed read is empty, as before. */
async function readAll(build: () => unknown): Promise<{ data: unknown[] | null }> {
  const { rows, error } = await allRows(build);
  return { data: error ? null : rows };
}

/** `options.scope`: the session's scope (or its read in flight) when the caller already asked for it. */
export async function producerScores(context: { tenantId: string; userId: string; role: string }, period: { from: string; to: string }, minSampleOverride?: number, options: { scope?: ProducerScope | Promise<ProducerScope>; series?: boolean } = {}): Promise<{ available: boolean; rows: ProducerScore[]; minSample: number; series?: ScoreSeries }> {
  // LA-4.18 is asked for the whole book (its own producer filter keys on role "producer" only); the AG-0.4 scope
  // below then keeps exactly the producers this person may see, managers' reports included.
  // None of these reads depends on another, so they are one round trip (they used to be four in a row).
  // lead spend per campaign in the period (LA-7 cost ledger, positive), and who each lead was ASSIGNED to
  const [scope, data, { data: producers }, { data: costs }, { data: queue }, { data: risk }, { data: subs }] = await Promise.all([
    options.scope !== undefined ? options.scope : scopeFor(context),
    loadScorecards({ tenantId: context.tenantId, userId: context.userId, role: "owner" }, period, { withSpend: false }),
    db().from("producer").select("user_id, display_name, status").eq("tenant_id", context.tenantId).neq("status", "invited"),
    // The API answers at most 1,000 rows a request, so the sums below read every page, each ordered along a
    // tenant-leading index with a unique tail (a .limit() above 1,000 used to stop at 1,000 without saying so).
    readAll(() => db().from("cost_entry").select("campaign_id, amount_cents").eq("tenant_id", context.tenantId).eq("entry_type", "lead_cost").gte("incurred_on", period.from).lte("incurred_on", period.to).order("incurred_on").order("id")),
    readAll(() => db().from("lead_queue").select("owner_user_id, agent_leads(campaign_id)").eq("tenant_id", context.tenantId).not("owner_user_id", "is", null).gte("created_at", `${period.from}T00:00:00Z`).lte("created_at", `${period.to}T23:59:59Z`).order("status").order("queued_at").order("lead_id")),
    // LA-4.12: the unearned advance is worked out from the ledger (policy_current's money columns are never filled).
    advanceAtRiskByPolicy(context.tenantId).then((rows) => ({ data: rows ? rows.filter((r) => r.inClawbackWindow) : null })),
    readAll(() => db().from("tenant_application_submissions").select("application_id, submitted_at, tenant_applications(case_id, tenant_application_cases(opened_by))").eq("tenant_id", context.tenantId).gte("submitted_at", `${period.from}T00:00:00Z`).lte("submitted_at", `${period.to}T23:59:59Z`).order("submitted_at").order("application_id")),
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
  for (const r of risk ?? []) if (r.agentUserId) atRisk.set(r.agentUserId, (atRisk.get(r.agentUserId) ?? 0) + Number(r.atRiskCents ?? 0));
  const submittedBy = new Map<string, number>();
  const submittedOn: Array<{ opener: string; day: string }> = [];
  for (const s of (subs ?? []) as Array<Record<string, unknown>>) {
    const opener = ((s.tenant_applications as { tenant_application_cases?: { opened_by?: string } } | null)?.tenant_application_cases?.opened_by) ?? null;
    if (opener) submittedBy.set(opener, (submittedBy.get(opener) ?? 0) + 1);
    if (opener && typeof s.submitted_at === "string") submittedOn.push({ opener, day: s.submitted_at.slice(0, 10) });
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
      m4: { alive: m4.alive, eligible: m4.eligible, building: m4.building, readyOn: m4.readyOn ?? null, text: m4.building ? "Building" : countOrPercent(m4.alive, m4.eligible, minSample) },
      m13: { alive: m13.alive, eligible: m13.eligible, building: m13.building, readyOn: m13.readyOn ?? null, text: m13.building ? "Building" : countOrPercent(m13.alive, m13.eligible, minSample) },
      chargebackCents: chargeback,
      advanceAtRiskCents: atRisk.get(p.user_id) ?? 0,
      leadSpendCents: spendCents,
      costPerIssued: costIssued,
      costPerPersisting: costLasting,
      chargebackTaxCents: chargebackTax(costIssued, costLasting),
    };
  });
  const sorted = rows.sort((a, b) => a.name.localeCompare(b.name));
  if (!options.series) return { available: true, rows: sorted, minSample };

  // The series count exactly what the cards sum: the producers shown, nobody else.
  const shown = new Set(visible.map((p) => p.user_id));
  const buckets = periodBuckets(period);
  const months = issueMonths(period.to);
  const submitted = buckets.map(() => 0);
  for (const s of submittedOn) {
    const at = shown.has(s.opener) ? bucketOf(buckets, s.day) : -1;
    if (at >= 0) submitted[at] += 1;
  }
  const issuedSeries = buckets.map(() => 0);
  const chargebackCents = months.map(() => 0);
  const issueDayOf = new Map<string, string | null>();
  for (const x of data.policies as ScorePolicy[]) {
    if (!shown.has(x.agentKey)) continue;
    issueDayOf.set(`${x.carrierId}|${x.policyNumber}`, x.issueDate);
    if (isIssued(x)) {
      const at = bucketOf(buckets, x.issueDate);
      if (at >= 0) issuedSeries[at] += 1;
    }
    const month = bucketOf(months, x.issueDate);
    if (month >= 0) chargebackCents[month] += Math.abs(x.chargedBackCents ?? 0);
  }
  const atRiskCents = months.map(() => 0);
  for (const r of risk ?? []) {
    if (!r.agentUserId || !shown.has(r.agentUserId)) continue;
    const month = bucketOf(months, issueDayOf.get(`${r.carrierId}|${r.policyNumber}`) ?? null);
    if (month >= 0) atRiskCents[month] += Number(r.atRiskCents ?? 0);
  }
  return { available: true, rows: sorted, minSample, series: { buckets, submitted, issued: issuedSeries, months, chargebackCents, atRiskCents } };
}
