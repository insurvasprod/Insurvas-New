"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";

import { SourceChip, WindowDialog, days, redraftText, upcomingText, whose, windowHistoryHref, windowLabel, type WindowItem, type WindowRow } from "./carrier-terms-window-dialog";

export type { WindowRow, WindowRule } from "./carrier-terms-window-dialog";

/** A row that opens its window: one click anywhere on it; its own buttons and links keep their click. */
const opensFrom = (event: MouseEvent<HTMLElement>) => !(event.target as HTMLElement).closest("a, button, input, select, textarea, label");

/**
 * A carrier's Windows tab (board 1·1, direction B): the five retention windows, days from paid-to. A row opens that
 * window's dialog (board 1·4), never an editor inside the row; a missing window names what it costs and ends in
 * "Set it ›". Read-only accounts still open a row, read-only, with its history. The title line's "Set N windows"
 * steps through the missing ones (WindowQueueButton, on the page). On a phone each window is a card.
 */
export function CarrierRuleWindows({ carrierId, carrierName, asOf, readOnly, rows }: { carrierId: string; carrierName: string; asOf: string; readOnly: boolean; rows: WindowRow[] }) {
  const [open, setOpen] = useState<WindowItem[] | null>(null);
  const show = (row: WindowRow) => setOpen([{ carrierId, carrierName, row }]);

  const footer = (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span>Past countdowns keep the rule they used.</span>
      <span className="flex-1" />
      <Link href={windowHistoryHref(carrierId)} className="hover:underline">History of these windows ›</Link>
    </div>
  );

  return (
    <>
      <TableCard title="Retention windows" description="days from paid-to" action={<span className="text-xs text-muted-foreground">a row opens its window</span>} footer={footer}>
        <div className="hidden md:block">
          <table className="portal-lead-table w-full min-w-[900px] text-left text-sm" data-even="off">
            {/* One line a window: a missing one says so in its chip (what it costs on hover) and ends in "Set it ›". */}
            <thead>
              <tr><th className="w-[200px]">Window</th><th>Closes after</th><th>Grace</th><th>Redraft</th><th>Source</th><th>Whose</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.type} className="group cursor-pointer hover:bg-[var(--primary-soft)]" onClick={(event) => { if (opensFrom(event)) show(row); }}>
                  <td className="whitespace-nowrap">
                    <button type="button" className="font-medium text-foreground outline-none hover:underline focus-visible:underline" onClick={() => show(row)}>{windowLabel(row.type)}</button>
                  </td>
                  {row.rule && row.rule.windowDays !== null ? (
                    <>
                      <td className="whitespace-nowrap tabular-nums">{days(row.rule.windowDays)}</td>
                      <td className="whitespace-nowrap tabular-nums">{days(row.rule.graceDays)}</td>
                      <td className="whitespace-nowrap">{redraftText(row.rule)}</td>
                      <td><SourceChip source={row.rule.source} verified={row.rule.verified} /></td>
                    </>
                  ) : (
                    <>
                      <td className="text-muted-foreground">—</td>
                      <td className="text-muted-foreground">—</td>
                      <td className="text-muted-foreground">—</td>
                      <td><StatusChip tone="danger" title={row.cost}>Not set</StatusChip></td>
                    </>
                  )}
                  <td className="whitespace-nowrap" title={row.upcoming ? upcomingText(row) ?? undefined : undefined}>
                    {row.state === "missing" && !readOnly ? (
                      <button type="button" className="hover:underline" title={row.cost} onClick={() => show(row)}>Set it ›</button>
                    ) : row.rule ? whose(row.rule) : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Board 1·7: on a phone the windows stack as cards. */}
        <ul className="grid gap-3 p-4 md:hidden">
          {rows.map((row) => {
            const set = row.rule && row.rule.windowDays !== null;
            return (
              <li key={row.type} className="grid gap-2 rounded-lg border border-border bg-card p-3">
                <button type="button" className="flex items-center justify-between gap-2 text-left" onClick={() => show(row)}>
                  <span className="font-medium text-foreground">{windowLabel(row.type)}</span>
                  {set ? <span className="tabular-nums text-foreground">{days(row.rule!.windowDays)}</span> : <StatusChip tone="danger" title={row.cost}>Not set</StatusChip>}
                </button>
                {set && row.rule ? (
                  <>
                    <span className="text-xs text-muted-foreground">{[row.rule.graceDays !== null ? `grace ${days(row.rule.graceDays)}` : null, row.rule.redraftAttempts !== null ? redraftText(row.rule) : null].filter(Boolean).join(" · ") || whose(row.rule)}</span>
                    <span><SourceChip source={row.rule.source} verified={row.rule.verified} /></span>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-muted-foreground">{row.cost}</span>
                    {!readOnly && <Button type="button" className="w-full" onClick={() => show(row)}>Set it</Button>}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </TableCard>
      {open && <WindowDialog queue={open} stepping={false} asOf={asOf} readOnly={readOnly} onClose={() => setOpen(null)} />}
    </>
  );
}
