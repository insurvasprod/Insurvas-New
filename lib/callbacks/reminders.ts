import "server-only";

import { callbackReminderLeadMinutes } from "@/lib/settings/queries";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { callbackReminderEmail } from "@/lib/email/templates";
import { sendEmail } from "@/lib/email/transport";
import { formatInTimezone } from "./timezone";

export async function processCallbackReminders() {
  const minutes = await callbackReminderLeadMinutes();
  const now = new Date();
  const until = new Date(now.getTime() + minutes * 60_000);
  const supabase = getSupabaseServiceClient();
  const claimed = await supabase.rpc("claim_callback_reminders", { p_now: now.toISOString(), p_until: until.toISOString(), p_limit: 100 });
  if (claimed.error) throw new Error(`Could not claim callback reminders: ${claimed.error.message}`);
  const rows = claimed.data ?? [];
  if (rows.length === 0) return { claimed: 0, delivered: 0 };
  const leadIds = [...new Set(rows.map((row) => row.lead_id))];
  const userIds = [...new Set(rows.map((row) => row.assigned_to))];
  const [leads, users] = await Promise.all([
    supabase.from("agent_leads").select("id, values").in("id", leadIds),
    supabase.from("users").select("id, name, email").in("id", userIds).eq("status", "active"),
  ]);
  if (leads.error || users.error) throw new Error("Could not load callback reminder recipients.");
  const leadMap = new Map((leads.data ?? []).map((lead) => [lead.id, lead]));
  const userMap = new Map((users.data ?? []).map((user) => [user.id, user]));
  let delivered = 0;
  for (const row of rows) {
    const lead = leadMap.get(row.lead_id);
    const user = userMap.get(row.assigned_to);
    if (!user?.email) continue;
    const values = (lead?.values ?? {}) as Record<string, unknown>;
    const name = String(values.full_name ?? values.name ?? ([values.first_name, values.last_name].filter(Boolean).join(" ") || "Customer"));
    const body = callbackReminderEmail({ name: user.name, customerName: name, customerTime: formatInTimezone(row.scheduled_at_utc, row.customer_timezone), customerTimezone: row.customer_timezone, note: row.note, callbacksUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/app/callbacks` });
    const delivery = await sendEmail({ ...body, to: user.email, userId: user.id, tenantId: row.tenant_id, templateKey: "callback.reminder", dedupeKey: `callback-reminder:${row.id}` });
    if (delivery.delivered) delivered += 1;
    await supabase.from("agent_notifications").upsert({ tenant_id: row.tenant_id, recipient_user_id: user.id, kind: "callback_reminder", title: `Callback reminder: ${name}`, body: `Callback at ${formatInTimezone(row.scheduled_at_utc, row.customer_timezone)} (${row.customer_timezone}).`, link: `/app/leads/${row.lead_id}`, source_key: `callback-reminder:${row.id}` }, { onConflict: "tenant_id,recipient_user_id,source_key" });
  }
  return { claimed: rows.length, delivered };
}
