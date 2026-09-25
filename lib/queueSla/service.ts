import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { postPartnerSystemCard } from "@/lib/partnerChat/service";
import { sendEmail } from "@/lib/email/transport";
import { slaEscalationEmail } from "@/lib/email/templates";
import { notifyTenantAgents } from "@/lib/agentAlerts/service";
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

function customerName(values: unknown) {
  const v = values && typeof values === "object" && !Array.isArray(values) ? values as Record<string, unknown> : {};
  return String((v.full_name ?? v.name ?? [v.first_name, v.last_name].filter(Boolean).join(" ")) || "Customer").slice(0, 160);
}

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
  // news, so nothing is sent and the event is marked processed. Warn has no side effect; expire's
  // nurture is wanted however late it runs.
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
      const delivery = await sendEmail({ ...email, to: owner.email, userId: owner.id, tenantId: event.tenant_id, templateKey: "lead.sla_escalation", dedupeKey: sourceKey });
      if (!delivery.delivered) throw new Error(`Escalation email was not delivered: ${delivery.reason}`);
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
    // dials; otherwise the lead is marked nurture and waits for a nurture campaign. Before the
    // migration there is nothing to call, and the expiry stands as it always did.
    const entitlement = await getEntitlement(event.tenant_id).catch(() => null);
    const queue = entitlement ? hasFeature(entitlement, "outbound_dialing") : false;
    const nurtured = await supabase.rpc("nurture_expired_transfer", { p_tenant_id: event.tenant_id, p_work_item_id: event.work_item_id, p_queue: queue });
    if (nurtured.error && !isSchemaGap(nurtured.error)) throw new Error(`Could not move the expired lead to nurture: ${nurtured.error.message}`);
  }
  if (event.rung === "partner" && event.partner_id) {
    await postPartnerSystemCard({ tenantId: event.tenant_id, partnerId: event.partner_id, leadId: event.lead_id, workItemId: event.work_item_id, eventKey: `unclaimed-sla:${event.work_item_id}:partner`, cardType: "nobody_claimed", message: `${name} was not claimed before the response window. Our team has been notified.` });
  }
}

export async function processUnclaimedSla() {
  const supabase = db();
  const now = new Date().toISOString();
  const scheduled = await supabase.rpc("run_unclaimed_sla", { p_now: now, p_limit: 500 });
  if (scheduled.error) throw new Error(`Could not advance unclaimed SLA: ${scheduled.error.message}`);
  const claimed = await supabase.rpc("claim_unclaimed_sla_events", { p_limit: 1000 });
  if (claimed.error) throw new Error(`Could not claim SLA events: ${claimed.error.message}`);
  const failures: Array<{ eventId: string; rung: string; error: string }> = [];
  let processed = 0;
  for (const event of claimed.data ?? []) {
    try {
      await processEvent(event);
      const result = await supabase.from("tenant_lead_sla_events").update({ processed_at: now, last_error: null }).eq("id", event.id).is("processed_at", null);
      if (result.error) throw new Error(result.error.message);
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown SLA side effect failure";
      failures.push({ eventId: event.id, rung: event.rung, error: message });
      await supabase.from("tenant_lead_sla_events").update({ last_error: message }).eq("id", event.id);
    }
  }
  const recent = await supabase.from("tenant_lead_sla_events").select("partner_id, rung").gte("occurred_at", new Date(Date.now() - 86_400_000).toISOString()).in("rung", ["escalate", "expire"]);
  const digest = new Map<string, { escalated: number; expired: number }>();
  for (const row of recent.data ?? []) { const key = row.partner_id ?? "direct"; const item = digest.get(key) ?? { escalated: 0, expired: 0 }; if (row.rung === "escalate") item.escalated += 1; else item.expired += 1; digest.set(key, item); }
  const partnerIds = [...digest.keys()].filter((id) => id !== "direct");
  const partners = partnerIds.length ? await supabase.from("partners").select("id, name").in("id", partnerIds) : { data: [], error: null };
  const names = new Map((partners.data ?? []).map((row: { id: string; name: string }) => [row.id, row.name]));
  const dailyDigestByPartner = Object.fromEntries([...digest.entries()].map(([id, counts]) => [names.get(id) ?? (id === "direct" ? "Direct leads" : id), counts]));
  return { scanned: (scheduled.data ?? []).length, claimed: (claimed.data ?? []).length, processed, failures, dailyDigestByPartner };
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
