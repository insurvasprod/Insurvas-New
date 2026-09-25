import type { AdminRole } from "@/lib/adminAuth/roles";

// Same three roles as the Tenants list: users are neither financial nor policy data, and
// support lives in this screen. platform_config is excluded — per the Basic Idea doc §2.5
// they see no customer data at all.
export const CAN_VIEW_USERS: readonly AdminRole[] = ["super_admin", "support_agent", "billing_admin"];

export function canViewUsers(role: AdminRole): boolean {
  return CAN_VIEW_USERS.includes(role);
}

/**
 * Who can move a user between active / inactive / suspended / deleted.
 *
 * Deliberately narrower than CAN_VIEW_USERS: support_agent works in this screen and must read it,
 * but changing someone's state is not a support action. SA-1.4 names no role, so this preserves
 * the behaviour already enforced rather than widening it — §2.5 of the Basic Idea doc grants
 * *tenant* suspension to billing_admin as well, and whether that extends to individual users is a
 * product decision, not one to make while fixing a bug.
 *
 * Held as a constant because two places enforce it: the route, which must refuse before it reads a
 * body, and setUserStatus, which must stay safe for any future caller. Two literals would drift.
 */
export const CAN_SET_USER_STATUS: readonly AdminRole[] = ["super_admin"];
