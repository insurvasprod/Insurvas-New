export type PartnerQualityMetric = "sent" | "claimed" | "worked" | "submitted" | "disqualified" | "tcpa" | "dnc" | "invalid" | "duplicate" | "disposition";

export type PartnerQualityScreening = { tcpa: number; dnc: number; invalid: number };

export type PartnerQualityPeriod = {
  sent: number;
  claimed: number;
  worked: number;
  submitted: number;
  conversion_rate: number | null;
  disqualification_rate: number | null;
  duplicate_rate: number | null;
  screening: PartnerQualityScreening;
};

export type PartnerQualityRow = PartnerQualityPeriod & {
  partner_id: string;
  partner_name: string;
  disqualified: number;
  duplicates: number;
  previous: PartnerQualityPeriod;
};

export type PartnerQualityDisposition = { key: string; count: number };
export type PartnerQualityDispositionBreakdown = { partner_id: string; dispositions: PartnerQualityDisposition[] };

export type PartnerQualitySummary = Omit<PartnerQualityPeriod, "conversion_rate" | "disqualification_rate" | "duplicate_rate"> & {
  disqualified: number;
  duplicates: number;
};

export type PartnerQualityReport = {
  from: string;
  to: string;
  previous_from: string;
  previous_to: string;
  rows: PartnerQualityRow[];
  dispositions: PartnerQualityDispositionBreakdown[];
  summary: PartnerQualitySummary;
  previous_summary: PartnerQualitySummary;
  readOnly: boolean;
};

export type PartnerQualityLead = {
  lead_id: string;
  date: string;
  full_name: string;
  phone: string | null;
  screening_outcome: string | null;
  disposition: string | null;
  claimed: boolean;
  worked: boolean;
  submitted: boolean;
  duplicate: boolean;
};

export type PartnerQualityLeadResult = {
  metric: PartnerQualityMetric;
  partner_id: string;
  total: number;
  rows: PartnerQualityLead[];
};

export const PARTNER_QUALITY_METRICS: PartnerQualityMetric[] = ["sent", "claimed", "worked", "submitted", "disqualified", "tcpa", "dnc", "invalid", "duplicate", "disposition"];
