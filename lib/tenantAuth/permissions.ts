import { isAgencyTitle, type MemberRole, type TenantRole } from "./roles.ts";

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
  // LA-5.8. Working the LA-5 queues and the LA-4.16 board: calls, servicing requests, outcomes.
  "retention.work",
  // LA-5.8. The one money figure a retention rep sees: the unearned advance on a policy they are
  // working. A rep cannot prioritise without it; commission totals, rate cards and the ledger stay shut.
  "retention.exposure",
  // AG-0.2. The subscription, the plan and the payment method: the one thing an agency admin may not do.
  "billing.manage",
  // AG-0.2. A manager's direct reports — their leads, policies and scorecards (AG-0.3 / AG-0.4 scope the rows).
  "team.view.reports",
] as const;

export type TenantPermission = (typeof TENANT_PERMISSIONS)[number];

const PRODUCER_PERMISSIONS: readonly TenantPermission[] = [
  "leads.manage",
  "calendar.manage",
  "appointments.book",
  "dialer.use",
  "sales.use",
  "policies.view",
  "commission.view.own",
  "recordings.listen",
  "scorecard.view.own",
  "retention.work",
  "retention.exposure",
];

/**
 * The matrix, once, as data (AG-0.2). The menu filter, the page guards and the API middleware all read it;
 * nothing writes it out a second time. A role this map does not name has no permissions: default deny.
 * Keyed by MemberRole, so the agency titles are rows of the same table rather than a second model.
 */
const ROLE_PERMISSIONS: Record<MemberRole, readonly TenantPermission[]> = {
  owner: TENANT_PERMISSIONS,
  // AG-0.2: everything except billing and plan changes.
  admin: TENANT_PERMISSIONS.filter((permission) => permission !== "billing.manage"),
  // AG-0.2: own + direct reports — leads, policies, scorecards. No agency accounting, no other pods.
  manager: [...PRODUCER_PERMISSIONS, "team.view.reports"],
  producer: PRODUCER_PERMISSIONS,
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
  // LA-5.8. Work the save queue, the paper-bill campaign, reinstatement cases and the LA-4.16 board,
  // open and track servicing requests, log outcomes — and see their own scorecard. The absences are the
  // specification again: no sales.use (sell, quote, apply), no commission.* / money.view, no
  // settings.manage (weights and thresholds), no scorecard.view.all.
  retention: ["retention.work", "retention.exposure", "scorecard.view.own"],
};

export function hasTenantPermission(role: MemberRole, permission: TenantPermission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

export function roleCanViewCommission(
  role: MemberRole,
  viewerUserId: string,
  producerUserId?: string,
): boolean {
  if (hasTenantPermission(role, "commission.view.all")) return true;
  return hasTenantPermission(role, "commission.view.own") && viewerUserId === producerUserId;
}

export function roleHasAny(role: MemberRole, permissions: readonly TenantPermission[]): boolean {
  return permissions.some((permission) => hasTenantPermission(role, permission));
}

export function rolePermissions(role: MemberRole): readonly TenantPermission[] {
  return ROLE_PERMISSIONS[role] ?? [];
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
  // Routes compare the BASE role (an admin passes as owner, a manager as producer — roles.ts), so the
  // agency titles never appear in a route's list; they reach a route through their base role.
  return (Object.keys(ROLE_PERMISSIONS) as MemberRole[]).filter(
    (role): role is TenantRole => !isAgencyTitle(role) && ROLE_PERMISSIONS[role].includes(permission),
  );
}

/**
 * AG-0.2 · the matrix is the truth, and a title must not gain through its base role what the matrix
 * withholds. An admin's base role (owner) holds billing.manage; the admin does not. Every route that
 * guards a permission the base role has but the title lacks calls this after its role check.
 */
export function titleWithholds(memberRole: MemberRole, permission: TenantPermission): boolean {
  return isAgencyTitle(memberRole) && !hasTenantPermission(memberRole, permission);
}
