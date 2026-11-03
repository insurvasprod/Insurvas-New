import type { TenantRole } from "./roles.ts";

/**
 * Custom team access (docs/team-access/DESIGN.md) · one main role plus, with the add-on, extra WORKING roles.
 * Owner is never an extra role and the owner/admin main role holds none; the database enforces the same
 * (20261020500000: tenant_users_extra_roles_valid, tenant_set_member_access).
 */
export const CUSTOM_TEAM_ACCESS_FEATURE = "custom_team_access";
export const EXTRA_ROLES = ["producer", "assistant", "bookkeeper", "setter", "retention"] as const satisfies readonly TenantRole[];
export type ExtraRole = (typeof EXTRA_ROLES)[number];

export function isExtraRole(value: unknown): value is ExtraRole {
  return typeof value === "string" && (EXTRA_ROLES as readonly string[]).includes(value);
}

/** Set by proxy.ts on every signed-in /app request; read by the page guard. Overwritten, so a client cannot forge it. */
export const APP_PATH_HEADER = "x-insurvas-app-path";

/** Pages that can never be hidden: Settings holds the person's own profile, password and sessions. */
export const UNHIDEABLE_PAGES: ReadonlySet<string> = new Set(["settings.root"]);

/** The member's roles, main role first, extras (only while the add-on is held) after, never repeated. */
export function memberRoles(main: TenantRole, extras: readonly string[] | null | undefined, addOn: boolean): TenantRole[] {
  if (main === "owner" || !addOn || !extras?.length) return [main];
  return [main, ...EXTRA_ROLES.filter((role) => role !== main && extras.includes(role))];
}

// Widest first: the order a gate prefers among extra roles it allows. tenant_member_acting_role uses the same.
const WIDTH: readonly TenantRole[] = ["producer", "bookkeeper", "retention", "assistant", "setter"];

/**
 * The role a gate treats this member as: the main role when the gate allows it; otherwise the widest extra role
 * it allows; otherwise null (refused). Everything after the gate then runs exactly as for a member holding that
 * one role, so no "else" branch written for the allowed roles ever meets a role it was not written for.
 */
export function actingRole(roles: readonly TenantRole[], allowed: readonly TenantRole[]): TenantRole | null {
  if (roles.length === 0) return null;
  if (allowed.includes(roles[0])) return roles[0];
  return WIDTH.find((role) => roles.includes(role) && allowed.includes(role)) ?? null;
}

export function holdsAnyRole(roles: readonly TenantRole[], wanted: readonly TenantRole[]): boolean {
  return roles.some((role) => wanted.includes(role));
}

/**
 * What a combination of roles can see, for the Team screen's summary line. Money follows ROLE_PERMISSIONS (a
 * producer sees his own commissions, a bookkeeper everyone's); rows follow AG-0.4's agency_visible_user_ids, which
 * takes the union of the roles — the widest wins (inside an agency; a solo plan is never narrowed).
 */
export function accessSummary(roles: readonly TenantRole[], manager = false): { money: "all" | "own" | "none"; rows: string } {
  const has = (role: TenantRole) => roles.includes(role);
  const money = has("owner") || has("bookkeeper") ? "all" : has("producer") || has("retention") ? "own" : "none";
  if (has("owner") || has("bookkeeper") || has("retention")) return { money, rows: "everyone in the agency" };
  const parts: string[] = [];
  if (roles.some((role) => role !== "assistant")) parts.push("their own");
  if (has("assistant") || has("setter")) parts.push("the producers they are assigned to");
  if (manager && has("producer")) parts.push("their reports'");
  return { money, rows: parts.join(", ") || "their own" };
}

/** A path is hidden when a hidden menu item's path is it or an ancestor of it. */
export function isHiddenPath(pathname: string | null | undefined, hiddenPaths: readonly string[]): boolean {
  if (!pathname || hiddenPaths.length === 0) return false;
  return hiddenPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
