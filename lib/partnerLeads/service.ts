import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { PartnerLeadDetail, PartnerLeadFacets, PartnerLeadFilters, PartnerLeadRow, PartnerPipelineStage } from "@/lib/partnerLeads/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SENSITIVE_KEY = /(ssn|social.?security|routing|bank|account.?number|policy.?number|policy_no|credit.?card)/i;

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
type PipelineRpcRow = [string, string, string, string, string, string, string, string | null, string | null, string | null, string | null, string, string];
type PipelineRpcStage = [string, string, string, string, number, string, string, boolean, number];
type PipelineRpcPayload = {
  rows?: PipelineRpcRow[];
  stages?: PipelineRpcStage[];
  closers?: Array<[string, string]>;
  products?: string[];
  outcomes?: Array<[string, string]>;
  total?: number;
  next_offset?: number | null;
  counters?: { submittedToday?: number; claimed?: number; converted?: number; stillOpen?: number };
};

function objectValues(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function displayName(value: unknown) {
  const values = objectValues(value);
  return String(values.full_name || [values.first_name, values.last_name].filter(Boolean).join(" ") || values.name || "Unnamed lead").slice(0, 160);
}

function maskValues(value: unknown, key = ""): unknown {
  if (SENSITIVE_KEY.test(key)) return "[Masked]";
  if (Array.isArray(value)) return value.map((item) => maskValues(item, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [childKey, maskValues(childValue, childKey)]));
  return value;
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

async function loadPartnerData(tenantId: string, partnerId: string, filters: PartnerLeadFilters, leadId?: string) {
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
  if (!leadIds.length) return { queues: [], leads: [], deals: [], stages: [], pipelines: [], users: [], dispositions: [] };
  const leadsPage = (start: number) => { let query = db.from("agent_leads").select("id, values, created_by, created_at, updated_at, product_line, pipeline_id, stage_id").eq("tenant_id", tenantId).eq("partner_id", partnerId).order("created_at", { ascending: false }).range(start, start + 999); if (leadId) query = query.eq("id", leadId); return query; };
  const dealsPage = (start: number) => { let query = db.from("deal_flow").select("lead_id, notes, call_result, disposition_at, disposition_by, updated_at").eq("tenant_id", tenantId).eq("partner_id", partnerId).order("updated_at", { ascending: false }).range(start, start + 999); if (leadId) query = query.eq("lead_id", leadId); return query; };
  const [firstLeads, firstDeals, stages, pipelines, partnerMembers, dispositions] = await Promise.all([
    leadsPage(0),
    dealsPage(0),
    db.from("pipeline_stages").select("id, pipeline_id, name, position, stage_type, color, is_archived").in("id", [...new Set(queueRows.map((row) => row.stage_id))]),
    db.from("pipelines").select("id, name").eq("tenant_id", tenantId).in("id", [...new Set(queueRows.map((row) => row.pipeline_id))]),
    db.from("partner_users").select("user_id").eq("tenant_id", tenantId).eq("partner_id", partnerId).eq("status", "active"),
    db.from("dispositions").select("disposition_key, label").eq("tenant_id", tenantId),
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
  return { queues: queueRows, leads: leadData.flatMap((result) => result.data ?? []) as LeadRow[], deals: dealData.flatMap((result) => result.data ?? []) as DealRow[], stages: (stages.data ?? []) as StageRow[], pipelines: (pipelines.data ?? []) as PipelineRow[], users: (users.data ?? []) as UserRow[], dispositions: (dispositions.data ?? []) as DispositionRow[] };
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
    return [{ id: lead.id, workItemId: queue.id, customer: displayName(lead.values), submittedAt: lead.created_at, updatedAt: queue.updated_at, product: queue.product_line, stageId: stage.id, stageName: stage.name, stageType: stage.stage_type, disposition: queue.disposition, outcome: queue.disposition ? dispositions.get(queue.disposition) ?? queue.disposition : null, outcomeNote: deal?.notes ?? null, submittedBy: { id: lead.created_by, name: lead.created_by ? users.get(lead.created_by) ?? "Partner closer" : "Partner closer" }, status: queue.status }];
  });
}

export async function listPartnerLeads(tenantId: string, partnerId: string, filters: PartnerLeadFilters, timezone: string, pagination: { limit?: number; offset?: number } = {}) {
  validateFilter({ ...filters });
  const limit = pagination.limit ?? 250;
  const offset = pagination.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000 || !Number.isInteger(offset) || offset < 0) throw new Error("Choose valid pipeline pagination");
  const db = getSupabaseServiceClient();
  const result = await db.rpc("partner_lead_pipeline_page", { p_tenant_id: tenantId, p_partner_id: partnerId, p_date_from: filters.dateFrom ?? null, p_date_to: filters.dateTo ?? null, p_closer_id: filters.closerId ?? null, p_product: filters.product ?? null, p_stage_id: filters.stageId ?? null, p_outcome: filters.outcome ?? null, p_timezone: timezone, p_limit: limit, p_offset: offset });
  if (result.error) throw new Error(`Could not load partner pipeline: ${result.error.message}`);
  const payload = result.data && typeof result.data === "object" && !Array.isArray(result.data) ? result.data as PipelineRpcPayload : {};
  const rawRows = Array.isArray(payload.rows) ? payload.rows : [];
  const rawStages = Array.isArray(payload.stages) ? payload.stages : [];
  const stageById = new Map(rawStages.map((stage) => [stage[0], stage]));
  const rows: PartnerLeadRow[] = rawRows.flatMap((row) => {
    const stage = stageById.get(row[6]);
    if (!stage) return [];
    return [{ id: row[0], workItemId: row[1], customer: row[2], submittedAt: row[3], updatedAt: row[4], product: row[5], stageId: row[6], stageName: stage[3], stageType: stage[5], disposition: row[7], outcome: row[8] ?? row[7], outcomeNote: row[9], submittedBy: { id: row[10], name: row[11] }, status: row[12] }];
  });
  const stages: PartnerPipelineStage[] = rawStages.map((stage) => ({ id: stage[0], pipelineId: stage[1], pipelineName: stage[2], name: stage[3], position: stage[4], stageType: stage[5], color: stage[6], isArchived: stage[7], leadCount: stage[8] }));
  const facets: PartnerLeadFacets = {
    closers: (Array.isArray(payload.closers) ? payload.closers : []).map((closer) => ({ id: closer[0], name: closer[1] })),
    products: Array.isArray(payload.products) ? payload.products : [],
    outcomes: (Array.isArray(payload.outcomes) ? payload.outcomes : []).map((outcome) => ({ key: outcome[0], label: outcome[1] })),
  };
  return {
    rows,
    stages,
    facets,
    counters: { submittedToday: payload.counters?.submittedToday ?? 0, claimed: payload.counters?.claimed ?? 0, converted: payload.counters?.converted ?? 0, stillOpen: payload.counters?.stillOpen ?? 0 },
    total: payload.total ?? rows.length,
    nextOffset: payload.next_offset ?? null,
    pageSize: limit,
    realtimeTopic: `partner-pipeline:${partnerId}`,
    generatedAt: new Date().toISOString(),
  };
}

export async function getPartnerLeadDetail(tenantId: string, partnerId: string, leadId: string): Promise<PartnerLeadDetail> {
  if (!UUID.test(leadId)) throw new Error("Choose a valid lead");
  const data = await loadPartnerData(tenantId, partnerId, {}, leadId);
  const rows = mapRows(data, {});
  const row = rows[0];
  const lead = data.leads.find((item) => item.id === leadId);
  const queue = data.queues[0];
  if (!row || !lead || !queue) throw new Error("Lead not found");
  const db = getSupabaseServiceClient();
  const messages = await db.from("partner_messages").select("id, message, message_kind, created_at, created_by, event_key").eq("tenant_id", tenantId).eq("partner_id", partnerId).eq("work_item_id", queue.id).order("created_at");
  if (messages.error) throw new Error(`Could not load lead timeline: ${messages.error.message}`);
  const noteIds = (messages.data ?? []).map((message) => message.event_key?.startsWith("lead-note:") ? message.event_key.slice("lead-note:".length) : null).filter((id): id is string => Boolean(id));
  const sharedNotes = noteIds.length ? await db.from("lead_notes").select("id, visibility, deleted_at").eq("tenant_id", tenantId).in("id", noteIds) : { data: [], error: null };
  if (sharedNotes.error) throw new Error(`Could not filter partner notes: ${sharedNotes.error.message}`);
  const visibleNoteIds = new Set((sharedNotes.data ?? []).filter((note) => note.visibility === "shared" && !note.deleted_at).map((note) => note.id));
  const timeline: PartnerLeadDetail["timeline"] = [{ type: "submitted", label: "Lead submitted", at: lead.created_at, detail: row.submittedBy.name }];
  if (queue.claimed_at) timeline.push({ type: "claimed", label: "Lead claimed", at: queue.claimed_at, detail: queue.owner_user_id ? data.users.find((user) => user.id === queue.owner_user_id)?.name ?? "Agent" : "Agent" });
  if (queue.disposition_at) timeline.push({ type: "outcome", label: row.outcome ?? "Outcome recorded", at: queue.disposition_at, detail: row.outcomeNote });
  for (const message of (messages.data ?? []).filter((item) => !item.event_key?.startsWith("lead-note:") || visibleNoteIds.has(item.event_key.slice("lead-note:".length)))) timeline.push({ type: message.message_kind === "system_card" ? "system" : "message", label: message.message_kind === "system_card" ? "Pipeline update" : "Message", at: message.created_at, detail: message.message });
  timeline.sort((a, b) => a.at.localeCompare(b.at));
  return { ...row, values: maskValues(lead.values) as Record<string, unknown>, timeline };
}

function csvCell(value: unknown) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }

export function partnerLeadsCsv(rows: PartnerLeadRow[]) {
  const header = ["customer", "submitted_at", "product", "stage", "outcome", "outcome_note", "submitted_by", "status"];
  const lines = rows.map((row) => [row.customer, row.submittedAt, row.product, row.stageName, row.outcome, row.outcomeNote, row.submittedBy.name, row.status].map(csvCell).join(","));
  return [header.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}
