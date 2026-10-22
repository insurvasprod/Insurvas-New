"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Ring } from "@/components/ui/ring";
import { guideHref, type SetupChecklist as SetupChecklistData } from "@/lib/dashboard/checklist";
import { markSetupStep } from "@/components/app/setup/setup-step-list";

/** The card lists this many open steps; the rest are on the setup page. */
const SHOWN_STEPS = 5;

/**
 * "Finish setting up" — the artboard shape.
 *
 * The fraction is the headline, because the reader's question is "how much is left", and a big
 * tabular 2/5 answers it before the bar has finished growing. The bar underneath is the same value
 * drawn slowly, which is what makes it read as a measurement rather than a loader.
 *
 * Every row is the link, not the arrow inside it: the arrow is what says the row goes somewhere,
 * but a 100px target on a 560px row is a target people miss. The first undone row is the next
 * step, so it leads: its label is set heavier and its action is drawn as the primary button.
 * Finished rows stay listed, muted, so the reader sees what is behind them as well as ahead.
 *
 * 2026-10-21 walkthrough: the card is the summary of Get set up. It lists the open steps up to
 * SHOWN_STEPS (skipped ones wait on the setup page), each row opens its screen with the guide bar on,
 * and "Hide" is saved for this person (tenant_setup_guide) instead of in one browser.
 */
export function SetupChecklist({ checklist, hidden: hiddenOnServer = false }: { checklist: SetupChecklistData; hidden?: boolean }) {
  const router = useRouter();
  const [hiddenHere, setHiddenHere] = useState(false);
  if (checklist.complete || hiddenOnServer || hiddenHere) return null;

  const hide = () => {
    setHiddenHere(true);
    void markSetupStep("hide").then((ok) => {
      if (ok) router.refresh();
      else setHiddenHere(false);
    });
  };

  const nextKey = checklist.steps.find((step) => !step.complete && !step.skipped)?.key;
  const open = checklist.steps.filter((step) => !step.complete && !step.skipped);
  // A short list stays whole (done rows muted, as before); a long one shows what is next.
  const rows = checklist.total <= SHOWN_STEPS + 1 ? checklist.steps : open.slice(0, SHOWN_STEPS);
  const more = checklist.total - rows.length;

  return (
    <Card className="portal-dashboard-setup m-card" data-setup-checklist="">
      <CardContent className="space-y-4 p-6">
        <div className="flex items-center justify-between gap-4">
          {/* LA-0.3: the progress ring. The fraction sits inside it, so the answer to "how much is
              left" is read before the arc has finished drawing. */}
          <div className="flex min-w-0 items-center gap-3">
            <Ring value={checklist.completed} max={checklist.total} size={48} tone="primary" label={`${checklist.completed} of ${checklist.total} done`}>
              {checklist.completed}/{checklist.total}
            </Ring>
            <div className="min-w-0">
              <h2 className="truncate text-title-sm font-semibold tracking-[-0.015em]">Finish setting up</h2>
              <p className="text-xs tabular-nums text-muted-foreground">{checklist.completed} of {checklist.total} done</p>
            </div>
          </div>
          <Button type="button" variant="ghost" onClick={hide} aria-label="Hide setup checklist for now">
            Hide
          </Button>
        </div>

        <ol className="block">
          {rows.map((step) => {
            const isNext = step.key === nextKey;
            return (
              <li key={step.key} className="block border-t border-border">
                <Link
                  href={guideHref(step)}
                  aria-label={`${step.label}${step.complete ? " (done)" : isNext ? " (next step)" : ""} — ${step.action.toLowerCase()}`}
                  aria-current={isNext ? "step" : undefined}
                  className="group flex items-center gap-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <span
                    aria-hidden="true"
                    className={
                      step.complete
                        ? "inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--success)] text-[var(--on-success)]"
                        : isNext
                          ? "inline-flex size-5 shrink-0 rounded-full border-[1.5px] border-primary"
                          : "inline-flex size-5 shrink-0 rounded-full border-[1.5px] border-[var(--muted)]"
                    }
                  >
                    {step.complete ? <Check className="size-3" strokeWidth={3} /> : null}
                  </span>

                  <span
                    className={`min-w-0 flex-1 truncate text-sm ${
                      step.complete ? "text-muted-foreground" : isNext ? "font-semibold text-foreground" : "text-foreground"
                    }`}
                  >
                    {step.label}
                  </span>

                  {isNext ? (
                    // The row is already the link and a button inside a link is invalid HTML, so the
                    // primary action is the button's look on a span.
                    <span data-slot="link-arrow" className={buttonVariants({ variant: "default" })}>
                      {step.action}
                      <Arrow />
                    </span>
                  ) : (
                    <span
                      data-slot="link-arrow"
                      className={`inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold tracking-[-0.01em] ${
                        step.complete ? "text-muted-foreground" : "text-foreground"
                      }`}
                    >
                      {step.action}
                      <Arrow />
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ol>

        {more > 0 ? (
          <div className="flex justify-end border-t border-border pt-3">
            <Link href="/app/setup" className={buttonVariants({ variant: "outline" })}>
              See all {checklist.total} steps
            </Link>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Arrow() {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      className="size-3.5 shrink-0 transition-transform duration-150 group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
    >
      <path d="M5 12h13M13 6l6 6-6 6" />
    </svg>
  );
}
