import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Printer, AlertTriangle } from "lucide-react";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canVoidInvoices, canViewInvoices, voidRefusalReason } from "@/lib/invoices/permissions";
import { fetchInvoiceDetail } from "@/lib/invoices/queries";
import { refundApprovalThresholdCents } from "@/lib/settings/queries";
import { AdminPageHeader } from "@/components/admin/page-header";
import { VoidInvoiceDialog } from "@/components/admin/void-invoice-dialog";
import { MarkPaidDialog } from "@/components/admin/mark-paid-dialog";
import { RefundDialog } from "@/components/admin/refund-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCentsAsCurrency } from "@/lib/money";
import { INVOICE_LINE_KIND_LABELS, INVOICE_STATUS_LABELS } from "@/lib/invoices/constants";
import { tableHeaderRow, tableHeadCell, tableShell } from "@/components/admin/table-styles";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewInvoices(admin.role)) redirect("/admin");

  const { id } = await params;
  const detail = await fetchInvoiceDetail(id);
  if (!detail) notFound();

  const { invoice, lines, events, payments, paidCents, remainingCents } = detail;
  // Resolved here rather than inside the dialog: the dialog is a client component and the
  // settings store is server-only (SA-4.1).
  const approvalThresholdCents = await refundApprovalThresholdCents();
  const settleable = invoice.status !== "paid" && invoice.status !== "void";
  const mismatched = invoice.reconciliation === "mismatched";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link
        href="/admin/invoices"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to invoices
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <AdminPageHeader title={invoice.number} subtitle={invoice.tenant_name} />
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/invoices/${invoice.id}/print`}>
              <Printer />
              Print
            </Link>
          </Button>
          {canVoidInvoices(admin.role) && settleable && (
            <MarkPaidDialog invoiceId={invoice.id} number={invoice.number} remainingCents={remainingCents} />
          )}
          {canVoidInvoices(admin.role) && invoice.status === "paid" && (
            <RefundDialog
              tenantId={invoice.tenant_id}
              invoiceId={invoice.id}
              number={invoice.number}
              totalCents={invoice.total_cents}
              hasProviderPayment={Boolean(invoice.provider_payment_id)}
              approvalThresholdCents={approvalThresholdCents}
            />
          )}
          {canVoidInvoices(admin.role) && (
            <VoidInvoiceDialog
              invoiceId={invoice.id}
              number={invoice.number}
              refusalReason={voidRefusalReason(invoice.status)}
            />
          )}
        </div>
      </div>

      {mismatched && (
        <Card className="border-[var(--color-warning)]/40">
          <CardContent className="flex gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--color-warning)]" />
            <div className="text-sm">
              <p className="font-medium text-[var(--color-warning)]">
                This invoice does not match what the customer was charged
              </p>
              <p className="mt-1 text-muted-foreground">
                Our line items total <strong>{formatCentsAsCurrency(invoice.total_cents)}</strong>, but the
                provider charged{" "}
                <strong>
                  {invoice.provider_total_cents === null
                    ? "an unknown amount"
                    : formatCentsAsCurrency(invoice.provider_total_cents)}
                </strong>
                . That is an integration fault rather than a customer problem: the card was charged the
                provider figure, not ours.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-sm text-muted-foreground">Status</p>
            <Badge variant="outline" className="mt-1">
              {INVOICE_STATUS_LABELS[invoice.status]}
            </Badge>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Total</p>
            <p className="font-medium">{formatCentsAsCurrency(invoice.total_cents)}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Issued</p>
            <p className="font-medium">
              {invoice.issued_at ? new Date(invoice.issued_at).toLocaleDateString() : "—"}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Paid</p>
            <p className="font-medium">
              {invoice.paid_at ? new Date(invoice.paid_at).toLocaleDateString() : "—"}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className={tableShell}>
        <Table>
          <TableHeader>
            <TableRow className={tableHeaderRow}>
              <TableHead className={tableHeadCell}>Kind</TableHead>
              <TableHead className={tableHeadCell}>Description</TableHead>
              <TableHead className={tableHeadCell}>Qty</TableHead>
              <TableHead className={tableHeadCell}>Included</TableHead>
              <TableHead className={tableHeadCell}>Unit</TableHead>
              <TableHead className={tableHeadCell}>Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell className="text-sm text-muted-foreground">
                  {INVOICE_LINE_KIND_LABELS[line.kind]}
                </TableCell>
                <TableCell className="font-medium">{line.label}</TableCell>
                <TableCell>{Number(line.quantity)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {line.included_qty === null ? "—" : Number(line.included_qty)}
                </TableCell>
                <TableCell>{formatCentsAsCurrency(line.unit_cents)}</TableCell>
                <TableCell className="font-medium">{formatCentsAsCurrency(line.amount_cents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Card>
        <CardContent className="ml-auto max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCentsAsCurrency(invoice.subtotal_cents)}</span>
          </div>
          {invoice.discount_cents > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Discount</span>
              <span>−{formatCentsAsCurrency(invoice.discount_cents)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tax</span>
            <span>{formatCentsAsCurrency(invoice.tax_cents)}</span>
          </div>
          <div className="flex justify-between border-t border-border pt-1.5 text-base font-bold">
            <span>Total</span>
            <span>{formatCentsAsCurrency(invoice.total_cents)}</span>
          </div>
          {paidCents > 0 && (
            <div className="flex justify-between text-[var(--color-success)]">
              <span>Paid</span>
              <span>{formatCentsAsCurrency(paidCents)}</span>
            </div>
          )}
          {remainingCents > 0 && paidCents > 0 && (
            <div className="flex justify-between font-medium text-[var(--color-warning)]">
              <span>Outstanding</span>
              <span>{formatCentsAsCurrency(remainingCents)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--color-accent-ink)]">
            Provider activity
          </h2>
          {payments.length > 0 && (
            <ul className="space-y-1 text-sm">
              {payments.map((payment) => (
                <li key={payment.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{formatCentsAsCurrency(payment.amount_cents)}</span>
                  <span className="text-muted-foreground">
                    {payment.method === "manual_bank_transfer" ? "bank transfer" : "provider"}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(payment.paid_at).toLocaleDateString()}
                  </span>
                  {payment.manual_reference && (
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{payment.manual_reference}</code>
                  )}
                </li>
              ))}
            </ul>
          )}

          {invoice.provider_payment_id && (
            <p className="text-sm">
              <span className="text-muted-foreground">Payment: </span>
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{invoice.provider_payment_id}</code>
            </p>
          )}
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No provider events recorded.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {events.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center gap-2">
                  <span className="text-muted-foreground">
                    {new Date(event.occurred_at ?? event.received_at).toLocaleString()}
                  </span>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{event.event_type}</code>
                </li>
              ))}
            </ul>
          )}
          {invoice.void_reason && (
            <p className="text-sm">
              <span className="text-muted-foreground">Voided: </span>
              {invoice.void_reason}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
