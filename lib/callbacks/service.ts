import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { formatInTimezone } from "./timezone";

export type CallbackStatus = "scheduled" | "due" | "completed" | "cancelled" | "missed";
export type CallbackView = {
  id: string; leadId: string; workItemId: string; customerName: string; scheduledAtUtc: string;
  customerTimezone: string; customerTime: string; agentTime: string; assignedTo: string;
  assigneeName: string; assigneeRole: string; note: string | null; status: CallbackStatus;
  isOverdue: boolean; isDueToday: boolean; history: Array<{ id: string; action: string; createdAt: string; oldScheduledAtUtc: string | null; newScheduledAtUtc: string | null }>;
};

function customerLocalDate(utc: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(utc));
}

function todayIn(timezone: string) { return customerLocalDate(new Date().toISOString(), timezone); }

export async function listCallbacks(tenantId: string, options: { from?: string; to?: string } = {}): Promise<CallbackView[]> {
  const supabase = getSupabaseServiceClient();
  let query = supabase.from("callbacks").select("id, lead_id, work_item_id, scheduled_at_utc, customer_timezone, assigned_to, note, status, created_at").eq("tenant_id", tenantId).order("scheduled_at_utc", { ascending: true });
  if (options.from) query = query.gte("scheduled_at_utc", options.from);
  if (options.to) query = query.lte("scheduled_at_utc", options.to);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load callbacks: ${error.message}`);
  const rows = data ?? [];
  const leadIds = [...new Set(rows.map((row) => row.lead_id))];
  const userIds = [...new Set(rows.map((row) => row.assigned_to))];
  const [leads, users, histories] = await Promise.all([
    leadIds.length ? supabase.from("agent_leads").select("id, values").eq("tenant_id", tenantId).in("id", leadIds) : Promise.resolve({ data: [], error: null }),
    userIds.length ? supabase.from("users").select("id, name").in("id", userIds) : Promise.resolve({ data: [], error: null }),
    rows.length ? supabase.from("callback_history").select("id, callback_id, action, created_at, old_scheduled_at_utc, new_scheduled_at_utc").eq("tenant_id", tenantId).in("callback_id", rows.map((row) => row.id)).order("created_at", { ascending: true }) : Promise.resolve({ data: [], error: null }),
  ]);
  if (leads.error || users.error || histories.error) throw new Error("Could not load callback details.");
  const leadMap = new Map((leads.data ?? []).map((lead) => [lead.id, lead]));
  const userMap = new Map((users.data ?? []).map((user) => [user.id, user]));
  const historyMap = new Map<string, CallbackView["history"]>();
  for (const row of histories.data ?? []) historyMap.set(row.callback_id, [...(historyMap.get(row.callback_id) ?? []), { id: row.id, action: row.action, createdAt: row.created_at, oldScheduledAtUtc: row.old_scheduled_at_utc, newScheduledAtUtc: row.new_scheduled_at_utc }]);
  const now = Date.now();
  return rows.map((row) => {
    const values = (leadMap.get(row.lead_id)?.values ?? {}) as Record<string, unknown>;
    const timezone = row.customer_timezone;
    const overdue = ["scheduled", "due", "missed"].includes(row.status) && new Date(row.scheduled_at_utc).getTime() < now;
    return {
      id: row.id, leadId: row.lead_id, workItemId: row.work_item_id, customerName: String(values.full_name ?? values.name ?? ([values.first_name, values.last_name].filter(Boolean).join(" ") || "Customer")), scheduledAtUtc: row.scheduled_at_utc,
      customerTimezone: timezone, customerTime: formatInTimezone(row.scheduled_at_utc, timezone), agentTime: formatInTimezone(row.scheduled_at_utc, Intl.DateTimeFormat().resolvedOptions().timeZone), assignedTo: row.assigned_to,
      assigneeName: userMap.get(row.assigned_to)?.name ?? "Assigned agent", assigneeRole: "agent", note: row.note, status: overdue && row.status === "scheduled" ? "due" : row.status as CallbackStatus,
      isOverdue: overdue, isDueToday: ["scheduled", "due", "missed"].includes(row.status) && customerLocalDate(row.scheduled_at_utc, timezone) === todayIn(timezone), history: historyMap.get(row.id) ?? [],
    };
  });
}

export async function listDueCallbacks(tenantId: string) {
  const callbacks = await listCallbacks(tenantId);
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
