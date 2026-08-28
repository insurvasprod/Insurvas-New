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

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  support_agent: "Support Agent",
  billing_admin: "Billing Admin",
  platform_config: "Platform Config",
};
