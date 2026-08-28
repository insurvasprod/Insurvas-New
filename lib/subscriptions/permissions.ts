import type { AdminRole } from "@/lib/adminAuth/roles";

// Basic Idea doc §2.5: "Change a tenant's plan" is ● for super_admin and billing_admin, ○ for
// support_agent and platform_config. Note this differs from "create/edit plans", which is
// super_admin only — selling an existing plan is a billing action, designing one is not.
export const CAN_MANAGE_SUBSCRIPTIONS: readonly AdminRole[] = ["super_admin", "billing_admin"];

export function canManageSubscriptions(role: AdminRole): boolean {
  return CAN_MANAGE_SUBSCRIPTIONS.includes(role);
}
