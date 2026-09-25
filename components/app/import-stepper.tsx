import { Fragment } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The four steps of a list import, shared by the upload screen and the review screen.
 *
 * Driven by real state rather than by which page is showing: `current` is the step the person is
 * on right now — choosing a file, mapping it, the scrub and its review, committing — so the
 * stepper never claims a step is done before it is.
 *
 * Four, not five: "Validate & scrub" and "Review" were one screen's two moments (the preflight
 * running, then its answer on the review page), so they are one step, "Scrub". Nothing moved: the
 * review page is step 3 while it is being read and step 4 while it commits.
 */
export const IMPORT_STEPS = ["Upload", "Map columns", "Scrub", "Commit"] as const;

/** 1-based. A value past the last step shows every step done. */
export type ImportStep = 1 | 2 | 3 | 4 | 5;

export function ImportStepper({ current }: { current: ImportStep }) {
  return (
    <nav aria-label="Import progress" className="flex min-w-0 items-center overflow-x-auto rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-5 py-3.5">
      <ol className="m-0 flex w-full min-w-[520px] list-none items-center p-0">
        {IMPORT_STEPS.map((label, index) => {
          const step = index + 1;
          const done = step < current;
          const active = step === current;
          return (
            <Fragment key={label}>
              {index > 0 && (
                <li aria-hidden className={cn("mx-3 h-0.5 min-w-4 flex-1", step <= current ? "bg-[var(--success)]" : "bg-[var(--border)]")} />
              )}
              <li className="flex shrink-0 items-center gap-2.5" aria-current={active ? "step" : undefined}>
                <span
                  className={cn(
                    "inline-flex size-6 items-center justify-center rounded-full text-[12px] leading-[1.5] font-semibold tracking-[-0.01em]",
                    done
                      ? "bg-[var(--success)] text-[var(--on-success)]"
                      : active
                        ? "bg-[var(--primary)] text-[var(--on-primary)]"
                        : "bg-[var(--surface-alt)] text-[var(--muted)]",
                  )}
                >
                  {done ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : step}
                </span>
                <span className={cn("text-[14px] leading-[1.5] font-semibold tracking-[-0.02em]", done || active ? "text-[var(--ink)]" : "text-[var(--muted)]")}>
                  {label}
                  {done && <span className="sr-only"> (done)</span>}
                </span>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
