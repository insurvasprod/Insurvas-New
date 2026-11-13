import { memberRoleOf, type AgencyTitle, type MemberRole } from "@/lib/tenantAuth/roles";
import type { TeamMember } from "@/lib/tenantTeam/service";

/**
 * Team & access (settings round 8, wave 3): the board's plain names for the fixed roles. The roles
 * themselves are LA-0.2's (lib/tenantAuth/roles.ts) and are not changed here; only what a person reads.
 * What each one reaches is read off lib/tenantAuth/permissions.ts and lib/menu/definition.ts.
 */
export type RoleChoice = { role: MemberRole; label: string; help: string; access: string };

/** The three the board shows first. */
export const MAIN_ROLES: RoleChoice[] = [
  { role: "producer", label: "Agent", help: "Leads, dialer, calendar and quoting", access: "Agent" },
  { role: "setter", label: "Setter", help: "Dial and book only; never given a lead that needs a licence", access: "Setter · dial and book" },
  { role: "assistant", label: "Intake", help: "Leads, imports and inbound; no dialer. Takes inbound overflow as a buffer agent", access: "Intake · leads and inbound" },
];

/** Behind "Show more roles". */
export const MORE_ROLES: RoleChoice[] = [
  { role: "admin", label: "Admin", help: "Everything but billing; manages everyone except the owner", access: "Admin" },
  { role: "bookkeeper", label: "Accounting", help: "Policies, all commissions, statements and payouts", access: "Accounting" },
  { role: "retention", label: "Retention", help: "The save queue, reinstatements and the lapse-risk board", access: "Retention" },
  { role: "owner", label: "Owner", help: "Everything, including billing", access: "Everything" },
];

export const ALL_ROLES = [...MAIN_ROLES, ...MORE_ROLES];

/** The role on the screen: a base role, or an agency title riding on it. A manager is an agent who leads a team. */
export function memberRole(member: Pick<TeamMember, "role" | "agencyTitle">): MemberRole {
  return memberRoleOf(member.role, (member.agencyTitle ?? null) as AgencyTitle | null);
}

export function accessLabel(role: MemberRole): string {
  if (role === "manager") return "Agent";
  return ALL_ROLES.find((choice) => choice.role === role)?.access ?? role;
}

/** Roles whose leads are gated on licences; a setter books only, and the others do not sell. */
export function isLicensed(role: MemberRole) {
  return role === "owner" || role === "admin" || role === "producer" || role === "manager";
}

/** People / Setters / Office, as the board's filter groups them. */
export type Group = "all" | "agents" | "setters" | "office";
export function groupOf(role: MemberRole): Exclude<Group, "all"> {
  if (role === "producer" || role === "manager") return "agents";
  if (role === "setter") return "setters";
  return "office";
}
