import Link from "next/link";

import { TableCard } from "@/components/ui/table-card";
import { rowHref } from "@/lib/ingestion/trace";
import type { RowAsSent } from "@/lib/needsYou/store";

/** The carrier's row exactly as it arrived: every column, its value, and the field the layout read it as. */
export function RowAsSentTable({ row }: { row: RowAsSent }) {
  return (
    <TableCard
      title={`Row ${row.rowNumber} of ${row.fileName}`}
      description="Every column as the carrier sent it, and what the layout read it as."
      action={<Link href={rowHref(row.fileId, row.rowNumber)} className="text-sm font-medium text-[var(--accent-ink)] hover:underline">Open the row’s page</Link>}
    >
      <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
        <thead><tr><th className="w-[90px]">Column</th><th>Header</th><th>Value</th><th>Read as</th></tr></thead>
        <tbody>
          {row.columns.map((column) => (
            <tr key={`${column.column}:${column.header}`}>
              {/* Owner 2026-11-11: one line, one text colour; only "—" is muted. */}
              <td className="whitespace-nowrap font-mono font-medium text-foreground">{column.column}</td>
              <td className="whitespace-nowrap">{column.header}</td>
              <td className="whitespace-nowrap">{column.value || <span className="text-muted-foreground">—</span>}</td>
              <td className="whitespace-nowrap">{column.readAs ? column.readAs.replaceAll("_", " ") : "kept, not read"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}
