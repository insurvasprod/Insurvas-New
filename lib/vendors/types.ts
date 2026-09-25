/**
 * Vendors roster types. Plain module: imported by the client roster and by the server route, so it
 * must never import anything server-only.
 */

export const VENDOR_STATUSES = ["active", "under_review", "inactive"] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export const VENDOR_STATUS_LABEL: Record<VendorStatus, string> = {
  active: "Active",
  under_review: "Under review",
  inactive: "Inactive",
};

/** What the roster stores about who to call at a vendor. Every key optional; nothing else accepted. */
export type VendorContact = { name?: string; email?: string; phone?: string };

/**
 * A new campaign may go to an active or an under-review vendor (user decision 2026-09-25: under
 * review warns, it does not refuse). Only an inactive vendor is closed to new campaigns.
 */
export function vendorTakesCampaigns(status: string): boolean {
  return status === "active" || status === "under_review";
}

/** The warning shown wherever a campaign is created for an under-review vendor. Null when none. */
export function vendorCampaignWarning(status: string, name: string): string | null {
  return status === "under_review"
    ? `${name} is under review. You can still buy from them — decide whether this batch should wait for the review.`
    : null;
}

export type DropReason = { key: "cost" | "undialable" | "certificates"; text: string };

/** Everything the roster shows about one vendor beyond its base row, computed on the server. */
export type VendorCardFacts = {
  vendor_id: string;
  /** Null when tenant_vendor_card is not applied yet: unknown, not "no". */
  trialling: boolean | null;
  campaign_count: number | null;
  lead_count: number | null;
  trial_lead_threshold: number;
  renews_on: string | null;
  category: string | null;
  /** Scorecard's vendor_rows; null when not available or not entitled. */
  cost_per_policy_cents: number | null;
  issued_policies: number | null;
  net_spend_cents: number | null;
  /** How far one more issued policy would move cost per policy. Only for a trialling vendor. */
  one_more_sale_moves_cents: number | null;
  /** Ranked = has a cost per policy, not a test batch, not trialling, not inactive. */
  ranked: boolean;
  /** Returns' summary, aggregated by vendor. Null when nothing is claimable or it is unavailable. */
  claimable: { cents: number; rows: number; days_left: number } | null;
  /** Returns' vendor_undialable_rates. */
  undialable_percent: number | null;
  /** tenant_vendor_consent_coverage.claimed_coverage_pct. */
  certificate_pct: number | null;
  /** Facts only — never an action. Null when nothing crosses a threshold (or the vendor is trialling). */
  drop: { reasons: DropReason[]; renews_on: string | null } | null;
};

export type VendorCardsResponse = {
  cards: VendorCardFacts[];
  /** The ranked vendor with the lowest cost per policy, for "2× the best". */
  best: { vendor_id: string; vendor_name: string; cost_per_policy_cents: number } | null;
  /** Figures that come from True CPA need that feature; false means they were not read at all. */
  true_cpa: boolean;
  pending: Array<{ missing: string[]; detail: string }>;
};
