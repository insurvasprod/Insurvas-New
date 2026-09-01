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
};
