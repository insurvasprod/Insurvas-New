import "server-only";

import { isPendingSchema } from "@/lib/carriers/schemaGap";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getViewerTimezone } from "@/lib/users/viewerTimezone";
import { eventByKey, inQuietHours, NOTIFICATION_EVENTS, resolveDelivery, type DigestCadence, type PreferenceRow } from "./events";

/**
 * LA-8.4 (Notion sprint) · a person's notification choices, and the one question every sender asks:
 * "should this person get this email now?" (shouldEmail). Absent rows are registry defaults; the four
 * protected events are always on and ignore quiet hours.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the tables are not in database.types.ts yet
const db = () => getSupabaseServiceClient() as any;

export class NotificationPreferenceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type QuietHours = { enabled: boolean; start: string; end: string };
export const DEFAULT_QUIET: QuietHours = { enabled: false, start: "21:00", end: "08:00" };

export async function loadPreferences(userId: string): Promise<Map<string, PreferenceRow>> {
  const { data, error } = await db().from("notification_preference").select("event_key, in_app, email, push, digest").eq("user_id", userId);
  if (error) {
    if (isPendingSchema(error)) return new Map();
    throw new Error(`Could not read notification preferences: ${error.message}`);
  }
  return new Map(((data ?? []) as PreferenceRow[]).map((r) => [r.event_key, r]));
}

type SettingsRow = { quiet_enabled: boolean; quiet_start: string; quiet_end: string; daily_digest_sent_at: string | null; weekly_digest_sent_at: string | null };

export async function loadNotificationSettings(userId: string): Promise<{ quiet: QuietHours; dailySentAt: string | null; weeklySentAt: string | null; available: boolean }> {
  const { data, error } = await db().from("user_notification_settings").select("quiet_enabled, quiet_start, quiet_end, daily_digest_sent_at, weekly_digest_sent_at").eq("user_id", userId).maybeSingle();
  if (error) {
    if (isPendingSchema(error)) return { quiet: DEFAULT_QUIET, dailySentAt: null, weeklySentAt: null, available: false };
    throw new Error(`Could not read notification settings: ${error.message}`);
  }
  const row = data as SettingsRow | null;
  return {
    quiet: row ? { enabled: row.quiet_enabled, start: row.quiet_start.slice(0, 5), end: row.quiet_end.slice(0, 5) } : DEFAULT_QUIET,
    dailySentAt: row?.daily_digest_sent_at ?? null,
    weeklySentAt: row?.weekly_digest_sent_at ?? null,
    available: true,
  };
}

/** Change one event's choice. A protected event cannot be changed — by this route or any other. */
export async function savePreference(userId: string, eventKey: string, patch: Partial<Pick<PreferenceRow, "in_app" | "email" | "push" | "digest">>) {
  const event = eventByKey(eventKey);
  if (!event) throw new NotificationPreferenceError("That is not a notification.", 404);
  if (event.is_protected) throw new NotificationPreferenceError(`${event.label} cannot be switched off. ${event.protected_reason ?? ""}`.trim(), 409);
  if (patch.digest && patch.digest !== "immediate" && !event.supports_digest) throw new NotificationPreferenceError(`${event.label} is not sent as a digest.`, 400);
  const current = resolveDelivery(event, (await loadPreferences(userId)).get(eventKey));
  const row = {
    user_id: userId, event_key: eventKey,
    in_app: patch.in_app ?? current.in_app,
    email: patch.email ?? (patch.digest && patch.digest !== "off" ? true : current.email),
    push: patch.push ?? current.push,
    digest: patch.digest ?? current.digest,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db().from("notification_preference").upsert(row, { onConflict: "user_id,event_key" });
  if (error) {
    if (isPendingSchema(error)) throw new NotificationPreferenceError("Notification preferences need a database update first.", 503);
    throw new Error(error.message);
  }
}

export async function saveQuietHours(userId: string, quiet: QuietHours) {
  if (quiet.start === quiet.end) throw new NotificationPreferenceError("Quiet hours need a start and an end that differ.");
  const { error } = await db().from("user_notification_settings").upsert({ user_id: userId, quiet_enabled: quiet.enabled, quiet_start: quiet.start, quiet_end: quiet.end, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) {
    if (isPendingSchema(error)) throw new NotificationPreferenceError("Quiet hours need a database update first.", 503);
    throw new Error(error.message);
  }
}

export type KindDelivery = { in_app: boolean; push: boolean };

/**
 * For the bell, which polls every few seconds: per in-app kind, whether this person sees it in the app
 * and gets a browser notification for it now (push is off inside their quiet hours, except for a
 * protected event). Kinds no event registers are shown, as before. Cached for 30 seconds per person.
 */
const deliveryCache = new Map<string, { at: number; value: Map<string, KindDelivery> }>();

export async function deliveryByKind(userId: string, tenantId: string, now = new Date()): Promise<Map<string, KindDelivery>> {
  const hit = deliveryCache.get(userId);
  if (hit && now.getTime() - hit.at < 30_000) return hit.value;
  const [prefs, settings, zone] = await Promise.all([
    loadPreferences(userId).catch(() => new Map<string, PreferenceRow>()),
    loadNotificationSettings(userId).catch(() => ({ quiet: DEFAULT_QUIET })),
    getViewerTimezone(tenantId, userId).catch(() => null),
  ]);
  const quiet = inQuietHours(now, zone, settings.quiet);
  const value = new Map<string, KindDelivery>();
  for (const event of NOTIFICATION_EVENTS) {
    const d = resolveDelivery(event, prefs.get(event.key));
    for (const kind of event.kinds) value.set(kind, { in_app: d.in_app, push: d.push && (d.protected || !quiet) });
  }
  deliveryCache.set(userId, { at: now.getTime(), value });
  if (deliveryCache.size > 5000) deliveryCache.clear();
  return value;
}

/** Forget the cached answer after the person changes a choice, so the bell follows at once. */
export function forgetDelivery(userId: string) {
  deliveryCache.delete(userId);
}

export type EmailDecision = "send" | "off" | "digest" | "quiet";

/**
 * Should this person be emailed about this event now? The answer every sender asks for.
 *   send    yes, now
 *   off     they switched email off for it
 *   digest  it was added to their daily or weekly digest instead
 *   quiet   inside their quiet hours — a protected event never gets this answer
 * Unknown events are sent (a module that forgot to register is not silenced by it).
 */
export async function emailDecision(input: { userId: string; tenantId: string | null; eventKey: string; title: string; body?: string; link?: string | null; now?: Date }): Promise<EmailDecision> {
  const event = eventByKey(input.eventKey);
  if (!event) return "send";
  if (event.is_protected) return "send";
  const [prefs, settings] = await Promise.all([loadPreferences(input.userId), loadNotificationSettings(input.userId)]);
  const delivery = resolveDelivery(event, prefs.get(event.key));
  if (!delivery.email) return "off";
  if (delivery.digest === "daily" || delivery.digest === "weekly") {
    await enqueueDigest(input.userId, input.tenantId, event.key, delivery.digest, input.title, input.body ?? "", input.link ?? null);
    return "digest";
  }
  const zone = input.tenantId ? await getViewerTimezone(input.tenantId, input.userId) : null;
  if (inQuietHours(input.now ?? new Date(), zone, settings.quiet)) return "quiet";
  return "send";
}

/** The convenience form: true means send it now. */
export async function shouldEmail(input: Parameters<typeof emailDecision>[0]): Promise<boolean> {
  return (await emailDecision(input).catch((error: unknown) => {
    // A preference that cannot be read must not swallow the email: send it.
    console.error("[notifications] preference read failed", error instanceof Error ? error.message : error);
    return "send" as const;
  })) === "send";
}

export async function enqueueDigest(userId: string, tenantId: string | null, eventKey: string, cadence: Exclude<DigestCadence, "immediate" | "off">, title: string, body: string, link: string | null) {
  const { error } = await db().from("notification_digest_item").insert({ user_id: userId, tenant_id: tenantId, event_key: eventKey, cadence, title: title.slice(0, 200), body: body.slice(0, 1000), link: link?.slice(0, 500) ?? null });
  if (error) throw new Error(`Could not queue the digest item: ${error.message}`);
}
