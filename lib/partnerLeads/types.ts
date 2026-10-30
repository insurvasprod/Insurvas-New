import type { AgeThresholds } from "./view";
import type { PartnerTerm } from "../partners/payout";

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

/**
 * One read of the partner Pipeline page, as `listPartnerLeads` returns it and the page consumes it.
 * Declared once so the two cannot drift: the page used to type a narrower shape and silently ignore
 * `oldestOpenAt` — the one figure that answers "is anything stuck?" — because it never declared it.
 */
export type PartnerPipelinePayload = {
  rows: PartnerLeadRow[];
  stages: PartnerPipelineStage[];
  facets: PartnerLeadFacets;
  counters: { submittedToday: number; claimed: number; converted: number; stillOpen: number };
  /** When the longest-waiting open submission was queued. Null while any filter narrows the page,
   *  because an "oldest" from outside that filter would sit under a number it does not describe. */
  oldestOpenAt: string | null;
  /** The partner's own payout terms in force today, or null when none can be read. */
  terms: PartnerTerm | null;
  /** The tenant's SLA ladder, in the two thresholds this page tones a submission's age by. */
  ageThresholds: AgeThresholds;
  laneCounts: import("./lanes").PartnerLaneCounts | null;
  total: number;
  nextOffset: number | null;
  pageSize: number;
  realtimeTopic: string;
  generatedAt: string;
};
