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
  /** publisher | marketing | affiliate — joined from partners after the report RPC. */
  partner_type?: string | null;
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

/** One lead row from partner_quality_evidence (the RPC every figure on these pages is counted from). */
export type PartnerQualityEvidence = {
  lead_id: string;
  partner_id: string;
  lead_date: string;
  full_name: string;
  phone: string | null;
  screening_outcome: string | null;
  screening_result_outcome: string | null;
  claimed: boolean;
  worked: boolean;
  submitted: boolean;
  duplicate: boolean;
  disposition: string | null;
};

export type PartnerQualityPeriodMetrics = {
  sent: number;
  claimed: number;
  worked: number;
  submitted: number;
  disqualified: number;
  duplicates: number;
  screening: PartnerQualityScreening;
  conversion_rate: number | null;
  disqualification_rate: number | null;
  duplicate_rate: number | null;
  screening_pass_rate: number | null;
};

export type PartnerQualityDailyRow = { date: string; sent: number; claimed: number; worked: number; submitted: number; flagged: number; duplicates: number };

export type PartnerQualityDetailLead = {
  lead_id: string;
  date: string;
  received_at: string | null;
  full_name: string;
  phone: string | null;
  state: string | null;
  product: string | null;
  screening: string;
  duplicate: boolean;
  claimed: boolean;
  worked: boolean;
  submitted: boolean;
  disposition: string | null;
  queue_status: string | null;
  agent_id: string | null;
  agent_name: string | null;
  /** The partner admin/user who submitted it, when a partner account created the lead. */
  submitted_by: string | null;
};

export type PartnerQualityAgentRow = {
  user_id: string;
  name: string;
  leads: number;
  worked: number;
  submitted: number;
  conversion_rate: number | null;
};

export type PartnerQualityDetail = {
  partner: { id: string; name: string; partner_type: string | null; status: string | null };
  from: string;
  to: string;
  previous_from: string;
  previous_to: string;
  current: PartnerQualityPeriodMetrics;
  previous: PartnerQualityPeriodMetrics;
  leads: PartnerQualityDetailLead[];
  /** True when the partner sent more leads than the page lists (figures still count every lead). */
  leads_truncated: boolean;
  dispositions: PartnerQualityDisposition[];
  disposition_labels: Record<string, string>;
  daily: PartnerQualityDailyRow[];
  team: PartnerQualityMember[];
  /** Sent in the period by no partner account (API posts, agency imports). */
  unattributed: PartnerQualityPeriodMetrics;
  agents: PartnerQualityAgentRow[];
};

export const PARTNER_QUALITY_METRICS: PartnerQualityMetric[] = ["sent", "claimed", "worked", "submitted", "disqualified", "tcpa", "dnc", "invalid", "duplicate", "disposition"];
