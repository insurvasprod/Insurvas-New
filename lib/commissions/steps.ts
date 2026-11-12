/**
 * Commissions, one rail in the order money moves (round 7, owner 2026-11-10, docs/la4/mockups-r7/commissions.html 0·A):
 * money in — the carrier's Statements, the Pay issues they leave, Who gets the credit for each line — then money
 * out — Producer pay, Team payouts, Commission splits, Partner payouts. My pay is Producer pay as a producer sees it.
 * Each page keeps its address; Accounting keeps rows that open Team payouts and Partner payouts here, and Book of
 * business › Carrier files keeps a link to Statements. A plain module so the server frame, the sidebar and the
 * page trail read one list.
 */
/** The Commissions menu collapsed or open, remembered for a year; read on the server so the page draws at the right width. */
export const COMMISSIONS_RAIL_COOKIE = "insurvas_commissions_rail";

export type CommissionsStep = "statements" | "discrepancies" | "attribution" | "reconciliation" | "teamPayouts" | "splits" | "partnerPayouts";

/** `icon`: the sidebar's own icon for the page; `group`: the rail's small label over the first step of each group. */
export const COMMISSIONS_STEPS: { key: CommissionsStep; label: string; href: string; icon: string; group: "Money in" | "Money out" }[] = [
  { key: "statements", label: "Statements", href: "/app/statements", icon: "file-text", group: "Money in" },
  { key: "discrepancies", label: "Pay issues", href: "/app/discrepancies", icon: "scale", group: "Money in" },
  { key: "attribution", label: "Who gets the credit", href: "/app/attribution", icon: "user-round-search", group: "Money in" },
  { key: "reconciliation", label: "Producer pay", href: "/app/producer-reconciliation", icon: "arrow-left-right", group: "Money out" },
  { key: "teamPayouts", label: "Team payouts", href: "/app/producer-payouts", icon: "banknote", group: "Money out" },
  { key: "splits", label: "Commission splits", href: "/app/commission-splits", icon: "hand-coins", group: "Money out" },
  { key: "partnerPayouts", label: "Partner payouts", href: "/app/payouts", icon: "wallet-cards", group: "Money out" },
];

/** A producer's Producer pay step: their own pay, at its own address. */
export const MY_PAY = { label: "My pay", href: "/app/my-pay", icon: "briefcase-business" } as const;

/**
 * Each step's addresses. A record under a step is that step too, so the rail and the sidebar stay on it: a
 * statement, a pay issue / group / letter, a credit item, a payout run's statement (a record of Team payouts), a
 * pay plan, a partner invoice or rulebook.
 */
const STEP_PATHS: [RegExp, CommissionsStep][] = [
  [/^\/app\/statements(\/.*)?$/, "statements"],
  [/^\/app\/discrepancies(\/.*)?$/, "discrepancies"],
  [/^\/app\/attribution(\/.*)?$/, "attribution"],
  [/^\/app\/(producer-reconciliation|my-pay)(\/.*)?$/, "reconciliation"],
  [/^\/app\/(producer-payouts|producer-statements)(\/.*)?$/, "teamPayouts"],
  [/^\/app\/commission-splits(\/.*)?$/, "splits"],
  [/^\/app\/payouts(\/.*)?$/, "partnerPayouts"],
];

export function commissionsStepOf(pathname: string): CommissionsStep | null {
  return STEP_PATHS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}

const isMyPay = (pathname?: string) => Boolean(pathname && /^\/app\/my-pay(\/|$)/.test(pathname));

/** The step's name where `pathname` is (My pay on its own address). */
export function commissionsStepLabel(step: CommissionsStep, pathname?: string): string {
  if (step === "reconciliation" && isMyPay(pathname)) return MY_PAY.label;
  return COMMISSIONS_STEPS.find((item) => item.key === step)?.label ?? "";
}

/** The step's own address where `pathname` is (My pay for a producer), for the trail's link back. */
export function commissionsStepHref(step: CommissionsStep, pathname?: string): string {
  if (step === "reconciliation" && isMyPay(pathname)) return MY_PAY.href;
  return COMMISSIONS_STEPS.find((item) => item.key === step)?.href ?? "/app/discrepancies";
}

/** What waits on a person per step (/api/app/commissions/steps); a step left out has no badge. */
export type CommissionsStepCounts = Partial<Record<CommissionsStep, number>>;

/** What each badge counts, one and many. Team payouts and Commission splits have no queue. */
export const COMMISSIONS_WAITING: Record<string, [string, string]> = {
  statements: ["statement line waiting for a person", "statement lines waiting for a person"],
  discrepancies: ["open pay issue", "open pay issues"],
  attribution: ["credit to decide", "credits to decide"],
  reconciliation: ["pay difference to review", "pay differences to review"],
  partnerPayouts: ["partner invoice to review or pay", "partner invoices to review or pay"],
};
