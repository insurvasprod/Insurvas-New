import type { AdminRole } from "@/lib/adminAuth/roles";

// Templates are shared platform reference data. They are not tenant records or payment
// credentials, so platform_config may maintain them alongside super_admin. The later SA-4.7
// agent assignment path must not reuse this write permission for tenant-owned copies.
export const CAN_MANAGE_TEMPLATES: readonly AdminRole[] = ["super_admin", "platform_config"];
