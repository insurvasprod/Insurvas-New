"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button, buttonVariants } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { StatusChip } from "@/components/ui/status-chip";
import { guideHref, type SetupChecklistStep } from "@/lib/dashboard/checklist";

export type SetupStepRow = SetupChecklistStep & { manual: boolean };

/** Skip, bring back, or tick a read-only step. The page re-renders from the server afterwards. */
export async function markSetupStep(action: "skip" | "unskip" | "done" | "undone" | "hide" | "show", step?: string): Promise<boolean> {
  const response = await fetch("/api/app/setup", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, step }),
  }).catch(() => null);
  if (!response?.ok) {
    const body = (await response?.json().catch(() => null)) as { error?: string } | null;
    notify.fail(body?.error ?? "Could not save. Try again.");
    return false;
  }
  window.dispatchEvent(new Event("setup:changed"));
  return true;
}

/**
 * One module's steps on the setup page. Each row opens the step's real screen with the guide bar on
 * (`?guide=`), so the walkthrough is the product itself, not a tour laid over it. The next step leads
 * with the primary button; a skipped one stays listed so it can be brought back.
 */
export function SetupStepList({ steps, nextKey }: { steps: SetupStepRow[]; nextKey: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const act = (action: "skip" | "unskip" | "done" | "undone", key: string) => markSetupStep(action, key);

  const run = (key: string, work: () => Promise<boolean>) => {
    setBusy(key);
    void work().then((ok) => {
      setBusy(null);
      if (ok) startTransition(() => router.refresh());
    });
  };

  // A tick is one click, so it can be taken back (redesign, 2026-10-24): the toast offers Undo, which
  // un-ticks through the same API ("undone") and, when the step had been skipped before it was ticked
  // ("done" clears the skip), puts it back to skipped rather than leaving it in a state never chosen.
  const markDone = (step: SetupStepRow) => {
    const wasSkipped = step.skipped === true;
    run(step.key, async () => {
      const ok = await act("done", step.key);
      if (ok) {
        notify.done(`Marked done: ${step.label}`, {
          action: {
            label: "Undo",
            onClick: () => run(step.key, async () => (await act("undone", step.key)) && (!wasSkipped || (await act("skip", step.key)))),
          },
        });
      }
      return ok;
    });
  };

  return (
    <ol className="block">
      {steps.map((step) => {
        const isNext = step.key === nextKey;
        const disabled = pending || busy === step.key;
        return (
          // Wraps rather than truncates (redesign, 2026-10-24): on a phone the label takes the line and
          // the actions drop beneath it, indented to the label, so nothing is cut or scrolls sideways.
          <li key={step.key} className="flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-border px-4 py-3 first:border-t-0 sm:items-center">
            <span
              aria-hidden="true"
              className={
                step.complete
                  ? "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--success)] text-[var(--on-success)] sm:mt-0"
                  : isNext
                    ? "mt-0.5 inline-flex size-5 shrink-0 rounded-full border-[1.5px] border-primary sm:mt-0"
                    : "mt-0.5 inline-flex size-5 shrink-0 rounded-full border-[1.5px] border-[var(--muted)] sm:mt-0"
              }
            >
              {step.complete ? <Check className="size-3" strokeWidth={3} /> : null}
            </span>
            <span className="flex min-w-0 flex-1 basis-[calc(100%-2rem)] flex-wrap items-center gap-x-1.5 gap-y-1 sm:basis-0">
              <span className={`min-w-0 break-words text-sm ${step.complete || step.skipped ? "text-muted-foreground" : isNext ? "font-semibold text-foreground" : "text-foreground"}`}>
                {step.label}
              </span>
              <InfoTip label={`Why: ${step.label}`}>{step.why}</InfoTip>
              {step.complete ? <StatusChip tone="good">Done</StatusChip> : step.skipped ? <StatusChip tone="neutral">Skipped</StatusChip> : null}
              {!step.complete && step.minutes ? (
                <span className="w-full text-xs tabular-nums text-muted-foreground sm:w-auto">About {step.minutes} min</span>
              ) : null}
            </span>
            <span className="ml-8 flex flex-wrap items-center gap-2 sm:ml-0 sm:shrink-0">
              {!step.complete && step.manual ? (
                <Button type="button" variant="ghost" disabled={disabled} onClick={() => markDone(step)}>
                  Mark done
                </Button>
              ) : null}
              {!step.complete ? (
                <Button type="button" variant="ghost" disabled={disabled} onClick={() => run(step.key, () => act(step.skipped ? "unskip" : "skip", step.key))}>
                  {step.skipped ? "Bring back" : "Skip"}
                </Button>
              ) : null}
              <Link href={guideHref(step)} className={buttonVariants({ variant: isNext ? "default" : "outline" })} aria-current={isNext ? "step" : undefined}>
                {step.complete ? "Open" : step.action}
              </Link>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
