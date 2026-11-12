"use client";

import { useMemo, useState } from "react";

import { DataToolbar } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatusChip } from "@/components/ui/status-chip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { RULE_TYPES, type RuleType } from "@/lib/ingestion/carrierRules";
import { fileDay } from "@/lib/ingestion/constants";

import { sourceWord, windowLabel } from "./carrier-terms-window-dialog";

export type HistoryLine = {
  id: string;
  ruleType: RuleType;
  effectiveFrom: string;
  createdAt: string;
  scope: "agency" | "platform";
  cleared: boolean;
  windowDays: number | null;
  graceDays: number | null;
  redraftAttempts: number | null;
  redraftIntervalDays: number | null;
  source: string | null;
  notes: string | null;
  verifiedAt: string | null;
  by: string | null;
  verifiedBy: string | null;
};

const SHORT: Record<RuleType, string> = { first_payment: "First payment", ongoing_payment: "Ongoing", reinstatement: "Reinstatement", conservation: "Conservation", cancellation_request: "Cancellation" };

function ruleWords(line: HistoryLine): string {
  if (line.cleared) return "Back to Insurvas's";
  const tries = line.redraftAttempts === null ? null : `${line.redraftAttempts} ${line.redraftAttempts === 1 ? "try" : "tries"}${line.redraftIntervalDays !== null && line.redraftAttempts > 1 ? ` · ${line.redraftIntervalDays} d apart` : ""}`;
  return [line.windowDays !== null ? `${line.windowDays} d` : null, line.graceDays !== null ? `grace ${line.graceDays} d` : null, tries, line.source ? sourceWord(line.source).toLowerCase() : null].filter(Boolean).join(" · ") || "—";
}

/**
 * A carrier's History tab (board 1·3, direction B): every saved window as one dated list, newest first, filterable by
 * window; the window dialog's "History of this window ›" lands here already filtered (?window=). Read-only. A rule
 * dated after today is marked upcoming. Past countdowns keep the rule they used.
 */
export function CarrierTermsHistory({ lines, asOf, initialWindow }: { lines: HistoryLine[]; asOf: string; initialWindow: RuleType | null }) {
  const [filter, setFilter] = useState<RuleType | "all">(initialWindow ?? "all");
  const sorted = useMemo(() => [...lines].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.createdAt.localeCompare(a.createdAt)), [lines]);
  const shown = filter === "all" ? sorted : sorted.filter((line) => line.ruleType === filter);
  const count = (type: RuleType) => lines.filter((line) => line.ruleType === type).length;

  const toolbar = (
    <DataToolbar>
      <span role="radiogroup" aria-label="Window" className="inline-flex flex-wrap gap-2">
        <ToggleChip role="radio" selected={filter === "all"} count={lines.length} onClick={() => setFilter("all")}>All</ToggleChip>
        {RULE_TYPES.map((type) => <ToggleChip key={type} role="radio" selected={filter === type} count={count(type)} onClick={() => setFilter(type)}>{SHORT[type]}</ToggleChip>)}
      </span>
    </DataToolbar>
  );
  const footer = (
    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
      <span>Past countdowns keep the rule they used.</span>
      <span className="flex-1" />
      <span>{shown.length.toLocaleString("en-US")} {shown.length === 1 ? "change" : "changes"}</span>
    </div>
  );

  return (
    <PagedTableCard total={shown.length} noun="changes" toolbar={toolbar} footer={footer}>
      {shown.length === 0 ? (
        <EmptyState
          title={lines.length ? "No changes to this window" : "No changes yet"}
          hint={lines.length ? "Nothing has been saved for this window yet; the other windows have their own lines." : "Each window saved here, by you or by Insurvas, is listed with its date and who saved it."}
        />
      ) : (
        <table className="portal-lead-table w-full min-w-[760px] text-left text-sm" data-even="off">
          <thead>
            <tr><th className="w-[140px]">From</th><th className="w-[200px]">Window</th><th>Rule</th><th>By</th></tr>
          </thead>
          <PagedBody>
            {shown.map((line) => (
              <tr key={line.id}>
                <td className="whitespace-nowrap tabular-nums text-muted-foreground">{fileDay(line.effectiveFrom)}</td>
                <td className="whitespace-nowrap font-medium text-foreground">{windowLabel(line.ruleType)}</td>
                <td className="whitespace-nowrap" title={line.notes ?? undefined}>
                  <span className="inline-flex items-center gap-2">
                    <span>{ruleWords(line)}</span>
                    {!line.cleared && line.effectiveFrom > asOf && <StatusChip tone="warning">upcoming</StatusChip>}
                  </span>
                </td>
                <td className="whitespace-nowrap" title={line.verifiedAt ? `Verified ${fileDay(line.verifiedAt)}${line.verifiedBy ? ` by ${line.verifiedBy}` : ""}` : undefined}>
                  {line.scope === "platform" ? "Insurvas" : line.by ?? "your agency"}
                </td>
              </tr>
            ))}
          </PagedBody>
        </table>
      )}
    </PagedTableCard>
  );
}
