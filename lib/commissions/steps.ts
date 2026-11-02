/**
 * Commissions, one page (owner 2026-11-02, "the same thing for commissions"): six steps in the order money
 * moves — Statements arrive, lines post to the Commission ledger, Discrepancies show what a carrier paid
 * against what it owed, the Attribution queue gives each row to a producer, Reconciliation checks each
 * producer's pay, and the Rate card (what every carrier should pay) closes the rail. My pay folds in: it is
 * the Reconciliation step as a producer sees it. A plain module so the server frame, the sidebar and the
 * page trail read one list.
 */
/** The Commissions menu collapsed or open, remembered for a year; read on the server so the page draws at the right width. */
export const COMMISSIONS_RAIL_COOKIE = "insurvas_commissions_rail";

export type CommissionsStep = "statements" | "ledger" | "discrepancies" | "attribution" | "reconciliation" | "rates";

/** `icon`: the sidebar's own icon for the page. Reconciliation opens as My pay for a producer (commissions-page.tsx). */
export const COMMISSIONS_STEPS: { key: CommissionsStep; label: string; href: string; icon: string }[] = [
  { key: "statements", label: "Statements", href: "/app/statements", icon: "file-text" },
  { key: "ledger", label: "Commission ledger", href: "/app/ledger", icon: "receipt" },
  { key: "discrepancies", label: "Discrepancies", href: "/app/discrepancies", icon: "scale" },
  { key: "attribution", label: "Attribution queue", href: "/app/attribution", icon: "user-round-search" },
  { key: "reconciliation", label: "Reconciliation", href: "/app/producer-reconciliation", icon: "arrow-left-right" },
  { key: "rates", label: "Rate card", href: "/app/rate-card", icon: "calculator" },
];

/** A producer's Reconciliation step: their own pay, at its own address. */
export const MY_PAY = { label: "My pay", href: "/app/my-pay", icon: "briefcase-business" } as const;

/** Each step's addresses. A statement's own page (/app/statements/<id>) is a record, not a step. */
const STEP_PATHS: [RegExp, CommissionsStep][] = [
  [/^\/app\/statements\/?$/, "statements"],
  [/^\/app\/ledger\/?$/, "ledger"],
  [/^\/app\/discrepancies\/?$/, "discrepancies"],
  [/^\/app\/attribution\/?$/, "attribution"],
  [/^\/app\/(producer-reconciliation|my-pay)\/?$/, "reconciliation"],
  [/^\/app\/rate-card\/?$/, "rates"],
];

export function commissionsStepOf(pathname: string): CommissionsStep | null {
  return STEP_PATHS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}

/** The step's name where `pathname` is (My pay on its own address). */
export function commissionsStepLabel(step: CommissionsStep, pathname?: string): string {
  if (step === "reconciliation" && pathname && /^\/app\/my-pay\/?$/.test(pathname)) return MY_PAY.label;
  return COMMISSIONS_STEPS.find((item) => item.key === step)?.label ?? "";
}

/** What waits on a person per step (/api/app/commissions/steps); a step left out has no badge. */
export type CommissionsStepCounts = Partial<Record<CommissionsStep, number>>;

/** What each badge counts, one and many. The ledger, Reconciliation and the Rate card have no queue. */
export const COMMISSIONS_WAITING: Record<string, [string, string]> = {
  statements: ["statement line waiting for a person", "statement lines waiting for a person"],
  discrepancies: ["open discrepancy", "open discrepancies"],
  attribution: ["row to give to a producer", "rows to give to a producer"],
};
