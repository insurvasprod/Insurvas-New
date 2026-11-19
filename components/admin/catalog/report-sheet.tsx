"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { FactTable } from "@/components/ui/fact-table";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip } from "@/components/ui/status-chip";
import { Segmented } from "@/components/ui/view-tabs";
import { FACT_REPORT_LABEL, isFixable, type FactReportQueueRow } from "@/lib/carriers/factReportConstants";
import { carrierHref } from "@/lib/carriers/setup";
import { notify } from "@/lib/notify";

export const reportDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "—");

/**
 * One fact report as a right sheet (admin round 1, catalog.html screen 14): what Insurvas has, what the agency saw,
 * what they say it should be and how they know; then Fix it or Decline, as before — the new value for the three facts
 * Insurvas holds (written for every agency) and the note the agency sees. "Fix it" also links to the carrier's record,
 * where the fact can be edited at any time. A closed report reads its outcome.
 */
export function ReportSheet({ report, carrierCode, onClose, onDone }: { report: FactReportQueueRow; carrierCode: string | null; onClose: () => void; onDone: () => void }) {
  const fixable = isFixable(report.factKey);
  const waiting = report.status === "open";
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
    }).catch(() => null);
    const data = (await response?.json().catch(() => ({}))) as { error?: string } | undefined;
    setBusy(false);
    if (!response?.ok) { notify.block(data?.error ?? "That did not save."); return; }
    notify.done(mode === "fixed" ? `${report.carrierName}: ${FACT_REPORT_LABEL[report.factKey].toLowerCase()} fixed` : "Report declined", { detail: mode === "fixed" && fixable ? "Every agency now reads the new value." : "The agency sees the reason on its carrier card." });
    onDone();
  }

  const record = carrierCode ? carrierHref(carrierCode, fixable ? "overview" : "reports") : null;

  return (
    <Sheet
      title={`${report.carrierName} · ${FACT_REPORT_LABEL[report.factKey]}`}
      subtitle={`Reported by ${report.reportedBy || "an owner"} at ${report.tenantName || "an agency"} on ${reportDay(report.createdAt)}`}
      status={waiting ? <StatusChip tone="warning">Waiting</StatusChip> : <StatusChip tone={report.status === "fixed" ? "good" : "neutral"}>{report.status === "fixed" ? "Fixed" : "Declined"}</StatusChip>}
      onClose={() => { if (!busy) onClose(); }}
      className="lg:w-[520px]"
      bodyClassName="flex flex-col gap-4 p-4"
      footer={waiting ? <>
        <span className="flex-1" />
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button type="button" disabled={busy || blocked} onClick={() => void save()}>{busy ? "Saving…" : mode === "fixed" ? (fixable ? "Save for every agency" : "Mark fixed") : "Decline"}</Button>
      </> : <><span className="flex-1" /><Button type="button" variant="ghost" onClick={onClose}>Close</Button></>}
    >
      <FactTable
        labelWidth={160}
        rows={[
          ["Insurvas has now", fixable ? report.currentValue ?? "Not set" : "See the product catalog"],
          ["The agency saw", report.shownValue ?? "—"],
          ["They say it should be", <span key="s" className="font-semibold break-words">{report.suggestedValue}</span>],
          ["How they know", report.evidence ?? "Not given"],
          ...(waiting ? [] : ([["Outcome", report.status === "fixed" ? "Fixed" : "Declined"], ["Note for the agency", report.resolutionNote ?? "None"], ["Closed", reportDay(report.resolvedAt)]] as Array<[string, string]>)),
        ]}
      />

      {record && (
        <p className="m-0 text-sm text-muted-foreground">
          {fixable ? "The fact can also be edited at any time on " : "See everything about the carrier on "}
          <Link href={record} className="font-medium text-foreground underline underline-offset-2">{report.carrierName}&apos;s record</Link>.
        </p>
      )}

      {waiting && (
        <>
          <Segmented
            label="Outcome"
            value={mode}
            onChange={setMode}
            options={[{ key: "fixed", label: "Fix it" }, { key: "declined", label: "Decline" }]}
          />
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
        </>
      )}
    </Sheet>
  );
}
