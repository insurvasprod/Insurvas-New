import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { EVENT_LABELS } from "@/lib/pipelineRules/rules";
import type { BoardPipeline, RuleListItem } from "@/lib/pipelineRules/store";

import { LinkRow, RowChevron } from "./link-row";

/** A rule's mode as a chip: Live green, Forecast amber, Draft and Off grey. */
export function ModeChip({ mode, enabled }: { mode: "draft" | "forecast" | "live"; enabled: boolean }) {
  const [label, tone]: [string, StatusTone] = !enabled ? ["Off", "neutral"] : mode === "live" ? ["Live", "good"] : mode === "forecast" ? ["Forecast", "warning"] : ["Draft", "neutral"];
  return <StatusChip tone={tone}>{label}</StatusChip>;
}

export function stageNames(board: BoardPipeline[]) {
  const map = new Map<string, { stage: string; pipeline: string }>();
  for (const p of board) for (const s of p.stages) map.set(s.id, { stage: s.name, pipeline: p.name });
  return map;
}

/**
 * Setup › Pipeline rules, the list (board BobRules): when something happens to a policy, move its card
 * and add a note. One row a rule — When · Carriers · From · Moves to · Mode · Last 7 days — and each
 * opens its own page: the whole row is the link (board 10), with a "›" at its end and no Open button.
 */
export function RulesList({ rules, board, carriers }: { rules: RuleListItem[]; board: BoardPipeline[]; carriers: Array<{ id: string; name: string }> }) {
  const stages = stageNames(board);
  const carrierName = new Map(carriers.map((c) => [c.id, c.name]));
  // Round 6 (owner 2026-11-06): a rule from nine stages wrote all nine across the row; past two it reads "9 stages",
  // the names in the tooltip, so the row says what the rule does at a glance.
  const list = (ids: string[], none: string, name: (id: string) => string, noun: string) => {
    if (!ids.length) return none;
    const names = [...new Set(ids.map(name))];
    return names.length <= 2 ? names.join(", ") : <span title={names.join(", ")} className="underline decoration-dotted underline-offset-4">{names.length} {noun}</span>;
  };
  return (
    <TableCard>
      {rules.length === 0 ? (
        <EmptyState title="No card-move rules yet" hint="A rule moves a lead's card when something happens to its policy, and adds a note. It starts in forecast: it records what it would do and moves nothing until you switch it to live." action={<Link href="/app/book-setup/pipeline-rules/new" className={buttonVariants()}>New rule</Link>} />
      ) : (
        <table className="portal-lead-table w-full min-w-[960px] text-left text-sm">
          <thead>
            <tr><th>When</th><th>Carriers</th><th>From</th><th>Moves to</th><th className="w-[110px]">Mode</th><th className="w-[130px]">Last 7 days</th><th className="w-10"><span className="sr-only">Open</span></th></tr>
          </thead>
          <tbody>
            {rules.map((rule) => {
              const v = rule.current;
              const to = v ? stages.get(v.targetStageId) : null;
              const last = rule.mode === "live" ? (rule.last7.moved ? `${rule.last7.moved} moved` : "—") : rule.last7.wouldMove ? `would move ${rule.last7.wouldMove}` : "—";
              return (
                <LinkRow key={rule.id} href={`/app/book-setup/pipeline-rules/${rule.id}`}>
                  <td>
                    <Link href={`/app/book-setup/pipeline-rules/${rule.id}`} className="block font-semibold leading-snug text-foreground hover:underline">{rule.name}</Link>
                    <span className="block text-xs text-muted-foreground">{v ? `${EVENT_LABELS[v.event].label} · ${v.noteOn ? "adds a note" : "no note"}` : "no version"}</span>
                  </td>
                  <td className="text-muted-foreground">{v ? list(v.carrierIds, "Every carrier", (id) => carrierName.get(id) ?? "a carrier", "carriers") : "—"}</td>
                  <td className="text-muted-foreground">{v ? list(v.fromStageIds, "Any stage", (id) => stages.get(id)?.stage ?? "a stage", "stages") : "—"}</td>
                  <td>{to ? `${to.pipeline} › ${to.stage}` : <span className="text-[var(--warning-ink)]">A stage no longer on the board</span>}</td>
                  <td><ModeChip mode={rule.mode} enabled={rule.enabled} /></td>
                  <td className="text-muted-foreground tabular-nums">{last}{rule.last7.held ? ` · ${rule.last7.held} held` : ""}</td>
                  <RowChevron />
                </LinkRow>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
