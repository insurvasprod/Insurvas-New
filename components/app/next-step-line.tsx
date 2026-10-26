import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";

/**
 * The page's one "Next step" line (2026-10-26 redesign): what to do next, in a sentence, with the one
 * button that does it. Pages render it only when there is something to do.
 */
export function NextStepLine({ children, action, label = "Next step" }: { children: ReactNode; action?: ReactNode; label?: string }) {
  return (
    <section aria-label={label} className="m-glass flex flex-wrap items-center gap-4 rounded-xl border border-border px-4 py-3">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--primary-soft)] text-[var(--accent-ink)]"><ArrowRight className="size-4" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1 text-sm text-[var(--body)]">
        <span className="block text-xs font-semibold text-[var(--accent-ink)]">{label}</span>
        {children}
      </span>
      {action}
    </section>
  );
}
