import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Inbound's three steps (Inbound A, owner 2026-10-27): 1 Take a caller (on /app/inbound), 2 Verification
 * and 3 Finish the call (both on /app/inbound/call/<id>). The one-time setup before the first caller is
 * not a step. `current` is the step on screen; every step before it shows a tick. The bar sits compact
 * in the middle of the page, the steps an even distance apart (owner 2026-10-27).
 */
export const INBOUND_STEPS = ["Take a caller", "Verification", "Finish the call"] as const;

export function InboundStepBar({ current }: { current: 0 | 1 | 2 }) {
  // A full-width row (data-page-lead="center") holding the bar in its middle, so the page's actions
  // can share the row on the right (owner 2026-10-28) and the bar centres in what is left.
  return (
    <div data-page-lead="center" className="flex min-w-0 justify-center">
    <nav aria-label="Inbound steps" className="m-glass flex w-fit max-w-full min-w-0 items-center overflow-x-auto rounded-full border border-border px-5 py-2.5">
      <ol className="m-0 flex min-w-0 list-none items-center gap-3 p-0">
        {INBOUND_STEPS.map((label, index) => {
          const done = index < current;
          const on = index === current;
          return (
            <li key={label} aria-current={on ? "step" : undefined} className="flex min-w-0 items-center gap-2.5">
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-[26px] shrink-0 place-items-center rounded-full text-xs font-bold",
                  done ? "bg-[var(--primary)] text-[var(--on-primary)]" : on ? "border-2 border-[var(--primary)] text-[var(--accent-ink)]" : "border-[1.5px] border-[var(--border-strong)] text-[var(--muted)]",
                )}
              >
                {done ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span className={cn("whitespace-nowrap text-sm tracking-[-0.01em]", on ? "font-semibold text-[var(--ink)]" : done ? "font-semibold text-[var(--body)]" : "font-medium text-[var(--muted)]")}>
                {label}
                {done && <span className="sr-only"> (done)</span>}
              </span>
              {index < INBOUND_STEPS.length - 1 && <span aria-hidden="true" className={cn("ml-0.5 h-px w-10 shrink-0 sm:w-16", done ? "bg-[var(--primary)]" : "bg-[var(--border)]")} />}
            </li>
          );
        })}
      </ol>
    </nav>
    </div>
  );
}
