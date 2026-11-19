import { setupStepDefinitions } from "../dashboard/checklist.ts";
import { guideMovesFor, type GuideShot } from "../dashboard/guideMoves.ts";

import { DOC_SHOTS, type DocShot } from "./shots.ts";
import { TASK_SHOTS } from "./taskShots.ts";
import type { DocTask } from "./tasks.ts";

/** One step of a task as its page shows it: what to do, a line of detail, its screenshot, and its sketch fallback. */
export type TaskMove = { say: string; detail?: string; photo: DocShot | null; sketch?: GuideShot };

/**
 * A task's steps with their screenshots. A Get set up step uses its guide moves and the Ready to sell run's
 * pictures (lib/docs/shots.ts); any other task its own steps and pictures (lib/docs/taskShots.ts). A picture whose
 * control wasn't found (`unlit`) still shows: the page as it stands is better than nothing.
 */
export function taskMoves(task: DocTask): TaskMove[] {
  if (task.setupStep) {
    const definition = setupStepDefinitions().find((item) => item.key === task.setupStep);
    if (!definition) return [];
    const shots = DOC_SHOTS[task.setupStep] ?? [];
    return guideMovesFor(definition).map((move, at) => ({ say: move.say, ...(move.detail ? { detail: move.detail } : {}), photo: shots[at] ?? null, ...(move.shot ? { sketch: move.shot } : {}) }));
  }
  const shots = TASK_SHOTS[task.slug] ?? [];
  return (task.steps ?? []).map((step, at) => ({ say: step.say, ...(step.detail ? { detail: step.detail } : {}), photo: shots[at] ?? null }));
}

export function taskStepCount(task: DocTask): number {
  return taskMoves(task).length;
}

/** The task's first real screenshot, for thumbnails and the module guide's first clicks. */
export function firstShot(task: DocTask): DocShot | undefined {
  return taskMoves(task).find((move) => move.photo)?.photo ?? undefined;
}

/** A setup task's "why" comes from its Get set up step, so the two never disagree. */
export function taskWhy(task: DocTask): string {
  if (task.why) return task.why;
  return setupStepDefinitions().find((item) => item.key === task.setupStep)?.why ?? "";
}

/**
 * A short name for a step on the numbered line: the control it clicks or opens ("Run payouts", "Rulebooks"), else
 * its first clause. "Open Rulebooks, then click the partner" reads "Rulebooks", never "the partner".
 */
export function stepLabel(say: string): string {
  // "Open the Health questions tab" → "Health questions": the strip names the tab, the caption says to open it.
  const tab = /^Open the (.+?) tab\b/.exec(say);
  if (tab) return tab[1];
  const click = /[Cc]lick ([A-Z][^,]*?)(?:,| on | in | then |$)/.exec(say);
  if (click) return click[1];
  const open = /^Open ([A-Z][\w &]*?)(?:,| to | for | then |:|$)/.exec(say);
  if (open) return open[1];
  // A comma or colon that ends a clause (followed by a space), never the one inside "$1,000" or "9:00".
  return say.split(/[,:](?=\s)/)[0];
}
