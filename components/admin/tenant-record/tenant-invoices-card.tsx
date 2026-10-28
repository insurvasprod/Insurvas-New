"use client";

import { StatusChip } from "@/components/ui/status-chip";
import Link from "next/link";
import { useState } from "react";

import { CustomInvoiceDialog } from "@/components/admin/custom-invoice-dialog";
import { st, type PillTone, pillTone } from "@/components/app/settings/primitives";
import { buttonVariants } from "@/components/ui/button";
import { TableCard } from "@/components/ui/table-card";
import { Pager, paginate } from "@/components/ui/pager";
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from "@/lib/invoices/constants";
import { formatCentsAsCurrency } from "@/lib/money";
import type { TenantInvoiceRow } from "@/lib/subscriptions/tenantBilling";
import { periodRange, shortDate } from "./billing-format";

const STATUS_TONE: Record<InvoiceStatus, PillTone> = {
  draft: "neutral",
  issued: "info",
  paid: "success",
  overdue: "error",
  void: "neutral",
  uncollectible: "error",
};

/** A refund that went through outranks the invoice's own status: the money came back. */
function stateOf(row: TenantInvoiceRow): { label: string; tone: PillTone } {
  if (row.refundedCents > 0 && row.refundedCents < row.totalCents) return { label: "Refunded in part", tone: "warning" };
  if (row.refundedCents > 0) return { label: "Refunded", tone: "neutral" };
  return { label: INVOICE_STATUS_LABELS[row.status], tone: STATUS_TONE[row.status] };
}

/** The board's Invoices card: this tenant's invoices, newest first, and issuing one by hand. */
export function TenantInvoicesCard({
  tenant,
  invoices,
}: {
  tenant: { id: string; name: string };
  invoices: TenantInvoiceRow[];
}) {
  const now = new Date();
  const [page, setPage] = useState(1);
  const { current, rows: pageRows } = paginate(invoices, page);
  return (
    <TableCard
      title="Invoices"
      footer={<Pager page={current} total={invoices.length} noun="invoices" onPage={setPage} />}
      action={
        <CustomInvoiceDialog
          tenants={[tenant]}
          lockedTenant={tenant}
          triggerLabel="Issue an invoice"
          triggerClassName={buttonVariants({ variant: "outline" })}
        />
      }
    >
      <table className={st.table}>
        <thead>
          <tr className={st.headRow}>
            <th scope="col" className={`${st.th} w-[190px]`}>Invoice</th>
            <th scope="col" className={`${st.th} w-[230px]`}>Period</th>
            <th scope="col" className={`${st.th} w-[150px]`}>Amount</th>
            <th scope="col" className={`${st.th} w-[170px]`}>State</th>
            <th scope="col" className={`${st.th} w-[160px]`}>Paid</th>
            <th scope="col" className={`${st.th} w-[120px]`}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="m-seq">
          {invoices.length === 0 ? (
            <tr>
              <td colSpan={6} className={st.td}>
                <span className={st.strong}>No invoices yet</span>
                <span className={st.sub}>Charged periods and invoices issued by hand appear here.</span>
              </td>
            </tr>
          ) : (
            pageRows.map((row) => {
              const state = stateOf(row);
              return (
                <tr key={row.id} className="m-row">
                  <td className={st.td}>{row.number}</td>
                  <td className={st.td}>{periodRange(row.periodStart, row.periodEnd, now)}</td>
                  <td className={`${st.td} tabular-nums`}>{formatCentsAsCurrency(row.totalCents)}</td>
                  <td className={st.td}>
                    <StatusChip dot={false} tone={pillTone(state.tone)}>{state.label}</StatusChip>
                  </td>
                  <td className={st.td}>{shortDate(row.paidAt, now)}</td>
                  <td className={st.td}>
                    <Link href={`/admin/invoices/${row.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })} aria-label={`Open ${row.number}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </TableCard>
  );
}
