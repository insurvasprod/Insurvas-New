import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A record's facts as a table (owner 2026-11-06, Retention: "make it tables if there's any need"): a label on
 * the left, its value on the right, a hairline between rows. For the facts of one record inside a card (a
 * case's "From the files", a request's change), not a list of records: that is a TableCard. Rows whose value is
 * null, undefined or "" are left out.
 */
export function FactTable({ rows, labelWidth = 140, className }: { rows: Array<[string, ReactNode]>; labelWidth?: number; className?: string }) {
  const shown = rows.filter(([, value]) => value !== null && value !== undefined && value !== "");
  return (
    <table className={cn("w-full text-sm", className)}>
      <tbody>
        {shown.map(([label, value]) => (
          <tr key={label} className="border-b border-border last:border-b-0">
            <th scope="row" className="py-2 pr-3 text-left align-top text-xs font-semibold text-muted-foreground" style={{ width: labelWidth }}>{label}</th>
            <td className="py-2 text-foreground tabular-nums">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
