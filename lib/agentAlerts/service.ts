import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { AGENT_ALERT_EVENTS, DEFAULT_AGENT_ALERT_SETTINGS, WORKSPACE_ALERT_EVENTS, WORKSPACE_ALERT_WINDOW_MS, eventTypeForKind, leadIdFromAlertLink, partitionAlertRows, type AgentAlertEvent, type AgentAlertSettings, type AudibleTreatment } from "./presentation";
import { AUDIBLE } from "@/lib/notify/treatments";
import { ALERT_CENTRE_WINDOW_MS, WORKSPACE_ALERT_KINDS, buildAlertCentre, type CentreNotificationRow, type CentreQueueRow } from "./centre";

// The generated database types are refreshed from the live project separately; this service keeps
// the JSON preference boundary narrow while the migration is being promoted.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

type AlertRow = { id: string; kind: string; title: string; body: string; link: string; source_key: string; created_at: string; read_at: string | null };

/**
 * The columns this service reads. `sound_treatments` is listed separately because it may not exist
 * yet — see COLUMNS below.
 */
const BASE_COLUMNS = "enabled_events, do_not_disturb, sound_muted, sound_volume";
const COLUMNS_WITH_SOUND = `${BASE_COLUMNS}, sound_treatments`;

/**
 * Whether the `sound_treatments` column has landed.
 *
 * Its migration is additive and pending, and until it is applied every read of this table would
 * fail with 42703 — which would take the alert centre down for everyone, not just the new setting.
 * So the first failure downgrades the query and says so once, and per-treatment choices fall back
 * to the defaults until the column exists.
 *
 * This is temporary scaffolding with a clear end: delete it, and the two column constants, once the
 * migration is applied everywhere.
 */
let soundTreatmentsColumn: "unknown" | "present" | "absent" = "unknown";

function isMissingColumn(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  // 42703 from Postgres directly; PGRST204 is PostgREST failing to find it in its schema cache.
  return error.code === "42703" || error.code === "PGRST204" || /sound_treatments/.test(error.message ?? "");
}

function noteMissingColumn() {
  if (soundTreatmentsColumn === "absent") return;
  soundTreatmentsColumn = "absent";
  console.warn("[agentAlerts] agent_notification_settings.sound_treatments is missing; per-treatment sound choices will not persist until 20260923180000 is applied.");
}

function treatmentsFromRow(value: unknown): Partial<Record<AudibleTreatment, boolean>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const out: Partial<Record<AudibleTreatment, boolean>> = {};
  // Only the audible four, only booleans. The column has check constraints saying the same thing,
  // but a row written before they existed, or by anything else, must not widen the type here.
  for (const treatment of AUDIBLE) {
    if (typeof source[treatment] === "boolean") out[treatment as AudibleTreatment] = source[treatment] as boolean;
  }
  return out;
}

function settingsFromRow(row: { enabled_events?: unknown; do_not_disturb?: unknown; sound_muted?: unknown; sound_volume?: unknown; sound_treatments?: unknown } | null): AgentAlertSettings {
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
    sound_treatments: treatmentsFromRow(row?.sound_treatments),
  };
}

export async function getAgentAlertSettings(tenantId: string, userId: string): Promise<AgentAlertSettings> {
  const read = (columns: string) =>
    db().from("agent_notification_settings").select(columns).eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();

  let result = await read(soundTreatmentsColumn === "absent" ? BASE_COLUMNS : COLUMNS_WITH_SOUND);
  if (result.error && isMissingColumn(result.error)) {
    noteMissingColumn();
    result = await read(BASE_COLUMNS);
  }
  if (result.error) throw new Error(`Could not load alert settings: ${result.error.message}`);
  if (soundTreatmentsColumn === "unknown") soundTreatmentsColumn = "present";
  return settingsFromRow(result.data);
}

export async function saveAgentAlertSettings(tenantId: string, userId: string, settings: AgentAlertSettings): Promise<AgentAlertSettings> {
  const base = {
    tenant_id: tenantId,
    user_id: userId,
    enabled_events: settings.enabled_events,
    do_not_disturb: settings.do_not_disturb,
    sound_muted: settings.sound_muted,
    sound_volume: settings.sound_volume,
    updated_at: new Date().toISOString(),
  };

  const write = (withSound: boolean) =>
    db()
      .from("agent_notification_settings")
      .upsert(withSound ? { ...base, sound_treatments: settings.sound_treatments } : base, { onConflict: "tenant_id,user_id" })
      .select(withSound ? COLUMNS_WITH_SOUND : BASE_COLUMNS)
      .single();

  let result = await write(soundTreatmentsColumn !== "absent");
  if (result.error && isMissingColumn(result.error)) {
    // The rest of the settings are still worth saving. Silently dropping the treatment choices is
    // wrong, but so is refusing to save someone's do-not-disturb because a column is pending.
    noteMissingColumn();
    result = await write(false);
  }
  if (result.error || !result.data) throw new Error(`Could not save alert settings: ${result.error?.message ?? "no settings returned"}`);
  if (soundTreatmentsColumn === "unknown") soundTreatmentsColumn = "present";
  return settingsFromRow(result.data);
}

/** Whether per-treatment choices are currently being persisted, for the UI to be honest about. */
export function soundTreatmentsArePersisted() {
  return soundTreatmentsColumn !== "absent";
}

/**
 * The feed: notifications addressed to you, and alerts about the workspace.
 *
 * The two used to share a ten-minute window, which made "clears when fixed, not when read" untrue —
 * an escalation for a lead nobody had claimed simply aged out. Now a workspace alert stays for as
 * long as its lead is unclaimed in the queue and goes the moment somebody claims it, whichever
 * path did the claiming, because it is resolved here against the queue rather than by a hook in
 * each claim path. Notifications keep the ten-minute window (see `partitionAlertRows`).
 */
export async function listAgentAlerts(tenantId: string, userId: string) {
  // Polled every few seconds by every open agent tab, so the two reads go out together.
  const since = new Date(Date.now() - WORKSPACE_ALERT_WINDOW_MS).toISOString();
  // Newest first so a backlog of old rows can never crowd today's out of the limit; flipped below.
  const [settings, result] = await Promise.all([getAgentAlertSettings(tenantId, userId), db().from("agent_notifications").select("id, kind, title, body, link, source_key, created_at, read_at").eq("tenant_id", tenantId).eq("recipient_user_id", userId).is("read_at", null).gte("created_at", since).order("created_at", { ascending: false }).limit(200)]);
  if (result.error) throw new Error(`Could not load alerts: ${result.error.message}`);
  const rows = ((result.data ?? []) as AlertRow[]).reverse().flatMap((row) => {
    const eventType = eventTypeForKind(row.kind);
    return eventType && settings.enabled_events[eventType] ? [{ ...row, event_type: eventType }] : [];
  });

  const leadIds = [...new Set(rows.flatMap((row) => (WORKSPACE_ALERT_EVENTS.includes(row.event_type) ? [leadIdFromAlertLink(row.link)] : [])).filter((id): id is string => Boolean(id)))];
  const unclaimed = await unclaimedLeadIds(tenantId, leadIds);
  // A queue read that fails leaves every alert standing: hiding a live problem is the worse error.
  const { live, resolved } = partitionAlertRows(rows, unclaimed ?? new Set(leadIds), Date.now());

  // Retire what is resolved, so it stops being re-read on every poll. Only this person's rows, and
  // only rows this read proved resolved. Fire-and-forget: the feed is already correct without it.
  if (resolved.length) {
    void db().from("agent_notifications").update({ read_at: new Date().toISOString() }).eq("tenant_id", tenantId).eq("recipient_user_id", userId).is("read_at", null).in("id", resolved.map((row) => row.id))
      .then(({ error }: { error: { message: string } | null }) => { if (error) console.error(`[agent-alerts] could not retire resolved alerts: ${error.message}`); });
  }
  return { alerts: live, settings };
}

/**
 * The alert centre's read: this person's copies of every workspace alert of the last week, read or
 * not (resolved alerts are retired by setting `read_at`, so an unread-only read would lose exactly
 * the history the centre is for), resolved against the lead's latest queue row.
 *
 * Unlike the feed, a failed queue read fails the page: the centre's whole job is to say which
 * alerts are open, and it cannot do that without the queue.
 */
export async function listAlertCentre(tenantId: string, userId: string) {
  const since = new Date(Date.now() - ALERT_CENTRE_WINDOW_MS).toISOString();
  const alerts = await db().from("agent_notifications").select("id, kind, title, body, link, created_at").eq("tenant_id", tenantId).eq("recipient_user_id", userId).in("kind", [...WORKSPACE_ALERT_KINDS]).gte("created_at", since).order("created_at", { ascending: false }).limit(500);
  if (alerts.error) throw new Error(`Could not load the alert centre: ${alerts.error.message}`);
  const rows = (alerts.data ?? []) as CentreNotificationRow[];
  const leadIds = [...new Set(rows.map((row) => leadIdFromAlertLink(row.link)).filter((id): id is string => Boolean(id)))];
  let queueRows: CentreQueueRow[] = [];
  if (leadIds.length) {
    const queue = await db().from("lead_queue").select("id, lead_id, status, claimed_by, claimed_at, queued_at").eq("tenant_id", tenantId).in("lead_id", leadIds);
    if (queue.error) throw new Error(`Could not read the queue for the alert centre: ${queue.error.message}`);
    queueRows = (queue.data ?? []) as CentreQueueRow[];
  }
  const claimers = [...new Set(queueRows.map((row) => row.claimed_by).filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (claimers.length) {
    const users = await db().from("users").select("id, name").in("id", claimers);
    // Names are courtesy, not correctness: without them a resolution reads "Claimed by a teammate".
    for (const user of (users.data ?? []) as { id: string; name: string | null }[]) if (user.name) names.set(user.id, user.name);
  }
  return buildAlertCentre(rows, queueRows, names);
}

/** The leads among these whose latest queue item is still unclaimed. Null when the queue could not be read. */
async function unclaimedLeadIds(tenantId: string, leadIds: string[]): Promise<Set<string> | null> {
  if (!leadIds.length) return new Set();
  const result = await db().from("lead_queue").select("lead_id, status, queued_at").eq("tenant_id", tenantId).in("lead_id", leadIds).order("queued_at", { ascending: false });
  if (result.error) { console.error(`[agent-alerts] could not read the queue for alert resolution: ${result.error.message}`); return null; }
  const latest = new Map<string, string>();
  for (const row of (result.data ?? []) as { lead_id: string; status: string }[]) {
    if (!latest.has(row.lead_id)) latest.set(row.lead_id, row.status);
  }
  return new Set([...latest].filter(([, status]) => status === "unclaimed").map(([leadId]) => leadId));
}

/**
 * Marking read is what makes the badge honest.
 *
 * Until the top bar there was nowhere to read an alert from, so nothing ever set `read_at` and the
 * feed relied on the ten-minute window above to drain itself. A person who has looked at the panel
 * has read them; the count has to agree, or it stops meaning anything and gets ignored.
 *
 * Scoped to the recipient, not the tenant: reading your own alerts must never clear a colleague's.
 */
export async function markAgentAlertsRead(tenantId: string, userId: string, ids?: string[]) {
  let query = db()
    .from("agent_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("recipient_user_id", userId)
    .is("read_at", null);
  if (ids && ids.length > 0) query = query.in("id", ids);
  const result = await query.select("id");
  if (result.error) throw new Error(`Could not mark alerts read: ${result.error.message}`);
  return { read: (result.data ?? []).length };
}

type RecipientRole = "owner" | "producer" | "assistant" | "bookkeeper";

export async function notifyTenantAgents(input: { tenantId: string; kind: string; title: string; body: string; link: string; sourceKey: string; roles?: RecipientRole[]; excludeUserId?: string | null }) {
  const roles = input.roles ?? ["owner", "producer", "assistant", "bookkeeper"];
  // Account status is embedded (tenant_users_user_id_fkey) rather than read in a second round trip.
  // Same recipients as before: accepted member in one of `roles`, not the excluded user, active account.
  const memberships = await db().from("tenant_users").select("user_id, role, users!tenant_users_user_id_fkey(status)").eq("tenant_id", input.tenantId).in("role", roles).not("accepted_at", "is", null);
  if (memberships.error) throw new Error(`Could not load alert recipients: ${memberships.error.message}`);
  const ids = [...new Set<string>(
    (memberships.data ?? [])
      .filter((row: { user_id: string; users: { status: string } | null }) => row.users?.status === "active")
      .map((row: { user_id: string }) => row.user_id)
      .filter((id: string) => id !== input.excludeUserId),
  )];
  const rows = ids.map((id) => ({ tenant_id: input.tenantId, recipient_user_id: id, kind: input.kind, title: input.title.slice(0, 160), body: input.body.slice(0, 1000), link: input.link.slice(0, 500), source_key: input.sourceKey }));
  if (!rows.length) return { notified: 0 };
  const result = await db().from("agent_notifications").upsert(rows, { onConflict: "tenant_id,recipient_user_id,source_key", ignoreDuplicates: true });
  if (result.error) throw new Error(`Could not create agent alerts: ${result.error.message}`);
  return { notified: rows.length };
}

export async function notifyAgentUser(input: { tenantId: string; userId: string; kind: string; title: string; body: string; link: string; sourceKey: string }) {
  const result = await db().from("agent_notifications").upsert({ tenant_id: input.tenantId, recipient_user_id: input.userId, kind: input.kind, title: input.title.slice(0, 160), body: input.body.slice(0, 1000), link: input.link.slice(0, 500), source_key: input.sourceKey }, { onConflict: "tenant_id,recipient_user_id,source_key", ignoreDuplicates: true });
  if (result.error) throw new Error(`Could not create agent alert: ${result.error.message}`);
}
