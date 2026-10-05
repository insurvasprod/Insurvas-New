import "server-only";

import { appointmentReminderEmail } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/transport";
import { customerName } from "@/lib/callbacks/timezone";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { appointmentReminderEventKey, appointmentReminderTimes, customerReminderAllowed } from "./reminderContract";

const DEFAULT_LEAD_MINUTES = 24 * 60;

type AppointmentRow = {
  id: string;
  tenant_id: string;
  lead_id: string;
  agent_user_id: string;
  starts_at_utc: string;
  customer_timezone: string;
  notes: string | null;
};
type UserRow = { id: string; name: string; email: string | null; status: string };

function asRows(value: unknown): AppointmentRow[] {
  return Array.isArray(value) ? value as AppointmentRow[] : [];
}

function address(value: unknown): string | null {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim() : null;
}

/**
 * Claims each appointment once in the database, then writes recipient-level in-app/email evidence.
 * The transport is disabled by default, so local runs cannot send Gmail or other external mail.
 */
export async function processAppointmentReminders(input: { now?: Date; leadMinutes?: number } = {}) {
  const now = input.now ?? new Date();
  const leadMinutes = Number.isInteger(input.leadMinutes) ? Math.min(Math.max(input.leadMinutes as number, 1), 7 * 24 * 60) : DEFAULT_LEAD_MINUTES;
  const until = new Date(now.getTime() + leadMinutes * 60_000);
  // The new reminder ledger is intentionally additive and is not in generated types until the
  // migration is promoted to the shared project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = getSupabaseServiceClient() as any;
  const claimed = await db.rpc("claim_appointment_reminders", { p_now: now.toISOString(), p_until: until.toISOString(), p_limit: 100 });
  if (claimed.error) throw new Error(`Could not claim appointment reminders: ${claimed.error.message}`);
  const rows = asRows(claimed.data);
  if (rows.length === 0) return { claimed: 0, notified: 0, delivered: 0, skipped: 0 };

  const leadIds = [...new Set(rows.map((row) => row.lead_id))];
  const userIds = [...new Set(rows.map((row) => row.agent_user_id))];
  const tenantIds = [...new Set(rows.map((row) => row.tenant_id))];
  const [leads, users, availability, certificates] = await Promise.all([
    db.from("agent_leads").select("id, values").in("id", leadIds),
    db.from("users").select("id, name, email, status").in("id", userIds),
    db.from("tenant_agent_availability").select("tenant_id, user_id, timezone").in("user_id", userIds),
    // The customer's consent (LA-2.11): their lead's certificates, tenant-scoped like every read here.
    db.from("tenant_consent_artefacts").select("tenant_id, lead_id, capture_status").in("tenant_id", tenantIds).in("lead_id", leadIds),
  ]);
  if (leads.error || users.error || availability.error || certificates.error) throw new Error("Could not load appointment reminder recipients.");
  const consentByLead = new Map<string, string[]>();
  for (const row of (certificates.data ?? []) as Array<{ lead_id: string; capture_status: string }>) {
    consentByLead.set(row.lead_id, [...(consentByLead.get(row.lead_id) ?? []), row.capture_status]);
  }
  const leadMap = new Map<string, Record<string, unknown>>((leads.data ?? []).map((lead: { id: string; values: unknown }): [string, Record<string, unknown>] => [lead.id, (lead.values ?? {}) as Record<string, unknown>]));
  const userMap = new Map<string, UserRow>((users.data ?? []).map((user: UserRow): [string, UserRow] => [user.id, user]));
  const zoneMap = new Map<string, string>((availability.data ?? []).map((row: { user_id: string; timezone: string }): [string, string] => [row.user_id, row.timezone]));
  let notified = 0;
  let delivered = 0;
  let skipped = 0;

  for (const row of rows) {
    const values = leadMap.get(row.lead_id) ?? {};
    const user = userMap.get(row.agent_user_id);
    const agentTimezone = zoneMap.get(row.agent_user_id) ?? "UTC";
    const times = appointmentReminderTimes({ startsAtUtc: row.starts_at_utc, customerTimezone: row.customer_timezone, agentTimezone });
    const name = customerName(values);
    // A channel is not consent: the customer is reminded only when both are there.
    const channel = address(values.email ?? values.email_address);
    const customerEmail = customerReminderAllowed({ email: channel, certificateStatuses: consentByLead.get(row.lead_id) ?? [] }) ? channel : null;
    const recipients = [
      { type: "agent" as const, key: row.agent_user_id, name: user?.name ?? "Agent", email: address(user?.email), notify: true },
      ...(customerEmail ? [{ type: "customer" as const, key: customerEmail, name, email: customerEmail, notify: false }] : []),
    ];

    for (const recipient of recipients) {
      const sourceKey = appointmentReminderEventKey(row.id, recipient.type, recipient.key);
      const event = await db.from("tenant_appointment_reminder_events").upsert({
        tenant_id: row.tenant_id, appointment_id: row.id, recipient_type: recipient.type, recipient_key: recipient.key,
        customer_local: times.customerLocal, agent_local: times.agentLocal, customer_timezone: times.customerTimezone,
        agent_timezone: times.agentTimezone, delivery_status: "queued", updated_at: now.toISOString(),
      }, { onConflict: "appointment_id,recipient_type,recipient_key", ignoreDuplicates: true }).select("id").maybeSingle();
      if (event.error) throw new Error(`Could not record appointment reminder: ${event.error.message}`);
      const eventId = event.data?.id;
      if (recipient.notify) {
        await db.from("agent_notifications").upsert({ tenant_id: row.tenant_id, recipient_user_id: recipient.key, kind: "appointment_reminder", title: `Appointment reminder: ${name}`, body: `Appointment at ${times.agentLocal} (${times.agentTimezone}); customer local time ${times.customerLocal} (${times.customerTimezone}).`, link: `/app/leads/${row.lead_id}`, source_key: sourceKey }, { onConflict: "tenant_id,recipient_user_id,source_key", ignoreDuplicates: true });
        notified += 1;
      }
      if (!recipient.email) {
        skipped += 1;
        if (eventId) await db.from("tenant_appointment_reminder_events").update({ delivery_status: "delivered", delivered_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", eventId);
        continue;
      }
      const rendered = appointmentReminderEmail({ name: recipient.name, customerName: name, customerTime: times.customerLocal, customerTimezone: times.customerTimezone, agentTime: times.agentLocal, agentTimezone: times.agentTimezone, note: row.notes, leadUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/app/leads/${encodeURIComponent(row.lead_id)}` });
      const result = await sendEmail({ ...rendered, to: recipient.email, userId: recipient.notify ? recipient.key : null, tenantId: row.tenant_id, templateKey: "appointment.reminder", dedupeKey: sourceKey });
      if (result.delivered) delivered += 1; else skipped += 1;
      if (eventId) await db.from("tenant_appointment_reminder_events").update({ delivery_status: result.delivered ? "delivered" : "skipped", failure_reason: result.delivered ? null : result.reason, delivered_at: result.delivered ? now.toISOString() : null, updated_at: now.toISOString() }).eq("id", eventId);
    }
  }
  return { claimed: rows.length, notified, delivered, skipped };
}
