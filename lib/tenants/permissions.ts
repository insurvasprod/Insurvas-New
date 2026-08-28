import type { AdminRole } from "@/lib/adminAuth/roles";

// Basic Idea doc §2.5: "View tenant list" is ● for super_admin, support_agent and billing_admin,
// ○ for platform_config.
export const CAN_VIEW_TENANTS: readonly AdminRole[] = ["super_admin", "support_agent", "billing_admin"];

export function canViewTenants(role: AdminRole): boolean {
  return CAN_VIEW_TENANTS.includes(role);
}
