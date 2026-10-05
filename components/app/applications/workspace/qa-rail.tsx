"use client";

/**
 * The live pre-submission check (LA-3.11; right rail of every l3-ws-* board). Recomputed from the
 * same attempt the step is editing, so it moves as the agent types. Blocking items are red, warnings
 * amber and never red; every line is a button that lands on the field it is about.
 */

import type { QaItem } from "@/lib/applications/qa";
import { cn } from "@/lib/utils";

import { shortDate } from "@/components/app/applications/parts";
import { useWorkspace } from "./context";

export function QaRail() {
  const { qa, goTo, readOnly, attempt, interview, timeZone } = useWorkspace();
  const frozen = attempt.submissions[attempt.submissions.length - 1];
  const started = Boolean(interview && Object.keys(interview.answers).length) || Boolean(attempt.selectedQuoteId);

  const tone = readOnly || attempt.status !== "draft" && attempt.status !== "ready" ? "neutral" : !started ? "warning" : qa.verdict === "fail" ? "danger" : qa.verdict === "pass_with_warnings" ? "warning" : "good";
  const headline = readOnly || (attempt.status !== "draft" && attempt.status !== "ready")
    ? frozen ? `Checked ${shortDate(frozen.submittedAt, { timeZone })}` : attempt.status === "closed" ? "Closed, never submitted" : "Submitted"
    : !started ? "Not started"
    : qa.blocking.length ? `${qa.blocking.length} must be fixed`
    : qa.warnings.length ? `${qa.warnings.length} worth a look`
    : "Will go through";

  const Row = ({ item, level }: { item: QaItem; level: "block" | "warn" }) => (
    <button
      type="button"
      onClick={() => goTo(item.step, item.fieldKey)}
      className="m-row flex w-full items-start gap-[9px] border-t border-[var(--border)] px-3.5 py-[9px] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span aria-hidden="true" className={cn("mt-[5px] size-[7px] shrink-0 rounded-full", level === "block" ? "bg-[var(--error)]" : "bg-[var(--warning)]")} />
      <span className="min-w-0">
        <span className="block text-xs text-[var(--body)]">{item.message}</span>
        {item.fieldKey && <span className="mt-0.5 block truncate font-mono text-xs text-[var(--muted)]">{item.fieldKey}</span>}
      </span>
    </button>
  );

  const showItems = !readOnly && (attempt.status === "draft" || attempt.status === "ready");
  return (
    <aside aria-label="Pre-submission check" className="flex flex-col overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--surface)]">
      <div className={cn(
        "border-b border-[var(--border)] p-3.5",
        tone === "danger" && "bg-[var(--error-surface)]",
        tone === "warning" && "bg-[var(--warning-surface)]",
        tone === "good" && "bg-[var(--success-surface)]",
        tone === "neutral" && "bg-[var(--surface-alt)]",
      )}>
        <div className="text-xs font-semibold uppercase tracking-[0.02em] text-[var(--muted)]">Pre-submission QA</div>
        <div className={cn(
          "mt-1 text-lg font-semibold leading-[1.28] tracking-[-0.015em]",
          tone === "danger" && "text-[var(--error-ink)]",
          tone === "warning" && "text-[var(--warning-ink)]",
          tone === "good" && "text-[var(--success-ink)]",
          tone === "neutral" && "text-[var(--ink)]",
        )} aria-live="polite">{headline}</div>
      </div>
      {showItems && qa.blocking.map((item, n) => <Row key={`b-${item.code}-${n}`} item={item} level="block" />)}
      {showItems && qa.warnings.map((item, n) => <Row key={`w-${item.code}-${n}`} item={item} level="warn" />)}
      {showItems && !qa.blocking.length && !qa.warnings.length && started && (
        <p className="border-t border-[var(--border)] px-3.5 py-[9px] text-xs text-[var(--muted)]">{qa.passed.length} checks passed.</p>
      )}
    </aside>
  );
}
