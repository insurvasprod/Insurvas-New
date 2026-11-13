"use client";

import { useState } from "react";

import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { cn } from "@/lib/utils";

/** One column of the row, as the page worked it out on the server: plain data, nothing to import here. */
export type AsSentEntry = {
  key: string;
  column: string;
  header: string;
  /** The value as a person reads it: a date as a date, money as money, Excel's =(…) wrapper dropped. */
  shown: string;
  /** The cell exactly as the file has it, when it reads differently from `shown`: the tooltip. */
  raw: string | null;
  /** What it became ("policy number", "to match the client"); null for a column the layout doesn't read. */
  became: string | null;
  /** The full words behind `became`: the field's name, its type and what was kept. */
  becameTitle: string | null;
  /** An identifier people copy or read aloud (a policy number, an agent code): monospace (§14). */
  mono: boolean;
};

/**
 * A row of a carrier file › The row as sent (round 5, board 5): every column on one list, the columns the
 * layout reads first, then those it keeps unread (a "Not read" chip). "Used N" and "All M" filter it. No paging: a row
 * has tens of columns, never hundreds, and the question "did we read this right?" needs them side by side.
 */
export function RowAsSent({ entries, missing, noMap }: { entries: AsSentEntry[]; missing: string | null; noMap: boolean }) {
  const used = entries.filter((entry) => entry.became);
  const [show, setShow] = useState<"used" | "all">("all");
  const shown = show === "used" ? used : [...used, ...entries.filter((entry) => !entry.became)];
  return (
    <TableCard
      title="The row as sent"
      action={
        <div role="radiogroup" aria-label="Which columns" className="flex items-center gap-2">
          <ToggleChip role="radio" selected={show === "used"} count={used.length} onClick={() => setShow("used")}>Used</ToggleChip>
          <ToggleChip role="radio" selected={show === "all"} count={entries.length} onClick={() => setShow("all")}>All</ToggleChip>
        </div>
      }
      footer={missing ? <p className="m-0 border-t border-border px-4 py-3 text-sm text-foreground">{missing}</p> : undefined}
    >
      {shown.length === 0 ? (
        <EmptyState
          title={show === "used" ? "No column of this row is read" : "This row has no columns"}
          hint={show === "used" ? (noMap ? "The file has no layout map yet." : "The layout map reads none of this file's columns.") : "The file kept no cell for this row."}
        />
      ) : (
        <table className="portal-lead-table w-full text-left text-sm">
          <thead><tr><th>Column</th><th>Value as sent</th><th>Became</th></tr></thead>
          <tbody>
            {/* One line per column, one text colour (owner 2026-11-11): the column's letter and the cell exactly as sent are
                tooltips; a column the layout keeps unread says so in its one chip. */}
            {shown.map((entry) => (
              <tr key={entry.key}>
                <td className="whitespace-nowrap font-medium text-foreground" title={`Column ${entry.column}`}>{entry.header}</td>
                <td className="whitespace-nowrap" title={entry.raw ?? undefined}>
                  {entry.shown === "" ? <span className="text-muted-foreground">—</span> : <span className={cn(entry.mono && "font-mono")}>{entry.shown}</span>}
                </td>
                <td className="whitespace-nowrap">
                  {entry.became ? <span title={entry.becameTitle ?? undefined}>{entry.became}</span> : <StatusChip tone="neutral">Not read</StatusChip>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
