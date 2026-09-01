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
  plan_version: number | null;
  status: SubscriptionStatus | null;
  access: AccessLevel;
  computed_at: string;
  features: string[];
  meters: Record<string, EntitlementMeter>;
  /** LA-1.19 may populate max_partners; null/absent means no configured cap yet. */
  limits: { max_seats: number | null; max_partners?: number | null };
  period_start?: string;
};

export function hasFeature(entitlement: Entitlement, featureKey: string): boolean {
  return entitlement.features.includes(featureKey);
}

/** Read-only tenants can still SEE everything their plan grants — they just can't act. */
export function canWrite(entitlement: Entitlement): boolean {
  return entitlement.access === "full";
}

export const EMPTY_ENTITLEMENT: Omit<Entitlement, "tenant_id"> = {
  plan_code: null,
  plan_version: null,
  status: null,
  access: "none",
  computed_at: new Date(0).toISOString(),
  features: [],
  meters: {},
  limits: { max_seats: null },
};
