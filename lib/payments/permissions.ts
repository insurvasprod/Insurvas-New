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

/**
 * SA-4.2's provider configuration screen — `super_admin` ONLY, deliberately narrower than
 * CAN_MANAGE_PAYMENT_PROVIDERS above.
 *
 * That constant governs ASSIGNING a tenant to an already-configured provider, which is a billing
 * action a billing_admin should be able to take. This screen exposes which credentials are live,
 * which account real money flows through, and a button that makes an authenticated call as the
 * platform. Different question, different answer — do not collapse the two because they both have
 * "payment provider" in the name.
 */
export const CAN_CONFIGURE_PROVIDER: readonly AdminRole[] = ["super_admin"];

export function canConfigureProvider(role: AdminRole): boolean {
  return CAN_CONFIGURE_PROVIDER.includes(role);
}
