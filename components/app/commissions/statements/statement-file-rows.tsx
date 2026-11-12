"use client";

import { useState } from "react";

import { ClearFiltersButton, DataToolbar, ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { STATEMENT_FIELD_LABELS, type StatementField, type StatementLineView, type StatementMapping } from "@/lib/ledger/statementConstants";

/**
 * A statement's "The file" tab (round 7, board 1·1): the rows as the carrier sent them, every column, with the
 * column mapping used named under each header. The one place a line's source row is read (it replaced the Source row
 * toggle on every line). Lines typed in from a PDF have no carrier columns; the PDF is their file.
 */
export function StatementFileRows({ lines, headers, mapping, typed }: {
  lines: StatementLineView[];
  headers: string[];
  mapping: StatementMapping;
  /** The lines were typed in from a PDF (LA-4.2). */
  typed: boolean;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(420, 49);
  const columns = headers.length ? headers : [...new Set(lines.flatMap((line) => Object.keys(line.raw)))];
  const fieldOf = new Map<string, string>();
  for (const [field, header] of Object.entries(mapping) as Array<[StatementField, string | undefined]>) if (header) fieldOf.set(header, STATEMENT_FIELD_LABELS[field]?.label ?? field);
  const needle = search.trim().toLowerCase();
  const visible = needle ? lines.filter((line) => Object.values(line.raw).some((value) => value.toLowerCase().includes(needle))) : lines;
  const { current, rows } = paginate(visible, page, pageSize);

  return (
    <TableCard
      className="flex min-h-[calc(100dvh-var(--top-bar-h)-330px)] flex-col [&>.overflow-x-auto]:flex-1"
      toolbar={
        <DataToolbar actions={needle ? <ClearFiltersButton onClick={() => { setSearch(""); setPage(1); }} /> : undefined}>
          <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search the file" />
        </DataToolbar>
      }
      footer={columns.length ? <Pager page={current} pageSize={pageSize} total={visible.length} onPage={setPage} noun="rows" suffix={`${columns.length.toLocaleString("en-US")} columns, as the carrier sent them`} /> : undefined}
    >
      {!columns.length ? (
        <EmptyState title={typed ? "These lines were typed in from the PDF" : "The file's columns were not kept"} hint={typed ? "A PDF has no columns to show: open it from ⋯ › Original file." : "This statement was imported before the columns were kept. Open the original from ⋯ › Original file."} />
      ) : visible.length === 0 ? (
        <NoMatches noun="rows" onClear={() => { setSearch(""); setPage(1); }} />
      ) : (
        // Every carrier column, so the table scrolls sideways when the file is wide.
        <table className="portal-lead-table w-full text-left text-sm" style={{ minWidth: Math.max(720, 64 + columns.length * 150) }}>
          <thead>
            <tr>
              <th className="w-[64px] text-right">Row</th>
              {columns.map((header) => (
                <th key={header} title={fieldOf.has(header) ? `Read as ${fieldOf.get(header)}` : "Not read; kept as the carrier sent it"}>
                  {header}
                  {fieldOf.has(header) && <span className="ml-1.5 font-normal">→ {fieldOf.get(header)}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((line) => (
              <tr key={line.id}>
                <td className="text-right font-medium tabular-nums text-foreground">{line.lineNumber}</td>
                {columns.map((header) => {
                  const value = line.raw[header] ?? "";
                  return <td key={header} className="max-w-[240px] truncate whitespace-nowrap" title={value || undefined}>{value === "" ? <span className="text-muted-foreground">—</span> : value}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
