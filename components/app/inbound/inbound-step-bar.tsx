"use client";

import { Check } from "lucide-react";

import { INBOUND_STEPS } from "@/lib/inbound/callPhase";
import { cn } from "@/lib/utils";

/**
 * Inbound's five steps (owner 2026-10-28; three since 2026-10-27; names in lib/inbound/callPhase.ts):
 * 1 Take a caller (on /app/inbound), then on /app/inbound/call/<id>, one page whose content changes in
 * place: 2 Transfer check, 3 Verification, 4 Underwriting and 5 Finish the call. The one-time setup
 * before the first caller is not a step. `current` is the step on screen; every step before it shows a
 * tick and, when `onPick` is given, goes back to it.
 */
export function InboundStepBar({ current, onPick }: { current: 0 | 1 | 2 | 3 | 4; onPick?: (index: number) => void }) {
  // The bar sits on the title's line (owner 2026-11-09, PageHeader `lead`), between the title and the
  // status + More, centred in what is left. Compact so the line keeps one row at 1440: 24px dots, and the
  // lines between steps only from 2xl, where there is room for them. Below lg it takes its own row and scrolls sideways.
  return (
    <div className="flex min-w-0 flex-1 justify-center">
    <nav aria-label="Inbound steps" className="m-glass flex w-fit max-w-full min-w-0 items-center overflow-x-auto rounded-full border border-border px-4 py-1.5">
      <ol className="m-0 flex w-max list-none items-center gap-4 p-0 2xl:gap-3">
        {INBOUND_STEPS.map((label, index) => {
          const done = index < current;
          const on = index === current;
          // Steps already passed on the call page are a click back; Incoming calls is never (the call is taken).
          const back = done && index > 0 && onPick;
          const body = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold transition-colors duration-500",
                  done ? "bg-[var(--primary)] text-[var(--on-primary)]" : on ? "border-2 border-[var(--primary)] text-[var(--accent-ink)]" : "border-[1.5px] border-[var(--border-strong)] text-[var(--body)]",
                )}
              >
                {done ? <Check className="m-tick size-3.5" /> : index + 1}
              </span>
              {/* One type for every step (owner 2026-10-28): 14px medium; the step on screen alone is semibold. */}
              <span className={cn("whitespace-nowrap text-sm leading-[1.4] tracking-[-0.01em] transition-colors", !on && "max-sm:sr-only", on ? "font-semibold text-[var(--ink)]" : done ? "font-medium text-[var(--ink)]" : "font-medium text-[var(--body)]")}>
                {label}
                {done && <span className="sr-only"> (done)</span>}
              </span>
            </>
          );
          return (
            <li key={label} aria-current={on ? "step" : undefined} className="flex shrink-0 items-center gap-2.5">
              {back ? (
                <button type="button" onClick={() => onPick(index)} title={`Back to ${label}`} className="flex items-center gap-2.5 rounded-full outline-none hover:opacity-85 focus-visible:ring-2 focus-visible:ring-ring">{body}</button>
              ) : <span className="flex items-center gap-2.5">{body}</span>}
              {index < INBOUND_STEPS.length - 1 && (
                // The line between two steps fills as the call moves past it.
                <span aria-hidden="true" className="ml-0.5 hidden h-px w-12 shrink-0 overflow-hidden bg-[var(--border)] 2xl:block">
                  <span className="block h-full bg-[var(--primary)] transition-[width] duration-700 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none" style={{ width: done ? "100%" : "0%" }} />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
    </div>
  );
}
