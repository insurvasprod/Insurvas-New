/**
 * What an outcome does, read from its configuration rather than its key.
 *
 * Plain module (no `server-only`): the inbound route decides the verification gate with it and the
 * outcome wizard describes each option with it. Nothing here names a disposition key — the wizard
 * must not branch on one (lib/dispositions/oneVocabulary.test.mjs), and a tenant can rename, add or
 * archive outcomes in Settings › Dispositions.
 */

export type MappedStage = { id: string; name: string; stage_type: string; pipeline_id: string; pipeline_name: string };
export type OutcomeConfig = { label: string; closes_as: string; counts_as_work_completed: boolean };

/**
 * An application outcome: one that records a sale or a submitted application. Those are the
 * outcomes that must not be recorded until every required verification field is confirmed.
 *
 *   - its stage is a won stage (the seeded "Application submitted" → Submitted), or
 *   - it closes the transfer as completed AND counts as work completed (the seeded "Sent to
 *     underwriting" → Pending Approval, an open stage — still an application).
 *
 * A dropped close is never an application, whatever the flags say.
 */
export function isApplicationOutcome(outcome: OutcomeConfig, stage: Pick<MappedStage, "stage_type"> | null): boolean {
  if (outcome.closes_as === "dropped") return false;
  return stage?.stage_type === "won" || outcome.counts_as_work_completed === true;
}

/**
 * The option's one-line description, from where it lands and how it closes:
 *   "Moves the lead to Submitted" / "Keeps the lead in Needs Callback" /
 *   "Closes the transfer · moves to Incomplete Transfer", with the pipeline named when the stage is
 *   in a different pipeline from the one the call is in.
 */
export function outcomeDescription(outcome: OutcomeConfig, stage: MappedStage, current: { stageId: string | null; pipelineId: string | null }): string {
  const where = current.pipelineId && stage.pipeline_id !== current.pipelineId ? `${stage.name} in ${stage.pipeline_name}` : stage.name;
  if (outcome.closes_as === "dropped") return `Closes the transfer · moves to ${where}`;
  if (current.stageId && stage.id === current.stageId) return `Keeps the lead in ${where}`;
  return `Moves the lead to ${where}`;
}
