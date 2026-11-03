"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { Pager } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Callout } from "@/components/app/settings/primitives";
import { BlockedRow, ServedRow, humanize } from "@/components/app/activity-log-workspace";
import { PeriodPicker, lastDays, type Period } from "@/components/app/reports/period-picker";
import { ReportsSlot, useReportsTitle, useUrlTab } from "@/components/app/reports/reports-slot";
import { keepSharedPeriod } from "@/lib/reports/views";
import { mayReviewZeroClick, type ActivityReport } from "@/lib/activityLog/types";

/**
 * Reports › Team activity › an agent (foundation pass 2026-11-03, docs/reports/FOUNDATION-PASS.md). It was
 * a panel beside the Agents table; it is the agent's own page now: their name on the title line with one
 * line of facts, one figure strip, and two tabs — their calls (the log, newest first, paged on the
 * server) and how those calls ended (the disposition mix, LA-2.21). Read-only: opening it writes nothing.
 */
const TABS = ["calls", "outcomes"] as const;

function isoRange(period: Period) {
  const from = new Date(`${period.from}T00:00:00`);
  const to = new Date(`${period.to}T00:00:00`);
  to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function ActivityAgentDetail({ agentId, role, initialPeriod }: { agentId: string; role: string; initialPeriod: Period | null }) {
  const reviews = mayReviewZeroClick(role);
  const { tab, setTab, href: tabHref } = useUrlTab(TABS, "calls");
  const [period, setPeriod] = useState<Period>(() => initialPeriod ?? lastDays(30));
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(480, 41);
  const [report, setReport] = useState<ActivityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => { setDebounced(search.trim()); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useMemo(() => {
    const range = isoRange(period);
    const params = new URLSearchParams({ agent_id: agentId, from: range.from, to: range.to, page: String(page), page_size: String(pageSize) });
    if (debounced) params.set("q", debounced);
    return params.toString();
  }, [agentId, period, page, pageSize, debounced]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/app/activity?${query}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load this agent's activity");
      setReport(body as ActivityReport);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load this agent's activity");
    } finally {
      setLoading(false);
    }
  }, [query]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const row = report?.scorecard.find((item) => item.agent_user_id === agentId) ?? null;
  const name = row?.agent_name ?? (report ? "Agent" : null);
  const zeroClick = Number(row?.zero_click ?? 0);
  // "unlogged" counts served cards nobody logged: a fact of its own, not an outcome in the mix.
  const mix = useMemo(() => Object.entries(row?.disposition_breakdown ?? {}).filter(([key, value]) => value > 0 && key !== "unlogged").sort((a, b) => b[1] - a[1]), [row]);
  const unlogged = Number(row?.disposition_breakdown?.unlogged ?? 0);
  const mixTotal = mix.reduce((sum, [, value]) => sum + value, 0);
  const facts = row ? `${row.served.toLocaleString()} served · ${row.clicked.toLocaleString()} dialled · ${row.logged.toLocaleString()} logged · contact rate ${row.contact_rate_percent == null ? "—" : `${row.contact_rate_percent}%`}` : undefined;
  useReportsTitle(name, facts);

  const entries = useMemo(() => {
    const served = (report?.rows ?? []).map((item) => ({ kind: "served" as const, at: Date.parse(item.served_at), row: item }));
    const blocked = (report?.blocked ?? []).map((item) => ({ kind: "blocked" as const, at: Date.parse(item.at), row: item }));
    return [...served, ...blocked].sort((a, b) => b.at - a.at);
  }, [report]);

  const changePeriod = (next: Period) => { setPeriod(next); setPage(1); keepSharedPeriod(next); };
  const range = isoRange(period);
  const exportHref = `/api/app/activity?${new URLSearchParams({ agent_id: agentId, from: range.from, to: range.to, format: "csv" })}`;
  const logHref = `/app/activity?view=log&agent=${agentId}&from=${period.from}&to=${period.to}`;
  const toolbar = (
    <DataToolbar actions={<RefreshButton onClick={() => void load()} refreshing={loading} />}>
      {tab === "calls" && <ToolbarSearch value={search} onChange={setSearch} placeholder="Search leads" />}
      <PeriodPicker value={period} onChange={changePeriod} presets={["7", "30", "90"]} />
    </DataToolbar>
  );

  if (!report && error) return <TableCard><ErrorState title="This agent's activity did not load" detail={error} action={<Button variant="outline" onClick={() => void load()}>Try again</Button>} /></TableCard>;

  return (
    <>
      <ReportsSlot slot="lead"><ViewTabs label="Agent views" value={tab} onChange={setTab} idPrefix="agent-view" tabs={[{ key: "calls", label: "Calls", count: report?.total ?? null }, { key: "outcomes", label: "How the calls ended" }]} /></ReportsSlot>
      {/* At most two buttons (owner 2026-11-02): the flags to review, and the calls as a file. */}
      <ReportsSlot slot="corner">
        {reviews && zeroClick > 0 ? <Button asChild variant="outline"><Link href={`/app/activity?view=review&agent=${agentId}&from=${period.from}&to=${period.to}`}>Review {zeroClick.toLocaleString()} {zeroClick === 1 ? "flag" : "flags"}</Link></Button> : null}
        <Button asChild variant="outline"><a href={exportHref}><Download aria-hidden="true" />Export calls</a></Button>
      </ReportsSlot>
      {error && <Callout tone="error" title="Activity did not reload">{error}</Callout>}

      <StatStrip label={`${name ?? "Agent"} totals`}>
        <StatTile label="Served" value={row ? row.served.toLocaleString() : "…"} footnote={row ? `${Math.max(0, row.served - row.clicked).toLocaleString()} never dialled` : undefined} href={tabHref("calls")} />
        <StatTile label="Contact rate" value={row?.contact_rate_percent == null ? "—" : row.contact_rate_percent} unit={row?.contact_rate_percent == null ? undefined : "%"} footnote={row ? `${row.clicked.toLocaleString()} dialled` : undefined} href={tabHref("outcomes")} />
        {reviews && <StatTile label="Logged without a dial" value={row?.zero_click == null ? "—" : zeroClick.toLocaleString()} valueTone={zeroClick > 0 ? "danger" : undefined} footnote="outcomes with no Dial press" href={zeroClick > 0 ? `/app/activity?view=review&agent=${agentId}&from=${period.from}&to=${period.to}` : undefined} />}
        <StatTile label="Callbacks" value={row ? `${row.callbacks_booked} / ${row.callbacks_kept}` : "…"} footnote="booked / kept" />
        <StatTile label="Appointments" value={row ? `${row.appointments_booked} / ${row.appointments_showed}` : "…"} footnote="booked / showed" />
      </StatStrip>

      {tab === "calls" ? (
        <TableCard
          toolbar={toolbar}
          footer={<Pager page={page} total={report?.total ?? 0} pageSize={pageSize} noun="served leads" disabled={loading} onPage={setPage} suffix={<>newest first · <Link href={logHref} className="hover:underline">in the team&rsquo;s call log</Link></>} />}
        >
          {loading && !report ? <SectionLoading rows={6} columns={6} />
            : entries.length === 0 ? (debounced ? <NoMatches noun="served leads" onClear={() => setSearch("")} /> : <EmptyState title="No calls in this window" hint="Widen the period to see earlier calls." />)
            : (
              <table className="portal-activity-table w-full min-w-[940px] text-left text-sm">
                <thead><tr><th scope="col">Campaign</th><th scope="col">Disposition</th><th scope="col">Led to</th><th scope="col">Logged after</th><th scope="col">Lead</th><th scope="col">State</th><th scope="col" className="text-right">Served</th><th scope="col" className="text-right">Dialled</th><th scope="col" className="text-right">Attempt</th></tr></thead>
                <tbody className="m-seq">
                  {entries.map((entry) => entry.kind === "blocked" ? <BlockedRow key={`blocked-${entry.row.id}`} row={entry.row} showAgent={false} /> : <ServedRow key={entry.row.id} row={entry.row} showFlags={false} showAgent={false} />)}
                </tbody>
              </table>
            )}
        </TableCard>
      ) : (
        <TableCard toolbar={toolbar} footer={<span>{mixTotal.toLocaleString()} logged {mixTotal === 1 ? "outcome" : "outcomes"} in the window{unlogged ? ` · ${unlogged.toLocaleString()} served and never logged` : ""}</span>}>
          {loading && !report ? <SectionLoading rows={4} columns={3} />
            : mixTotal === 0 ? <EmptyState title="No outcomes logged in this window" hint="Outcomes show once this agent logs a call." />
            : (
              <table className="portal-lead-table w-full min-w-[560px] text-left text-sm">
                <thead><tr><th>Outcome</th><th className="text-right">Calls</th><th className="text-right">Of logged</th><th className="w-[40%]"><span className="sr-only">Share</span></th></tr></thead>
                <tbody>
                  {mix.map(([key, value]) => (
                    <tr key={key}>
                      <td className="font-semibold text-foreground">{humanize(key)}</td>
                      <td className="text-right tabular-nums">{value.toLocaleString()}</td>
                      <td className="text-right tabular-nums">{Math.round((value / mixTotal) * 100)}%</td>
                      {/* One token colour, as every bar in the app (§17: no gradients). */}
                      <td><span aria-hidden className="block h-1.5 overflow-hidden rounded-full bg-[var(--surface-alt)]"><span className="m-bar-x block h-full rounded-full bg-[var(--primary)]" style={{ width: `${(value / mixTotal) * 100}%` }} /></span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </TableCard>
      )}
    </>
  );
}
