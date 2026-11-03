import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { STAGE_STATE_LABELS, type FileStage, type StageState } from "@/lib/ingestion/fileStages";

/**
 * Book of business › Files (round 2, owner 2026-11-02): a file's eight stages — Uploaded, Layout, Read,
 * Status words, Linked, History, Pipeline, Commissions — as a strip. The compact strip sits in a list row;
 * the large one heads a file's page, each stage with its mark and name. Colour is never the only sign:
 * every segment names its stage and state for a screen reader and in its tooltip.
 */
const BAR: Record<StageState, string> = {
  done: "bg-[var(--primary)]",
  needs: "bg-[var(--warning)]",
  failed: "bg-[var(--error)]",
  skipped: "bg-[var(--muted)] opacity-50",
  pending: "bg-[var(--border-strong)]",
};

const MARK: Record<StageState, string> = {
  done: "bg-[var(--primary)] text-[var(--on-primary)]",
  needs: "bg-[var(--warning)] text-[var(--ink)]",
  failed: "bg-[var(--error)] text-[var(--on-primary)]",
  skipped: "border border-[var(--border-strong)] text-muted-foreground",
  pending: "border border-[var(--border-strong)] text-muted-foreground",
};

const said = (stage: FileStage) => `${stage.name}: ${STAGE_STATE_LABELS[stage.state]}${stage.state === "needs" && stage.count ? ` (${stage.count})` : ""}. ${stage.note}`;

/** Eight short bars, one per stage, for a row of the Files list. */
export function StageStrip({ stages, className }: { stages: FileStage[]; className?: string }) {
  return (
    <span role="img" aria-label={stages.map(said).join(" ")} className={cn("inline-flex items-center gap-[3px]", className)}>
      {stages.map((stage) => <span key={stage.name} title={said(stage)} className={cn("h-1.5 w-[18px] rounded-full", BAR[stage.state])} />)}
    </span>
  );
}

/** The strip at the top of a file's page: each stage's mark, its name and its bar. */
export function StageStripLarge({ stages, focus }: { stages: FileStage[]; focus?: string | null }) {
  return (
    <ol className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4 xl:grid-cols-8">
      {stages.map((stage, index) => {
        const glyph = stage.state === "done" ? <Check aria-hidden="true" className="size-3" /> : stage.state === "needs" ? (stage.count ?? "!") : stage.state === "failed" ? "!" : stage.state === "skipped" ? "–" : index + 1;
        const selected = focus === stage.name;
        return (
          <li key={stage.name} title={stage.note} className={cn("flex min-w-0 flex-col gap-1.5 rounded-md p-2", selected && "bg-[var(--surface-alt)] ring-1 ring-[var(--border-strong)]")}>
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden="true" className={cn("grid size-[22px] shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums", MARK[stage.state])}>{glyph}</span>
              <span className={cn("truncate text-xs font-semibold", stage.state === "pending" ? "text-muted-foreground" : "text-foreground")}>{stage.name}</span>
              <span className="sr-only">{STAGE_STATE_LABELS[stage.state]}{stage.state === "needs" && stage.count ? `, ${stage.count}` : ""}. {stage.note}</span>
            </span>
            <span aria-hidden="true" className={cn("h-[3px] rounded-full", BAR[stage.state])} />
          </li>
        );
      })}
    </ol>
  );
}

/** The legend under the Files list. */
export function StageLegend() {
  const states: StageState[] = ["done", "needs", "failed", "skipped", "pending"];
  return (
    <p className="m-0 flex flex-wrap gap-4 text-xs text-muted-foreground">
      {states.map((state) => (
        <span key={state} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={cn("h-1.5 w-3.5 rounded-full", BAR[state])} />{STAGE_STATE_LABELS[state]}</span>
      ))}
    </p>
  );
}
