import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { PartnerLeadDetail, PartnerLeadFacets, PartnerLeadFilters, PartnerLeadRow, PartnerPipelineStage } from "@/lib/partnerLeads/types";
import type { PartnerRole } from "@/lib/partnerAuth/roles";
import { maskSensitiveValues } from "@/lib/partnerLeads/mask";
import { CONVERTED_WINDOW_MS, HELD_STATUSES, NOBODY_CLAIMED_LABEL, SALE_DISPOSITIONS, nobodyClaimed, partnerLane, type PartnerLaneCounts } from "./lanes";
import { countersFromLanes, startOfTodayIn } from "./counters";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type QueueRow = {
  id: string;
  lead_id: string;
  partner_id: string | null;
  product_line: string;
  status: string;
  claimed_by: string | null;
  owner_user_id: string | null;
  claimed_at: string | null;
  queued_at: string;
  disposition: string | null;
  disposition_at: string | null;
  pipeline_id: string;
  stage_id: string;
  updated_at: string;
};

type LeadRow = { id: string; values: unknown; created_by: string | null; created_at: string; updated_at: string; product_line: string; pipeline_id: string; stage_id: string };
type DealRow = { lead_id: string; notes: string | null; call_result: string | null; disposition_at: string | null; disposition_by: string | null; updated_at: string };
type StageRow = { id: string; pipeline_id: string; name: string; position: number; stage_type: string; color: string; is_archived: boolean };
type PipelineRow = { id: string; name: string };
type UserRow = { id: string; name: string };
type DispositionRow = { disposition_key: string; label: string };
export type PartnerLeadAccess = { userId: string; role: PartnerRole };

const PARTNER_OUTCOME_LABELS: Record<string, string> = {
  application_submitted: "Application submitted",
  call_ended: "Call ended",
  not_interested: "Not interested",
  unable_to_reach: "Unable to reach",
  declined: "Declined",
  declined_underwriting: "Declined by underwriting",
  previously_sold: "Previously sold",
  did_not_qualify: "Did not qualify",
  application_withdrawn: "Application withdrawn",
};

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function partnerOutcomeLabel(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return PARTNER_OUTCOME_LABELS[normalized] ?? titleCase(normalized);
}

/** Translate internal LA pipeline vocabulary into a partner-safe progress label. */
export function partnerStageLabel(stageName: string, stageType: string, _status?: string, outcome?: string | null) {
  const normalized = stageName.trim().toLowerCase().replace(/[_-]+/g, " ");
  const outcomeValue = (outcome ?? "").toLowerCase();
  if (/^application[ _]submitted$/.test(outcomeValue)) return "Application submitted";
  if (stageType === "won" || /\b(issued|completed|converted|sold)\b/.test(normalized)) return "Completed";
  if (stageType === "lost" || /\b(closed|declined|not interested|did not qualify|previously sold|withdrawn|returned|disqualified)\b/.test(normalized)) return "Closed";
  if (/\b(need.*input|incomplete|information requested|customer response)\b/.test(normalized)) return "Needs your input";
  if (/\b(review|verification|screening|pending approval)\b/.test(normalized)) return "In review";
  if (/\b(claimed|contacted|call|qualified|working|progress|callback)\b/.test(normalized)) return "In progress";
  if (/\b(new|submitted|referred|form lead|transfer)\b/.test(normalized)) return "Submitted";
  return titleCase(stageName);
}
function objectValues(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function displayName(value: unknown) {
  const values = objectValues(value);
  return String(values.full_name || [values.first_name, values.last_name].filter(Boolean).join(" ") || values.name || "Unnamed lead").slice(0, 160);
}

function isoDate(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new Error(`${label} must be a valid date`);
  return value;
}

function validateFilter(filters: PartnerLeadFilters) {
  if (filters.dateFrom) filters.dateFrom = isoDate(filters.dateFrom, "Start date");
  if (filters.dateTo) filters.dateTo = isoDate(filters.dateTo, "End date");
  for (const [key, value] of Object.entries(filters)) if (value && (key.endsWith("Id") && !UUID.test(value) || value.length > 120)) throw new Error("Choose valid pipeline filters");
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) throw new Error("Start date must be on or before end date");
}

async function loadPartnerData(tenantId: string, partnerId: string, filters: PartnerLeadFilters, leadId?: string, withTimeline = false) {
  validateFilter(filters);
  const db = getSupabaseServiceClient();
  const queuePage = async (start: number) => {
    let query = db.from("lead_queue").select("id, lead_id, partner_id, product_line, status, claimed_by, owner_user_id, claimed_at, queued_at, disposition, disposition_at, pipeline_id, stage_id, updated_at").eq("tenant_id", tenantId).eq("partner_id", partnerId).order("queued_at", { ascending: false }).range(start, start + 999);
    if (leadId) query = query.eq("lead_id", leadId);
    if (filters.dateFrom) query = query.gte("queued_at", `${filters.dateFrom}T00:00:00.000Z`);
    if (filters.dateTo) { const end = new Date(`${filters.dateTo}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate() + 1); query = query.lt("queued_at", end.toISOString()); }
    if (filters.product) query = query.eq("product_line", filters.product);
    if (filters.stageId) query = query.eq("stage_id", filters.stageId);
    if (filters.outcome) query = query.eq("disposition", filters.outcome);
    return query;
  };
  const firstQueues = await queuePage(0);
  if (firstQueues.error) throw new Error(`Could not load partner leads: ${firstQueues.error.message}`);
  const queueResults = firstQueues.data?.length === 1000 ? await Promise.all([1, 2, 3, 4].map((page) => queuePage(page * 1000))) : [];
  const queueRows = [(firstQueues.data ?? []), ...queueResults.map((result) => { if (result.error) throw new Error(`Could not load partner leads: ${result.error.message}`); return result.data ?? []; })].flat() as QueueRow[];
  const leadIds = queueRows.map((row) => row.lead_id);
  if (!leadIds.length) return { queues: [], leads: [], deals: [], stages: [], pipelines: [], users: [], dispositions: [], timelineMessages: null };
  const leadsPage = (start: number) => { let query = db.from("agent_leads").select("id, values, created_by, created_at, updated_at, product_line, pipeline_id, stage_id").eq("tenant_id", tenantId).eq("partner_id", partnerId).order("created_at", { ascending: false }).range(start, start + 999); if (leadId) query = query.eq("id", leadId); return query; };
  const dealsPage = (start: number) => { let query = db.from("deal_flow").select("lead_id, notes, call_result, disposition_at, disposition_by, updated_at").eq("tenant_id", tenantId).eq("partner_id", partnerId).order("updated_at", { ascending: false }).range(start, start + 999); if (leadId) query = query.eq("lead_id", leadId); return query; };
  const [firstLeads, firstDeals, stages, pipelines, partnerMembers, dispositions, timelineMessages] = await Promise.all([
    leadsPage(0),
    dealsPage(0),
    db.from("tenant_pipeline_stages").select("id, pipeline_id, name, position, stage_type, color, is_archived").in("id", [...new Set(queueRows.map((row) => row.stage_id))]),
    db.from("tenant_pipelines").select("id, name").eq("tenant_id", tenantId).in("id", [...new Set(queueRows.map((row) => row.pipeline_id))]),
    db.from("partner_users").select("user_id").eq("tenant_id", tenantId).eq("partner_id", partnerId).eq("status", "active"),
    db.from("dispositions").select("disposition_key, label").eq("tenant_id", tenantId),
    // Detail view only: the timeline needs just the queue id, so it rides this batch. The
    // caller still runs its created_by check before anything from it is returned.
    withTimeline && leadId ? db.from("partner_messages").select("id, message, message_kind, created_at, created_by, event_key").eq("tenant_id", tenantId).eq("partner_id", partnerId).eq("work_item_id", queueRows[0].id).order("created_at") : Promise.resolve(null),
  ]);
  const [leadPages, dealPages] = await Promise.all([
    firstLeads.data?.length === 1000 ? Promise.all([1, 2, 3, 4].map((page) => leadsPage(page * 1000))) : Promise.resolve([]),
    firstDeals.data?.length === 1000 ? Promise.all([1, 2, 3, 4].map((page) => dealsPage(page * 1000))) : Promise.resolve([]),
  ]);
  const leadData = [firstLeads, ...leadPages];
  const dealData = [firstDeals, ...dealPages];
  const failure = [...leadData, ...dealData, stages, pipelines, partnerMembers, dispositions].find((result) => result.error);
  if (failure?.error) throw new Error(`Could not load partner pipeline: ${failure.error.message}`);
  const userIds = new Set<string>((partnerMembers.data ?? []).map((row) => row.user_id));
  for (const queue of queueRows) { if (queue.owner_user_id) userIds.add(queue.owner_user_id); if (queue.claimed_by) userIds.add(queue.claimed_by); }
  const users = await db.from("users").select("id, name").in("id", [...userIds]);
  if (users.error) throw new Error(`Could not load partner closers: ${users.error.message}`);
  return { queues: queueRows, leads: leadData.flatMap((result) => result.data ?? []) as LeadRow[], deals: dealData.flatMap((result) => result.data ?? []) as DealRow[], stages: (stages.data ?? []) as StageRow[], pipelines: (pipelines.data ?? []) as PipelineRow[], users: (users.data ?? []) as UserRow[], dispositions: (dispositions.data ?? []) as DispositionRow[], timelineMessages };
}

function mapRows(data: Awaited<ReturnType<typeof loadPartnerData>>, filters: PartnerLeadFilters): PartnerLeadRow[] {
  const leads = new Map(data.leads.map((row) => [row.id, row]));
  const deals = new Map(data.deals.map((row) => [row.lead_id, row]));
  const stages = new Map(data.stages.map((row) => [row.id, row]));
  const users = new Map(data.users.map((row) => [row.id, row.name]));
  const dispositions = new Map(data.dispositions.map((row) => [row.disposition_key, row.label]));
  return data.queues.flatMap((queue) => {
    const lead = leads.get(queue.lead_id);
    const stage = stages.get(queue.stage_id);
    if (!lead || !stage) return [];
    if (filters.closerId && lead.created_by !== filters.closerId) return [];
    const deal = deals.get(queue.lead_id);
    const outcome = queue.disposition ? partnerOutcomeLabel(dispositions.get(queue.disposition) ?? queue.disposition) : null;
    return [{ id: lead.id, workItemId: queue.id, customer: displayName(lead.values), submittedAt: lead.created_at, updatedAt: queue.updated_at, product: queue.product_line, stageId: stage.id, stageName: partnerStageLabel(stage.name, stage.stage_type, queue.status, queue.disposition), stageType: stage.stage_type, disposition: queue.disposition, outcome, outcomeNote: deal?.notes ?? null, submittedBy: { id: lead.created_by, name: lead.created_by ? users.get(lead.created_by) ?? "Partner closer" : "Partner closer" }, status: queue.status }];
  });
}

/**
 * When the longest-waiting open submission was queued — "Still open 19 · oldest 6 days" on the
 * partner overview. Open means what the Still open counter means (counters.ts):
 * the board's open lanes (unclaimed, or held by a closer), scoped to one closer for a partner user.
 * A separate read rather than a new field on that database function, which this environment
 * cannot migrate. Null when nothing is open or the read fails: a missing age is better than a
 * wrong one, and the count beside it still stands.
 */
/**
 * The four lane figures and the set of work items on a call, under the same scope as the page:
 * the partner, the closer a partner user is limited to, and the product and date filters. Stage
 * and outcome filters narrow to the agency's own vocabulary, which the lanes do not speak, so with
 * either set the figures are withheld (null) rather than shown for a different set of leads.
 * Two reads beside partner_lead_pipeline_page, whose counters cannot be changed here.
 */
/**
 * The work items on this page that the SLA ladder has already told the partner about — their row
 * then reads "Nobody claimed it" (lanes.ts). A read beside the page RPC, whose columns are fixed.
 * A failure leaves the stage names as they are: the label is a courtesy, never a gate.
 */
async function partnerToldIds(
  db: ReturnType<typeof getSupabaseServiceClient>,
  tenantId: string,
  partnerId: string,
  workItemIds: string[],
): Promise<Set<string>> {
  if (workItemIds.length === 0) return new Set();
  // The SLA columns are not in the generated types; keep the untyped read to this one query.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("lead_queue")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("partner_id", partnerId)
    .in("id", workItemIds.slice(0, 1000))
    .in("status", ["unclaimed", "expired"])
    .not("sla_partner_notified_at", "is", null);
  if (error) return new Set();
  return new Set(((data ?? []) as Array<{ id: string }>).map((row) => row.id));
}

async function partnerLaneFigures(
  db: ReturnType<typeof getSupabaseServiceClient>,
  tenantId: string,
  partnerId: string,
  closerId: string | null,
  filters: PartnerLeadFilters,
): Promise<{ counts: PartnerLaneCounts | null; onCall: Set<string> }> {
  // The two reads select different columns, so their builder types differ; the scope is the same.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scope = (query: any) => {
    let q = query.eq("tenant_id", tenantId).eq("partner_id", partnerId);
    if (closerId) q = q.eq("agent_leads.created_by", closerId);
    if (filters.product) q = q.eq("product_line", filters.product);
    if (filters.dateFrom) q = q.gte("queued_at", filters.dateFrom);
    if (filters.dateTo) q = q.lt("queued_at", new Date(Date.parse(filters.dateTo) + 86_400_000).toISOString().slice(0, 10));
    return q;
  };
  const columns = closerId ? "id, status, disposition, updated_at, agent_leads!inner(created_by)" : "id, status, disposition, updated_at";
  const since = new Date(Date.now() - CONVERTED_WINDOW_MS).toISOString();
  const [live, sold] = await Promise.all([
    scope(db.from("lead_queue").select(columns)).in("status", ["unclaimed", ...HELD_STATUSES]).limit(5000),
    scope(db.from("lead_queue").select(closerId ? "id, agent_leads!inner(created_by)" : "id", { count: "exact", head: true }))
      .eq("status", "completed").in("disposition", [...SALE_DISPOSITIONS]).gte("updated_at", since),
  ]);
  if (live.error || sold.error) {
    console.error(`[partner-pipeline] lane figures failed: ${live.error?.message ?? sold.error?.message}`);
    return { counts: null, onCall: new Set() };
  }
  const liveRows = (live.data ?? []) as unknown as Array<{ id: string; status: string }>;
  const held = liveRows.filter((row) => row.status !== "unclaimed").map((row) => row.id);
  const onCall = new Set<string>();
  for (let index = 0; index < held.length; index += 200) {
    const { data, error } = await db.from("tenant_verification_sessions").select("work_item_id").eq("tenant_id", tenantId).is("ended_at", null).in("work_item_id", held.slice(index, index + 200));
    if (error) { console.error(`[partner-pipeline] verification lookup failed: ${error.message}`); return { counts: null, onCall: new Set() }; }
    for (const row of (data ?? []) as Array<{ work_item_id: string }>) onCall.add(row.work_item_id);
  }
  const narrowed = Boolean(filters.stageId || filters.outcome);
  const verification = held.filter((id) => onCall.has(id)).length;
  return {
    counts: narrowed ? null : {
      new: liveRows.length - held.length,
      claimed: held.length - verification,
      verification,
      converted: sold.count ?? 0,
    },
    onCall,
  };
}

/**
 * Submissions whose lead was created since `since` (00:00 in the partner's timezone), under the
 * page's scope. The read model counts by the database's UTC date, which is not "since 00:00 your
 * time" for any partner west of Greenwich in the evening. Null on a failed read: the caller keeps
 * the read model's figure. A stage or outcome filter narrows it the way the table is narrowed.
 */
async function submittedSince(
  db: ReturnType<typeof getSupabaseServiceClient>,
  tenantId: string,
  partnerId: string,
  closerId: string | null,
  filters: PartnerLeadFilters,
  since: Date,
): Promise<number | null> {
  let query = db
    .from("lead_queue")
    .select("id, agent_leads!inner(created_at, created_by)", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("partner_id", partnerId)
    .gte("agent_leads.created_at", since.toISOString());
  if (closerId) query = query.eq("agent_leads.created_by", closerId);
  if (filters.product) query = query.eq("product_line", filters.product);
  if (filters.stageId) query = query.eq("stage_id", filters.stageId);
  if (filters.outcome) query = query.eq("disposition", filters.outcome);
  if (filters.dateFrom) query = query.gte("queued_at", filters.dateFrom);
  if (filters.dateTo) query = query.lt("queued_at", new Date(Date.parse(filters.dateTo) + 86_400_000).toISOString().slice(0, 10));
  const { count, error } = await query;
  if (error) { console.error(`[partner-pipeline] submitted-today count failed: ${error.message}`); return null; }
  return count ?? 0;
}

async function oldestOpenQueuedAt(db: ReturnType<typeof getSupabaseServiceClient>, tenantId: string, partnerId: string, closerId: string | null): Promise<string | null> {
  let query = db
    .from("lead_queue")
    .select("queued_at, agent_leads!inner(created_by)")
    .eq("tenant_id", tenantId)
    .eq("partner_id", partnerId)
    .in("status", ["unclaimed", ...HELD_STATUSES])
    .order("queued_at", { ascending: true })
    .limit(1);
  if (closerId) query = query.eq("agent_leads.created_by", closerId);
  const { data, error } = await query;
  if (error) { console.error(`[partner-pipeline] oldest open lookup failed: ${error.message}`); return null; }
  const first = (data ?? [])[0] as { queued_at?: unknown } | undefined;
  return typeof first?.queued_at === "string" ? first.queued_at : null;
}

export async function listPartnerLeads(tenantId: string, partnerId: string, filters: PartnerLeadFilters, timezone: string, pagination: { limit?: number; offset?: number } = {}, access?: PartnerLeadAccess) {
  validateFilter({ ...filters });
  const limit = pagination.limit ?? 250;
  const offset = pagination.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000 || !Number.isInteger(offset) || offset < 0) throw new Error("Choose valid pipeline pagination");
  const db = getSupabaseServiceClient();
  // LA-1.17's database read model keeps filtering, paging, counters, and facets
  // next to the tenant-scoped indexes. The previous implementation fetched up to
  // 5,000 queue rows and 5,000 lead rows into Node before slicing the first page.
  // Partner users are permanently scoped to leads they submitted. This is enforced
  // in the read-model query itself (created_by), before paging, counters, or facets
  // are calculated. Partner admins retain organization-wide visibility and may use
  // the optional closer filter.
  const effectiveCloserId = access?.role === "partner_user" ? access.userId : filters.closerId ?? null;
  const { data, error } = await db.rpc("partner_lead_pipeline_page", {
    p_tenant_id: tenantId,
    p_partner_id: partnerId,
    p_date_from: filters.dateFrom ?? null,
    p_date_to: filters.dateTo ?? null,
    p_closer_id: effectiveCloserId,
    p_product: filters.product ?? null,
    p_stage_id: filters.stageId ?? null,
    p_outcome: filters.outcome ?? null,
    p_timezone: timezone,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw new Error(`Could not load partner pipeline: ${error.message}`);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Could not load partner pipeline: invalid read model response");

  const payload = data as Record<string, unknown>;
  const rowValues = Array.isArray(payload.rows) ? payload.rows : [];
  const rows: PartnerLeadRow[] = rowValues.flatMap((value): PartnerLeadRow[] => {
    if (!Array.isArray(value) || value.length < 13) return [];
    // The stage-aware read model returns stage_name and stage_type in positions
    // 7 and 8. Keep accepting the older 13-item payload while a rolling deploy
    // is in progress; it is still safe, but has no stage display metadata.
    const hasStageFields = value.length >= 15;
    const [id, workItemId, customer, submittedAt, updatedAt, product, stageId] = value;
    const stageName = hasStageFields ? value[7] : "";
    const stageType = hasStageFields ? value[8] : "";
    const disposition = hasStageFields ? value[9] : value[7];
    const outcome = hasStageFields ? value[10] : value[8];
    const outcomeNote = hasStageFields ? value[11] : value[9];
    const submittedById = hasStageFields ? value[12] : value[10];
    const submittedByName = hasStageFields ? value[13] : value[11];
    const status = hasStageFields ? value[14] : value[12];
    if (![id, workItemId, customer, submittedAt, updatedAt, product, stageId, submittedByName, status].every((item) => typeof item === "string")) return [];
    return [{
      id, workItemId, customer, submittedAt, updatedAt, product, stageId,
      stageName: typeof stageName === "string" ? stageName : "",
      stageType: typeof stageType === "string" ? stageType : "",
      disposition: typeof disposition === "string" ? disposition : null,
      outcome: partnerOutcomeLabel(typeof outcome === "string" ? outcome : null),
      outcomeNote: typeof outcomeNote === "string" ? outcomeNote : null,
      submittedBy: { id: typeof submittedById === "string" ? submittedById : null, name: submittedByName },
      status,
    }];
  });
  const stages: PartnerPipelineStage[] = (Array.isArray(payload.stages) ? payload.stages : []).flatMap((value): PartnerPipelineStage[] => {
    if (!Array.isArray(value) || value.length < 9) return [];
    const [id, pipelineId, pipelineName, name, position, stageType, color, isArchived, leadCount] = value;
    if (![id, pipelineId, pipelineName, name, stageType, color].every((item) => typeof item === "string")) return [];
    if (typeof position !== "number" || typeof isArchived !== "boolean" || typeof leadCount !== "number") return [];
    return [{ id, pipelineId, pipelineName, name: partnerStageLabel(name, stageType), position, stageType, color, isArchived, leadCount }];
  });
  const closers = (Array.isArray(payload.closers) ? payload.closers : []).flatMap((value): PartnerLeadFacets["closers"] => {
    if (!Array.isArray(value) || value.length < 2 || typeof value[0] !== "string" || typeof value[1] !== "string") return [];
    return [{ id: value[0], name: value[1] }];
  });
  const products = (Array.isArray(payload.products) ? payload.products : []).filter((value): value is string => typeof value === "string");
  const outcomes = (Array.isArray(payload.outcomes) ? payload.outcomes : []).flatMap((value): PartnerLeadFacets["outcomes"] => {
    if (!Array.isArray(value) || value.length < 2 || typeof value[0] !== "string" || typeof value[1] !== "string") return [];
    return [{ key: value[0], label: partnerOutcomeLabel(value[1]) ?? titleCase(value[1]) }];
  });
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const hydratedRows = rows.map((row) => {
    const stage = stageById.get(row.stageId);
    return stage ? { ...row, stageName: partnerStageLabel(stage.name, stage.stageType, row.status, row.outcome), stageType: stage.stageType } : row;
  });
  const rawCounters = payload.counters && typeof payload.counters === "object" && !Array.isArray(payload.counters) ? payload.counters as Record<string, unknown> : {};
  const counter = (key: string) => typeof rawCounters[key] === "number" ? rawCounters[key] : 0;
  const total = typeof payload.total === "number" ? payload.total : 0;
  const nextOffset = typeof payload.next_offset === "number" ? payload.next_offset : null;
  // Only unfiltered (apart from the closer scope every partner user carries): a date, product or
  // stage filter narrows the still-open count, and an "oldest" from outside that filter would sit
  // under a number it does not describe.
  const unfiltered = !filters.dateFrom && !filters.dateTo && !filters.product && !filters.stageId && !filters.outcome;
  const [oldestOpenAt, lanes, submittedToday] = await Promise.all([
    unfiltered ? oldestOpenQueuedAt(db, tenantId, partnerId, effectiveCloserId) : Promise.resolve(null),
    partnerLaneFigures(db, tenantId, partnerId, effectiveCloserId, filters),
    submittedSince(db, tenantId, partnerId, effectiveCloserId, filters, startOfTodayIn(timezone)),
  ]);
  // LA-1.17-4: the four counters in the board's lanes (counters.ts). With a stage or outcome filter
  // the lanes are withheld, and the read model's own counters, which honour those filters, stand.
  const counters = lanes.counts
    ? countersFromLanes(lanes.counts, submittedToday ?? counter("submittedToday"))
    : { submittedToday: submittedToday ?? counter("submittedToday"), claimed: counter("claimed"), converted: counter("converted"), stillOpen: counter("stillOpen") };
  const now = Date.now();
  const told = await partnerToldIds(db, tenantId, partnerId, hydratedRows.map((row) => row.workItemId));
  const lanedRows = hydratedRows.map((row) => ({
    ...row,
    ...(told.has(row.workItemId) && nobodyClaimed({ status: row.status, slaPartnerNotifiedAt: "told" }) ? { stageName: NOBODY_CLAIMED_LABEL } : {}),
    lane: partnerLane(row, lanes.onCall, now),
  }));
  return {
    rows: lanedRows,
    stages,
    facets: { closers, products, outcomes },
    counters,
    oldestOpenAt,
    laneCounts: lanes.counts,
    total,
    nextOffset,
    pageSize: limit,
    realtimeTopic: `partner-pipeline:${partnerId}`,
    generatedAt: new Date().toISOString(),
  };
}

export async function getPartnerLeadDetail(tenantId: string, partnerId: string, leadId: string, access?: PartnerLeadAccess): Promise<PartnerLeadDetail> {
  if (!UUID.test(leadId)) throw new Error("Choose a valid lead");
  const data = await loadPartnerData(tenantId, partnerId, {}, leadId, true);
  const rows = mapRows(data, {});
  const row = rows[0];
  const lead = data.leads.find((item) => item.id === leadId);
  const queue = data.queues[0];
  if (!row || !lead || !queue) throw new Error("Lead not found");
  if (access?.role === "partner_user" && lead.created_by !== access.userId) throw new Error("Lead not found");
  const db = getSupabaseServiceClient();
  const messages = data.timelineMessages;
  if (!messages) throw new Error("Lead not found");
  if (messages.error) throw new Error(`Could not load lead timeline: ${messages.error.message}`);
  const noteIds = (messages.data ?? []).map((message) => message.event_key?.startsWith("lead-note:") ? message.event_key.slice("lead-note:".length) : null).filter((id): id is string => Boolean(id));
  const sharedNotes = noteIds.length ? await db.from("tenant_lead_notes").select("id, visibility, deleted_at").eq("tenant_id", tenantId).in("id", noteIds) : { data: [], error: null };
  if (sharedNotes.error) throw new Error(`Could not filter partner notes: ${sharedNotes.error.message}`);
  const visibleNoteIds = new Set((sharedNotes.data ?? []).filter((note) => note.visibility === "shared" && !note.deleted_at).map((note) => note.id));
  const timeline: PartnerLeadDetail["timeline"] = [{ type: "submitted", label: "Lead submitted", at: lead.created_at, detail: row.submittedBy.name }];
  if (queue.claimed_at) timeline.push({ type: "claimed", label: "Lead claimed", at: queue.claimed_at, detail: queue.owner_user_id ? data.users.find((user) => user.id === queue.owner_user_id)?.name ?? "Agent" : "Agent" });
  if (queue.disposition_at) timeline.push({ type: "outcome", label: row.outcome ?? "Outcome recorded", at: queue.disposition_at, detail: row.outcomeNote });
  for (const message of (messages.data ?? []).filter((item) => !item.event_key?.startsWith("lead-note:") || visibleNoteIds.has(item.event_key.slice("lead-note:".length)))) timeline.push({ type: message.message_kind === "system_card" ? "system" : "message", label: message.message_kind === "system_card" ? "Pipeline update" : "Message", at: message.created_at, detail: message.message });
  timeline.sort((a, b) => a.at.localeCompare(b.at));
  const told = await partnerToldIds(db, tenantId, partnerId, [row.workItemId]);
  const stageName = told.has(row.workItemId) && nobodyClaimed({ status: row.status, slaPartnerNotifiedAt: "told" }) ? NOBODY_CLAIMED_LABEL : row.stageName;
  return { ...row, stageName, values: maskSensitiveValues(lead.values) as Record<string, unknown>, timeline };
}

function csvCell(value: unknown) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }

export function partnerLeadsCsv(rows: PartnerLeadRow[]) {
  const header = ["customer", "submitted_at", "product", "stage", "outcome", "outcome_note", "submitted_by", "status"];
  const lines = rows.map((row) => [row.customer, row.submittedAt, row.product, row.stageName, row.outcome, row.outcomeNote, row.submittedBy.name, row.status].map(csvCell).join(","));
  return [header.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}
