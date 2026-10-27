/**
 * Which stage an outcome sends a lead to — the TypeScript twin of resolve_disposition_stage
 * (20261027100000), so the screens that say where a lead will go say what the database will do:
 *
 *   1. the lead's own pipeline's row (pipeline_disposition_stages): its stage, or — a row with no stage
 *      — nothing: the lead stays where it is;
 *   2. the agency-wide stage (stage_dispositions), when it is in the lead's pipeline;
 *   3. a stage in the lead's pipeline named like the outcome (the same-name default, owner 2026-10-27);
 *   4. the agency-wide stage anywhere;
 *   5. nothing — the lead stays where it is.
 *
 * Steps 2 and 3 need to know a stage's pipeline and the outcome's name: callers that pass neither get
 * steps 1, 4 and 5, which is what the lookup did before 20261027100000. Archived stages never count.
 * Plain module, no server-only: node --test pins it.
 */

export type OutcomeStageRow = { disposition_key: string; stage_id: string };
/** stage_id null: in this pipeline, the outcome keeps the lead where it is (20261027100000). */
export type PipelineOutcomeRow = { disposition_key: string; pipeline_id: string; stage_id: string | null };

export type ResolveOptions = {
  /** The pipeline a stage belongs to (step 2). */
  pipelineOfStage?: (stageId: string) => string | undefined;
  /** The lead's pipeline's live stage named like the outcome, if any (step 3). */
  stageNamedLike?: (dispositionKey: string) => string | undefined;
  /** Every outcome to resolve; by default the keys that have a row somewhere. */
  keys?: Iterable<string>;
};

/**
 * Every outcome's stage for a lead in `pipelineId` (null: a lead with no pipeline, or a screen that is
 * not about one lead — then only the agency-wide rows apply). `isLive` answers whether a stage may
 * still be landed on. An outcome that keeps the lead where it is has no entry.
 */
export function resolveOutcomeStages(
  agencyWide: readonly OutcomeStageRow[],
  ownRows: readonly PipelineOutcomeRow[],
  pipelineId: string | null,
  isLive: (stageId: string) => boolean = () => true,
  options: ResolveOptions = {},
): Map<string, string> {
  const agency = new Map<string, string>();
  for (const row of agencyWide) if (isLive(row.stage_id) && !agency.has(row.disposition_key)) agency.set(row.disposition_key, row.stage_id);
  if (!pipelineId) return agency;
  const own = new Map<string, string | null>();
  for (const row of ownRows) if (row.pipeline_id === pipelineId && (row.stage_id === null || isLive(row.stage_id))) own.set(row.disposition_key, row.stage_id);
  const keys = new Set<string>([...agency.keys(), ...own.keys(), ...(options.keys ?? [])]);
  const resolved = new Map<string, string>();
  for (const key of keys) {
    if (own.has(key)) {
      const stageId = own.get(key);
      if (stageId) resolved.set(key, stageId);
      continue;
    }
    const agencyStage = agency.get(key);
    if (agencyStage && options.pipelineOfStage?.(agencyStage) === pipelineId) { resolved.set(key, agencyStage); continue; }
    const named = options.stageNamedLike?.(key);
    if (named && isLive(named)) { resolved.set(key, named); continue; }
    if (agencyStage) resolved.set(key, agencyStage);
  }
  return resolved;
}

/**
 * The outcomes that land on each stage, for the board's "move = disposition" picker. A board shows one
 * pipeline and its leads are in it, so on a stage of pipeline P: P's own rows, plus the agency-wide
 * rows P has not replaced with one of its own (a row with no stage replaces one too: it keeps the lead put).
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
  for (const row of ownRows) if (row.stage_id) add(row.stage_id, row.disposition_key);
  return byStage;
}

/** The same-name default's comparison: case and outer spaces do not count, as in the database. */
export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
