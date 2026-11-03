// Client-safe: no `server-only` import, because the agent app's client components render from
// this shape too.

import type { AccessLevel } from "@/lib/subscriptions/access";
import type { SubscriptionStatus } from "@/lib/subscriptions/access";

export type EntitlementMeter = {
  included: number | null; // null = unlimited
  hard_cap: boolean;
  used: number;
};

/**
 * THE contract between the control plane and the tenant plane (Basic Idea doc, Appendix A).
 *
 * The agent app reads this one object and obeys it. It never queries a plan, a subscription or a
 * price — which is what lets the two halves be built independently.
 */
export type Entitlement = {
  tenant_id: string;
  plan_code: string | null;
  /** The plan's display name (plans.name) since 20261003100000; absent in a blob computed before it. */
  plan_name?: string | null;
  plan_version: number | null;
  status: SubscriptionStatus | null;
  access: AccessLevel;
  computed_at: string;
  features: string[];
  meters: Record<string, EntitlementMeter>;
  /** Nullable capacities are data from the cached entitlement; null means unlimited. */
  limits: {
    max_seats: number | null;
    max_publishers: number | null;
    max_marketing_partners: number | null;
    max_affiliates: number | null;
    max_buffer_seats: number | null;
    max_partner_users: number | null;
    max_setter_seats?: number | null;
    max_active_campaigns?: number | null;
    /** plans.max_carriers (20261015601000); enforced in the database where an agency adds one. Absent on older snapshots = unlimited. */
    max_carriers?: number | null;
    /** Kept for old seeded snapshots until they are rebuilt. */
    max_partners?: number | null;
  };
  period_start?: string;
  /**
   * Features the plan (or an add-on) grants that staff switched off for this tenant alone
   * (tenant_feature_overrides, 20260924344000). Already removed from `features`; listed here so the
   * agent app says "not available on your account" instead of offering an upgrade for something the
   * tenant already pays for. Absent on snapshots built before that migration.
   */
  disabled_features?: string[];
  /** Set by the 20260924344000 engine: meter allowances already include the period's credit grants. */
  credit_grants_included?: boolean;
  /**
   * LA-8.5: a cancelled agency's read-only access ends here (cancelled_at + the retention window).
   * Null or absent for every other status.
   */
  retention_until?: string | null;
};

/**
 * LA-8.5: the snapshot is computed when something changes, and nothing changes on the day a cancelled
 * agency's retention window ends — so the end is applied on read, here, as well as by the engine.
 */
export function applyRetentionWindow(entitlement: Entitlement, now = new Date()): Entitlement {
  if (entitlement.status !== "cancelled" || !entitlement.retention_until) return entitlement;
  if (Date.parse(entitlement.retention_until) > now.getTime()) return entitlement;
  return { ...entitlement, access: "none", features: [], meters: {} };
}

export function hasFeature(entitlement: Entitlement, featureKey: string): boolean {
  return entitlement.features.includes(featureKey);
}

/** Granted by the plan, switched off for this one tenant by staff — not an upgrade case. */
export function isDisabledForTenant(entitlement: Entitlement, featureKey: string): boolean {
  return !hasFeature(entitlement, featureKey) && (entitlement.disabled_features ?? []).includes(featureKey);
}

/** The neutral words for a feature switched off for one tenant. No upgrade, no blame. */
export const DISABLED_FOR_TENANT_MESSAGE = "This feature is not available on your account.";

/** Read-only tenants can still SEE everything their plan grants — they just can't act. */
export function canWrite(entitlement: Entitlement): boolean {
  return entitlement.access === "full";
}

export const EMPTY_ENTITLEMENT: Omit<Entitlement, "tenant_id"> = {
  plan_code: null,
  plan_name: null,
  plan_version: null,
  status: null,
  access: "none",
  computed_at: new Date(0).toISOString(),
  features: [],
  meters: {},
  limits: {
    max_seats: null,
    max_publishers: null,
    max_marketing_partners: null,
    max_affiliates: null,
    max_buffer_seats: null,
    max_partner_users: null,
    max_setter_seats: null,
    max_active_campaigns: null,
    max_carriers: null,
  },
};
