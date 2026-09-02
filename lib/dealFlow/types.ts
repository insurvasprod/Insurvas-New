export const DEAL_FLOW_STATUSES = ["partial", "completed", "dropped"] as const;
export type DealFlowStatus = (typeof DEAL_FLOW_STATUSES)[number];

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
  manual_entry: boolean;
  created_at: string;
  updated_at: string;
};

export type DealFlowFilterOptions = {
  partners: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; name: string; role: string }>;
};

export type DealFlowSummary = {
  partner_id: string | null;
  partner_name: string;
  total: number;
  completed: number;
  partial: number;
  dropped: number;
};
