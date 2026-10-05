"use client";

/**
 * Quotes side by side (LA-3.5; board l3-ws-quote): one column per quote — monthly premium, face,
 * per $1,000, Appointed?, payment method, advance, and for term the term, health class and annual
 * premium. Selecting one puts it on the application and marks the others discarded; they stay here
 * (and on /app/quoting) so the choice can be read back or changed. Agent-only: the client's copy is
 * the print view, which has none of these rows.
 */

import type { ReactNode } from "react";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import type { QuoteView } from "@/lib/applications/types";
import { premiumPer1000 } from "@/lib/quotes/math";
import { cn } from "@/lib/utils";

import { face, money } from "@/components/app/applications/parts";
import { tierLabel } from "./catalogue";

type Row = { key: string; label: string; cell: (q: QuoteView) => ReactNode };

const COLS: Record<number, string> = { 1: "md:grid-cols-1", 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4" };

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
  const anyTerm = quotes.some((q) => q.termLength);
  const rows: Row[] = [
    { key: "monthly", label: "Monthly premium", cell: (q) => money(q.monthlyPremiumCents) },
    ...(anyTerm ? [{ key: "annual", label: "Annual premium", cell: (q: QuoteView) => (q.annualPremiumCents ? money(q.annualPremiumCents) : "—") }] : []),
    { key: "face", label: "Face amount", cell: (q) => face(q.faceAmountCents) },
    ...(anyTerm ? [
      { key: "term", label: "Term", cell: (q: QuoteView) => (q.termLength ? `${q.termLength} years` : "—") },
      { key: "class", label: "Health class", cell: (q: QuoteView) => q.healthClass ?? "—" },
    ] : []),
    { key: "per1000", label: "Per $1,000", cell: (q) => { const p = premiumPer1000(q.monthlyPremiumCents, q.faceAmountCents); return p === null ? "—" : `$${p.toFixed(2)}`; } },
    {
      key: "appointed", label: "Appointed?", cell: (q) => q.appointed.ok
        ? <StatusChip tone="good">Yes</StatusChip>
        : (
          <span className="inline-flex flex-col items-end gap-1">
            <StatusChip tone="danger">No</StatusChip>
            <span className="max-w-[180px] text-right text-xs font-normal whitespace-normal text-[var(--muted)]">{q.appointed.reason ?? "No active appointment covers the client's state."} It still saves.</span>
          </span>
        ),
    },
    {
      key: "payment", label: "Payment method", cell: (q) => q.acceptsPaymentMethod === null
        ? <span className="text-[var(--muted)]" title={paymentMethodLabel ? "This product lists no payment methods" : "Choose a payment method on the Payment step first"}>—</span>
        : q.acceptsPaymentMethod
          ? <StatusChip tone="good" title={paymentMethodLabel ? `Takes ${paymentMethodLabel.toLowerCase()}` : undefined}>Accepted</StatusChip>
          : <StatusChip tone="warning" title={paymentMethodLabel ? `Does not take ${paymentMethodLabel.toLowerCase()}` : undefined}>Not accepted</StatusChip>,
    },
    { key: "advance", label: "Advance", cell: (q) => (q.payout && q.payout.advanceMonths > 0 ? `${q.payout.advanceMonths} months` : "—") },
  ];

  return (
    <div className={cn("grid gap-4", COLS[Math.min(Math.max(quotes.length, 1), 4)])}>
      {quotes.map((q) => {
        const selected = q.status === "selected";
        return (
          <section key={q.id} aria-label={`${q.carrierName} quote`} className="flex min-w-0 flex-col rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
            <div className={cn("rounded-t-[11px] px-3.5 py-3", selected ? "bg-[var(--brand-50)]" : "bg-[var(--surface-alt)]")}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate text-sm font-semibold text-[var(--ink)]">{q.carrierName}</h3>
                {expiredIds?.has(q.id) && <StatusChip tone="warning" title="Older than this template's validity. Check the premium in the carrier's own tool.">Quote expired</StatusChip>}
              </div>
              <p className="truncate text-xs text-[var(--muted)]">{q.productLabel} · {tierLabel(q.tier)}</p>
            </div>
            <dl className="flex flex-col">
              {rows.map((r) => (
                <div key={r.key} className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-3.5 py-[9px]">
                  <dt className="text-xs text-[var(--muted)]">{r.label}</dt>
                  <dd className="text-right text-sm font-semibold tabular-nums text-[var(--ink)]">{r.cell(q)}</dd>
                </div>
              ))}
            </dl>
            {q.warnings.length > 0 && (
              <ul className="border-t border-[var(--border)] px-3.5 py-2 text-xs text-[var(--warning-ink)]">
                {q.warnings.map((w) => <li key={w.code}>{w.message}</li>)}
              </ul>
            )}
            {!readOnly && (
              <div className="mt-auto border-t border-[var(--border)] px-3.5 py-3">
                {selected ? (
                  <span role="status" className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground">
                    <Check className="size-4" aria-hidden="true" />Selected
                  </span>
                ) : (
                  <Button type="button" variant="outline" className="w-full" disabled={busyId !== null} title={busyId !== null ? "Saving the selection" : undefined} onClick={() => onSelect(q)}>
                    {busyId === q.id ? "Selecting…" : "Select"}
                  </Button>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
