"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { Pager } from "@/components/ui/pager";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { formatPhone, normalizeDigits } from "@/lib/suppression/constants";
import { SCREENING_OUTCOME_LABELS, type ScreeningAuditRow } from "@/lib/suppression/exemptionConstants";

/**
 * LA-2.3-9 · "Every check audited (who, when, vendor, raw response, outcome); cached per phone with
 * TTL; metered." Every screening wrote a screening_audit row, and nothing showed them. This card on
 * /app/tcpa lists them newest first: who asked, when, which vendor answered, the outcome, whether it
 * was the 24-hour cache, and the raw vendor response on demand.
 */

const OUTCOME_TONE: Record<string, StatusTone> = {
  clear: "good", dnc: "warning", internal_dq: "info", tcpa_litigator: "danger", invalid_phone: "neutral", unavailable: "danger",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const stamp = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${d.getDate()} ${MONTHS[d.getMonth()]} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
};
/** "litigator:demo:litigator_scrub,dnc:demo:dnc_scrub" reads as the two feeds that answered. */
const vendorLabel = (vendor: string | null) => {
  if (!vendor) return "No vendor answered";
  if (vendor === "tenant_suppression") return "Your own list";
  return vendor.split(",").map((part) => part.replace(/^(litigator|dnc):/, "").replace(/^demo:(litigator|dnc)_scrub$/, "Demo $1 feed")).join(" · ");
};

const PAGE_SIZE = 25;
const th = "bg-[var(--surface-alt)] px-3 py-2 text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground";
const td = "border-t border-border px-3 py-2 text-sm leading-normal tracking-[-0.02em] text-[var(--body)] align-top";

export function TcpaScreeningAudit() {
  const [rows, setRows] = useState<ScreeningAuditRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [outcome, setOutcome] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPage = useCallback(async (pageNumber: number) => {
    const params = new URLSearchParams({ audit: "1", limit: String(PAGE_SIZE), page: String(pageNumber) });
    const digits = normalizeDigits(phone);
    if (digits) params.set("phone", digits);
    if (outcome) params.set("outcome", outcome);
    const response = await fetch(`/api/app/suppression?${params}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? "Could not load the screening audit");
    return body as { rows: ScreeningAuditRow[]; total: number };
  }, [phone, outcome]);

  useEffect(() => {
    // A partly typed number is not a filter yet; the list waits for ten digits or none.
    if (phone.trim() && !normalizeDigits(phone)) return;
    let live = true;
    const timer = setTimeout(() => {
      fetchPage(page).then(
        (loaded) => { if (live) { setRows(loaded.rows); setTotal(loaded.total); setError(null); setRefreshing(false); } },
        (failure: unknown) => { if (live) { setError(failure instanceof Error ? failure.message : "Could not load the screening audit"); setRows(null); setRefreshing(false); } },
      );
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [fetchPage, phone, page, reload]);

  return (
    <TableCard
      title="Screening audit"
      toolbar={
        <DataToolbar actions={<RefreshButton onClick={() => { if (phone.trim() && !normalizeDigits(phone)) return; setError(null); setRefreshing(true); setReload((value) => value + 1); }} refreshing={refreshing} />}>
          <ToolbarSearch value={phone} onChange={(value) => { setPhone(value); setPage(1); }} placeholder="Search a number" label="Filter checks by number" />
          <select aria-label="Filter checks by outcome" value={outcome} onChange={(event) => { setOutcome(event.target.value); setPage(1); }} className={toolbarControl}>
            <option value="">Every outcome</option>
            {Object.entries(SCREENING_OUTCOME_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </DataToolbar>
      }
      footer={!error && rows && rows.length > 0 ? <Pager page={page} total={total} noun={total === 1 ? "check" : "checks"} onPage={setPage} pageSize={PAGE_SIZE} suffix="newest first" /> : undefined}
    >
      {error ? <ErrorState title="The screening audit did not load" detail={error} action={<Button variant="outline" onClick={() => { setError(null); setReload((value) => value + 1); }}>Try again</Button>} />
        : !rows ? <SectionLoading rows={4} columns={6} label="Loading the screening audit" />
        : rows.length === 0 ? (phone || outcome
          ? <NoMatches noun="checks" onClear={() => { setPhone(""); setOutcome(""); setPage(1); }} />
          : <EmptyState title="No number has been screened yet" hint="Each DNC and litigator check is listed here once it runs." />)
        : <table className="w-full min-w-[1030px] table-fixed border-collapse text-left">
          <thead><tr>
            <th className={`${th} w-[140px]`}>When</th>
            <th className={`${th} w-[150px]`}>Number</th>
            <th className={`${th} w-[160px]`}>Outcome</th>
            <th className={th}>Vendor</th>
            <th className={th}>Who</th>
            <th className={`${th} w-[150px]`}>Lead</th>
            <th className={`${th} w-[110px] text-right`}>Response</th>
          </tr></thead>
          <tbody>{rows.map((row) => <Fragment key={row.id}>
            <tr className="m-row">
              <td className={`${td} tabular-nums`}>{stamp(row.at)}</td>
              <td className={`${td} font-semibold tabular-nums text-foreground`}>{row.phoneDigits ? formatPhone(row.phoneDigits) : "Not a number"}</td>
              <td className={td}>
                <StatusChip tone={OUTCOME_TONE[row.outcome] ?? "neutral"}>{SCREENING_OUTCOME_LABELS[row.outcome] ?? row.outcome}</StatusChip>
                {row.cached && <span className="mt-1 block text-xs text-muted-foreground">From the 24-hour cache</span>}
              </td>
              <td className={td}>{vendorLabel(row.vendor)}</td>
              <td className={td}>{row.who}<span className="block text-xs text-muted-foreground">{row.origin}</span></td>
              <td className={td}>{row.leadId ? <a className="text-[var(--accent-ink)] hover:underline" href={`/app/leads/${row.leadId}`}>{row.leadName ?? "Open lead"}</a> : "—"}</td>
              <td className={`${td} text-right`}>
                <Button type="button" variant="outline" size="sm" aria-expanded={open === row.id} onClick={() => setOpen(open === row.id ? null : row.id)}>{open === row.id ? "Hide" : "Raw"}</Button>
              </td>
            </tr>
            {open === row.id && <tr><td colSpan={7} className="border-t border-border bg-[var(--canvas)] px-3 py-2">
              <pre className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs leading-normal text-[var(--body)]">{JSON.stringify(row.rawResponse, null, 2)}</pre>
            </td></tr>}
          </Fragment>)}</tbody>
        </table>}
    </TableCard>
  );
}
