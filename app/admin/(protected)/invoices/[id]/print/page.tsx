import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import { getCurrentAdmin } from "@/lib/adminAuth/getCurrentAdmin";
import { canViewInvoices } from "@/lib/invoices/permissions";
import { fetchInvoiceDetail } from "@/lib/invoices/queries";
import { formatCentsAsCurrency } from "@/lib/money";
import { INVOICE_LINE_KIND_LABELS, INVOICE_STATUS_LABELS } from "@/lib/invoices/constants";

/**
 * SA-3.3 · The printable invoice.
 *
 * Plain HTML with print CSS rather than a generated PDF: SA-3.2 put "PDF styling beyond a plain
 * printable page" out of scope, and Ctrl+P produces the PDF anyway. It shows OUR line items, which
 * is the point — the provider's own receipt cannot show a setup fee or an add-on it never knew
 * about.
 *
 * `data-print-hide` on the app chrome (see globals.css) keeps the sidebar off the paper.
 */
export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (!canViewInvoices(admin.role)) redirect("/admin");

  const { id } = await params;
  const detail = await fetchInvoiceDetail(id);
  if (!detail) notFound();

  const { invoice, lines } = detail;

  return (
    <div className="mx-auto max-w-3xl space-y-6 bg-white p-8 text-black print:p-0">
      <div data-print-hide className="flex justify-between">
        <Link href={`/admin/invoices/${invoice.id}`} className="text-sm underline">
          Back to invoice
        </Link>
        <span className="text-sm text-neutral-500">Use your browser&apos;s Print to save as PDF</span>
      </div>

      <header className="flex items-start justify-between border-b border-neutral-300 pb-4">
        <div>
          <h1 className="text-2xl font-bold">Insurvas</h1>
          <p className="text-sm text-neutral-600">Invoice</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold">{invoice.number}</p>
          <p className="text-sm text-neutral-600">{INVOICE_STATUS_LABELS[invoice.status]}</p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-6 text-sm">
        <div>
          <p className="font-semibold text-neutral-500">Billed to</p>
          <p className="mt-1 font-medium">{invoice.tenant_name}</p>
        </div>
        <div className="text-right">
          <p className="font-semibold text-neutral-500">Issued</p>
          <p className="mt-1">{invoice.issued_at ? new Date(invoice.issued_at).toLocaleDateString() : "—"}</p>
          {invoice.period_start && invoice.period_end && (
            <>
              <p className="mt-2 font-semibold text-neutral-500">Period</p>
              <p>
                {new Date(invoice.period_start).toLocaleDateString()} –{" "}
                {new Date(invoice.period_end).toLocaleDateString()}
              </p>
            </>
          )}
        </div>
      </section>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-300 text-left">
            <th className="py-2 font-semibold">Description</th>
            <th className="py-2 text-right font-semibold">Qty</th>
            <th className="py-2 text-right font-semibold">Unit</th>
            <th className="py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-b border-neutral-200">
              <td className="py-2">
                {line.label}
                <span className="ml-2 text-xs text-neutral-500">{INVOICE_LINE_KIND_LABELS[line.kind]}</span>
                {line.included_qty !== null && (
                  <span className="ml-2 text-xs text-neutral-500">
                    ({Number(line.included_qty)} included)
                  </span>
                )}
              </td>
              <td className="py-2 text-right">{Number(line.quantity)}</td>
              <td className="py-2 text-right">{formatCentsAsCurrency(line.unit_cents)}</td>
              <td className="py-2 text-right">{formatCentsAsCurrency(line.amount_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="ml-auto max-w-xs space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-neutral-600">Subtotal</span>
          <span>{formatCentsAsCurrency(invoice.subtotal_cents)}</span>
        </div>
        {invoice.discount_cents > 0 && (
          <div className="flex justify-between">
            <span className="text-neutral-600">Discount</span>
            <span>−{formatCentsAsCurrency(invoice.discount_cents)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-neutral-600">Tax</span>
          <span>{formatCentsAsCurrency(invoice.tax_cents)}</span>
        </div>
        <div className="flex justify-between border-t border-neutral-400 pt-1 text-base font-bold">
          <span>Total</span>
          <span>{formatCentsAsCurrency(invoice.total_cents)}</span>
        </div>
      </section>

      {invoice.status === "void" && (
        <p className="text-sm font-bold uppercase tracking-widest text-neutral-400">
          Void{invoice.void_reason ? ` — ${invoice.void_reason}` : ""}
        </p>
      )}
    </div>
  );
}
