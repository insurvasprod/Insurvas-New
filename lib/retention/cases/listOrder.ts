/**
 * The Cases list's tabs, filters and order, in one place (round 7, owner pick 1·A, 2026-11-10;
 * docs/la4/mockups-r7/retention.html): the list draws with it, "Work the next case" opens its first case, and a
 * case page's ‹ › walk the same list (the list's address rides along as `?from=`). Pure: no server, no React.
 */
import { STEP_SLUG, stepFromSlug, type Reason, type Step } from "./ladder";

/** The urgency groups inside a step (owner pick 2026-11-06, "table B"): what to do first is the first group. */
export type Group = "over" | "week" | "later" | "none";
export const GROUP_LABELS: Record<Group, string> = { over: "Past due", week: "Due this week", later: "Later", none: "No carrier window" };
export const groupOf = (r: { daysLeft: number | null }): Group => (r.daysLeft === null ? "none" : r.daysLeft < 0 ? "over" : r.daysLeft <= 7 ? "week" : "later");
const GROUP_ORDER: Group[] = ["over", "week", "later", "none"];

export const TOUCHES = { never: "Not called yet", called: "Called", unreachable: "Unreachable" } as const;
export type Touch = keyof typeof TOUCHES;

/** The tabs on the title line, in ladder order; Paperwork and Closed after the ladder. */
export const STEP_TABS: Array<{ step: Step | "closed"; label: string }> = [
  { step: "payment_problem", label: "Payment problem" },
  { step: "pending_lapse", label: "Pending lapse" },
  // "Lapsed, can reinstate" shortened so the bar fits one line (mockup board 1·A).
  { step: "lapsed_reinstatable", label: "Can reinstate" },
  { step: "lost", label: "Lost" },
  { step: "paperwork", label: "Paperwork" },
  { step: "closed", label: "Closed" },
];
export const DEFAULT_STEP: Step = "payment_problem";

export type ListFilters = {
  step: Step | "closed";
  owner: string; carrier: string; reason: string; deadline: Group | ""; touch: Touch | "";
  /** "none": no phone on file. */
  phone: "" | "none";
  /** "person": opened by a person (New case). */
  by: "" | "person";
  /** Every step at once: a link that names a reason and no step (Settings › Ladder's "Open now"). */
  all: boolean;
};
const KEYS = ["owner", "carrier", "reason", "deadline", "touch", "phone", "by"] as const;

export function parseListFilters(get: (key: string) => string | null | undefined): ListFilters {
  const slug = get("step");
  const deadline = get("deadline") ?? "";
  const touch = get("touch") ?? "";
  return {
    step: slug === "closed" ? "closed" : stepFromSlug(slug) ?? DEFAULT_STEP,
    owner: get("owner") ?? "", carrier: get("carrier") ?? "", reason: get("reason") ?? "",
    deadline: (GROUP_ORDER as string[]).includes(deadline) ? (deadline as Group) : "",
    touch: touch in TOUCHES ? (touch as Touch) : "",
    phone: get("phone") === "none" ? "none" : "",
    by: get("by") === "person" ? "person" : "",
    all: get("all") === "1" || (!slug && Boolean(get("reason"))),
  };
}

/** The list's address for these filters (the step always written, so a case page knows where it came from). */
export function listQuery(f: ListFilters): string {
  const q = new URLSearchParams();
  q.set("step", f.step === "closed" ? "closed" : STEP_SLUG[f.step]);
  for (const key of KEYS) if (f[key]) q.set(key, f[key]);
  if (f.all) q.set("all", "1");
  return q.toString();
}

export type ListRow = {
  id: string; step: Step; reason: Reason; daysLeft: number | null; deadline: string | null; premiumCents: number | null;
  ownerId: string | null; carrierId: string; carrierName: string; clientName: string | null; policyNumber: string; phone: string | null;
  unreachable: boolean; lastContactAt: string | null; lastCall: { at: string; outcome: string } | null; evidence: Record<string, unknown>;
};

export const touchOf = (r: Pick<ListRow, "unreachable" | "lastContactAt" | "lastCall">): Touch => (r.unreachable ? "unreachable" : r.lastContactAt || r.lastCall ? "called" : "never");
export const byPerson = (r: Pick<ListRow, "evidence">) => r.evidence?.by === "person";

/** Everything but the step and the search (the tab counts follow what the filters leave). */
export function filterCases<T extends ListRow>(rows: T[], f: ListFilters, viewerId: string): T[] {
  const ownerId = f.owner === "me" ? viewerId : f.owner;
  return rows.filter((r) => (!ownerId || r.ownerId === ownerId) && (!f.carrier || r.carrierId === f.carrier) && (!f.reason || r.reason === f.reason)
    && (!f.deadline || groupOf(r) === f.deadline) && (!f.touch || touchOf(r) === f.touch) && (!f.phone || !r.phone) && (!f.by || byPerson(r)));
}

export const matchesSearch = (r: ListRow, needle: string) => !needle || [r.clientName, r.policyNumber, r.phone, r.carrierName].some((v) => v?.toLowerCase().includes(needle));

/** One step's cases in working order: by urgency group (past due first), the ladder's order inside each. */
export function orderCases<T extends ListRow>(rows: T[], step: Step | "closed" | null): T[] {
  if (step === "lost" || step === "paperwork") return rows;
  return [...rows].sort((a, b) => GROUP_ORDER.indexOf(groupOf(a)) - GROUP_ORDER.indexOf(groupOf(b)));
}

/** The list as it shows: filtered, on its tab (a search looks across every step), in working order. */
export function visibleCases<T extends ListRow>(rows: T[], f: ListFilters, viewerId: string, needle = ""): T[] {
  const across = Boolean(needle) || f.all;
  const these = filterCases(rows, f, viewerId).filter((r) => (across ? matchesSearch(r, needle) : f.step === "closed" ? false : r.step === f.step));
  return orderCases(these, across ? null : f.step);
}

/** The case page, carrying the list it was opened from (its ‹ › walk that list). */
export const caseHref = (id: string, f: ListFilters, tab?: string) => `/app/retention/${id}?${new URLSearchParams({ ...(tab ? { tab } : {}), from: listQuery(f) })}`;

/** The cases either side of one, in the list's order. */
export function neighbours<T extends { id: string }>(ordered: T[], id: string): { previous: T | null; next: T | null } {
  const at = ordered.findIndex((r) => r.id === id);
  if (at < 0) return { previous: null, next: null };
  return { previous: ordered[at - 1] ?? null, next: ordered[at + 1] ?? null };
}
