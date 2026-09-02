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
  outcomeNote: string | null;
  submittedBy: { id: string | null; name: string };
  status: string;
};

export type PartnerLeadDetail = PartnerLeadRow & {
  values: Record<string, unknown>;
  timeline: Array<{ type: string; label: string; at: string; detail?: string | null }>;
};
