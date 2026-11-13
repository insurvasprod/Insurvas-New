"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { fillLine } from "@/components/ui/table-card-layout";
import { MAX_ROWS } from "@/components/ui/use-fitting-page-size";

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
  const moved = rows.some((row) => row.card !== "—");

  return (
    <div ref={holder} className="contents">
    <TableCard toolbar={toolbar} footer={!empty && all.length ? <Pager page={current} pageSize={size} total={all.length} noun="rows" onPage={setPage} /> : undefined}>
    {empty ?? (
    <table className="portal-lead-table w-full text-left text-sm">
      <thead>
        <tr>
          {/* One line per row (owner 2026-11-11): the row number is the policy's tooltip (the value when the row made no
              policy), how the client was linked is the client's. Changed and Card show only when this page has one. */}
          <th>Policy</th>
          <th>Client</th>
          <th>Outcome</th>
          {changed && <th>Changed</th>}
          {moved && <th>Card</th>}
          <th>Next step</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.rowNumber} data-line="" className="cursor-pointer" onClick={() => router.push(row.rowHref)}>
            <td className="whitespace-nowrap font-medium tabular-nums text-foreground" title={`Row ${row.rowNumber}`}>
              {row.policyHref ? <Link href={row.policyHref} onClick={(event) => event.stopPropagation()} className="hover:underline">{row.policyNumber}</Link>
                : row.policyNumber ?? `Row ${row.rowNumber}`}
            </td>
            <td className="whitespace-nowrap" title={`Linked: ${row.linkedTitle}`}>{row.clientName ?? <span className="text-muted-foreground">—</span>}</td>
            <td><StatusChip tone={row.tone} title={row.chipTitle}>{row.chip}</StatusChip></td>
            {changed && <td className="max-w-[360px] truncate whitespace-nowrap" title={row.detail}>{row.detail === "—" ? <span className="text-muted-foreground">—</span> : row.detail}</td>}
            {moved && <td className="whitespace-nowrap">{row.card === "—" ? <span className="text-muted-foreground">—</span> : row.card}</td>}
            <td className="whitespace-nowrap">
              {row.reviewHref ? (
                <Link href={row.reviewHref} onClick={(event) => event.stopPropagation()} className="hover:underline">Review ›</Link>
              ) : (
                <Link href={row.rowHref} aria-label={`Open row ${row.rowNumber}`} onClick={(event) => event.stopPropagation()} className="hover:underline">Open ›</Link>
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
