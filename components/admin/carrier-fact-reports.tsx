"use client";

/**
 * Catalog › Fact reports (20261027200000). Agencies report a wrong carrier fact from Settings ›
 * Carriers; staff close each one here.
 *
 * - Fix: for a portal address, policy number format or bank statement fact, the value typed here is
 *   written to the platform carrier, so every agency reads it. Pays by and products are fixed on the
 *   product catalog first, then closed here without a value.
 * - Decline: the reason is shown to the agency on its carrier card.
 */

import { useState } from "react";

import { AdminPageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { FACT_REPORT_LABEL, isFixable, type FactReportQueueRow } from "@/lib/carriers/factReportConstants";
import { notify } from "@/lib/notify";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "—");

function Resolve({ report, onClose, onDone }: { report: FactReportQueueRow; onClose: () => void; onDone: () => Promise<void> }) {
  const fixable = isFixable(report.factKey);
  const [mode, setMode] = useState<"fixed" | "declined">("fixed");
  const [value, setValue] = useState(fixable ? report.suggestedValue : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const blocked = mode === "declined" ? !note.trim() : fixable && !value.trim();

  async function save() {
    setBusy(true);
    const response = await fetch(`/api/admin/carrier-fact-reports/${report.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: mode, value: mode === "fixed" && fixable ? value.trim() : null, note: note.trim() || null }),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!response.ok) { notify.block(data.error ?? "That did not save."); return; }
    notify.done(mode === "fixed" ? `${report.carrierName}: ${FACT_REPORT_LABEL[report.factKey].toLowerCase()} fixed` : "Report declined", { detail: mode === "fixed" && fixable ? "Every agency now reads the new value." : "The agency sees the reason on its carrier card." });
    onClose();
    await onDone();
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{report.carrierName} · {FACT_REPORT_LABEL[report.factKey]}</DialogTitle>
          <DialogDescription>Reported by {report.reportedBy || "an owner"} at {report.tenantName || "an agency"} on {day(report.createdAt)}.</DialogDescription>
        </DialogHeader>
        <dl className="m-0 grid grid-cols-[150px_1fr] gap-x-3 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Insurvas has now</dt><dd className="m-0 break-words">{fixable ? report.currentValue ?? "Not set" : "See the product catalog"}</dd>
          <dt className="text-muted-foreground">The agency saw</dt><dd className="m-0 break-words">{report.shownValue ?? "—"}</dd>
          <dt className="text-muted-foreground">They say it should be</dt><dd className="m-0 font-semibold break-words text-foreground">{report.suggestedValue}</dd>
          <dt className="text-muted-foreground">How they know</dt><dd className="m-0 break-words">{report.evidence ?? "Not given"}</dd>
        </dl>
        <div className="flex gap-2" role="radiogroup" aria-label="Outcome">
          {(["fixed", "declined"] as const).map((option) => (
            <button key={option} type="button" role="radio" aria-checked={mode === option} onClick={() => setMode(option)} className={`h-9 rounded-full border px-4 text-sm font-semibold ${mode === option ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "border-border text-[var(--body)]"}`}>
              {option === "fixed" ? "Fix it" : "Decline"}
            </button>
          ))}
        </div>
        {mode === "fixed" && fixable && (
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted-foreground">
            New value for every agency
            <input className={toolbarControl} value={value} spellCheck={false} onChange={(event) => setValue(event.target.value)} />
            <span className="font-normal">{report.factKey === "portal_origin" ? "An https address, like https://agents.carrier.com." : report.factKey === "reference_pattern" ? "A pattern, like ^AM-\\d{5,8}$. A number that does not match warns and still saves." : "At most 60 characters; saved in capitals."}</span>
          </label>
        )}
        {mode === "fixed" && !fixable && <p className="m-0 text-sm text-muted-foreground">Change it on the product catalog first, then mark it fixed here.</p>}
        <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted-foreground">
          {mode === "declined" ? "Why (the agency sees this)" : "Note for the agency (optional)"}
          <input className={toolbarControl} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={busy || blocked} onClick={() => void save()}>{busy ? "Saving…" : mode === "fixed" ? (fixable ? "Save for every agency" : "Mark fixed") : "Decline"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CarrierFactReports({ initialReports, notice }: { initialReports: FactReportQueueRow[]; notice?: string }) {
  const [reports, setReports] = useState(initialReports);
  const [open, setOpen] = useState<FactReportQueueRow | null>(null);
  const [page, setPage] = useState(1);
  const [closedPage, setClosedPage] = useState(1);
  const waiting = reports.filter((r) => r.status === "open");
  const closed = reports.filter((r) => r.status !== "open");
  const shown = paginate(waiting, page, 10);
  const shownClosed = paginate(closed, closedPage, 10);
  const agencies = new Set(waiting.map((r) => r.tenantId)).size;
  const carriers = new Set(waiting.map((r) => r.carrierId)).size;
  const oldest = waiting[0]?.createdAt ?? null;

  async function reload() {
    const response = await fetch("/api/admin/carrier-fact-reports", { cache: "no-store" });
    if (response.ok) setReports(((await response.json()) as { reports: FactReportQueueRow[] }).reports);
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title="Fact reports" subtitle="Carrier facts agencies say are wrong. Fixing one changes it for every agency." />
      <StatStrip label="Fact report totals">
        <StatTile label="Waiting" value={waiting.length.toLocaleString("en-US")} valueTone={waiting.length ? "warning" : undefined} footnote={waiting.length ? `${carriers} carrier${carriers === 1 ? "" : "s"}` : "none waiting"} />
        <StatTile label="Agencies waiting" value={agencies.toLocaleString("en-US")} footnote={waiting.length ? "reported at least one" : "none"} />
        <StatTile label="Oldest waiting" value={oldest ? day(oldest) : "—"} footnote={oldest ? "reported on" : "nothing open"} />
        <StatTile label="Closed" value={closed.length.toLocaleString("en-US")} footnote="the latest 100" />
      </StatStrip>

      {notice && <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">{notice}</div>}

      <TableCard title="Waiting" description="Oldest first." footer={waiting.length > 10 ? <Pager page={shown.current} pageSize={10} total={waiting.length} noun="reports" onPage={setPage} /> : undefined}>
        {waiting.length === 0 ? (
          <EmptyState title="No report is waiting" hint="When an agency tells us a carrier fact is wrong, it shows here." />
        ) : (
          <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
            <thead>
              <tr>
                <th>Carrier</th>
                <th>Fact</th>
                <th>Insurvas has now</th>
                <th>They say</th>
                <th>Agency</th>
                <th className="w-[120px]">Reported</th>
                <th className="w-[100px] text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold text-foreground">{r.carrierName}</td>
                  <td>{FACT_REPORT_LABEL[r.factKey]}</td>
                  <td className="max-w-[220px] truncate" title={r.currentValue ?? undefined}>{isFixable(r.factKey) ? r.currentValue ?? <span className="text-muted-foreground">Not set</span> : <span className="text-muted-foreground">Product catalog</span>}</td>
                  <td className="max-w-[240px] truncate font-semibold text-foreground" title={r.suggestedValue}>{r.suggestedValue}</td>
                  <td>{r.tenantName}<span className="block text-xs text-muted-foreground">{r.reportedBy ?? ""}</span></td>
                  <td className="tabular-nums">{day(r.createdAt)}</td>
                  <td className="text-right"><Button type="button" size="sm" onClick={() => setOpen(r)}>Review</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      <TableCard title="Closed" description="What each report came to. The agency sees the same on its carrier card for 30 days." footer={closed.length > 10 ? <Pager page={shownClosed.current} pageSize={10} total={closed.length} noun="reports" onPage={setClosedPage} /> : undefined}>
        {closed.length === 0 ? (
          <EmptyState title="Nothing closed yet" hint="Fixed and declined reports are listed here." />
        ) : (
          <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
            <thead><tr><th>Carrier</th><th>Fact</th><th>They said</th><th>Agency</th><th className="w-[110px]">Outcome</th><th>Note</th><th className="w-[120px]">Closed</th></tr></thead>
            <tbody>
              {shownClosed.rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold text-foreground">{r.carrierName}</td>
                  <td>{FACT_REPORT_LABEL[r.factKey]}</td>
                  <td className="max-w-[220px] truncate" title={r.suggestedValue}>{r.suggestedValue}</td>
                  <td>{r.tenantName}</td>
                  <td><StatusChip tone={r.status === "fixed" ? "good" : "neutral"}>{r.status === "fixed" ? "Fixed" : "Declined"}</StatusChip></td>
                  <td className="max-w-[240px] truncate" title={r.resolutionNote ?? undefined}>{r.resolutionNote ?? "—"}</td>
                  <td className="tabular-nums">{day(r.resolvedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      {open && <Resolve report={open} onClose={() => setOpen(null)} onDone={reload} />}
    </div>
  );
}
