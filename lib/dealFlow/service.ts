import "server-only";

import { getAgentTemplateForProduct } from "@/lib/agentTemplates/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveRuntimeStage, partnerTypeForLead } from "@/lib/pipelines/service";
import type { DealFlowFilterOptions, DealFlowRow, DealFlowStatus, DealFlowSummary } from "./types";
import { DEAL_FLOW_STATUSES } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SAFE_TEXT = /^[^\u0000-\u001f\u007f<>]*$/;

export function assertUuid(value: unknown, label: string) {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function text(value: unknown, label: string, max: number, required = true) {
  if (value == null && !required) return null;
  if (typeof value !== "string" || !SAFE_TEXT.test(value) || (required && value.trim().length < 1) || value.trim().length > max) throw new Error(`${label} must be between ${required ? 1 : 0} and ${max} characters`);
  return value.trim() || null;
}

export function date(value: unknown, label = "Date") {
  if (typeof value !== "string" || !DATE.test(value)) throw new Error(`${label} must use YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(`${label} is not a real calendar date`);
  return value;
}

function amount(value: unknown, label: string, optional = true) {
  if (value == null || value === "") { if (optional) return null; throw new Error(`${label} is required`); }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 2147483647) throw new Error(`${label} must be a non-negative whole number of cents`);
  return value;
}

function status(value: unknown): DealFlowStatus {
  if (!DEAL_FLOW_STATUSES.includes(value as DealFlowStatus)) throw new Error("Choose a valid deal status");
  return value as DealFlowStatus;
}

const select = "id, lead_id, partner_id, submission_id, product_line, insured_name, phone, initial_quote, tracking_id, local_date, status, call_result, notes, carrier, product_type, monthly_premium_cents, face_amount_cents, draft_date, worked_by, manual_entry, created_at, updated_at";

async function lookups(tenantId: string): Promise<DealFlowFilterOptions> {
  const db = getSupabaseServiceClient();
  const [partners, memberships] = await Promise.all([
    db.from("partners").select("id, name").eq("tenant_id", tenantId).order("name"),
    db.from("tenant_users").select("user_id, role").eq("tenant_id", tenantId).order("role"),
  ]);
  if (partners.error || memberships.error) throw new Error(`Could not load deal-flow filters: ${partners.error?.message ?? memberships.error?.message}`);
  const ids = (memberships.data ?? []).map((item) => item.user_id);
  const users = ids.length ? await db.from("users").select("id, name").in("id", ids).order("name") : { data: [], error: null };
  if (users.error) throw new Error(`Could not load deal-flow agents: ${users.error.message}`);
  const names = new Map((users.data ?? []).map((user) => [user.id, user.name]));
  return {
    partners: (partners.data ?? []).map((partner) => ({ id: partner.id, name: partner.name })),
    agents: (memberships.data ?? []).map((member) => ({ id: member.user_id, name: names.get(member.user_id) ?? "Unnamed user", role: member.role })),
  };
}

export async function listDealFlow(tenantId: string, filters: { fromDate?: string; toDate?: string; partnerId?: string; productLine?: string; agentId?: string; status?: string; page?: number; pageSize?: number }) {
  const page = Number.isInteger(filters.page) && (filters.page ?? 1) > 0 ? filters.page as number : 1;
  const pageSize = Math.min(10000, Math.max(1, Number.isInteger(filters.pageSize) ? filters.pageSize as number : 100));
  const db = getSupabaseServiceClient();
  const fromDate = filters.fromDate ? date(filters.fromDate, "From date") : null;
  const toDate = filters.toDate ? date(filters.toDate, "To date") : null;
  const partnerId = filters.partnerId ? assertUuid(filters.partnerId, "partner") : null;
  const productLine = filters.productLine ? text(filters.productLine, "Product", 120) : null;
  const agentId = filters.agentId ? assertUuid(filters.agentId, "agent") : null;
  const selectedStatus = filters.status ? status(filters.status) : null;
  const reportPromise = db.rpc("list_deal_flow_report", { p_tenant_id: tenantId, p_from_date: fromDate, p_to_date: toDate, p_partner_id: partnerId, p_product_line: productLine, p_agent_id: agentId, p_status: selectedStatus, p_page: page, p_page_size: pageSize });
  const [reportResult, options] = await Promise.all([reportPromise, lookups(tenantId)]);
  if (reportResult.error) throw new Error(`Could not load daily deal flow: ${reportResult.error.message}`);
  const report = (reportResult.data && typeof reportResult.data === "object" && !Array.isArray(reportResult.data) ? reportResult.data : {}) as unknown as { total?: unknown; rows?: unknown; summary?: unknown };
  const data = Array.isArray(report.rows) ? report.rows : [];
  const count = typeof report.total === "number" ? report.total : 0;
  const summaryData = Array.isArray(report.summary) ? report.summary : [];
  const partners = new Map(options.partners.map((partner) => [partner.id, partner.name]));
  const agents = new Map(options.agents.map((agent) => [agent.id, agent.name]));
  const summaryMap = new Map<string, DealFlowSummary>();
  for (const row of summaryData as unknown as Array<{ partner_id: string | null; status: string; total: number }>) {
    const key = row.partner_id ?? "none";
    const current = summaryMap.get(key) ?? { partner_id: row.partner_id, partner_name: row.partner_id ? partners.get(row.partner_id) ?? "Unknown partner" : "No partner", total: 0, completed: 0, partial: 0, dropped: 0 };
    current.total += row.total;
    if (row.status === "completed") current.completed += row.total;
    if (row.status === "partial") current.partial += row.total;
    if (row.status === "dropped") current.dropped += row.total;
    summaryMap.set(key, current);
  }
  const rows = (data as unknown as Array<Record<string, unknown>>).map((row) => {
    const item = row as unknown as DealFlowRow;
    return { ...item, status: status(item.status), partner_name: item.partner_id ? partners.get(item.partner_id) ?? "Unknown partner" : "No partner", agent_name: item.worked_by ? agents.get(item.worked_by) ?? "Unknown agent" : "Unassigned" };
  });
  return { rows, total: count ?? 0, page, pageSize, summary: [...summaryMap.values()].sort((a, b) => b.total - a.total || a.partner_name.localeCompare(b.partner_name)), options };
}

export async function updateDealFlow(tenantId: string, dealId: string, input: { carrier?: unknown; product_type?: unknown; monthly_premium_cents?: unknown; face_amount_cents?: unknown; draft_date?: unknown; status?: unknown; call_result?: unknown; notes?: unknown; local_date?: unknown }) {
  const id = assertUuid(dealId, "deal flow id");
  const patch = {
    carrier: text(input.carrier, "Carrier", 160, false),
    product_type: text(input.product_type, "Product type", 160, false),
    monthly_premium_cents: amount(input.monthly_premium_cents, "Monthly premium"),
    face_amount_cents: amount(input.face_amount_cents, "Face amount"),
    draft_date: input.draft_date == null || input.draft_date === "" ? null : date(input.draft_date, "Draft date"),
    status: status(input.status),
    call_result: text(input.call_result, "Call result", 120, false),
    notes: text(input.notes, "Notes", 5000, false),
    local_date: date(input.local_date, "Deal date"),
  };
  const { data, error } = await getSupabaseServiceClient().from("deal_flow").update(patch).eq("tenant_id", tenantId).eq("id", id).select(select).maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "Deal flow row not found");
  return data;
}

export async function createManualDeal(tenantId: string, userId: string, input: { product_line: unknown; insured_name: unknown; phone?: unknown; partner_id?: unknown; local_date: unknown; carrier?: unknown; product_type?: unknown; monthly_premium_cents?: unknown; face_amount_cents?: unknown; draft_date?: unknown; status?: unknown; call_result?: unknown; notes?: unknown; initial_quote?: unknown }) {
  const productLine = text(input.product_line, "Product", 120) as string;
  const name = text(input.insured_name, "Insured name", 160) as string;
  const phone = text(input.phone, "Phone", 40, false);
  const partnerId = input.partner_id == null || input.partner_id === "" ? null : assertUuid(input.partner_id, "partner");
  if (partnerId) {
    const partner = await getSupabaseServiceClient().from("partners").select("id").eq("id", partnerId).eq("tenant_id", tenantId).maybeSingle();
    if (partner.error || !partner.data) throw new Error("Choose a partner from this tenant");
  }
  const localDate = date(input.local_date, "Deal date");
  const template = await getAgentTemplateForProduct(tenantId, userId, productLine);
  const pipeline = await resolveRuntimeStage(tenantId, "new", await partnerTypeForLead(tenantId, partnerId));
  const db = getSupabaseServiceClient();
  const lead = await db.from("agent_leads").insert({ tenant_id: tenantId, tenant_template_id: template.tenant_template_id, template_id: template.assignment.template_id, template_version: template.assignment.template_version, definition_version: template.assignment.definition_version, product_line: productLine, pipeline_id: pipeline.pipelineId, stage_id: pipeline.stage.id, partner_id: partnerId, values: { full_name: name, phone }, created_by: userId }).select("id").single();
  if (lead.error || !lead.data) throw new Error(lead.error?.message ?? "Could not create the manual lead");
  const deal = await db.from("deal_flow").insert({ tenant_id: tenantId, lead_id: lead.data.id, partner_id: partnerId, product_line: productLine, pipeline_id: pipeline.pipelineId, stage_id: pipeline.stage.id, insured_name: name, phone, initial_quote: text(input.initial_quote, "Initial quote", 1000, false), local_date: localDate, carrier: text(input.carrier, "Carrier", 160, false), product_type: text(input.product_type, "Product type", 160, false), monthly_premium_cents: amount(input.monthly_premium_cents, "Monthly premium"), face_amount_cents: amount(input.face_amount_cents, "Face amount"), draft_date: input.draft_date == null || input.draft_date === "" ? null : date(input.draft_date, "Draft date"), status: input.status == null ? "partial" : status(input.status), call_result: text(input.call_result, "Call result", 120, false), notes: text(input.notes, "Notes", 5000, false), worked_by: userId, manual_entry: true }).select(select).single();
  if (deal.error || !deal.data) { await db.from("agent_leads").delete().eq("tenant_id", tenantId).eq("id", lead.data.id); throw new Error(deal.error?.message ?? "Could not create the manual deal"); }
  return deal.data;
}

export function csvForDealFlow(rows: DealFlowRow[]) {
  const cell = (value: unknown) => { const raw = String(value ?? ""); const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw; return `"${safe.replaceAll('"', '""')}"`; };
  const headers = ["date", "partner", "agent", "insured_name", "phone", "product_line", "carrier", "product_type", "monthly_premium_cents", "face_amount_cents", "draft_date", "status", "call_result", "notes", "initial_quote", "manual_entry"];
  return [headers, ...rows.map((row) => [row.local_date, row.partner_name, row.agent_name, row.insured_name, row.phone, row.product_line, row.carrier, row.product_type, row.monthly_premium_cents, row.face_amount_cents, row.draft_date, row.status, row.call_result, row.notes, row.initial_quote, row.manual_entry])].map((line) => line.map(cell).join(",")).join("\r\n") + "\r\n";
}
