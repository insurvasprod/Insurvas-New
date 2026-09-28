"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { BoardStatGrid, BoardStatTile } from "@/components/admin/board-stat-tile";
import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { StatusChip, invoiceTone } from "@/components/admin/status-chip";
import { fullDate } from "@/components/admin/tenant-record/billing-format";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { formatCentsAsCurrency } from "@/lib/money";
import { INVOICE_STATUSES, INVOICE_STATUS_LABELS, type InvoiceStatus } from "@/lib/invoices/constants";
import type { InvoiceListRow, InvoiceTotals } from "@/lib/invoices/queries";
import { cn } from "@/lib/utils";

const PAGE = 25;
type Lens = "all" | "overdue" | "mismatched";

const th = "px-3 py-2 text-left text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";
const td = "border-t border-[var(--border)] px-3 py-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]";

/** Whole days past due, measured against the moment the page was rendered (passed in, so the server and the browser agree). */
function daysOverdue(dueAt: string | null, status: InvoiceStatus, now: number): number | null {
  if (!dueAt || status === "paid" || status === "void") return null;
  const days = Math.floor((now - new Date(dueAt).getTime()) / 86_400_000);
  return days > 0 ? days : null;
}

/**
 * The invoices board (p-adm-invoices): the figure strip, then one TableCard with its toolbar inside.
 *
 * Mismatched leads the strip: "we billed a different amount to the one the customer was charged"
 * is the one figure that carries information, so it is coloured while it is above zero and offers
 * a way straight to those rows.
 *
 * Filtering happens here, over the rows the page read once (the same rows the figures come from),
 * so a filter and the figure it corresponds to cannot disagree.
 */
export function InvoicesTable({
  initialInvoices,
  totals,
  invoicedThisMonthCount,
  tenants,
  now,
}: {
  initialInvoices: InvoiceListRow[];
  totals: InvoiceTotals;
  invoicedThisMonthCount: number;
  tenants: { id: string; name: string }[];
  now: number;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [tenant, setTenant] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | InvoiceStatus>("all");
  const [lens, setLens] = useState<Lens>("all");
  const [page, setPage] = useState(1);

  const needle = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      initialInvoices.filter((invoice) =>
        (!tenant || invoice.tenant_id === tenant)
        && (status === "all" || invoice.status === status)
        && (lens !== "overdue" || invoice.status === "overdue")
        && (lens !== "mismatched" || invoice.reconciliation === "mismatched")
        && (!needle || invoice.number.toLowerCase().includes(needle) || invoice.tenant_name.toLowerCase().includes(needle))),
    [initialInvoices, tenant, status, lens, needle],
  );
  const anyFilter = Boolean(tenant || needle || status !== "all" || lens !== "all");
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * PAGE, current * PAGE);

  const collectedShare = totals.invoicedThisMonthCents > 0
    ? `${((totals.collectedThisMonthCents / totals.invoicedThisMonthCents) * 100).toFixed(1)}%`
    : "nothing invoiced yet";

  function reset() { setTenant(""); setQuery(""); setStatus("all"); setLens("all"); setPage(1); }
  function showMismatched() { setTenant(""); setQuery(""); setStatus("all"); setLens("mismatched"); setPage(1); }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <BoardStatGrid>
        <StatTile
          label="Mismatched"
          value={totals.mismatchedCount.toLocaleString()}
          valueTone={totals.mismatchedCount > 0 ? "danger" : undefined}
          labelTitle="We billed a different amount to the one the customer was charged — often a coupon or offer applied here but not to the membership in Whop."
          footnote={totals.mismatchedCount > 0 ? "billed ≠ charged" : "every invoice matches"}
          action={totals.mismatchedCount > 0 ? (
            <button type="button" onClick={showMismatched} className="inline-flex items-center gap-1 font-semibold text-[var(--ink)] hover:underline">
              Show<ArrowRight className="size-3" aria-hidden />
            </button>
          ) : undefined}
        />
        <BoardStatTile label="Invoiced this month" value={formatCentsAsCurrency(totals.invoicedThisMonthCents)} footnote={`${invoicedThisMonthCount.toLocaleString()} ${invoicedThisMonthCount === 1 ? "invoice" : "invoices"}`} />
        <BoardStatTile label="Collected this month" value={formatCentsAsCurrency(totals.collectedThisMonthCents)} footnote={collectedShare} />
        <BoardStatTile label="Overdue" value={totals.overdueCount.toLocaleString()} footnote="structurally rare" tone={totals.overdueCount > 0 ? "warning" : "default"} />
      </BoardStatGrid>

      <TableCard
        className="min-w-0"
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
            <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Search invoice, tenant" />
            <select aria-label="Tenant" value={tenant} onChange={(event) => { setTenant(event.target.value); setPage(1); }} className={cn(toolbarControl, "max-w-56")}>
              <option value="">All tenants</option>
              {tenants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <select aria-label="Status" value={status} onChange={(event) => { setStatus(event.target.value as "all" | InvoiceStatus); setPage(1); }} className={toolbarControl}>
              <option value="all">All statuses</option>
              {INVOICE_STATUSES.map((value) => <option key={value} value={value}>{INVOICE_STATUS_LABELS[value]}</option>)}
            </select>
            <select aria-label="Show" value={lens} onChange={(event) => { setLens(event.target.value as Lens); setPage(1); }} className={toolbarControl}>
              <option value="all">Everything</option>
              <option value="overdue">Overdue only</option>
              <option value="mismatched">Mismatched only</option>
            </select>
            {anyFilter && <Button type="button" variant="ghost" onClick={reset}>Clear</Button>}
          </DataToolbar>
        }
      >
        <table className="w-full min-w-[860px] border-collapse">
          <thead>
            <tr className="bg-[var(--surface-alt)]">
              <th scope="col" className={cn(th, "w-[210px]")}>Invoice</th>
              <th scope="col" className={th}>Tenant</th>
              <th scope="col" className={cn(th, "w-[130px]")}>Issued</th>
              <th scope="col" className={cn(th, "w-[130px]")}>Due</th>
              <th scope="col" className={cn(th, "w-[150px] text-right")}>Total</th>
              <th scope="col" className={cn(th, "w-[190px]")}>Status</th>
              <th scope="col" className={cn(th, "w-[90px] text-right")}><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-0">
                  {/* An empty list and a filtered-out list look identical and mean the opposite. */}
                  {anyFilter ? <NoMatches noun="invoices" onClear={reset} /> : (
                    <EmptyState title="No invoices yet" hint="Invoices appear here when a payment is collected or one is raised by hand." />
                  )}
                </td>
              </tr>
            ) : shown.map((invoice) => {
              const late = daysOverdue(invoice.due_at, invoice.status, now);
              const mismatched = invoice.reconciliation === "mismatched";
              return (
                <tr key={invoice.id} className={cn("hover:bg-[color-mix(in_srgb,var(--primary),transparent_95%)]", mismatched && "bg-[var(--brand-50)]")}>
                  <td className={cn(td, "font-semibold text-[var(--ink)] tabular-nums")}><Link href={`/admin/invoices/${invoice.id}`} className="hover:underline">{invoice.number}</Link></td>
                  <td className={td}>{invoice.tenant_name}</td>
                  <td className={cn(td, "whitespace-nowrap tabular-nums")}>{fullDate(invoice.issued_at)}</td>
                  <td className={cn(td, "whitespace-nowrap tabular-nums")}>{fullDate(invoice.due_at)}</td>
                  <td className={cn(td, "whitespace-nowrap text-right tabular-nums")}>
                    <span className="font-semibold text-[var(--ink)]">{formatCentsAsCurrency(invoice.total_cents)}</span>
                    {mismatched && <span className="block text-[12px] text-[var(--error-ink)]">charged {invoice.provider_total_cents === null ? "unknown" : formatCentsAsCurrency(invoice.provider_total_cents)}</span>}
                  </td>
                  <td className={td}>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {/* A voided invoice keeps its strike-through: closed correctly rather than unpaid. */}
                      <StatusChip tone={invoiceTone(invoice.status)} dot>
                        <span className={invoice.status === "void" ? "line-through" : undefined}>
                          {invoice.status === "overdue" && late ? `Overdue ${late} ${late === 1 ? "day" : "days"}` : INVOICE_STATUS_LABELS[invoice.status]}
                        </span>
                      </StatusChip>
                      {mismatched && <StatusChip tone="danger" dot>Mismatched</StatusChip>}
                    </span>
                  </td>
                  <td className={cn(td, "text-right")}>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/invoices/${invoice.id}`} aria-label={`View ${invoice.number}`}>View</Link>
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > 0 && <BoardTableFooter page={current} pageSize={PAGE} total={rows.length} itemLabel={rows.length === 1 ? "invoice" : "invoices"} order="by number, newest first" onPageChange={setPage} />}
      </TableCard>
    </div>
  );
}
