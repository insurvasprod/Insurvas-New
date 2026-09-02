import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { PartnerLeadDetail, PartnerLeadFilters, PartnerLeadRow, PartnerPipelineStage } from "@/lib/partnerLeads/types";

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
type PipelineRpcRow = { id: string; work_item_id: string; customer: string; values: unknown; submitted_at: string; updated_at: string; product: string; stage_id: string; stage_name: string; stage_type: string; stage_color: string; stage_position: number; stage_archived: boolean; pipeline_id: string; pipeline_name: string; disposition: string | null; outcome: string | null; outcome_note: string | null; submitted_by_id: string | null; submitted_by_name: string; status: string };

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

function localDateFormatter(timezone: string) {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
    return (date: string) => formatter.format(new Date(date));
  } catch {
    return (date: string) => date.slice(0, 10);
  }
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

export async function listPartnerLeads(tenantId: string, partnerId: string, filters: PartnerLeadFilters, timezone: string) {
  validateFilter({ ...filters });
  const db = getSupabaseServiceClient();
  const result = await db.rpc("partner_lead_pipeline_payload", { p_tenant_id: tenantId, p_partner_id: partnerId, p_date_from: filters.dateFrom ?? null, p_date_to: filters.dateTo ?? null, p_closer_id: filters.closerId ?? null, p_product: filters.product ?? null, p_stage_id: filters.stageId ?? null, p_outcome: filters.outcome ?? null });
  if (result.error) throw new Error(`Could not load partner pipeline: ${result.error.message}`);
  const rawRows = (Array.isArray(result.data) ? result.data : []) as PipelineRpcRow[];
  const rows: PartnerLeadRow[] = rawRows.map((row) => ({ id: row.id, workItemId: row.work_item_id, customer: row.customer, submittedAt: row.submitted_at, updatedAt: row.updated_at, product: row.product, stageId: row.stage_id, stageName: row.stage_name, stageType: row.stage_type, disposition: row.disposition, outcome: row.outcome ?? row.disposition, outcomeNote: row.outcome_note, submittedBy: { id: row.submitted_by_id, name: row.submitted_by_name }, status: row.status }));
  const formatLocalDate = localDateFormatter(timezone);
  const today = formatLocalDate(new Date().toISOString());
  const stages: PartnerPipelineStage[] = [...new Map(rawRows.map((row) => [row.stage_id, { id: row.stage_id, pipelineId: row.pipeline_id, pipelineName: row.pipeline_name, name: row.stage_name, position: row.stage_position, stageType: row.stage_type, color: row.stage_color, isArchived: row.stage_archived }])).values()].sort((a, b) => a.pipelineName.localeCompare(b.pipelineName) || a.position - b.position);
  return { rows, stages, counters: { submittedToday: rows.filter((row) => formatLocalDate(row.submittedAt) === today).length, claimed: rows.filter((row) => ["claimed", "buffer_active", "handed_pending", "la_active"].includes(row.status)).length, converted: rows.filter((row) => row.stageType === "won").length, stillOpen: rows.filter((row) => row.stageType === "open" && !["completed", "dropped"].includes(row.status)).length }, realtimeTopic: `partner-pipeline:${partnerId}`, generatedAt: new Date().toISOString() };
}

export async function getPartnerLeadDetail(tenantId: string, partnerId: string, leadId: string): Promise<PartnerLeadDetail> {
  if (!UUID.test(leadId)) throw new Error("Choose a valid lead");
  const data = await loadPartnerData(tenantId, partnerId, {}, leadId);
  const rows = mapRows(data, {});
  const row = rows[0];
  const lead = data.leads.find((item) => item.id === leadId);
  const queue = data.queues[0];
  if (!row || !lead || !queue) throw new Error("Lead not found");
  const messages = await getSupabaseServiceClient().from("partner_messages").select("id, message, message_kind, created_at, created_by").eq("tenant_id", tenantId).eq("partner_id", partnerId).eq("work_item_id", queue.id).order("created_at");
  if (messages.error) throw new Error(`Could not load lead timeline: ${messages.error.message}`);
  const timeline: PartnerLeadDetail["timeline"] = [{ type: "submitted", label: "Lead submitted", at: lead.created_at, detail: row.submittedBy.name }];
  if (queue.claimed_at) timeline.push({ type: "claimed", label: "Lead claimed", at: queue.claimed_at, detail: queue.owner_user_id ? data.users.find((user) => user.id === queue.owner_user_id)?.name ?? "Agent" : "Agent" });
  if (queue.disposition_at) timeline.push({ type: "outcome", label: row.outcome ?? "Outcome recorded", at: queue.disposition_at, detail: row.outcomeNote });
  for (const message of messages.data ?? []) timeline.push({ type: message.message_kind === "system_card" ? "system" : "message", label: message.message_kind === "system_card" ? "Pipeline update" : "Message", at: message.created_at, detail: message.message });
  timeline.sort((a, b) => a.at.localeCompare(b.at));
  return { ...row, values: maskValues(lead.values) as Record<string, unknown>, timeline };
}

function csvCell(value: unknown) { return `"${String(value ?? "").replace(/"/g, '""')}"`; }

export function partnerLeadsCsv(rows: PartnerLeadRow[]) {
  const header = ["customer", "submitted_at", "product", "stage", "outcome", "outcome_note", "submitted_by", "status"];
  const lines = rows.map((row) => [row.customer, row.submittedAt, row.product, row.stageName, row.outcome, row.outcomeNote, row.submittedBy.name, row.status].map(csvCell).join(","));
  return [header.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}
