import type { AdminRole } from "@/lib/adminAuth/roles";

// Compliance vendors are platform-wide reference/configuration data. Platform config can maintain
// the registry, while billing admins only maintain offers/payments. This is intentionally separate
// from tenant-level provider assignment permissions so credential access cannot widen accidentally.
export const CAN_MANAGE_COMPLIANCE_VENDORS: readonly AdminRole[] = ["super_admin", "platform_config"];
