/**
 * Commissions, one page (owner 2026-11-02, "the same thing for commissions"): the Commission ledger, then
 * Discrepancies (what a carrier paid against what it owed), then Reconciliation (each producer's pay; My pay is
 * that step as a producer sees it). Statements moved to Book of business › Files, the Attribution queue into
 * Needs you and the Rate card into Setup, the same day. A plain module so the server frame, the sidebar and
 * the page trail read one list.
 */
/** The Commissions menu collapsed or open, remembered for a year; read on the server so the page draws at the right width. */
export const COMMISSIONS_RAIL_COOKIE = "insurvas_commissions_rail";

// Two steps since 2026-11-05 (owner): the Commission ledger went to Book of business, Hierarchy & overrides to Reports.
export type CommissionsStep = "discrepancies" | "reconciliation";

/** `icon`: the sidebar's own icon for the page. Reconciliation opens as My pay for a producer (commissions-page.tsx). */
export const COMMISSIONS_STEPS: { key: CommissionsStep; label: string; href: string; icon: string }[] = [
  { key: "discrepancies", label: "Pay issues", href: "/app/discrepancies", icon: "scale" },
  { key: "reconciliation", label: "Producer pay", href: "/app/producer-reconciliation", icon: "arrow-left-right" },
];

/** A producer's Reconciliation step: their own pay, at its own address. */
export const MY_PAY = { label: "My pay", href: "/app/my-pay", icon: "briefcase-business" } as const;

/** Each step's addresses. A statement's own page (/app/statements/<id>) is a record, not a step. */
const STEP_PATHS: [RegExp, CommissionsStep][] = [
  [/^\/app\/discrepancies\/?$/, "discrepancies"],
  [/^\/app\/(producer-reconciliation|my-pay)\/?$/, "reconciliation"],
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
  discrepancies: ["open pay issue", "open pay issues"],
};
