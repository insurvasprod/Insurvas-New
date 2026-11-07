/**
 * Retention, one page (owner 2026-11-02: "all of these pages should go where they belong"). Module 5's own
 * pages left the Book group for an area of their own, the way Commissions and Reports were merged, down a rail
 * on the left. The Retention scorecard (LA-5.8) and Retention results (LA-5.9) are Reports views.
 *
 * Since 2026-11-05 (owner: "Retention is what the files say, never a prediction"; docs/retention/SPEC.md) the
 * first step is Cases, the ladder of every policy the files flag. The predictive Save queue (LA-5.3) left the
 * rail; its pages still answer at their address (a `RETIRED_STEPS` entry) so an old link lands somewhere. Lapse
 * risk (LA-4.16) is now Cases (its address redirects). A plain module so the server frame, the sidebar and the
 * page trail read one list.
 */
/** The Retention menu collapsed or open, remembered for a year; read on the server so the page draws at the right width. */
export const RETENTION_RAIL_COOKIE = "insurvas_retention_rail";

export type RetentionStep = "cases" | "save" | "servicing" | "reinstatement";

type StepItem = { key: RetentionStep; label: string; href: string; icon: string };
/** `icon`: the sidebar's own icon for the page. */
// Since the critique of 2026-11-05 (E): Cases is the one place to work; Servicing is what waits on the carrier;
// the reinstatement step is Win-back (a lapse inside its window is worked on its case, step 3).
export const RETENTION_STEPS: StepItem[] = [
  { key: "cases", label: "Cases", href: "/app/retention", icon: "life-buoy" },
  { key: "servicing", label: "Waiting on the carrier", href: "/app/servicing", icon: "wrench" },
  { key: "reinstatement", label: "Win-back", href: "/app/reinstatement", icon: "heart-handshake" },
];
/** Off the rail, still at their address (owner 2026-11-05: the predictive queue is hidden, not deleted). */
export const RETIRED_STEPS: StepItem[] = [
  { key: "save", label: "Save queue", href: "/app/save-queue", icon: "life-buoy" },
];
export const stepItem = (step: RetentionStep): StepItem => [...RETENTION_STEPS, ...RETIRED_STEPS].find((item) => item.key === step)!;

// A record under a step (a case, a save card, a request: detail pages since 2026-11-05) belongs to its step.
const STEP_PATHS: [RegExp, RetentionStep][] = [
  [/^\/app\/retention(\/.*)?$/, "cases"],
  [/^\/app\/save-queue(\/.*)?$/, "save"],
  [/^\/app\/servicing(\/.*)?$/, "servicing"],
  [/^\/app\/reinstatement(\/.*)?$/, "reinstatement"],
];

export function retentionStepOf(pathname: string): RetentionStep | null {
  return STEP_PATHS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}

export function retentionStepLabel(step: RetentionStep): string {
  return stepItem(step)?.label ?? "";
}
