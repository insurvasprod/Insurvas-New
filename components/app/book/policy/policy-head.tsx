import type { ReactNode } from "react";

import { StatusChip, type StatusTone } from "@/components/ui/status-chip";

/**
 * The top of a policy's detail page, under the frame's title (Book of business, round 2): the status chip
 * and the one line of facts ("AM-88120 · Americo · Eagle Premier"), then a quiet line of figures (the
 * mockups' stat line: label over value, no tiles, so the Commissions tab's tiles stay the page's one strip).
 */
export function PolicyLead({ status, tone, facts, notices }: { status: string; tone: StatusTone; facts: Array<string | null | undefined>; notices?: ReactNode }) {
  const line = facts.filter(Boolean).join(" · ");
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      <StatusChip tone={tone}>{status}</StatusChip>
      <span className="min-w-0 truncate text-sm text-muted-foreground" title={line}>{line}</span>
      {/* Round 3: what used to be the Overview's status lines (a provisional client, the linked application,
          no client yet), as chips and links on the facts line. */}
      {notices && <span className="flex shrink-0 flex-wrap items-center gap-3 text-sm">{notices}</span>}
    </div>
  );
}

export type Fact = { label: string; value: ReactNode; tone?: "warning" | "danger"; hint?: string };

export function FactLine({ label, facts }: { label: string; facts: Fact[] }) {
  if (!facts.length) return null;
  return (
    <dl aria-label={label} className="m-0 flex flex-wrap items-baseline gap-x-8 gap-y-3">
      {facts.map((fact) => (
        <div key={fact.label} className="flex min-w-0 flex-col gap-0.5" title={fact.hint}>
          <dt className="text-xs text-muted-foreground">{fact.label}</dt>
          <dd className={`m-0 text-sm font-semibold tabular-nums ${fact.tone === "danger" ? "text-[var(--error-ink)]" : fact.tone === "warning" ? "text-[var(--warning-ink)]" : "text-foreground"}`}>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A card's facts, two or three to a row: term over value. */
export function FactGrid({ items, cols = 3 }: { items: Array<[string, ReactNode]>; cols?: 2 | 3 }) {
  return (
    <dl className={`m-0 grid gap-x-6 gap-y-3 px-4 py-4 text-sm ${cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
      {items.map(([term, value]) => (
        <div key={term} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{term}</dt>
          <dd className="m-0 truncate font-medium text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
