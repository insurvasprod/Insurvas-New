import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { emailDeliveryMode, emailIsConfigured, sendEmail, type EmailDelivery } from "@/lib/email/transport";
import { configuredAppOrigin } from "@/lib/urls/origin";
import { meterWarnThreshold } from "@/lib/settings/queries";
import { LIMIT_EMAIL_TEMPLATE_KEY, limitEmail } from "./limitEmail";
import { buildMonitorEntries, forecastHit, forecastLabel, type MonitorEntry } from "./present";
import { listSeatMonitor, listUsageMonitor } from "./service";

/**
 * "Email the owner" on a Credits & limits usage row (admin round 1, billing-r2 screen 10). The row is read again here,
 * never taken from the browser, so the email states the customer's real use; it goes to the agency's first accepted
 * owner through the shared transport and lands in email_log under LIMIT_EMAIL_TEMPLATE_KEY.
 *
 * At most one per customer, meter and day: a second press the same day is refused rather than mailing the owner twice.
 * Degrades honestly: no owner email → nothing to send to; delivery off here → recorded as skipped and said so.
 */

export type LimitEmailDraft =
  | { ok: true; to: string; subject: string; text: string; html: string; delivery: "on" | "off"; dedupeKey: string; entry: MonitorEntry }
  | { ok: false; reason: string; status: number };

const count = (value: number) => value.toLocaleString("en-US");

async function ownerOf(tenantId: string): Promise<{ name: string | null; email: string } | null> {
  const { data, error } = await getSupabaseServiceClient()
    .from("tenant_users")
    .select("users(name, email)")
    .eq("tenant_id", tenantId)
    .eq("role", "owner")
    .not("accepted_at", "is", null)
    .order("accepted_at")
    .limit(1)
    .maybeSingle<{ users: { name: string | null; email: string } | null }>();
  if (error) throw new Error(`Could not read the owner: ${error.message}`);
  return data?.users ?? null;
}

/** `meter` is a meter key, or "seats". */
export async function limitEmailDraft(tenantId: string, meter: string, now = new Date()): Promise<LimitEmailDraft> {
  const warn = await meterWarnThreshold();
  const [meters, seats] = await Promise.all([meter === "seats" ? Promise.resolve([]) : listUsageMonitor(false, warn), meter === "seats" ? listSeatMonitor() : Promise.resolve([])]);
  const entry = buildMonitorEntries(meters.filter((row) => row.tenant_id === tenantId && row.meter_key === meter), seats.filter((row) => row.tenant_id === tenantId), warn)[0];
  if (!entry) return { ok: false, reason: "That limit is no longer watched for this customer, so there is nothing to tell them.", status: 404 };
  if (entry.state === "ok") return { ok: false, reason: `This customer is below ${Math.round(warn * 100)}% of the limit; the email is for a limit that is near or past.`, status: 409 };

  const owner = await ownerOf(tenantId);
  if (!owner?.email) return { ok: false, reason: "This customer has no owner with an email address to send to.", status: 409 };
  let origin: string;
  try {
    origin = configuredAppOrigin("agent");
  } catch {
    return { ok: false, reason: "The app's address is not configured here, so the email could not link to the plan page.", status: 500 };
  }

  const forecast = forecastHit(entry, now);
  const hardCap = meters.find((row) => row.tenant_id === tenantId && row.meter_key === meter)?.hard_cap ?? entry.kind === "seats";
  const rendered = limitEmail({
    name: owner.name?.trim().split(/\s+/)[0] || "there",
    customerName: entry.tenantName,
    meter: entry.label,
    used: count(entry.used),
    limit: count(entry.limit),
    share: entry.limit > 0 ? `${Math.round((entry.used / entry.limit) * 100)}%` : "—",
    forecast: forecast.kind === "none" || forecast.kind === "not_this_period" ? null : forecast.kind === "over" ? "already over" : forecastLabel(forecast),
    hardCap,
    billingUrl: `${origin}/app/settings/billing`,
  });
  return {
    ok: true,
    to: owner.email,
    ...rendered,
    delivery: emailDeliveryMode() === "smtp" && emailIsConfigured() ? "on" : "off",
    dedupeKey: `usage:${tenantId}:${meter}:${now.toISOString().slice(0, 10)}`,
    entry,
  };
}

export async function sendLimitEmail(tenantId: string, meter: string): Promise<{ draft: LimitEmailDraft; delivery: EmailDelivery | null; alreadySent?: boolean }> {
  const draft = await limitEmailDraft(tenantId, meter);
  if (!draft.ok) return { draft, delivery: null };
  const { data: earlier, error } = await getSupabaseServiceClient()
    .from("email_log")
    .select("id")
    .eq("dedupe_key", draft.dedupeKey)
    .eq("status", "sent")
    .limit(1);
  if (error) throw new Error(`Could not check earlier emails: ${error.message}`);
  if ((earlier ?? []).length > 0) return { draft, delivery: null, alreadySent: true };
  const delivery = await sendEmail({
    to: draft.to,
    subject: draft.subject,
    text: draft.text,
    html: draft.html,
    templateKey: LIMIT_EMAIL_TEMPLATE_KEY,
    tenantId,
    dedupeKey: draft.dedupeKey,
  });
  return { draft, delivery };
}
