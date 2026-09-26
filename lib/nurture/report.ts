import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getCadence, humanInterval } from "@/lib/cadence/service";
import { effectiveLadder, ladderSummary } from "@/lib/cadence/ladder";
import { DEFAULT_CEILING, SLOTS, type Slot } from "@/lib/cadence/engine";
import { isMissingSchema, listNurtureCampaigns, type NurtureCampaign } from "./service";
import type { RecycleBatch, RecyclePool } from "./contract";

/**
 * Everything the Lead recycling board shows besides the rule itself, read and never written.
 *
 *   · eligible now   the leads `reactivate_nurture` would pick up if run this minute — the same
 *                    filters (state, wait, cap, last disposition, screening outcome), counted here.
 *                    The one filter it cannot apply is the live suppression lookup, which the run
 *                    performs per number; so this is "after caps, before the fresh scrub".
 *   · last run       per campaign, the reactivations that share one `reactivated_at` (the run's
 *                    transaction time), split into cleared / blocked / failed — never one total.
 *   · this month     cleared and blocked reactivations since the first of the month (UTC).
 *   · contact rate   recycled versus fresh, from `tenant_recycle_performance` — the report that
 *                    answers whether recycling works at all.
 *   · cadence        the tenant default ladder as the dialer walks it.
 *   · rotation       one real lead mid-cadence, and which slots it has already failed in.
 *   · pool           per campaign, every worked lead's verdict from recycle_lead_candidates
 *                    (20260925706500) — the same function a batch picks from, so "eligible now" and
 *                    "excluded as too recent" are exactly what a run would do. Before that migration
 *                    the old in-TypeScript count below is used and the pool is null.
 *   · batches        past and running batches with their angle, dials, contacts, contact rate and
 *                    policies (tenant_recycle_batch_report), against the fresh rate over the same span.
 */

export type NurtureRun = { at: string; cleared: number; blocked: number; failed: number; pending: number };
export type NurtureCampaignReport = NurtureCampaign & { eligibleNow: number; lastRun: NurtureRun | null; pool: RecyclePool | null; openBatch: RecycleBatch | null };
export type RotationSlot = { slot: Slot; state: "failed" | "answered" | "next" | "untried"; note: string };
export type ConversionSide = { leads: number; policies: number; percent: number | null };
export type NurtureReport = {
  campaigns: NurtureCampaignReport[];
  totals: { inNurture: number; eligibleNow: number; recycledThisMonth: number; recycledLastMonth: number; blockedThisMonth: number };
  /** Null before 20260925706500. */
  pool: { exhaustedNoOutcome: number; saidNo: number; never: number; tooRecent: number } | null;
  /** Every cleared reactivation ever, with what came of it. Null before 20260925706500. */
  recycledAllTime: { recycled: number; dials: number; contacts: number; leadsReached: number; policies: number; contactRate: number | null } | null;
  batches: RecycleBatch[];
  /** The fresh contact rate since the oldest batch listed — the baseline beside each batch's rate. */
  batchBaseline: number | null;
  viewer: { userId: string; role: string };
  /** False until 20260925706500 is applied: batches cannot be started. */
  batchesReady: boolean;
  contactRate: { recycled: number | null; fresh: number | null } | null;
  /**
   * Conversion, recycled against fresh, all time (LA-2.20-6, W3.5): issued policies per 100 leads
   * worked on each side. Recycled: every cleared reactivation, and the policies issued after one
   * (the batch report's window). Fresh: every lead dialled at least once, and the policies issued
   * with no reactivation before them. The two share one definition of a policy (status issued), so
   * the figures can be read side by side. Null only when the reads fail.
   */
  conversion: { recycled: ConversionSide; fresh: ConversionSide } | null;
  cadence: { steps: Array<{ attempt: number; interval: string | null; slot: string | null; offsetMs: number; source: string }>; first72: number; total: number; usingDefaults: boolean } | null;
  rotation: { leadId: string; leadName: string; attempt: number; ceiling: number; slots: RotationSlot[] } | null;
};

type Row = Record<string, unknown>;
type Result = { data: Row[] | null; error: { message: string } | null };
type Query = PromiseLike<Result> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  gte(column: string, value: unknown): Query;
  gt(column: string, value: unknown): Query;
  lt(column: string, value: unknown): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  range(from: number, to: number): Query;
  limit(count: number): Query;
};
type Db = { from(table: string): Query; rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> };

const text = (value: unknown) => (typeof value === "string" ? value : "");
const PAGE = 1000;
const CHUNK = 150;
const EMPTY_POOL: RecyclePool = { exhaustedNoOutcome: 0, saidNo: 0, never: 0, noPhone: 0, resting: 0, live: 0, pending: 0, beingWorked: 0, capped: 0, outcomeNotInRule: 0, ownerOnly: 0, tooRecent: 0, eligible: 0, eligibleSaidNo: 0 };
const NO_CONTACT = new Set(["no_answer", "voicemail", "busy", "call_dropped", "disconnected", "wrong_number"]);

type RpcOutcome = { data: unknown; error: { message: string; code?: string } | null };
/** An RPC that may not exist yet: its error comes back as a value, never a throw. */
function rpcSafe(db: Db, name: string, args: Record<string, unknown>): Promise<RpcOutcome> {
  return Promise.resolve(db.rpc(name, args)).then((result) => result as RpcOutcome, (error: unknown) => ({ data: null, error: { message: error instanceof Error ? error.message : "failed" } }));
}

async function allRows(build: (start: number) => Query, label: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let start = 0; ; start += PAGE) {
    const { data, error } = await build(start);
    if (error) throw new Error(`Could not load ${label}: ${error.message}`);
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return out;
  }
}

const side = (leads: number, policies: number): ConversionSide => ({ leads, policies, percent: leads > 0 ? Math.round((1000 * policies) / leads) / 10 : null });

/**
 * Recycled against fresh conversion, all time. A policy is a recycled one when a cleared
 * reactivation of its lead completed on or before it was issued (the window
 * tenant_recycle_batch_report counts policies in); every other issued policy is fresh. Read and
 * never written. Null when a read fails: a missing figure, not a zero.
 */
async function conversion(db: Db, tenantId: string): Promise<NurtureReport["conversion"]> {
  try {
    const [policies, reactivations, dialled] = await Promise.all([
      allRows((start) => db.from("tenant_issued_policies").select("id, lead_id, issued_at").eq("tenant_id", tenantId).eq("status", "issued").order("id", { ascending: true }).range(start, start + PAGE - 1), "issued policies"),
      allRows((start) => db.from("tenant_nurture_reactivations").select("id, lead_id, completed_at").eq("tenant_id", tenantId).eq("status", "cleared").order("id", { ascending: true }).range(start, start + PAGE - 1), "cleared reactivations"),
      (db.from("agent_leads") as unknown as { select(columns: string, options: { count: "exact"; head: true }): Query })
        .select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).gt("attempts_made", 0)
        .then((result) => {
          const counted = result as unknown as { count: number | null; error: { message: string } | null };
          if (counted.error) throw new Error(counted.error.message);
          return counted.count ?? 0;
        }),
    ]);
    const firstClearedAt = new Map<string, string>();
    for (const row of reactivations) {
      const at = text(row.completed_at);
      if (!at) continue;
      const lead = text(row.lead_id);
      const current = firstClearedAt.get(lead);
      if (!current || at < current) firstClearedAt.set(lead, at);
    }
    const recycledCount = reactivations.filter((row) => text(row.completed_at)).length;
    let recycledPolicies = 0;
    for (const policy of policies) {
      const cleared = firstClearedAt.get(text(policy.lead_id));
      if (cleared && Date.parse(cleared) <= Date.parse(text(policy.issued_at))) recycledPolicies += 1;
    }
    return { recycled: side(recycledCount, recycledPolicies), fresh: side(dialled, policies.length - recycledPolicies) };
  } catch {
    return null;
  }
}

function monthStart(offset: number) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)).toISOString();
}

export async function nurtureReport(tenantId: string, actor: { userId: string; role: string }): Promise<NurtureReport> {
  const db = getSupabaseServiceClient() as unknown as Db;
  const thisMonth = monthStart(0);
  const lastMonth = monthStart(-1);

  const [campaigns, nurtureLeads, reactivations, performance, cadence, rotationLead, poolResult, batchResult, conversionView] = await Promise.all([
    listNurtureCampaigns(tenantId),
    allRows(
      (start) => db.from("agent_leads").select("id, campaign_id, nurture_entered_at, updated_at, created_at, recycle_count, screening_outcome").eq("tenant_id", tenantId).in("lead_state", ["exhausted", "nurture"]).order("id", { ascending: true }).range(start, start + PAGE - 1),
      "the leads in nurture",
    ),
    allRows(
      (start) => db.from("tenant_nurture_reactivations").select("id, campaign_id, status, reactivated_at").eq("tenant_id", tenantId).gte("reactivated_at", lastMonth).order("reactivated_at", { ascending: false }).range(start, start + PAGE - 1),
      "recent reactivations",
    ),
    db.rpc("tenant_recycle_performance", { p_tenant_id: tenantId, p_actor_user_id: actor.userId, p_actor_role: actor.role, p_agent_user_id: null, p_campaign_id: null, p_disposition: null, p_from_at: thisMonth, p_to_at: null }).then((result) => (result.error ? null : result.data), () => null),
    getCadence(tenantId, { campaignId: null }).catch(() => null),
    // The most recently touched lead still mid-cadence: the example the rotation card explains.
    db.from("agent_leads").select("id, values, attempts_made, next_preferred_slot").eq("tenant_id", tenantId).in("lead_state", ["working", "retry", "nurture"]).gt("attempts_made", 0).lt("attempts_made", DEFAULT_CEILING).order("updated_at", { ascending: false }).limit(1),
    rpcSafe(db, "tenant_recycle_pool", { p_tenant_id: tenantId, p_actor: actor.userId }),
    rpcSafe(db, "tenant_recycle_batch_report", { p_tenant_id: tenantId, p_campaign_id: null, p_limit: 12 }),
    conversion(db, tenantId),
  ]);

  // 20260925706500. A missing function is "not applied yet"; any other failure is an error.
  const batchesReady = !poolResult.error && !batchResult.error;
  if (poolResult.error && !isMissingSchema(poolResult.error)) throw new Error(`Could not read the recycling pool: ${poolResult.error.message}`);
  if (batchResult.error && !isMissingSchema(batchResult.error)) throw new Error(`Could not read past batches: ${batchResult.error.message}`);
  const poolOf = new Map<string, RecyclePool>();
  for (const row of (Array.isArray(poolResult.data) ? poolResult.data : []) as Row[]) {
    const n = (key: string) => Number(row[key] ?? 0);
    poolOf.set(text(row.campaign_id), { exhaustedNoOutcome: n("exhausted_no_outcome"), saidNo: n("said_no"), never: n("never"), noPhone: n("no_phone"), resting: n("resting"), live: n("live"), pending: n("pending"), beingWorked: n("being_worked"), capped: n("capped"), outcomeNotInRule: n("outcome_not_in_rule"), ownerOnly: n("owner_only"), tooRecent: n("too_recent"), eligible: n("eligible"), eligibleSaidNo: n("eligible_said_no") });
  }
  const batchPayload = (batchResult.data && typeof batchResult.data === "object" ? batchResult.data : {}) as { batches?: Row[]; totals?: Row | null };
  const batches: RecycleBatch[] = (batchPayload.batches ?? []).map((row) => ({
    id: text(row.id), campaignId: text(row.campaign_id), campaignName: text(row.campaign_name), angle: text(row.angle), script: text(row.script) || null,
    attemptCeiling: Number(row.attempt_ceiling ?? 3), status: row.status === "screening" ? "screening" : "complete", createdAt: text(row.created_at), completedAt: text(row.completed_at) || null,
    lastProgressAt: text(row.last_progress_at), stalled: row.stalled === true, createdBy: text(row.created_by) || null, createdByName: text(row.created_by_name) || null,
    queued: Number(row.queued ?? 0), cleared: Number(row.cleared ?? 0), blocked: Number(row.blocked ?? 0), failed: Number(row.failed ?? 0), pending: Number(row.pending ?? 0),
    excludedTooRecent: Number(row.excluded_too_recent ?? 0), saidNo: Number(row.said_no ?? 0), costCents: Number(row.cost_cents ?? 0),
    dials: Number(row.dials ?? 0), contacts: Number(row.contacts ?? 0), leadsReached: Number(row.leads_reached ?? 0), policies: Number(row.policies ?? 0),
    contactRate: row.contact_rate_percent == null ? null : Number(row.contact_rate_percent),
  }));
  const allTime = batchPayload.totals ?? null;
  // The fresh baseline over the same span as the batches listed, by tenant_recycle_performance's own
  // definition (contacts per clicked dial) — the one each batch's rate uses too.
  const oldest = batches.length ? batches[batches.length - 1].createdAt : null;
  const baselineRows = oldest
    ? await db.rpc("tenant_recycle_performance", { p_tenant_id: tenantId, p_actor_user_id: actor.userId, p_actor_role: actor.role, p_agent_user_id: null, p_campaign_id: null, p_disposition: null, p_from_at: oldest, p_to_at: null }).then((result) => (result.error ? null : result.data), () => null)
    : null;
  const baselineRow = (Array.isArray(baselineRows) ? (baselineRows as Row[]) : []).find((row) => row.source_type === "fresh");
  const batchBaseline = baselineRow && baselineRow.contact_rate_percent != null ? Number(baselineRow.contact_rate_percent) : null;

  // Last disposition per lead in nurture, read for those leads only.
  const lastDisposition = new Map<string, string>();
  const ids = nurtureLeads.map((lead) => text(lead.id));
  const chunks: string[][] = [];
  for (let start = 0; start < ids.length; start += CHUNK) chunks.push(ids.slice(start, start + CHUNK));
  const attemptPages = await Promise.all(chunks.map((chunk) => db.from("tenant_call_attempts").select("lead_id, disposition, attempted_at").eq("tenant_id", tenantId).in("lead_id", chunk).order("attempted_at", { ascending: false })));
  for (const page of attemptPages) {
    if (page.error) throw new Error(`Could not load the last outcome of each lead: ${page.error.message}`);
    for (const row of page.data ?? []) if (!lastDisposition.has(text(row.lead_id))) lastDisposition.set(text(row.lead_id), text(row.disposition));
  }

  const ruleOf = new Map(campaigns.map((campaign) => [campaign.campaign_id, campaign.rule]));
  const eligible = new Map<string, number>();
  const now = Date.now();
  for (const lead of nurtureLeads) {
    const campaignId = text(lead.campaign_id);
    const rule = ruleOf.get(campaignId);
    if (!rule) continue;
    const entered = Date.parse(text(lead.nurture_entered_at) || text(lead.updated_at) || text(lead.created_at));
    if (!(entered <= now - rule.wait_days * 86_400_000)) continue;
    if (Number(lead.recycle_count ?? 0) >= rule.max_recycles) continue;
    if (!rule.allowed_dispositions.includes(lastDisposition.get(text(lead.id)) ?? "")) continue;
    if (["dnc", "tcpa_litigator"].includes(text(lead.screening_outcome))) continue;
    eligible.set(campaignId, (eligible.get(campaignId) ?? 0) + 1);
  }

  // A run is every reactivation one call to reactivate_nurture wrote: same campaign, same instant.
  const runs = new Map<string, NurtureRun>();
  let recycledThisMonth = 0, recycledLastMonth = 0, blockedThisMonth = 0;
  for (const row of reactivations) {
    const at = text(row.reactivated_at);
    const status = text(row.status);
    const inThisMonth = at >= thisMonth;
    if (status === "cleared") { if (inThisMonth) recycledThisMonth += 1; else recycledLastMonth += 1; }
    if (status === "blocked" && inThisMonth) blockedThisMonth += 1;
    const campaignId = text(row.campaign_id);
    const current = runs.get(campaignId);
    if (current && current.at !== at) continue;
    const run = current ?? { at, cleared: 0, blocked: 0, failed: 0, pending: 0 };
    if (status === "cleared" || status === "blocked" || status === "failed" || status === "pending") run[status] += 1;
    runs.set(campaignId, run);
  }

  const performanceRows = Array.isArray(performance) ? (performance as Row[]) : [];
  const rateOf = (kind: string) => { const row = performanceRows.find((item) => item.source_type === kind); return row && row.contact_rate_percent != null ? Number(row.contact_rate_percent) : null; };

  let cadenceView: NurtureReport["cadence"] = null;
  if (cadence) {
    const steps = effectiveLadder(cadence.rows, [], { lastAttempt: cadence.schemaReady ? DEFAULT_CEILING : 6 });
    const summary = ladderSummary(steps);
    cadenceView = {
      steps: steps.map((step) => ({ attempt: step.attempt, interval: step.delayInterval ? humanInterval(step.delayInterval) : null, slot: step.preferredSlot, offsetMs: step.offsetMs, source: step.source })),
      first72: summary.first72,
      total: summary.total,
      usingDefaults: cadence.usingDefaults,
    };
  }

  let rotation: NurtureReport["rotation"] = null;
  const lead = rotationLead.error ? undefined : (rotationLead.data ?? [])[0];
  if (lead) {
    const history = await db.from("tenant_call_attempts").select("slot, disposition, attempted_at").eq("tenant_id", tenantId).eq("lead_id", text(lead.id)).order("attempted_at", { ascending: true });
    const tried = new Map<string, string>();
    for (const row of history.error ? [] : history.data ?? []) tried.set(text(row.slot), text(row.disposition));
    const next = text(lead.next_preferred_slot);
    const values = (lead.values ?? {}) as Record<string, unknown>;
    const name = text(values.full_name) || [text(values.first_name), text(values.last_name)].filter(Boolean).join(" ") || "Unnamed lead";
    rotation = {
      leadId: text(lead.id),
      leadName: name,
      attempt: Number(lead.attempts_made ?? 0) + 1,
      ceiling: DEFAULT_CEILING,
      slots: SLOTS.map((slot) => {
        if (tried.has(slot)) {
          const outcome = tried.get(slot) ?? "";
          return NO_CONTACT.has(outcome) || !outcome
            ? { slot, state: "failed" as const, note: outcome ? `tried, ${outcome.replace(/_/g, " ")}` : "tried" }
            : { slot, state: "answered" as const, note: `reached, ${outcome.replace(/_/g, " ")}` };
        }
        if (slot === next) return { slot, state: "next" as const, note: "next" };
        return { slot, state: "untried" as const, note: "untried" };
      }),
    };
  }

  const withRuns = campaigns.map((campaign) => {
    const pool = poolOf.get(campaign.campaign_id) ?? (batchesReady ? EMPTY_POOL : null);
    return {
      ...campaign,
      eligibleNow: pool ? pool.eligible : eligible.get(campaign.campaign_id) ?? 0,
      lastRun: runs.get(campaign.campaign_id) ?? null,
      pool,
      openBatch: batches.find((batch) => batch.campaignId === campaign.campaign_id && batch.status === "screening") ?? null,
    };
  });
  const poolTotals = batchesReady
    ? [...poolOf.values()].reduce((sum, pool) => ({ exhaustedNoOutcome: sum.exhaustedNoOutcome + pool.exhaustedNoOutcome, saidNo: sum.saidNo + pool.saidNo, never: sum.never + pool.never, tooRecent: sum.tooRecent + pool.tooRecent }), { exhaustedNoOutcome: 0, saidNo: 0, never: 0, tooRecent: 0 })
    : null;
  return {
    campaigns: withRuns,
    totals: {
      inNurture: campaigns.reduce((sum, campaign) => sum + campaign.eligible_count, 0),
      eligibleNow: withRuns.reduce((sum, campaign) => sum + campaign.eligibleNow, 0),
      recycledThisMonth,
      recycledLastMonth,
      blockedThisMonth,
    },
    contactRate: performanceRows.length ? { recycled: rateOf("recycled"), fresh: rateOf("fresh") } : null,
    conversion: conversionView,
    cadence: cadenceView,
    rotation,
    pool: poolTotals,
    recycledAllTime: allTime ? { recycled: Number(allTime.recycled ?? 0), dials: Number(allTime.dials ?? 0), contacts: Number(allTime.contacts ?? 0), leadsReached: Number(allTime.leads_reached ?? 0), policies: Number(allTime.policies ?? 0), contactRate: allTime.contact_rate_percent == null ? null : Number(allTime.contact_rate_percent) } : null,
    batches,
    batchBaseline,
    viewer: { userId: actor.userId, role: actor.role },
    batchesReady,
  };
}
