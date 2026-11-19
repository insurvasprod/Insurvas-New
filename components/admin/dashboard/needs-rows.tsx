import Link from "next/link";

import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState } from "@/components/ui/page-states";
import { DashboardRefresh } from "@/components/admin/dashboard-refresh";
import { cn } from "@/lib/utils";
import type { AdminRole } from "@/lib/adminAuth/roles";
import { canOpenAdminHref } from "@/lib/adminDashboard/compose";
import { needsRowsFor, type NeedsTable } from "@/lib/adminDashboard/needsRows";

/**
 * The rows a daily check counts, in Needs you's right pane: one line a row, one text colour, colour only in
 * the row's one chip, and the row opens its record when the role can open that page. Streams on its own and
 * fails on its own (the pane keeps its explanation and its action).
 */
export async function NeedsRows({ checkKey, admin, pageHref, pageLabel }: { checkKey: string; admin: { id: string; role: AdminRole }; pageHref: string; pageLabel: string }) {
  let table: NeedsTable | null;
  try {
    table = await needsRowsFor(checkKey, admin);
  } catch (error) {
    console.error(`[admin-needs] ${checkKey}:`, error instanceof Error ? error.message : error);
    return <ErrorState title="Couldn't load these rows" detail="The rows behind this check didn't answer just now. The rest of the page is current." action={<DashboardRefresh />} />;
  }
  if (!table) return null;
  if (table.rows.length === 0) return <EmptyState title="Nothing here now" hint="The check found none when it read the rows. It may have cleared since the count above." />;

  const width = table.rows[0].cells.length;
  const hasChip = table.rows.some((row) => row.chip);
  const heads = hasChip && table.columns.length === width ? [...table.columns, { label: "" }] : table.columns;
  const more = table.total - table.rows.length;
  const pageOpen = canOpenAdminHref(admin.role, pageHref);

  return (
    <div className="min-w-0">
      <Table>
        <TableHeader>
          <TableRow>
            {heads.map((column, index) => (
              <TableHead key={`${column.label}-${index}`} className={cn(column.align === "right" && "text-right", index === 0 && "pl-4")}>
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.map((row) => {
            const href = row.href && canOpenAdminHref(admin.role, row.href) ? row.href : null;
            return (
              <TableRow key={row.key} className={cn(href && "relative")}>
                {row.cells.map((cell, index) => (
                  <TableCell key={index} className={cn("max-w-[280px] truncate", heads[index]?.align === "right" && "text-right tabular-nums", index === 0 && "pl-4 font-medium text-foreground")}>
                    {index === 0 && href ? (
                      <Link href={href} className="outline-none after:absolute after:inset-0 hover:underline focus-visible:underline">
                        {cell}
                      </Link>
                    ) : (
                      cell
                    )}
                  </TableCell>
                ))}
                {hasChip && <TableCell>{row.chip ? <StatusChip tone={row.chip.tone}>{row.chip.label}</StatusChip> : null}</TableCell>}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {more > 0 && (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          and {more.toLocaleString("en-US")} more
          {pageOpen && (
            <>
              {" · "}
              <Link href={pageHref} className="font-medium text-foreground underline underline-offset-2">
                {pageLabel}
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
