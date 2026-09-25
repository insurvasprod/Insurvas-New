// LA-2.12 adds `setter` here rather than anywhere else on purpose. Every route in this app states
// the roles it admits, so a role that is new to this list is admitted by nothing until somebody
// names it — deny by default falls out of the existing design instead of being bolted on.
export const TENANT_ROLES = ["owner", "producer", "assistant", "bookkeeper", "setter"] as const;

export type TenantRole = (typeof TENANT_ROLES)[number];

export function isTenantRole(value: string): value is TenantRole {
  return (TENANT_ROLES as readonly string[]).includes(value);
}

export const TENANT_ROLE_LABELS: Record<TenantRole, string> = {
  owner: "Owner",
  producer: "Producer",
  assistant: "Assistant",
  bookkeeper: "Bookkeeper",
  setter: "Setter",
};
