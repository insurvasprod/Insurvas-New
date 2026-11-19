"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { PagedBody, PagedTableCard } from "@/components/ui/paged";
import { StatusChip } from "@/components/ui/status-chip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { useArrivals } from "@/components/ui/use-arrivals";
import { useDepartures } from "@/components/ui/use-row-exit";
import { payIssueState } from "@/components/app/commissions/pay-issues/pay-issues-list";
import { fileDay } from "@/lib/ingestion/constants";
import { daysSince, payIssueMoney as money, type PayIssue } from "@/lib/commissions/payIssueGroups";

export type GroupRow = PayIssue & { href: string; policyHref: string | null };

/**
 * A group's issues (round 7, 2·1), largest first: every policy links to its page, the whole row opens the issue. The
 * lag chips show only when some issue is still inside the carrier's pay lag (those stay off a letter by default).
 */
export function GroupRows({ rows, today, emptyTitle, emptyHint }: { rows: GroupRow[]; today: string; emptyTitle: string; emptyHint: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [query, setQuery] = useState("");
  const [lag, setLag] = useState<"" | "past" | "within">("");
  const needle = query.trim().toLowerCase();
  const within = rows.filter((r) => r.withinLag).length;
  // Tier 1 motion (2026-11-17): issues a letter from this group takes (or a decision on an issue's page) leave as the
  // refresh lands: each stays in place, plays out, then goes. Ones a refresh brings in arrive tinted.
  const left = useDepartures(rows, (row) => row.id);
  const isNew = useArrivals(rows.map((row) => row.id));
  const visible = useMemo(() => left.rows.filter((r) => (!needle || `${r.policyNumber ?? ""} ${r.clientName ?? ""}`.toLowerCase().includes(needle)) && (!lag || (lag === "within" ? r.withinLag : !r.withinLag))), [left.rows, needle, lag]);

  return (
    <PagedTableCard
      toolbar={
        <DataToolbar actions={<><span className="text-sm text-muted-foreground">Largest first</span><RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} /></>}>
          <ToolbarSearch value={query} onChange={setQuery} placeholder="Policy or client" />
          {within > 0 && (
            <span role="radiogroup" aria-label="Pay lag" className="inline-flex flex-wrap gap-2">
              <ToggleChip role="radio" selected={lag === "past"} count={rows.length - within} onClick={() => setLag(lag === "past" ? "" : "past")}>Past the pay lag</ToggleChip>
              <ToggleChip role="radio" selected={lag === "within"} count={within} onClick={() => setLag(lag === "within" ? "" : "within")}>Within the lag</ToggleChip>
            </span>
          )}
        </DataToolbar>
      }
      total={visible.length}
      noun={visible.length === 1 ? "issue" : "issues"}
      footer={visible.length ? <span className="text-sm text-muted-foreground">Every policy links to its page; the row opens the issue</span> : undefined}
    >
      {rows.length === 0 ? <EmptyState title={emptyTitle} hint={emptyHint} /> : visible.length === 0 ? <NoMatches noun="issues" by={lag ? "filters" : "search"} onClear={() => { setQuery(""); setLag(""); }} /> : (
        <table className="portal-lead-table w-full text-left text-sm">
          <thead>
            <tr>
              <th>Policy</th>
              <th>Client</th>
              <th>Issued</th>
              <th className="text-right">Expected</th>
              <th className="text-right">Paid</th>
              <th>Status</th>
            </tr>
          </thead>
          <PagedBody>
            {visible.map((row) => {
              const age = daysSince(row.foundAt, today);
              const chip = payIssueState(row);
              return (
                <tr key={row.id} {...left.rowProps(row.id)} data-row-new={isNew(row.id) ? "" : undefined} className="cursor-pointer" onClick={() => router.push(row.href)}>
                  <td className="whitespace-nowrap font-medium tabular-nums text-foreground">
                    <Link href={row.policyHref ?? row.href} className="hover:underline" onClick={(e) => e.stopPropagation()}>{row.policyNumber ?? "Whole account"}</Link>
                  </td>
                  <td className="whitespace-nowrap">{row.clientName ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="whitespace-nowrap tabular-nums text-muted-foreground">{fileDay(row.issuedOn)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{row.unpriced ? <span className="text-muted-foreground" title="No rate on the rate card">—</span> : money(row.expectedCents)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{money(row.paidCents)}</td>
                  <td><StatusChip tone={chip.tone} title={`Found ${fileDay(row.foundAt.slice(0, 10))}${age !== null ? `, ${age.toLocaleString("en-US")} ${age === 1 ? "day" : "days"} ago` : ""}`}>{chip.text}</StatusChip></td>
                </tr>
              );
            })}
          </PagedBody>
        </table>
      )}
    </PagedTableCard>
  );
}
