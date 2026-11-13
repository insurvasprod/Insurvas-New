import type { ReactNode } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export type NumberedStep = {
  key: string;
  title: string;
  detail?: string;
  /** Small facts under the detail: "Time 2 hours", "Cost $40–$150", "Video 0:34". */
  facts?: { label?: string; value: string }[];
  state?: "done" | "current" | "todo";
  /** Right of the step: a chip, a button. */
  side?: ReactNode;
  /** Under the step: a picture, a form. */
  children?: ReactNode;
};

/**
 * Steps in order, numbered on one line (Docs and Get set up R4, owner 2026-11-13: "exactly step by step"). A done
 * step turns green and the line fills up to it; the current step's number carries the accent ring.
 */
export function NumberedSteps({ steps, className }: { steps: NumberedStep[]; className?: string }) {
  return (
    <ol className={cn("m-0 flex list-none flex-col p-0", className)}>
      {steps.map((step, index) => {
        const state = step.state ?? "todo";
        const last = index === steps.length - 1;
        return (
          <li key={step.key} className="relative grid grid-cols-[36px_minmax(0,1fr)_auto] gap-x-3.5 py-3">
            {!last ? <span aria-hidden="true" className={cn("absolute top-[50px] bottom-[-8px] left-[17px] w-0.5", state === "done" ? "bg-[var(--primary)]" : "bg-[var(--border)]")} /> : null}
            <span
              aria-hidden="true"
              className={cn(
                "relative z-[1] inline-flex size-9 items-center justify-center rounded-full border-2 text-sm font-semibold tabular-nums",
                state === "done" && "border-transparent bg-[var(--success-surface,var(--primary-soft))] text-[var(--success)]",
                state === "current" && "border-[var(--primary)] bg-[var(--color-card)] text-[var(--accent-ink)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--primary)_18%,transparent)]",
                state === "todo" && "border-[var(--border)] bg-[var(--color-card)] text-[var(--muted)]",
              )}
            >
              {state === "done" ? <Check className="size-4" strokeWidth={3} /> : index + 1}
            </span>
            <div className="min-w-0">
              <p className="m-0 text-sm font-semibold text-[var(--ink)]">
                <span className="sr-only">{state === "done" ? "Done: " : state === "current" ? "Now: " : ""}</span>
                {step.title}
              </p>
              {step.detail ? <p className="m-0 mt-0.5 text-sm text-[var(--muted)]">{step.detail}</p> : null}
              {step.facts && step.facts.length > 0 ? (
                <p className="m-0 mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
                  {step.facts.map((fact, at) => (
                    <span key={at}>{fact.label ? <span className="font-semibold text-[var(--body)]">{fact.label} </span> : null}{fact.value}</span>
                  ))}
                </p>
              ) : null}
              {step.children}
            </div>
            <div className="flex flex-col items-end gap-1.5">{step.side}</div>
          </li>
        );
      })}
    </ol>
  );
}

/** A few figures side by side in one bordered strip: "Total time 4–8 weeks · Typical cost … · Steps 6". */
export function FactsStrip({ facts, className }: { facts: { label: string; value: string }[]; className?: string }) {
  return (
    <dl className={cn("m-0 grid overflow-hidden rounded-[12px] border border-[var(--border)]", className)} style={{ gridTemplateColumns: `repeat(${facts.length}, minmax(0, 1fr))` }}>
      {facts.map((fact) => (
        <div key={fact.label} className="min-w-0 border-r border-[var(--border)] px-3.5 py-3 last:border-r-0">
          <dt className="truncate text-xs text-[var(--muted)]">{fact.label}</dt>
          <dd className="m-0 truncate text-base font-semibold tabular-nums text-[var(--ink)]">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}
