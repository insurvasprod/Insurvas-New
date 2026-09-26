// Shared with the client component: plain values and types only, never server code.

export const DEAL_FLOW_STATUSES = ["partial", "completed", "dropped"] as const;
export type DealFlowStatus = (typeof DEAL_FLOW_STATUSES)[number];

/**
 * The Status column's vocabulary: the lead's current pipeline stage, grouped by its stage type.
 * A row whose stage cannot be resolved counts as in progress, in the filter and in the KPIs alike.
 */
export const DEAL_FLOW_STAGE_TYPES = ["open", "won", "lost"] as const;
export type DealFlowStageType = (typeof DEAL_FLOW_STAGE_TYPES)[number];
export const STAGE_TYPE_LABEL: Record<DealFlowStageType, string> = { open: "In progress", won: "Won", lost: "Lost" };

/** The board pages the production table 25 at a time. */
export const DEAL_FLOW_PAGE_SIZE = 25;

/** Shown wherever a write or a field needs migration 20260924320000 and it is not applied yet. */
export const DEAL_FLOW_SCHEMA_PENDING = "This setting needs a database update that has not been applied yet.";

/** The copyable short ID a deal is referred to by. There are no lead numbers; this is the id's head. */
export function shortLeadId(leadId: string) {
  return leadId.replace(/-/g, "").slice(0, 8);
}

export type DealFlowSource = "inbound" | "outbound" | "manual";

export type DealFlowHistoryItem = { at: string; disposition: string | null; label: string | null; by_name: string | null };

export type DealFlowRow = {
  id: string;
  lead_id: string;
  partner_id: string | null;
  partner_name: string;
  submission_id: string | null;
  product_line: string;
  insured_name: string | null;
  phone: string | null;
  initial_quote: string | null;
  tracking_id: string | null;
  local_date: string;
  status: DealFlowStatus;
  call_result: string | null;
  notes: string | null;
  carrier: string | null;
  product_type: string | null;
  monthly_premium_cents: number | null;
  face_amount_cents: number | null;
  draft_date: string | null;
  worked_by: string | null;
  agent_name: string;
  /** LA-1.13-2: the buffer assistant who took the call first (20260925709850). Null when none did, or before that migration. */
  buffer_agent: string | null;
  buffer_agent_name: string | null;
  manual_entry: boolean;
  created_at: string;
  updated_at: string;
  // Read by migration 20260924320000; null (or empty) before it where the fallback cannot find them.
  campaign_id: string | null;
  campaign_name: string | null;
  vendor_name: string | null;
  source: DealFlowSource | null;
  disposition_at: string | null;
  disposition_by: string | null;
  disposition_by_name: string | null;
  call_result_label: string | null;
  customer_state: string | null;
  stage_name: string | null;
  stage_type: DealFlowStageType | null;
  /** The lead's stage and the deal's stored stage disagree (the dialer moves only the lead). */
  stage_drift: boolean;
  issued_at: string | null;
  history: DealFlowHistoryItem[];
};

export type DealFlowFilterOptions = {
  partners: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; name: string; role: string }>;
};

export type DealFlowSummary = {
  partner_id: string | null;
  partner_name: string;
  total: number;
  won: number;
  in_progress: number;
  lost: number;
  completed: number;
  partial: number;
  dropped: number;
};

/** Over the whole filtered set, never the page on screen. */
export type DealFlowKpis = {
  deals_worked: number;
  won: number;
  won_annualised_cents: number;
  won_unpriced: number;
  in_progress: number;
  oldest_in_progress_days: number | null;
  lost: number;
  stage_drift: number;
};

export type DealFlowFocus = { leadId: string; position: number | null; inFilter: boolean; row: DealFlowRow | null };

export type DealFlowReport = {
  rows: DealFlowRow[];
  total: number;
  page: number;
  pageSize: number;
  kpis: DealFlowKpis;
  summary: DealFlowSummary[];
  options: DealFlowFilterOptions;
  focus: DealFlowFocus | null;
  /** True while migration 20260924320000 is not applied: the page shows what the old report allows. */
  schemaPending: boolean;
  /** The fallback reads at most this many deals; set when the range held more. */
  capped: boolean;
};
