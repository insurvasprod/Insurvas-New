import type { AdminRole } from "@/lib/adminAuth/roles";

// Same three roles as the Tenants list: users are neither financial nor policy data, and
// support lives in this screen. platform_config is excluded — per the Basic Idea doc §2.5
// they see no customer data at all.
export const CAN_VIEW_USERS: readonly AdminRole[] = ["super_admin", "support_agent", "billing_admin"];

export function canViewUsers(role: AdminRole): boolean {
  return CAN_VIEW_USERS.includes(role);
}
