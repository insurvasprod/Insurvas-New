"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { fillLine } from "@/components/ui/table-card-layout";
import { MAX_ROWS } from "@/components/ui/use-fitting-page-size";
import { cn } from "@/lib/utils";

/** One row of a file as the table shows it: every word already chosen on the server. */
export type FileRowLine = {
  rowNumber: number;
  policyNumber: string | null;
  policyHref: string | null;
  clientName: string | null;
  /** The outcome chip: a short label, the full sentence in its tooltip. */
  chip: string;
  chipTitle: string;
  tone: "warning" | "good" | "info" | "neutral" | "action";
  /** What this row changed (fields, lines, a held word); "—" when the chip already says it. */
  detail: string;
  linked: string;
  linkedTitle: string;
  card: string;
  rowHref: string;
  /** The Needs you item this row waits on: its Review page address (round 5), else null. */
  reviewHref: string | null;
};

/** The pager row's height before it is drawn (as components/ui/paged.tsx). */
const PAGER_ROW = 57;

/**
 * The table foundation's fitted page (UI-CONSISTENCY §6b, as PagedTableCard): as many rows as fit above the
 * screen's foot, the pager on that line; 10 when the card is not the page's last block. Measured from the data
 * rows only (`data-line`), so a row opened to decide never shrinks the page under it.
 */
function useFittedRows(holder: RefObject<HTMLDivElement | null>, total: number, fallback = 10) {
  const [size, setSize] = useState(fallback);
  useEffect(() => {
    const measure = (current: number) => {
      const card = holder.current?.querySelector<HTMLElement>('[data-slot="table-card"]');
      if (!card) return current;
      const line = fillLine(card);
      if (line === null) return fallback;
      const lines = [...card.querySelectorAll<HTMLElement>("tbody tr[data-line]")].map((row) => row.offsetHeight).filter(Boolean);
      const first = card.querySelector<HTMLElement>("tbody tr[data-line]");
      if (!lines.length || !first) return current;
      const each = lines.reduce((sum, height) => sum + height, 0) / lines.length;
      const room = line - first.getBoundingClientRect().top - (total > lines.length || total > current ? PAGER_ROW : 0) - 2;
      return Math.max(3, Math.min(MAX_ROWS, Math.floor(room / each)));
    };
    let frame = 0;
    const fit = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setSize((current) => measure(current))); };
    fit();
    const sizes = new ResizeObserver(fit);
    const main = document.querySelector("main");
    if (main) sizes.observe(main);
    window.addEventListener("resize", fit);
    return () => { cancelAnimationFrame(frame); sizes.disconnect(); window.removeEventListener("resize", fit); };
  }, [holder, total, fallback]);
  return size;
}

/**
 * A file's rows, in their TableCard with the page's toolbar and pager. Round 5 (owner 2026-11-03: "I don't want to
 * have that in my table"): the table only lists. The whole row opens the row's page; a row that waits on a person
 * says Review, which opens the Review page at its item. No sentence repeats down the table: the outcome is a short
 * chip, the full line its tooltip.
 */
export function FileRowsTable({ rows: all, toolbar, empty, pageKey = "" }: { rows: FileRowLine[]; toolbar?: ReactNode; empty?: ReactNode; /** A new search (`?q=`) starts at page 1 without remounting the toolbar, so the search box keeps its focus. */ pageKey?: string }) {
  const router = useRouter();
  const holder = useRef<HTMLDivElement | null>(null);
  const size = useFittedRows(holder, all.length);
  const [page, setPage] = useState(1);
  const [pagedFor, setPagedFor] = useState(pageKey);
  if (pagedFor !== pageKey) { setPagedFor(pageKey); setPage(1); }
  const { rows, current } = paginate(all, page, size);
  // A column of dashes says nothing: Changed shows only when a row on this page changed something.
  const changed = rows.some((row) => row.detail !== "—");

  return (
    <div ref={holder} className="contents">
    <TableCard toolbar={toolbar} footer={!empty && all.length ? <Pager page={current} pageSize={size} total={all.length} noun="rows" onPage={setPage} /> : undefined}>
    {empty ?? (
    <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
      <thead>
        <tr>
          {/* Every column carries its own fact, so the even spread (§6b) never leaves one standing empty: the row
              number is the policy's second line, the client its own column. */}
          <th>Policy</th>
          <th>Client</th>
          <th>Outcome</th>
          {changed && <th>Changed</th>}
          <th>Linked</th>
          <th>Card</th>
          <th className="text-right"><span className="sr-only">Next step</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.rowNumber} data-line="" className="group cursor-pointer" onClick={() => router.push(row.rowHref)}>
            <td>
              {row.policyHref ? <Link href={row.policyHref} onClick={(event) => event.stopPropagation()} className="block truncate font-semibold text-foreground hover:underline">{row.policyNumber}</Link>
                : <span className="block truncate font-semibold text-foreground">{row.policyNumber ?? "—"}</span>}
              <span className="block text-xs tabular-nums text-muted-foreground">Row {row.rowNumber}</span>
            </td>
            <td className={cn("truncate", row.clientName ? "text-foreground" : "text-muted-foreground")} title={row.clientName ?? undefined}>{row.clientName ?? (row.policyNumber ? "No client yet" : "—")}</td>
            <td><span title={row.chipTitle}><StatusChip tone={row.tone}>{row.chip}</StatusChip></span></td>
            {changed && <td><span className="block truncate" title={row.detail}>{row.detail}</span></td>}
            <td className="truncate text-muted-foreground" title={row.linkedTitle}>{row.linked}</td>
            <td className="truncate text-muted-foreground" title={row.card}>{row.card}</td>
            <td className="text-right">
              {row.reviewHref ? (
                <Link href={row.reviewHref} onClick={(event) => event.stopPropagation()} className="font-semibold text-[var(--accent-ink)] hover:underline">Review</Link>
              ) : (
                <Link href={row.rowHref} aria-label={`Open row ${row.rowNumber}`} className="text-muted-foreground group-hover:text-foreground">›</Link>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    )}
    </TableCard>
    </div>
  );
}
