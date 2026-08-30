import type { AdminRole } from "@/lib/adminAuth/roles";

// Offering a discount is a billing action, so it matches subscriptions and invoices rather than
// plan design. A support agent cannot give money away.
export const CAN_MANAGE_COUPONS: readonly AdminRole[] = ["super_admin", "billing_admin"];

export function canManageCoupons(role: AdminRole): boolean {
  return CAN_MANAGE_COUPONS.includes(role);
}
