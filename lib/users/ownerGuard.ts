// "Deleting the last owner of a tenant is blocked" — the route-side half of the rule, kept as a pure
// function so it can be tested. Plain module: no `server-only`, no imports.
//
// It counts owners the way the database guard in admin_update_user_with_email_change does
// (`tu.role = 'owner' and u.status <> 'deleted'`): a soft-deleted owner is not an owner anybody can
// sign in as, so a tenant whose only other "owner" was removed is a tenant about to have none. The
// route used to count every owner row whatever its user's status, so that tenant passed.

export type OwnerRow = { tenant_id: string; status: string | null };

/** An owner who still counts: anything but a removed (soft-deleted) account. */
export function isLiveOwner(status: string | null): boolean {
  return status !== null && status !== "deleted";
}

/**
 * The tenants that deleting this owner would leave with no live owner. `ownerRows` are every owner
 * membership of `ownedTenantIds` (the departing user included), with each owner's account status.
 */
export function tenantsLeftWithoutOwner(ownedTenantIds: readonly string[], ownerRows: readonly OwnerRow[]): string[] {
  const live = new Map<string, number>();
  for (const row of ownerRows) {
    if (isLiveOwner(row.status)) live.set(row.tenant_id, (live.get(row.tenant_id) ?? 0) + 1);
  }
  return ownedTenantIds.filter((tenantId) => (live.get(tenantId) ?? 0) <= 1);
}

/**
 * Which tenant an admin edit applies to. A user can belong to more than one tenant (workspace
 * switching), and the role being edited is per tenant, so the edit must name it. Returns the tenant,
 * `null` for a user with no membership, or an error when the request is ambiguous or wrong.
 */
export function resolveEditTenant(
  memberships: readonly string[],
  requested: string | null | undefined,
): { tenantId: string | null } | { error: "not_member" | "ambiguous" } {
  if (requested) return memberships.includes(requested) ? { tenantId: requested } : { error: "not_member" };
  if (memberships.length > 1) return { error: "ambiguous" };
  return { tenantId: memberships[0] ?? null };
}
