import type { AdminRole } from "@/lib/adminAuth/roles";

// Choosing which provider charges a given tenant is a billing action, so it matches
// CAN_MANAGE_SUBSCRIPTIONS rather than plan design.
//
// This is NOT the same permission as SA-4.2's platform configuration screen, which holds real API
// keys and is super_admin only. Assigning a tenant to an already-configured provider is safe for a
// billing admin; entering the live secret key is not.
export const CAN_MANAGE_PAYMENT_PROVIDERS: readonly AdminRole[] = ["super_admin", "billing_admin"];

export function canManagePaymentProviders(role: AdminRole): boolean {
  return CAN_MANAGE_PAYMENT_PROVIDERS.includes(role);
}
