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
  /** One line on what the stage means. Null until set, and absent before migration 20260924130000. */
  description?: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

export type Pipeline = {
  id: string;
  tenant_id: string;
  name: string;
  /**
   * The partner type whose leads default into this pipeline, or null for a pipeline with none
   * (migration 20260924240100). A null pipeline is never a partner default; as the default with no
   * partner type it receives the leads that arrive with no partner (imports, vendor posts).
   */
  partner_type: PartnerPipelineType | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  stages: PipelineStage[];
};

/** Leads counted where they sit today, by pipeline and by stage id. */
export type PipelineCounts = { pipelines: Record<string, number>; stages: Record<string, number> };

/** A disposition from the tenant's outcome catalogue, as the mapping table lists it. */
export type DispositionCatalogEntry = { key: string; label: string; isActive: boolean };

export type DispositionMapping = { id: string; stage_id: string; disposition_key: string };

/**
 * Outcomes recorded in the window whose disposition has no stage mapped today — each one a lead
 * the outcome left where it was.
 */
export type UnmappedOutcomes = { outcomes: number };
