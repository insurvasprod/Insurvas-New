/**
 * Which stage an outcome sends a lead to — the TypeScript twin of resolve_disposition_stage
 * (20261022200000), so the screens that say where a lead will go say what the database will do:
 *
 *   1. the lead's own pipeline's stage for the outcome (pipeline_disposition_stages), else
 *   2. the agency-wide stage (stage_dispositions, one per outcome, any pipeline), else
 *   3. nothing — the lead stays where it is.
 *
 * Archived stages never count (both the database and this skip them). Plain module, no server-only:
 * node --test pins it.
 */

export type OutcomeStageRow = { disposition_key: string; stage_id: string };
export type PipelineOutcomeRow = OutcomeStageRow & { pipeline_id: string };

/**
 * Every outcome's stage for a lead in `pipelineId` (null: a lead with no pipeline, or a screen that is
 * not about one lead — then only the agency-wide rows apply). `isLive` answers whether a stage may
 * still be landed on.
 */
export function resolveOutcomeStages(
  agencyWide: readonly OutcomeStageRow[],
  ownRows: readonly PipelineOutcomeRow[],
  pipelineId: string | null,
  isLive: (stageId: string) => boolean = () => true,
): Map<string, string> {
  const resolved = new Map<string, string>();
  for (const row of agencyWide) if (isLive(row.stage_id) && !resolved.has(row.disposition_key)) resolved.set(row.disposition_key, row.stage_id);
  if (pipelineId) for (const row of ownRows) if (row.pipeline_id === pipelineId && isLive(row.stage_id)) resolved.set(row.disposition_key, row.stage_id);
  return resolved;
}

/**
 * The outcomes that land on each stage, for the board's "move = disposition" picker. A board shows one
 * pipeline and its leads are in it, so on a stage of pipeline P: P's own rows, plus the agency-wide
 * rows P has not replaced with one of its own.
 */
export function outcomesByStage(
  agencyWide: readonly OutcomeStageRow[],
  ownRows: readonly PipelineOutcomeRow[],
  pipelineOfStage: (stageId: string) => string | undefined,
): Map<string, string[]> {
  const replaced = new Set(ownRows.map((row) => `${row.pipeline_id}:${row.disposition_key}`));
  const byStage = new Map<string, string[]>();
  const add = (stageId: string, key: string) => {
    const keys = byStage.get(stageId) ?? [];
    if (!keys.includes(key)) keys.push(key);
    byStage.set(stageId, keys);
  };
  for (const row of agencyWide) {
    const pipelineId = pipelineOfStage(row.stage_id);
    if (pipelineId && replaced.has(`${pipelineId}:${row.disposition_key}`)) continue;
    add(row.stage_id, row.disposition_key);
  }
  for (const row of ownRows) add(row.stage_id, row.disposition_key);
  return byStage;
}
