import "server-only";

import { complaintDeadlineEmail } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/transport";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { shouldEmail } from "@/lib/notifications/preferences";

import { CATEGORY_LABELS, countdown, type ComplaintCategory } from "./complaints";
import { loadThresholds } from "./complaintStore";

/**
 * LA-6.4 · the daily email while a regulator complaint is inside its red window (5 days by
 * default) or overdue: to the complaint's owner and to the tenant admins. One email per person per
 * complaint per day (email_log.dedupe_key). Called by /api/cron/complaint-deadlines.
 *
 * LA-8.4 · the same pass raises the protected `doi_deadline` notification (registry:
 * lib/notifications/events.ts): an in-app row (kind doi_deadline) for each of those people, once per
 * complaint per threshold — when it enters its red window, and again when it goes overdue
 * (source_key doi-deadline:<complaint>:<red|overdue>, unique per recipient). The email above is the
 * event's email channel ("sender"); being protected, quiet hours and preferences never hold it.
 */

/** One in-app alert per complaint per threshold: entering the red window, then going overdue. */
export function doiDeadlineSourceKey(complaintId: string, tone: "red" | "overdue"): string {
  return `doi-deadline:${complaintId}:${tone}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

export async function sendComplaintDeadlineEmails(now = new Date()) {
  const db = getSupabaseServiceClient() as Loose;
  const { data, error } = await db
    .from("complaint")
    .select("id, tenant_id, channel, regulator_state, category, received_at, response_due_at, responded_at, status, owner_user_id")
    .in("channel", ["doi", "ftc"])
    .not("status", "in", "(responded,resolved,awaiting_regulator)")
    .is("responded_at", null)
    .not("response_due_at", "is", null)
    .lte("response_due_at", new Date(now.getTime() + 60 * 86_400_000).toISOString())
    .limit(2000);
  if (error) return { ok: false, error: error.message, sent: 0 };
  const day = now.toISOString().slice(0, 10);
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  let sent = 0;
  let skipped = 0;
  let alerted = 0;
  const thresholdCache = new Map<string, Awaited<ReturnType<typeof loadThresholds>>>();
  for (const c of (data ?? []) as Loose[]) {
    if (!thresholdCache.has(c.tenant_id)) thresholdCache.set(c.tenant_id, await loadThresholds(c.tenant_id));
    const cd = countdown({ channel: c.channel, status: c.status, responseDueAt: c.response_due_at, respondedAt: c.responded_at }, now, thresholdCache.get(c.tenant_id));
    if (!cd.pinned) continue;
    const { data: owners } = await db.from("tenant_users").select("user_id, users!inner(id, name, email, status)").eq("tenant_id", c.tenant_id).eq("role", "owner").not("accepted_at", "is", null);
    const { data: holder } = await db.from("users").select("id, name, email, status").eq("id", c.owner_user_id).maybeSingle();
    const people = new Map<string, { id: string; email: string; name: string | null }>();
    for (const o of (owners ?? []) as Loose[]) if (o.users?.status === "active" && o.users.email) people.set(o.users.id, { id: o.users.id, email: o.users.email, name: o.users.name });
    if (holder?.email && holder.status === "active") people.set(holder.id, { id: holder.id, email: holder.email, name: holder.name });
    const keys = [...people.keys()].map((u) => `complaint-deadline-${c.id}-${day}-${u}`);
    const { data: already } = await db.from("email_log").select("dedupe_key").in("dedupe_key", keys);
    const done = new Set(((already ?? []) as Loose[]).map((r) => r.dedupe_key));
    const regulator = c.channel === "ftc" ? "FTC" : `${c.regulator_state ?? ""} insurance department`.trim();
    const link = `${appUrl}/app/complaints?open=${c.id}`;
    const tone: "red" | "overdue" = cd.tone === "overdue" ? "overdue" : "red";
    const alertTitle = tone === "overdue" ? `Complaint response overdue: ${regulator}` : `Complaint response due: ${regulator}`;
    const alertBody = `${cd.label}. ${CATEGORY_LABELS[c.category as ComplaintCategory] ?? c.category} complaint received ${String(c.received_at).slice(0, 10)}, response due ${String(c.response_due_at).slice(0, 10)}.`;
    if (people.size) {
      const rows = [...people.values()].map((person) => ({ tenant_id: c.tenant_id, recipient_user_id: person.id, kind: "doi_deadline", title: alertTitle.slice(0, 160), body: alertBody.slice(0, 1000), link: `/app/complaints?open=${c.id}`, source_key: doiDeadlineSourceKey(c.id, tone) }));
      const inserted = await db.from("agent_notifications").upsert(rows, { onConflict: "tenant_id,recipient_user_id,source_key", ignoreDuplicates: true }).select("id");
      if (inserted.error) console.error("[complaint-deadline] in-app alert", c.id, inserted.error.message);
      else alerted += (inserted.data ?? []).length;
    }
    for (const person of people.values()) {
      const dedupeKey = `complaint-deadline-${c.id}-${day}-${person.id}`;
      if (done.has(dedupeKey)) { skipped += 1; continue; }
      // Protected: always "send" (never muted, never held for quiet hours) — asked so the registry decides, not this file.
      if (!(await shouldEmail({ userId: person.id, tenantId: c.tenant_id, eventKey: "doi_deadline", title: alertTitle, link }))) { skipped += 1; continue; }
      const email = complaintDeadlineEmail({ name: person.name ?? "there", overdue: cd.tone === "overdue", countdownLabel: cd.label, regulator, category: CATEGORY_LABELS[c.category as ComplaintCategory] ?? c.category, receivedOn: String(c.received_at).slice(0, 10), dueOn: String(c.response_due_at).slice(0, 10), complaintUrl: link });
      const delivery = await sendEmail({ to: person.email, ...email, templateKey: "compliance.complaint_deadline", userId: person.id, tenantId: c.tenant_id, dedupeKey });
      if (delivery.delivered) sent += 1;
    }
  }
  return { ok: true, sent, skipped, alerted };
}
