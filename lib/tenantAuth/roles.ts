export const TENANT_ROLES = ["owner", "producer", "assistant", "bookkeeper"] as const;

export type TenantRole = (typeof TENANT_ROLES)[number];

export function isTenantRole(value: string): value is TenantRole {
  return (TENANT_ROLES as readonly string[]).includes(value);
}

export const TENANT_ROLE_LABELS: Record<TenantRole, string> = {
  owner: "Owner",
  producer: "Producer",
  assistant: "Assistant",
  bookkeeper: "Bookkeeper",
};
