import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { AGENT_ALERT_EVENTS, DEFAULT_AGENT_ALERT_SETTINGS, eventTypeForKind, type AgentAlertEvent, type AgentAlertSettings } from "./presentation";

// The generated database types are refreshed from the live project separately; this service keeps
// the JSON preference boundary narrow while the migration is being promoted.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

type AlertRow = { id: string; kind: string; title: string; body: string; link: string; source_key: string; created_at: string; read_at: string | null };

function settingsFromRow(row: { enabled_events?: unknown; do_not_disturb?: unknown; sound_muted?: unknown; sound_volume?: unknown } | null): AgentAlertSettings {
  const enabled = { ...DEFAULT_AGENT_ALERT_SETTINGS.enabled_events };
  if (row?.enabled_events && typeof row.enabled_events === "object" && !Array.isArray(row.enabled_events)) {
    for (const key of AGENT_ALERT_EVENTS) {
      if (typeof (row.enabled_events as Record<string, unknown>)[key] === "boolean") enabled[key] = (row.enabled_events as Record<AgentAlertEvent, boolean>)[key];
    }
  }
  return {
    enabled_events: enabled,
    do_not_disturb: row?.do_not_disturb === true,
    sound_muted: row?.sound_muted === true,
    sound_volume: typeof row?.sound_volume === "number" ? row.sound_volume : DEFAULT_AGENT_ALERT_SETTINGS.sound_volume,
  };
}

export async function getAgentAlertSettings(tenantId: string, userId: string): Promise<AgentAlertSettings> {
  const result = await db().from("agent_notification_settings").select("enabled_events, do_not_disturb, sound_muted, sound_volume").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
  if (result.error) throw new Error(`Could not load alert settings: ${result.error.message}`);
  return settingsFromRow(result.data);
}

export async function saveAgentAlertSettings(tenantId: string, userId: string, settings: AgentAlertSettings): Promise<AgentAlertSettings> {
  const result = await db().from("agent_notification_settings").upsert({ tenant_id: tenantId, user_id: userId, enabled_events: settings.enabled_events, do_not_disturb: settings.do_not_disturb, sound_muted: settings.sound_muted, sound_volume: settings.sound_volume, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,user_id" }).select("enabled_events, do_not_disturb, sound_muted, sound_volume").single();
  if (result.error || !result.data) throw new Error(`Could not save alert settings: ${result.error?.message ?? "no settings returned"}`);
  return settingsFromRow(result.data);
}

export async function listAgentAlerts(tenantId: string, userId: string) {
  const settings = await getAgentAlertSettings(tenantId, userId);
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const result = await db().from("agent_notifications").select("id, kind, title, body, link, source_key, created_at, read_at").eq("tenant_id", tenantId).eq("recipient_user_id", userId).is("read_at", null).gte("created_at", since).order("created_at", { ascending: true }).limit(100);
  if (result.error) throw new Error(`Could not load alerts: ${result.error.message}`);
  const alerts = (result.data ?? []).flatMap((row: AlertRow) => {
    const eventType = eventTypeForKind(row.kind);
    return eventType && settings.enabled_events[eventType] ? [{ ...row, event_type: eventType }] : [];
  });
  return { alerts, settings };
}

type RecipientRole = "owner" | "producer" | "assistant" | "bookkeeper";

export async function notifyTenantAgents(input: { tenantId: string; kind: string; title: string; body: string; link: string; sourceKey: string; roles?: RecipientRole[]; excludeUserId?: string | null }) {
  const roles = input.roles ?? ["owner", "producer", "assistant", "bookkeeper"];
  const memberships = await db().from("tenant_users").select("user_id, role").eq("tenant_id", input.tenantId).in("role", roles).not("accepted_at", "is", null);
  if (memberships.error) throw new Error(`Could not load alert recipients: ${memberships.error.message}`);
  const ids = (memberships.data ?? []).map((row: { user_id: string; role: string }) => row.user_id).filter((id: string) => id !== input.excludeUserId);
  if (!ids.length) return { notified: 0 };
  const active = await db().from("users").select("id").in("id", ids).eq("status", "active");
  if (active.error) throw new Error(`Could not load active alert recipients: ${active.error.message}`);
  const rows = (active.data ?? []).map((user: { id: string }) => ({ tenant_id: input.tenantId, recipient_user_id: user.id, kind: input.kind, title: input.title.slice(0, 160), body: input.body.slice(0, 1000), link: input.link.slice(0, 500), source_key: input.sourceKey }));
  if (!rows.length) return { notified: 0 };
  const result = await db().from("agent_notifications").upsert(rows, { onConflict: "tenant_id,recipient_user_id,source_key", ignoreDuplicates: true });
  if (result.error) throw new Error(`Could not create agent alerts: ${result.error.message}`);
  return { notified: rows.length };
}

export async function notifyAgentUser(input: { tenantId: string; userId: string; kind: string; title: string; body: string; link: string; sourceKey: string }) {
  const result = await db().from("agent_notifications").upsert({ tenant_id: input.tenantId, recipient_user_id: input.userId, kind: input.kind, title: input.title.slice(0, 160), body: input.body.slice(0, 1000), link: input.link.slice(0, 500), source_key: input.sourceKey }, { onConflict: "tenant_id,recipient_user_id,source_key", ignoreDuplicates: true });
  if (result.error) throw new Error(`Could not create agent alert: ${result.error.message}`);
}
