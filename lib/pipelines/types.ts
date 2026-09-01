export const PARTNER_PIPELINE_TYPES = ["publisher", "marketing", "affiliate"] as const;
export type PartnerPipelineType = (typeof PARTNER_PIPELINE_TYPES)[number];
export type PipelineStageType = "open" | "won" | "lost";

export type PipelineStage = {
  id: string;
  pipeline_id: string;
  name: string;
  position: number;
  stage_type: PipelineStageType;
  color: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

export type Pipeline = {
  id: string;
  tenant_id: string;
  name: string;
  partner_type: PartnerPipelineType;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  stages: PipelineStage[];
};
