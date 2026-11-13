"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { BarList } from "@/components/ui/chart";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/page-states";
import type { PreviewRow } from "@/lib/scoring/preview";
import { bySignalOrder, pointsFigure, scoreFigure, signalTone } from "@/lib/scoring/series";

/**
 * A lead's score (board 3·5, Reports round 7, 2026-11-11): the breakdown left the row. Title "Name · score", a line of
 * where it stands in the queue, then each signal as a bar of its weight with the points it gave solid inside
 * ("7.5 of 15 points"), in the signal's own colour. ‹ › step through the queue in order; Open the lead goes to its page.
 * The factors are score_lead's own at the preview's instant, so the points add up to the score on the row.
 */
export function LeadScoreDialog({
  rows,
  index,
  onIndex,
  agentName,
  onClose,
}: {
  rows: readonly PreviewRow[];
  /** The row open, or null for closed. */
  index: number | null;
  onIndex: (index: number) => void;
  agentName: string;
  onClose: () => void;
}) {
  const row = index === null ? null : rows[index] ?? null;
  const before = index !== null && index > 0 ? rows[index - 1] : null;
  const after = index !== null && index < rows.length - 1 ? rows[index + 1] : null;
  const name = (lead: PreviewRow | null) => lead?.name ?? "Unnamed lead";
  const parts = bySignalOrder(row?.breakdown ?? []);

  return (
    <Dialog open={row !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        size="md"
        // ‹ › with the arrow keys too, as a record's stepper does.
        onKeyDown={(event) => {
          if (index === null) return;
          if (event.key === "ArrowLeft" && before) { event.preventDefault(); onIndex(index - 1); }
          if (event.key === "ArrowRight" && after) { event.preventDefault(); onIndex(index + 1); }
        }}
      >
        {row && (
          <>
            <DialogHeader>
              <DialogTitle>{name(row)} · {scoreFigure(row.score)}</DialogTitle>
              <DialogDescription>
                {[`#${row.position} for ${agentName}`, row.state, `attempt ${row.attemptsMade + 1}`, row.cohort === "control" ? "served in plain order (the holdout)" : row.tierReason ? row.tierReason.charAt(0).toLowerCase() + row.tierReason.slice(1) : null].filter(Boolean).join(" · ")}
              </DialogDescription>
            </DialogHeader>

            {parts.length === 0 ? (
              <EmptyState title="No breakdown for this lead" hint="The scorer did not answer for this lead at the preview's instant. Refresh the preview to ask again." />
            ) : (
              <BarList
                summary={`${name(row)}'s score by signal: ${parts.map((part) => `${part.label} ${pointsFigure(part.points)} of ${pointsFigure(part.weight)}`).join(", ")}`}
                unit="points"
                labelWidth="10rem"
                rows={parts.map((part) => ({
                  key: part.signal,
                  label: part.label,
                  value: part.weight,
                  inner: part.points,
                  tone: signalTone(part.signal),
                  figure: `${pointsFigure(part.points)} of ${pointsFigure(part.weight)}`,
                  caption: "points",
                }))}
              />
            )}

            <DialogFooter className="items-center sm:justify-between">
              {row.leadId ? <Button asChild variant="outline"><Link href={`/app/leads/${row.leadId}`}>Open the lead</Link></Button> : <span />}
              <span className="flex items-center gap-2 text-sm">
                <Button type="button" variant="outline" size="sm" disabled={!before} onClick={() => index !== null && onIndex(index - 1)} title={before ? name(before) : undefined}>
                  ‹ <span className="max-w-[8rem] truncate">{before ? name(before) : "None before"}</span>
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={!after} onClick={() => index !== null && onIndex(index + 1)} title={after ? name(after) : undefined}>
                  <span className="max-w-[8rem] truncate">{after ? name(after) : "None after"}</span> ›
                </Button>
              </span>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
