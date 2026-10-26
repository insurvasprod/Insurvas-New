// The partner home's lead map (redesign 2026-10-25): where this partner's leads have got to, drawn
// as a flow. Plain module, client-safe, no reads: it reshapes the stage counts the pipeline read
// model already returns (PartnerPipelineStage.leadCount, partner-scoped on the server).
//
// The counts are where leads ARE now, not a cohort's history, so the flow is "reached at least this
// stage": a stage's figure is its own leads plus every lead on a later open or won stage. Lost leads
// left the flow somewhere we do not record, so they are one drop right after "Sent", never pinned to
// a stage. The "biggest leak" a partner can act on is the stage holding the most of their leads.
import type { PartnerPipelineStage } from "./types.ts";

export type PartnerFunnelStep = { key: string; label: string; count: number; stageId: string | null; won: boolean };
export type PartnerFunnel = {
  pipelineName: string | null;
  /** True when the partner's leads sit in more than one pipeline and only the busiest is drawn. */
  partial: boolean;
  steps: PartnerFunnelStep[];
  lost: number;
  /** The open stage with the most leads waiting on it, or null when nothing is waiting. */
  stuck: { stageId: string; label: string; count: number } | null;
};

export function partnerFunnel(stages: PartnerPipelineStage[]): PartnerFunnel {
  const live = stages.filter((stage) => !stage.isArchived || stage.leadCount > 0);
  const byPipeline = new Map<string, PartnerPipelineStage[]>();
  for (const stage of live) byPipeline.set(stage.pipelineId, [...(byPipeline.get(stage.pipelineId) ?? []), stage]);
  const total = (list: PartnerPipelineStage[]) => list.reduce((sum, stage) => sum + Math.max(0, stage.leadCount), 0);
  const busiest = [...byPipeline.values()].sort((a, b) => total(b) - total(a))[0] ?? [];
  if (busiest.length === 0) return { pipelineName: null, partial: false, steps: [], lost: 0, stuck: null };

  const ordered = [...busiest].sort((a, b) => a.position - b.position);
  const lostStages = ordered.filter((stage) => stage.stageType === "lost");
  const flow = ordered.filter((stage) => stage.stageType !== "lost");
  const lost = total(lostStages);
  const sent = total(ordered);

  const steps: PartnerFunnelStep[] = [{ key: "sent", label: "Sent", count: sent, stageId: null, won: false }];
  flow.forEach((stage, index) => {
    steps.push({ key: stage.id, label: stage.name, count: total(flow.slice(index)), stageId: stage.id, won: stage.stageType === "won" });
  });

  const waiting = flow.filter((stage) => stage.stageType !== "won" && stage.leadCount > 0).sort((a, b) => b.leadCount - a.leadCount || a.position - b.position)[0];
  return {
    pipelineName: ordered[0].pipelineName,
    partial: byPipeline.size > 1,
    steps,
    lost,
    stuck: waiting ? { stageId: waiting.id, label: waiting.name, count: waiting.leadCount } : null,
  };
}
