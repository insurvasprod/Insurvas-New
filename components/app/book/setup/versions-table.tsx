import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { fileDay } from "@/lib/ingestion/constants";
import { EVENT_LABELS } from "@/lib/pipelineRules/rules";
import type { BoardPipeline, RuleVersionRow } from "@/lib/pipelineRules/store";
import { stageNames } from "@/components/app/book/setup/rules-list";

/**
 * A rule's Versions tab: every version, newest first. A content change made each one; a version never
 * changes, and what it recorded stays with it. On/off and the mode are not versions.
 */
export function VersionsTable({ versions, current, board, carriers }: { versions: RuleVersionRow[]; current: number; board: BoardPipeline[]; carriers: Array<{ id: string; name: string }> }) {
  const stages = stageNames(board);
  const carrierName = new Map(carriers.map((c) => [c.id, c.name]));
  return (
    <TableCard title={`${versions.length} ${versions.length === 1 ? "version" : "versions"}`}>
      <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
        <thead><tr><th className="w-[110px]">Version</th><th className="w-[120px]">Saved</th><th>When</th><th>From</th><th>Moves to</th><th>Note</th></tr></thead>
        <tbody>
          {versions.map((v) => {
            const to = stages.get(v.targetStageId);
            return (
              <tr key={v.id}>
                <td><span className="inline-flex items-center gap-2">v{v.version}{v.version === current && <StatusChip tone="good">In use</StatusChip>}</span></td>
                <td className="tabular-nums text-muted-foreground">{fileDay(v.createdAt.slice(0, 10))}</td>
                <td>
                  <span className="block leading-snug text-foreground">{EVENT_LABELS[v.event].label}</span>
                  <span className="block text-xs text-muted-foreground">{v.carrierIds.length ? v.carrierIds.map((id) => carrierName.get(id) ?? "a carrier").join(", ") : "Every carrier"}</span>
                </td>
                <td className="text-muted-foreground">{v.fromStageIds.length ? v.fromStageIds.map((id) => stages.get(id)?.stage ?? "a stage").join(", ") : "Any stage"}</td>
                <td>{to ? `${to.pipeline} › ${to.stage}` : "A stage no longer on the board"}</td>
                <td className="max-w-[320px] whitespace-normal text-muted-foreground">{v.noteOn ? v.noteTemplate : "No note"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableCard>
  );
}
