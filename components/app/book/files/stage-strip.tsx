import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { STAGE_STATE_LABELS, shownStages, type FileStage, type StageState } from "@/lib/ingestion/fileStages";

/**
 * Book of business › Files (round 2, owner 2026-11-02): a file's stages — Uploaded, Layout, Read, Status words,
 * Linked, History, Pipeline, Commissions — as a strip. Round 4 (owner 2026-11-02): only the stages this kind of
 * file goes through (`shownStages`: no Commissions on a policy file; no Status words, History or Pipeline on a
 * commission file), and on the file's page one slim track split into those stages, a name under each and a
 * count only where a person is needed. Colour is never the only sign: every segment names its stage and state
 * for a screen reader and in its tooltip.
 *
 * Both fill up in order when they appear (owner 2026-11-02: "a nice animation of stages filling up"): each
 * bar's colour grows from its left over a grey track. Keyed on the state, so a stage that moves on (a new
 * upload reading through) plays again and the rest stay still. Once, short, and off under reduced motion
 * (UI-CONSISTENCY §17).
 */
/** Each stage starts this long after the one before it. */
const STEP_MS = 70;
const fill = "motion-safe:animate-[m-stage-fill_.36s_cubic-bezier(.2,.8,.2,1)_both] origin-left";
const BAR: Record<StageState, string> = {
  done: "bg-[var(--primary)]",
  needs: "bg-[var(--warning)]",
  failed: "bg-[var(--error)]",
  skipped: "bg-[var(--muted)] opacity-50",
  pending: "bg-[var(--border-strong)]",
};

const NAME: Record<StageState, string> = {
  done: "text-foreground",
  needs: "text-[var(--warning-ink)]",
  failed: "text-[var(--error-ink)]",
  skipped: "text-muted-foreground",
  pending: "text-muted-foreground",
};

const said = (stage: FileStage) => `${stage.name}: ${STAGE_STATE_LABELS[stage.state]}${stage.state === "needs" && stage.count ? ` (${stage.count})` : ""}. ${stage.note}`;

/**
 * One short bar per stage the file goes through, for a row of the Files list. While the file is being read
 * (`reading`), the stage it is at — the first not reached yet — pulses (owner 2026-11-05: "see at which stage it
 * is"); off under reduced motion, where the "Reading…" words beside the list say it instead.
 */
export function StageStrip({ stages, fileType = null, className, reading = false }: { stages: FileStage[]; fileType?: string | null; className?: string; reading?: boolean }) {
  const shown = shownStages(stages, fileType);
  const at = reading ? shown.findIndex((stage) => stage.state === "pending") : -1;
  return (
    <span role="img" aria-label={`${at >= 0 ? `Now at ${shown[at].name}. ` : ""}${shown.map(said).join(" ")}`} className={cn("inline-flex items-center gap-[3px]", className)}>
      {shown.map((stage, index) => (
        <span key={stage.name} title={index === at ? `${stage.name}: working on it now` : said(stage)} className={cn("h-1.5 w-[14px] overflow-hidden rounded-full", BAR.pending)}>
          {stage.state !== "pending" && (
            <span key={stage.state} className={cn("block size-full rounded-full", BAR[stage.state], fill)} style={{ animationDelay: `${index * STEP_MS}ms` }} />
          )}
          {index === at && <span className="block size-full rounded-full bg-[var(--primary)] opacity-60 motion-safe:animate-pulse" />}
        </span>
      ))}
    </span>
  );
}

/**
 * The stages at the top of a file's page (round 4, owner 2026-11-02: "it needs some redesigning … I don't like it
 * to be much bigger"): one track split into the file's own stages, each a 4px bar with its name under it, a ✓
 * when done and the count when it waits on a person. The stage the file is at reads as the current step. On a
 * phone the names hide and one line under the track says where the file is. The stage's note is its tooltip.
 */
export function StageRow({ stages, fileType = null, focus }: { stages: FileStage[]; fileType?: string | null; focus?: string | null }) {
  const shown = shownStages(stages, fileType);
  const at = shown.find((s) => s.name === focus) ?? null;
  return (
    <div className="flex flex-col gap-1.5">
      <ol aria-label="Stages of this file" className="m-0 flex list-none items-start gap-1 p-0">
        {shown.map((stage, index) => (
          <li key={stage.name} title={stage.note} aria-current={focus === stage.name ? "step" : undefined} className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span aria-hidden="true" className={cn("h-1 overflow-hidden rounded-full", BAR.pending)}>
              {stage.state !== "pending" && <span key={stage.state} className={cn("block size-full rounded-full", BAR[stage.state], fill)} style={{ animationDelay: `${index * STEP_MS}ms` }} />}
            </span>
            <span className={cn("hidden min-w-0 items-center gap-1.5 text-xs font-semibold sm:flex", NAME[stage.state])}>
              {stage.state === "done" && <Check aria-hidden="true" className="size-3 shrink-0 text-[var(--accent-ink)]" />}
              {stage.state === "failed" && <span aria-hidden="true">!</span>}
              <span className="truncate">{stage.name}</span>
              {stage.state === "needs" && stage.count ? <span aria-hidden="true" className="rounded-[5px] bg-[var(--warning-surface)] px-1.5 text-xs tabular-nums text-[var(--warning-ink)]">{stage.count.toLocaleString("en-US")}</span> : null}
            </span>
            <span className="sr-only">{said(stage)}</span>
          </li>
        ))}
      </ol>
      {at && <span aria-hidden="true" className={cn("text-xs font-semibold sm:hidden", NAME[at.state])}>At {at.name}{at.state === "needs" && at.count ? ` · ${at.count.toLocaleString("en-US")} need you` : at.state === "failed" ? " · failed" : ""}</span>}
    </div>
  );
}

/** The legend under the Files list. */
export function StageLegend() {
  const states: StageState[] = ["done", "needs", "failed", "pending"];
  return (
    <p className="m-0 flex flex-wrap gap-4 text-xs text-muted-foreground">
      {states.map((state) => (
        <span key={state} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={cn("h-1.5 w-3.5 rounded-full", BAR[state])} />{STAGE_STATE_LABELS[state]}</span>
      ))}
    </p>
  );
}
