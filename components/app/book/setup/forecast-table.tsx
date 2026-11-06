"use client";

import type React from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataToolbar } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import { fileDay } from "@/lib/ingestion/constants";
import type { EvaluationRow } from "@/lib/pipelineRules/store";
import { notify } from "@/lib/notify";

type Filter = "all" | "open" | "right" | "wrong";

/**
 * A rule's Forecast tab (board BobE8): the last 7 days of what it would have done, each line marked Right
 * or Wrong by a person. Nothing here moves a card.
 */
export function ForecastTable({ lines, readOnly, title, action, live = false }: { lines: EvaluationRow[]; readOnly: boolean; title?: string; action?: React.ReactNode; live?: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const counts = { open: lines.filter((l) => !l.checked).length, right: lines.filter((l) => l.checked === "right").length, wrong: lines.filter((l) => l.checked === "wrong").length };
  const shown = lines.filter((l) => filter === "all" || (filter === "open" ? !l.checked : l.checked === filter));

  async function check(id: string, verdict: "right" | "wrong" | null) {
    setBusy(id);
    try {
      const response = await fetch("/api/app/pipeline-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "check", evaluation_id: id, verdict }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That did not save.");
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <TableCard
      title={title ?? `Last 7 days · ${lines.length} would-${lines.length === 1 ? "move" : "moves"}`}
      action={action}
      toolbar={<DataToolbar><Segmented<Filter> label="Checked" value={filter} onChange={setFilter} options={[{ key: "all", label: "All" }, { key: "open", label: "Not checked", count: counts.open }, { key: "right", label: "Right", count: counts.right }, { key: "wrong", label: "Wrong", count: counts.wrong }]} /></DataToolbar>}
    >
      {lines.length === 0 ? (
        <EmptyState title={live ? "It hasn't acted in the last 7 days" : "Nothing would have moved in the last 7 days"} hint={live ? "A line appears each time a carrier file brings its event to a policy linked to a lead." : "A forecast line appears when the rule's event happens to a policy linked to a lead and every check passes."} />
      ) : shown.length === 0 ? (
        <EmptyState title="No line in this view" hint="Choose All to see every line." />
      ) : (
        <table className="portal-lead-table w-full min-w-[820px] text-left text-sm">
          <thead><tr><th className="w-[110px]">Day</th><th>Lead</th><th>{live ? "What it did" : "Would have"}</th><th className="w-[220px]">Was it right?</th></tr></thead>
          <tbody>
            {shown.map((line) => (
              <tr key={line.id}>
                <td className="tabular-nums text-muted-foreground">{fileDay(line.evaluatedAt.slice(0, 10))}</td>
                <td>
                  <span className="block font-semibold leading-snug text-foreground">{line.leadName ?? "A lead"}</span>
                  <span className="block text-xs text-muted-foreground">{line.policyNumber}{line.because ? ` · ${line.because}` : ""}</span>
                </td>
                <td>{live && line.outcome !== "moved" ? <><StatusChip tone={line.outcome === "held" ? "warning" : "neutral"}>{line.outcome === "held" ? "Held" : line.outcome === "failed" ? "Not moved" : "Skipped"}</StatusChip> <span className="text-muted-foreground">{line.reason ?? ""}</span></> : <>{line.fromStage ?? "No stage"} → {line.toStage ?? "the rule's stage"}</>}</td>
                <td>
                  {line.checked ? (
                    <span className="inline-flex items-center gap-2">
                      <StatusChip tone={line.checked === "right" ? "good" : "danger"}>{line.checked === "right" ? "Right" : `Wrong${line.checkedNote ? ` · ${line.checkedNote}` : ""}`}</StatusChip>
                      {!readOnly && <Button type="button" variant="ghost" size="sm" disabled={busy !== null} onClick={() => void check(line.id, null)}>Undo</Button>}
                    </span>
                  ) : readOnly ? <span className="text-muted-foreground">Not checked</span> : (
                    <span className="inline-flex gap-2">
                      <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void check(line.id, "right")}>Right</Button>
                      <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void check(line.id, "wrong")}>Wrong</Button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
