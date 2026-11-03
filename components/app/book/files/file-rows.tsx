"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";

import { DecideInPlace } from "@/components/app/book/needs-you/decide-in-place";
import { Button } from "@/components/ui/button";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { fillLine } from "@/components/ui/table-card-layout";
import { MAX_ROWS } from "@/components/ui/use-fitting-page-size";
import { cn } from "@/lib/utils";
import type { NeedsYouKind } from "@/lib/needsYou/kinds";

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
  /** The Needs you item this row waits on, decided under the row. */
  item: { kind: NeedsYouKind; id: string } | null;
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
 * A file's rows, in their TableCard with the page's toolbar and pager (round 4, owner 2026-11-02: "I want you to be able to fix it … right away in that page"). A row
 * that waits on a person has Decide: its item opens under it, the same form as its Needs you page; saving marks
 * it Saved and opens the next waiting row of this page, and the page refreshes behind it. Every other row opens
 * its own page. No sentence repeats down the table: the outcome is a short chip, the full line its tooltip.
 */
export function FileRowsTable({ rows: all, openFirst = false, canDecide, toolbar, empty }: { rows: FileRowLine[]; openFirst?: boolean; canDecide: boolean; toolbar?: ReactNode; empty?: ReactNode }) {
  const holder = useRef<HTMLDivElement | null>(null);
  const size = useFittedRows(holder, all.length);
  const [page, setPage] = useState(1);
  const { rows, current } = paginate(all, page, size);
  const waiting = all.filter((row) => row.item);
  // A column of dashes says nothing: Changed shows only when a row on this page changed something.
  const changed = rows.some((row) => row.detail !== "—");
  // The next waiting row may be on a later page: open it there.
  const openRow = (rowNumber: number | null) => {
    setOpen(rowNumber);
    const at = rowNumber === null ? -1 : all.findIndex((row) => row.rowNumber === rowNumber);
    if (at >= 0) setPage(Math.floor(at / size) + 1);
  };
  const [open, setOpen] = useState<number | null>(openFirst && canDecide ? waiting[0]?.rowNumber ?? null : null);
  const [saved, setSaved] = useState<ReadonlySet<number>>(new Set());
  const nextAfter = (rowNumber: number, skip: ReadonlySet<number>) => {
    const at = waiting.findIndex((row) => row.rowNumber === rowNumber);
    return waiting.slice(at + 1).find((row) => !skip.has(row.rowNumber))?.rowNumber ?? null;
  };

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
          <th className="text-right"><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isOpen = open === row.rowNumber && row.item !== null;
          const done = saved.has(row.rowNumber);
          return (
            <Fragment key={row.rowNumber}>
              <tr data-line="" className={cn(done && "opacity-60", isOpen && "bg-[var(--surface-alt)]")}>
                <td>
                  {row.policyHref ? <Link href={row.policyHref} className="block truncate font-semibold text-foreground hover:underline">{row.policyNumber}</Link>
                    : <span className="block truncate font-semibold text-foreground">{row.policyNumber ?? "—"}</span>}
                  <span className="block text-xs tabular-nums text-muted-foreground">Row {row.rowNumber}</span>
                </td>
                <td className={cn("truncate", row.clientName ? "text-foreground" : "text-muted-foreground")} title={row.clientName ?? undefined}>{row.clientName ?? (row.policyNumber ? "No client yet" : "—")}</td>
                <td><span title={row.chipTitle}><StatusChip tone={done ? "good" : row.tone}>{done ? "Saved" : row.chip}</StatusChip></span></td>
                {changed && <td><span className="block truncate" title={row.detail}>{row.detail}</span></td>}
                <td className="truncate text-muted-foreground" title={row.linkedTitle}>{row.linked}</td>
                <td className="truncate text-muted-foreground" title={row.card}>{row.card}</td>
                <td className="text-right">
                  {row.item && canDecide && !done ? (
                    <Button type="button" size="sm" variant="outline" aria-expanded={isOpen} aria-controls={`decide-${row.rowNumber}`} onClick={() => setOpen(isOpen ? null : row.rowNumber)}>{isOpen ? "Close" : "Decide"}</Button>
                  ) : (
                    <Button asChild variant="outline" size="sm"><Link href={row.rowHref} aria-label={`Open row ${row.rowNumber}`}>Open</Link></Button>
                  )}
                </td>
              </tr>
              {isOpen && row.item && (
                <tr id={`decide-${row.rowNumber}`}>
                  <td colSpan={changed ? 7 : 6} className="!h-auto border-b border-[var(--border)] bg-[var(--surface-alt)] !p-0">
                    {/* The panel takes the row's width and adds none, so the columns above never move. */}
                    <div className="w-0 min-w-full">
                      <DecideInPlace
                        key={`${row.item.kind}:${row.item.id}`}
                        kind={row.item.kind}
                        id={row.item.id}
                        onClose={() => setOpen(null)}
                        inline={{
                          hasNext: nextAfter(row.rowNumber, saved) !== null,
                          onSkip: () => openRow(nextAfter(row.rowNumber, saved)),
                          onDone: (how) => {
                            const next = new Set(saved).add(row.rowNumber);
                            setSaved(next);
                            openRow(how === "next" ? nextAfter(row.rowNumber, next) : null);
                          },
                        }}
                      />
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
    )}
    </TableCard>
    </div>
  );
}
