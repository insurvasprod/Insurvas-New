import type { ReactNode } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { fileDay } from "@/lib/ingestion/constants";
import { EVENT_LABELS, type RuleMode } from "@/lib/pipelineRules/rules";
import type { BoardPipeline, EvaluationRow, RuleVersionRow } from "@/lib/pipelineRules/store";
import { cn } from "@/lib/utils";

import { stageNames } from "./rules-list";

const LINK = "font-semibold text-[var(--accent-ink)] hover:underline";

/** The rule as one sentence: when → which carriers → from which stages → where it moves → the note. */
export function ruleSentence(v: Pick<RuleVersionRow, "event" | "carrierIds" | "fromStageIds" | "targetStageId" | "noteOn" | "noteTemplate">, board: BoardPipeline[], carrierName: (id: string) => string) {
  const stages = stageNames(board);
  const total = board.reduce((sum, p) => sum + p.stages.filter((s) => !s.archived).length, 0);
  const to = stages.get(v.targetStageId);
  const carriers = v.carrierIds.length === 0 ? "every carrier" : v.carrierIds.length <= 2 ? v.carrierIds.map(carrierName).join(" and ") : `${v.carrierIds.length} carriers`;
  const from = v.fromStageIds.length === 0 ? "any stage" : v.fromStageIds.length <= 2 ? v.fromStageIds.map((id) => stages.get(id)?.stage ?? "a stage").join(" or ") : `${v.fromStageIds.length} of ${total} stages`;
  return (
    <>
      When a carrier file says a policy is <b className="text-foreground">{EVENT_LABELS[v.event].label.toLowerCase()}</b>, for <b className="text-foreground">{carriers}</b>, and its lead&rsquo;s card is in <b className="text-foreground">{from}</b>, move the card to <b className="text-foreground">{to ? `${to.pipeline} › ${to.stage}` : "a stage no longer on the board"}</b>
      {v.noteOn ? <> and add the note <span className="text-muted-foreground">&ldquo;{v.noteTemplate}&rdquo;</span></> : null}.
    </>
  );
}

/** Draft → Forecast → Live: where the rule is in its life, the step it is on lit. */
function Track({ mode, enabled, createdAt, liveSince }: { mode: RuleMode; enabled: boolean; createdAt: string; liveSince: string | null }) {
  const at = mode === "draft" ? 0 : mode === "forecast" ? 1 : 2;
  const steps = [
    { name: "Drafted", sub: `${fileDay(createdAt.slice(0, 10))}` },
    { name: "Forecast", sub: "moves nothing, records what it would" },
    { name: "Live", sub: liveSince ? `since ${fileDay(liveSince.slice(0, 10))}` : "moves cards and adds notes" },
  ];
  return (
    <ol aria-label="Where this rule is" className="m-0 grid list-none grid-cols-3 gap-1 p-0">
      {steps.map((step, index) => (
        <li key={step.name} aria-current={index === at ? "step" : undefined} className="flex min-w-0 flex-col gap-1.5">
          <span aria-hidden="true" className={cn("h-1 rounded-full", index <= at ? (enabled ? "bg-[var(--primary)]" : "bg-[var(--muted)]") : "bg-[var(--border-strong)]")} />
          <span className={cn("flex items-center gap-1.5 text-xs font-semibold", index <= at ? "text-foreground" : "text-muted-foreground")}>
            {index < at && <Check aria-hidden="true" className="size-3 text-[var(--accent-ink)]" />}
            {index + 1} · {step.name}{index === at && !enabled ? " · off" : ""}
          </span>
          <span className="hidden truncate text-xs text-muted-foreground sm:block">{step.sub}</span>
        </li>
      ))}
    </ol>
  );
}

type Todo = { done: boolean; text: ReactNode; action?: ReactNode };

/**
 * Pipeline rule › Overview (round 6, direction F of docs/la4/mockups-r6/pipeline-rule-r2.html, owner's pick 2026-11-06):
 * the track (Drafted → Forecast → Live), then — before it is live — what is left as a checklist the data ticks, or —
 * once it is live — how it is doing as the mockups' strip; and the rule as one sentence, with Change on the Rule tab.
 */
export function RuleOverview({ mode, enabled, createdAt, liveSince, version, forecast, live, board, carrierName, checkHref, ruleHref, graceMissing }: {
  mode: RuleMode;
  enabled: boolean;
  createdAt: string;
  liveSince: string | null;
  version: RuleVersionRow;
  forecast: EvaluationRow[];
  live: EvaluationRow[];
  board: BoardPipeline[];
  carrierName: (id: string) => string;
  checkHref: string;
  ruleHref: string;
  /** Carriers this missed-payment rule covers that have no grace set (null when not a missed-payment rule). */
  graceMissing: number | null;
}) {
  const checked = forecast.filter((l) => l.checked).length;
  const wrong = forecast.filter((l) => l.checked === "wrong").length;
  const count = (outcome: string) => live.filter((l) => l.outcome === outcome).length;
  const liveWrong = live.filter((l) => l.checked === "wrong").length;
  const todos: Todo[] = [
    ...(enabled ? [] : [{ done: false, text: <><b>Turn it on</b> <span className="text-muted-foreground">· an off rule records nothing</span></> }]),
    ...(mode === "draft" ? [{ done: false, text: <><b>Start the forecast</b> <span className="text-muted-foreground">· it then records what it would do with each carrier file, and moves nothing</span></> }] : []),
    { done: forecast.length > 0, text: forecast.length ? <>It has seen carrier files <span className="text-muted-foreground">· {forecast.length.toLocaleString("en-US")} would-{forecast.length === 1 ? "move" : "moves"} in the last 7 days</span></> : <>It hasn&rsquo;t had anything to do yet <span className="text-muted-foreground">· a would-move appears when a carrier file brings its event</span></> },
    ...(forecast.length ? [{
      done: checked === forecast.length && wrong === 0,
      text: <><b>Check its {forecast.length.toLocaleString("en-US")} would-{forecast.length === 1 ? "move" : "moves"}</b> <span className="text-muted-foreground">· {checked} checked{wrong ? `, ${wrong} wrong` : ""}</span></>,
      action: <Link href={checkHref} className={LINK}>Check them ›</Link>,
    }] : []),
    ...(graceMissing ? [{ done: false, text: <>Every carrier it covers has a grace set <span className="text-muted-foreground">· {graceMissing} {graceMissing === 1 ? "doesn't" : "don't"}, so no missed payment is counted for them</span></>, action: <Link href="/app/book-setup/carrier-rules" className={LINK}>Carrier terms ›</Link> }] : []),
  ];

  return (
    <>
      <Track mode={mode} enabled={enabled} createdAt={createdAt} liveSince={liveSince} />
      {mode === "live" ? (
        <StatStrip label="The last 7 days">
          <StatTile label="Moved" value={count("moved").toLocaleString("en-US")} footnote="cards, last 7 days" />
          <StatTile label="Skipped" value={count("skipped").toLocaleString("en-US")} footnote="already there, or a check failed" />
          <StatTile label="Held" value={count("held").toLocaleString("en-US")} valueTone={count("held") ? "warning" : undefined} footnote="two rules disagreed" />
          <StatTile label="Marked wrong" value={liveWrong.toLocaleString("en-US")} valueTone={liveWrong ? "danger" : undefined} footnote={liveWrong ? "see Check it" : "nothing marked wrong"} href={checkHref} />
        </StatStrip>
      ) : null}
      <div className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-4", mode !== "live" && "min-[1100px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]")}>
        {mode !== "live" && (
          <TableCard title="Before it goes live">
            <ul className="m-0 list-none border-t border-border p-0">
              {todos.map((todo, index) => (
                <li key={index} className="grid min-h-[2.75rem] grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-4 py-2 text-sm last:border-b-0">
                  <span aria-label={todo.done ? "Done" : "Not yet"} className={cn("grid size-[18px] place-items-center rounded-full border-2", todo.done ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]" : "border-[var(--border-strong)]")}>{todo.done && <Check aria-hidden="true" className="size-3" />}</span>
                  <span className="min-w-0 leading-snug text-foreground">{todo.text}</span>
                  <span className="text-right">{todo.action}</span>
                </li>
              ))}
            </ul>
          </TableCard>
        )}
        <TableCard title="The rule" description={`Version ${version.version}, saved ${fileDay(version.createdAt.slice(0, 10))}`} action={<Link href={ruleHref} className={LINK}>Change ›</Link>}>
          <p className="m-0 border-t border-border px-4 py-4 text-sm leading-relaxed text-[var(--body)]">{ruleSentence(version, board, carrierName)}</p>
        </TableCard>
      </div>
    </>
  );
}
