/**
 * Turning a plan code into something readable.
 *
 * Client-safe and deliberately dependency-free. The entitlement blob carries `plan_code` and
 * nothing else — it is the contract between the two planes, not a presentation layer — so the
 * agent app was showing `plan_c` back at the person paying for it, and "You're on plan_c (v3)"
 * across the top of their dashboard.
 *
 * The real names live in `plans.name`, and the agent app is forbidden from reading that table: "the
 * agent app reads this one object and obeys it — it never queries a plan, a subscription or a
 * price". Since 20261003100000 (LA-4.10, backlog #75) the entitlement blob carries that name as
 * `plan_name`, so it is used when present — "Ledger", not "Basic". A blob computed before then has
 * no name, and the code is tidied as before. Never hardcode a second set of names here: it would
 * silently disagree with the admin screen the first time somebody renames a plan.
 *
 * A version number is dropped entirely rather than tidied. It tells an operator which plan version
 * an entitlement was computed from; it tells a customer nothing except that something they do not
 * understand has changed three times.
 */
export function planDisplayName(planCode: string | null, planName?: string | null): string {
  if (planName?.trim()) return planName.trim();
  if (!planCode) return "No plan";
  return planCode
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
