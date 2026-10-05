import "server-only";

import { getTenantTemplateForProduct } from "@/lib/agentTemplates/service";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveRuntimeStage, partnerTypeForLead } from "@/lib/pipelines/service";
import type { DealFlowFilterOptions, DealFlowKpis, DealFlowReport, DealFlowRow, DealFlowSource, DealFlowStageType, DealFlowStatus, DealFlowSummary } from "./types";
import { DEAL_FLOW_STAGE_TYPES, DEAL_FLOW_STATUSES, shortLeadId } from "./types";

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

export type DealFlowListFilters = {
  fromDate?: string;
  toDate?: string;
  partnerId?: string;
  productLine?: string;
  agentId?: string;
  status?: string;
  stageType?: string;
  search?: string;
  focusLeadId?: string;
  /** null = the page that holds focusLeadId (page 1 when there is no focus). */
  page?: number | null;
  pageSize?: number;
};

type RawRow = Record<string, unknown>;
type RpcError = { code?: string; message: string } | null;
/** list_deal_flow_report's new parameters are not in the generated types; called untyped. */
type UntypedDb = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: RpcError }>;
  from: (table: string) => {
    select: (columns: string) => UntypedQuery;
  };
};
type UntypedQuery = PromiseLike<{ data: RawRow[] | null; error: RpcError }> & {
  eq: (column: string, value: unknown) => UntypedQuery;
  in: (column: string, values: unknown[]) => UntypedQuery;
  order: (column: string, options?: { ascending?: boolean }) => UntypedQuery;
  limit: (count: number) => UntypedQuery;
};

/** The schema is older than this code: a function, column or table it names is not there yet. */
const MISSING_SCHEMA = new Set(["PGRST202", "PGRST204", "PGRST205", "42883", "42703", "42P01"]);
function schemaMissing(error: RpcError) {
  return !!error && (MISSING_SCHEMA.has(error.code ?? "") || /could not find the function/i.test(error.message));
}

/** Before migration 20260924320000 the report is read whole (the old function caps at this) and paged here. */
const LEGACY_CAP = 10000;

const str = (value: unknown) => (typeof value === "string" && value.length > 0 ? value : null);
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const isStageType = (value: unknown): value is DealFlowStageType => DEAL_FLOW_STAGE_TYPES.includes(value as DealFlowStageType);
const SOURCES: DealFlowSource[] = ["inbound", "outbound", "manual"];

function cleanSearch(value: unknown) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120);
  return cleaned || null;
}

function normaliseRow(raw: RawRow, partners: Map<string, string>, agents: Map<string, string>): DealFlowRow {
  const partnerId = str(raw.partner_id);
  const workedBy = str(raw.worked_by);
  const dispositionBy = str(raw.disposition_by);
  const statusValue = DEAL_FLOW_STATUSES.includes(raw.status as DealFlowStatus) ? (raw.status as DealFlowStatus) : "partial";
  const history = Array.isArray(raw.history)
    ? (raw.history as unknown[]).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const entry = item as RawRow;
        const at = str(entry.at);
        return at ? [{ at, disposition: str(entry.disposition), label: str(entry.label), by_name: str(entry.by_name) }] : [];
      })
    : [];
  return {
    id: String(raw.id),
    lead_id: String(raw.lead_id),
    partner_id: partnerId,
    partner_name: str(raw.partner_name) ?? (partnerId ? partners.get(partnerId) ?? "Unknown partner" : "No partner"),
    submission_id: str(raw.submission_id),
    product_line: str(raw.product_line) ?? "",
    insured_name: str(raw.insured_name),
    phone: str(raw.phone),
    initial_quote: str(raw.initial_quote),
    tracking_id: str(raw.tracking_id),
    local_date: str(raw.local_date) ?? "",
    status: statusValue,
    call_result: str(raw.call_result),
    notes: str(raw.notes),
    carrier: str(raw.carrier),
    product_type: str(raw.product_type),
    monthly_premium_cents: num(raw.monthly_premium_cents),
    face_amount_cents: num(raw.face_amount_cents),
    draft_date: str(raw.draft_date),
    worked_by: workedBy,
    agent_name: str(raw.worked_by_name) ?? (workedBy ? agents.get(workedBy) ?? "Unknown agent" : "Unassigned"),
    buffer_agent: str(raw.buffer_agent),
    buffer_agent_name: str(raw.buffer_agent_name) ?? (str(raw.buffer_agent) ? agents.get(String(raw.buffer_agent)) ?? null : null),
    manual_entry: raw.manual_entry === true,
    created_at: str(raw.created_at) ?? "",
    updated_at: str(raw.updated_at) ?? "",
    campaign_id: str(raw.campaign_id),
    campaign_name: str(raw.campaign_name),
    vendor_name: str(raw.vendor_name),
    source: SOURCES.includes(raw.source as DealFlowSource) ? (raw.source as DealFlowSource) : null,
    disposition_at: str(raw.disposition_at),
    disposition_by: dispositionBy,
    disposition_by_name: str(raw.disposition_by_name) ?? (dispositionBy ? agents.get(dispositionBy) ?? null : null),
    call_result_label: str(raw.call_result_label),
    customer_state: str(raw.customer_state),
    stage_name: str(raw.stage_name),
    stage_type: isStageType(raw.stage_type) ? raw.stage_type : null,
    stage_drift: raw.stage_drift === true,
    issued_at: str(raw.issued_at),
    history,
  };
}

function summaryFrom(raw: unknown, partners: Map<string, string>): DealFlowSummary[] {
  const map = new Map<string, DealFlowSummary>();
  for (const item of Array.isArray(raw) ? (raw as RawRow[]) : []) {
    const partnerId = str(item.partner_id);
    const total = num(item.total) ?? 0;
    const key = partnerId ?? "none";
    const current = map.get(key) ?? { partner_id: partnerId, partner_name: str(item.partner_name) ?? (partnerId ? partners.get(partnerId) ?? "Unknown partner" : "No partner"), total: 0, won: 0, in_progress: 0, lost: 0, completed: 0, partial: 0, dropped: 0 };
    current.total += total;
    if (item.status === "completed") current.completed += total;
    if (item.status === "partial") current.partial += total;
    if (item.status === "dropped") current.dropped += total;
    if (item.stage_type === "won") current.won += total;
    else if (item.stage_type === "lost") current.lost += total;
    else current.in_progress += total;
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || a.partner_name.localeCompare(b.partner_name));
}

function kpisFor(rows: DealFlowRow[]): DealFlowKpis {
  const open = rows.filter((row) => row.stage_type !== "won" && row.stage_type !== "lost");
  const won = rows.filter((row) => row.stage_type === "won");
  const oldest = open.reduce<number | null>((min, row) => { const at = Date.parse(row.created_at); return Number.isNaN(at) ? min : min == null ? at : Math.min(min, at); }, null);
  return {
    deals_worked: rows.length,
    won: won.length,
    won_annualised_cents: won.reduce((sum, row) => sum + (row.monthly_premium_cents ?? 0) * 12, 0),
    won_unpriced: won.filter((row) => row.monthly_premium_cents == null).length,
    in_progress: open.length,
    oldest_in_progress_days: oldest == null ? null : Math.floor((Date.now() - oldest) / 86_400_000),
    lost: rows.filter((row) => row.stage_type === "lost").length,
    stage_drift: rows.filter((row) => row.stage_drift).length,
  };
}

function kpisFrom(raw: unknown): DealFlowKpis | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const k = raw as RawRow;
  return {
    deals_worked: num(k.deals_worked) ?? 0,
    won: num(k.won) ?? 0,
    won_annualised_cents: num(k.won_annualised_cents) ?? 0,
    won_unpriced: num(k.won_unpriced) ?? 0,
    in_progress: num(k.in_progress) ?? 0,
    oldest_in_progress_days: num(k.oldest_in_progress_days),
    lost: num(k.lost) ?? 0,
    stage_drift: num(k.stage_drift) ?? 0,
  };
}

/** The same fields the report searches, for the fallback that searches here. */
function matchesSearch(row: DealFlowRow, term: string) {
  const needle = term.toLowerCase();
  const digits = term.replace(/\D/g, "");
  const fields = [row.insured_name, row.phone, row.partner_name, row.product_line, row.carrier, row.call_result, row.call_result_label, row.campaign_name, row.vendor_name, row.stage_name, row.customer_state];
  if (fields.some((value) => value?.toLowerCase().includes(needle))) return true;
  if (row.lead_id.startsWith(needle)) return true;
  return digits.length >= 3 && (row.phone ?? "").replace(/\D/g, "").includes(digits);
}

function optionsFrom(raw: unknown): DealFlowFilterOptions | null {
  const embedded = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { partners?: unknown; agents?: unknown }) : null;
  return embedded && Array.isArray(embedded.partners) && Array.isArray(embedded.agents)
    ? { partners: embedded.partners as DealFlowFilterOptions["partners"], agents: embedded.agents as DealFlowFilterOptions["agents"] }
    : null;
}

async function selectIn(db: UntypedDb, table: string, columns: string, key: string, ids: string[], tenantId: string | null): Promise<RawRow[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out: RawRow[] = [];
  for (let i = 0; i < unique.length; i += 200) {
    let query = db.from(table).select(columns);
    if (tenantId) query = query.eq("tenant_id", tenantId);
    const { data, error } = await query.in(key, unique.slice(i, i + 200));
    // Best effort: a lookup the schema cannot answer yet leaves those fields empty, not the page.
    if (error) return out;
    out.push(...(data ?? []));
  }
  return out;
}

/**
 * Adds, before migration 20260924320000, the fields the new report returns: the lead's current
 * stage, its state, the campaign, vendor and the disposition label. History and issued policies
 * are left empty; the page says so.
 */
async function enrichLegacyRows(db: UntypedDb, tenantId: string, raws: RawRow[]): Promise<RawRow[]> {
  if (raws.length === 0) return raws;
  const [extras, leads, dispositions] = await Promise.all([
    selectIn(db, "deal_flow", "id, stage_id, campaign_id, vendor_id, source, disposition_at, disposition_by", "id", raws.map((row) => String(row.id)), tenantId),
    selectIn(db, "agent_leads", "id, stage_id, values", "id", raws.map((row) => String(row.lead_id)), tenantId),
    db.from("dispositions").select("disposition_key, label").eq("tenant_id", tenantId).then((result) => (result.error ? [] : result.data ?? [])),
  ]);
  const extraById = new Map(extras.map((row) => [String(row.id), row]));
  const leadById = new Map(leads.map((row) => [String(row.id), row]));
  const stageIds = [...leads.map((row) => str(row.stage_id)), ...extras.map((row) => str(row.stage_id))].filter((id): id is string => !!id);
  const campaignIds = extras.map((row) => str(row.campaign_id)).filter((id): id is string => !!id);
  const [stages, campaigns] = await Promise.all([
    selectIn(db, "tenant_pipeline_stages", "id, name, stage_type", "id", stageIds, null),
    selectIn(db, "tenant_campaigns", "id, name, vendor_id", "id", campaignIds, tenantId),
  ]);
  const campaignById = new Map(campaigns.map((row) => [String(row.id), row]));
  const vendorIds = [...extras.map((row) => str(row.vendor_id)), ...campaigns.map((row) => str(row.vendor_id))].filter((id): id is string => !!id);
  const vendors = await selectIn(db, "tenant_lead_vendors", "id, name", "id", vendorIds, tenantId);
  const stageById = new Map(stages.map((row) => [String(row.id), row]));
  const vendorById = new Map(vendors.map((row) => [String(row.id), str(row.name)]));
  const labelByKey = new Map(dispositions.map((row) => [String(row.disposition_key), str(row.label)]));
  return raws.map((raw) => {
    const extra = extraById.get(String(raw.id)) ?? {};
    const lead = leadById.get(String(raw.lead_id));
    const values = lead?.values && typeof lead.values === "object" ? (lead.values as RawRow) : {};
    const leadStage = str(lead?.stage_id);
    const dealStage = str(extra.stage_id);
    const stage = (leadStage ? stageById.get(leadStage) : undefined) ?? (dealStage ? stageById.get(dealStage) : undefined);
    const campaign = str(extra.campaign_id) ? campaignById.get(String(extra.campaign_id)) : undefined;
    const source = str(extra.source);
    const partnerName = str(raw.partner_name);
    const vendorName = source === "inbound" && partnerName ? partnerName : (str(extra.vendor_id) ? vendorById.get(String(extra.vendor_id)) : null) ?? (str(campaign?.vendor_id) ? vendorById.get(String(campaign?.vendor_id)) : null) ?? partnerName;
    const state = [values.state, values.state_code, values.primary_state].map((value) => (typeof value === "string" ? value.trim() : "")).find(Boolean) ?? null;
    return {
      ...raw,
      campaign_id: str(extra.campaign_id),
      campaign_name: str(campaign?.name),
      vendor_id: str(extra.vendor_id),
      vendor_name: vendorName,
      source,
      disposition_at: str(extra.disposition_at),
      disposition_by: str(extra.disposition_by),
      call_result_label: str(raw.call_result) ? labelByKey.get(String(raw.call_result)) ?? null : null,
      stage_name: str(stage?.name),
      stage_type: stage?.stage_type ?? null,
      stage_drift: !!leadStage && !!dealStage && leadStage !== dealStage,
      customer_state: state ? state.slice(0, 40) : null,
    };
  });
}

export async function listDealFlow(tenantId: string, filters: DealFlowListFilters): Promise<DealFlowReport> {
  const requestedPage = filters.page === null ? null : Number.isInteger(filters.page) && (filters.page ?? 1) > 0 ? (filters.page as number) : 1;
  const pageSize = Math.min(10000, Math.max(1, Number.isInteger(filters.pageSize) ? (filters.pageSize as number) : 100));
  const service = getSupabaseServiceClient();
  const db = service as unknown as UntypedDb;
  const fromDate = filters.fromDate ? date(filters.fromDate, "From date") : null;
  const toDate = filters.toDate ? date(filters.toDate, "To date") : null;
  const partnerId = filters.partnerId ? assertUuid(filters.partnerId, "partner") : null;
  const productLine = filters.productLine ? text(filters.productLine, "Product", 120) : null;
  const agentId = filters.agentId ? assertUuid(filters.agentId, "agent") : null;
  const selectedStatus = filters.status ? status(filters.status) : null;
  if (filters.stageType && !isStageType(filters.stageType)) throw new Error("Choose a valid status");
  const stageType = (filters.stageType as DealFlowStageType | undefined) ?? null;
  const search = cleanSearch(filters.search);
  // A focus id that is not a uuid is a stale or hand-edited link; it is ignored, not an error.
  const focusLeadId = typeof filters.focusLeadId === "string" && UUID.test(filters.focusLeadId) ? filters.focusLeadId : null;
  const page = requestedPage ?? (focusLeadId ? null : 1);

  const next = await db.rpc("list_deal_flow_report", {
    p_tenant_id: tenantId, p_from_date: fromDate, p_to_date: toDate, p_partner_id: partnerId, p_product_line: productLine,
    p_agent_id: agentId, p_status: selectedStatus, p_page: page, p_page_size: pageSize,
    p_search: search, p_stage_type: stageType, p_focus_lead_id: focusLeadId,
  });
  if (next.error && !schemaMissing(next.error)) throw new Error(`Could not load daily deal flow: ${next.error.message}`);

  if (!next.error) {
    const report = (next.data && typeof next.data === "object" && !Array.isArray(next.data) ? next.data : {}) as RawRow;
    const options = optionsFrom(report.options) ?? (await lookups(tenantId));
    const partners = new Map(options.partners.map((partner) => [partner.id, partner.name]));
    const agents = new Map(options.agents.map((agent) => [agent.id, agent.name]));
    const rows = (Array.isArray(report.rows) ? (report.rows as RawRow[]) : []).map((row) => normaliseRow(row, partners, agents));
    const total = num(report.total) ?? 0;
    const focusRaw = report.focus && typeof report.focus === "object" ? (report.focus as RawRow) : null;
    const focusRow = focusRaw?.row && typeof focusRaw.row === "object" ? normaliseRow(focusRaw.row as RawRow, partners, agents) : null;
    return {
      rows,
      total,
      page: num(report.page) ?? page ?? 1,
      pageSize: num(report.page_size) ?? pageSize,
      kpis: kpisFrom(report.kpis) ?? kpisFor(rows),
      summary: summaryFrom(report.summary, partners),
      options,
      focus: focusLeadId ? { leadId: focusLeadId, position: num(focusRaw?.position), inFilter: focusRaw?.in_filter === true, row: focusRow } : null,
      schemaPending: false,
      capped: false,
    };
  }

  // Migration 20260924320000 is not applied: read the old report whole and do its new work here.
  const legacy = await service.rpc("list_deal_flow_report", { p_tenant_id: tenantId, p_from_date: fromDate, p_to_date: toDate, p_partner_id: partnerId, p_product_line: productLine, p_agent_id: agentId, p_status: selectedStatus, p_page: 1, p_page_size: LEGACY_CAP });
  if (legacy.error) throw new Error(`Could not load daily deal flow: ${legacy.error.message}`);
  const report = (legacy.data && typeof legacy.data === "object" && !Array.isArray(legacy.data) ? legacy.data : {}) as unknown as RawRow;
  const options = optionsFrom(report.options) ?? (await lookups(tenantId));
  const partners = new Map(options.partners.map((partner) => [partner.id, partner.name]));
  const agents = new Map(options.agents.map((agent) => [agent.id, agent.name]));
  const named = (Array.isArray(report.rows) ? (report.rows as RawRow[]) : []).map((row) => ({ ...row, partner_name: str(row.partner_id) ? partners.get(String(row.partner_id)) ?? "Unknown partner" : "No partner" }));
  const all = (await enrichLegacyRows(db, tenantId, named)).map((row) => normaliseRow(row, partners, agents));
  const filtered = all.filter((row) => (!stageType || (row.stage_type ?? "open") === stageType) && (!search || matchesSearch(row, search)));
  const position = focusLeadId ? filtered.findIndex((row) => row.lead_id === focusLeadId) + 1 || null : null;
  const resolvedPage = page ?? (position ? Math.ceil(position / pageSize) : 1);
  const rows = filtered.slice((resolvedPage - 1) * pageSize, resolvedPage * pageSize);
  let focusRow: DealFlowRow | null = null;
  if (focusLeadId && !position) {
    const pinned = await getSupabaseServiceClient().from("deal_flow").select(select).eq("tenant_id", tenantId).eq("lead_id", focusLeadId).order("local_date", { ascending: false }).limit(1);
    const raw = pinned.error ? null : (pinned.data?.[0] as unknown as RawRow | undefined);
    if (raw) {
      const withPartner = { ...raw, partner_name: str(raw.partner_id) ? partners.get(String(raw.partner_id)) ?? "Unknown partner" : "No partner" };
      focusRow = normaliseRow((await enrichLegacyRows(db, tenantId, [withPartner]))[0], partners, agents);
    }
  }
  const legacySummary = summaryFrom(
    Object.values(filtered.reduce<Record<string, RawRow>>((acc, row) => {
      const key = `${row.partner_id ?? "none"}|${row.status}|${row.stage_type ?? "open"}`;
      acc[key] = { partner_id: row.partner_id, partner_name: row.partner_name, status: row.status, stage_type: row.stage_type ?? "open", total: ((acc[key]?.total as number | undefined) ?? 0) + 1 };
      return acc;
    }, {})),
    partners,
  );
  return {
    rows,
    total: filtered.length,
    page: resolvedPage,
    pageSize,
    kpis: kpisFor(filtered),
    summary: legacySummary,
    options,
    focus: focusLeadId ? { leadId: focusLeadId, position, inFilter: !!position, row: focusRow } : null,
    schemaPending: true,
    capped: (num(report.total) ?? 0) > LEGACY_CAP,
  };
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
  // Deal flow consumes the tenant's already-provisioned template copy. It must not reach back
  // into plans, subscriptions or prices as a side effect of a reporting write.
  const template = await getTenantTemplateForProduct(tenantId, productLine);
  const pipeline = await resolveRuntimeStage(tenantId, "new", await partnerTypeForLead(tenantId, partnerId));
  const db = getSupabaseServiceClient();
  const lead = await db.from("agent_leads").insert({ tenant_id: tenantId, tenant_template_id: template.tenant_template_id, template_id: template.assignment.template_id, template_version: template.assignment.template_version, definition_version: template.assignment.definition_version, product_line: productLine, pipeline_id: pipeline.pipelineId, stage_id: pipeline.stage.id, partner_id: partnerId, values: { full_name: name, phone }, created_by: userId }).select("id").single();
  if (lead.error || !lead.data) throw new Error(lead.error?.message ?? "Could not create the manual lead");
  const deal = await db.from("deal_flow").insert({ tenant_id: tenantId, lead_id: lead.data.id, partner_id: partnerId, product_line: productLine, pipeline_id: pipeline.pipelineId, stage_id: pipeline.stage.id, insured_name: name, phone, initial_quote: text(input.initial_quote, "Initial quote", 1000, false), local_date: localDate, carrier: text(input.carrier, "Carrier", 160, false), product_type: text(input.product_type, "Product type", 160, false), monthly_premium_cents: amount(input.monthly_premium_cents, "Monthly premium"), face_amount_cents: amount(input.face_amount_cents, "Face amount"), draft_date: input.draft_date == null || input.draft_date === "" ? null : date(input.draft_date, "Draft date"), status: input.status == null ? "partial" : status(input.status), call_result: text(input.call_result, "Call result", 120, false), notes: text(input.notes, "Notes", 5000, false), worked_by: userId, manual_entry: true }).select(select).single();
  if (deal.error || !deal.data) { await db.from("agent_leads").delete().eq("tenant_id", tenantId).eq("id", lead.data.id); throw new Error(deal.error?.message ?? "Could not create the manual deal"); }
  return deal.data;
}

const csvCell = (value: unknown) => { const raw = String(value ?? ""); const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw; return `"${safe.replaceAll('"', '""')}"`; };
// The first sixteen columns are the export's original shape and stay in place for the
// spreadsheets already reading it; everything the board added is appended after them.
const CSV_HEADERS = [
  "date", "partner", "agent", "insured_name", "phone", "product_line", "carrier", "product_type", "monthly_premium_cents", "face_amount_cents", "draft_date", "status", "call_result", "notes", "initial_quote", "manual_entry",
  "lead_id", "short_id", "campaign", "vendor", "state", "stage", "stage_type", "source", "disposition", "disposition_at", "disposition_by", "annualised_premium_cents", "issued_at",
  "buffer_agent", "tracking_id",
];

/** The CSV's header line, CRLF-terminated. */
export function dealFlowCsvHeader() {
  return CSV_HEADERS.map(csvCell).join(",") + "\r\n";
}

/** One CRLF-terminated CSV line per row, in the header's column order. Empty for no rows. */
export function dealFlowCsvLines(rows: DealFlowRow[]) {
  return rows.map((row) => [
    row.local_date, row.partner_name, row.agent_name, row.insured_name, row.phone, row.product_line, row.carrier, row.product_type, row.monthly_premium_cents, row.face_amount_cents, row.draft_date, row.status, row.call_result, row.notes, row.initial_quote, row.manual_entry,
    row.lead_id, shortLeadId(row.lead_id), row.campaign_name, row.vendor_name, row.customer_state, row.stage_name, row.stage_type, row.source, row.call_result_label ?? row.call_result, row.disposition_at, row.disposition_by_name, row.monthly_premium_cents == null ? null : row.monthly_premium_cents * 12, row.issued_at,
    row.buffer_agent_name, row.tracking_id,
  ].map(csvCell).join(",") + "\r\n").join("");
}

export function csvForDealFlow(rows: DealFlowRow[]) {
  return dealFlowCsvHeader() + dealFlowCsvLines(rows);
}

/**
 * Deals per export read. The CSV used to be one 10,000-row list_deal_flow_report page, which hit the
 * statement timeout at 10,000 deals (LA-1.13-10, 2026-09-30). Each read now handles at most this many.
 */
export const DEAL_FLOW_EXPORT_PAGE_SIZE = 1000;
/** A runaway guard: 100 reads of 1,000 is ten times the report's supported size. */
const DEAL_FLOW_EXPORT_MAX_PAGES = 100;

type ExportCursor = { local_date: string; created_at: string; id: string };

function exportCursor(raw: unknown): ExportCursor | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as RawRow;
  const localDate = str(value.local_date);
  const createdAt = str(value.created_at);
  const id = str(value.id);
  return localDate && createdAt && id ? { local_date: localDate, created_at: createdAt, id } : null;
}

/**
 * The deal flow report's rows for the CSV, one bounded page at a time, in the grid's order and under
 * the grid's filters. Migration 20260929140200's list_deal_flow_export walks the report with a
 * keyset cursor. Before it is applied, the report itself is paged (page_size 1,000), which is slower
 * but no single read grows with the export.
 */
export async function* dealFlowExportPages(tenantId: string, filters: DealFlowListFilters): AsyncGenerator<DealFlowRow[]> {
  const db = getSupabaseServiceClient() as unknown as UntypedDb;
  const args = {
    p_tenant_id: tenantId,
    p_from_date: filters.fromDate ? date(filters.fromDate, "From date") : null,
    p_to_date: filters.toDate ? date(filters.toDate, "To date") : null,
    p_partner_id: filters.partnerId ? assertUuid(filters.partnerId, "partner") : null,
    p_product_line: filters.productLine ? text(filters.productLine, "Product", 120) : null,
    p_agent_id: filters.agentId ? assertUuid(filters.agentId, "agent") : null,
    p_status: filters.status ? status(filters.status) : null,
    p_search: cleanSearch(filters.search),
    p_stage_type: filters.stageType ?? null,
    p_limit: DEAL_FLOW_EXPORT_PAGE_SIZE,
  };
  if (filters.stageType && !isStageType(filters.stageType)) throw new Error("Choose a valid status");

  let cursor: ExportCursor | null = null;
  let maps: { partners: Map<string, string>; agents: Map<string, string> } | null = null;
  for (let read = 0; read < DEAL_FLOW_EXPORT_MAX_PAGES; read += 1) {
    const result = await db.rpc("list_deal_flow_export", { ...args, p_after_local_date: cursor?.local_date ?? null, p_after_created_at: cursor?.created_at ?? null, p_after_id: cursor?.id ?? null });
    if (result.error && read === 0 && schemaMissing(result.error)) {
      yield* reportPages(tenantId, filters);
      return;
    }
    if (result.error) throw new Error(`Could not export daily deal flow: ${result.error.message}`);
    const payload = (result.data && typeof result.data === "object" && !Array.isArray(result.data) ? result.data : {}) as RawRow;
    if (!maps) {
      const options = await lookups(tenantId);
      maps = { partners: new Map(options.partners.map((partner) => [partner.id, partner.name])), agents: new Map(options.agents.map((agent) => [agent.id, agent.name])) };
    }
    const { partners, agents } = maps;
    const rows = (Array.isArray(payload.rows) ? (payload.rows as RawRow[]) : []).map((row) => normaliseRow(row, partners, agents));
    if (rows.length) yield rows;
    cursor = payload.more === true ? exportCursor(payload.next) : null;
    if (!cursor) return;
  }
  throw new Error("Could not export daily deal flow: the export is larger than the report supports");
}

/** Before 20260929140200: the report's own pages, DEAL_FLOW_EXPORT_PAGE_SIZE rows each. */
async function* reportPages(tenantId: string, filters: DealFlowListFilters): AsyncGenerator<DealFlowRow[]> {
  for (let page = 1; page <= DEAL_FLOW_EXPORT_MAX_PAGES; page += 1) {
    const report = await listDealFlow(tenantId, { ...filters, focusLeadId: undefined, page, pageSize: DEAL_FLOW_EXPORT_PAGE_SIZE });
    if (report.rows.length) yield report.rows;
    if (report.rows.length < DEAL_FLOW_EXPORT_PAGE_SIZE || page * DEAL_FLOW_EXPORT_PAGE_SIZE >= report.total) return;
  }
  throw new Error("Could not export daily deal flow: the export is larger than the report supports");
}
