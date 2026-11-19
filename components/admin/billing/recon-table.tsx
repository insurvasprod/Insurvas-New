"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";

import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { EmptyState, NoMatches } from "@/components/admin/empty-state";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { TableCard } from "@/components/ui/table-card";
import { DoneStamp } from "@/components/ui/done-stamp";
import { useDoneStamps } from "@/components/ui/use-done-stamps";
import { useDepartures } from "@/components/ui/use-row-exit";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { datedName, saveCsv } from "@/components/admin/billing/inv-download";
import { ReconSettleSheet } from "@/components/admin/billing/recon-settle";
import { BodyPortal } from "@/components/admin/billing/inv-sheet";
import { formatCentsAsCurrency } from "@/lib/money";
import { RECON_LENSES, RECON_LENS_LABELS, RECON_REASON_LABELS, reconLensOf, reconciliationCsv, type ReconLens, type ReconReason, type ReconRow } from "@/lib/invoices/reconcile";
import { cn } from "@/lib/utils";

const th = "px-3 py-2 text-left text-xs leading-[1.33] font-semibold text-[var(--muted)]";
const td = "border-t border-[var(--border)] px-3 py-2 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--body)]";
const signed = (cents: number) => (cents < 0 ? `−${formatCentsAsCurrency(-cents)}` : formatCentsAsCurrency(cents));

/**
 * The reconciliation list (billing-r2 screen 7): Don't match · Provider only · Settled, a likely-reason filter and a
 * search, all in the address (`lens=`, `reason=`, `q=`). Settle… opens the row's sheet; `?invoice=<id>` (the invoice
 * sheet's "See why") or `?payment=<id>` opens it on arrival, on whichever lens holds that row.
 */
export function ReconTable({ rows, canAct, explanationsReady, approvalThresholdCents }: { rows: ReconRow[]; canAct: boolean; explanationsReady: boolean; approvalThresholdCents: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const [page, setPage] = useState(1);

  const focusKey = params.get("invoice") ? `inv:${params.get("invoice")}` : params.get("payment") ? `pay:${params.get("payment")}` : null;
  const focused = focusKey ? rows.find((row) => row.key === focusKey) ?? null : null;
  const lensParam = params.get("lens");
  const lens: ReconLens = (RECON_LENSES as readonly string[]).includes(lensParam ?? "") ? (lensParam as ReconLens) : focused ? reconLensOf(focused) : "mismatched";
  const reasonParam = params.get("reason") ?? "";
  const reason = (reasonParam in RECON_REASON_LABELS ? reasonParam : "") as ReconReason | "";
  const q = params.get("q") ?? "";

  const needle = q.trim().toLowerCase();
  const base = useMemo(() => rows.filter((row) => (!reason || row.reason === reason) && (!needle || (row.number ?? "").toLowerCase().includes(needle) || row.tenantName.toLowerCase().includes(needle))), [rows, reason, needle]);
  const counts = useMemo(() => Object.fromEntries(RECON_LENSES.map((key) => [key, base.filter((row) => reconLensOf(row) === key).length])) as Record<ReconLens, number>, [base]);
  const shownRows = useMemo(() => base.filter((row) => reconLensOf(row) === lens), [base, lens]);
  const reasons = useMemo(() => [...new Set(rows.map((row) => row.reason))], [rows]);
  const pageSize = useFittingPageSize(460, 45);
  // Mark paid… from a row's sheet stamps the row "Paid" where its Settle… was, then the refresh lands; a row the
  // refresh moved to another lens plays out (Wave D, 2026-11-18). A lens, reason or search change is another list.
  const stamps = useDoneStamps(rows);
  const left = useDepartures(shownRows, (row) => row.key, `${lens}|${reason}|${needle}`);
  const { current, rows: shown } = paginate(left.rows, page, pageSize);
  const anyFilter = Boolean(reason || needle);

  const change = (patch: Record<string, string | null>) => { setPage(1); setParamsInPlace(patch); };
  const openRow = (row: ReconRow) => setParamsInPlace(row.kind === "invoice" ? { invoice: row.invoiceId, payment: null } : { payment: row.paymentId, invoice: null });
  const closeRow = () => setParamsInPlace({ invoice: null, payment: null });

  return (
    <>
      <TableCard
        className="min-w-0"
        footer={shownRows.length ? <Pager page={current} pageSize={pageSize} total={shownRows.length} noun={shownRows.length === 1 ? "row" : "rows"} suffix="Settle: raise a credit note, mark paid, or mark explained with a note; each is in the audit log" onPage={setPage} /> : undefined}
        toolbar={
          <DataToolbar actions={<>
            <Button type="button" variant="outline" disabled={!shownRows.length} onClick={() => saveCsv(datedName(`reconciliation-${lens}`), reconciliationCsv(shownRows))}><Download aria-hidden="true" />Export</Button>
            <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
          </>}>
            <div role="radiogroup" aria-label="Show" className="flex flex-wrap items-center gap-2">
              {RECON_LENSES.map((key) => (
                <ToggleChip key={key} role="radio" selected={lens === key} count={counts[key]} onClick={() => change({ lens: key === "mismatched" ? null : key })}>{RECON_LENS_LABELS[key]}</ToggleChip>
              ))}
            </div>
            <ToolbarSearch value={q} onChange={(value) => change({ q: value || null })} placeholder="Search invoice or customer" />
            <select aria-label="Likely reason" value={reason} onChange={(event) => change({ reason: event.target.value || null })} className={cn(toolbarControl, "max-w-72")}>
              <option value="">Any likely reason</option>
              {reasons.map((key) => <option key={key} value={key}>{RECON_REASON_LABELS[key]}</option>)}
            </select>
            {anyFilter && <Button type="button" variant="ghost" onClick={() => change({ reason: null, q: null })}>Clear</Button>}
          </DataToolbar>
        }
      >
        <table className="w-full min-w-[880px] border-collapse">
          <thead>
            <tr className="bg-[var(--surface-alt)]">
              <th scope="col" className={cn(th, "w-[170px]")}>Invoice</th>
              <th scope="col" className={th}>Customer</th>
              <th scope="col" className={cn(th, "w-[120px] text-right")}>We billed</th>
              <th scope="col" className={cn(th, "w-[140px] whitespace-nowrap text-right")}>Provider charged</th>
              <th scope="col" className={cn(th, "w-[120px] text-right")}>Difference</th>
              <th scope="col" className={cn(th, "w-[260px]")}>{lens === "settled" ? "Explained" : "Likely reason"}</th>
              <th scope="col" className={cn(th, "w-[110px] text-right")}><span className="sr-only">Settle</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-0">
                  {anyFilter ? <NoMatches noun="rows" onClear={() => change({ reason: null, q: null })} /> : (
                    <EmptyState
                      title={lens === "mismatched" ? "Every invoice matches the provider" : lens === "provider" ? "No provider charge without an invoice" : "Nothing settled by a note yet"}
                      hint={lens === "settled" ? (explanationsReady ? "Rows marked explained appear here with their note." : "Marking a row explained needs a database update that has not been applied yet.") : "Differences appear here when a provider payment arrives that disagrees with what we billed."}
                    />
                  )}
                </td>
              </tr>
            ) : shown.map((row) => (
              <tr key={row.key} {...left.rowProps(row.key)} onClick={() => openRow(row)} aria-selected={focused?.key === row.key || undefined} className={cn("cursor-pointer hover:bg-[var(--surface-alt)]", focused?.key === row.key && "bg-[var(--primary-soft)]")}>
                <td className={cn(td, "whitespace-nowrap font-semibold text-[var(--ink)] tabular-nums")}>{row.number ?? "—"}</td>
                <td className={cn(td, "max-w-[260px] truncate")}>{row.tenantName}</td>
                <td className={cn(td, "text-right tabular-nums")}>{formatCentsAsCurrency(row.billedCents)}</td>
                <td className={cn(td, "text-right tabular-nums")}>{row.chargedCents === null ? "—" : formatCentsAsCurrency(row.chargedCents)}</td>
                <td className={cn(td, "text-right font-semibold text-[var(--ink)] tabular-nums")}>{signed(row.differenceCents)}</td>
                <td className={cn(td, "max-w-[260px] truncate")} title={row.explanation?.note ?? RECON_REASON_LABELS[row.reason]}>{row.explanation ? row.explanation.note : RECON_REASON_LABELS[row.reason]}</td>
                <td className={cn(td, "text-right")}>
                  {stamps.labelOf(row.key) ? <DoneStamp label={stamps.labelOf(row.key)!} /> : <Button type="button" variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); openRow(row); }}>{row.explanation ? "Open" : "Settle…"}</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
      {focused && (
        <BodyPortal>
          <ReconSettleSheet key={focused.key} row={focused} canAct={canAct} explanationsReady={explanationsReady} approvalThresholdCents={approvalThresholdCents} onClose={closeRow} onPaid={(refresh) => void stamps.stamp(focused.key, "Paid", refresh)} />
        </BodyPortal>
      )}
    </>
  );
}
