// Client-safe partner vocabulary shared by the form, API schemas and list labels.
export const PARTNER_TYPES = ["publisher", "marketing", "affiliate"] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];
export const PARTNER_TYPE_LABELS: Record<PartnerType, string> = {
  publisher: "Publisher",
  marketing: "Marketing company",
  affiliate: "Affiliate",
};

export const PARTNER_STATUSES = ["draft", "active", "paused", "offboarded"] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];
export const PARTNER_STATUS_LABELS: Record<PartnerStatus, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  offboarded: "Offboarded",
};

export const PARTNER_PAYOUT_MODELS = ["per_transfer", "per_lead", "per_sale", "per_issued_policy", "revenue_share"] as const;
export type PartnerPayoutModel = (typeof PARTNER_PAYOUT_MODELS)[number];
export const PARTNER_PAYOUT_MODEL_LABELS: Record<PartnerPayoutModel, string> = {
  per_transfer: "Per transfer",
  per_lead: "Per lead",
  per_sale: "Per sale",
  per_issued_policy: "Per issued policy",
  revenue_share: "Revenue share",
};
