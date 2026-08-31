import type { AdminRole } from "@/lib/adminAuth/roles";

// Same pair as the feature catalog: platform_config's remit is the shared reference data every
// tenant reads (Basic Idea doc §2.3), and these keys carry no customer data — the line §2.5 draws
// for that role.
//
// Note this is a WIDER set than SA-4.2's payment provider screen, which holds live API keys and
// is super_admin only. Nothing in this store is a credential; if that ever changes, that key
// belongs on its own screen with its own gate, not here.
export const CAN_MANAGE_SETTINGS: readonly AdminRole[] = ["super_admin", "platform_config"];

export function canManageSettings(role: AdminRole): boolean {
  return CAN_MANAGE_SETTINGS.includes(role);
}
