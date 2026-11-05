/**
 * Retention, one page (owner 2026-11-02: "all of these pages should go where they belong"). Module 5's own
 * pages left the Book group for an area of their own, the way Commissions and Reports were merged: Save
 * queue (LA-5.3), Servicing (LA-5.4/5.5) and Reinstatement (LA-5.6/5.7), down a rail on the left. The
 * Retention scorecard (LA-5.8) and Retention results (LA-5.9, was "Does it work?") are Reports views. Lapse risk (LA-4.16) is what already happened, so it went
 * to Book of business, never beside a prediction (Module 5, rule 1). A plain module so the server frame,
 * the sidebar and the page trail read one list.
 */
/** The Retention menu collapsed or open, remembered for a year; read on the server so the page draws at the right width. */
export const RETENTION_RAIL_COOKIE = "insurvas_retention_rail";

export type RetentionStep = "save" | "servicing" | "reinstatement";

/** `icon`: the sidebar's own icon for the page. */
export const RETENTION_STEPS: { key: RetentionStep; label: string; href: string; icon: string }[] = [
  { key: "save", label: "Save queue", href: "/app/save-queue", icon: "life-buoy" },
  { key: "servicing", label: "Servicing", href: "/app/servicing", icon: "wrench" },
  { key: "reinstatement", label: "Reinstatement", href: "/app/reinstatement", icon: "heart-handshake" },
];

// A record under a step (a save card, a request, a case: detail pages since 2026-11-05) belongs to its step.
const STEP_PATHS: [RegExp, RetentionStep][] = [
  [/^\/app\/save-queue(\/.*)?$/, "save"],
  [/^\/app\/servicing(\/.*)?$/, "servicing"],
  [/^\/app\/reinstatement(\/.*)?$/, "reinstatement"],
];

export function retentionStepOf(pathname: string): RetentionStep | null {
  return STEP_PATHS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}

export function retentionStepLabel(step: RetentionStep): string {
  return RETENTION_STEPS.find((item) => item.key === step)?.label ?? "";
}
