// Carrier fact reports (2026-10-27): what the agency's "Tell us" form and the admin queue share.
// Types and constants only, client-safe.

export const FACT_REPORT_KEYS = ["portal_origin", "reference_pattern", "billing_descriptor", "payment_methods", "products"] as const;
export type FactReportKey = (typeof FACT_REPORT_KEYS)[number];

/** The three facts staff can fix from the queue; the other two are fixed on the product catalog. */
export const FIXABLE_FACT_KEYS = ["portal_origin", "reference_pattern", "billing_descriptor"] as const;
export type FixableFactKey = (typeof FIXABLE_FACT_KEYS)[number];
export const isFixable = (key: FactReportKey): key is FixableFactKey => (FIXABLE_FACT_KEYS as readonly string[]).includes(key);

export const FACT_REPORT_LABEL: Record<FactReportKey, string> = {
  portal_origin: "Portal address",
  reference_pattern: "Policy number looks like",
  billing_descriptor: "Client’s bank statement shows",
  payment_methods: "Pays by",
  products: "A product is missing or wrong",
};

export type FactReportStatus = "open" | "fixed" | "declined";

export type FactReportView = {
  id: string;
  carrierId: string;
  carrierName: string;
  factKey: FactReportKey;
  shownValue: string | null;
  suggestedValue: string;
  evidence: string | null;
  status: FactReportStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
};

/** The staff queue adds who reported it and what the platform holds now. */
export type FactReportQueueRow = FactReportView & {
  tenantId: string;
  tenantName: string;
  reportedBy: string | null;
  /** The platform carrier's current value for a fixable fact; null for the other two. */
  currentValue: string | null;
};

export const FACT_REPORTS_PENDING_MESSAGE = "Carrier fact reports need a database update (20261027200000) that has not been applied yet.";
