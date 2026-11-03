import type { AdminRole } from "@/lib/adminAuth/roles";

// Basic Idea doc §2.5: "View tenant list" is ● for super_admin, support_agent and billing_admin,
// ○ for platform_config.
export const CAN_VIEW_TENANTS: readonly AdminRole[] = ["super_admin", "support_agent", "billing_admin"];

export function canViewTenants(role: AdminRole): boolean {
  return CAN_VIEW_TENANTS.includes(role);
}

// Decision 4: suspending an agency locks every person in it out of the product, so it is a
// super_admin action only. Support and billing see the state and the reason; they cannot change it.
export const CAN_SUSPEND_TENANTS: readonly AdminRole[] = ["super_admin"];

export function canSuspendTenants(role: AdminRole): boolean {
  return CAN_SUSPEND_TENANTS.includes(role);
}
