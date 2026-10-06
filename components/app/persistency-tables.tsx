"use client";

/**
 * LA-4.8 · one persistency breakdown (by issue cohort, carrier or lead source) as the standard list:
 * search and Refresh in the TableCard's DataToolbar, the shared Pager in its footer.
 *
 * A cell shows the share still in force at that month. With fewer than MIN_COHORT policies old
 * enough to count it shows "—" and nothing else: two of three is not a rate, and printing "2/3"
 * beside it reads as one. The counts stay in the cell's title for anyone who hovers.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ClearFiltersButton, DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/app/book-views";
import { MIN_COHORT, PERSISTENCY_MONTHS, TARGET_MONTH, TARGET_RATE, persistencyPct, type PersistencyCell, type PersistencyRow } from "@/lib/persistency/compute";

/** The words a cell is read by, on hover and to a screen reader. */
export function persistencyCellTitle(cell: PersistencyCell | undefined): string {
  if (!cell || cell.eligible === 0) return "No policy is old enough to judge at this month yet";
  if (cell.rate === null) return `${cell.alive} of ${cell.eligible} in force at month ${cell.month}; a rate needs ${MIN_COHORT} policies`;
  return `${cell.alive} of ${cell.eligible} still in force at month ${cell.month}`;
}

function Cell({ cell }: { cell: PersistencyCell | undefined }) {
  const title = persistencyCellTitle(cell);
  if (!cell || cell.rate === null) return <span className="text-muted-foreground" title={title} aria-label={title}>—</span>;
  const tone = cell.month === TARGET_MONTH && cell.rate < TARGET_RATE ? "font-semibold text-[var(--error-ink)]" : "text-foreground";
  return (
    <span className="tabular-nums" title={title}>
      <span className={tone}>{persistencyPct(cell.rate)}</span>
      <span className="ml-1.5 text-xs text-muted-foreground">{cell.alive}/{cell.eligible}</span>
    </span>
  );
}

export function PersistencyTable({ rows, noun, plural, searchLabel }: { rows: PersistencyRow[]; noun: string; plural: string; searchLabel: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(420, 45);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? rows.filter((row) => row.label.toLowerCase().includes(needle)) : rows;
  }, [rows, query]);
  const { current, rows: shown } = paginate(visible, page, pageSize);
  const clear = () => { setQuery(""); setPage(1); };

  return (
    <TableCard
      className="flex min-h-[calc(100dvh-var(--top-bar-h)-360px)] flex-col [&>.overflow-x-auto]:flex-1"
      toolbar={
        <DataToolbar actions={<>
          {query.trim() && <ClearFiltersButton onClick={clear} />}
          <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />
        </>}>
          <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder={searchLabel} />
        </DataToolbar>
      }
      footer={visible.length > 0 ? <Pager page={current} pageSize={pageSize} total={visible.length} onPage={setPage} noun={visible.length === 1 ? noun : plural} suffix={`a rate needs ${MIN_COHORT} policies old enough to count`} /> : undefined}
    >
      {rows.length === 0 ? (
        <EmptyState title={`No ${plural} to show`} hint="Rows appear once issued policies are in your book." />
      ) : visible.length === 0 ? (
        <NoMatches noun={plural} onClear={clear} />
      ) : (
        <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr>
              <th>{noun[0].toUpperCase() + noun.slice(1)}</th>
              <th className="w-[96px] text-right">Policies</th>
              {PERSISTENCY_MONTHS.map((month) => <th key={month} className="w-[130px] text-right">Month {month}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.key}>
                <td className="max-w-[260px] truncate font-semibold text-foreground" title={row.label}>{row.label}</td>
                <td className="text-right tabular-nums">{row.policies.toLocaleString("en-US")}</td>
                {PERSISTENCY_MONTHS.map((month) => <td key={month} className="text-right"><Cell cell={row.cells.find((cell) => cell.month === month)} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
