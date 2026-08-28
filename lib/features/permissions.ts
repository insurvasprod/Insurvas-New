import type { AdminRole } from "@/lib/adminAuth/roles";

// The catalog is shared reference data — platform_config's whole remit (Basic Idea doc §2.3) —
// so they can maintain it alongside super_admin. It contains no customer data, which is the
// line §2.5 draws for that role.
export const CAN_MANAGE_FEATURES: readonly AdminRole[] = ["super_admin", "platform_config"];

export function canManageFeatures(role: AdminRole): boolean {
  return CAN_MANAGE_FEATURES.includes(role);
}
