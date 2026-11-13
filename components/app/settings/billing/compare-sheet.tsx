"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BILLING_CYCLE_LABELS, formatCentsAsCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";

import { n, type View } from "./types";

/**
 * A2 · Compare plans: the agency's use against each plan's limits, its plan beside the ones it can move
 * to. Picking one and "See what changes" opens the impact (a smaller plan) or the confirm (a bigger one).
 */
export function CompareSheet({ view, initial, busy, onClose, onReview }: {
  view: View;
  initial: string | null;
  busy: boolean;
  onClose: () => void;
  onReview: (planId: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(initial);
  const sub = view.subscription;
  const current = view.plan;
  const per = sub ? BILLING_CYCLE_LABELS[sub.cycle].toLowerCase() : "";
  const compare = view.compare ?? { plans: [], featureLabels: {} };
  const columns = [
    ...(current ? [{ id: current.id, name: current.name, priceCents: current.priceCents, note: "Your plan", current: true }] : []),
    ...view.options.map((o) => ({ id: o.id, name: o.name, priceCents: o.priceCents as number | null, note: compare.plans.find((p) => p.id === o.id)?.description ?? (o.applyNow ? "More room" : "A smaller plan"), current: false })),
  ];
  const planOf = (id: string) => compare.plans.find((p) => p.id === id);
  const inUse = new Set((current?.features ?? []).map((f) => f.key));
  // Features that differ between the plans shown: the ones a move would add or take away.
  const allKeys = [...new Set(compare.plans.flatMap((p) => p.features))];
  const differing = allKeys
    .filter((key) => !columns.every((c) => planOf(c.id)?.features.includes(key)))
    .sort((a, b) => (compare.featureLabels[a] ?? a).localeCompare(compare.featureLabels[b] ?? b));
  const pickedName = columns.find((c) => c.id === picked)?.name;
  const limitCell = (planId: string, key: string) => {
    const p = planOf(planId);
    if (!p) return "—";
    if (!(key in p.limits)) return "—";
    const v = p.limits[key];
    return v === null ? "Unlimited" : n(v);
  };

  return (
    <Sheet
      title="Compare plans"
      subtitle={sub ? `Prices are ${per}, on your billing cycle` : undefined}
      onClose={onClose}
      className="lg:w-[640px]"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-xs text-[var(--muted)]">{pickedName ? `${pickedName} picked` : "Pick a plan to see what changes"}</span>
          <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
          <Button type="button" disabled={!picked || busy} onClick={() => picked && onReview(picked)}>See what changes</Button>
        </div>
      }
    >
      {view.options.length === 0 ? (
        <p className="m-0 text-sm text-[var(--muted)]">No other plan is offered on your billing cycle.</p>
      ) : (
        <>
          <div role="radiogroup" aria-label="Plans" className="grid gap-2.5 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
            {columns.map((c) => {
              const on = picked === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={c.current}
                  onClick={() => setPicked(c.id)}
                  className={cn(
                    "flex min-w-0 flex-col gap-1 rounded-[12px] border bg-[var(--color-card)] px-3.5 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]",
                    on ? "border-[var(--primary)] bg-[var(--primary-soft)] shadow-[inset_0_0_0_1px_var(--primary)]" : c.current ? "border-[var(--border)] shadow-[inset_0_0_0_1px_var(--border-strong)]" : "border-[var(--border)] hover:border-[var(--border-strong)]",
                  )}
                >
                  <strong className="text-base font-semibold text-[var(--ink)]">{c.name}</strong>
                  <span className="text-base font-semibold text-[var(--ink)] tabular-nums">{c.priceCents != null ? formatCentsAsCurrency(c.priceCents) : "—"} <span className="text-xs font-normal text-[var(--muted)]">{per}</span></span>
                  <span className="text-xs text-[var(--muted)]">{c.note}</span>
                </button>
              );
            })}
          </div>

          {compare.plans.length ? (
            <div className="overflow-hidden rounded-[12px] border border-[var(--border)]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead><span className="sr-only">Limit or feature</span></TableHead>
                    <TableHead>Your use</TableHead>
                    {columns.map((c) => <TableHead key={c.id}>{c.name}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.limits.map((l) => (
                    <TableRow key={l.key}>
                      <TableCell className="font-medium text-[var(--ink)]">{l.label}</TableCell>
                      <TableCell className="tabular-nums">{n(l.used)}</TableCell>
                      {columns.map((c) => <TableCell key={c.id} className="tabular-nums">{limitCell(c.id, l.key)}</TableCell>)}
                    </TableRow>
                  ))}
                  {differing.map((key) => (
                    <TableRow key={key}>
                      <TableCell className="font-medium text-[var(--ink)]">{compare.featureLabels[key] ?? key}</TableCell>
                      <TableCell>{inUse.has(key) ? "In use" : "—"}</TableCell>
                      {columns.map((c) => <TableCell key={c.id}>{planOf(c.id)?.features.includes(key) ? "Included" : "—"}</TableCell>)}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
          <p className="m-0 text-xs text-[var(--muted)]">Usage limits reset on your renewal date. Add-ons stay with you on any plan; to add one, email <a className="font-semibold text-[var(--accent-ink)] underline-offset-2 hover:underline" href="mailto:support@insurvas.com?subject=Add-on">support@insurvas.com</a>.</p>
        </>
      )}
    </Sheet>
  );
}
