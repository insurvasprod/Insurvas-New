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
] as const;

export type TenantPermission = (typeof TENANT_PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<TenantRole, readonly TenantPermission[]> = {
  owner: TENANT_PERMISSIONS,
  producer: [
    "leads.manage",
    "calendar.manage",
    "dialer.use",
    "sales.use",
    "policies.view",
    "commission.view.own",
    "recordings.listen",
  ],
  assistant: ["leads.manage", "calendar.manage", "inbound.buffer"],
  bookkeeper: [
    "policies.view",
    "commission.view.all",
    "money.view",
    "statements.view",
    "payouts.view",
    "exports.run",
  ],
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
