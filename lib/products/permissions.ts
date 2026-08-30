import type { AdminRole } from "@/lib/adminAuth/roles";

// Products are shared platform reference data, like plans and features. They do not contain
// customer credentials or billing records, so platform_config may maintain them as well as
// super_admin. Keep this separate from payment and tenant-assignment permissions.
export const CAN_MANAGE_PRODUCTS: readonly AdminRole[] = ["super_admin", "platform_config"];
