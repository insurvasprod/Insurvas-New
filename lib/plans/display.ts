/**
 * Turning a plan code into something readable.
 *
 * Client-safe and deliberately dependency-free. The entitlement blob carries `plan_code` and
 * nothing else — it is the contract between the two planes, not a presentation layer — so the
 * agent app was showing `plan_c` back at the person paying for it, and "You're on plan_c (v3)"
 * across the top of their dashboard.
 *
 * This only tidies. It does NOT map codes to marketing names, because the real names live in
 * `plans.name` and the agent app is forbidden from reading that table: "the agent app reads this
 * one object and obeys it — it never queries a plan, a subscription or a price". Hardcoding a
 * second set of names here would be a copy that silently disagrees with the admin screen the first
 * time somebody renames a plan.
 *
 * The proper fix is for `resolve_tenant_entitlement` to put the plan's display name in the blob.
 * That is a change to the contract and belongs with its own migration — see docs/backlog.md.
 *
 * A version number is dropped entirely rather than tidied. It tells an operator which plan version
 * an entitlement was computed from; it tells a customer nothing except that something they do not
 * understand has changed three times.
 */
export function planDisplayName(planCode: string | null): string {
  if (!planCode) return "No plan";
  return planCode
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
