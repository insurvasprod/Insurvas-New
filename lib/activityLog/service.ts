import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import {
  blockedForPage,
  mayReviewZeroClick,
  type ActivityFlagFilter,
  type ActivityReport,
  type ActivityRow,
  type BlockedDialRow,
  type RecyclePerformanceRow,
  type ScorecardRow,
} from "@/lib/activityLog/types";

export type { ActivityReport, ActivityRow, BlockedDialRow, RecyclePerformanceRow, ScorecardRow } from "@/lib/activityLog/types";

type RpcError = { message: string; code?: string };
type RpcClient = { rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: RpcError | null }> };
const rpc = () => getSupabaseServiceClient() as unknown as RpcClient;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ActivityFilters = {
  agentId?: string | null; campaignId?: string | null; disposition?: string | null; from?: string | null; to?: string | null;
  page?: number; pageSize?: number; exportAll?: boolean;
  /** Lead name contains this, case-insensitive. */
  search?: string | null;
  /** Only rows carrying an integrity flag — the board's "Data integrity" view. Same as `flag: "any"`. */
  integrityOnly?: boolean;
  /** One integrity flag, or "any". `zero_click_disposition` is for owners and producers only. */
  flag?: ActivityFlagFilter | null;
  /** Read the refused dials for this page (default). The page's total-only reads turn it off. */
  includeBlocked?: boolean;
};

/** Refused before it ran: a setter asking for the zero-click review. The route answers 403. */
export class ActivityForbiddenError extends Error {}

function optionalUuid(value: unknown, label: string) { if (value == null || value === "") return null; if (typeof value !== "string" || !UUID.test(value)) throw new Error(`Invalid ${label}`); return value; }
function boundary(value: unknown, label: string) { if (value == null || value === "") return null; if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(`Invalid ${label}`); return new Date(value).toISOString(); }
function response(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The activity report was invalid"); return value as Record<string, unknown>; }

/** The report function without p_flag (20260925705100 not applied yet): PostgREST cannot match the call. */
function isMissingSignature(error: RpcError) {
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message);
}

function hasFlag(row: ActivityRow, flag: ActivityFlagFilter) {
  return flag === "any" ? row.integrity_flags.length > 0 : row.integrity_flags.includes(flag);
}

export async function getActivityReport(tenantId: string, actorId: string, actorRole: string, filters: ActivityFilters = {}): Promise<ActivityReport> {
  const from = boundary(filters.from, "from date");
  const to = boundary(filters.to, "to date");
  if (from && to && from >= to) throw new Error("From date must be before the to date");
  const page = Number.isInteger(filters.page) ? Math.max(1, filters.page as number) : 1;
  const pageSize = Number.isInteger(filters.pageSize) ? Math.min(Math.max(1, filters.pageSize as number), 500) : 50;
  const agentId = optionalUuid(filters.agentId, "agent");
  const campaignId = optionalUuid(filters.campaignId, "campaign");
  const flag: ActivityFlagFilter | null = filters.flag ?? (filters.integrityOnly ? "any" : null);
  if (flag === "zero_click_disposition" && !mayReviewZeroClick(actorRole)) throw new ActivityForbiddenError("Only owners and producers can review outcomes logged without a dial.");
  const disposition = filters.disposition?.trim() || null;
  const args = { p_tenant_id: tenantId, p_actor_user_id: actorId, p_actor_role: actorRole, p_agent_user_id: agentId, p_campaign_id: campaignId, p_disposition: disposition, p_from_at: from, p_to_at: to };
  const search = filters.search?.trim().toLowerCase().slice(0, 100) || "";

  // The flag is filtered in SQL when the report takes p_flag (20260925705100). Search still narrows
  // here, because it matches on names the report does not build: the report then returns the whole
  // filtered set (export mode, still tenant- and role-scoped in SQL) and this pages it.
  const report = (withFlag: boolean) => rpc().rpc("tenant_activity_report", {
    ...args, p_page: page, p_page_size: pageSize,
    p_export: Boolean(filters.exportAll) || Boolean(search) || (Boolean(flag) && !withFlag),
    ...(withFlag && flag ? { p_flag: flag } : {}),
  });
  const [first, recycle] = await Promise.all([report(true), rpc().rpc("tenant_recycle_performance", args)]);
  let result = first;
  let flaggedInSql = Boolean(flag);
  if (result.error && flag && isMissingSignature(result.error)) {
    result = await report(false);
    flaggedInSql = false;
  }
  if (result.error) throw new Error(`Could not load activity: ${result.error.message}`);
  if (recycle.error) throw new Error(`Could not load recycle performance: ${recycle.error.message}`);
  const data = response(result.data);
  if (!Array.isArray(data.rows) || !Array.isArray(data.scorecard) || !Array.isArray(recycle.data)) throw new Error("The activity report was incomplete");

  // Names first: search matches on them, and the report function reads only `full_name`.
  let rows = await withLeadNames(tenantId, data.rows as ActivityRow[]);
  let total = Number(data.total ?? 0);
  const narrowed = Boolean(search) || (Boolean(flag) && !flaggedInSql);
  // The previous page's last row: where this page's share of refused dials ends (blockedForPage).
  let previousLast: string | null = null;
  if (narrowed) {
    const matching = rows.filter((row) =>
      (!search || (row.lead_name ?? "").toLowerCase().includes(search)) &&
      (!flag || flaggedInSql || hasFlag(row, flag)));
    total = matching.length;
    previousLast = page > 1 ? matching[(page - 1) * pageSize - 1]?.served_at ?? null : null;
    rows = filters.exportAll ? matching : matching.slice((page - 1) * pageSize, page * pageSize);
  }
  rows = await withAttempts(tenantId, rows);

  // Refused dials are part of the activity view only: not the integrity review (a refusal is not a
  // flagged outcome), not an outcome filter (a refusal has none), not the export.
  let blocked: BlockedDialRow[] | null = null;
  let blockedTotal: number | null = null;
  if (filters.includeBlocked !== false && !flag && !disposition && from && to) {
    const refusals = await readBlockedDials(tenantId, actorId, actorRole, { agentId, campaignId, search, from, to });
    if (refusals) {
      blockedTotal = refusals.length;
      if (!filters.exportAll) {
        if (!narrowed && page > 1 && rows.length > 0) previousLast = await servedAtOffset(tenantId, actorId, actorRole, { agentId, campaignId, from, to }, (page - 1) * pageSize - 1);
        const lastPage = page * pageSize >= total;
        blocked = total === 0
          ? (page === 1 ? refusals : [])
          : rows.length === 0 ? [] : blockedForPage(refusals, { windowFrom: from, windowTo: to, upper: page === 1 ? to : previousLast ?? rows[0].served_at, lower: rows[rows.length - 1].served_at, lastPage });
      }
    }
  }

  return { rows, total, page, page_size: pageSize, export: Boolean(filters.exportAll), scorecard: await withWorked(tenantId, data.scorecard as ScorecardRow[]), recycle_performance: recycle.data as RecyclePerformanceRow[], blocked, blocked_total: blockedTotal };
}

/**
 * "Counts as work" is the scorecard's flag (Settings → Dispositions): an agent's worked count is the
 * number of their logged outcomes whose disposition has it set. Read from the tenant's own outcome
 * rows, matched by key or by label, so a renamed or tenant-added outcome counts the way it is set.
 * Outcomes with no row (and "unlogged") do not count.
 */
export function countWorked(breakdown: Record<string, number> | null | undefined, working: ReadonlySet<string>): number {
  let worked = 0;
  for (const [disposition, n] of Object.entries(breakdown ?? {})) {
    if (working.has(disposition.trim().toLowerCase())) worked += Number(n) || 0;
  }
  return worked;
}

async function withWorked(tenantId: string, scorecard: ScorecardRow[]): Promise<ScorecardRow[]> {
  const { data, error } = await getSupabaseServiceClient().from("dispositions").select("disposition_key, label, counts_as_work_completed").eq("tenant_id", tenantId);
  if (error) throw new Error(`Could not load which outcomes count as work: ${error.message}`);
  const working = new Set<string>();
  for (const row of data ?? []) {
    if (!row.counts_as_work_completed) continue;
    working.add(row.disposition_key.toLowerCase());
    working.add(row.label.trim().toLowerCase());
  }
  return scorecard.map((row) => ({ ...row, worked: countWorked(row.disposition_breakdown, working) }));
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function leadName(values: Record<string, unknown>) {
  return text(values.full_name) || [text(values.first_name), text(values.last_name)].filter(Boolean).join(" ") || text(values.name);
}

function leadState(values: Record<string, unknown>) {
  return (text(values.state) || text(values.state_code) || text(values.primary_state)).slice(0, 40) || null;
}

/**
 * Fills `lead_name` where the report left it empty. The report reads `values->>'full_name'` only,
 * and most imported leads carry first and last name separately, so every such row read "Unnamed
 * lead" — and a search by name could never find them. Same precedence as the lead search.
 */
async function withLeadNames(tenantId: string, rows: ActivityRow[]): Promise<ActivityRow[]> {
  const missing = [...new Set(rows.filter((row) => !row.lead_name).map((row) => row.lead_id))];
  if (missing.length === 0) return rows;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseServiceClient() as any;
  const names = new Map<string, string>();
  for (let i = 0; i < missing.length; i += 200) {
    const { data, error } = await db
      .from("agent_leads")
      .select("id, values")
      .eq("tenant_id", tenantId)
      .in("id", missing.slice(i, i + 200));
    if (error) return rows;
    for (const lead of (data ?? []) as { id: string; values: Record<string, unknown> | null }[]) {
      const name = leadName(lead.values ?? {});
      if (name) names.set(lead.id, name);
    }
  }
  return rows.map((row) => (row.lead_name ? row : { ...row, lead_name: names.get(row.lead_id) ?? null }));
}

/**
 * The board's "Attempt" column. Once the report carries the dialer's own attempt number for the
 * linked call (20260925705100), that is the attempt, and a card nobody dialled has none. Before
 * that, each row is numbered by how many times its lead had been served up to and including it,
 * counted across every agent, because the attempt belongs to the lead. A lookup that fails leaves
 * the column blank rather than guessing.
 */
async function withAttempts(tenantId: string, rows: ActivityRow[]): Promise<ActivityRow[]> {
  if (rows.length === 0) return rows;
  if (rows.every((row) => "dial_attempt_number" in row)) return rows.map((row) => ({ ...row, attempt: row.dial_attempt_number ?? null }));
  const leadIds = [...new Set(rows.map((row) => row.lead_id))];
  const latest = rows.reduce((max, row) => (row.served_at > max ? row.served_at : max), rows[0].served_at);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseServiceClient() as any;
  const earlier: { id: string; lead_id: string; served_at: string }[] = [];
  for (let i = 0; i < leadIds.length; i += 200) {
    const { data, error } = await db
      .from("tenant_lead_activity")
      .select("id, lead_id, served_at")
      .eq("tenant_id", tenantId)
      .in("lead_id", leadIds.slice(i, i + 200))
      .lte("served_at", latest);
    if (error) return rows;
    earlier.push(...(data ?? []));
  }
  const byLead = new Map<string, { id: string; served_at: string }[]>();
  for (const event of earlier) (byLead.get(event.lead_id) ?? byLead.set(event.lead_id, []).get(event.lead_id)!).push(event);
  // Same order the report uses: served_at, then id.
  const before = (a: { id: string; served_at: string }, b: { id: string; served_at: string }) =>
    a.served_at < b.served_at || (a.served_at === b.served_at && a.id <= b.id);
  return rows.map((row) => ({
    ...row,
    attempt: (byLead.get(row.lead_id) ?? []).filter((event) => before(event, row)).length || null,
  }));
}

/**
 * served_at of the row at `offset` in the report's order, under the report's own filters (tenant,
 * agent, campaign, window, a setter's own rows). Only asked for the unfiltered activity view,
 * where the report's rows are exactly these.
 */
async function servedAtOffset(tenantId: string, actorId: string, actorRole: string, f: { agentId: string | null; campaignId: string | null; from: string; to: string }, offset: number): Promise<string | null> {
  if (offset < 0) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (getSupabaseServiceClient() as any)
    .from("tenant_lead_activity")
    .select("served_at")
    .eq("tenant_id", tenantId)
    .gte("served_at", f.from)
    .lt("served_at", f.to);
  const agent = actorRole === "setter" ? actorId : f.agentId;
  if (agent) query = query.eq("agent_user_id", agent);
  if (f.campaignId) query = query.eq("campaign_id", f.campaignId);
  const { data, error } = await query.order("served_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset);
  if (error) return null;
  return (data?.[0]?.served_at as string | undefined) ?? null;
}

const BLOCKED_LIMIT = 2000;

/**
 * Refused dials in the window: audit_log `tenant.dial_refused`, written at prepare
 * (app/api/app/dialer/attempt) and at the Dial press. Scoped to the tenant twice — the row's own
 * tenantId, and the lead must be this tenant's. A setter sees their own; the agent filter is the
 * agent who tried. Null when they cannot be read: the log still loads, without them.
 */
async function readBlockedDials(
  tenantId: string, actorId: string, actorRole: string,
  f: { agentId: string | null; campaignId: string | null; search: string; from: string; to: string },
): Promise<BlockedDialRow[] | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseServiceClient() as any;
  let query = db
    .from("audit_log")
    .select("id, actor_id, ts, target_id, metadata")
    .eq("action", "tenant.dial_refused")
    .eq("target_type", "lead")
    .eq("metadata->>tenantId", tenantId)
    .gte("ts", f.from)
    .lt("ts", f.to);
  const agent = actorRole === "setter" ? actorId : f.agentId;
  if (agent) query = query.eq("actor_id", agent);
  const refused = await query.order("ts", { ascending: false }).limit(BLOCKED_LIMIT);
  if (refused.error) return null;
  const events = ((refused.data ?? []) as { id: string; actor_id: string | null; ts: string; target_id: string | null; metadata: Record<string, unknown> | null }[])
    .filter((row) => row.target_id && UUID.test(String(row.target_id)));
  if (events.length === 0) return [];

  const leadIds = [...new Set(events.map((row) => String(row.target_id)))];
  const leads = new Map<string, { values: Record<string, unknown>; campaign_id: string | null }>();
  for (let i = 0; i < leadIds.length; i += 200) {
    const { data, error } = await db.from("agent_leads").select("id, values, campaign_id").eq("tenant_id", tenantId).in("id", leadIds.slice(i, i + 200));
    if (error) return null;
    for (const lead of (data ?? []) as { id: string; values: Record<string, unknown> | null; campaign_id: string | null }[]) leads.set(lead.id, { values: lead.values ?? {}, campaign_id: lead.campaign_id });
  }
  const campaignIds = [...new Set([...leads.values()].map((lead) => lead.campaign_id).filter((id): id is string => Boolean(id)))];
  const agentIds = [...new Set(events.map((row) => row.actor_id).filter((id): id is string => Boolean(id)))];
  const [campaigns, users] = await Promise.all([
    campaignIds.length ? db.from("tenant_campaigns").select("id, name").eq("tenant_id", tenantId).in("id", campaignIds) : { data: [], error: null },
    agentIds.length ? db.from("users").select("id, name").in("id", agentIds) : { data: [], error: null },
  ]);
  const campaignName = new Map<string, string>(((campaigns.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name]));
  const userName = new Map<string, string>(((users.data ?? []) as { id: string; name: string | null }[]).map((row) => [row.id, row.name ?? ""]));

  const rows: BlockedDialRow[] = [];
  for (const event of events) {
    const lead = leads.get(String(event.target_id));
    if (!lead) continue; // not this tenant's lead
    if (f.campaignId && lead.campaign_id !== f.campaignId) continue;
    const name = leadName(lead.values) || null;
    if (f.search && !(name ?? "").toLowerCase().includes(f.search)) continue;
    const metadata = event.metadata ?? {};
    rows.push({
      id: event.id,
      lead_id: String(event.target_id),
      lead_name: name,
      lead_state: leadState(lead.values),
      campaign_id: lead.campaign_id,
      campaign_name: lead.campaign_id ? campaignName.get(lead.campaign_id) ?? null : null,
      agent_user_id: event.actor_id,
      agent_name: (event.actor_id && userName.get(event.actor_id)) || "Unknown agent",
      at: event.ts,
      reason: text(metadata.reason) || null,
      message: text(metadata.message) || null,
      inbound: metadata.inbound === true,
    });
  }
  return rows;
}

export async function markActivityClick(tenantId: string, actorId: string, activityId: string) {
  const parsed = optionalUuid(activityId, "activity"); if (!parsed) throw new Error("Choose an activity");
  const result = await rpc().rpc("mark_lead_activity_click", { p_tenant_id: tenantId, p_activity_id: parsed, p_actor: actorId, p_clicked_at: new Date().toISOString() });
  if (result.error) throw new Error(`Could not record the number click: ${result.error.message}`);
  return response(result.data);
}

export async function markActivityDisposition(tenantId: string, actorId: string, input: { activityId: string; disposition: string; cardOpenSeconds?: number | null; notes?: string | null }) {
  const activityId = optionalUuid(input.activityId, "activity"); if (!activityId) throw new Error("Choose an activity");
  if (!input.disposition.trim() || input.disposition.trim().length > 120) throw new Error("Choose a valid disposition");
  if (input.cardOpenSeconds != null && (!Number.isInteger(input.cardOpenSeconds) || input.cardOpenSeconds < 0 || input.cardOpenSeconds > 86400)) throw new Error("Card open seconds must be between 0 and 86,400");
  const result = await rpc().rpc("mark_lead_activity_disposition", { p_tenant_id: tenantId, p_activity_id: activityId, p_actor: actorId, p_disposition: input.disposition.trim(), p_card_open_seconds: input.cardOpenSeconds ?? null, p_notes: input.notes?.trim() || null, p_dispositioned_at: new Date().toISOString() });
  if (result.error) throw new Error(`Could not record the disposition: ${result.error.message}`);
  return response(result.data);
}

function csvCell(value: unknown) { const text = value == null ? "" : Array.isArray(value) ? value.join(";") : String(value); const safe = /^[=+\-@]/.test(text) ? `'${text}` : text; return `"${safe.replaceAll('"', '""')}"`; }
/** The original twelve columns keep their order; what 20260925705100 adds is appended after them. */
export function activityCsv(rows: ActivityRow[]) {
  const header = ["served_at", "agent", "lead_id", "lead", "campaign", "attempt", "number_clicked_at", "dispositioned_at", "disposition", "card_open_seconds", "notes", "integrity_flags", "lead_state", "open_to_log_seconds", "callback_at", "callback_timezone", "deal_face_amount_cents", "deal_product", "on_internal_dnc", "vendor_claim_status"];
  return [header, ...rows.map((row) => [row.served_at, row.agent_name, row.lead_id, row.lead_name, row.campaign_name, row.attempt, row.clicked_at, row.dispositioned_at, row.disposition, row.card_open_seconds, row.notes, row.integrity_flags, row.lead_state, row.open_to_log_seconds, row.callback_at, row.callback_timezone, row.deal_face_amount_cents, row.deal_product, row.on_internal_dnc, row.vendor_claim_status])].map((line) => line.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
