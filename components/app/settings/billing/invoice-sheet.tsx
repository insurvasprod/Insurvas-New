"use client";

import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { SectionLoading } from "@/components/ui/page-states";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCentsAsCurrency } from "@/lib/money";

import { INVOICE_LABEL, SUPPORT_EMAIL, day, short, type Invoice, type InvoiceDoc } from "./types";

export const INVOICE_TONE: Record<string, StatusTone> = { paid: "good", issued: "info", overdue: "danger", uncollectible: "danger", void: "neutral" };

/**
 * A7 · One invoice, read in a sheet: the same document /app/billing/invoices/[id] prints, which
 * "Download PDF" opens (print, or save as PDF). An unpaid one with a payment link offers Pay.
 */
export function InvoiceSheet({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const [doc, setDoc] = useState<InvoiceDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetch(`/api/app/billing?invoice=${encodeURIComponent(invoice.id)}`, { cache: "no-store" }).then(async (res) => {
      const body = await res.json().catch(() => null);
      if (!live) return;
      if (!res.ok) { setError(body?.error ?? "The invoice could not be loaded"); return; }
      setDoc(body);
    });
    return () => { live = false; };
  }, [invoice.id]);

  const payable = invoice.payOnlineUrl && (invoice.status === "issued" || invoice.status === "overdue");
  return (
    <Sheet
      title={`Invoice ${invoice.number}`}
      status={<StatusChip tone={INVOICE_TONE[invoice.status] ?? "neutral"}>{INVOICE_LABEL[invoice.status] ?? invoice.status}</StatusChip>}
      onClose={onClose}
      className="lg:w-[640px]"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button asChild variant="outline"><a href={`/app/billing/invoices/${invoice.id}`} target="_blank" rel="noopener noreferrer">Download PDF<ExternalLink aria-hidden="true" /></a></Button>
          {payable ? <Button asChild><a href={invoice.payOnlineUrl!} target="_blank" rel="noopener noreferrer">Pay {formatCentsAsCurrency(invoice.totalCents)}</a></Button> : null}
          <Button type="button" variant={payable ? "ghost" : "default"} onClick={onClose}>Done</Button>
        </div>
      }
    >
      {error ? <p role="alert" className="m-0 text-sm text-[var(--error-ink)]">{error}</p> : !doc ? (
        <SectionLoading rows={5} columns={3} label="Opening the invoice" />
      ) : (
        <article className="flex flex-col gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--color-card)] p-5 text-xs text-[var(--body)]">
          <header className="flex items-start gap-3 border-b-2 border-[var(--ink)] pb-3">
            <div>
              <strong className="block text-base font-semibold text-[var(--ink)]">Insurvas</strong>
              {SUPPORT_EMAIL}
            </div>
            <div className="ml-auto text-right tabular-nums">
              Issued {day(doc.issuedAt)}<br />
              {doc.paidAt ? `Paid ${day(doc.paidAt)}` : doc.status !== "void" ? `Due ${day(doc.dueAt)}` : "Void"}
            </div>
          </header>
          <div>
            <strong className="text-[var(--ink)]">Billed to</strong><br />
            {doc.billedTo}{doc.billedAddress ? <><br />{doc.billedAddress}</> : null}
          </div>
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {doc.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-[var(--ink)]">{l.label}{l.quantity !== 1 ? ` × ${l.quantity.toLocaleString("en-US")}` : ""} <span className="text-[var(--muted)]">· {l.kind}</span></TableCell>
                  <TableCell className="tabular-nums">{doc.periodStart ? `${short(doc.periodStart)} – ${short(doc.periodEnd)}` : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCentsAsCurrency(l.amountCents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <dl className="m-0 ml-auto grid grid-cols-[auto_110px] justify-items-end gap-x-3 gap-y-1 tabular-nums">
            <dt>Subtotal</dt><dd className="m-0">{formatCentsAsCurrency(doc.subtotalCents)}</dd>
            {doc.discountCents > 0 ? <><dt>Discount</dt><dd className="m-0">−{formatCentsAsCurrency(doc.discountCents)}</dd></> : null}
            <dt>Tax</dt><dd className="m-0">{formatCentsAsCurrency(doc.taxCents)}</dd>
            <dt className="text-sm font-semibold text-[var(--ink)]">{doc.status === "paid" ? "Total paid" : "Total"}</dt>
            <dd className="m-0 text-sm font-semibold text-[var(--ink)]">{formatCentsAsCurrency(doc.totalCents)}</dd>
          </dl>
        </article>
      )}
    </Sheet>
  );
}
