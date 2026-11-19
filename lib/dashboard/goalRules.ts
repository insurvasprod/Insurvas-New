import type { MemberRole } from "../tenantAuth/roles.ts";

/**
 * Goals and targets on the compact Home (roles r1, owner 2026-11-18). Pure rules, tested in goalRules.test.mjs;
 * the store is lib/dashboard/goals.ts and the only writer /api/app/goals.
 *
 *   premium   monthly issued premium (cents): a producer's own, or the agency's (owner, admin)
 *   policies  monthly policies issued (count): a manager's team, or the agency's
 *   booked    weekly appointments booked (count): a setter's own
 *   saves     monthly retention saves (count): a retention rep's own
 *
 * Who may set what, kept simple (owner brief): the owner and admins set any goal; everyone else sets only their
 * own kind for themselves, and a manager his team's count.
 */
export const GOAL_KINDS = ["premium", "policies", "booked", "saves"] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];
export type GoalPeriod = "month" | "week";
/** Whose goal: the person's own, or the agency's (user_id null). A manager's team goal is his own `policies` row. */
export type GoalFor = "me" | "agency";

export const GOAL_PERIOD: Record<GoalKind, GoalPeriod> = { premium: "month", policies: "month", booked: "week", saves: "month" };
/** Cents or a count. */
export const GOAL_MONEY: Record<GoalKind, boolean> = { premium: true, policies: false, booked: false, saves: false };
/** The largest goal the table takes (its check constraint). */
export const GOAL_MAX = 10_000_000_000;

export function isGoalKind(value: unknown): value is GoalKind {
  return typeof value === "string" && (GOAL_KINDS as readonly string[]).includes(value);
}

/** The kind a person sets for themselves on their Home, or null when their Home has no ring of their own. */
export function ownGoalKind(role: MemberRole): GoalKind | null {
  switch (role) {
    case "owner":
    case "admin":
    case "producer":
      return "premium";
    case "manager":
      return "policies";
    case "setter":
      return "booked";
    case "retention":
      return "saves";
    default:
      return null;
  }
}

/** May this person set this goal? The owner and admins any; anyone else their own kind for themselves. */
export function maySetGoal(role: MemberRole, kind: GoalKind, whose: GoalFor): boolean {
  if (role === "owner" || role === "admin") return kind === "premium" || kind === "policies" || whose === "me";
  if (whose === "agency") return false;
  return ownGoalKind(role) === kind;
}

/** A typed amount as stored: whole dollars to cents for premium, a whole count otherwise; null when not a goal. */
export function parseGoalTarget(kind: GoalKind, value: unknown): number | null {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/[$,\s]/g, "")) : Number.NaN;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const stored = GOAL_MONEY[kind] ? Math.round(raw * 100) : Math.round(raw);
  return stored > 0 && stored <= GOAL_MAX ? stored : null;
}

