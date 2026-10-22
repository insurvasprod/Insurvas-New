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

  const act = (action: "skip" | "unskip" | "done", key: string) => {
    setBusy(key);
    void markSetupStep(action, key).then((ok) => {
      setBusy(null);
      if (ok) startTransition(() => router.refresh());
    });
  };

  return (
    <ol className="block">
      {steps.map((step) => {
        const isNext = step.key === nextKey;
        const disabled = pending || busy === step.key;
        return (
          <li key={step.key} className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-3 first:border-t-0">
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
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className={`truncate text-sm ${step.complete || step.skipped ? "text-muted-foreground" : isNext ? "font-semibold text-foreground" : "text-foreground"}`}>
                {step.label}
              </span>
              <InfoTip label={`Why: ${step.label}`}>{step.why}</InfoTip>
              {step.complete ? <StatusChip tone="good">Done</StatusChip> : step.skipped ? <StatusChip tone="neutral">Skipped</StatusChip> : null}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {!step.complete && step.manual ? (
                <Button type="button" variant="ghost" disabled={disabled} onClick={() => act("done", step.key)}>
                  Mark done
                </Button>
              ) : null}
              {!step.complete ? (
                <Button type="button" variant="ghost" disabled={disabled} onClick={() => act(step.skipped ? "unskip" : "skip", step.key)}>
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
