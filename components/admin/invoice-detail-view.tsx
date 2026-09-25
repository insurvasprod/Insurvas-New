import "server-only";

import { notFound } from "next/navigation";
import Link from "next/link";

import { voidRefusalReason } from "@/lib/invoices/permissions";
import { fetchInvoiceDetail } from "@/lib/invoices/queries";
import { refundApprovalThresholdCents } from "@/lib/settings/queries";
import { needsSecondApprover } from "@/lib/credits/rules";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { formatUtcDateTime } from "@/lib/adminDashboard/figures";
import { AdminPageHeader } from "@/components/admin/page-header";
import { BillingTabs } from "@/components/admin/billing-tabs";
import { InvoiceDetailTabs } from "@/components/admin/invoice-detail-tabs";
import { VoidInvoiceDialog } from "@/components/admin/void-invoice-dialog";
import { MarkPaidDialog } from "@/components/admin/mark-paid-dialog";
import { RefundDialog } from "@/components/admin/refund-dialog";
import { StatusChip, invoiceTone, reconciliationTone } from "@/components/admin/status-chip";
import { fullDate, periodRange } from "@/components/admin/tenant-record/billing-format";
import { formatCentsAsCurrency } from "@/lib/money";
import { INVOICE_LINE_KIND_LABELS, INVOICE_STATUS_LABELS } from "@/lib/invoices/constants";
import { cn } from "@/lib/utils";

const th = "px-3 py-2 text-left text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";
const td = "border-t border-[var(--border)] px-3 py-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]";
const tf = "border-t border-[var(--border-strong)] px-3 py-2.5 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]";
const card = "min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-5";
const eyebrow = "text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";
const disabledAction = "inline-flex h-10 w-full cursor-not-allowed items-center justify-center rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-[14px] font-semibold text-[var(--ink)] opacity-50";

const CREDIT_TONE: Record<string, "warning" | "info" | "neutral" | "good" | "danger"> = {
  pending_approval: "warning", approved: "info", processing: "neutral", succeeded: "good", failed: "danger", rejected: "neutral",
};

/** "payment.succeeded" → "Payment succeeded". */
function eventLabel(type: string) {
  const words = type.replace(/[._]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The invoice detail (p-adm-invoice-detail), rendered for an admin the page has already checked.
 * Split from the page so the page owns authorisation and this owns the screen; `canAct` is the
 * page's canVoidInvoices(role).
 */
export async function InvoiceDetailView({ id, canAct }: { id: string; canAct: boolean }) {
  const detail = await fetchInvoiceDetail(id);
  if (!detail) notFound();

  const { invoice, lines, events, payments, paidCents, remainingCents } = detail;
  // Resolved here rather than inside the dialog: the dialog is a client component and the
  // settings store is server-only (SA-4.1).
  const [approvalThresholdCents, creditNotesResult] = await Promise.all([
    refundApprovalThresholdCents(),
    getSupabaseServiceClient().from("credit_notes").select("id, number, type, amount_cents, status, reason_text, created_at").eq("invoice_id", invoice.id).order("created_at", { ascending: false }),
  ]);
  if (creditNotesResult.error) throw new Error(`Could not load this invoice's credit notes: ${creditNotesResult.error.message}`);
  const creditNotes = creditNotesResult.data ?? [];

  const settleable = invoice.status !== "paid" && invoice.status !== "void";
  const mismatched = invoice.reconciliation === "mismatched";
  const difference = invoice.provider_total_cents === null ? null : invoice.total_cents - invoice.provider_total_cents;
  const now = new Date();

  // What to do about a mismatch, from what is actually true of this invoice: once the provider has
  // collected it cannot be voided, so the remedy is a credit note; before that, void and re-raise.
  // "Needs a second approver" is said only when the credit note's amount would need one.
  const collected = invoice.status === "paid" || Boolean(invoice.provider_payment_id);
  const remedyCents = difference !== null ? Math.abs(difference) : null;
  // The likely cause, named when the data points at it. Whop's API cannot attach a promo code to an
  // existing membership, so a coupon or offer applied here discounts OUR invoice while Whop still
  // charges full price (user decision 25 Sep: keep applying, say the gap plainly). That shows up as
  // the provider charging more than we billed, on an invoice that carries a discount line.
  const hasDiscountLine = lines.some((line) => line.kind === "discount" && line.amount_cents < 0);
  const providerChargedMore = difference !== null && difference < 0;
  const cause = providerChargedMore
    ? hasDiscountLine
      ? <>Likely cause: this invoice carries a discount that was never applied to the membership in Whop&rsquo;s dashboard. A coupon or offer applied here changes our invoice only — Whop cannot take a code on an existing membership through its API.</>
      : <>Check whether a coupon or offer was applied to this subscription here without the same code being applied in Whop&rsquo;s dashboard.</>
    : difference !== null && difference > 0
      ? <>Likely cause: a discount applied at Whop that this invoice does not carry.</>
      : null;
  const remedy = providerChargedMore
    ? collected
      ? <>The customer paid Whop&rsquo;s price. Apply the same code to the membership in Whop&rsquo;s dashboard so the next charge matches, and decide whether the difference of {formatCentsAsCurrency(remedyCents ?? 0)} is owed back. A credit note against this invoice would not settle it.</>
      : <>Apply the same code to the membership in Whop&rsquo;s dashboard before it charges, or void this invoice and re-raise it at Whop&rsquo;s price.</>
    : collected
      ? remedyCents
        ? <>Raise a credit note for {formatCentsAsCurrency(remedyCents)}{needsSecondApprover("refund", remedyCents, approvalThresholdCents) ? " — which needs a second approver" : ""}.</>
        : <>Check the provider record before raising anything.</>
      : <>Void it and re-raise at the amount the provider will charge.</>;

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
    <p className="text-[14px] text-[var(--muted)]">No provider events recorded{invoice.provider_payment_id ? "" : " — this invoice has no provider payment to match against"}.</p>
  ) : (
    <ol className="flex flex-col gap-3.5">
      {activity.map((item) => (
        <li key={item.key} className="flex gap-3">
          <span className={cn("mt-1.5 size-[7px] shrink-0 rounded-full", item.dot)} aria-hidden />
          <span className="min-w-0">
            <span className="block text-[14px] font-semibold text-[var(--ink)]">{item.title}</span>
            <span className="mt-0.5 block text-[12px] text-[var(--muted)] tabular-nums">{item.meta} · {formatUtcDateTime(item.at)}</span>
          </span>
        </li>
      ))}
    </ol>
  );

  const lineItems = (
    <div>
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
          <tbody>
            {lines.length === 0 && <tr><td colSpan={5} className={cn(td, "py-6 text-center text-[var(--muted)]")}>This invoice has no line items.</td></tr>}
            {lines.map((line) => (
              <tr key={line.id}>
                <td className={td}>
                  <span className="font-semibold text-[var(--ink)]">{line.label}</span>
                  <span className="block text-[12px] text-[var(--muted)]">{INVOICE_LINE_KIND_LABELS[line.kind]}{line.included_qty !== null ? ` · ${Number(line.included_qty).toLocaleString()} included` : ""}</span>
                </td>
                <td className={cn(td, "whitespace-nowrap")}>{line.kind === "plan" || line.kind === "addon" ? periodRange(invoice.period_start, invoice.period_end, now) : "—"}</td>
                <td className={cn(td, "text-right tabular-nums")}>{Number(line.quantity).toLocaleString()}</td>
                <td className={cn(td, "text-right tabular-nums")}>{formatCentsAsCurrency(line.unit_cents)}</td>
                <td className={cn(td, "text-right tabular-nums")}>{formatCentsAsCurrency(line.amount_cents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-[var(--surface-alt)]">
            {(invoice.discount_cents > 0 || invoice.tax_cents > 0) && (
              <>
                <tr><td colSpan={4} className={cn(tf, "font-normal text-[var(--body)]")}>Subtotal</td><td className={cn(tf, "text-right font-normal tabular-nums")}>{formatCentsAsCurrency(invoice.subtotal_cents)}</td></tr>
                {invoice.discount_cents > 0 && <tr><td colSpan={4} className={cn(td, "bg-[var(--surface-alt)]")}>Discount</td><td className={cn(td, "bg-[var(--surface-alt)] text-right tabular-nums")}>−{formatCentsAsCurrency(invoice.discount_cents)}</td></tr>}
                {invoice.tax_cents > 0 && <tr><td colSpan={4} className={cn(td, "bg-[var(--surface-alt)]")}>Tax</td><td className={cn(td, "bg-[var(--surface-alt)] text-right tabular-nums")}>{formatCentsAsCurrency(invoice.tax_cents)}</td></tr>}
              </>
            )}
            <tr><td colSpan={4} className={tf}>Total billed by us</td><td className={cn(tf, "text-right tabular-nums")}>{formatCentsAsCurrency(invoice.total_cents)}</td></tr>
            {paidCents > 0 && <tr><td colSpan={4} className={cn(td, "bg-[var(--surface-alt)] text-[var(--success-ink)]")}>Received</td><td className={cn(td, "bg-[var(--surface-alt)] text-right font-semibold tabular-nums text-[var(--success-ink)]")}>{formatCentsAsCurrency(paidCents)}</td></tr>}
            {paidCents > 0 && remainingCents > 0 && <tr><td colSpan={4} className={cn(td, "bg-[var(--surface-alt)] text-[var(--warning-ink)]")}>Outstanding</td><td className={cn(td, "bg-[var(--surface-alt)] text-right font-semibold tabular-nums text-[var(--warning-ink)]")}>{formatCentsAsCurrency(remainingCents)}</td></tr>}
          </tfoot>
        </table>
      </div>
      {mismatched && (
        <div className="p-5">
          <div className="rounded-[12px] border border-[var(--border)] border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] px-4 py-3.5">
            <p className="text-[14px] font-semibold text-[var(--error-ink)]">The provider and our ledger disagree</p>
            <p className="mt-1.5 text-[14px] leading-normal text-[var(--body)]">
              Our lines total {formatCentsAsCurrency(invoice.total_cents)}; the provider charged {invoice.provider_total_cents === null ? "an amount we have not received" : formatCentsAsCurrency(invoice.provider_total_cents)}. The card was charged the provider&rsquo;s figure, not ours. {cause && <>{cause} </>}<strong className="font-semibold text-[var(--ink)]">Do not edit this invoice.</strong> {remedy}
            </p>
          </div>
        </div>
      )}
    </div>
  );

  const creditPanel = creditNotes.length === 0 ? (
    <p className="px-5 py-6 text-[14px] text-[var(--muted)]">No credit note has been raised against this invoice.</p>
  ) : (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse">
        <thead><tr className="bg-[var(--surface-alt)]"><th scope="col" className={th}>Credit note</th><th scope="col" className={th}>Type</th><th scope="col" className={th}>Raised</th><th scope="col" className={cn(th, "text-right")}>Amount</th><th scope="col" className={th}>Status</th></tr></thead>
        <tbody>
          {creditNotes.map((note) => (
            <tr key={note.id}>
              <td className={cn(td, "font-semibold text-[var(--ink)] tabular-nums")}>{note.number}{note.reason_text && <span className="block text-[12px] font-normal text-[var(--muted)]">{note.reason_text}</span>}</td>
              <td className={cn(td, "capitalize")}>{note.type}</td>
              <td className={cn(td, "whitespace-nowrap tabular-nums")}>{fullDate(note.created_at)}</td>
              <td className={cn(td, "text-right tabular-nums")}>{formatCentsAsCurrency(note.amount_cents)}</td>
              <td className={td}><StatusChip tone={CREDIT_TONE[note.status] ?? "neutral"} dot>{note.status.replace(/_/g, " ")}</StatusChip></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-[var(--border)] bg-[var(--canvas)] px-4 py-2.5 text-[12px] text-[var(--muted)]">Approvals and retries are on <Link href="/admin/credit-notes" className="font-semibold text-[var(--ink)] hover:underline">Refunds &amp; credits</Link>.</p>
    </div>
  );

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <AdminPageHeader
        backHref="/admin/invoices"
        backLabel="Back to invoices"
        title={invoice.number}
        subtitle="One invoice, its lines, and what the provider says happened."
        actions={
          <Link href={`/admin/invoices/${invoice.id}/print`} className="inline-flex h-11 items-center justify-center rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-4 text-[14px] font-semibold text-[var(--ink)] no-underline hover:bg-[var(--surface-alt)]">
            Print view
          </Link>
        }
      />
      <BillingTabs />

      <div className="flex flex-wrap items-center gap-2">
        {mismatched
          ? <StatusChip tone="danger" dot>Mismatched</StatusChip>
          : <StatusChip tone={reconciliationTone(invoice.reconciliation)}>{invoice.reconciliation.replace(/_/g, " ")}</StatusChip>}
        <StatusChip tone={invoiceTone(invoice.status)} dot>{INVOICE_STATUS_LABELS[invoice.status]}</StatusChip>
        <StatusChip tone="neutral"><Link href={`/admin/tenants/${invoice.tenant_id}`} className="hover:underline">{invoice.tenant_name}</Link></StatusChip>
        <StatusChip tone="neutral">{invoice.currency.toUpperCase()}</StatusChip>
      </div>

      <div className={card}>
        <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { label: "Issued", value: fullDate(invoice.issued_at) },
            { label: "Due", value: fullDate(invoice.due_at) },
            { label: "Our total", value: formatCentsAsCurrency(invoice.total_cents) },
            { label: "Provider charged", value: invoice.provider_total_cents === null ? "—" : formatCentsAsCurrency(invoice.provider_total_cents) },
            { label: "Difference", value: difference === null ? "—" : difference === 0 ? "None" : formatCentsAsCurrency(Math.abs(difference)), tone: difference ? "text-[var(--error-ink)]" : undefined },
          ].map((item) => (
            <div key={item.label} className="min-w-0">
              <dt className={eyebrow}>{item.label}</dt>
              <dd className={cn("m-0 mt-1 text-[14px] font-semibold tabular-nums text-[var(--ink)]", item.tone)}>{item.value}</dd>
            </div>
          ))}
        </dl>
        {invoice.paid_at && <p className="mt-3 text-[12px] text-[var(--muted)]">Paid {formatUtcDateTime(invoice.paid_at)}{invoice.provider_payment_id ? ` · provider payment ${invoice.provider_payment_id}` : ""}</p>}
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        <InvoiceDetailTabs
          tabs={[
            { id: "lines", label: "Line items", panel: lineItems },
            { id: "activity", label: "Provider activity", count: activity.length, panel: <div className="p-5">{timeline}</div> },
            { id: "credits", label: "Credit notes", count: creditNotes.length, panel: creditPanel },
          ]}
        />

        <div className="flex min-w-0 flex-col gap-4">
          <section className={card} aria-labelledby="provider-activity">
            <h2 id="provider-activity" className="text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">Provider activity</h2>
            <div className="mt-3.5">{timeline}</div>
          </section>
          <section className={card} aria-labelledby="invoice-actions">
            <h2 id="invoice-actions" className="text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">Actions</h2>
            {canAct ? (
              <div className="mt-3.5 flex flex-col gap-2.5">
                {settleable ? (
                  <MarkPaidDialog invoiceId={invoice.id} number={invoice.number} remainingCents={remainingCents} />
                ) : (
                  <div>
                    <span className={disabledAction} aria-disabled="true">Mark paid</span>
                    <p className="mt-1.5 text-[12px] text-[var(--muted)]">{invoice.status === "void" ? "A voided invoice cannot be paid." : "Already paid in full."}</p>
                  </div>
                )}
                {invoice.status === "paid" ? (
                  <RefundDialog
                    tenantId={invoice.tenant_id}
                    invoiceId={invoice.id}
                    number={invoice.number}
                    totalCents={invoice.total_cents}
                    hasProviderPayment={Boolean(invoice.provider_payment_id)}
                    approvalThresholdCents={approvalThresholdCents}
                  />
                ) : (
                  <div>
                    <span className={disabledAction} aria-disabled="true">Raise a credit note</span>
                    <p className="mt-1.5 text-[12px] text-[var(--muted)]">A credit note gives back money that was collected; this invoice is {INVOICE_STATUS_LABELS[invoice.status].toLowerCase()}, not paid.</p>
                  </div>
                )}
                <VoidInvoiceDialog invoiceId={invoice.id} number={invoice.number} refusalReason={voidRefusalReason(invoice.status)} />
              </div>
            ) : (
              <p className="mt-3 text-[14px] text-[var(--muted)]">Only billing admins and super admins can record a payment, raise a credit note or void an invoice.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
