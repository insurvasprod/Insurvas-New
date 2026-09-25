"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Search, SlidersHorizontal } from "lucide-react";

import { BoardStatGrid, BoardStatTile } from "@/components/admin/board-stat-tile";
import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { StatusChip, invoiceTone } from "@/components/admin/status-chip";
import { fullDate } from "@/components/admin/tenant-record/billing-format";
import { formatCentsAsCurrency } from "@/lib/money";
import { INVOICE_STATUSES, INVOICE_STATUS_LABELS, type InvoiceStatus } from "@/lib/invoices/constants";
import type { InvoiceListRow, InvoiceTotals } from "@/lib/invoices/queries";
import { cn } from "@/lib/utils";

const PAGE = 25;
type Lens = "all" | "overdue" | "mismatched";

const control =
  "h-10 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";
const th = "px-3 py-2 text-left text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]";
const td = "border-t border-[var(--border)] px-3 py-2 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]";

/** Whole days past due, measured against the moment the page was rendered (passed in, so the server and the browser agree). */
function daysOverdue(dueAt: string | null, status: InvoiceStatus, now: number): number | null {
  if (!dueAt || status === "paid" || status === "void") return null;
  const days = Math.floor((now - new Date(dueAt).getTime()) / 86_400_000);
  return days > 0 ? days : null;
}

/**
 * The invoices board (p-adm-invoices): the four figures, one control bar, and the table.
 *
 * Mismatched leads the strip rather than sitting third of four. Outstanding and overdue are
 * structurally near zero because the provider collects before we hear about it; "we billed a
 * different amount to the one the customer was charged" is the one figure that carries information,
 * so it gets the wider, coloured tile — coloured only while it is above zero.
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
  const [tenant, setTenant] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | InvoiceStatus>("all");
  const [lens, setLens] = useState<Lens>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const filterCount = (status !== "all" ? 1 : 0) + (lens !== "all" ? 1 : 0);
  const anyFilter = Boolean(tenant || needle || filterCount);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages);
  const shown = rows.slice((current - 1) * PAGE, current * PAGE);

  const collectedShare = totals.invoicedThisMonthCents > 0
    ? `${((totals.collectedThisMonthCents / totals.invoicedThisMonthCents) * 100).toFixed(1)}%`
    : "nothing invoiced yet";

  function reset() { setTenant(""); setQuery(""); setStatus("all"); setLens("all"); setPage(1); }
  function showMismatched() { setTenant(""); setQuery(""); setStatus("all"); setLens("mismatched"); setPage(1); setFiltersOpen(true); }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <BoardStatGrid className="xl:grid-cols-[1.2fr_1fr_1fr_1fr]">
        {totals.mismatchedCount > 0 ? (
          <div className="min-w-0 rounded-[12px] border-[1.5px] border-[var(--error)] bg-[var(--error-surface)] px-[18px] py-4">
            <div className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--error-ink)]">Mismatched</div>
            <div className="mt-1 text-[32px] leading-[1.13] font-semibold tracking-[-0.025em] tabular-nums text-[var(--error-ink)]">{totals.mismatchedCount.toLocaleString()}</div>
            <div className="mt-1 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--body)]">
              We billed a different amount to the one the customer was charged — often a coupon or offer applied here but not to the membership in Whop.{" "}
              <button type="button" onClick={showMismatched} className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[var(--ink)] hover:underline [&_svg]:transition-transform hover:[&_svg]:translate-x-[3px]">
                Show these rows<ArrowRight className="size-[13px] stroke-[2.4]" aria-hidden />
              </button>
            </div>
          </div>
        ) : (
          <BoardStatTile label="Mismatched" value="0" footnote="Every invoice matches what the provider charged." />
        )}
        <BoardStatTile label="Invoiced this month" value={formatCentsAsCurrency(totals.invoicedThisMonthCents)} footnote={`${invoicedThisMonthCount.toLocaleString()} ${invoicedThisMonthCount === 1 ? "invoice" : "invoices"}`} />
        <BoardStatTile label="Collected this month" value={formatCentsAsCurrency(totals.collectedThisMonthCents)} footnote={collectedShare} />
        <BoardStatTile label="Overdue" value={totals.overdueCount.toLocaleString()} footnote="structurally rare" tone={totals.overdueCount > 0 ? "warning" : "default"} />
      </BoardStatGrid>

      <div className="flex flex-col gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="relative inline-flex">
            <select aria-label="Tenant" value={tenant} onChange={(event) => { setTenant(event.target.value); setPage(1); }} className={cn(control, "appearance-none pr-9")}>
              <option value="">All tenants</option>
              {tenants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" aria-hidden />
          </span>
          <span className="flex h-10 w-full items-center gap-2 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[var(--muted)] sm:w-[248px]">
            <Search className="size-4 shrink-0" aria-hidden />
            <input type="search" aria-label="Search invoice, tenant" placeholder="Search invoice, tenant" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} className="min-w-0 flex-grow border-0 bg-transparent text-[14px] text-[var(--ink)] outline-none placeholder:text-[var(--muted)]" />
          </span>
          <button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)} className={cn(control, "inline-flex items-center gap-2")}>
            <SlidersHorizontal className="size-4" aria-hidden />Filters
            {filterCount > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--surface-alt)] px-1.5 text-[12px] font-semibold tabular-nums">{filterCount}</span>}
          </button>
          <span className="flex-grow" />
          {anyFilter && <button type="button" onClick={reset} className="text-[14px] font-semibold text-[var(--ink)] hover:underline">Clear</button>}
        </div>
        {filtersOpen && (
          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-3">
            <label className="flex items-center gap-2 text-[14px] font-semibold text-[var(--body)]">Status
              <select value={status} onChange={(event) => { setStatus(event.target.value as "all" | InvoiceStatus); setPage(1); }} className={control}>
                <option value="all">All statuses</option>
                {INVOICE_STATUSES.map((value) => <option key={value} value={value}>{INVOICE_STATUS_LABELS[value]}</option>)}
              </select>
            </label>
            <span role="group" aria-label="Show" className="inline-flex gap-[3px] rounded-[8px] bg-[var(--surface-alt)] p-[3px]">
              {([["all", "Everything"], ["overdue", "Overdue only"], ["mismatched", "Mismatched only"]] as const).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={lens === value} onClick={() => { setLens(value); setPage(1); }} className={cn("h-8 rounded-[6px] border px-3 text-[14px] font-semibold", lens === value ? "border-[var(--border)] bg-[var(--surface)] text-[var(--ink)]" : "border-transparent text-[var(--muted)]")}>{label}</button>
              ))}
            </span>
          </div>
        )}
      </div>

      <div className="relative min-w-0 overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
        <div className="overflow-x-auto">
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
                      <EmptyState title="No invoices yet" hint="An invoice is created automatically when a payment is collected, and by hand for anything else. Nothing has been billed on this platform so far." />
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
                      <Link href={`/admin/invoices/${invoice.id}`} aria-label={`View ${invoice.number}`} className="inline-flex h-8 items-center rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[14px] font-semibold text-[var(--ink)] no-underline hover:bg-[var(--surface-alt)]">View</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length > 0 && <BoardTableFooter page={current} pageSize={PAGE} total={rows.length} itemLabel={rows.length === 1 ? "invoice" : "invoices"} order="by number, newest first" onPageChange={setPage} />}
      </div>
    </div>
  );
}
