import { hasTenantPermission } from "../tenantAuth/permissions.ts";
import type { MemberRole, TenantRole } from "../tenantAuth/roles.ts";
import type { MenuGate } from "./roleHome.ts";

/**
 * Who sees money on the dashboards, and what the menu narrows, from the session (roles r1, 2026-11-18).
 *
 * Money is a permission, never a role name (the audit found the rule written as `role === "manager"`, so a retention
 * rep, who holds no money permission, was shown "$ saved"). A dollar figure shows when a role the member holds:
 *   - may see the agency's money (`money.view`: owner, admin, bookkeeper), or
 *   - may see their own commission and reads only their own book (`commission.view.own` without
 *     `team.view.reports`: a producer). A manager also holds his own commission, but his dashboard is his team's
 *     business, so it shows counts only (owner 2026-10-25: "they will not see all the money").
 * Setters, assistants and retention reps hold neither: counts only, everywhere.
 */
export function seesMoney(roles: readonly MemberRole[]): boolean {
  if (roles.some((role) => hasTenantPermission(role, "money.view"))) return true;
  // A team lead reads his reports' business whatever other role he also holds: counts only.
  if (roles.some((role) => hasTenantPermission(role, "team.view.reports"))) return false;
  return roles.some((role) => hasTenantPermission(role, "commission.view.own"));
}

/** The roles a session holds as the menu reads them: the held role (a title when it has one), then every extra role. */
export function heldRoles(context: { role: TenantRole; memberRole?: MemberRole; roles?: readonly TenantRole[] }): MemberRole[] {
  return [context.memberRole ?? context.role, ...(context.roles ?? []).slice(1)];
}

/** The sidebar's narrowing for this session (app/app/(shell)/layout.tsx builds the menu with the same four). */
export function menuGate(context: { role: TenantRole; memberRole?: MemberRole; roles?: readonly TenantRole[]; hiddenPages?: readonly string[] }, scope: readonly string[] | null): MenuGate {
  return {
    narrow: scope !== null,
    memberRole: context.memberRole ?? context.role,
    extraRoles: (context.roles ?? []).slice(1),
    hiddenPages: context.hiddenPages ?? [],
  };
}
