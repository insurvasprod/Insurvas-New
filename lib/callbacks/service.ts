import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getWorkspaceTimezone } from "@/lib/agencyProfile/timezone";
import { formatInTimezone, stateFromLeadValues } from "./timezone";

export type CallbackStatus = "scheduled" | "due" | "completed" | "cancelled" | "missed";
export type CallbackView = {
  id: string; leadId: string; workItemId: string; customerName: string; scheduledAtUtc: string;
  customerTimezone: string; customerTime: string; agentTime: string; assignedTo: string;
  assigneeName: string; assigneeRole: string; note: string | null; status: CallbackStatus;
  productName: string; phone: string | null; email: string | null;
  /** The lead's two-letter state, which decides its calling window. Null when the lead has none. */
  state: string | null;
  /** The attempt this callback will be: calls already placed to the lead, plus one. */
  attemptNumber: number;
  /** Who the lead came from: its partner, else its campaign's vendor. */
  sourceName: string | null;
  isOverdue: boolean; isDueToday: boolean; history: Array<{ id: string; action: string; createdAt: string; actorName: string; oldScheduledAtUtc: string | null; newScheduledAtUtc: string | null; oldStatus: string | null; newStatus: string | null; note: string | null; via: string | null }>;
  /** How a completed callback was closed: by a contact on the call, or by Mark done. Null before 20260925708500. */
  completedVia: "call" | "manual" | null;
  /** When the customer's window closed on the due day with no kept call. Kept after a rebook. */
  missedAt: string | null;
  /** When the due job handed the work item back to the booked agent, and when it went to the shared pool. */
  reopenedAt: string | null;
  releasedAt: string | null;
  /** Whether the lead came from a partner (inbound): an overdue inbound callback is never released to the pool. */
  inbound: boolean;
  isDemo?: boolean;
};

/** A column or relation this environment's database does not have yet (a migration not applied). */
function isMissingColumn(error: { code?: string; message?: string }) {
  return error.code === "42703" || error.code === "PGRST204" || /column .* does not exist/i.test(error.message ?? "");
}

function customerLocalDate(utc: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(utc));
}

function todayIn(timezone: string) { return customerLocalDate(new Date().toISOString(), timezone); }

export type ListCallbacksOptions = {
  from?: string;
  to?: string;
  callbackId?: string;
  includeHistory?: boolean;
  /** Only callbacks in these states. Omitted = every state, including completed and cancelled. */
  statuses?: CallbackStatus[];
};

export async function listCallbacks(tenantId: string, options: ListCallbacksOptions = {}): Promise<CallbackView[]> {
  const supabase = getSupabaseServiceClient();
  // The lead's values and the assignee's name ride along through tenant_callbacks_lead_id_fkey and
  // tenant_callbacks_assigned_to_fkey (both checked live 2026-09-23) rather than a second, dependent
  // round of queries. The lead embed keeps the tenant filter the separate read had: a lead of
  // another tenant comes back null, exactly as it was absent from the old lookup map.
  // The lifecycle columns arrive with 20260925708500. Before it the same read runs without them,
  // and every callback reads as it did: no missed stamp, no manual/call distinction.
  const BASE = "id, lead_id, work_item_id, scheduled_at_utc, customer_timezone, assigned_to, note, status, created_at, lead:agent_leads!tenant_callbacks_lead_id_fkey(id, values, tenant_id, partner_id, campaign_id), assignee:users!tenant_callbacks_assigned_to_fkey(id, name)";
  const LIFECYCLE = ", completed_via, missed_at, reopened_at, released_at";
  const build = (columns: string) => {
    let query = supabase
      .from("tenant_callbacks")
      .select(columns)
      .eq("tenant_id", tenantId)
      .order("scheduled_at_utc", { ascending: true });
    if (options.from) query = query.gte("scheduled_at_utc", options.from);
    if (options.to) query = query.lte("scheduled_at_utc", options.to);
    if (options.callbackId) query = query.eq("id", options.callbackId);
    if (options.statuses) query = query.in("status", options.statuses);
    return query;
  };
  // The agency-side time on each callback is the workspace timezone (Settings › Agency profile). It
  // was the server's own zone, which on a hosted server is UTC — nobody's local time.
  const [first, workspaceZone] = await Promise.all([build(BASE + LIFECYCLE), getWorkspaceTimezone(tenantId)]);
  const { data, error } = first.error && isMissingColumn(first.error) ? await build(BASE) : first;
  if (error) throw new Error(`Could not load callbacks: ${error.message}`);
  const agencyZone = workspaceZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  type EmbeddedRow = {
    id: string; lead_id: string; work_item_id: string; scheduled_at_utc: string; customer_timezone: string;
    assigned_to: string; note: string | null; status: string; created_at: string;
    completed_via?: string | null; missed_at?: string | null; reopened_at?: string | null; released_at?: string | null;
    lead: { id: string; values: unknown; tenant_id: string; partner_id: string | null; campaign_id: string | null } | null;
    assignee: { id: string; name: string } | null;
  };
  const rows = (data ?? []) as unknown as EmbeddedRow[];
  const historyRead = (columns: string) => supabase.from("callback_history").select(columns).eq("tenant_id", tenantId).in("callback_id", rows.map((row) => row.id)).order("created_at", { ascending: true });
  type HistoryRow = { id: string; callback_id: string; actor_user_id: string | null; action: string; created_at: string; old_scheduled_at_utc: string | null; new_scheduled_at_utc: string | null; old_status: string | null; new_status: string | null; note: string | null; via?: string | null };
  const HISTORY = "id, callback_id, actor_user_id, action, created_at, old_scheduled_at_utc, new_scheduled_at_utc, old_status, new_status, note";
  let histories: { data: HistoryRow[] | null; error: { message: string; code?: string } | null } = { data: [], error: null };
  if (options.includeHistory && rows.length) {
    const withVia = await historyRead(`${HISTORY}, via`);
    const read = withVia.error && isMissingColumn(withVia.error) ? await historyRead(HISTORY) : withVia;
    histories = { data: (read.data ?? []) as unknown as HistoryRow[], error: read.error };
  }
  if (histories.error) throw new Error("Could not load callback details.");
  const leadMap = new Map(rows.flatMap((row) => (row.lead && row.lead.tenant_id === tenantId ? [[row.lead_id, row.lead] as const] : [])));
  const userMap = new Map(rows.flatMap((row) => (row.assignee ? [[row.assigned_to, row.assignee] as const] : [])));
  const historyActorIds = [...new Set((histories.data ?? []).map((row) => row.actor_user_id).filter((id): id is string => Boolean(id)))];
  const historyActors = options.includeHistory && historyActorIds.length
    ? await supabase.from("users").select("id, name").in("id", historyActorIds)
    : { data: [], error: null };
  if (historyActors.error) throw new Error("Could not load callback history actors.");
  const historyActorMap = new Map((historyActors.data ?? []).map((user) => [user.id, user]));
  const historyMap = new Map<string, CallbackView["history"]>();
  for (const row of histories.data ?? []) historyMap.set(row.callback_id, [...(historyMap.get(row.callback_id) ?? []), {
    id: row.id,
    action: row.action,
    createdAt: row.created_at,
    actorName: (row.actor_user_id && historyActorMap.get(row.actor_user_id)?.name) || "System",
    oldScheduledAtUtc: row.old_scheduled_at_utc,
    newScheduledAtUtc: row.new_scheduled_at_utc,
    oldStatus: row.old_status,
    newStatus: row.new_status,
    note: row.note,
    via: row.via ?? null,
  }]);
  // Attempts and sources for the row's second line — "attempt 3 · Northline BPO". Three batched
  // reads keyed by the leads on this page, never one per row.
  const leads = [...leadMap.values()];
  const leadIds = leads.map((lead) => lead.id);
  const partnerIds = [...new Set(leads.map((lead) => lead.partner_id).filter((id): id is string => Boolean(id)))];
  const campaignIds = [...new Set(leads.map((lead) => lead.campaign_id).filter((id): id is string => Boolean(id)))];
  const loose = supabase as unknown as { from(table: string): { select(columns: string): { eq(column: string, value: string): { in(column: string, values: string[]): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> } } } };
  const [attempts, partners, campaigns] = await Promise.all([
    leadIds.length ? loose.from("tenant_call_attempts").select("lead_id, attempt_number").eq("tenant_id", tenantId).in("lead_id", leadIds) : Promise.resolve({ data: [], error: null }),
    partnerIds.length ? loose.from("partners").select("id, name").eq("tenant_id", tenantId).in("id", partnerIds) : Promise.resolve({ data: [], error: null }),
    campaignIds.length ? loose.from("tenant_campaigns").select("id, name, vendor_id").eq("tenant_id", tenantId).in("id", campaignIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const vendorIds = [...new Set(((campaigns.data ?? []) as Array<{ vendor_id: string | null }>).map((row) => row.vendor_id).filter((id): id is string => Boolean(id)))];
  const vendors = vendorIds.length ? await loose.from("tenant_lead_vendors").select("id, name").eq("tenant_id", tenantId).in("id", vendorIds) : { data: [], error: null };
  // A missing side table (an environment without LA-2) degrades to no attempt or source, not a 500.
  const attemptsByLead = new Map<string, number>();
  for (const row of (attempts.error ? [] : attempts.data ?? []) as Array<{ lead_id: string; attempt_number: number }>) {
    attemptsByLead.set(row.lead_id, Math.max(attemptsByLead.get(row.lead_id) ?? 0, row.attempt_number));
  }
  const partnerName = new Map(((partners.error ? [] : partners.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
  const vendorName = new Map(((vendors.error ? [] : vendors.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
  const campaignSource = new Map(((campaigns.error ? [] : campaigns.data ?? []) as Array<{ id: string; name: string; vendor_id: string | null }>).map((row) => [row.id, (row.vendor_id && vendorName.get(row.vendor_id)) || row.name]));
  const now = Date.now();
  return rows.map((row) => {
    const lead = leadMap.get(row.lead_id) ?? null;
    const values = (leadMap.get(row.lead_id)?.values ?? {}) as Record<string, unknown>;
    const timezone = row.customer_timezone;
    const overdue = ["scheduled", "due", "missed"].includes(row.status) && new Date(row.scheduled_at_utc).getTime() < now;
    const productName = String(values.product_name ?? values.product ?? values.product_code ?? "Lead");
    const phoneValue = values.phone ?? values.phone_number ?? values.mobile_phone;
    const emailValue = values.email ?? values.email_address;
    return {
      id: row.id, leadId: row.lead_id, workItemId: row.work_item_id, customerName: String(values.full_name ?? values.name ?? ([values.first_name, values.last_name].filter(Boolean).join(" ") || "Customer")), scheduledAtUtc: row.scheduled_at_utc,
      customerTimezone: timezone, customerTime: formatInTimezone(row.scheduled_at_utc, timezone), agentTime: formatInTimezone(row.scheduled_at_utc, agencyZone), assignedTo: row.assigned_to,
      assigneeName: userMap.get(row.assigned_to)?.name ?? "Assigned agent", assigneeRole: "agent", note: row.note, status: overdue && row.status === "scheduled" ? "due" : row.status as CallbackStatus,
      productName, phone: typeof phoneValue === "string" ? phoneValue : null, email: typeof emailValue === "string" ? emailValue : null,
      state: stateFromLeadValues(values),
      attemptNumber: (attemptsByLead.get(row.lead_id) ?? 0) + 1,
      sourceName: (lead?.partner_id && partnerName.get(lead.partner_id)) || (lead?.campaign_id && campaignSource.get(lead.campaign_id)) || null,
      isOverdue: overdue, isDueToday: ["scheduled", "due", "missed"].includes(row.status) && customerLocalDate(row.scheduled_at_utc, timezone) === todayIn(timezone), history: historyMap.get(row.id) ?? [],
      completedVia: row.completed_via === "call" || row.completed_via === "manual" ? row.completed_via : null,
      missedAt: row.missed_at ?? (row.status === "missed" ? row.scheduled_at_utc : null),
      reopenedAt: row.reopened_at ?? null,
      releasedAt: row.released_at ?? null,
      inbound: Boolean(lead?.partner_id),
    };
  });
}

export async function listDueCallbacks(tenantId: string) {
  // Due-today and overdue are only ever true for an open callback (see isDueToday/isOverdue above),
  // and "today" in any customer timezone ends at most ~26h from now (UTC+14). Bounding the read to
  // that stops the dashboard pulling every callback the tenant has ever had — completed and
  // cancelled included — plus each one's lead record, only to discard them here.
  const callbacks = await listCallbacks(tenantId, {
    statuses: ["scheduled", "due", "missed"],
    to: new Date(Date.now() + 36 * 3_600_000).toISOString(),
  });
  return callbacks.filter((callback) => callback.isDueToday || callback.isOverdue);
}

function localValue(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error("Choose a valid callback date and time.");
  return value;
}

export async function rescheduleCallback(params: { tenantId: string; userId: string; callbackId: string; local: unknown; request: Request }) {
  const result = await getSupabaseServiceClient().rpc("reschedule_callback", { p_tenant_id: params.tenantId, p_callback_id: params.callbackId, p_actor: params.userId, p_callback_local: localValue(params.local) });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function cancelCallback(params: { tenantId: string; userId: string; callbackId: string; request: Request }) {
  const result = await getSupabaseServiceClient().rpc("cancel_callback", { p_tenant_id: params.tenantId, p_callback_id: params.callbackId, p_actor: params.userId });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

export async function completeCallback(params: { tenantId: string; userId: string; callbackId: string; request: Request }) {
  const result = await getSupabaseServiceClient().rpc("complete_callback", { p_tenant_id: params.tenantId, p_callback_id: params.callbackId, p_actor: params.userId });
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
