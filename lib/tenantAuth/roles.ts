// LA-2.12 adds `setter` here rather than anywhere else on purpose. Every route in this app states
// the roles it admits, so a role that is new to this list is admitted by nothing until somebody
// names it — deny by default falls out of the existing design instead of being bolted on.
// LA-5.8 adds `retention` the same way, for the same reason: it reaches the LA-5 queues and the LA-4.16
// board because those routes name it, and nothing else.
export const TENANT_ROLES = ["owner", "producer", "assistant", "bookkeeper", "setter", "retention"] as const;

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
  retention: "Retention rep",
};

/**
 * AG-0.2. An agency adds two TITLES on the same tenant_users row, each riding on a base role whose
 * authority it keeps (migration 20261018110000, decision D11):
 *   admin   → owner    (everything except billing and plan changes)
 *   manager → producer (plus his direct reports)
 * Every existing gate compares the base role, so an admin passes owner gates and a manager passes
 * producer gates without 340 routes and 44 SQL functions learning two new words. Where the title must
 * change the answer (billing, visibility, labels), code reads the MemberRole.
 */
export const AGENCY_TITLES = ["admin", "manager"] as const;
export type AgencyTitle = (typeof AGENCY_TITLES)[number];

export function isAgencyTitle(value: unknown): value is AgencyTitle {
  return value === "admin" || value === "manager";
}

/** The role a person holds on the team screen: a base role, or an agency title. */
export const MEMBER_ROLES = ["owner", "admin", "manager", "producer", "assistant", "bookkeeper", "setter", "retention"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const TITLE_BASE_ROLE: Record<AgencyTitle, TenantRole> = { admin: "owner", manager: "producer" };

export const MEMBER_ROLE_LABELS: Record<MemberRole, string> = {
  ...TENANT_ROLE_LABELS,
  admin: "Admin",
  manager: "Manager",
};

export function memberRoleOf(role: TenantRole, agencyTitle: AgencyTitle | null | undefined): MemberRole {
  if (agencyTitle === "admin" && role === "owner") return "admin";
  if (agencyTitle === "manager" && role === "producer") return "manager";
  return role;
}

/** The base role a member role is stored as. */
export function baseRoleOf(memberRole: MemberRole): TenantRole {
  return isAgencyTitle(memberRole) ? TITLE_BASE_ROLE[memberRole] : memberRole;
}
