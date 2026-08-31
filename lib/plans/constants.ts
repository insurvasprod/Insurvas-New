// Client-safe: no `server-only` import, so client components can use these. Query functions
// live in ./queries, which is server-only.

export const PLAN_TYPES = ["individual", "agency_no_teams", "agency_with_teams", "management"] as const;

export type PlanType = (typeof PLAN_TYPES)[number];

export const PLAN_TYPE_LABELS: Record<PlanType, string> = {
  individual: "Individual",
  agency_no_teams: "Agency (flat)",
  agency_with_teams: "Agency (with teams)",
  management: "Management",
};

export const PLAN_TYPE_DESCRIPTIONS: Record<PlanType, string> = {
  individual: "One licensed agent, no downline. Always 1 seat.",
  agency_no_teams: "An agency with several producers and no hierarchy.",
  agency_with_teams: "An agency with hierarchy, overrides and splits.",
  management: "Internal / IMO management accounts.",
};

/**
 * Only `individual` plans are being built now (SA-00's locked decisions). The other three types
 * exist so the data model is right, but nothing should be sold on them yet — the features and
 * screens they'd need don't exist.
 */
export const BUILDABLE_PLAN_TYPES: readonly PlanType[] = ["individual"];

export type PlanListRow = {
  id: string;
  code: string;
  version: number;
  name: string;
  plan_type: PlanType;
  description: string | null;
  is_public: boolean;
  /** The plan the public pricing page leads with. At most one, enforced by a partial index. */
  is_default: boolean;
  is_archived: boolean;
  sort_order: number;
  created_at: string;
  version_count: number;
  subscriber_count: number;
  ever_subscribed_count: number;
};

export type PlanVersionRow = {
  id: string;
  code: string;
  version: number;
  name: string;
  plan_type: PlanType;
  is_archived: boolean;
  created_at: string;
  subscriber_count: number;
};

/** A plan code becomes a stable customer-facing identifier, so it's machine-safe. */
export const PLAN_CODE_PATTERN = /^[a-z][a-z0-9_]*$/;
export const PLAN_CODE_RULE = "Lowercase letters, digits and underscores only, starting with a letter";
