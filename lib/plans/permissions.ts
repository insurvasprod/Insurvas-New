import type { AdminRole } from "@/lib/adminAuth/roles";

// Basic Idea doc §2.5: "Create / edit plans and prices" is ● for super_admin and ○ for every
// other role — including platform_config, who can maintain the feature catalog but not pricing.
export const CAN_MANAGE_PLANS: readonly AdminRole[] = ["super_admin"];

export function canManagePlans(role: AdminRole): boolean {
  return CAN_MANAGE_PLANS.includes(role);
}
