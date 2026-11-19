"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, ChevronRight, Download } from "lucide-react";

import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { StatusChip, invoiceTone } from "@/components/admin/status-chip";
import { fullDate } from "@/components/admin/tenant-record/billing-format";
import { datedName, saveCsv } from "@/components/admin/billing/inv-download";
import { BulkBar, RowCheckbox, SelectAllCheckbox, useRowSelection } from "@/components/ui/bulk-bar";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { formatCentsAsCurrency } from "@/lib/money";
import { INVOICE_STATUSES, INVOICE_STATUS_LABELS, type InvoiceStatus } from "@/lib/invoices/constants";
import {
  DEFAULT_INVOICE_VIEW, INVOICE_LENSES, INVOICE_LENS_LABELS, ISSUED_WINDOWS, ISSUED_WINDOW_LABELS, OVERDUE_AGES, OVERDUE_AGE_LABELS,
  daysOverdue, filterInvoices, hasAnyFilter, invoiceViewParams, invoicesCsv, matchesFilters, matchesLens, overdueAgeCounts, parseInvoiceView,
  type InvoiceLens, type InvoiceView, type IssuedWindow, type OverdueAge,
} from "@/lib/invoices/listView";
import type { InvoiceListRow, InvoiceTotals } from "@/lib/invoices/queries";
import { cn } from "@/lib/utils";

const th = "px-3 py-2 text-left text-xs leading-[1.33] font-semibold text-[var(--muted)]";
const td = "border-t border-[var(--border)] px-3 py-2 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--body)]";

/**
 * The invoices board (p-adm-invoices, billing-r2 screen 5): the figure strip, then one TableCard with its toolbar.
 *
 * Every filter is in the address (lib/invoices/listView.ts): the lens (All · Overdue · Don't match), search,
 * customer, status, the Issued window and the overdue age. A link from the Billing workspace lands on that
 * list, and changing a filter rewrites the address in place (no round trip). A row opens its invoice as a
 * wide sheet (`?invoice=<id>`), drawn on the server over this list, so the filters survive opening and closing.
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
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const [page, setPage] = useState(1);
  // The address is the one source of the view: setParamsInPlace rewrites it and useSearchParams follows.
  const view = parseInvoiceView(params);
  const openId = params.get("invoice");

  function change(patch: Partial<InvoiceView>) {
    const next = { ...view, ...patch };
    if (patch.lens && patch.lens !== "overdue") next.age = "any";
    setPage(1);
    setParamsInPlace(invoiceViewParams(next));
  }
  const reset = () => change({ ...DEFAULT_INVOICE_VIEW });

  const rows = useMemo(() => filterInvoices(initialInvoices, view, now), [initialInvoices, view, now]);
  const lensCounts = useMemo(() => {
    const base = initialInvoices.filter((invoice) => matchesFilters(invoice, view, now));
    return Object.fromEntries(INVOICE_LENSES.map((lens) => [lens, base.filter((invoice) => matchesLens(invoice, lens, "any", now)).length])) as Record<InvoiceLens, number>;
  }, [initialInvoices, view, now]);
  const ages = useMemo(() => overdueAgeCounts(initialInvoices, now), [initialInvoices, now]);
  const anyFilter = hasAnyFilter(view);
  const pageSize = useFittingPageSize(480, 45);
  const { current, rows: shown } = paginate(rows, page, pageSize);
  const selection = useRowSelection(rows.map((row) => row.id));

  const collectedShare = totals.invoicedThisMonthCents > 0
    ? `${((totals.collectedThisMonthCents / totals.invoicedThisMonthCents) * 100).toFixed(1)}% of invoiced`
    : "nothing invoiced yet";

  /** The row's sheet: the current address plus `invoice=<id>`, so closing it comes back to this exact list. */
  const sheetHref = (id: string) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(invoiceViewParams(view))) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.set("invoice", id);
    return `/admin/invoices?${next.toString()}`;
  };
  const open = (id: string) => router.push(sheetHref(id), { scroll: false });
  const exportRows = (list: InvoiceListRow[]) => saveCsv(datedName("invoices"), invoicesCsv(list, now));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <StatStrip label="Invoice totals">
        <StatTile label="Invoiced this month" value={formatCentsAsCurrency(totals.invoicedThisMonthCents)} footnote={`${invoicedThisMonthCount.toLocaleString()} ${invoicedThisMonthCount === 1 ? "invoice" : "invoices"}`} />
        <StatTile label="Collected this month" value={formatCentsAsCurrency(totals.collectedThisMonthCents)} footnote={collectedShare} />
        <StatTile
          label="Overdue"
          value={totals.overdueCount.toLocaleString()}
          footnote={totals.overdueCount > 0 ? OVERDUE_AGES.map((age, i) => `${i === 0 ? OVERDUE_AGE_LABELS[age] : OVERDUE_AGE_LABELS[age].replace(" days", "")} ${ages[age]}`).join(" · ") : "none overdue"}
          action={totals.overdueCount > 0 ? (
            <button type="button" onClick={() => change({ lens: "overdue", age: "any" })} className="inline-flex items-center gap-1 font-semibold text-[var(--ink)] hover:underline">
              Show<ArrowRight className="size-3" aria-hidden />
            </button>
          ) : undefined}
        />
        <StatTile
          label="Don't match"
          value={totals.mismatchedCount.toLocaleString()}
          labelTitle="We billed a different amount to the one the customer was charged — often a coupon or offer applied here but not to the membership in Whop."
          footnote={totals.mismatchedCount > 0 ? "billed ≠ charged" : "every invoice matches"}
          action={totals.mismatchedCount > 0 ? (
            <button type="button" onClick={() => change({ lens: "mismatched" })} className="inline-flex items-center gap-1 font-semibold text-[var(--ink)] hover:underline">
              Show<ArrowRight className="size-3" aria-hidden />
            </button>
          ) : undefined}
        />
      </StatStrip>

      <TableCard
        className="min-w-0"
        footer={rows.length ? <Pager page={current} pageSize={pageSize} total={rows.length} noun={rows.length === 1 ? "invoice" : "invoices"} suffix="by number, newest first" onPage={setPage} /> : undefined}
        toolbar={
          <DataToolbar
            actions={<>
              <Button type="button" variant="outline" disabled={!rows.length} onClick={() => exportRows(rows)}><Download aria-hidden="true" />Export</Button>
              <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
            </>}
          >
            <div role="radiogroup" aria-label="Show" className="flex flex-wrap items-center gap-2">
              {INVOICE_LENSES.map((lens) => (
                <ToggleChip key={lens} role="radio" selected={view.lens === lens} count={lensCounts[lens]} onClick={() => change({ lens })}>{INVOICE_LENS_LABELS[lens]}</ToggleChip>
              ))}
            </div>
            <ToolbarSearch value={view.q} onChange={(q) => change({ q })} placeholder="Search invoice or customer" />
            <select aria-label="Customer" value={view.tenant} onChange={(event) => change({ tenant: event.target.value })} className={cn(toolbarControl, "max-w-56")}>
              <option value="">All customers</option>
              {tenants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <select aria-label="Status" value={view.status} onChange={(event) => change({ status: event.target.value as "all" | InvoiceStatus })} className={toolbarControl}>
              <option value="all">All statuses</option>
              {INVOICE_STATUSES.map((value) => <option key={value} value={value}>{INVOICE_STATUS_LABELS[value]}</option>)}
            </select>
            <select aria-label="Issued" value={view.issued} onChange={(event) => change({ issued: event.target.value as IssuedWindow | "any" })} className={toolbarControl}>
              <option value="any">Issued any time</option>
              {ISSUED_WINDOWS.map((value) => <option key={value} value={value}>{ISSUED_WINDOW_LABELS[value]}</option>)}
            </select>
            {view.lens === "overdue" && (
              <select aria-label="Overdue by" value={view.age} onChange={(event) => change({ age: event.target.value as OverdueAge | "any" })} className={toolbarControl}>
                <option value="any">Any age</option>
                {OVERDUE_AGES.map((value) => <option key={value} value={value}>{OVERDUE_AGE_LABELS[value]} · {ages[value]}</option>)}
              </select>
            )}
            {anyFilter && <Button type="button" variant="ghost" onClick={reset}>Clear</Button>}
          </DataToolbar>
        }
      >
        <BulkBar
          count={selection.count}
          noun={["invoice", "invoices"]}
          onClear={selection.clear}
          selectAll={<SelectAllCheckbox selection={selection} ids={shown.map((row) => row.id)} />}
          actions={<Button type="button" variant="outline" onClick={() => exportRows(rows.filter((row) => selection.isSelected(row.id)))}><Download aria-hidden="true" />Export CSV</Button>}
        />
        <table className="w-full min-w-[820px] border-collapse">
          <thead>
            <tr className="bg-[var(--surface-alt)]">
              <th scope="col" className={cn(th, "w-[44px]")}><SelectAllCheckbox selection={selection} ids={shown.map((row) => row.id)} /></th>
              <th scope="col" className={cn(th, "w-[170px]")}>Invoice</th>
              <th scope="col" className={th}>Customer</th>
              <th scope="col" className={cn(th, "w-[110px]")}>Issued</th>
              <th scope="col" className={cn(th, "w-[110px]")}>Due</th>
              <th scope="col" className={cn(th, "w-[180px] text-right")}>Total</th>
              <th scope="col" className={cn(th, "w-[140px]")}>Status</th>
              <th scope="col" className={cn(th, "w-[44px]")}><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-0">
                  {/* An empty list and a filtered-out list look identical and mean the opposite. */}
                  {anyFilter ? <NoMatches noun="invoices" onClear={reset} /> : (
                    <EmptyState title="No invoices yet" hint="Invoices appear here when a payment is collected or one is raised by hand." />
                  )}
                </td>
              </tr>
            ) : shown.map((invoice) => {
              const late = daysOverdue(invoice, now);
              const mismatched = invoice.reconciliation === "mismatched";
              const overdue = invoice.status === "overdue" && late;
              return (
                <tr
                  key={invoice.id}
                  onClick={() => open(invoice.id)}
                  aria-selected={openId === invoice.id || undefined}
                  className={cn("cursor-pointer hover:bg-[var(--surface-alt)]", openId === invoice.id && "bg-[var(--primary-soft)]")}
                >
                  <td className={td}><RowCheckbox selection={selection} id={invoice.id} label={`Select ${invoice.number}`} /></td>
                  <td className={cn(td, "whitespace-nowrap font-semibold text-[var(--ink)] tabular-nums")}>
                    <Link href={sheetHref(invoice.id)} scroll={false} onClick={(event) => event.stopPropagation()} className="hover:underline">{invoice.number}</Link>
                  </td>
                  <td className={cn(td, "max-w-[280px] truncate")}>{invoice.tenant_name}</td>
                  <td className={cn(td, "whitespace-nowrap tabular-nums")}>{fullDate(invoice.issued_at)}</td>
                  <td className={cn(td, "whitespace-nowrap tabular-nums")}>{fullDate(invoice.due_at)}</td>
                  <td className={cn(td, "whitespace-nowrap text-right tabular-nums")}>
                    <span className="font-semibold text-[var(--ink)]">{formatCentsAsCurrency(invoice.total_cents)}</span>
                    {mismatched && <span className="ml-1.5 text-xs text-[var(--muted)]">charged {invoice.provider_total_cents === null ? "unknown" : formatCentsAsCurrency(invoice.provider_total_cents)}</span>}
                  </td>
                  <td className={cn(td, "whitespace-nowrap")}>
                    {/* One chip a row: days late first (money owed), then a mismatch, else the status. A voided
                        invoice keeps its strike-through: closed correctly rather than unpaid. */}
                    {overdue ? (
                      <StatusChip tone="warning" dot>{late} {late === 1 ? "day" : "days"} late</StatusChip>
                    ) : mismatched ? (
                      <StatusChip tone="danger" dot>Doesn&apos;t match</StatusChip>
                    ) : (
                      <StatusChip tone={invoiceTone(invoice.status)} dot>
                        <span className={invoice.status === "void" ? "line-through" : undefined}>{INVOICE_STATUS_LABELS[invoice.status]}</span>
                      </StatusChip>
                    )}
                  </td>
                  <td className={cn(td, "text-right text-[var(--muted)]")}><ChevronRight className="ml-auto size-4" aria-hidden="true" /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableCard>
    </div>
  );
}
