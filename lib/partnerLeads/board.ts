// Pure: the partner board's columns — the stages of the partner's own pipeline (LA-1.17 "Kanban board
// by stage, using their pipeline (LA-1.9)").
//
// A partner's pipeline is the default pipeline for its partner_type (Publisher transfers, Marketing
// leads, Affiliate referrals). Every unarchived stage of it is a column, in its configured order,
// even when empty, so a new partner sees the road its leads will take. A lead can also sit in another
// pipeline (an outcome recorded before 20261022200000 moved it to the agency-wide stage); those
// pipelines follow, with only the stages that hold the partner's leads, so no lead drops off the
// board and the partner never browses another pipeline's empty configuration.
//
// Counts are the read model's per-stage counts (partner_lead_pipeline_page `stages`), which carry the
// page's partner, closer and filter scope — not the loaded page's rows.
import type { PartnerPipelineStage } from "./types.ts";

export type BoardPipeline = { id: string; name: string };
export type BoardStage = { id: string; pipeline_id: string; name: string; position: number; stage_type: string; color: string; is_archived: boolean };
/** One entry of the read model's `stages`: a stage id (or a bare stage key), its pipeline, a count. */
export type BoardCount = { stageId: string; pipelineId: string; stageName: string; leadCount: number };

function titleCase(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export function partnerBoardStages(input: {
  defaultPipelineId: string | null;
  pipelines: BoardPipeline[];
  stages: BoardStage[];
  counts: BoardCount[];
}): PartnerPipelineStage[] {
  const pipelines = new Map(input.pipelines.map((pipeline) => [pipeline.id, pipeline]));
  const counts = new Map<string, number>();
  for (const entry of input.counts) counts.set(entry.stageId, (counts.get(entry.stageId) ?? 0) + entry.leadCount);
  const byPipeline = new Map<string, BoardStage[]>();
  for (const stage of input.stages) {
    if (!pipelines.has(stage.pipeline_id)) continue; // only pipelines the tenant-scoped read returned
    byPipeline.set(stage.pipeline_id, [...(byPipeline.get(stage.pipeline_id) ?? []), stage]);
  }
  const pipelineLeads = (id: string) => (byPipeline.get(id) ?? []).reduce((sum, stage) => sum + (counts.get(stage.id) ?? 0), 0);
  const order = [...byPipeline.keys()]
    .filter((id) => id === input.defaultPipelineId || pipelineLeads(id) > 0)
    .sort((a, b) => Number(b === input.defaultPipelineId) - Number(a === input.defaultPipelineId) || pipelineLeads(b) - pipelineLeads(a) || (pipelines.get(a)?.name ?? "").localeCompare(pipelines.get(b)?.name ?? ""));
  const placed = new Set<string>();
  const columns: PartnerPipelineStage[] = [];
  for (const pipelineId of order) {
    const own = pipelineId === input.defaultPipelineId;
    const stages = [...(byPipeline.get(pipelineId) ?? [])].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    for (const stage of stages) {
      const leadCount = counts.get(stage.id) ?? 0;
      // Archived stages, and another pipeline's empty stages, are not columns. A lead on one still is.
      if (leadCount === 0 && (stage.is_archived || !own)) continue;
      placed.add(stage.id);
      columns.push({ id: stage.id, pipelineId, pipelineName: pipelines.get(pipelineId)?.name ?? "Pipeline", name: stage.name, position: stage.position, stageType: stage.stage_type, color: stage.color, isArchived: stage.is_archived, leadCount });
    }
  }
  // A queue item with no stage row (a bare stage key) still gets a column rather than vanishing.
  for (const entry of input.counts) {
    if (placed.has(entry.stageId) || entry.leadCount === 0) continue;
    placed.add(entry.stageId);
    columns.push({ id: entry.stageId, pipelineId: entry.pipelineId, pipelineName: pipelines.get(entry.pipelineId)?.name ?? "Other", name: titleCase(entry.stageName || "New"), position: Number.MAX_SAFE_INTEGER, stageType: "open", color: "#64748b", isArchived: false, leadCount: counts.get(entry.stageId) ?? entry.leadCount });
  }
  return columns;
}
