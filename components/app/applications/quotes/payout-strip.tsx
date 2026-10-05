"use client";

/**
 * The agent's payout (LA-3.6; board l3-ws-quote): estimated first-year commission per quote, from
 * the server's commission schedule and advance rules, sorted by FYC with the sort shown and
 * reversible. Agent only — the client print view has no route to it. It has no Select, never
 * reorders the comparison and never changes which quote is on the application.
 */

import { useState } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import type { QuoteView } from "@/lib/applications/types";

import { money } from "@/components/app/applications/parts";
import { contractLevel } from "./catalogue";

/** The fixed lines the sprint task requires, word for word. */
export const PAYOUT_LINE = "Recommend on fit first. Payout is shown to inform the choice between carriers the client equally qualifies for, not to choose between them.";
export const RANKING_LINE = "Ranked by your commission. This does not check whether the carrier will accept their health history.";

export function PayoutStrip({ quotes }: { quotes: QuoteView[] }) {
  const [desc, setDesc] = useState(true);
  if (quotes.length === 0) return null;

  const paid = quotes.filter((q): q is QuoteView & { payout: NonNullable<QuoteView["payout"]> } => q.payout !== null);
  const unpaid = quotes.filter((q) => q.payout === null);
  const sorted = [...paid].sort((a, b) => (desc ? b.payout.fycCents - a.payout.fycCents : a.payout.fycCents - b.payout.fycCents));
  const [top, ...rest] = sorted;

  return (
    <section aria-label="Estimated first-year commission" className="flex flex-col gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-[18px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-[0.02em] text-[var(--muted)]">Estimated first-year commission</span>
          {top ? (
            <div className="flex flex-wrap items-baseline gap-x-[18px] gap-y-1">
              <span className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums text-[var(--ink)]">{money(top.payout.fycCents)}</span>
                <span className="text-xs text-[var(--muted)]">
                  {top.carrierName} · {contractLevel(top.payout.contractLevelBp)}{top.payout.advanceMonths > 0 ? ` · ${top.payout.advanceMonths}mo advance ${money(top.payout.advanceCents)}` : " · no advance"}
                </span>
              </span>
              {rest.length > 0 && (
                <span className="text-sm text-[var(--muted)]">
                  {rest.map((q) => `${q.carrierName} ${money(q.payout.fycCents)}`).join(" · ")}
                </span>
              )}
            </div>
          ) : (
            <span className="text-sm text-[var(--muted)]">No commission schedule covers these quotes yet.</span>
          )}
          {top && unpaid.length > 0 && <span className="text-xs text-[var(--muted)]">No schedule for {unpaid.map((q) => q.carrierName).join(", ")}.</span>}
        </div>
        <span className="flex flex-wrap items-center gap-2.5">
          <StatusChip tone="neutral" dot={false}>Agent only</StatusChip>
          {paid.length > 1 && (
            <Button type="button" variant="outline" onClick={() => setDesc((d) => !d)} aria-label={desc ? "Sorted by commission, highest first. Sort lowest first." : "Sorted by commission, lowest first. Sort highest first."}>
              {desc ? <ArrowDownWideNarrow aria-hidden="true" /> : <ArrowUpNarrowWide aria-hidden="true" />}
              {desc ? "Highest first" : "Lowest first"}
            </Button>
          )}
        </span>
      </div>
      <div className="flex flex-col gap-0.5 text-xs text-[var(--muted)]">
        <p>{PAYOUT_LINE}</p>
        <p>{RANKING_LINE}</p>
      </div>
    </section>
  );
}
