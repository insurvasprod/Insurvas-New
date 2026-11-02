import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { EVENT_LABELS } from "@/lib/pipelineRules/rules";
import type { BoardPipeline, RuleListItem } from "@/lib/pipelineRules/store";

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
 * opens its own page.
 */
export function RulesList({ rules, board, carriers }: { rules: RuleListItem[]; board: BoardPipeline[]; carriers: Array<{ id: string; name: string }> }) {
  const stages = stageNames(board);
  const carrierName = new Map(carriers.map((c) => [c.id, c.name]));
  const list = (ids: string[], none: string, name: (id: string) => string) => (ids.length ? ids.map(name).join(", ") : none);
  return (
    <TableCard>
      {rules.length === 0 ? (
        <EmptyState title="No pipeline rules yet" hint="A rule moves a lead's card when something happens to its policy, and adds a note. It starts in forecast: it records what it would do and moves nothing until you switch it to live." action={<Link href="/app/book-setup/pipeline-rules/new" className={buttonVariants()}>New rule</Link>} />
      ) : (
        <table className="portal-lead-table w-full min-w-[960px] text-left text-sm">
          <thead>
            <tr><th>When</th><th>Carriers</th><th>From</th><th>Moves to</th><th className="w-[110px]">Mode</th><th className="w-[130px]">Last 7 days</th><th className="w-[80px] text-right"><span className="sr-only">Open</span></th></tr>
          </thead>
          <tbody>
            {rules.map((rule) => {
              const v = rule.current;
              const to = v ? stages.get(v.targetStageId) : null;
              const last = rule.mode === "live" ? (rule.last7.moved ? `${rule.last7.moved} moved` : "—") : rule.last7.wouldMove ? `would move ${rule.last7.wouldMove}` : "—";
              return (
                <tr key={rule.id}>
                  <td>
                    <Link href={`/app/book-setup/pipeline-rules/${rule.id}`} className="block font-semibold leading-snug text-foreground hover:underline">{rule.name}</Link>
                    <span className="block text-xs text-muted-foreground">{v ? `${EVENT_LABELS[v.event].label} · ${v.noteOn ? "adds a note" : "no note"}` : "no version"}</span>
                  </td>
                  <td className="text-muted-foreground">{v ? list(v.carrierIds, "Every carrier", (id) => carrierName.get(id) ?? "a carrier") : "—"}</td>
                  <td className="text-muted-foreground">{v ? list(v.fromStageIds, "Any stage", (id) => stages.get(id)?.stage ?? "a stage") : "—"}</td>
                  <td>{to ? `${to.pipeline} › ${to.stage}` : <span className="text-[var(--warning-ink)]">A stage no longer on the board</span>}</td>
                  <td><ModeChip mode={rule.mode} enabled={rule.enabled} /></td>
                  <td className="text-muted-foreground tabular-nums">{last}{rule.last7.held ? ` · ${rule.last7.held} held` : ""}</td>
                  <td className="text-right"><Link href={`/app/book-setup/pipeline-rules/${rule.id}`} className="font-semibold text-[var(--accent-ink)] hover:underline">Open</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
