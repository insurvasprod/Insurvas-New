"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { RULE_TYPE_LABELS, RULE_TYPES, type RuleType } from "@/lib/ingestion/carrierRules";
import { carrierRulesHref, type CoverageFilter, type DotState } from "@/lib/pipelineRules/carrierCoverageModel";
import { cn } from "@/lib/utils";

import { LinkRow, RowChevron } from "./link-row";

export type CoverageListRow = {
  carrierId: string;
  carrierName: string;
  inForce: number;
  dots: Record<RuleType, DotState>;
  /** The biggest gap in words and what it costs; null when every window is set. */
  gap: { words: string; cost: string } | null;
  missing: number;
  unverified: number;
  money: string;
  files: string;
};

const DOT: Record<DotState, { className: string; label: string }> = {
  verified: { className: "bg-[var(--success)]", label: "verified" },
  unverified: { className: "bg-[var(--muted)]", label: "observed, unverified" },
  missing: { className: "border-2 border-[var(--error)] bg-transparent", label: "not set" },
};

/** One dot per window, in the order of RULE_TYPES; the colour is never the only telling (each has its name). */
export function RuleDots({ dots }: { dots: Record<RuleType, DotState> }) {
  return (
    <span className="inline-flex items-center gap-1" role="img" aria-label={RULE_TYPES.map((type) => `${RULE_TYPE_LABELS[type].label}: ${DOT[dots[type]].label}`).join(", ")}>
      {RULE_TYPES.map((type) => <span key={type} title={`${RULE_TYPE_LABELS[type].label}: ${DOT[dots[type]].label}`} className={cn("inline-block size-2.5 rounded-full", DOT[dots[type]].className)} />)}
    </span>
  );
}

function Legend() {
  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      {(["verified", "unverified", "missing"] as const).map((state) => (
        <span key={state} className="inline-flex items-center gap-1.5"><span className={cn("inline-block size-2.5 rounded-full", DOT[state].className)} aria-hidden="true" />{DOT[state].label}</span>
      ))}
    </span>
  );
}

/**
 * Setup › Carrier rules, the list (board 9; LA-4.17's coverage screen): every carrier the agency works with, which
 * of the five windows are set, the biggest gap and the policies it leaves without a countdown, and the carrier's
 * money and file facts in short. Sorted by policies affected (the server's order). Nothing is edited here: the
 * whole row opens the carrier's page.
 */
export function CarrierCoverageList({ rows }: { rows: CoverageListRow[] }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [filter, setFilter] = useState<CoverageFilter>("all");
  const [query, setQuery] = useState("");
  const counts = { all: rows.length, missing: rows.filter((r) => r.missing > 0).length, unverified: rows.filter((r) => r.unverified > 0).length };
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((row) => (filter === "all" || (filter === "missing" ? row.missing > 0 : row.unverified > 0)) && (!q || row.carrierName.toLowerCase().includes(q)));
  }, [rows, filter, query]);

  const chips: Array<[CoverageFilter, string]> = [["all", "All"], ["missing", "Missing a rule"], ["unverified", "Unverified"]];
  const toolbar = (
    <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
      <ToolbarSearch value={query} onChange={setQuery} placeholder="Search carriers" />
      <span role="radiogroup" aria-label="Show" className="inline-flex flex-wrap gap-2">
        {chips.map(([key, label]) => <ToggleChip key={key} role="radio" selected={filter === key} count={counts[key]} countTone={key === "missing" && counts.missing ? "danger" : undefined} onClick={() => setFilter(key)}>{label}</ToggleChip>)}
      </span>
    </DataToolbar>
  );

  if (!rows.length) {
    return (
      <PagedTableCard total={0} noun="carriers" toolbar={toolbar}>
        <EmptyState title="No carriers yet" hint="Switch on the carriers you work with in Settings › Carriers; each one then has its rules here." />
      </PagedTableCard>
    );
  }

  return (
    <PagedTableCard total={shown.length} noun="carriers" toolbar={toolbar} footer={<Legend />} suffix={<Legend />}>
      {shown.length === 0 ? (
        <NoMatches noun="carriers" onClear={() => { setQuery(""); setFilter("all"); }} />
      ) : (
        <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
          <thead>
            <tr><th>Carrier</th><th className="text-right">In force</th><th>Windows set</th><th>The biggest gap</th><th>Money</th><th>Files</th><th className="w-10"><span className="sr-only">Open</span></th></tr>
          </thead>
          <PagedBody>
            {shown.map((row) => (
              <LinkRow key={row.carrierId} href={carrierRulesHref(row.carrierId)}>
                <td><Link href={carrierRulesHref(row.carrierId)} className="font-semibold text-foreground hover:underline">{row.carrierName}</Link></td>
                <td className="text-right tabular-nums">{row.inForce.toLocaleString("en-US")}</td>
                <td>
                  <span className="inline-flex items-center gap-2">
                    <RuleDots dots={row.dots} />
                    <span className="text-muted-foreground tabular-nums">{RULE_TYPES.length - row.missing} of {RULE_TYPES.length}</span>
                  </span>
                </td>
                <td className="max-w-[300px] whitespace-normal">
                  {row.gap ? (
                    <span className="block leading-snug">
                      <span className="block font-medium text-[var(--error-ink)]">{row.gap.words}</span>
                      <span className="block text-xs text-muted-foreground">{row.gap.cost}</span>
                    </span>
                  ) : (
                    <span className="block leading-snug">
                      <span className="block text-foreground">Nothing missing</span>
                      {row.unverified > 0 && <span className="block text-xs text-muted-foreground">{row.unverified} unverified</span>}
                    </span>
                  )}
                </td>
                <td className="max-w-[160px] truncate text-muted-foreground" title={row.money}>{row.money}</td>
                <td className="max-w-[160px] truncate text-muted-foreground" title={row.files}>{row.files}</td>
                <RowChevron />
              </LinkRow>
            ))}
          </PagedBody>
        </table>
      )}
    </PagedTableCard>
  );
}
