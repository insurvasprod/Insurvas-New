"use client";

import { useState } from "react";
import Link from "next/link";

import { DataToolbar } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatusChip } from "@/components/ui/status-chip";
import { Segmented } from "@/components/ui/view-tabs";
import { fileDay } from "@/lib/ingestion/constants";
import type { EvaluationRow } from "@/lib/pipelineRules/store";

import { CheckDialog, leadHref, openCheck, policyHref } from "./card-moves-check";

type Filter = "all" | "open" | "right" | "wrong";

/**
 * A rule's Check it tab (mockup r7 2·2): the last 7 days of what it would have done, as a list of verdicts. No Right /
 * Wrong buttons in the rows: a row, or "Check N one by one" on the title line, opens the check dialog. The lead's name
 * opens the lead; the policy number opens the policy. A live rule's lines are what it did. Nothing here moves a card.
 */
export function ForecastTable({ lines, readOnly, title, live = false, autoCheck = false }: { lines: EvaluationRow[]; readOnly: boolean; title?: string; live?: boolean; autoCheck?: boolean }) {
  const [filter, setFilter] = useState<Filter>("all");
  const counts = { open: lines.filter((l) => !l.checked).length, right: lines.filter((l) => l.checked === "right").length, wrong: lines.filter((l) => l.checked === "wrong").length };
  const shown = lines.filter((l) => filter === "all" || (filter === "open" ? !l.checked : l.checked === filter));
  const checkable = !live && !readOnly;

  return (
    <>
      <PagedTableCard
        total={shown.length}
        noun="lines"
        title={title ?? `Last 7 days · ${lines.length} would-${lines.length === 1 ? "move" : "moves"}`}
        toolbar={live || lines.length === 0 ? undefined : (
          <DataToolbar>
            <Segmented<Filter> label="Checked" value={filter} onChange={setFilter} options={[{ key: "all", label: `All ${lines.length}` }, { key: "open", label: "Not checked", count: counts.open }, { key: "right", label: "Right", count: counts.right }, { key: "wrong", label: "Wrong", count: counts.wrong, tone: "danger" }]} />
          </DataToolbar>
        )}
      >
        {lines.length === 0 ? (
          <EmptyState title={live ? "It hasn't acted in the last 7 days" : "Nothing would have moved in the last 7 days"} hint={live ? "A line appears each time a carrier file brings its event to a policy linked to a lead." : "A forecast line appears when the rule's event happens to a policy linked to a lead and every check passes."} />
        ) : shown.length === 0 ? (
          <EmptyState title="No line in this view" hint="Choose All to see every line." />
        ) : (
          <table className="portal-lead-table w-full min-w-[820px] text-left text-sm">
            <thead>
              <tr>
                <th className="w-[120px]">Day</th><th>Lead</th><th>Policy</th><th>{live ? "What it did" : "Would have"}</th>
                {!live && <th className="w-[160px]">Was it right?</th>}
                {checkable && <th className="w-[110px]">Next step</th>}
              </tr>
            </thead>
            <PagedBody>
              {shown.map((line) => {
                const lead = leadHref(line);
                return (
                  <tr
                    key={line.id}
                    className={checkable ? "cursor-pointer hover:bg-[var(--primary-soft)]" : undefined}
                    onClick={checkable ? (event) => { if (!(event.target as HTMLElement).closest("a, button")) openCheck(line.id); } : undefined}
                  >
                    <td className="whitespace-nowrap tabular-nums text-muted-foreground">{fileDay(line.evaluatedAt.slice(0, 10))}</td>
                    <td className="whitespace-nowrap">
                      {lead ? <Link href={lead} className="font-medium text-foreground hover:underline">{line.leadName ?? "A lead"}</Link> : <span className="font-medium text-foreground">{line.leadName ?? "No lead linked"}</span>}
                    </td>
                    <td className="whitespace-nowrap tabular-nums" title={[line.carrierName, line.because].filter(Boolean).join(" · ") || undefined}>
                      <Link href={policyHref(line)} className="hover:underline">{line.policyNumber}</Link>
                    </td>
                    <td className="whitespace-nowrap">{live && line.outcome !== "moved" ? <StatusChip tone={line.outcome === "held" ? "warning" : "neutral"} title={line.reason ?? undefined}>{line.outcome === "held" ? "Held" : line.outcome === "failed" ? "Not moved" : "Skipped"}</StatusChip> : <>{line.fromStage ?? "No stage"} → {line.toStage ?? "the rule's stage"}</>}</td>
                    {!live && (
                      <td>
                        {line.checked
                          ? <StatusChip tone={line.checked === "right" ? "good" : "danger"} title={line.checked === "wrong" && line.checkedNote ? line.checkedNote : undefined}>{line.checked === "right" ? "Right" : "Wrong"}</StatusChip>
                          : <StatusChip tone="warning">Not checked</StatusChip>}
                      </td>
                    )}
                    {checkable && <td className="whitespace-nowrap"><button type="button" className="hover:underline" onClick={() => openCheck(line.id)}>{line.checked ? "Change ›" : "Check ›"}</button></td>}
                  </tr>
                );
              })}
            </PagedBody>
          </table>
        )}
      </PagedTableCard>
      {checkable && <CheckDialog lines={lines} autoOpen={autoCheck} />}
    </>
  );
}
