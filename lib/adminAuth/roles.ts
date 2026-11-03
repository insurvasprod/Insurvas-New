export const ADMIN_ROLES = [
  "super_admin",
  "support_agent",
  "billing_admin",
  "platform_config",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export function isAdminRole(value: string): value is AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(value);
}

// Sentence case (user decision, p-adm-admins): the boards write "Super admin", and every screen
// that prints these — the rail, the top bar, the dashboard, the tenant features tab — reads them
// either alone or in the middle of a sentence.
export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: "Super admin",
  support_agent: "Support agent",
  billing_admin: "Billing admin",
  platform_config: "Platform config",
};
