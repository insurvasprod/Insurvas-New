import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { postPartnerSystemCard } from "@/lib/partnerChat/service";
import { sendEmail } from "@/lib/email/transport";
import { slaEscalationEmail } from "@/lib/email/templates";
import { notifyTenantAgents } from "@/lib/agentAlerts/service";
import { notifyPartnerUsers } from "@/lib/partnerAlerts/service";
import { getEntitlement } from "@/lib/entitlements/get";
import { hasFeature } from "@/lib/entitlements/types";
import { isSchemaGap } from "@/lib/appointments/schemaGap";

export type QueueSlaSettings = {
  tenant_id: string;
  warn_after_seconds: number;
  escalate_after_seconds: number;
  partner_notify_after_seconds: number;
  expire_after_seconds: number;
  updated_at: string;
};

const DEFAULTS = { warn_after_seconds: 45, escalate_after_seconds: 120, partner_notify_after_seconds: 300, expire_after_seconds: 14400 };
type SlaEvent = { id: string; tenant_id: string; work_item_id: string; lead_id: string; partner_id: string | null; rung: "warn" | "escalate" | "partner" | "expire" };

// The generated Supabase types are refreshed from the live schema separately; this migration is
// intentionally shipped with the service, so keep the narrow new-table boundary local here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db() { return getSupabaseServiceClient() as any; }

export async function getQueueSlaSettings(tenantId: string): Promise<QueueSlaSettings> {
  const { data, error } = await db().from("tenant_queue_sla_settings").select("tenant_id, warn_after_seconds, escalate_after_seconds, partner_notify_after_seconds, expire_after_seconds, updated_at").eq("tenant_id", tenantId).maybeSingle();
  if (error) throw new Error(`Could not load queue SLA settings: ${error.message}`);
  return data ?? { tenant_id: tenantId, ...DEFAULTS, updated_at: new Date(0).toISOString() };
}

export async function updateQueueSlaSettings(params: { tenantId: string; actorId: string; warn: number; escalate: number; partner: number; expire: number }) {
  const { data, error } = await db().rpc("update_tenant_queue_sla_settings", { p_tenant_id: params.tenantId, p_actor: params.actorId, p_warn: params.warn, p_escalate: params.escalate, p_partner: params.partner, p_expire: params.expire });
  if (error || !data) throw new Error(error?.message ?? "Could not save queue SLA settings");
  return data as QueueSlaSettings;
}

/** The name the alerts and the partner's notice use: full name, else first + last, else name. */
function customerName(values: unknown) {
  const v = values && typeof values === "object" && !Array.isArray(values) ? values as Record<string, unknown> : {};
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const joined = [text(v.first_name), text(v.last_name)].filter(Boolean).join(" ");
  return (text(v.full_name) || joined || text(v.name) || "Customer").slice(0, 160);
}

function customerState(values: unknown): string | null {
  const v = values && typeof values === "object" && !Array.isArray(values) ? values as Record<string, unknown> : {};
  const raw = v.state ?? v.state_code ?? v.address_state;
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 40) : null;
}

/** A side effect this old is recorded as skipped, never sent (user decision, 20260925709900). */
const STALE_AFTER_MS = 86_400_000;

type RunFailure = { eventId: string; rung: string; error: string };
type DatabaseRunReport = {
  ok?: boolean;
  error?: string;
  ladder?: { fired?: number; error?: string | null };
  events?: number;
  failed?: number;
  failures?: Array<{ eventId: string; rung: string; error: string }>;
  sent?: Record<string, number>;
  skipped?: Record<string, number>;
};

/**
 * The partner's notice on the partner rung, in the shape Design 1's partner chat reads (the same row
 * run_unclaimed_sla_side_effects writes): a system card with no card type, in the partner's active
 * channel. An archived channel is an offboarded partner, and nothing is posted.
 */
async function postPartnerNotice(event: SlaEvent, name: string, state: string | null) {
  if (!event.partner_id) return;
  const supabase = db();
  const channel = await supabase.from("partner_channels").select("id").eq("tenant_id", event.tenant_id).eq("partner_id", event.partner_id).eq("channel_type", "partner").eq("status", "active").order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (channel.error) throw new Error(`Could not find the partner channel: ${channel.error.message}`);
  if (!channel.data?.id) return;
  const inserted = await supabase.from("partner_messages").insert({
    tenant_id: event.tenant_id,
    partner_id: event.partner_id,
    channel_id: channel.data.id,
    work_item_id: event.work_item_id,
    message: `${name} was not claimed before the response window. Our team has been notified.`.slice(0, 2000),
    message_kind: "system_card",
    card_type: null,
    card_payload: { customer: name, notice: "unclaimed_partner_notice", ...(state ? { state } : {}) },
    event_key: `unclaimed-sla:${event.work_item_id}:partner`,
    created_by: null,
  }).select("id").maybeSingle();
  if (inserted.error?.code === "23505") return;
  if (inserted.error) throw new Error(`Could not post the partner notice: ${inserted.error.message}`);
  if (inserted.data?.id) {
    await notifyPartnerUsers({ tenantId: event.tenant_id, partnerId: event.partner_id, kind: "lead_status_changed", title: "Lead status updated", body: "A lead in your pipeline has a new operational update.", link: "/partner/pipeline", sourceKey: `partner-system-card:${inserted.data.id}` })
      .catch((error: unknown) => console.error("Partner notice alert failed", error));
  }
}

type OwnerRow = { users?: { id?: string; name?: string | null; email?: string | null; status?: string } | null };

async function activeOwners(tenantId: string) {
  const result = await db().from("tenant_users").select("user_id, users!inner(id, name, email, status)").eq("tenant_id", tenantId).eq("role", "owner").not("accepted_at", "is", null);
  if (result.error) throw new Error(`Could not resolve the workspace owners: ${result.error.message}`);
  return ((result.data ?? []) as OwnerRow[]).map((row) => row.users).filter((user): user is { id: string; name: string | null; email: string | null; status: string } => Boolean(user?.id) && user?.status === "active");
}

/** Delivery reasons that are configuration, not a failed attempt: retrying cannot change them. */
const SETTLED_NOT_SENT = new Set(["email_delivery_disabled", "reserved_test_recipient", "email_not_configured"]);

/**
 * The escalation email, which stays with the app (user decision, 2026-09-25). The database job
 * alerts in-app and marks the email owed (email_due_at); this sends each owed email to every active
 * owner, once, and says what happened. Re-checked against the transfer first, like every late alert.
 */
async function sendOwedEscalationEmails(): Promise<{ sent: number; settled: number; failures: RunFailure[] }> {
  const supabase = db();
  const owed = await supabase.from("tenant_lead_sla_events").select("id, tenant_id, work_item_id, lead_id, partner_id, email_due_at").eq("rung", "escalate").not("email_due_at", "is", null).is("email_done_at", null).order("email_due_at", { ascending: true }).limit(200);
  if (owed.error) {
    if (isSchemaGap(owed.error)) return { sent: 0, settled: 0, failures: [] };
    throw new Error(`Could not read the owed escalation emails: ${owed.error.message}`);
  }
  let sent = 0;
  let settled = 0;
  const failures: RunFailure[] = [];
  for (const row of (owed.data ?? []) as Array<{ id: string; tenant_id: string; work_item_id: string; lead_id: string; partner_id: string | null; email_due_at: string }>) {
    const settle = async (outcome: string) => {
      const update = await supabase.from("tenant_lead_sla_events").update({ email_done_at: new Date().toISOString(), email_outcome: outcome.slice(0, 200) }).eq("id", row.id).is("email_done_at", null);
      if (update.error) throw new Error(update.error.message);
      settled += 1;
    };
    try {
      if (Date.parse(row.email_due_at) < Date.now() - STALE_AFTER_MS) { await settle("older_than_24_hours"); continue; }
      const queue = await supabase.from("lead_queue").select("status").eq("tenant_id", row.tenant_id).eq("id", row.work_item_id).maybeSingle();
      if (queue.error) throw new Error(`Could not re-read the transfer: ${queue.error.message}`);
      if (queue.data?.status !== "unclaimed") { await settle("no_longer_unclaimed"); continue; }
      const owners = (await activeOwners(row.tenant_id)).filter((owner) => owner.email?.trim());
      if (!owners.length) { await settle("no_owner_email"); continue; }
      const [lead, partner] = await Promise.all([
        supabase.from("agent_leads").select("values").eq("tenant_id", row.tenant_id).eq("id", row.lead_id).maybeSingle(),
        row.partner_id ? supabase.from("partners").select("name").eq("tenant_id", row.tenant_id).eq("id", row.partner_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
      ]);
      const name = customerName(lead.data?.values);
      const reasons: string[] = [];
      let failedReason: string | null = null;
      for (const owner of owners) {
        const email = slaEscalationEmail({ name: owner.name ?? "there", customerName: name, partnerName: partner.data?.name ?? "your partner", leadUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/app/leads/${row.lead_id}` });
        const delivery = await sendEmail({ ...email, to: owner.email!, userId: owner.id, tenantId: row.tenant_id, templateKey: "lead.sla_escalation", dedupeKey: `unclaimed-sla:${row.work_item_id}:escalated:${owner.id}` });
        if (delivery.delivered) reasons.push("sent");
        else if (SETTLED_NOT_SENT.has(delivery.reason)) reasons.push(`not_sent: ${delivery.reason}`);
        else failedReason = delivery.reason;
      }
      if (failedReason) throw new Error(`Escalation email was not delivered: ${failedReason}`);
      await settle(reasons.includes("sent") ? "sent" : reasons[0] ?? "not_sent");
      if (reasons.includes("sent")) sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown escalation email failure";
      failures.push({ eventId: row.id, rung: "escalate_email", error: message });
      await supabase.from("tenant_lead_sla_events").update({ last_error: `email: ${message}`.slice(0, 1000) }).eq("id", row.id);
    }
  }
  return { sent, settled, failures };
}

/** Before 20260925709910: the side effects the database job now does, done here. */
async function processEvent(event: SlaEvent) {
  const supabase = db();
  // The ladder runs in the database every minute (20260924250100) and this runs whenever the app
  // does, so an escalation or partner notice can be delivered long after its rung fired.
  const tellsSomeone = event.rung === "escalate" || event.rung === "partner";
  const [leadResult, ownerResult, partnerResult, queueResult] = await Promise.all([
    supabase.from("agent_leads").select("values, product_line").eq("tenant_id", event.tenant_id).eq("id", event.lead_id).maybeSingle(),
    supabase.from("tenant_users").select("user_id, users!inner(id, name, email, status)").eq("tenant_id", event.tenant_id).eq("role", "owner").not("accepted_at", "is", null),
    event.partner_id ? supabase.from("partners").select("name").eq("tenant_id", event.tenant_id).eq("id", event.partner_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    tellsSomeone ? supabase.from("lead_queue").select("status").eq("tenant_id", event.tenant_id).eq("id", event.work_item_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (leadResult.error || ownerResult.error || partnerResult.error) throw new Error("Could not resolve SLA notification recipients");
  if (queueResult.error) throw new Error(`Could not re-read the transfer: ${queueResult.error.message}`);
  // Claimed or expired since the rung fired: "needs attention" and "nobody claimed it" are no longer
  // news, so nothing is sent and the event is marked processed. Warn has no side effect, and
  // expire's nurture is wanted however late it runs.
  if (tellsSomeone && queueResult.data?.status !== "unclaimed") return;
  const lead = leadResult.data;
  const owner = (ownerResult.data ?? []).find((row: { users?: { status?: string } }) => row.users?.status === "active")?.users;
  const partnerName = partnerResult.data?.name ?? "your partner";
  const name = customerName(lead?.values);

  if (event.rung === "escalate") {
    if (!owner?.id) throw new Error("No active tenant owner is available for SLA escalation");
    const sourceKey = `unclaimed-sla:${event.work_item_id}:escalated`;
    const notification = await supabase.from("agent_notifications").upsert({ tenant_id: event.tenant_id, recipient_user_id: owner.id, kind: "unclaimed_sla_escalation", title: `Unclaimed lead needs attention: ${name}`, body: `${name} has been waiting unclaimed. Open the lead to claim it or coordinate coverage.`, link: `/app/leads/${event.lead_id}`, source_key: sourceKey }, { onConflict: "tenant_id,recipient_user_id,source_key" });
    if (notification.error) throw new Error(`Could not create escalation notification: ${notification.error.message}`);
    if (owner.email) {
      const email = slaEscalationEmail({ name: owner.name, customerName: name, partnerName, leadUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/app/leads/${event.lead_id}` });
      const delivery = await sendEmail({ ...email, to: owner.email, userId: owner.id, tenantId: event.tenant_id, templateKey: "lead.sla_escalation", dedupeKey: `${sourceKey}:${owner.id}` });
      if (!delivery.delivered && !SETTLED_NOT_SENT.has(delivery.reason)) throw new Error(`Escalation email was not delivered: ${delivery.reason}`);
    }
  }
  if (event.rung === "escalate") {
    // "…and the lead is offered more widely." A new transfer alerts owners and producers; once it
    // escalates, everyone who can claim one is asked — assistants (buffer agents) included, the
    // same three roles `claim_transfer_lead` accepts. The owner already has the escalation alert.
    await notifyTenantAgents({
      tenantId: event.tenant_id,
      roles: ["owner", "producer", "assistant"],
      excludeUserId: owner?.id ?? null,
      // The same kind as the owner's alert, so each person's "unclaimed escalation" preference applies.
      kind: "unclaimed_sla_escalation",
      title: `Still unclaimed: ${name}`,
      body: `${name} has waited past the escalation time. Anyone free can claim it now.`,
      link: `/app/leads/${event.lead_id}`,
      sourceKey: `unclaimed-sla:${event.work_item_id}:offered`,
    });
  }
  if (event.rung === "expire") {
    // "…and becomes a nurture lead" (20260924230400). Queued for the dialer only where the agency
    // dials, otherwise the lead is marked nurture and waits for a nurture campaign. lead_queue is
    // UNIQUE(lead_id) live, so the dialer item is refused (23505) and the lead is marked nurture
    // without one. Before the migration there is nothing to call, and the expiry stands.
    const entitlement = await getEntitlement(event.tenant_id).catch(() => null);
    const queue = entitlement ? hasFeature(entitlement, "outbound_dialing") : false;
    let nurtured = await supabase.rpc("nurture_expired_transfer", { p_tenant_id: event.tenant_id, p_work_item_id: event.work_item_id, p_queue: queue });
    if (nurtured.error?.code === "23505" && queue) nurtured = await supabase.rpc("nurture_expired_transfer", { p_tenant_id: event.tenant_id, p_work_item_id: event.work_item_id, p_queue: false });
    if (nurtured.error && !isSchemaGap(nurtured.error)) throw new Error(`Could not move the expired lead to nurture: ${nurtured.error.message}`);
  }
  if (event.rung === "partner" && event.partner_id) {
    // The partner hears through a notice in their channel. "Nobody claimed" itself goes to the
    // agency's owners only: Design 1's writer routes the nobody_claimed card type there.
    await postPartnerNotice(event, name, customerState(lead?.values));
    await postPartnerSystemCard({ tenantId: event.tenant_id, partnerId: event.partner_id, leadId: event.lead_id, workItemId: event.work_item_id, eventKey: `unclaimed-sla:${event.work_item_id}:partner`, cardType: "nobody_claimed", message: `${name} was not claimed before the response window. Our team has been notified.` });
  }
}

/**
 * Before 20260925709910 is applied: the ladder, then every pending event done here. Nothing older
 * than a day is sent: it is marked processed with the reason instead, the rule 20260925709900 applies.
 */
async function processInApp(now: string) {
  const supabase = db();
  const scheduled = await supabase.rpc("run_unclaimed_sla", { p_now: now, p_limit: 500 });
  if (scheduled.error) throw new Error(`Could not advance unclaimed SLA: ${scheduled.error.message}`);
  const claimed = await supabase.rpc("claim_unclaimed_sla_events", { p_limit: 1000 });
  if (claimed.error) throw new Error(`Could not claim SLA events: ${claimed.error.message}`);
  const failures: RunFailure[] = [];
  let processed = 0;
  for (const event of (claimed.data ?? []) as Array<SlaEvent & { occurred_at?: string }>) {
    try {
      const stale = event.occurred_at ? Date.parse(event.occurred_at) < Date.now() - STALE_AFTER_MS : false;
      if (!stale) await processEvent(event);
      const result = await supabase.from("tenant_lead_sla_events").update({ processed_at: now, last_error: stale ? "skipped: older than 24 hours, nothing was sent" : null }).eq("id", event.id).is("processed_at", null);
      if (result.error) throw new Error(result.error.message);
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown SLA side effect failure";
      failures.push({ eventId: event.id, rung: event.rung, error: message });
      await supabase.from("tenant_lead_sla_events").update({ last_error: message }).eq("id", event.id);
    }
  }
  return { scanned: (scheduled.data ?? []).length, claimed: (claimed.data ?? []).length, processed, failures };
}

export async function processUnclaimedSla() {
  const supabase = db();
  const now = new Date().toISOString();
  // 20260925709910: the database does the ladder and every side effect but the email, every minute
  // (pg_cron), and marks each event processed. Calling it here as well is safe (it skips rows the
  // other run holds and sends nothing twice), so this path never repeats what pg_cron already did.
  // It only falls back to doing the work itself while that function does not exist.
  const database = await supabase.rpc("run_unclaimed_sla_side_effects", { p_now: now, p_limit: 500 });
  if (database.error && !isSchemaGap(database.error)) throw new Error(`Could not run the unclaimed SLA side effects: ${database.error.message}`);
  let base: { scanned: number; claimed: number; processed: number; failures: RunFailure[] };
  let emails = { sent: 0, settled: 0 };
  let path: "database" | "app";
  if (database.error) {
    path = "app";
    base = await processInApp(now);
  } else {
    path = "database";
    const report = (database.data ?? {}) as DatabaseRunReport;
    if (report.ok === false && report.error) throw new Error(`The unclaimed SLA side-effect run failed: ${report.error}`);
    const failed = (report.failures ?? []).map((failure) => ({ eventId: failure.eventId, rung: failure.rung, error: failure.error }));
    if (report.ladder?.error) failed.push({ eventId: "ladder", rung: "ladder", error: report.ladder.error });
    base = { scanned: report.ladder?.fired ?? 0, claimed: report.events ?? 0, processed: (report.events ?? 0) - (report.failed ?? 0), failures: failed };
    const owed = await sendOwedEscalationEmails();
    emails = { sent: owed.sent, settled: owed.settled };
    base.failures.push(...owed.failures);
  }
  const recent = await supabase.from("tenant_lead_sla_events").select("partner_id, rung").gte("occurred_at", new Date(Date.now() - 86_400_000).toISOString()).in("rung", ["escalate", "expire"]);
  const digest = new Map<string, { escalated: number; expired: number }>();
  for (const row of recent.data ?? []) { const key = row.partner_id ?? "direct"; const item = digest.get(key) ?? { escalated: 0, expired: 0 }; if (row.rung === "escalate") item.escalated += 1; else item.expired += 1; digest.set(key, item); }
  const partnerIds = [...digest.keys()].filter((id) => id !== "direct");
  const partners = partnerIds.length ? await supabase.from("partners").select("id, name").in("id", partnerIds) : { data: [], error: null };
  const names = new Map((partners.data ?? []).map((row: { id: string; name: string }) => [row.id, row.name]));
  const dailyDigestByPartner = Object.fromEntries([...digest.entries()].map(([id, counts]) => [names.get(id) ?? (id === "direct" ? "Direct leads" : id), counts]));
  return { ...base, path, emails, database: path === "database" ? database.data : null, dailyDigestByPartner };
}

export async function reopenExpiredLead(params: { tenantId: string; workItemId: string; actorId: string }) {
  const { data, error } = await db().rpc("reopen_expired_lead", { p_tenant_id: params.tenantId, p_work_item_id: params.workItemId, p_actor: params.actorId });
  if (error || !data) throw new Error(error?.message ?? "Could not reopen lead");
  return data;
}

/**
 * The public agent URL is keyed by lead id. Resolve its queue item on the server so the client
 * never has to know that the database RPC is keyed by work-item id, and keep the tenant predicate
 * beside the lookup so a hand-crafted cross-tenant lead id cannot be reopened.
 */
export async function reopenExpiredLeadByLeadId(params: { tenantId: string; leadId: string; actorId: string }) {
  // A lead can have more than one work item — an expired inbound transfer and the nurture call its
  // expiry queued (20260924230400), or earlier completed ones — so the expired transfer is chosen
  // explicitly rather than asked for as "the" row.
  const queue = await db()
    .from("lead_queue")
    .select("id, status, partner_id, queued_at")
    .eq("tenant_id", params.tenantId)
    .eq("lead_id", params.leadId)
    .order("queued_at", { ascending: false })
    .limit(20);
  if (queue.error) throw new Error(`Could not resolve lead queue item: ${queue.error.message}`);
  const rows = (queue.data ?? []) as Array<{ id: string; status: string; partner_id: string | null }>;
  const target = rows.find((row) => row.status === "expired" && row.partner_id) ?? rows.find((row) => row.status === "expired") ?? rows[0];
  if (!target?.id) throw new Error("WORK_ITEM_NOT_FOUND");
  return reopenExpiredLead({ tenantId: params.tenantId, workItemId: target.id, actorId: params.actorId });
}
