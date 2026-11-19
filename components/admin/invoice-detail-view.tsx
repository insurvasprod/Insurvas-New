import "server-only";

import type { ReactNode } from "react";
import Link from "next/link";
import { Download, ExternalLink, Printer } from "lucide-react";

import { voidRefusalReason } from "@/lib/invoices/permissions";
import { fetchInvoiceDetail, type InvoiceDetail } from "@/lib/invoices/queries";
import { daysOverdue } from "@/lib/invoices/listView";
import { fetchInvoiceEmails, invoiceEmailDraft, type InvoiceEmailSent } from "@/lib/invoices/emailInvoice";
import { fetchInvoiceExplanation } from "@/lib/invoices/reconcileQueries";
import { RECON_REASON_LABELS, likelyReason, type ReconExplanation } from "@/lib/invoices/reconcile";
import { refundApprovalThresholdCents } from "@/lib/settings/queries";
import { needsSecondApprover } from "@/lib/credits/rules";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { formatUtcDateTime } from "@/lib/adminDashboard/figures";
import { InvoiceDetailTabs } from "@/components/admin/invoice-detail-tabs";
import { VoidInvoiceDialog } from "@/components/admin/void-invoice-dialog";
import { MarkPaidDialog } from "@/components/admin/mark-paid-dialog";
import { RefundDialog } from "@/components/admin/refund-dialog";
import { StatusChip, invoiceTone } from "@/components/admin/status-chip";
import { fullDate, periodRange } from "@/components/admin/tenant-record/billing-format";
import { BillingStatusLine } from "@/components/admin/billing/inv-status-line";
import { RecordSheet } from "@/components/admin/billing/inv-sheet";
import { InvoiceEmailDialog, type InvoiceEmailPreview } from "@/components/admin/billing/inv-email-dialog";
import { Button } from "@/components/ui/button";
import { PagedBody, PagedPager, PagedProvider } from "@/components/ui/paged";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { formatCentsAsCurrency } from "@/lib/money";
import { INVOICE_LINE_KIND_LABELS, INVOICE_STATUS_LABELS } from "@/lib/invoices/constants";
import { cn } from "@/lib/utils";

const th = "px-3 py-2 text-left text-xs leading-[1.33] font-semibold text-[var(--muted)]";
const td = "border-t border-[var(--border)] px-3 py-2 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--body)]";
const tf = "border-t border-[var(--border-strong)] px-3 py-2.5 text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]";
const pagerRow = "flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--canvas)] px-4 py-2.5 text-xs text-[var(--muted)]";

const CREDIT_TONE: Record<string, "warning" | "info" | "neutral" | "good" | "danger"> = {
  pending_approval: "warning", approved: "info", processing: "neutral", succeeded: "good", failed: "danger", rejected: "neutral",
};
const EMAIL_STATUS: Record<InvoiceEmailSent["status"], { label: string; tone: "good" | "danger" | "neutral" }> = {
  sent: { label: "Sent", tone: "good" },
  failed: { label: "Failed", tone: "danger" },
  skipped: { label: "Not sent", tone: "neutral" },
};

/** "payment.succeeded" → "Payment succeeded". */
function eventLabel(type: string) {
  const words = type.replace(/[._]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

type CreditNoteLine = { id: string; number: string; type: string; amount_cents: number; status: string; reason_text: string | null; created_at: string };

/** Everything one invoice's view shows, read once for the sheet over the list and the record page alike. */
export type InvoiceViewData = {
  detail: InvoiceDetail;
  creditNotes: CreditNoteLine[];
  approvalThresholdCents: number;
  emails: InvoiceEmailSent[];
  emailPreview: InvoiceEmailPreview;
  explanation: ReconExplanation | null;
};

export async function loadInvoiceView(id: string): Promise<InvoiceViewData | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const detail = await fetchInvoiceDetail(id);
  if (!detail) return null;
  // Resolved here rather than inside the dialog: the dialog is a client component and the
  // settings store is server-only (SA-4.1).
  const [approvalThresholdCents, creditNotesResult, emails, draft, explanation] = await Promise.all([
    refundApprovalThresholdCents(),
    getSupabaseServiceClient().from("credit_notes").select("id, number, type, amount_cents, status, reason_text, created_at").eq("invoice_id", detail.invoice.id).order("created_at", { ascending: false }),
    fetchInvoiceEmails(detail.invoice.id),
    invoiceEmailDraft(detail),
    detail.invoice.reconciliation === "mismatched" ? fetchInvoiceExplanation(detail.invoice.id) : Promise.resolve(null),
  ]);
  if (creditNotesResult.error) throw new Error(`Could not load this invoice's credit notes: ${creditNotesResult.error.message}`);
  const emailPreview: InvoiceEmailPreview = draft.ok ? { ok: true, to: draft.to, subject: draft.subject, text: draft.text, delivery: draft.delivery } : draft;
  return { detail, creditNotes: creditNotesResult.data ?? [], approvalThresholdCents, emails, emailPreview, explanation };
}

/** The record's name: "INV-1042 · Admin Team". */
export function invoiceTitle(view: InvoiceViewData): string {
  return `${view.detail.invoice.number} · ${view.detail.invoice.tenant_name}`;
}

/**
 * The invoice (p-adm-invoice-detail, billing-r2 screen 5), in its two homes: the wide sheet over the invoices
 * list (`InvoiceSheet`, `?invoice=<id>`) and the record page `/admin/invoices/[id]` (`InvoiceDetailView`, inside
 * BillingPage). Both draw the same parts: Issued, Due, Our total, Provider charged, Difference; the mismatch line
 * with its remedy and "see why"; Lines · Provider activity · Credit notes · Emails sent; and the actions — Mark
 * paid, Credit note, Void (refused with its reason), Print, Download PDF, Email to customer, the customer link.
 * `canAct` is the page's canVoidInvoices(role); without it the actions show disabled, with why.
 */
function invoiceParts(view: InvoiceViewData, canAct: boolean) {
  const { detail, creditNotes, approvalThresholdCents, emails, emailPreview, explanation } = view;
  const { invoice, lines, events, payments, paidCents, remainingCents } = detail;
  const now = new Date();

  const settleable = invoice.status !== "paid" && invoice.status !== "void";
  const mismatched = invoice.reconciliation === "mismatched";
  const difference = invoice.provider_total_cents === null ? null : invoice.total_cents - invoice.provider_total_cents;
  const late = daysOverdue(invoice, now.getTime());

  // What to do about a mismatch, from what is actually true of this invoice: once the provider has
  // collected it cannot be voided, so the remedy is a credit note; before that, void and re-raise.
  // "Needs a second approver" is said only when the credit note's amount would need one. When the
  // provider charged MORE than we billed, the usual cause is a coupon or offer applied here but not
  // to the membership in Whop (user decision 25 Sep: keep applying, say the gap plainly).
  const collected = invoice.status === "paid" || Boolean(invoice.provider_payment_id);
  const remedyCents = difference !== null ? Math.abs(difference) : null;
  const providerChargedMore = difference !== null && difference < 0;
  const remedy = providerChargedMore
    ? collected
      ? `Apply the same code to the membership in Whop so the next charge matches, and decide whether ${formatCentsAsCurrency(remedyCents ?? 0)} is owed back.`
      : "Apply the same code to the membership in Whop before it charges, or void this invoice and re-raise it at Whop's price."
    : collected
      ? remedyCents
        ? `Raise a credit note for ${formatCentsAsCurrency(remedyCents)}${needsSecondApprover("refund", remedyCents, approvalThresholdCents) ? " (needs a second approver)" : ""}.`
        : "Check the provider record before raising anything."
      : "Void it and re-raise at the amount the provider will charge.";
  const reason = mismatched ? RECON_REASON_LABELS[likelyReason({ ...invoice, lines })] : null;

  const subtitle = [
    `Issued ${fullDate(invoice.issued_at)}`,
    `due ${fullDate(invoice.due_at)}`,
    late ? `${late} ${late === 1 ? "day" : "days"} late` : invoice.paid_at ? `paid ${fullDate(invoice.paid_at)}` : null,
    invoice.currency.toUpperCase(),
  ].filter(Boolean).join(" · ");

  const chip = mismatched
    ? <StatusChip tone="danger" dot>Doesn&apos;t match</StatusChip>
    : (
      <StatusChip tone={invoiceTone(invoice.status)} dot>
        <span className={invoice.status === "void" ? "line-through" : undefined}>{invoice.status === "overdue" && late ? `${late} ${late === 1 ? "day" : "days"} late` : INVOICE_STATUS_LABELS[invoice.status]}</span>
      </StatusChip>
    );

  const facts = (
    <StatStrip label="Invoice figures">
      <StatTile label="Issued" value={fullDate(invoice.issued_at)} valueSize="text" />
      <StatTile label="Due" value={fullDate(invoice.due_at)} valueSize="text" footnote={late ? `${late} ${late === 1 ? "day" : "days"} late` : undefined} />
      <StatTile label="Our total" value={formatCentsAsCurrency(invoice.total_cents)} footnote={invoice.paid_at ? `Paid ${formatUtcDateTime(invoice.paid_at)}` : INVOICE_STATUS_LABELS[invoice.status]} />
      <StatTile
        label="Provider charged"
        value={invoice.provider_total_cents === null ? "—" : formatCentsAsCurrency(invoice.provider_total_cents)}
        footnote={invoice.provider_payment_id ? <span className="break-all">{invoice.provider_payment_id}</span> : invoice.reconciliation.replace(/_/g, " ")}
      />
      <StatTile label="Difference" value={difference === null ? "—" : difference === 0 ? "None" : formatCentsAsCurrency(Math.abs(difference))} footnote={difference ? (difference > 0 ? "we billed more" : "the provider charged more") : undefined} />
    </StatStrip>
  );

  const mismatchLine = mismatched ? (
    <BillingStatusLine
      tone={explanation ? "ok" : "bad"}
      parts={[
        explanation
          ? `Explained${explanation.explained_by_name ? ` by ${explanation.explained_by_name}` : ""} on ${fullDate(explanation.created_at)}: ${explanation.note}`
          : `The provider charged ${invoice.provider_total_cents === null ? "an amount we have not received" : formatCentsAsCurrency(invoice.provider_total_cents)}, we billed ${formatCentsAsCurrency(invoice.total_cents)}. Do not edit this invoice. ${remedy}`,
        reason ? `Likely: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` : null,
        <Link key="why" href={`/admin/billing/reconciliation?invoice=${invoice.id}`} className="font-medium text-foreground underline underline-offset-2 hover:text-[var(--accent-ink)]">See why in Reconciliation</Link>,
      ]}
    />
  ) : null;

  const activity = [
    ...payments.map((payment) => ({
      key: `p-${payment.id}`,
      at: payment.paid_at,
      title: `Payment succeeded — ${formatCentsAsCurrency(payment.amount_cents)}`,
      meta: payment.method === "manual_bank_transfer" ? `Bank transfer${payment.manual_reference ? ` · ${payment.manual_reference}` : ""}` : "Provider",
      dot: "bg-[var(--success)]",
    })),
    ...events.map((event) => ({
      key: `e-${event.id}`,
      at: event.occurred_at ?? event.received_at,
      title: eventLabel(event.event_type),
      meta: "Provider",
      dot: /fail|dispute|refund/i.test(event.event_type) ? "bg-[var(--error)]" : "bg-[var(--muted)]",
    })),
    ...(invoice.voided_at ? [{ key: "void", at: invoice.voided_at, title: `Voided${invoice.void_reason ? ` — ${invoice.void_reason}` : ""}`, meta: "Staff", dot: "bg-[var(--muted)]" }] : []),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const timeline = activity.length === 0 ? (
    <p className="text-sm text-[var(--muted)]">No provider events recorded{invoice.provider_payment_id ? "" : " — this invoice has no provider payment to match against"}.</p>
  ) : (
    <PagedProvider>
      <PagedBody as="ol" className="flex flex-col gap-3.5">
        {activity.map((item) => (
          <li key={item.key} className="flex gap-3">
            <span className={cn("mt-1.5 size-[7px] shrink-0 rounded-full", item.dot)} aria-hidden />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[var(--ink)]">{item.title}</span>
              <span className="mt-0.5 block text-xs text-[var(--muted)] tabular-nums">{item.meta} · {formatUtcDateTime(item.at)}</span>
            </span>
          </li>
        ))}
      </PagedBody>
      {activity.length > 10 && <div className={cn(pagerRow, "-mx-5 -mb-5 mt-5")}><PagedPager total={activity.length} noun="events" /></div>}
    </PagedProvider>
  );

  const lineItems = (
    <PagedProvider>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse">
          <thead>
            <tr className="bg-[var(--surface-alt)]">
              <th scope="col" className={th}>Description</th>
              <th scope="col" className={cn(th, "w-[200px]")}>Period</th>
              <th scope="col" className={cn(th, "w-[70px] text-right")}>Qty</th>
              <th scope="col" className={cn(th, "w-[110px] text-right")}>Unit</th>
              <th scope="col" className={cn(th, "w-[120px] text-right")}>Amount</th>
            </tr>
          </thead>
          {lines.length === 0 && <tbody><tr><td colSpan={5} className={cn(td, "py-6 text-center text-[var(--muted)]")}>This invoice has no line items.</td></tr></tbody>}
          <PagedBody>
            {lines.map((line) => (
              <tr key={line.id}>
                <td className={td}>
                  <span className="font-semibold text-[var(--ink)]">{line.label}</span>
                  <span className="block text-xs text-[var(--muted)]">{INVOICE_LINE_KIND_LABELS[line.kind]}{line.included_qty !== null ? ` · ${Number(line.included_qty).toLocaleString()} included` : ""}</span>
                </td>
                <td className={cn(td, "whitespace-nowrap")}>{line.kind === "plan" || line.kind === "addon" ? periodRange(invoice.period_start, invoice.period_end, now) : "—"}</td>
                <td className={cn(td, "text-right tabular-nums")}>{Number(line.quantity).toLocaleString()}</td>
                <td className={cn(td, "text-right tabular-nums")}>{formatCentsAsCurrency(line.unit_cents)}</td>
                <td className={cn(td, "text-right tabular-nums")}>{formatCentsAsCurrency(line.amount_cents)}</td>
              </tr>
            ))}
          </PagedBody>
          <tfoot className="bg-[var(--surface-alt)]">
            {(invoice.discount_cents > 0 || invoice.tax_cents > 0) && (
              <>
                <tr><td colSpan={4} className={cn(tf, "font-normal text-[var(--body)]")}>Subtotal</td><td className={cn(tf, "text-right font-normal tabular-nums")}>{formatCentsAsCurrency(invoice.subtotal_cents)}</td></tr>
                {invoice.discount_cents > 0 && <tr><td colSpan={4} className={cn(td, "bg-[var(--surface-alt)]")}>Discount</td><td className={cn(td, "bg-[var(--surface-alt)] text-right tabular-nums")}>−{formatCentsAsCurrency(invoice.discount_cents)}</td></tr>}
                {invoice.tax_cents > 0 && <tr><td colSpan={4} className={cn(td, "bg-[var(--surface-alt)]")}>Tax</td><td className={cn(td, "bg-[var(--surface-alt)] text-right tabular-nums")}>{formatCentsAsCurrency(invoice.tax_cents)}</td></tr>}
              </>
            )}
            <tr><td colSpan={4} className={tf}>Total billed by us</td><td className={cn(tf, "text-right tabular-nums")}>{formatCentsAsCurrency(invoice.total_cents)}</td></tr>
            {paidCents > 0 && <tr><td colSpan={4} className={cn(td, "bg-[var(--surface-alt)]")}>Received</td><td className={cn(td, "bg-[var(--surface-alt)] text-right font-semibold tabular-nums text-[var(--ink)]")}>{formatCentsAsCurrency(paidCents)}</td></tr>}
            {paidCents > 0 && remainingCents > 0 && <tr><td colSpan={4} className={cn(td, "bg-[var(--surface-alt)]")}>Outstanding</td><td className={cn(td, "bg-[var(--surface-alt)] text-right font-semibold tabular-nums text-[var(--ink)]")}>{formatCentsAsCurrency(remainingCents)}</td></tr>}
          </tfoot>
        </table>
      </div>
      {lines.length > 10 && <div className={pagerRow}><PagedPager total={lines.length} noun="line items" /></div>}
    </PagedProvider>
  );

  const creditPanel = creditNotes.length === 0 ? (
    <p className="px-5 py-6 text-sm text-[var(--muted)]">No credit note has been raised against this invoice.</p>
  ) : (
    <PagedProvider>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse">
          <thead><tr className="bg-[var(--surface-alt)]"><th scope="col" className={th}>Credit note</th><th scope="col" className={th}>Type</th><th scope="col" className={th}>Raised</th><th scope="col" className={cn(th, "text-right")}>Amount</th><th scope="col" className={th}>Status</th></tr></thead>
          <PagedBody>
            {creditNotes.map((note) => (
              <tr key={note.id}>
                <td className={cn(td, "font-semibold text-[var(--ink)] tabular-nums")}><Link href={`/admin/credit-notes?note=${note.id}`} className="hover:underline">{note.number}</Link>{note.reason_text && <span className="block text-xs font-normal text-[var(--muted)]">{note.reason_text}</span>}</td>
                <td className={cn(td, "capitalize")}>{note.type}</td>
                <td className={cn(td, "whitespace-nowrap tabular-nums")}>{fullDate(note.created_at)}</td>
                <td className={cn(td, "text-right tabular-nums")}>{formatCentsAsCurrency(note.amount_cents)}</td>
                <td className={td}><StatusChip tone={CREDIT_TONE[note.status] ?? "neutral"} dot>{note.status.replace(/_/g, " ")}</StatusChip></td>
              </tr>
            ))}
          </PagedBody>
        </table>
      </div>
      {creditNotes.length > 10
        ? <div className={pagerRow}><PagedPager total={creditNotes.length} noun="credit notes" suffix={<>approvals and retries are on <Link href="/admin/credit-notes" className="font-semibold text-[var(--ink)] hover:underline">Refunds &amp; credits</Link></>} /></div>
        : <p className="border-t border-[var(--border)] bg-[var(--canvas)] px-4 py-2.5 text-xs text-[var(--muted)]">Approvals and retries are on <Link href="/admin/credit-notes" className="font-semibold text-[var(--ink)] hover:underline">Refunds &amp; credits</Link>.</p>}
    </PagedProvider>
  );

  const emailPanel = emails.length === 0 ? (
    <p className="px-5 py-6 text-sm text-[var(--muted)]">This invoice has not been emailed to the customer{emailPreview.ok ? `; Email to customer sends it to ${emailPreview.to}` : ""}.</p>
  ) : (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse">
        <thead><tr className="bg-[var(--surface-alt)]"><th scope="col" className={th}>Sent</th><th scope="col" className={th}>To</th><th scope="col" className={th}>Subject</th><th scope="col" className={th}>Result</th></tr></thead>
        <tbody>
          {emails.map((email) => (
            <tr key={email.id}>
              <td className={cn(td, "whitespace-nowrap tabular-nums")}>{formatUtcDateTime(email.ts)}</td>
              <td className={cn(td, "max-w-[200px] truncate")}>{email.to_address}</td>
              <td className={td}>{email.subject}</td>
              <td className={td} title={email.failure_reason ?? undefined}><StatusChip tone={EMAIL_STATUS[email.status]?.tone ?? "neutral"}>{EMAIL_STATUS[email.status]?.label ?? email.status}</StatusChip></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const tabs = (
    <InvoiceDetailTabs
      tabs={[
        { id: "lines", label: "Lines", count: lines.length, panel: lineItems },
        { id: "activity", label: "Provider activity", count: activity.length, panel: <div className="p-5">{timeline}</div> },
        { id: "credits", label: "Credit notes", count: creditNotes.length, panel: creditPanel },
        { id: "emails", label: "Emails sent", count: emails.length, panel: emailPanel },
      ]}
    />
  );

  const refusal = voidRefusalReason(invoice.status, paidCents);
  const deny = "Only billing admins and super admins can record a payment, raise a credit note or void an invoice.";
  const acts: ReactNode = canAct ? (
    <>
      <VoidInvoiceDialog invoiceId={invoice.id} number={invoice.number} refusalReason={refusal} trigger={{ compact: true, label: "Void…", variant: "outline", className: "text-[var(--error-ink)]" }} />
      {invoice.status === "paid" ? (
        <RefundDialog
          tenantId={invoice.tenant_id}
          invoiceId={invoice.id}
          number={invoice.number}
          totalCents={invoice.total_cents}
          hasProviderPayment={Boolean(invoice.provider_payment_id)}
          approvalThresholdCents={approvalThresholdCents}
          trigger={{ label: "Credit note…", variant: "outline", className: "" }}
        />
      ) : (
        <span title={`Only a paid invoice can be credited; this one is ${INVOICE_STATUS_LABELS[invoice.status].toLowerCase()}.`}><Button variant="outline" disabled>Credit note…</Button></span>
      )}
      {settleable
        ? <MarkPaidDialog invoiceId={invoice.id} number={invoice.number} remainingCents={remainingCents} trigger={{ label: "Mark paid…", variant: "default", className: "" }} />
        : <span title={invoice.status === "void" ? "A voided invoice cannot be paid." : "Already paid in full."}><Button disabled>Mark paid…</Button></span>}
    </>
  ) : (
    <>
      <span title={deny}><Button variant="outline" disabled>Void…</Button></span>
      <span title={deny}><Button variant="outline" disabled>Credit note…</Button></span>
      <span title={deny}><Button disabled>Mark paid…</Button></span>
    </>
  );

  const footer = (
    <div className="flex w-full flex-col gap-2">
      {(canAct ? refusal : deny) && <p className="m-0 text-xs text-muted-foreground">{canAct ? `Void is off: ${refusal}` : deny}</p>}
      <div className="flex w-full flex-wrap items-center gap-1.5">
        <Button asChild variant="ghost" className="px-2.5"><Link href={`/admin/invoices/${invoice.id}/print`} target="_blank"><Printer aria-hidden="true" />Print<ExternalLink aria-hidden="true" className="size-3" /></Link></Button>
        <Button asChild variant="ghost" className="px-2.5"><Link href={`/admin/invoices/${invoice.id}/print?pdf=1`} target="_blank"><Download aria-hidden="true" />Download PDF</Link></Button>
        <InvoiceEmailDialog invoiceId={invoice.id} number={invoice.number} preview={emailPreview} canAct={canAct} />
        <span className="flex-1" />
        {acts}
      </div>
    </div>
  );

  const customer = <Button asChild variant="ghost" size="sm"><Link href={`/admin/tenants/${invoice.tenant_id}`}>{invoice.tenant_name} ›</Link></Button>;

  return { subtitle, chip, facts, mismatchLine, tabs, footer, customer };
}

/** The record page, inside BillingPage (step "invoices", title from `invoiceTitle`). */
export function InvoiceDetailView({ view, canAct }: { view: InvoiceViewData; canAct: boolean }) {
  const parts = invoiceParts(view, canAct);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">{parts.chip}<span>{parts.subtitle}</span><span className="ml-auto">{parts.customer}</span></div>
      {parts.facts}
      {parts.mismatchLine}
      {parts.tabs}
      <div className="rounded-lg border border-border bg-card px-4 py-3">{parts.footer}</div>
    </div>
  );
}

/** The wide right sheet over the invoices list (`?invoice=<id>`). */
export function InvoiceSheet({ view, canAct }: { view: InvoiceViewData; canAct: boolean }) {
  const parts = invoiceParts(view, canAct);
  return (
    <RecordSheet param="invoice" wide title={invoiceTitle(view)} subtitle={parts.subtitle} status={parts.chip} actions={parts.customer} footer={parts.footer}>
      {parts.facts}
      {parts.mismatchLine}
      {parts.tabs}
    </RecordSheet>
  );
}
