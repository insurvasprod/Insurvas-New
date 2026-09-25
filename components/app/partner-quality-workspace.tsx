"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { CheckCircle2, ChevronDown, ChevronRight, CircleAlert, ExternalLink, Search, ShieldCheck, SlidersHorizontal, UserRound, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { cn } from "@/lib/utils";
import { sectionForPath } from "@/lib/menu/definition";
import type { PartnerQualityDispositionBreakdown, PartnerQualityLeadResult, PartnerQualityMember, PartnerQualityMetric, PartnerQualityReport, PartnerQualityRow, PartnerQualityTeamGroup } from "@/lib/partnerQuality/types";

type Filters = { from: string; to: string };
const PAGE_SIZE = 10;
type SortKey = "partner_name" | "sent" | "claimed" | "worked" | "submitted" | "conversion_rate" | "disqualification_rate" | "duplicate_rate";

// Product decision: reporting is fixed EST (UTC-5), not the reader's timezone and not a
// daylight-saving-aware New York clock. Keep this value aligned with the database functions.
const PARTNER_QUALITY_TIME_ZONE = "Etc/GMT+5";
function isoDate(date: Date) { return new Intl.DateTimeFormat("en-CA", { timeZone: PARTNER_QUALITY_TIME_ZONE }).format(date); }
function initialFilters(): Filters { const to = new Date(); const from = new Date(to); from.setDate(from.getDate() - 29); return { from: isoDate(from), to: isoDate(to) }; }
function query(filters: Filters) { const params = new URLSearchParams({ from: filters.from, to: filters.to }); return params.toString(); }
function percent(value: number | null) { return value == null ? "0.0%" : `${value.toFixed(1)}%`; }
function dateText(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${value}T00:00:00Z`)); }
function metricLabel(metric: PartnerQualityMetric) { return ({ sent: "Sent", claimed: "Claimed", worked: "Worked", submitted: "Submitted", disqualified: "Disqualified", tcpa: "TCPA blocked", dnc: "DNC flagged", invalid: "Invalid phone", duplicate: "Duplicate", disposition: "Disposition" })[metric]; }

function MetricButton({ row, metric, value, onClick }: { row: PartnerQualityRow; metric: PartnerQualityMetric; value: number; onClick: (metric: PartnerQualityMetric) => void }) {
  return <button type="button" className="rounded px-2 py-1 font-semibold tabular-nums underline-offset-4 hover:bg-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]" aria-label={`${row.partner_name}: ${metricLabel(metric)} ${value}; open leads`} onClick={() => onClick(metric)}>{value}</button>;
}

function TeamMetricButton({ member, metric, value, onClick }: { member: PartnerQualityMember; metric: PartnerQualityMetric; value: number; onClick: (member: PartnerQualityMember, metric: PartnerQualityMetric) => void }) {
  return <button type="button" className="portal-quality-team-metric" aria-label={`${member.name}: ${metricLabel(metric)} ${value}; open leads`} onClick={() => onClick(member, metric)}>{value}</button>;
}

function SortButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) { return <button type="button" className="font-semibold [letter-spacing:inherit] [text-transform:inherit] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]" onClick={onClick}>{label}{active ? " ↕" : ""}</button>; }

export function PartnerQualityWorkspace() {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [activeFilters, setActiveFilters] = useState<Filters>(initialFilters);
  const [data, setData] = useState<PartnerQualityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "sent", direction: "desc" });
  const [drilldown, setDrilldown] = useState<PartnerQualityLeadResult | null>(null);
  const [drilldownLabel, setDrilldownLabel] = useState("");
  const [drilldownLoading, setDrilldownLoading] = useState(false);
  const [drilldownError, setDrilldownError] = useState("");
  const [expandedAdmins, setExpandedAdmins] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  // Partners with no lead in the period are hidden by default: a row of zeros compares nothing.
  const [hideEmpty, setHideEmpty] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);

  const load = useCallback(async (next: Filters) => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/app/partner-quality?${query(next)}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) setError(body?.error ?? "Could not load partner quality"); else setData(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load partner quality");
    } finally {
      setLoading(false);
    }
  }, []);
  // The report is tenant-scoped on the server; this effect only hydrates the client view.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(activeFilters); }, [activeFilters, load]);

  const rows = useMemo(() => {
    if (!data) return [];
    return [...data.rows].sort((a, b) => {
      const left = a[sort.key]; const right = b[sort.key];
      const comparison = typeof left === "string" && typeof right === "string" ? left.localeCompare(right) : Number(left ?? 0) - Number(right ?? 0);
      return (sort.direction === "asc" ? comparison : -comparison) || a.partner_name.localeCompare(b.partner_name);
    });
  }, [data, sort]);

  function apply(event: React.FormEvent) { event.preventDefault(); setActiveFilters(filters); }
  function toggleSort(key: SortKey) { setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: key === "partner_name" ? "asc" : "desc" }); }

  async function openDrilldown(row: PartnerQualityRow, metric: PartnerQualityMetric, disposition?: string) {
    setDrilldown(null); setDrilldownError(""); setDrilldownLoading(true); setDrilldownLabel(`${row.partner_name} · ${metricLabel(metric)}${disposition ? ` · ${disposition}` : ""}`);
    try {
      const params = new URLSearchParams({ ...activeFilters, partner_id: row.partner_id, metric }); if (disposition) params.set("disposition", disposition);
      const response = await fetch(`/api/app/partner-quality/leads?${params.toString()}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) setDrilldownError(body?.error ?? "Could not load these leads"); else setDrilldown(body);
    } catch (reason) {
      setDrilldownError(reason instanceof Error ? reason.message : "Could not load these leads");
    } finally {
      setDrilldownLoading(false);
    }
  }

  async function openMemberDrilldown(member: PartnerQualityMember, metric: PartnerQualityMetric) {
    setDrilldown(null); setDrilldownError(""); setDrilldownLoading(true); setDrilldownLabel(`${member.name} · ${metricLabel(metric)}`);
    try {
      const params = new URLSearchParams({ ...activeFilters, partner_id: member.partner_id, partner_user_id: member.user_id, metric });
      const response = await fetch(`/api/app/partner-quality/leads?${params.toString()}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) setDrilldownError(body?.error ?? "Could not load these leads"); else setDrilldown(body);
    } catch (reason) {
      setDrilldownError(reason instanceof Error ? reason.message : "Could not load these leads");
    } finally {
      setDrilldownLoading(false);
    }
  }

  if (loading && !data) return <div className="portal-partner-quality-page"><Card><CardContent className="portal-quality-loading flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">Loading partner quality…</CardContent></Card></div>;
  if (error && !data) return <div className="portal-partner-quality-page"><Card><CardContent className="space-y-3 p-6"><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => void load(activeFilters)}>Try again</Button></CardContent></Card></div>;
  if (!data) return null;
  const dispositionMap = new Map(data.dispositions.map((entry) => [entry.partner_id, entry]));
  const total = data.summary;
  const screeningFlags = total.screening.tcpa + total.screening.dnc + total.screening.invalid;
  const screeningPassRate = total.sent ? ((total.sent - screeningFlags) / total.sent) * 100 : 0;
  const conversionRate = total.sent ? (total.submitted / total.sent) * 100 : 0;
  const previous = data.previous_summary;
  const previousFlags = previous.screening.tcpa + previous.screening.dnc + previous.screening.invalid;
  const previousPass = previous.sent ? ((previous.sent - previousFlags) / previous.sent) * 100 : null;
  const passDelta = previousPass == null || !total.sent ? null : screeningPassRate - previousPass;
  const withLeads = data.rows.filter((row) => row.sent > 0).length;
  const needle = search.trim().toLowerCase();
  const shown = rows.filter((row) => (!hideEmpty || row.sent > 0) && (!needle || row.partner_name.toLowerCase().includes(needle)));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const pageRows = shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const passOf = (row: PartnerQualityRow) => { const flags = row.screening.tcpa + row.screening.dnc + row.screening.invalid; return row.sent ? ((row.sent - flags) / row.sent) * 100 : null; };
  const sortLabel = sort.key === "sent" ? "most leads sent" : sort.key === "partner_name" ? "partner name" : sort.key.replaceAll("_", " ");
  const field = "h-10 rounded-lg border border-[var(--border-strong)] bg-card px-3 text-sm font-semibold text-foreground";
  const cell = "rounded px-1 font-normal tabular-nums text-[var(--body)]! underline-offset-4 hover:bg-transparent! hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]";

  return <div className="m-stagger portal-partner-quality-page flex flex-col gap-6">
    <PageHeader eyebrow={sectionForPath("/app/partner-quality") ?? undefined} title="Partner quality" description="Compare lead quality and conversion. This page never shows cost — that is True CPA." actions={<Button type="submit" form="quality-period" className="h-11 px-4" disabled={loading}>{loading ? "Applying…" : "Apply"}</Button>} />

    {/* One wrapper around the board's part of the page: the legacy .portal-partner-quality-page rules
        target its direct children (div.rounded-lg, div.grid) and would restyle these. */}
    <div className="flex flex-col gap-6">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile label="Leads sent" value={total.sent.toLocaleString()} footnote={`${dateText(data.from)} – ${dateText(data.to)}`} />
      <StatTile label="Screening pass rate" value={total.sent ? `${screeningPassRate.toFixed(1)}%` : "—"} valueTone={total.sent && screeningPassRate < 90 ? "warning" : undefined} footnote={passDelta == null ? `${screeningFlags.toLocaleString()} TCPA, DNC or invalid` : `${passDelta >= 0 ? "+" : "−"}${Math.abs(passDelta).toFixed(1)} pts vs the prior period`} />
      <StatTile label="Conversion to submitted" value={total.sent ? `${conversionRate.toFixed(1)}%` : "—"} footnote={`${total.submitted.toLocaleString()} of ${total.sent.toLocaleString()}`} />
      <StatTile label="Partners compared" value={withLeads.toLocaleString()} footnote={`of ${data.rows.length} configured`} />
    </div>

    <div className="flex flex-col gap-2.5">
      <form id="quality-period" onSubmit={(event) => { setPage(1); apply(event); }} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-[0_1px_2px_rgba(16,20,26,.05)]">
        <span className="inline-flex items-center gap-2">
          <input type="date" aria-label="From date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} className={field} />
          <span className="text-sm text-muted-foreground">–</span>
          <input type="date" aria-label="To date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} className={field} />
        </span>
        <span className="relative flex h-10 w-full items-center sm:w-[248px]">
          <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" aria-hidden="true" />
          <input type="search" aria-label="Search partners" placeholder="Search partners" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className="h-10 w-full rounded-lg border border-[var(--border-strong)] bg-card pl-9 pr-3 text-sm" />
        </span>
        <button type="button" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)} className={cn(field, "inline-flex items-center gap-2 px-3.5")}>
          <SlidersHorizontal className="size-4" aria-hidden="true" />Filters
          {hideEmpty && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--surface-alt)] px-1.5 text-xs font-semibold tabular-nums">1</span>}
        </button>
      </form>
      {filtersOpen && (
        <div className="rounded-lg border border-border bg-card p-4">
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={hideEmpty} onChange={(event) => { setHideEmpty(event.target.checked); setPage(1); }} className="size-4 accent-[var(--primary)]" />Only partners who sent a lead in this period</label>
        </div>
      )}
      <p className="text-xs text-muted-foreground">Leads received {dateText(data.from)} – {dateText(data.to)}, compared with {dateText(data.previous_from)} – {dateText(data.previous_to)}. Reporting calendar: fixed EST (UTC−5).</p>
    </div>
    {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

    <TableCard
      footer={<>
        <span>{shown.length === 0 ? "No partners" : `Showing ${(current - 1) * PAGE_SIZE + 1}–${Math.min(current * PAGE_SIZE, shown.length)} of ${shown.length} partners · ${sortLabel} first`}</span>
        <span className="flex gap-2">
          <Button type="button" variant="outline" size="sm" className="border-[var(--border-strong)] px-4" disabled={current <= 1} onClick={() => setPage(current - 1)}>Previous</Button>
          <Button type="button" variant="outline" size="sm" className="border-[var(--border-strong)] px-4" disabled={current >= pages} onClick={() => setPage(current + 1)}>Next</Button>
        </span>
      </>}
    >
      <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
        <thead>
          <tr>
            <th><SortButton label="Partner" active={sort.key === "partner_name"} onClick={() => toggleSort("partner_name")} /></th>
            <th className="w-[100px] text-right"><SortButton label="Sent" active={sort.key === "sent"} onClick={() => toggleSort("sent")} /></th>
            <th className="w-[100px] text-right"><SortButton label="Worked" active={sort.key === "worked"} onClick={() => toggleSort("worked")} /></th>
            <th className="w-[110px] text-right"><SortButton label="Submitted" active={sort.key === "submitted"} onClick={() => toggleSort("submitted")} /></th>
            <th className="w-[130px] text-right">Screening pass</th>
            <th className="w-[110px] text-right"><SortButton label="Duplicates" active={sort.key === "duplicate_rate"} onClick={() => toggleSort("duplicate_rate")} /></th>
            <th className="w-[120px] text-right"><SortButton label="Conversion" active={sort.key === "conversion_rate"} onClick={() => toggleSort("conversion_rate")} /></th>
          </tr>
        </thead>
        <tbody className="m-seq">
          {pageRows.map((row, index) => {
            const pass = passOf(row);
            return (
              <tr key={row.partner_id} className={cn("m-row", index === 0 && current === 1 && sort.key === "sent" && sort.direction === "desc" && row.sent > 0 && "bg-[var(--soft-orange-surface)]")}>
                <td><button type="button" className="text-left font-normal text-[var(--body)]! underline-offset-4 hover:bg-transparent! hover:underline" aria-label={`Open all leads sent by ${row.partner_name}`} onClick={() => void openDrilldown(row, "sent")}>{row.partner_name}</button></td>
                <td className="text-right"><button type="button" className={cell} aria-label={`${row.partner_name}: sent ${row.sent}; open leads`} onClick={() => void openDrilldown(row, "sent")}>{row.sent.toLocaleString()}</button></td>
                <td className="text-right"><button type="button" className={cell} aria-label={`${row.partner_name}: worked ${row.worked}; open leads`} onClick={() => void openDrilldown(row, "worked")}>{row.worked.toLocaleString()}</button></td>
                <td className="text-right"><button type="button" className={cell} aria-label={`${row.partner_name}: submitted ${row.submitted}; open leads`} onClick={() => void openDrilldown(row, "submitted")}>{row.submitted.toLocaleString()}</button></td>
                <td className="text-right tabular-nums" title={`${(row.screening.tcpa + row.screening.dnc + row.screening.invalid).toLocaleString()} of ${row.sent.toLocaleString()} flagged`}>{pass == null ? "—" : `${pass.toFixed(1)}%`}</td>
                <td className="text-right"><button type="button" className={cell} aria-label={`${row.partner_name}: duplicates ${row.duplicates}; open leads`} onClick={() => void openDrilldown(row, "duplicate")}>{row.duplicates.toLocaleString()}</button></td>
                <td className="text-right"><button type="button" className={cell} aria-label={`${row.partner_name}: conversion ${percent(row.conversion_rate)}, ${row.submitted} of ${row.sent}; open submitted leads`} onClick={() => void openDrilldown(row, "submitted")}>{row.sent ? percent(row.conversion_rate) : "—"}</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {shown.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">{data.rows.length === 0 ? "No partners are configured yet." : "No partner matches these filters."}</p>}
    </TableCard>

    <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
      <p className="font-semibold text-[var(--error-ink)]">No cost column will ever be added here</p>
      <p className="mt-1.5 text-[var(--body)]">This page exists so quality can be reviewed by roles that must not see spend. Cost data is not included yet; CPA and partner spend stay in the accounting workspace (True CPA). Every drilled number is a real button with a hover underline, and every conversion rate carries its denominator.</p>
    </div>
    </div>
    <PartnerTeamPerformance groups={data.team} expandedAdmins={expandedAdmins} onToggleAdmin={(userId) => setExpandedAdmins((current) => ({ ...current, [userId]: !current[userId] }))} onOpen={openMemberDrilldown} />
    <div className="grid gap-6 lg:grid-cols-2"><Card><CardHeader><CardTitle className="text-base">Screening quality</CardTitle><p className="text-sm text-muted-foreground">Counts are linked to the same lead period.</p></CardHeader><CardContent><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs uppercase text-muted-foreground"><th className="p-2">Partner</th><th className="p-2">TCPA</th><th className="p-2">DNC</th><th className="p-2">Invalid</th></tr></thead><tbody>{rows.map((row) => <tr key={row.partner_id} className="border-b"><td className="p-2 font-medium">{row.partner_name}</td><td className="p-2"><MetricButton row={row} metric="tcpa" value={row.screening.tcpa} onClick={(metric) => void openDrilldown(row, metric)} /><span className="ml-1 text-xs text-muted-foreground">{percent(row.sent ? (row.screening.tcpa / row.sent) * 100 : 0)}</span></td><td className="p-2"><MetricButton row={row} metric="dnc" value={row.screening.dnc} onClick={(metric) => void openDrilldown(row, metric)} /><span className="ml-1 text-xs text-muted-foreground">{percent(row.sent ? (row.screening.dnc / row.sent) * 100 : 0)}</span></td><td className="p-2"><MetricButton row={row} metric="invalid" value={row.screening.invalid} onClick={(metric) => void openDrilldown(row, metric)} /><span className="ml-1 text-xs text-muted-foreground">{percent(row.sent ? (row.screening.invalid / row.sent) * 100 : 0)}</span></td></tr>)}</tbody></table></div></CardContent></Card><DispositionCard rows={rows} breakdown={dispositionMap} onOpen={openDrilldown} /></div>
    {(drilldownLoading || drilldown || drilldownError) && <PartnerQualityDrawer label={drilldownLabel} data={drilldown} loading={drilldownLoading} error={drilldownError} onClose={() => { setDrilldown(null); setDrilldownError(""); }} />}
  </div>;
}

function PartnerTeamPerformance({ groups, expandedAdmins, onToggleAdmin, onOpen }: { groups: PartnerQualityTeamGroup[]; expandedAdmins: Record<string, boolean>; onToggleAdmin: (userId: string) => void; onOpen: (member: PartnerQualityMember, metric: PartnerQualityMetric) => void }) {
  return <Card className="portal-quality-team-card"><CardHeader><div className="flex flex-wrap items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2 text-base"><Users className="size-4" aria-hidden="true" />Publisher team performance</CardTitle><p className="mt-1 text-sm text-muted-foreground">Every partner admin and partner user in the publisher, with the leads they personally submitted.</p></div><Badge variant="outline">{groups.reduce((sum, group) => sum + group.admins.length + group.users.length + group.unassigned.length, 0)} people</Badge></div></CardHeader><CardContent className="p-0"><div className="portal-quality-team-table-wrap"><table className="portal-quality-team-table"><thead><tr><th>Member</th><th>Role</th><th>Belongs to</th><th>Sent</th><th>Claimed</th><th>Worked</th><th>Submitted</th><th>Conv %</th><th className="text-right">Review</th></tr></thead><tbody>{groups.map((group) => <Fragment key={group.partner_id}><tr className="portal-quality-team-publisher-row"><td colSpan={9}><span className="portal-quality-team-publisher-avatar">{group.partner_name.slice(0, 1).toUpperCase()}</span><strong>{group.partner_name}</strong><span>{group.admins.length} admin{group.admins.length === 1 ? "" : "s"} · {group.users.length + group.unassigned.length} users</span></td></tr>{group.admins.map((admin) => <Fragment key={admin.user_id}><TeamMemberRow member={admin} indent={false} onOpen={onOpen} onToggle={() => onToggleAdmin(admin.user_id)} expanded={expandedAdmins[admin.user_id] ?? true} childCount={group.users.filter((user) => user.partner_admin_user_id === admin.user_id).length} />{expandedAdmins[admin.user_id] !== false && group.users.filter((user) => user.partner_admin_user_id === admin.user_id).map((user) => <TeamMemberRow key={user.user_id} member={user} indent onOpen={onOpen} />)}</Fragment>)}{group.unassigned.map((user) => <TeamMemberRow key={user.user_id} member={user} indent onOpen={onOpen} unassigned />)}</Fragment>)}</tbody></table></div>{groups.length === 0 && <p className="p-5 text-sm text-muted-foreground">No partner users are assigned to this publisher.</p>}</CardContent></Card>;
}

function TeamMemberRow({ member, indent, unassigned = false, expanded, childCount, onToggle, onOpen }: { member: PartnerQualityMember; indent: boolean; unassigned?: boolean; expanded?: boolean; childCount?: number; onToggle?: () => void; onOpen: (member: PartnerQualityMember, metric: PartnerQualityMetric) => void }) {
  const isAdmin = member.role === "partner_admin";
  const belongsTo = isAdmin ? "Publisher admin" : unassigned ? "Unassigned" : member.partner_admin_name ?? "Unassigned";
  return <tr className={`portal-quality-team-member-row ${indent ? "is-child" : ""}`}><td><div className="portal-quality-team-member"><span className="portal-quality-team-member-avatar">{isAdmin ? <ShieldCheck className="size-3.5" aria-hidden="true" /> : <UserRound className="size-3.5" aria-hidden="true" />}</span><div><strong>{member.name}</strong><small>{member.email}</small></div></div></td><td><span className={`portal-quality-team-role ${isAdmin ? "is-admin" : ""}`}>{isAdmin ? "Partner admin" : "Partner user"}</span></td><td><span className={unassigned ? "portal-quality-team-unassigned" : ""}>{belongsTo}</span></td><td><TeamMetricButton member={member} metric="sent" value={member.sent} onClick={onOpen} /></td><td><TeamMetricButton member={member} metric="claimed" value={member.claimed} onClick={onOpen} /></td><td><TeamMetricButton member={member} metric="worked" value={member.worked} onClick={onOpen} /></td><td><TeamMetricButton member={member} metric="submitted" value={member.submitted} onClick={onOpen} /></td><td><button type="button" className="portal-quality-team-metric" aria-label={`${member.name}: conversion rate ${percent(member.conversion_rate)}; open submitted leads`} onClick={() => onOpen(member, "submitted")}>{percent(member.conversion_rate)}</button></td><td className="text-right"><div className="portal-quality-team-review-actions">{isAdmin && onToggle ? <button type="button" className="portal-quality-team-collapse" aria-expanded={expanded} onClick={onToggle}>{expanded ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronRight className="size-3.5" aria-hidden="true" />}<span>{expanded ? "Hide" : "Show"} users{childCount ? ` (${childCount})` : ""}</span></button> : null}<button type="button" className="portal-quality-review-button" onClick={() => onOpen(member, "sent")}>Review leads <ExternalLink className="size-3.5" aria-hidden="true" /></button></div></td></tr>;
}

function PartnerQualityDrawer({ label, data, loading, error, onClose }: { label: string; data: PartnerQualityLeadResult | null; loading: boolean; error: string; onClose: () => void }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);
  const drawer = <div className="portal-quality-drawer-shell" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="portal-quality-drawer" role="dialog" aria-modal="true" aria-labelledby="quality-drawer-title"><header className="portal-quality-drawer-header"><div><p className="portal-quality-eyebrow">PARTNER REVIEW</p><h2 id="quality-drawer-title">{label}</h2><p>{data ? `${data.total.toLocaleString()} lead${data.total === 1 ? "" : "s"} included in this count` : "Exact lead records behind this metric"}</p></div><button type="button" className="portal-quality-drawer-close" aria-label="Close partner lead review" onClick={onClose}><X className="size-5" /></button></header><div className="portal-quality-drawer-body">{loading && <div className="portal-quality-drawer-loading">Loading exact leads…</div>}{error && <div role="alert" className="portal-quality-drawer-error"><CircleAlert className="size-4" />{error}</div>}{data && !loading && <div className="portal-quality-lead-table-wrap"><table className="portal-quality-lead-table"><thead><tr><th>Received</th><th>Customer</th><th>State</th><th>Product</th><th>Disposition</th><th className="text-right">Open</th></tr></thead><tbody>{data.rows.map((lead) => <tr key={lead.lead_id}><td>{dateText(lead.date)}</td><td><strong>{lead.full_name}</strong><small>{lead.phone ?? "No phone"}</small></td><td>{lead.state ?? "—"}</td><td>{lead.product ?? "—"}</td><td><span className={`portal-quality-disposition ${lead.disposition ? "is-set" : ""}`}>{lead.disposition?.replaceAll("_", " ") ?? "Submitted"}</span></td><td className="text-right"><Link className="portal-quality-open-link" href={`/app/leads/${lead.lead_id}`}>Open <ExternalLink className="size-3.5" /></Link></td></tr>)}</tbody></table>{data.rows.length === 0 && <div className="portal-quality-drawer-empty"><CheckCircle2 className="size-5" />No leads match this metric in the selected period.</div>}</div>}</div><footer className="portal-quality-drawer-footer"><span>Every row links to the original lead workspace.</span><Button variant="outline" onClick={onClose}>Close</Button></footer></aside></div>;
  return typeof document === "undefined" ? null : createPortal(drawer, document.body);
}

function DispositionCard({ rows, breakdown, onOpen }: { rows: PartnerQualityRow[]; breakdown: Map<string, PartnerQualityDispositionBreakdown>; onOpen: (row: PartnerQualityRow, metric: PartnerQualityMetric, disposition?: string) => void }) {
  return <Card><CardHeader><CardTitle className="text-base">Disposition mix</CardTitle><p className="text-sm text-muted-foreground">Select a disposition to open the exact leads and compare it with worked volume.</p></CardHeader><CardContent className="space-y-4">{rows.map((row) => { const items = breakdown.get(row.partner_id)?.dispositions ?? []; return <div key={row.partner_id} className="portal-quality-disposition-group"><div className="portal-quality-disposition-heading"><span>{row.partner_name}</span><small>{row.worked.toLocaleString()} worked</small></div>{items.length ? <div className="portal-quality-disposition-list"><div className="portal-quality-disposition-list-header"><span>Disposition</span><span>Count</span><span>% of worked</span></div>{items.map((item) => <div className="portal-quality-disposition-row" key={item.key}><button type="button" onClick={() => onOpen(row, "disposition", item.key)}>{item.key.replaceAll("_", " ")}</button><strong>{item.count}</strong><span>{percent(row.worked ? (item.count / row.worked) * 100 : 0)}</span></div>)}</div> : <span className="text-sm text-muted-foreground">No dispositions yet</span>}</div>; })}{rows.length === 0 && <p className="text-sm text-muted-foreground">No partners are configured yet.</p>}</CardContent></Card>;
}
