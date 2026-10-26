import "server-only";

import { sendEmail } from "@/lib/email/transport";
import { notificationAlertEmail, notificationDigestEmail } from "@/lib/email/templates";
import { isPendingSchema } from "@/lib/carriers/schemaGap";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { configuredAppOrigin } from "@/lib/urls/origin";
import { getViewerTimezone } from "@/lib/users/viewerTimezone";
import { digestDue, eventForKind, NOTIFICATION_EVENTS } from "./events";
import { emailDecision, loadNotificationSettings } from "./preferences";

/**
 * LA-8.4 (Notion sprint) · the notifications job (app/api/cron/notifications, every few minutes).
 *
 *   outbox   an in-app notification (agent_notifications) whose event emails through the outbox is
 *            emailed now, queued for the person's digest, held through their quiet hours, or marked
 *            as not wanted — by its recipient's own choice. Protected events always go, at once.
 *   digests  at 08:00 in each person's own timezone (Mondays for weekly), their queued items go as one
 *            email. A digest with nothing in it is not sent: "nothing happened" every morning is the
 *            fastest way to teach someone to filter us.
 *
 * Every row is claimed before it is sent, so two runs never email it twice.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the new columns and tables are not in database.types.ts yet
const db = () => getSupabaseServiceClient() as any;
const OUTBOX_KINDS = NOTIFICATION_EVENTS.filter((e) => e.email === "outbox").flatMap((e) => e.kinds);
const settingsUrl = () => `${configuredAppOrigin("agent")}/app/settings#alerts`;
const absolute = (link: string | null) => (link ? (link.startsWith("http") ? link : `${configuredAppOrigin("agent")}${link.startsWith("/") ? link : `/${link}`}`) : null);

type Row = { id: string; tenant_id: string; recipient_user_id: string; kind: string; title: string; body: string; link: string | null; created_at: string };
type Person = { id: string; name: string; email: string; status: string };

async function people(ids: string[]): Promise<Map<string, Person>> {
  if (!ids.length) return new Map();
  const { data } = await db().from("users").select("id, name, email, status").in("id", ids);
  return new Map(((data ?? []) as Person[]).map((p) => [p.id, p]));
}

/** `tenantId` scopes a run to one agency (a test run, or re-running one agency); absent, every agency. */
export async function processOutbox(now = new Date(), tenantId?: string): Promise<{ sent: number; queued: number; off: number; held: number; skipped: number; available: boolean }> {
  const out = { sent: 0, queued: 0, off: 0, held: 0, skipped: 0, available: true };
  const at = now.toISOString();
  const scoped = <Q extends { eq(column: string, value: string): Q }>(q: Q): Q => (tenantId ? q.eq("tenant_id", tenantId) : q);
  // Notifications whose event does not email through the outbox are done with as far as email goes.
  const closed = await scoped(db().from("agent_notifications").update({ email_handled_at: at }).is("email_handled_at", null).not("kind", "in", `(${OUTBOX_KINDS.join(",")})`)).select("id");
  if (closed.error) {
    if (isPendingSchema(closed.error)) return { ...out, available: false };
    throw new Error(closed.error.message);
  }
  out.skipped += (closed.data ?? []).length;

  const since = new Date(now.getTime() - 2 * 86_400_000).toISOString();
  const { data, error } = await scoped(db().from("agent_notifications").select("id, tenant_id, recipient_user_id, kind, title, body, link, created_at")
    .is("email_handled_at", null).in("kind", OUTBOX_KINDS).gte("created_at", since)).order("created_at").limit(200);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  const who = await people([...new Set(rows.map((r) => r.recipient_user_id))]);

  for (const row of rows) {
    // Claim it first: only one run ever gets past this for a given row.
    const claim = await db().from("agent_notifications").update({ email_handled_at: at }).eq("id", row.id).is("email_handled_at", null).select("id");
    if (claim.error || !(claim.data ?? []).length) continue;
    const person = who.get(row.recipient_user_id);
    const event = eventForKind(row.kind);
    if (!person || person.status !== "active" || !person.email || !event) { out.skipped += 1; continue; }

    const decision = await emailDecision({ userId: person.id, tenantId: row.tenant_id, eventKey: event.key, title: row.title, body: row.body, link: absolute(row.link), now });
    if (decision === "quiet") {
      // Held, not dropped: released for a later run once their quiet hours end.
      await db().from("agent_notifications").update({ email_handled_at: null }).eq("id", row.id);
      out.held += 1;
      continue;
    }
    if (decision === "off") { out.off += 1; continue; }
    if (decision === "digest") { out.queued += 1; continue; }
    const rendered = notificationAlertEmail({ name: person.name, title: row.title, body: row.body, url: absolute(row.link), settingsUrl: settingsUrl(), protectedReason: event.is_protected ? event.protected_reason : undefined });
    await sendEmail({ ...rendered, to: person.email, userId: person.id, tenantId: row.tenant_id, templateKey: "notification.alert", dedupeKey: `notification:${row.id}` });
    out.sent += 1;
  }
  return out;
}

type DigestItem = { id: string; user_id: string; tenant_id: string | null; cadence: "daily" | "weekly"; title: string; body: string; link: string | null; created_at: string };

export async function sendDigests(now = new Date(), tenantId?: string): Promise<{ sent: number; notDue: number; available: boolean }> {
  const out = { sent: 0, notDue: 0, available: true };
  // A sent line has done its job; a title can name a customer, so it is not kept beyond 30 days.
  await db().from("notification_digest_item").delete().lt("sent_at", new Date(now.getTime() - 30 * 86_400_000).toISOString());
  let pending = db().from("notification_digest_item").select("id, user_id, tenant_id, cadence, title, body, link, created_at").is("sent_at", null);
  if (tenantId) pending = pending.eq("tenant_id", tenantId);
  const { data, error } = await pending.order("created_at").limit(2000);
  if (error) {
    if (isPendingSchema(error)) return { ...out, available: false };
    throw new Error(error.message);
  }
  const groups = new Map<string, DigestItem[]>();
  for (const item of (data ?? []) as DigestItem[]) {
    const key = `${item.user_id}|${item.cadence}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const who = await people([...new Set([...groups.values()].map((items) => items[0].user_id))]);
  for (const items of groups.values()) {
    const { user_id: userId, cadence } = items[0];
    const person = who.get(userId);
    if (!person || person.status !== "active" || !person.email) continue;
    const tenantId = items[items.length - 1].tenant_id;
    const [settings, zone] = await Promise.all([loadNotificationSettings(userId), tenantId ? getViewerTimezone(tenantId, userId) : Promise.resolve(null)]);
    if (!digestDue(cadence, now, zone, cadence === "daily" ? settings.dailySentAt : settings.weeklySentAt)) { out.notDue += 1; continue; }
    // Mark first, then send: a crash between the two loses a digest rather than sending it twice.
    const at = now.toISOString();
    const mark = await db().from("notification_digest_item").update({ sent_at: at }).in("id", items.map((i) => i.id)).is("sent_at", null).select("id");
    if (mark.error || !(mark.data ?? []).length) continue;
    const claimed = new Set(((mark.data ?? []) as { id: string }[]).map((r) => r.id));
    const mine = items.filter((i) => claimed.has(i.id));
    await db().from("user_notification_settings").upsert({ user_id: userId, [cadence === "daily" ? "daily_digest_sent_at" : "weekly_digest_sent_at"]: at, updated_at: at }, { onConflict: "user_id" });
    const rendered = notificationDigestEmail({ name: person.name, cadence, items: mine.map((i) => ({ title: i.title, body: i.body, url: absolute(i.link) })), settingsUrl: settingsUrl() });
    await sendEmail({ ...rendered, to: person.email, userId, tenantId, templateKey: "notification.digest", dedupeKey: `digest:${cadence}:${userId}:${at.slice(0, 10)}` });
    out.sent += 1;
  }
  return out;
}

/** The daily licence check (also run by pg_cron); here so a deployment without pg_cron still gets it. */
export async function emitCredentialExpiry(): Promise<number> {
  const { data, error } = await db().rpc("emit_credential_expiry_alerts");
  if (error) {
    if (isPendingSchema(error)) return 0;
    throw new Error(error.message);
  }
  return Number(data ?? 0);
}

/**
 * Payment failed on the plan (protected): an in-app alert to the agency's owners, which the outbox
 * then emails. Called when the provider reports a failed payment. One per provider event.
 */
export async function notifyPlanPaymentFailed(tenantId: string, providerEventId: string): Promise<number> {
  const { data: owners } = await db().from("tenant_users").select("user_id").eq("tenant_id", tenantId).eq("role", "owner").not("accepted_at", "is", null);
  const rows = ((owners ?? []) as { user_id: string }[]).map((o) => ({
    tenant_id: tenantId, recipient_user_id: o.user_id, kind: "plan_payment_failed",
    title: "Your Insurvas payment did not go through",
    body: "Update the card on your plan so dialling and applications keep working. Your book stays readable either way.",
    link: "/app/settings#billing", source_key: `plan-payment-failed:${providerEventId}`,
  }));
  if (!rows.length) return 0;
  const { error } = await db().from("agent_notifications").upsert(rows, { onConflict: "tenant_id,recipient_user_id,source_key", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return rows.length;
}
