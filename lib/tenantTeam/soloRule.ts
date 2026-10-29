import { statusHoldsSeat } from "./seats.ts";

/**
 * Solo mode (owner decisions 2026-10-29): an individual agent working alone does not see the pages that
 * hand leads to other people. The rule, kept pure so it is unit-tested (lib/tenantTeam/solo.test.mjs) and
 * read by the server helper (lib/tenantTeam/solo.ts):
 *
 *   - the plan's audience is the static fact (saved at sign-up step 4, "Your plan"). An AGENCY plan is
 *     never solo, even while its owner is still alone; a plan with no audience (management, none) is not
 *     solo either, so nothing is hidden on a guess.
 *   - an INDIVIDUAL plan is solo while nobody else on the workspace is a CALLER: a producer (agent) or a
 *     setter, as their main role or an extra one. Assistants, bookkeepers and retention reps do not count
 *     ("only callers"). Owners are the agent themselves and do not count.
 *   - only people who hold a seat count (active, suspended or invited; lib/tenantTeam/seats.ts), and not
 *     a membership blocked in this workspace. Inviting the first setter turns the team pages on; removing
 *     the last turns them off. Nothing is stored: it is read from the members each time.
 *
 * Never a plan CODE (lib/menu/planBranching.test.mjs): the audience comes from plan_type.
 */
export const CALLER_ROLES: readonly string[] = ["producer", "setter"];

export type SoloMember = {
  /** tenant_users.role, the main role. */
  role: string | null | undefined;
  /** tenant_users.extra_roles (custom team access); absent before 20261020500000. */
  extraRoles?: readonly string[] | null;
  /** users.status, read through the one seat rule. */
  status: string | null | undefined;
  /** tenant_users.access_blocked_at: blocked in this workspace (AG-0.7), so not working here. */
  blocked?: boolean;
};

/** Whether this member makes calls on the workspace's leads alongside the owner. */
export function isCaller(member: SoloMember): boolean {
  if (member.role === "owner") return false;
  if (member.blocked) return false;
  if (!statusHoldsSeat(member.status)) return false;
  return [member.role, ...(member.extraRoles ?? [])].some((role) => typeof role === "string" && CALLER_ROLES.includes(role));
}

/** The rule itself: an individual plan with no other caller. */
export function soloFrom(audience: string | null | undefined, members: readonly SoloMember[]): boolean {
  if (audience !== "individual") return false;
  return !members.some(isCaller);
}
