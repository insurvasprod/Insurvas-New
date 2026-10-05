"use client";

/**
 * Small pieces every LA-3 screen shares. Built on the design system (StatusChip, Button, the
 * settings `control` and `Field`), not beside it — nothing here restyles a shared component.
 */

import type { ReactNode } from "react";
import { Eye } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import {
  APPLICATION_OUTCOME_LABEL, APPLICATION_OUTCOME_TONE, APPLICATION_STATUS_LABEL, APPLICATION_STATUS_TONE,
  VALUE_SOURCE_LABEL, type ApplicationOutcome, type ApplicationStatus, type ValueSource,
} from "@/lib/applications/constants";
import type { QaVerdict } from "@/lib/applications/qa";
import { formatCentsAsCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";

export const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? "—" : formatCentsAsCurrency(cents));
/** $10,000 rather than $10,000.00 for face amounts. */
export const face = (cents: number | null | undefined) => (cents === null || cents === undefined ? "—" : `$${Math.round(cents / 100).toLocaleString("en-US")}`);

/** The one date format every LA-3 screen prints; see ./dates. */
export { dateTime, shortDate } from "./dates";
export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;

/** The tone of an attempt's status, the same on every LA-3 screen (the boards' palette: ready is the row to act on, pending carrier and counteroffer are amber). One source: APPLICATION_STATUS_TONE. */
export const ATTEMPT_STATUS_TONE = APPLICATION_STATUS_TONE;

/** Status of an attempt: the outcome once it is closed, the lifecycle state before that. */
export function AttemptStatusChip({ status, outcome }: { status: ApplicationStatus; outcome: ApplicationOutcome | null }) {
  if (status === "closed" && outcome) return <StatusChip tone={APPLICATION_OUTCOME_TONE[outcome]} dot>{APPLICATION_OUTCOME_LABEL[outcome]}</StatusChip>;
  return <StatusChip tone={ATTEMPT_STATUS_TONE[status]} dot>{APPLICATION_STATUS_LABEL[status]}</StatusChip>;
}

export function QaVerdictChip({ verdict }: { verdict: QaVerdict["verdict"] | null }) {
  if (!verdict) return <span className="text-muted-foreground">—</span>;
  if (verdict === "pass") return <StatusChip tone="good">Will go through</StatusChip>;
  if (verdict === "pass_with_warnings") return <StatusChip tone="warning">Warnings</StatusChip>;
  return <StatusChip tone="danger">Will be kicked back</StatusChip>;
}

/**
 * The "this was filled in for you" marker (LA-3.7). Prefilled values look different from typed ones
 * until the agent confirms them; a typed value shows nothing.
 */
export function SourceMark({ source, reviewed }: { source: ValueSource; reviewed: boolean }) {
  if (source === "manual") return null;
  return (
    <span
      title={reviewed ? `${VALUE_SOURCE_LABEL[source]} · checked` : `${VALUE_SOURCE_LABEL[source]} · not checked yet`}
      className={cn(
        "ml-2 inline-flex items-center rounded px-1.5 py-px align-middle text-xs font-semibold",
        reviewed ? "bg-[var(--surface-alt)] text-muted-foreground" : "bg-[var(--info-surface)] text-[var(--info-ink)]",
      )}
    >
      {VALUE_SOURCE_LABEL[source]}
    </span>
  );
}

/**
 * A sensitive value: masked, with an explicit reveal (LA-3.7). In the design phase the reveal says
 * there is nothing to reveal — it never invents a number.
 */
export function SensitiveValue({ masked, hasValue, label, onReveal }: { masked: string | undefined; hasValue: boolean | undefined; label: string; onReveal?: () => void }) {
  if (!hasValue) return <span className="text-muted-foreground">Not given</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono tabular-nums">{masked ?? "••••"}</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Reveal ${label}`}
        onClick={onReveal ?? (() => notify.done("Sample data — there is no real value to reveal."))}
      >
        <Eye aria-hidden="true" />Reveal
      </Button>
    </span>
  );
}

/** A white module on the page grey with a heading row — the lead page's section, not a new card. */
export function Panel({ title, action, children, className, id }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("min-w-0 rounded-lg border border-border bg-card shadow-[0_1px_2px_rgba(16,20,26,.05)]", className)}>
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          {title && <h2 className="text-base font-semibold tracking-[-0.01em]">{title}</h2>}
          {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

/** The one-line notice every design-phase page shows. Actionable-alert styling, not an info card. */
export function SampleDataNotice() {
  return (
    <p role="status" className="rounded-md border border-[var(--border)] border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-3 py-2 text-sm text-[var(--info-ink)]">
      Sample data — this screen is a design preview and nothing on it is saved.
    </p>
  );
}
