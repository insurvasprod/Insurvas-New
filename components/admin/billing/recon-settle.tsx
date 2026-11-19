"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Sheet } from "@/components/ui/sheet";
import { FactTable } from "@/components/ui/fact-table";
import { textareaControl } from "@/components/ui/field";
import { StatusChip } from "@/components/admin/status-chip";
import { RefundDialog } from "@/components/admin/refund-dialog";
import { MarkPaidDialog } from "@/components/admin/mark-paid-dialog";
import { CustomInvoiceDialog } from "@/components/admin/custom-invoice-dialog";
import { fullDate } from "@/components/admin/tenant-record/billing-format";
import { formatCentsAsCurrency } from "@/lib/money";
import { INVOICE_STATUS_LABELS } from "@/lib/invoices/constants";
import { RECON_REASON_LABELS, type ReconRow } from "@/lib/invoices/reconcile";
import { notify } from "@/lib/notify";

const signed = (cents: number) => (cents < 0 ? `−${formatCentsAsCurrency(-cents)}` : formatCentsAsCurrency(cents));

/**
 * Settle… one reconciliation row (billing-r2 screen 7): its figures and likely reason, then the three ways to settle
 * it — raise a credit note (a paid invoice we billed more on), record a payment (an invoice still owed), or mark it
 * explained with a note. A provider-only charge can be covered by raising a custom invoice instead. Each goes
 * through its existing route and lands in the audit log. "Explained" needs the explanations migration; until it
 * is applied the note box says so and stays shut.
 */
export function ReconSettleSheet({ row, canAct, explanationsReady, approvalThresholdCents, onClose, onPaid }: {
  row: ReconRow;
  canAct: boolean;
  explanationsReady: boolean;
  approvalThresholdCents: number;
  onClose: () => void;
  /** Mark paid… settled the invoice: the table stamps the row "Paid", then refreshes (Wave D, 2026-11-18). */
  onPaid?: (refresh: () => void) => void;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const isInvoice = row.kind === "invoice" && row.invoiceId;
  const status = row.invoiceStatus;
  const paid = status === "paid";
  const settleable = Boolean(status && status !== "paid" && status !== "void");

  async function explain() {
    setBusy(true);
    const res = await fetch("/api/admin/billing/reconciliation/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invoice_id: row.invoiceId, payment_id: row.paymentId, note: note.trim() }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      notify.block(body?.error ?? "Could not save the explanation");
      return;
    }
    notify.done(body?.message ?? "Marked explained");
    setNote("");
    onClose();
    router.refresh();
  }

  const deny = canAct ? null : "Only billing admins and super admins can settle a difference.";

  return (
    <Sheet
      title={isInvoice ? `${row.number} · ${row.tenantName}` : `Provider charge · ${row.tenantName}`}
      subtitle={isInvoice ? `Issued ${fullDate(row.at)}` : `Charged ${fullDate(row.at)}`}
      status={row.explanation ? <StatusChip tone="good" dot>Settled</StatusChip> : <StatusChip tone="danger" dot>{isInvoice ? "Doesn't match" : "No invoice"}</StatusChip>}
      actions={isInvoice
        ? <Button asChild variant="ghost" size="sm"><Link href={`/admin/invoices?invoice=${row.invoiceId}`}>Open invoice ›</Link></Button>
        : <Button asChild variant="ghost" size="sm"><Link href={`/admin/tenants/${row.tenantId}`}>{row.tenantName} ›</Link></Button>}
      onClose={onClose}
    >
      <FactTable
        rows={[
          ["We billed", formatCentsAsCurrency(row.billedCents)],
          ["Provider charged", row.chargedCents === null ? "Nothing received" : formatCentsAsCurrency(row.chargedCents)],
          ["Difference", <span key="d" className="font-semibold">{signed(row.differenceCents)}</span>],
          ["Likely reason", RECON_REASON_LABELS[row.reason]],
          ["Invoice status", status ? INVOICE_STATUS_LABELS[status] : null],
          ["Explained", row.explanation ? `${row.explanation.note}${row.explanation.explained_by_name ? ` (${row.explanation.explained_by_name}, ${fullDate(row.explanation.created_at)})` : ` (${fullDate(row.explanation.created_at)})`}` : null],
        ]}
      />

      <section aria-labelledby="settle-ways" className="flex flex-col gap-3">
        <h3 id="settle-ways" className="m-0 text-sm font-semibold text-foreground">Settle it</h3>
        {deny && <p className="m-0 text-xs text-muted-foreground">{deny}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {isInvoice && canAct && (paid ? (
            <RefundDialog
              tenantId={row.tenantId}
              invoiceId={row.invoiceId!}
              number={row.number ?? ""}
              totalCents={row.billedCents}
              defaultCents={row.differenceCents > 0 ? row.differenceCents : undefined}
              hasProviderPayment={row.hasProviderPayment}
              approvalThresholdCents={approvalThresholdCents}
              trigger={{ label: "Raise a credit note…", variant: "outline", className: "" }}
            />
          ) : (
            <span title={`Only a paid invoice can be credited; this one is ${status ? INVOICE_STATUS_LABELS[status].toLowerCase() : "not paid"}.`}><Button variant="outline" disabled>Raise a credit note…</Button></span>
          ))}
          {isInvoice && canAct && (settleable
            ? <MarkPaidDialog invoiceId={row.invoiceId!} number={row.number ?? ""} remainingCents={row.billedCents} trigger={{ label: "Mark paid…", variant: "outline", className: "" }} onPaid={onPaid} />
            : <span title={status === "void" ? "A voided invoice cannot be paid." : "Already paid in full."}><Button variant="outline" disabled>Mark paid…</Button></span>)}
          {!isInvoice && canAct && (
            <CustomInvoiceDialog tenants={[]} lockedTenant={{ id: row.tenantId, name: row.tenantName }} triggerLabel="Raise an invoice for it…" triggerSize="default" triggerVariant="outline" />
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="recon-note">Mark explained</Label>
          <textarea
            id="recon-note"
            className={textareaControl}
            value={note}
            disabled={!explanationsReady || !canAct}
            maxLength={1000}
            onChange={(event) => setNote(event.target.value)}
            placeholder={explanationsReady ? "Why the difference is fine, e.g. a goodwill discount agreed by phone" : "Needs a database update before notes can be saved"}
          />
          <p className="m-0 text-xs text-muted-foreground">
            {explanationsReady ? "Moves the row to Settled. The note and your name are kept; the audit log records it." : "Marking a row explained needs a database update that has not been applied yet. A credit note or a payment still settles it."}
          </p>
          <div className="flex justify-end">
            <Button type="button" disabled={!explanationsReady || !canAct || busy || note.trim().length < 3} onClick={() => void explain()}>Mark explained</Button>
          </div>
        </div>
      </section>
    </Sheet>
  );
}
