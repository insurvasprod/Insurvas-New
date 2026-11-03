import type { ReactNode } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleAlert } from "lucide-react";

import { cardSurface } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The one "next up" line at the top of every Lead sources page (owner /ui-taste critique,
 * 2026-10-30: "make it easier for the user to understand what he needs to do"). One plain sentence
 * worked out from the page's own data, and the one button that does it — the page's single primary.
 * Everything else on the page stays outline. Nothing waiting is said too, quietly, so an empty line
 * never reads as "still loading".
 *
 *   danger   something cannot run at all (a campaign nobody can dial)
 *   warning  something waits on a person (duplicates to confirm, leads with nobody to call them)
 *   action   the normal next step (hand out, bring back, import)
 *   done     nothing waiting here
 */
export type NextUpTone = "danger" | "warning" | "action" | "done";

const ICON = { danger: CircleAlert, warning: AlertTriangle, action: ArrowRight, done: CheckCircle2 } as const;
const TINT: Record<NextUpTone, string> = {
  danger: "bg-[var(--error-surface)] text-[var(--error-ink)]",
  warning: "bg-[var(--warning-surface)] text-[var(--warning-ink)]",
  action: "bg-[var(--primary-soft)] text-[var(--accent-ink)]",
  done: "bg-[var(--primary-soft)] text-[var(--accent-ink)]",
};

export function NextUp({ tone, children, action = null, more = null }: {
  tone: NextUpTone;
  /** One sentence. Put the count in <strong>. */
  children: ReactNode;
  /** The one button (primary). Leave null when nothing is waiting. */
  action?: ReactNode;
  /** A quiet extra, e.g. "and 2 more" as a link. */
  more?: ReactNode;
}) {
  const Icon = ICON[tone];
  return (
    <section
      aria-label="Next up"
      className={cn(cardSurface, "flex min-w-0 flex-wrap items-center gap-3 px-4 py-3 motion-safe:animate-[m-rise_.3s_cubic-bezier(.2,.8,.2,1)_both]")}
    >
      <span aria-hidden="true" className={cn("grid size-8 shrink-0 place-items-center rounded-lg", TINT[tone])}><Icon className="size-4" /></span>
      <p className="m-0 min-w-0 flex-1 text-sm leading-[1.5] text-[var(--ink)] [&_strong]:font-semibold">
        {children}
        {more && <span className="ml-2">{more}</span>}
      </p>
      {action && <span className="flex shrink-0 items-center gap-2">{action}</span>}
    </section>
  );
}
