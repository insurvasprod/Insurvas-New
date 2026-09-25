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

export type PartnerQualityMember = PartnerQualityPeriod & {
  id: string;
  user_id: string;
  partner_id: string;
  name: string;
  email: string;
  role: "partner_admin" | "partner_user";
  status: "active" | "revoked";
  invited_at: string;
  accepted_at: string | null;
  deactivated_at: string | null;
  partner_admin_user_id: string | null;
  partner_admin_name: string | null;
  disqualified: number;
  duplicates: number;
  previous: PartnerQualityPeriod;
};

export type PartnerQualityTeamGroup = {
  partner_id: string;
  partner_name: string;
  admins: PartnerQualityMember[];
  users: PartnerQualityMember[];
  unassigned: PartnerQualityMember[];
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
  team: PartnerQualityTeamGroup[];
  readOnly: boolean;
};

export type PartnerQualityLead = {
  lead_id: string;
  date: string;
  full_name: string;
  phone: string | null;
  product?: string | null;
  state?: string | null;
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
