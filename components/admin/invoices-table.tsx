"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCentsAsCurrency } from "@/lib/money";
import { INVOICE_STATUSES, INVOICE_STATUS_LABELS, type InvoiceStatus } from "@/lib/invoices/constants";
import type { InvoiceListRow } from "@/lib/invoices/queries";
import { tableHeaderRow, tableHeadCell, tableShell } from "./table-styles";
import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { StatusChip, invoiceTone } from "@/components/admin/status-chip";


function daysOverdue(dueAt: string | null, status: InvoiceStatus): number | null {
  if (!dueAt || status === "paid" || status === "void") return null;
  const days = Math.floor((Date.now() - new Date(dueAt).getTime()) / 86_400_000);
  return days > 0 ? days : null;
}

export function InvoicesTable({ initialInvoices }: { initialInvoices: InvoiceListRow[] }) {
  const [invoices, setInvoices] = useState(initialInvoices);
  const [status, setStatus] = useState<"all" | InvoiceStatus>("all");
  const [lens, setLens] = useState<"all" | "overdue" | "mismatched">("all");
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }

    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (lens === "overdue") params.set("overdue", "true");
    if (lens === "mismatched") params.set("mismatched", "true");

    let cancelled = false;
    fetch(`/api/admin/invoices?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled && body) setInvoices(body.invoices);
      });

    return () => {
      cancelled = true;
    };
  }, [status, lens]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={status} onValueChange={(v) => setStatus(v as "all" | InvoiceStatus)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {INVOICE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {INVOICE_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={lens} onValueChange={(v) => setLens(v as "all" | "overdue" | "mismatched")}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everything</SelectItem>
            <SelectItem value="overdue">Overdue only</SelectItem>
            <SelectItem value="mismatched">Mismatched only</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground">
          {invoices.length} invoice{invoices.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className={tableShell}>
        <Table>
          <TableHeader>
            <TableRow className={tableHeaderRow}>
              <TableHead className={tableHeadCell}>Number</TableHead>
              <TableHead className={tableHeadCell}>Tenant</TableHead>
              <TableHead className={tableHeadCell}>Amount</TableHead>
              <TableHead className={tableHeadCell}>Status</TableHead>
              <TableHead className={tableHeadCell}>Issued</TableHead>
              <TableHead className={tableHeadCell}>Due</TableHead>
              <TableHead className={tableHeadCell}>Overdue</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="p-0">
                  {/* An empty list and a filtered-out list look identical and mean the opposite.
                      Telling someone to raise their first invoice when they have two hundred and a
                      status filter set is worse than saying nothing. */}
                  {status === "all" && lens === "all" ? (
                    <EmptyState
                      title="No invoices yet"
                      hint="An invoice is created automatically when a payment is collected, and by hand for anything else. Nothing has been billed on this platform so far."
                    />
                  ) : (
                    <NoMatches
                      noun="invoices"
                      onClear={() => { setStatus("all"); setLens("all"); }}
                    />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              invoices.map((invoice) => {
                const late = daysOverdue(invoice.due_at, invoice.status);
                return (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium">
                      <Link href={`/admin/invoices/${invoice.id}`} className="hover:underline">
                        {invoice.number}
                      </Link>
                    </TableCell>
                    <TableCell>{invoice.tenant_name}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="font-medium">{formatCentsAsCurrency(invoice.total_cents)}</span>
                      {invoice.reconciliation === "mismatched" && (
                        <span
                          className="ml-2 inline-flex items-center gap-1 text-xs text-[var(--color-warning)]"
                          title={`We billed ${formatCentsAsCurrency(invoice.total_cents)} but the provider charged ${
                            invoice.provider_total_cents === null
                              ? "an unknown amount"
                              : formatCentsAsCurrency(invoice.provider_total_cents)
                          }`}
                        >
                          <AlertTriangle className="size-3.5" />
                          {invoice.provider_total_cents !== null &&
                            formatCentsAsCurrency(invoice.provider_total_cents)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {/* A voided invoice keeps its strike-through: it is closed correctly rather
                          than unpaid, and the line says so faster than the word does. */}
                      <StatusChip tone={invoiceTone(invoice.status)} dot>
                        <span className={invoice.status === "void" ? "line-through" : undefined}>
                          {INVOICE_STATUS_LABELS[invoice.status]}
                        </span>
                      </StatusChip>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {invoice.issued_at ? new Date(invoice.issued_at).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {invoice.due_at ? new Date(invoice.due_at).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {late === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="font-medium text-[var(--color-warning)]">{late}d</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
