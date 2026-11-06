"use client";

import { useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { Segmented } from "@/components/ui/view-tabs";
import { fileDay } from "@/lib/ingestion/constants";
import { filterHistory, historyFields, type PolicyHistoryRow } from "@/lib/ingestion/policyPage";
import { fileHref, rowHref } from "@/lib/ingestion/trace";

import { ClickRow } from "./click-row";
import { ExportHistory } from "./policy-islands";

/**
 * Policy › History (canvas board BobPolicy): every field from what to what, with the file and row that
 * changed it, newest first. Filter by field; Export saves the rows on screen. A row with a source opens that
 * file row (board 22). The lead's card moves sit in the same list as "Card stage" rows, with what moved the card
 * (owner 2026-11-05, his manager's request).
 */
export function PolicyHistoryTab({ rows, policyNumber, truncated }: { rows: PolicyHistoryRow[]; policyNumber: string; truncated: boolean }) {
  const [field, setField] = useState("");
  const fields = useMemo(() => historyFields(rows), [rows]);
  const shown = useMemo(() => filterHistory(rows, field), [rows, field]);
  // The five most-changed fields as chips; the rest are rare enough to read in "Every field".
  const options = fields.slice(0, 6).map((option) => ({ key: option.key, label: option.label, count: option.count }));
  return (
    <PagedTableCard
      total={shown.length}
      noun="changes"
      toolbar={
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3">
          <Segmented label="Field" options={options} value={field} onChange={setField} />
          <ExportHistory rows={shown} policyNumber={policyNumber} />
        </div>
      }
      footer={truncated ? <span>The newest 2,000 changes are shown.</span> : undefined}
    >
      {shown.length === 0 ? (
        <EmptyState title="No changes yet" hint="Each carrier file that changes a field of this policy adds a row here, with the file and row that changed it. Each move of the lead's card between stages adds one too." />
      ) : (
        <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
          <thead><tr><th className="w-[120px]">Date</th><th className="w-[180px]">Field</th><th>Change</th><th>Because of</th><th className="w-8"><span className="sr-only">Open</span></th></tr></thead>
          <PagedBody>
            {shown.map((row, index) => {
              const cells = (
                <>
                  <td className="tabular-nums text-muted-foreground">{fileDay(row.date)}</td>
                  <td>{row.fieldLabel}</td>
                  <td>{row.from !== null && <span className="text-muted-foreground">{row.from} → </span>}<strong className="font-semibold text-foreground">{row.to}</strong></td>
                  <td className="max-w-[360px] truncate text-muted-foreground" title={row.source?.fileName ?? row.note ?? undefined}>
                    {row.source ? <>{row.source.fileName ?? "The file"}{row.source.rowNumber ? ` · row ${row.source.rowNumber}` : ""}</> : row.note || "—"}
                  </td>
                </>
              );
              const key = `${row.date}-${row.field}-${index}`;
              return row.source
                ? <ClickRow key={key} href={row.source.rowNumber ? rowHref(row.source.fileId, row.source.rowNumber) : fileHref(row.source.fileId)} label={`Open ${row.source.fileName ?? "the file"}${row.source.rowNumber ? `, row ${row.source.rowNumber}` : ""}`}>{cells}</ClickRow>
                : <tr key={key}>{cells}<td /></tr>;
            })}
          </PagedBody>
        </table>
      )}
    </PagedTableCard>
  );
}
