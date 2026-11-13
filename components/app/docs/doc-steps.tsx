"use client";

import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { NumberedSteps } from "@/components/ui/numbered-steps";
import { StatusChip } from "@/components/ui/status-chip";
import type { DocStep } from "@/lib/docs/content";

import { toggleStep, useTickedSteps } from "./docs-reading";

/** What Insurvas knows of a step: done in the agency, or the link its button opens. */
export type DocStepState = { done: boolean; href?: string };

/**
 * A page's steps, exactly in order (R4 D2): each with its time, cost and moment in the video. A step Insurvas can
 * see (Add your carriers, Ready to sell) ticks itself once the agency has done it and drops its button (owner
 * 2026-11-13: "no need to show that button anymore"); any other the reader ticks with Mark done. The first step not
 * done is the one they are on, and only it shows its button.
 */
export function DocSteps({ slug, steps, agency }: { slug: string; steps: DocStep[]; agency: Record<number, DocStepState> }) {
  const ticked = useTickedSteps(slug);
  const isDone = (index: number) => agency[index]?.done === true || ticked.has(index);
  const current = steps.findIndex((_, index) => !isDone(index));
  const allDone = current === -1;
  return (
    <>
      {allDone ? (
        <p className="m-0 flex items-center gap-2 text-sm text-[var(--muted)]"><StatusChip tone="good">All {steps.length} done</StatusChip>Every step on this page is finished.</p>
      ) : null}
      <NumberedSteps
        steps={steps.map((step, index) => {
          const known = agency[index];
          const done = isDone(index);
          const href = known?.href ?? step.action?.href;
          return {
            key: String(index),
            title: step.title,
            detail: step.detail,
            state: done ? "done" : index === current ? "current" : "todo",
            facts: [
              ...(step.time ? [{ label: "Time", value: step.time }] : []),
              ...(step.cost ? [{ label: "Cost", value: step.cost }] : []),
              ...(step.at ? [{ label: "Video", value: step.at }] : []),
            ],
            side: known?.done ? (
              <StatusChip tone="good">Done in your agency</StatusChip>
            ) : done ? (
              <button type="button" onClick={() => toggleStep(slug, index)} className="cursor-pointer border-0 bg-transparent p-0" title="Undo"><StatusChip tone="good">Done</StatusChip></button>
            ) : index === current ? (
              <span className="flex flex-col items-end gap-1.5">
                {step.action && href ? <Link href={href} className={buttonVariants({ variant: step.action.step ? "highlight" : "default", size: "sm" })}>{step.action.label} ›</Link> : null}
                {step.doneWhen ? null : <Button type="button" variant="outline" size="sm" onClick={() => toggleStep(slug, index)}>Mark done</Button>}
              </span>
            ) : null,
          };
        })}
      />
    </>
  );
}
