import Link from "next/link";
import { Check } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Meter } from "@/components/ui/stat";
import type { SetupChecklist as SetupChecklistData } from "@/lib/dashboard/checklist";

/**
 * "Finish setting up" — the artboard shape.
 *
 * The fraction is the headline, because the reader's question is "how much is left", and a big
 * tabular 2/5 answers it before the bar has finished growing. The bar underneath is the same value
 * drawn slowly, which is what makes it read as a measurement rather than a loader.
 *
 * Every row is the link, not the arrow inside it: the arrow is what says the row goes somewhere,
 * but a 100px target on a 560px row is a target people miss.
 */
export function SetupChecklist({ checklist }: { checklist: SetupChecklistData }) {
  if (checklist.complete) return null;

  return (
    <Card className="portal-dashboard-setup m-card">
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center justify-between gap-4">
          <h2 className="min-w-0 text-lg font-semibold leading-[1.28] tracking-[-0.015em]">Finish setting up</h2>
          <span className="shrink-0 text-2xl font-semibold leading-[1.21] tracking-[-0.02em] tabular-nums">
            {checklist.completed}/{checklist.total}
          </span>
        </div>

        <span className="block w-full">
          <Meter
            value={checklist.completed}
            max={checklist.total}
            tone="primary"
            label={`${checklist.completed} of ${checklist.total} done`}
          />
          <span className="mt-1 block text-xs tabular-nums text-muted-foreground">
            {checklist.completed} of {checklist.total} done
          </span>
        </span>

        <ol className="block">
          {checklist.steps.map((step) => (
            <li key={step.key} className="block border-t border-border">
              <Link
                href={step.path}
                aria-label={`${step.label} — open settings tab`}
                className="group flex items-center gap-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span
                  aria-hidden="true"
                  className={
                    step.complete
                      ? "inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--success)] text-[var(--on-success)]"
                      : "inline-flex size-5 shrink-0 rounded-full border-[1.5px] border-[var(--muted)]"
                  }
                >
                  {step.complete ? <Check className="size-3" strokeWidth={3} /> : null}
                </span>

                <span
                  className={`min-w-0 flex-1 truncate text-sm ${
                    step.complete ? "text-muted-foreground" : "text-foreground"
                  }`}
                >
                  {step.label}
                </span>

                <span
                  data-slot="link-arrow"
                  className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold tracking-[-0.01em] text-foreground"
                >
                  Open settings tab
                  <svg
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                    className="size-3.5 shrink-0 transition-transform duration-150 group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                  >
                    <path d="M5 12h13M13 6l6 6-6 6" />
                  </svg>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
