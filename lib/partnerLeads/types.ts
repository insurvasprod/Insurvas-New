export type PartnerLeadFilters = {
  dateFrom?: string;
  dateTo?: string;
  closerId?: string;
  product?: string;
  stageId?: string;
  outcome?: string;
};

export type PartnerPipelineStage = {
  id: string;
  pipelineId: string;
  pipelineName: string;
  name: string;
  position: number;
  stageType: string;
  color: string;
  isArchived: boolean;
  leadCount: number;
};

export type PartnerLeadFacets = {
  closers: Array<{ id: string; name: string }>;
  products: string[];
  outcomes: Array<{ key: string; label: string }>;
};

export type PartnerLeadRow = {
  id: string;
  workItemId: string;
  customer: string;
  submittedAt: string;
  updatedAt: string;
  product: string;
  stageId: string;
  stageName: string;
  stageType: string;
  disposition: string | null;
  outcome: string | null;
  // No outcome note (LA-1 audit): the composed disposition note is the agency's internal record and
  // never reaches a partner. Partners see the coded outcome and the stage only.
  submittedBy: { id: string | null; name: string };
  status: string;
  /** New / Claimed / Verification / Converted / closed: the counters' vocabulary (lanes.ts). The board's columns are the stages. */
  lane?: import("./lanes").PartnerLane;
};

export type PartnerLeadDetail = PartnerLeadRow & {
  values: Record<string, unknown>;
  timeline: Array<{ type: string; label: string; at: string; detail?: string | null }>;
};
