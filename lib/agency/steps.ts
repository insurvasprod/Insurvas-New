/**
 * Home › Agency (owner 2026-11-03, "the team should be rearranged somewhere else"): the Team group is gone. Its
 * producers (AG-1.1) sit under the agency dashboard (AG-0.11) they are the subject of — the same people (owner,
 * admin, bookkeeper, a manager over his reports) ask both questions. No rail since the dashboard redesign the same
 * day: Producers is a tile and a strip figure on the dashboard. Hierarchy & overrides went to Commissions, the rest
 * of the old group to Accounting, Reports, Sales and Leads; every address kept. A plain module so the frame, the
 * sidebar and the page trail read one list.
 */
export type AgencyStep = "overview" | "producers";

export const AGENCY_STEPS: { key: AgencyStep; label: string; href: string }[] = [
  { key: "overview", label: "Agency dashboard", href: "/app/agency" },
  { key: "producers", label: "Producers", href: "/app/producers" },
];

/** Each page's addresses. A producer's record, their carriers and the invite form sit under Producers. */
const STEP_PATHS: [RegExp, AgencyStep][] = [
  [/^\/app\/agency\/?$/, "overview"],
  [/^\/app\/producers(\/.*)?$/, "producers"],
];

export function agencyStepOf(pathname: string): AgencyStep | null {
  return STEP_PATHS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null;
}

export function agencyStepLabel(step: AgencyStep): string {
  return AGENCY_STEPS.find((item) => item.key === step)?.label ?? "";
}

export function agencyStepHref(step: AgencyStep): string {
  return AGENCY_STEPS.find((item) => item.key === step)?.href ?? "/app/agency";
}

/** What waits per page (/api/app/agency/steps, read by the dashboard's Needs you and Producers tile). */
export type AgencyStepCounts = Partial<Record<AgencyStep, number>>;
