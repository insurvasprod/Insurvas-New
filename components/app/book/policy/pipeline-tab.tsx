import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatusChip } from "@/components/ui/status-chip";
import { fileDay } from "@/lib/ingestion/constants";
import { moveSourceWord } from "@/lib/ingestion/policyPage";
import type { PolicyPipeline } from "@/lib/ingestion/policyPageStore";

import { UndoMove } from "./policy-islands";

/**
 * Policy › Pipeline (canvas board BobE6): every move of this policy's card, why, and by what; Undo on the
 * newest move (asks first), and Move it by hand, which opens the lead.
 *
 * Today's moves come from tenant_lead_stage_events. `pipeline.ruleLines` is where the pipeline rules
 * (lib/pipelineRules/, built in parallel) put their evaluations, forecast lines and skips; they are drawn
 * in the same table, marked Live, Forecast or Skipped, as soon as the store fills them.
 */
export function PolicyPipelineTab({ pipeline, leadId, undo, pendingMessage }: {
  pipeline: PolicyPipeline;
  leadId: string | null;
  /** The newest move can be undone: where the card goes back to, or why it can't (null when no Undo is offered). */
  undo: { moveId: string; backTo: string; disabledReason: string | null } | null;
  pendingMessage: string;
}) {
  if (!leadId) return <EmptyState title="No card for this policy" hint="A card belongs to the lead behind the sale. Link this policy to its sale on the Client tab and its card shows here." />;
  if (!pipeline.available) return <EmptyState title="Card history isn't available yet" hint={pendingMessage} />;
  const rows = [
    ...pipeline.moves.map((move) => ({ kind: "move" as const, at: move.at, move })),
    ...pipeline.ruleLines.map((line) => ({ kind: "rule" as const, at: line.at, line })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const card = pipeline.card;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 text-sm text-muted-foreground">Card now: <span className="font-medium text-foreground">{card?.stage ? `${card.pipeline ? `${card.pipeline} › ` : ""}${card.stage}` : "Not on a pipeline"}</span></p>
        <Button asChild variant="outline"><Link href={`/app/leads/${leadId}`}><ExternalLink aria-hidden="true" />Move it by hand (opens the lead)</Link></Button>
      </div>
      <PagedTableCard total={rows.length} noun="moves">
        {rows.length === 0 ? (
          <EmptyState title="The card hasn't moved yet" hint="Each move of this policy's card, by a person, a call outcome or the application, shows here with the reason." />
        ) : (
          <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
            <thead><tr><th className="w-[110px]">When</th><th>Card</th><th>Because</th><th className="w-[180px]">By</th><th className="w-[110px]"><span className="sr-only">Undo</span></th></tr></thead>
            <PagedBody>
              {rows.map((row) => row.kind === "move" ? (
                <tr key={row.move.id}>
                  <td className="tabular-nums text-muted-foreground">{fileDay(row.at)}</td>
                  <td>{row.move.from ? <span className="text-muted-foreground">{row.move.from} → </span> : null}<strong className="font-semibold text-foreground">{row.move.to}</strong>{row.move.pipeline && <span className="text-muted-foreground"> · {row.move.pipeline}</span>}</td>
                  <td className="text-muted-foreground">{moveSourceWord(row.move.source)}{row.move.outcome ? ` · ${row.move.outcome}` : ""}</td>
                  <td className="text-muted-foreground">{row.move.by ?? (row.move.source === "application_sync" ? "Insurvas" : "—")}</td>
                  <td className="text-right">{undo && undo.moveId === row.move.id && leadId ? <UndoMove leadId={leadId} from={row.move.to} to={undo.backTo} disabledReason={undo.disabledReason} /> : null}</td>
                </tr>
              ) : (
                <tr key={`rule-${row.at}-${row.line.text}`}>
                  <td className="tabular-nums text-muted-foreground">{fileDay(row.at)}</td>
                  <td>{row.line.text}</td>
                  <td className="text-muted-foreground">{row.line.reason ?? "—"}</td>
                  <td>{row.line.mode === "live" ? <span className="text-muted-foreground">{row.line.rule ?? "A rule"}</span> : <StatusChip tone={row.line.mode === "forecast" ? "warning" : "neutral"}>{row.line.mode === "forecast" ? "Forecast" : "Skipped"}</StatusChip>}</td>
                  <td />
                </tr>
              ))}
            </PagedBody>
          </table>
        )}
      </PagedTableCard>
    </>
  );
}
