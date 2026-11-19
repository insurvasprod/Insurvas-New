import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { formatCentsAsCurrency } from "@/lib/money";
import { emailDeliveryMode, emailIsConfigured, sendEmail, type EmailDelivery } from "@/lib/email/transport";
import { INVOICE_EMAIL_TEMPLATE_KEY, invoiceEmail } from "@/lib/email/invoiceEmail";
import { configuredAppOrigin } from "@/lib/urls/origin";
import { INVOICE_STATUS_LABELS } from "./constants";
import { daysOverdue } from "./listView";
import type { InvoiceDetail } from "./queries";

/**
 * "Email to customer" on an invoice (billing-r2 screen 5): the invoice's facts and a link to the owner's own
 * printable copy (Settings › Plan & billing, /app/billing/invoices/[id]), sent to the agency's owner through the
 * shared transport, so it lands in email_log like every other send. The sheet's "Emails sent" tab reads
 * that log back, keyed by `invoice:<id>:…`.
 *
 * Degrades honestly: no owner email → nothing to send to; email delivery off here → the send is recorded as
 * skipped and the admin is told it did not leave; a draft or void invoice is not sent.
 */

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const day = (iso: string | null) => (iso ? DAY.format(new Date(iso)) : "—");

export type InvoiceEmailDraft =
  | { ok: true; to: string; subject: string; text: string; html: string; delivery: "on" | "off" }
  | { ok: false; reason: string };

export type InvoiceEmailSent = { id: string; ts: string; to_address: string; subject: string; status: "sent" | "failed" | "skipped"; failure_reason: string | null };

const dedupePrefix = (invoiceId: string) => `invoice:${invoiceId}:`;

async function ownerOf(tenantId: string): Promise<{ name: string | null; email: string } | null> {
  const { data } = await getSupabaseServiceClient()
    .from("tenant_users")
    .select("users(name, email)")
    .eq("tenant_id", tenantId)
    .eq("role", "owner")
    .not("accepted_at", "is", null)
    .order("accepted_at")
    .limit(1)
    .maybeSingle<{ users: { name: string | null; email: string } | null }>();
  return data?.users ?? null;
}

export async function invoiceEmailDraft(detail: InvoiceDetail): Promise<InvoiceEmailDraft> {
  const { invoice } = detail;
  if (invoice.status === "draft") return { ok: false, reason: "A draft has not been issued, so there is nothing to send yet." };
  if (invoice.status === "void") return { ok: false, reason: "A voided invoice is not sent to the customer." };
  const owner = await ownerOf(invoice.tenant_id);
  if (!owner?.email) return { ok: false, reason: "This customer has no owner with an email address to send to." };
  let origin: string;
  try {
    origin = configuredAppOrigin("agent");
  } catch {
    return { ok: false, reason: "The app's address is not configured here, so the email could not link to the invoice." };
  }
  const late = daysOverdue(invoice, Date.now());
  const standing = invoice.status === "overdue" && late
    ? `Overdue ${late} ${late === 1 ? "day" : "days"}`
    : invoice.status === "issued" ? `Due ${day(invoice.due_at)}` : INVOICE_STATUS_LABELS[invoice.status];
  const rendered = invoiceEmail({
    name: owner.name?.trim().split(/\s+/)[0] || "there",
    customerName: invoice.tenant_name,
    number: invoice.number,
    total: formatCentsAsCurrency(invoice.total_cents),
    issued: day(invoice.issued_at),
    due: day(invoice.due_at),
    standing,
    viewUrl: `${origin}/app/billing/invoices/${invoice.id}`,
  });
  return { ok: true, to: owner.email, ...rendered, delivery: emailDeliveryMode() === "smtp" && emailIsConfigured() ? "on" : "off" };
}

export async function sendInvoiceEmail(detail: InvoiceDetail): Promise<{ draft: InvoiceEmailDraft; delivery: EmailDelivery | null }> {
  const draft = await invoiceEmailDraft(detail);
  if (!draft.ok) return { draft, delivery: null };
  const delivery = await sendEmail({
    to: draft.to,
    subject: draft.subject,
    text: draft.text,
    html: draft.html,
    templateKey: INVOICE_EMAIL_TEMPLATE_KEY,
    tenantId: detail.invoice.tenant_id,
    // Unique per send: the log's unique index covers successful sends, and an invoice may be sent again.
    dedupeKey: `${dedupePrefix(detail.invoice.id)}${Date.now()}`,
  });
  return { draft, delivery };
}

/** What has been emailed about this invoice, newest first, from email_log. */
export async function fetchInvoiceEmails(invoiceId: string): Promise<InvoiceEmailSent[]> {
  const { data, error } = await getSupabaseServiceClient()
    .from("email_log")
    .select("id, ts, to_address, subject, status, failure_reason")
    .eq("template_key", INVOICE_EMAIL_TEMPLATE_KEY)
    .like("dedupe_key", `${dedupePrefix(invoiceId)}%`)
    .order("ts", { ascending: false })
    .limit(50);
  if (error) return [];
  return (data ?? []) as InvoiceEmailSent[];
}
