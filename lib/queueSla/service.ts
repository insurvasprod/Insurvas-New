import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { postPartnerSystemCard } from "@/lib/partnerChat/service";
import { sendEmail } from "@/lib/email/transport";
import { slaEscalationEmail } from "@/lib/email/templates";

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
  const [leadResult, ownerResult, partnerResult] = await Promise.all([
    supabase.from("agent_leads").select("values, product_line").eq("tenant_id", event.tenant_id).eq("id", event.lead_id).maybeSingle(),
    supabase.from("tenant_users").select("user_id, users!inner(id, name, email, status)").eq("tenant_id", event.tenant_id).eq("role", "owner").not("accepted_at", "is", null),
    event.partner_id ? supabase.from("partners").select("name").eq("tenant_id", event.tenant_id).eq("id", event.partner_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (leadResult.error || ownerResult.error || partnerResult.error) throw new Error("Could not resolve SLA notification recipients");
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
      const result = await supabase.from("lead_sla_events").update({ processed_at: now, last_error: null }).eq("id", event.id).is("processed_at", null);
      if (result.error) throw new Error(result.error.message);
      processed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown SLA side effect failure";
      failures.push({ eventId: event.id, rung: event.rung, error: message });
      await supabase.from("lead_sla_events").update({ last_error: message }).eq("id", event.id);
    }
  }
  const recent = await supabase.from("lead_sla_events").select("partner_id, rung").gte("occurred_at", new Date(Date.now() - 86_400_000).toISOString()).in("rung", ["escalate", "expire"]);
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
