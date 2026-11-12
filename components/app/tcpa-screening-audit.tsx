"use client";

import { useCallback, useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FactTable } from "@/components/ui/fact-table";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { Pager } from "@/components/ui/pager";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { notify } from "@/lib/notify";
import { formatPhone, normalizeDigits } from "@/lib/suppression/constants";
import { SCREENING_OUTCOME_LABELS, type ScreeningAuditRow } from "@/lib/suppression/exemptionConstants";

/**
 * LA-2.3-9 · "Every check audited (who, when, vendor, raw response, outcome); cached per phone with
 * TTL; metered." Every screening wrote a screening_audit row, and nothing showed them. This tab on
 * /app/tcpa lists them newest first: who asked, when, which vendor answered, the outcome, whether it
 * was the 24-hour cache, and the raw vendor response on demand.
 *
 * Foundation pass (2026-11-03): seven columns, so the table keeps to the card at 1280 (the vendor is the line
 * under where the answer came from, the origin the line under who asked). The raw response still opens under
 * its row: read in place, as Book of business decides in place.
 *
 * Round 7, board 2·A2 (2026-11-11): one line a check in six columns (When · Number · Outcome · Checked by · Who ·
 * Next step). The feeds used and where the check came from are the cells' tooltips; the whole row, or Raw ›, opens
 * the raw response as a dialog with the check's facts (feeds, origin, lead) above it.
 */

/** One chip a row: done is good, a refusal or a failed check is wrong, the rest neutral. */
const OUTCOME_TONE: Record<string, StatusTone> = {
  clear: "good", dnc: "danger", internal_dq: "neutral", tcpa_litigator: "danger", invalid_phone: "neutral", unavailable: "danger",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const two = (n: number) => String(n).padStart(2, "0");
/** "30 Oct 17:07" on the row; the dialog adds the year and seconds. */
const stamp = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${d.getDate()} ${MONTHS[d.getMonth()]} ${two(d.getHours())}:${two(d.getMinutes())}`;
};
const fullStamp = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
};
/** "litigator:demo:litigator_scrub,dnc:demo:dnc_scrub" reads as the two feeds that answered. */
const vendorLabel = (vendor: string | null) => {
  if (!vendor) return "No vendor answered";
  if (vendor === "tenant_suppression") return "Your own list";
  return vendor.split(",").map((part) => part.replace(/^(litigator|dnc):/, "").replace(/^demo:(litigator|dnc)_scrub$/, "Demo $1 feed")).join(" · ");
};

const th = "bg-[var(--surface-alt)] px-3 py-2 text-left text-xs font-semibold leading-[1.33] whitespace-nowrap text-muted-foreground";
const td = "border-t border-border px-3 py-2 text-sm leading-normal tracking-[-0.02em] whitespace-nowrap text-[var(--body)]";
const opensFrom = (event: MouseEvent<HTMLElement>) => !(event.target as HTMLElement).closest("a, button, input, select, textarea, label");

export function TcpaScreeningAudit({ className, pageSize = 10 }: { className?: string; pageSize?: number } = {}) {
  const [rows, setRows] = useState<ScreeningAuditRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [outcome, setOutcome] = useState("");
  const [open, setOpen] = useState<ScreeningAuditRow | null>(null);
  const [reload, setReload] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPage = useCallback(async (pageNumber: number) => {
    const params = new URLSearchParams({ audit: "1", limit: String(pageSize), page: String(pageNumber) });
    const digits = normalizeDigits(phone);
    if (digits) params.set("phone", digits);
    if (outcome) params.set("outcome", outcome);
    const response = await fetch(`/api/app/suppression?${params}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? "Could not load the screening audit");
    return body as { rows: ScreeningAuditRow[]; total: number };
  }, [phone, outcome, pageSize]);

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

  const filtered = Boolean(phone || outcome);
  const clear = () => { setPhone(""); setOutcome(""); setPage(1); };

  return (
    <TableCard
      className={className}
      toolbar={
        <DataToolbar actions={<>
          {filtered && <ClearFiltersButton onClick={clear} />}
          <RefreshButton onClick={() => { if (phone.trim() && !normalizeDigits(phone)) return; setError(null); setRefreshing(true); setReload((value) => value + 1); }} refreshing={refreshing} />
        </>}>
          <ToolbarSearch value={phone} onChange={(value) => { setPhone(value); setPage(1); }} placeholder="Search a number" label="Filter checks by number" />
          <select aria-label="Filter checks by outcome" value={outcome} onChange={(event) => { setOutcome(event.target.value); setPage(1); }} className={toolbarControl}>
            <option value="">Every outcome</option>
            {Object.entries(SCREENING_OUTCOME_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </DataToolbar>
      }
      footer={!error && rows && rows.length > 0 ? <Pager page={page} total={total} noun={total === 1 ? "check" : "checks"} onPage={setPage} pageSize={pageSize} suffix="newest first" /> : undefined}
    >
      {error ? <ErrorState title="The screening audit did not load" detail={error} action={<Button variant="outline" onClick={() => { setError(null); setReload((value) => value + 1); }}>Try again</Button>} />
        : !rows ? <SectionLoading rows={4} columns={6} label="Loading the screening audit" />
        : rows.length === 0 ? (filtered
          ? <NoMatches noun="checks" onClear={clear} />
          : <EmptyState title="No number has been screened yet" hint="Each DNC and litigator check is listed here once it runs." />)
        : <table className="w-full min-w-[760px] border-collapse text-left">
          <thead><tr>
            <th className={th}>When</th>
            <th className={th}>Number</th>
            <th className={th}>Outcome</th>
            <th className={th}>Checked by</th>
            <th className={th}>Who</th>
            <th className={`${th} text-right`}>Next step</th>
          </tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id} className="m-row cursor-pointer" onClick={(event) => { if (opensFrom(event)) setOpen(row); }}>
            <td className={`${td} font-medium tabular-nums text-foreground`}>{stamp(row.at)}</td>
            <td className={`${td} tabular-nums`}>{row.phoneDigits ? formatPhone(row.phoneDigits) : "Not a number"}</td>
            <td className={td}><StatusChip tone={OUTCOME_TONE[row.outcome] ?? "neutral"}>{SCREENING_OUTCOME_LABELS[row.outcome] ?? row.outcome}</StatusChip></td>
            <td className={td} title={vendorLabel(row.vendor)}>{row.cached ? "24-hour cache" : "Live check"}</td>
            <td className={`${td} max-w-[180px] truncate`} title={row.origin ? `${row.who} · ${row.origin}` : row.who}>{row.who}</td>
            <td className={`${td} text-right`}><button type="button" className="outline-none hover:underline focus-visible:underline" title="Open the raw response" onClick={() => setOpen(row)}>Raw ›</button></td>
          </tr>)}</tbody>
        </table>}

      {/* Raw › (r7 2·1): the check's facts, then the vendor's response as it came back. */}
      <Dialog open={open !== null} onOpenChange={(next) => { if (!next) setOpen(null); }}>
        <DialogContent size={"lg"}>
          <DialogHeader>
            <DialogTitle>Raw response · {open?.phoneDigits ? formatPhone(open.phoneDigits) : "Not a number"}</DialogTitle>
            <DialogDescription className="sr-only">The screening check and the vendor response it stored.</DialogDescription>
          </DialogHeader>
          {open ? <>
            <FactTable rows={[
              ["Checked", fullStamp(open.at)],
              ["Outcome", SCREENING_OUTCOME_LABELS[open.outcome] ?? open.outcome],
              ["Answered by", `${open.cached ? "The 24-hour cache" : "A live check"} · ${vendorLabel(open.vendor)}`],
              ["Who", open.who],
              ["Came from", open.origin],
              ["Lead", open.leadId ? <Link key="lead" href={`/app/leads/${open.leadId}`} className="hover:underline">{open.leadName ?? "Open the lead"} ›</Link> : null],
            ]} />
            <pre className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-[var(--canvas)] p-3 text-xs leading-normal text-[var(--body)]">{JSON.stringify(open.rawResponse, null, 2)}</pre>
          </> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { if (open) void navigator.clipboard?.writeText(JSON.stringify(open.rawResponse, null, 2)).then(() => notify.done("Raw response copied"), () => notify.block("Could not copy")); }}>Copy</Button>
            <Button type="button" onClick={() => setOpen(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TableCard>
  );
}
