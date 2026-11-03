import { TENANT_ROLE_LABELS, isTenantRole, type TenantRole } from "./roles.ts";

/**
 * One person, several workspaces.
 *
 * `tenant_users` is keyed by (tenant_id, user_id), so one account can hold a membership in more
 * than one agency. These are the rules for which of them count, kept free of the database so they
 * can be tested; `workspaceService.ts` applies them to rows.
 */

export type MembershipRow = {
  tenant_id: string;
  role: string;
  accepted_at: string | null;
  invited_at?: string | null;
  tenant_name?: string | null;
};

export type Workspace = { tenantId: string; name: string; role: TenantRole; roleLabel: string; current: boolean };

/**
 * A membership a person can be signed into: a role this app knows, and an invitation they have
 * accepted. An invitation still waiting is somebody else's offer, not a workspace of theirs.
 */
export function isUsableMembership(row: MembershipRow): boolean {
  return isTenantRole(row.role) && Boolean(row.accepted_at);
}

/**
 * The workspace a login opens. Before this, login read memberships with `maybeSingle`, which
 * errors on two rows — so anybody in a second workspace could not sign in at all.
 *
 * Accepted memberships first, oldest first: the workspace a person has belonged to longest is the
 * least surprising place to land, and the choice is the same on every login. When none is accepted
 * the old behaviour stands — a single membership row, accepted or not, still signs in as before.
 */
export function pickLoginMembership(rows: MembershipRow[]): MembershipRow | null {
  const known = rows.filter((row) => isTenantRole(row.role));
  const accepted = known.filter((row) => row.accepted_at).sort((a, b) => String(a.accepted_at).localeCompare(String(b.accepted_at)) || a.tenant_id.localeCompare(b.tenant_id));
  if (accepted.length) return accepted[0];
  return known.length === 1 ? known[0] : null;
}

/** The account menu's list: usable memberships, by name, with the one signed in marked. */
export function describeWorkspaces(rows: MembershipRow[], currentTenantId: string): Workspace[] {
  return rows
    .filter((row) => isUsableMembership(row) || row.tenant_id === currentTenantId)
    .filter((row) => isTenantRole(row.role))
    .map((row) => ({
      tenantId: row.tenant_id,
      name: row.tenant_name?.trim() || "Unnamed workspace",
      role: row.role as TenantRole,
      roleLabel: TENANT_ROLE_LABELS[row.role as TenantRole],
      current: row.tenant_id === currentTenantId,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.tenantId.localeCompare(b.tenantId));
}
