"use client";

/**
 * Catalog › Fact reports (20261027200000). Agencies report a wrong carrier fact from Settings ›
 * Carriers; staff close each one here.
 *
 * - Fix: for a portal address, policy number format or bank statement fact, the value typed here is
 *   written to the platform carrier, so every agency reads it. Pays by and products are fixed on the
 *   product catalog first, then closed here without a value.
 * - Decline: the reason is shown to the agency on its carrier card.
 *
 * Admin round 1 (docs/design/admin-r1/catalog.html screen 14): the Waiting (oldest first) and Closed
 * tables as lenses on the title line (`?lens=closed`), a search, and a report opens as a right sheet
 * (`?report=<id>`) that also links to the carrier's record. On a carrier's record (`carrier` mode) both
 * tables show that carrier's reports, without the lens.
 */

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { ReportSheet, reportDay } from "@/components/admin/catalog/report-sheet";
import { Button } from "@/components/ui/button";
import { DataToolbar, ToolbarSearch } from "@/components/ui/data-toolbar";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { FACT_REPORT_LABEL, isFixable, type FactReportQueueRow } from "@/lib/carriers/factReportConstants";

export type FactReportLens = "waiting" | "closed";

const daysAgo = (iso: string, nowIso: string) => {
  const days = Math.max(0, Math.floor((new Date(nowIso).getTime() - new Date(iso).getTime()) / 86_400_000));
  return days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
};

function matches(report: FactReportQueueRow, needle: string) {
  if (!needle) return true;
  return [report.carrierName, report.tenantName, report.reportedBy ?? "", FACT_REPORT_LABEL[report.factKey], report.suggestedValue].some((text) => text.toLowerCase().includes(needle));
}

export function CarrierFactReports({ reports, carrierCodes, nowIso, mode = "page" }: {
  reports: FactReportQueueRow[];
  /** Carrier id → code, for the link to each carrier's record. */
  carrierCodes: Record<string, string>;
  nowIso: string;
  /** "page": one lens at a time from the URL; "carrier": one carrier's waiting and closed reports together. */
  mode?: "page" | "carrier";
}) {
  const router = useRouter();
  const params = useSearchParams();
  const lens: FactReportLens = params.get("lens") === "closed" ? "closed" : "waiting";
  const openId = params.get("report");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [closedPage, setClosedPage] = useState(1);
  const pageSize = useFittingPageSize(420, 45);

  const needle = query.trim().toLowerCase();
  const waiting = useMemo(() => reports.filter((r) => r.status === "open" && matches(r, needle)), [reports, needle]);
  const closed = useMemo(() => reports.filter((r) => r.status !== "open" && matches(r, needle)), [reports, needle]);
  const open = openId ? reports.find((r) => r.id === openId) ?? null : null;
  const openReport = (report: FactReportQueueRow) => setParamsInPlace({ report: report.id });
  const search = mode === "page" ? (
    <DataToolbar>
      <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); setClosedPage(1); }} placeholder="Search carrier, agency or fact" />
    </DataToolbar>
  ) : undefined;

  const waitingCard = (
    <TableCard
      title={mode === "carrier" ? "Waiting" : undefined}
      description={mode === "carrier" ? "Oldest first." : undefined}
      toolbar={search}
      footer={waiting.length && mode === "page" ? <Pager page={paginate(waiting, page, pageSize).current} pageSize={pageSize} total={waiting.length} noun={waiting.length === 1 ? "report" : "reports"} suffix="oldest first" onPage={setPage} /> : undefined}
    >
      {waiting.length === 0 ? (
        needle ? <NoMatches noun="reports" by="search" onClear={() => setQuery("")} /> : <EmptyState title="No report is waiting" hint="When an agency tells us a carrier fact is wrong, it shows here." />
      ) : (
        <Table className="min-w-[980px]">
          <TableHeader>
            <TableRow>
              <TableHead>Carrier</TableHead>
              <TableHead>Fact</TableHead>
              <TableHead>Insurvas has now</TableHead>
              <TableHead>They say</TableHead>
              <TableHead>Agency</TableHead>
              <TableHead className="w-[120px]">Reported</TableHead>
              <TableHead className="w-[100px] text-right"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(mode === "page" ? paginate(waiting, page, pageSize).rows : waiting).map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => openReport(r)} aria-selected={openId === r.id}>
                <TableCell className="font-semibold text-foreground">{r.carrierName}</TableCell>
                <TableCell className="whitespace-nowrap">{FACT_REPORT_LABEL[r.factKey]}</TableCell>
                <TableCell className="max-w-[220px] truncate" title={r.currentValue ?? undefined}>{isFixable(r.factKey) ? r.currentValue ?? <span className="text-muted-foreground">Not set</span> : <span className="text-muted-foreground">Product catalog</span>}</TableCell>
                <TableCell className="max-w-[240px] truncate font-semibold text-foreground" title={r.suggestedValue}>{r.suggestedValue}</TableCell>
                <TableCell className="max-w-[220px] truncate" title={r.reportedBy ? `${r.tenantName} · ${r.reportedBy}` : r.tenantName}>{r.tenantName}{r.reportedBy ? <span className="text-muted-foreground"> · {r.reportedBy}</span> : null}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums" title={reportDay(r.createdAt)}>{daysAgo(r.createdAt, nowIso)}</TableCell>
                <TableCell className="text-right"><Button type="button" size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); openReport(r); }}>Review</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );

  const closedCard = (
    <TableCard
      title={mode === "carrier" ? "Closed" : undefined}
      description={mode === "carrier" ? "What each report came to." : undefined}
      toolbar={mode === "page" ? search : undefined}
      footer={closed.length && mode === "page" ? <Pager page={paginate(closed, closedPage, pageSize).current} pageSize={pageSize} total={closed.length} noun={closed.length === 1 ? "report" : "reports"} suffix="the latest 100, newest first" onPage={setClosedPage} /> : undefined}
    >
      {closed.length === 0 ? (
        needle ? <NoMatches noun="reports" by="search" onClear={() => setQuery("")} /> : <EmptyState title="Nothing closed yet" hint="Fixed and declined reports are listed here. The agency sees the same on its carrier card for 30 days." />
      ) : (
        <Table className="min-w-[860px]">
          <TableHeader>
            <TableRow>
              <TableHead>Carrier</TableHead>
              <TableHead>Fact</TableHead>
              <TableHead>They said</TableHead>
              <TableHead>Agency</TableHead>
              <TableHead className="w-[110px]">Outcome</TableHead>
              <TableHead>Note</TableHead>
              <TableHead className="w-[120px]">Closed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(mode === "page" ? paginate(closed, closedPage, pageSize).rows : closed).map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => openReport(r)} aria-selected={openId === r.id}>
                <TableCell className="font-semibold text-foreground">{r.carrierName}</TableCell>
                <TableCell className="whitespace-nowrap">{FACT_REPORT_LABEL[r.factKey]}</TableCell>
                <TableCell className="max-w-[220px] truncate" title={r.suggestedValue}>{r.suggestedValue}</TableCell>
                <TableCell className="max-w-[200px] truncate">{r.tenantName}</TableCell>
                <TableCell><StatusChip tone={r.status === "fixed" ? "good" : "neutral"}>{r.status === "fixed" ? "Fixed" : "Declined"}</StatusChip></TableCell>
                <TableCell className="max-w-[240px] truncate" title={r.resolutionNote ?? undefined}>{r.resolutionNote ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">{reportDay(r.resolvedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );

  return (
    <>
      {mode === "carrier" ? <div className="flex min-w-0 flex-col gap-4">{waitingCard}{closedCard}</div> : lens === "waiting" ? waitingCard : closedCard}
      {open && (
        <ReportSheet
          key={open.id}
          report={open}
          carrierCode={carrierCodes[open.carrierId] ?? null}
          onClose={() => setParamsInPlace({ report: null })}
          onDone={() => { setParamsInPlace({ report: null }); router.refresh(); }}
        />
      )}
    </>
  );
}
