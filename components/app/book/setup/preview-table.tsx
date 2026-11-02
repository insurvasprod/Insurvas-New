import { EmptyState } from "@/components/ui/page-states";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { fileDay } from "@/lib/ingestion/constants";
import type { PreviewLine } from "@/lib/pipelineRules/store";

const OUTCOME: Record<PreviewLine["outcome"], [string, StatusTone]> = {
  move: ["Would move", "action"],
  hold: ["Held", "warning"],
  capped: ["Stops at the cap", "danger"],
  skip: ["Skipped", "neutral"],
  wait: ["Waits", "info"],
};

/**
 * What a rule would do on today's data, one line a lead: would move, or skipped and why (a Preview runs
 * the same checks as a run and writes nothing). Used by the Rule tab's "Preview on today's data" and the
 * Preview tab.
 */
export function PreviewTable({ lines, asOf, title = "On today's data" }: { lines: PreviewLine[]; asOf: string; title?: string }) {
  const moves = lines.filter((l) => l.outcome === "move").length;
  return (
    <TableCard title={title} description={asOf ? `As of ${fileDay(asOf)} · ${moves} would move · ${lines.length - moves} not` : undefined}>
      {lines.length === 0 ? (
        <EmptyState title="Nothing for this rule today" hint="No policy has this event now. A rule only acts on what happens to a policy linked to a lead." />
      ) : (
        <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
          <thead><tr><th className="w-[130px]">Result</th><th>Lead</th><th>Because</th><th>Card</th><th>Why</th></tr></thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={`${line.policyNumber}-${line.carrierId}-${index}`}>
                <td><StatusChip tone={OUTCOME[line.outcome][1]}>{OUTCOME[line.outcome][0]}</StatusChip></td>
                <td>
                  <span className="block font-semibold leading-snug text-foreground">{line.leadName ?? (line.leadId ? "A lead" : "No lead linked")}</span>
                  <span className="block text-xs text-muted-foreground">{line.carrierName ?? "Carrier"} · {line.policyNumber}</span>
                </td>
                <td className="text-muted-foreground">{line.because}</td>
                <td>{line.outcome === "move" ? `${line.fromStage ?? "No stage"} → ${line.toStage ?? "the rule's stage"}` : line.fromStage ?? "—"}</td>
                <td className="text-muted-foreground">{line.outcome === "move" ? (line.note ? <span title={line.note}>Adds a note</span> : "No note") : line.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
