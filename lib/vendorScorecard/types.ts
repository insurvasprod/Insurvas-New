export type VendorScorecardRow = {
  campaign_id: string;
  vendor_id: string;
  vendor_name: string;
  campaign_name: string;
  product_code: string | null;
  total_spend_cents: number;
  /** Lifetime, from the campaign: what was bought, not what arrived in the period. */
  records_purchased: number;
  credits_received_cents: number;
  /**
   * Net spend for the period, split by the share of records received in it — the formula
   * tenant_campaign_comparison uses (20260925708200). Null when the campaign records no purchased
   * count, so the spend cannot be split. Before that migration: lifetime net spend.
   */
  net_spend_cents: number | null;
  /** total − credits, whole life of the campaign. */
  lifetime_net_spend_cents: number;
  /** Unit price: total spend ÷ records purchased. Null with no records. */
  cost_per_record_cents: number | null;
  leads_received: number;
  attempts: number;
  contacted_leads: number;
  /** Distinct leads with a call attempt in the period (20260925709800). Null before it: the old report counts attempts only. */
  dialed_leads: number | null;
  /** Leads with a quote recorded on the deal, or an application opened, in the period. Null before 20260925709800. */
  quoted_leads: number | null;
  /** Leads with at least one application in the period. Null before 20260925709800. */
  applied_leads: number | null;
  /** Net spend ÷ contacted leads. Null (a dash, never $0) when nobody was contacted. */
  effective_cost_per_contact_cents: number | null;  applications: number;
  issued_policies: number;
  lapsed_policies: number;
  policies_not_yet_measurable: number;
  attribution_warnings: number;
  effective_cost_per_lead_cents: number | null;
  effective_cost_per_application_cents: number | null;
  effective_cost_per_issued_policy_cents: number | null;
  contact_rate_percent: number | null;
  /** tenant_campaigns.is_test_batch (20260925708000). Excluded from the ranking. */
  is_test_batch: boolean;
  /** 1 to (small_sample_below − 1) issued policies. */
  small_sample: boolean;
  /** 1 = cheapest policy. Null for a test batch or a row with no cost per issued policy. */
  cost_rank: number | null;
  undialable_leads: number;
  undialable_rate_percent: number | null;
  /** leads_received − undialable_leads. */
  dialable_leads: number;
  claim_count: number;
  amount_claimed_cents: number;
  amount_credited_cents: number;
  claim_acceptance_rate_percent: number | null;
};

/**
 * One vendor, over its committed campaigns in scope (all of them when every one is a test batch,
 * and then is_test_batch is true). THE per-vendor cost per issued policy — /app/vendors reads this
 * through getVendorCostPerPolicy rather than computing its own.
 */
export type VendorScorecardVendorRow = {
  vendor_id: string;
  vendor_name: string;
  is_test_batch: boolean;
  campaigns: number;
  test_batch_campaigns: number;
  total_spend_cents: number;
  records_purchased: number;
  credits_received_cents: number;
  lifetime_net_spend_cents: number;
  net_spend_cents: number | null;
  cost_per_record_cents: number | null;
  leads_received: number;
  attempts: number;
  contacted_leads: number;
  /** Distinct leads with a call attempt in the period (20260925709800). Null before it: the old report counts attempts only. */
  dialed_leads: number | null;
  /** Leads with a quote recorded on the deal, or an application opened, in the period. Null before 20260925709800. */
  quoted_leads: number | null;
  /** Leads with at least one application in the period. Null before 20260925709800. */
  applied_leads: number | null;
  /** Net spend ÷ contacted leads. Null (a dash, never $0) when nobody was contacted. */
  effective_cost_per_contact_cents: number | null;  applications: number;
  issued_policies: number;
  lapsed_policies: number;
  policies_not_yet_measurable: number;
  attribution_warnings: number;
  effective_cost_per_lead_cents: number | null;
  effective_cost_per_application_cents: number | null;
  effective_cost_per_issued_policy_cents: number | null;
  contact_rate_percent: number | null;
  small_sample: boolean;
  cost_rank: number | null;
  /** tenant_vendor_speed_to_lead: real-time posted leads only, all time. */
  speed_posted_leads: number | null;
  speed_dialled_leads: number | null;
  speed_median_seconds: number | null;
  speed_within_60s_pct: number | null;
  /** tenant_vendor_consent_coverage: every lead of the vendor, all time. */
  consent_leads: number | null;
  consent_claimed_leads: number | null;
  consent_claimed_pct: number | null;
  consent_any_pct: number | null;
  /** Added by the service from the same campaigns' vendor_return_metrics figures. */
  undialable_leads: number;
  undialable_rate_percent: number | null;
  dialable_leads: number;
  amount_claimed_cents: number;
  amount_credited_cents: number;
  claim_acceptance_rate_percent: number | null;
};

export type VendorScorecardTotals = {
  campaigns: number;
  test_batch_campaigns: number;
  /** Campaigns with spend but no purchased count: their spend is not in net_spend_cents. */
  unallocated_spend_campaigns: number;
  net_spend_cents: number;
  lifetime_net_spend_cents: number;
  total_spend_cents: number;
  credits_received_cents: number;
  records_purchased: number;
  leads_received: number;
  attempts: number;
  contacted_leads: number;
  /** Distinct leads with a call attempt in the period (20260925709800). Null before it: the old report counts attempts only. */
  dialed_leads: number | null;
  /** Leads with a quote recorded on the deal, or an application opened, in the period. Null before 20260925709800. */
  quoted_leads: number | null;
  /** Leads with at least one application in the period. Null before 20260925709800. */
  applied_leads: number | null;
  /** Net spend ÷ contacted leads. Null (a dash, never $0) when nobody was contacted. */
  effective_cost_per_contact_cents: number | null;  applications: number;
  issued_policies: number;
  lapsed_policies: number;
  policies_not_yet_measurable: number;
  attribution_warnings: number;
  effective_cost_per_lead_cents: number | null;
  effective_cost_per_application_cents: number | null;
  effective_cost_per_issued_policy_cents: number | null;
  contact_rate_percent: number | null;
  undialable_leads: number;
  undialable_rate_percent: number | null;
  dialable_leads: number;
  claim_count: number;
  amount_claimed_cents: number;
  amount_credited_cents: number;
  claim_acceptance_rate_percent: number | null;
};

export type VendorScorecardReport = {
  from: string;
  to: string;
  generated_at: string;
  live: boolean;
  snapshot: false;
  /** The persistency window applied (the page sends 60), or null for "issued, in force now". */
  persist_days: number | null;
  /** A row with fewer issued policies than this (and at least one) is a small sample. */
  small_sample_below: number;
  totals: VendorScorecardTotals;
  rows: VendorScorecardRow[];
  vendor_rows: VendorScorecardVendorRow[];
  contact_rate_by_slot: Array<{ slot: string; attempts: number; contacts: number; rate_percent: number | null }>;
  attempts_to_contact: Array<{ attempt_number: number; attempts: number; contacts: number; rate_percent: number | null; share_of_contacts_percent: number | null }>;
  filters: { vendor_id: string | null; campaign_id: string | null; product_code: string | null };
  readOnly: boolean;
  /**
   * False until 20260925708200 is applied: the report is the old one, with lifetime spend, no
   * vendor roll-up, no persistency and no test batches. The page says so instead of pretending.
   */
  upgraded: boolean;
  /** True once 20260925709800 is applied: dialed and quoted leads exist, and every figure drills to its rows. */
  funnel: boolean;
};

export type VendorScorecardLead = {
  lead_id: string;
  lead_date: string;
  product_line: string;
  campaign_name: string;
  vendor_name: string;
  attempts: number;
  contacts: number;
  applications: number;
  issued_policies: number;
  attribution_status: "linked" | "review attribution";
  /** Per-lead funnel flags, from tenant_vendor_scorecard_drill (20260925709800). */
  dialed?: boolean;
  contacted?: boolean;
  quoted?: boolean;
  dialable?: boolean;
};

/** A funnel stage a figure can be drilled into. */
export type ScorecardStage = "received" | "dialable" | "undialable" | "dialed" | "contacted" | "quoted" | "applied" | "issued";
export const SCORECARD_STAGES: readonly ScorecardStage[] = ["received", "dialable", "undialable", "dialed", "contacted", "quoted", "applied", "issued"];

export type VendorScorecardLeadResult = {
  rows: VendorScorecardLead[];
  stage: ScorecardStage;
  /** Every lead the figure counts, not just this page. Null from the old drill, which cannot say. */
  total: number | null;
  offset: number;
  limit: number;
  /** More rows than this page: the next page is offset + limit. */
  has_more: boolean;
  /** The whole selection's sums, which reconcile with the figure clicked. Null from the old drill. */
  sums: { leads: number; attempts: number; dialed_leads: number; contacted_leads: number; quoted_leads: number; applications: number; issued_policies: number; undialable_leads: number } | null;
  /** False before 20260925709800: only campaign rows drill, 500 leads at most, attempts of all time. */
  drillReady: boolean;
};

export type ComparisonMetricKey = "contact_rate" | "conversion_rate" | "cost_per_issued";
export type CampaignComparison = {
  metric: { key: ComparisonMetricKey; label: string; unit: "percent" | "cents"; a_value: number | null; b_value: number | null; difference: number | null };
  campaign_a: { id: string; name: string; vendor_name: string; from: string; to: string; leads: number; attempted: number; contacted: number; applications: number; issued_policies: number; allocated_spend_cents: number };
  campaign_b: { id: string; name: string; vendor_name: string; from: string; to: string; leads: number; attempted: number; contacted: number; applications: number; issued_policies: number; allocated_spend_cents: number };
  funnel: Array<{ stage: string; a_count: number; b_count: number; difference: number; a_rate_percent: number | null; b_rate_percent: number | null }>;
  matched_periods: { same_length: boolean; aligned_start_weekday: boolean; days: number };
  confidence: { level: "insufficient" | "directional" | "strong" | "not_conclusive"; sample_a: number; sample_b: number; needed_for_200: number; size_warning: string | null; statement: string };
};

export type VendorReturnCandidate = {
  lead_id: string;
  campaign_id: string;
  vendor_id: string;
  campaign_name: string;
  vendor_name: string;
  lead_created_at: string;
  reason: "wrong_number" | "disconnected" | "dnc" | "tcpa_litigator" | "invalid_phone";
  source_type: "scrub" | "disposition";
  source_id: string | null;
  evidence: Record<string, unknown>;
  claimable_until: string;
  days_remaining: number;
  claimable: boolean;
};

export type VendorReturnClaim = {
  id: string;
  tenant_id: string;
  campaign_id: string;
  vendor_id: string;
  reason: string;
  lead_count: number;
  amount_claimed_cents: number;
  status: "draft" | "submitted" | "accepted" | "rejected" | "partial";
  submitted_at: string | null;
  resolved_at: string | null;
  amount_credited_cents: number;
  replacement_leads_count: number;
  rejection_reason: string | null;
  notes: string | null;
  created_at: string;
  /** Added by the service after the report RPC; absent on the RPC's own rows. */
  campaign_name?: string | null;
  vendor_name?: string | null;
  /** When the claimed leads arrived, first and last. */
  period_from?: string | null;
  period_to?: string | null;
};

export type VendorReturnsReport = { claimable: VendorReturnCandidate[]; claims: VendorReturnClaim[] };
export type VendorReturnClaimDetail = { claim: VendorReturnClaim; items: Array<{ id: string; lead_id: string; reason: VendorReturnCandidate["reason"]; evidence: Record<string, unknown>; created_at: string }> };
