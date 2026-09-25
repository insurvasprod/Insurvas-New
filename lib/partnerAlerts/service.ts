import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { settingsFromRow, type PartnerAlertEvent, type PartnerAlertSettings } from "./presentation";
import { DUPLICATE_WINDOW_DAYS, partnerWorkspaceAlerts, type PartnerStatus, type PartnerWorkspaceAlert, type SubmissionCounts } from "./workspaceAlerts";

type AlertRow = { id: string; kind: PartnerAlertEvent; title: string; body: string; link: string; created_at: string };

// The migration is deliberately additive. Localized untyped access keeps the application
// compatible until the checked-in Supabase type snapshot is regenerated against that migration.
function db() {
  return getSupabaseServiceClient() as unknown as {
    // The API is intentionally isolated here until generated types include the additive migration.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: (table: string) => any;
  };
}

export async function listPartnerAlerts(tenantId: string, partnerId: string, userId: string) {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const [alerts, settings] = await Promise.all([
    // Newest 100, flipped back to oldest-first below. Ascending + limit used to pin the window to
    // the oldest 100, and a busy partner stopped seeing new alerts. The top bar now marks them read
    // (markPartnerAlertsRead), which is what drains this list.
    db().from("partner_notifications").select("id, kind, title, body, link, created_at").eq("tenant_id", tenantId).eq("partner_id", partnerId).eq("recipient_user_id", userId).is("read_at", null).gte("created_at", since).order("created_at", { ascending: false }).limit(100),
    db().from("partner_notification_settings").select("enabled_events, do_not_disturb, sound_muted, sound_volume, sound_opted_in_at").eq("tenant_id", tenantId).eq("partner_id", partnerId).eq("user_id", userId).maybeSingle(),
  ]);
  if (alerts.error || settings.error) throw new Error(alerts.error?.message ?? settings.error?.message ?? "Could not load partner alerts");
  const visible = ([...(alerts.data ?? [])].reverse() as AlertRow[]).filter((alert) => settingsFromRow(settings.data).enabled_events[alert.kind]);
  return { alerts: visible, settings: settingsFromRow(settings.data) };
}

/**
 * Mark exactly these of this person's partner notifications read. Scoped to the recipient, the
 * partner and the tenant together, so one partner user can never clear a colleague's.
 */
export async function markPartnerAlertsRead(tenantId: string, partnerId: string, userId: string, ids: string[]) {
  if (!ids.length) return { read: 0 };
  const result = await db().from("partner_notifications").update({ read_at: new Date().toISOString() })
    .eq("tenant_id", tenantId).eq("partner_id", partnerId).eq("recipient_user_id", userId).is("read_at", null).in("id", ids).select("id");
  if (result.error) throw new Error(`Could not mark partner alerts read: ${result.error.message}`);
  return { read: (result.data ?? []).length };
}

// The duplicate counts change slowly and the bar polls every 12 seconds per tab, so they are read
// at most once every five minutes per partner. Status is not cached: it comes from the context
// every request already resolves.
const DUPLICATE_CACHE_MS = 5 * 60_000;
const duplicateCache = new Map<string, { at: number; value: { current: SubmissionCounts; previous: SubmissionCounts } | null }>();

async function duplicateCounts(tenantId: string, partnerId: string) {
  const key = `${tenantId}:${partnerId}`;
  const cached = duplicateCache.get(key);
  if (cached && Date.now() - cached.at < DUPLICATE_CACHE_MS) return cached.value;
  const now = Date.now();
  const weekStart = now - DUPLICATE_WINDOW_DAYS * 86_400_000;
  const previousStart = weekStart - DUPLICATE_WINDOW_DAYS * 86_400_000;
  // "Duplicate" is the same definition partner quality uses: a submission the partner sent on
  // after being told the person was already in the agency's book (duplicate_override_justification).
  // Four head-only counts on the (tenant_id, partner_id, created_at) index: exact however many rows
  // there are, and no row data leaves the database.
  const count = (from: number, to: number | null, duplicatesOnly: boolean) => {
    let query = db().from("agent_leads").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId).eq("partner_id", partnerId).gte("created_at", new Date(from).toISOString());
    if (to !== null) query = query.lt("created_at", new Date(to).toISOString());
    if (duplicatesOnly) query = query.not("duplicate_override_justification", "is", null);
    return query;
  };
  const results = await Promise.all([count(weekStart, null, false), count(weekStart, null, true), count(previousStart, weekStart, false), count(previousStart, weekStart, true)]);
  let value: { current: SubmissionCounts; previous: SubmissionCounts } | null = null;
  const failed = results.find((result: { error: { message: string } | null }) => result.error);
  if (failed) {
    console.error(`[partner-alerts] could not read duplicate counts: ${failed.error.message}`);
  } else {
    const [sent, duplicates, previousSent, previousDuplicates] = results.map((result: { count: number | null }) => result.count ?? 0);
    value = { current: { sent, duplicates }, previous: { sent: previousSent, duplicates: previousDuplicates } };
  }
  duplicateCache.set(key, { at: now, value });
  return value;
}

/** The partner bar's Alerts: states that are wrong with this organisation right now. */
export async function listPartnerWorkspaceAlerts(context: { tenantId: string; partnerId: string; partnerStatus: PartnerStatus; role: string }): Promise<PartnerWorkspaceAlert[]> {
  const isAdmin = context.role === "partner_admin";
  // A failed count read drops only the rate alert; the status alert never depends on it.
  const counts = isAdmin ? await duplicateCounts(context.tenantId, context.partnerId).catch(() => null) : null;
  return partnerWorkspaceAlerts({ status: context.partnerStatus, isAdmin, current: counts?.current ?? null, previous: counts?.previous ?? null });
}

export async function savePartnerAlertSettings(tenantId: string, partnerId: string, userId: string, settings: PartnerAlertSettings) {
  const result = await db().from("partner_notification_settings").upsert({
    tenant_id: tenantId,
    partner_id: partnerId,
    user_id: userId,
    enabled_events: settings.enabled_events,
    do_not_disturb: settings.do_not_disturb,
    sound_muted: settings.sound_muted,
    sound_volume: settings.sound_volume,
    sound_opted_in_at: settings.sound_opted_in_at,
    updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,partner_id,user_id" }).select("enabled_events, do_not_disturb, sound_muted, sound_volume, sound_opted_in_at").single();
  if (result.error) throw new Error(result.error.message);
  return settingsFromRow(result.data);
}

export async function notifyPartnerUsers(input: { tenantId: string; partnerId: string; kind: PartnerAlertEvent; title: string; body: string; link: string; sourceKey: string; excludeUserId?: string | null }) {
  const recipients = await db().from("partner_users").select("user_id").eq("tenant_id", input.tenantId).eq("partner_id", input.partnerId).eq("status", "active");
  if (recipients.error) throw new Error(`Could not resolve partner alert recipients: ${recipients.error.message}`);
  const rows = (recipients.data ?? []).filter((row: { user_id: string }) => row.user_id !== input.excludeUserId).map((row: { user_id: string }) => ({
    tenant_id: input.tenantId,
    partner_id: input.partnerId,
    recipient_user_id: row.user_id,
    kind: input.kind,
    title: input.title.slice(0, 160),
    body: input.body.slice(0, 1000),
    link: input.link.slice(0, 500),
    source_key: input.sourceKey.slice(0, 300),
  }));
  if (!rows.length) return;
  const result = await db().from("partner_notifications").upsert(rows, { onConflict: "tenant_id,recipient_user_id,source_key", ignoreDuplicates: true });
  if (result.error) throw new Error(`Could not create partner alerts: ${result.error.message}`);
}
