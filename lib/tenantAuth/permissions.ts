import type { TenantRole } from "./roles";

/**
 * Tenant-plane capabilities. These are product permissions, not plan permissions: the entitlement
 * answers whether a tenant bought a feature, and this map answers whether this member may use it.
 */
export const TENANT_PERMISSIONS = [
  "team.manage",
  "settings.manage",
  "leads.manage",
  "inbound.buffer",
  "calendar.manage",
  // LA-2.12 splits booking out of calendar.manage. A setter books into the agent's diary and must
  // not be able to change the availability that constrains it — "Book appointments into Ray's
  // slots" and "Cannot change availability or configuration" are two lines of the same table, and
  // one permission cannot express both.
  "appointments.book",
  "dialer.use",
  "sales.use",
  "policies.view",
  "commission.view.own",
  "commission.view.all",
  "money.view",
  "statements.view",
  "payouts.view",
  "exports.run",
  "recordings.listen",
  "scorecard.view.own",
  "scorecard.view.all",
] as const;

export type TenantPermission = (typeof TENANT_PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<TenantRole, readonly TenantPermission[]> = {
  owner: TENANT_PERMISSIONS,
  producer: [
    "leads.manage",
    "calendar.manage",
    "appointments.book",
    "dialer.use",
    "sales.use",
    "policies.view",
    "commission.view.own",
    "recordings.listen",
    "scorecard.view.own",
  ],
  assistant: ["leads.manage", "calendar.manage", "appointments.book", "inbound.buffer"],
  bookkeeper: [
    "policies.view",
    "commission.view.all",
    "money.view",
    "statements.view",
    "payouts.view",
    "exports.run",
  ],
  // LA-2.12. Everything the setter needs to work the outbound queue, and nothing that touches
  // money, a quote, an application, or the configuration that constrains him. The absences are the
  // specification: no sales.use, no policies.view, no commission.*, no calendar.manage, no
  // settings.manage, and scorecard.view.OWN rather than .all.
  setter: ["leads.manage", "appointments.book", "dialer.use", "scorecard.view.own"],
};

export function hasTenantPermission(role: TenantRole, permission: TenantPermission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function roleCanViewCommission(
  role: TenantRole,
  viewerUserId: string,
  producerUserId?: string,
): boolean {
  if (hasTenantPermission(role, "commission.view.all")) return true;
  return hasTenantPermission(role, "commission.view.own") && viewerUserId === producerUserId;
}

export function roleHasAny(role: TenantRole, permissions: readonly TenantPermission[]): boolean {
  return permissions.some((permission) => hasTenantPermission(role, permission));
}

export function rolePermissions(role: TenantRole): readonly TenantPermission[] {
  return ROLE_PERMISSIONS[role];
}

/**
 * The roles that hold a permission, as a route's `allowedRoles` list.
 *
 * LA-2.12 audit. Every route hand-lists the roles it admits, which is what makes deny-by-default
 * work — but a hand-list is also a second copy of the permission map, and the two drifted: the map
 * gave a setter `dialer.use` while all nine dialer routes named `["owner", "producer"]`, so the
 * role could not reach the surface it exists to work. Deriving the list means the map is the single
 * statement of who may do what, and adding a role to a capability reaches the routes that
 * capability names without anybody remembering to.
 */
export function rolesWith(permission: TenantPermission): readonly TenantRole[] {
  return (Object.keys(ROLE_PERMISSIONS) as TenantRole[]).filter((role) =>
    ROLE_PERMISSIONS[role].includes(permission),
  );
}
