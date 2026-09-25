import type { NextActionKind, NextActionSetting } from "./nextAction";

export const DISPOSITION_KEY_PATTERN = /^[a-z][a-z0-9_]{1,79}$/;
export const DO_NOT_CALL_DISPOSITION_KEY = "do_not_call";

export const DISPOSITION_NODE_TYPES = ["choice", "multi_select", "free_text"] as const;
export type DispositionNodeType = (typeof DISPOSITION_NODE_TYPES)[number];
export type DispositionCloseStatus = "completed" | "dropped";

export type Disposition = {
  id: string;
  tenant_id: string;
  disposition_key: string;
  label: string;
  counts_as_work_completed: boolean;
  closes_as: DispositionCloseStatus;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  /**
   * Recorded on the dialer, this outcome closes the lead (true) or returns it to the cadence (false).
   * Null only before migration 20260924140000 is applied.
   */
  ends_call?: boolean | null;
  /** What the dialer does after the outcome (20260924240200). Absent before that is applied. */
  next_action?: NextActionKind | null;
  /** The retry delay or rest period, in minutes; set only for retry and rest. */
  next_action_minutes?: number | null;
};

/** The settings screen's view of one outcome: the row, plus what the product does with it. */
export type DispositionSettingsRow = Disposition & {
  /** do_not_call and callback_scheduled: the dialer handles them in their own branch. */
  ends_call_fixed: boolean;
  /**
   * What the dialer does next: the stored setting, or — before 20260924240200 — what it does today,
   * derived from the key and ends_call. Null when neither is known.
   */
  next: NextActionSetting | null;
  /** The stage this outcome moves the lead to (stage_dispositions), if it is mapped. */
  mapped_stage: { id: string; name: string; stage_type: string; pipeline_id: string; pipeline_name: string } | null;
};

export type DispositionOption = {
  id: string;
  node_id: string;
  option_key: string;
  label: string;
  next_node_id: string | null;
  disposition_key: string | null;
  note_template: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type DispositionNode = {
  id: string;
  flow_id: string;
  node_key: string;
  label: string;
  prompt: string;
  node_type: DispositionNodeType;
  field_key: string | null;
  note_template: string | null;
  next_node_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  options: DispositionOption[];
};

export type DispositionFlow = {
  id: string;
  tenant_id: string;
  stage_id: string;
  stage_name: string;
  name: string;
  is_active: boolean;
  root_node_id: string | null;
  created_at: string;
  updated_at: string;
  nodes: DispositionNode[];
};

export type DispositionWalkStep = {
  id: string;
  sequence: number;
  node_id: string;
  node_label: string;
  answer: unknown;
  option_key: string | null;
  note_fragment: string;
};

export type DispositionWizard = {
  walk: { id: string; flow_id: string; status: "open" | "completed"; current_node_id: string | null; final_disposition_key: string | null; composed_note: string | null };
  flow: DispositionFlow;
  currentNode: DispositionNode | null;
  steps: DispositionWalkStep[];
  dispositions: Disposition[];
  lead: { id: string; values: Record<string, unknown> };
  workItem: { id: string; productLine: string };
  customerTimezone: string;
  customerName: string;
  assignees: Array<{ id: string; name: string; role: string }>;
};
