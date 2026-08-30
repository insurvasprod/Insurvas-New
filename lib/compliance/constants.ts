export const COMPLIANCE_VENDOR_TYPES = [
  "dnc_scrub",
  "litigator_scrub",
  "consent_certificate",
  "phone_validation",
] as const;

export type ComplianceVendorType = (typeof COMPLIANCE_VENDOR_TYPES)[number];

export const COMPLIANCE_VENDOR_TYPE_LABELS: Record<ComplianceVendorType, string> = {
  dnc_scrub: "DNC scrub",
  litigator_scrub: "Litigator scrub",
  consent_certificate: "Consent certificate",
  phone_validation: "Phone validation",
};

export type ComplianceVendor = {
  id: string;
  name: string;
  vendor_type: ComplianceVendorType;
  endpoint: string;
  is_enabled: boolean;
  priority: number;
  cost_per_lookup_cents: number;
  credentials_present: boolean;
  last_success_at: string | null;
  calls_24h: number;
  failures_24h: number;
  failure_rate_24h: number;
};

export const DNC_BLOCK_MESSAGE =
  "Dialing is blocked platform-wide because no enabled DNC scrub vendor is available. Calling without a DNC check can expose the platform to $500-$1,500 penalties per call.";
