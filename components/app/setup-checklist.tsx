import Link from "next/link";
import { ArrowRight, Check, Circle } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { SetupChecklist as SetupChecklistData } from "@/lib/dashboard/checklist";

export function SetupChecklist({ checklist }: { checklist: SetupChecklistData }) {
  if (checklist.complete) return null;

  const percentage = Math.round((checklist.completed / checklist.total) * 100);

  return (
    <Card className="border-[var(--color-blue)]/25">
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-[var(--color-accent-ink)]">Get set up</p>
            <p className="mt-1 text-sm text-muted-foreground">A short checklist to make the workspace useful from day one.</p>
          </div>
          <div className="flex items-center gap-3">
            <div
              className="relative flex size-14 items-center justify-center rounded-full"
              role="progressbar"
              aria-label="Setup progress"
              aria-valuemin={0}
              aria-valuemax={checklist.total}
              aria-valuenow={checklist.completed}
              style={{ background: `conic-gradient(var(--color-blue) ${percentage}%, var(--color-border) ${percentage}% 100%)` }}
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-card text-xs font-bold">{checklist.completed}/{checklist.total}</span>
            </div>
            <span className="text-sm font-medium">{checklist.completed} of {checklist.total} complete</span>
          </div>
        </div>
        <ol className="grid gap-2 sm:grid-cols-2">
          {checklist.steps.map((step, index) => (
            <li key={step.key}>
              <Link
                href={step.path}
                className="group flex items-center gap-3 rounded-md border border-border px-3 py-2.5 text-sm transition-colors hover:border-[var(--color-blue)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-blue)]"
              >
                {step.complete ? <Check className="size-4 shrink-0 text-[var(--color-success)]" aria-hidden="true" /> : <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                <span className="min-w-0 flex-1"><span className="mr-1 text-muted-foreground">{index + 1}.</span>{step.label}</span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
