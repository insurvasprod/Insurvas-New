"use client";

/**
 * The quotes on this attempt (LA-3.5; owner pick C, 2026-10-28, canvas M3 · Application): one row per
 * quote, the carrier and product, the monthly premium, what the agent earns, and "Use this quote".
 * The details the old side-by-side columns held (face, per $1,000, term, class, annual, payment method,
 * advance, appointment) stay on the row as chips and one line of facts. Using one puts it on the
 * application and marks the others discarded; they stay here (and on /app/quoting) so the choice can be
 * read back or changed. Agent-only: the client's copy is the print view.
 */

import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import type { QuoteView } from "@/lib/applications/types";
import { premiumPer1000 } from "@/lib/quotes/math";
import { cn } from "@/lib/utils";

import { face, money } from "@/components/app/applications/parts";
import { tierLabel } from "./catalogue";

export function QuoteComparison({ quotes, onSelect, busyId, readOnly, paymentMethodLabel, expiredIds }: {
  quotes: QuoteView[];
  onSelect: (q: QuoteView) => void;
  /** The quote whose selection is being saved. */
  busyId: string | null;
  readOnly: boolean;
  paymentMethodLabel: string | null;
  /** Quotes older than their template's validity (LA-3.4): marked, still selectable. */
  expiredIds?: ReadonlySet<string>;
}) {
  return (
    <ul aria-label="Quotes" className="m-0 flex list-none flex-col gap-3 p-0">
      {quotes.map((q) => {
        const selected = q.status === "selected";
        const per1000 = premiumPer1000(q.monthlyPremiumCents, q.faceAmountCents);
        const facts = [
          `${face(q.faceAmountCents)} · ${tierLabel(q.tier)}`,
          q.termLength ? `${q.termLength}-year term` : null,
          q.healthClass,
          q.annualPremiumCents ? `${money(q.annualPremiumCents)} a year` : null,
          per1000 === null ? null : `$${per1000.toFixed(2)} per $1,000`,
        ].filter(Boolean).join(" · ");
        return (
          <li
            key={q.id}
            aria-label={`${q.carrierName} quote`}
            className={cn(
              "grid min-w-0 items-center gap-x-4 gap-y-3 rounded-xl border-[1.5px] px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_110px_170px_180px]",
              selected ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)] bg-[var(--surface)]",
              !q.appointed.ok && !selected && "opacity-80",
            )}
          >
            <span className="flex min-w-0 flex-col gap-1">
              <strong className="truncate text-base font-semibold text-[var(--ink)]">{q.carrierName}</strong>
              <span className="truncate text-xs text-[var(--muted)]">{q.productLabel} · {facts}</span>
              <span className="flex flex-wrap gap-1.5">
                {!q.appointed.ok && <StatusChip tone="danger" title={`${q.appointed.reason ?? "No active appointment covers the client's state."} It still saves.`}>Not appointed</StatusChip>}
                {expiredIds?.has(q.id) && <StatusChip tone="warning" title="Older than this template's validity. Check the premium in the carrier's own tool.">Quote expired</StatusChip>}
                {q.acceptsPaymentMethod === false && <StatusChip tone="warning" title={paymentMethodLabel ? `Does not take ${paymentMethodLabel.toLowerCase()}` : undefined}>Payment not accepted</StatusChip>}
                {q.acceptsPaymentMethod === true && paymentMethodLabel && <StatusChip tone="good" dot={false}>{paymentMethodLabel} accepted</StatusChip>}
              </span>
              {q.warnings.length > 0 && (
                <ul className="m-0 list-none p-0 text-xs text-[var(--warning-ink)]">
                  {q.warnings.map((w) => <li key={w.code}>{w.message}</li>)}
                </ul>
              )}
            </span>
            <span className="flex flex-col">
              <strong className="text-base font-semibold tabular-nums text-[var(--ink)]">{money(q.monthlyPremiumCents)}</strong>
              <span className="text-xs text-[var(--muted)]">a month</span>
            </span>
            {/* No commission schedule for this quote: the column stays empty rather than showing a dash. */}
            {!q.payout ? <span /> : <span className="flex flex-col">
              <span className="text-xs text-[var(--muted)]">You earn</span>
              <strong className="text-sm font-semibold tabular-nums text-[var(--ink)]">{money(q.payout.fycCents)} first year</strong>
              <span className="text-xs text-[var(--muted)]">{q.payout.advanceMonths > 0 ? `${q.payout.advanceMonths}-month advance` : "No advance"}</span>
            </span>}
            {readOnly ? (
              selected ? <StatusChip tone="good">On the application</StatusChip> : <span />
            ) : selected ? (
              <span role="status" className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border-[1.5px] border-[var(--primary)] text-sm font-semibold text-[var(--accent-ink)]">
                <Check className="size-4" aria-hidden="true" />On the application
              </span>
            ) : (
              <Button type="button" variant="outline" disabled={busyId !== null} title={busyId !== null ? "Saving the selection" : undefined} onClick={() => onSelect(q)}>
                {busyId === q.id ? "Using it…" : "Use this quote"}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
