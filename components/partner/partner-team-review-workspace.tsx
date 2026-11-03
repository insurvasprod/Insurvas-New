"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight, Download, FileCheck2, Hourglass, Lightbulb, Percent, Send, TriangleAlert } from "lucide-react";

import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { SelectMenu } from "@/components/ui/select-menu";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { DonutChart, LineSeries } from "@/components/ui/chart";
import { HomePanel } from "@/components/app/home/home-panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { activityLabel, dayMonth } from "@/lib/format/ago";
import { dayMonthYear, viewerTimeZone } from "@/lib/format/dates";
import { HELD_STATUSES } from "@/lib/partnerLeads/lanes";
import { WEEKDAY_SHORT, buildInsights, isSold, productBreakdown, weekdayCounts, whereLeadsAre } from "@/lib/partnerLeads/insights";
import { localDay, parseDay, shiftDay, spanDays, trendSeries } from "@/lib/partnerLeads/trend";
import type { PartnerLeadRow } from "@/lib/partnerLeads/types";
import { Sheet } from "@/components/ui/sheet";

type PartnerUser = { user_id: string; name: string; email: string; role: "partner_admin" | "partner_user"; status: "active" | "revoked"; accepted_at: string | null; last_login_at: string | null };
type MemberStats = { submitted: number; progress: number; applications: number; lastActivity: string };
type SelectedMember = { user: PartnerUser; stats: MemberStats };

// The team's leads load in an effect, so the viewer's zone is safe here.
function formatDate(value: string) { return dayMonthYear(value, viewerTimeZone()); }

/**
 * A teammate's leads, in the shared sheet (foundation v3): it owns the backdrop, Escape, the click
 * outside and focus, so this no longer listens for pointers itself.
 */
function SelectedTeammateDrawer({ selected, leads, onClose }: { selected: SelectedMember; leads: PartnerLeadRow[]; onClose: () => void }) {
  return <Sheet title={selected.user.name} subtitle={selected.user.role === "partner_admin" ? "Partner admin" : "Partner user"} onClose={onClose} closeLabel="Close teammate details" bodyClassName="portal-team-review-sheet flex flex-col gap-4 p-4">
    <dl><div><dt>Leads this period</dt><dd>{selected.stats.submitted}</dd></div><div><dt>Application rate</dt><dd>{selected.stats.submitted ? `${((selected.stats.applications / selected.stats.submitted) * 100).toFixed(1)}%` : "—"}</dd></div><div><dt>In progress</dt><dd>{selected.stats.progress}</dd></div></dl>
    <div className="portal-team-review-detail-leads"><div className="portal-team-review-detail-leads-heading"><strong>Submitted leads</strong><span>{leads.length} total</span></div>{leads.length ? leads.map((lead) => <article className="portal-team-review-detail-lead" key={lead.id}><div className="portal-team-review-detail-lead-heading"><div><strong>{lead.customer}</strong><span>{lead.product}</span></div><StatusChip>{lead.stageName || lead.status || "Submitted"}</StatusChip></div><dl><div><dt>Outcome</dt><dd>{lead.outcome ?? lead.disposition ?? "Awaiting update"}</dd></div><div><dt>Submitted</dt><dd>{formatDate(lead.submittedAt)}</dd></div><div><dt>Last update</dt><dd>{formatDate(lead.updatedAt)}</dd></div></dl></article>) : <p className="portal-team-review-detail-empty">No leads submitted in this period.</p>}</div>
    <Link href={`/partner/pipeline?closer_id=${selected.user.user_id}`} className="portal-team-review-detail-link">View partner pipeline <ArrowRight className="size-4" aria-hidden="true" /></Link>
  </Sheet>;
}

/** Below this many leads a member's conversion rate is noise, and showing it would rank people on it. */
const MIN_CONVERSION_SAMPLE = 10;

function isOpen(row: PartnerLeadRow) {
  return row.status === "unclaimed" || (HELD_STATUSES as readonly string[]).includes(row.status);
}
function figures(rows: PartnerLeadRow[]) {
  const applications = rows.filter(isSold).length;
  return { submitted: rows.length, progress: rows.filter(isOpen).length, applications, conversion: rows.length ? (applications / rows.length) * 100 : null };
}
/** The change next to a figure: a percent against the period before. Nothing to compare against is no change shown, not a rise from nothing. */
function change(current: number, previous: number | null | undefined, good: "up" | "down" | "neither" = "up") {
  if (previous === null || previous === undefined || previous === 0) return undefined;
  return { value: Math.round(((current - previous) / previous) * 100), good };
}

/** "30 in the previous 30 days"; a previous period with nothing in it says so. */
function beforeNote(previous: number, days: number, noun: string) {
  return previous === 0 ? `None in the previous ${days} days` : `${previous} ${noun} in the previous ${days} days`;
}
function rangeLabel(from: string, to: string, now: Date) {
  const start = parseDay(from);
  const end = parseDay(to);
  const sameYear = start.getFullYear() === end.getFullYear();
  return `${dayMonth(start, sameYear ? end : now)} – ${dayMonth(end, new Date(end.getFullYear() + 1, 0, 1))}`;
}

type Figures = ReturnType<typeof figures>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/**
 * `?from=&to=` — so a chart elsewhere can link here showing the window it was drawn over, instead
 * of landing the reader on a different thirty days and letting them wonder why the numbers moved.
 * Read from the address bar rather than `useSearchParams`, which would need a Suspense boundary
 * around a board that is already client-side; anything malformed falls back to the default.
 */
function rangeFromUrl(): { from: string; to: string } | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  return DAY.test(from) && DAY.test(to) && from <= to && spanDays(from, to) <= 366 ? { from, to } : null;
}

/**
 * What `/design/organization` hands the board instead of four endpoints. The partner's own page
 * never passes it; with it set the board reads nothing (lib/partnerLeads/fixtures.ts).
 */
export type PartnerTeamReviewSample = { rows: PartnerLeadRow[]; previousRows: PartnerLeadRow[]; users: PartnerUser[] };

export function PartnerTeamReviewWorkspace({ partnerName, sample }: { partnerName: string; sample?: PartnerTeamReviewSample }) {
  const sampled = Boolean(sample);
  // The board's default: the last 30 days, ending today, in the viewer's own calendar.
  const [asked] = useState(rangeFromUrl);
  const [initialTo] = useState(() => asked?.to ?? localDay(new Date())!);
  const initialFrom = asked?.from ?? shiftDay(initialTo, -29);
  const [draftFrom, setDraftFrom] = useState(initialFrom);
  const [draftTo, setDraftTo] = useState(initialTo);
  const [range, setRange] = useState({ from: initialFrom, to: initialTo });
  const [users, setUsers] = useState<PartnerUser[]>(sample?.users ?? []);
  const [rows, setRows] = useState<PartnerLeadRow[]>(sample?.rows ?? []);
  const [previous, setPrevious] = useState<Figures | null>(sample ? figures(sample.previousRows) : null);
  const [loading, setLoading] = useState(!sample);
  // The first read draws the page skeleton; a new range keeps the page and its date controls.
  const [loaded, setLoaded] = useState(sampled);
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(480, 45);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [custom, setCustom] = useState(false);
  const [now] = useState(() => Date.now());
  const days = spanDays(range.from, range.to);

  useEffect(() => {
    if (sampled) return;
    let cancelled = false;
    const leads = (from: string, to: string) => fetch(`/api/partner/leads/pipeline?${new URLSearchParams({ limit: "5000", date_from: from, date_to: to })}`, { cache: "no-store", signal: AbortSignal.timeout(15000) });
    const previousTo = shiftDay(range.from, -1);
    const previousFrom = shiftDay(previousTo, -(days - 1));
    void Promise.all([
      leads(range.from, range.to),
      leads(previousFrom, previousTo),
      fetch("/api/partner/users", { cache: "no-store", signal: AbortSignal.timeout(15000) }),
    ]).then(async ([currentResponse, previousResponse, usersResponse]) => {
      const [current, before, members] = await Promise.all([currentResponse, previousResponse, usersResponse].map((response) => response.json().catch(() => null)));
      if (cancelled) return;
      if (!currentResponse.ok || !usersResponse.ok) { setError(current?.error ?? members?.error ?? "Could not load team review"); return; }
      setRows(Array.isArray(current?.rows) ? current.rows : []);
      setPrevious(previousResponse.ok && Array.isArray(before?.rows) ? figures(before.rows) : null);
      setUsers(Array.isArray(members?.users) ? members.users : []);
      setError(null);
    }).catch(() => { if (!cancelled) setError("Could not load team review. Check your connection and try again."); }).finally(() => { if (!cancelled) { setLoading(false); setLoaded(true); } });
    return () => { cancelled = true; };
  }, [range, days, retryToken, sampled]);

  const metrics = useMemo(() => figures(rows), [rows]);
  const memberStats = useMemo(() => {
    const map = new Map<string, MemberStats>();
    for (const row of rows) {
      const id = row.submittedBy.id ?? row.submittedBy.name;
      const current = map.get(id) ?? { submitted: 0, progress: 0, applications: 0, lastActivity: row.updatedAt };
      current.submitted += 1;
      if (isOpen(row)) current.progress += 1;
      if (isSold(row)) current.applications += 1;
      if (row.updatedAt > current.lastActivity) current.lastActivity = row.updatedAt;
      map.set(id, current);
    }
    return users.map((user) => ({ user, stats: map.get(user.user_id) ?? { submitted: 0, progress: 0, applications: 0, lastActivity: "" } }));
  }, [rows, users]);
  // One series, from the helper the Overview draws too (lib/partnerLeads/trend.ts): the two pages
  // must not disagree about a week a partner can see on both.
  const trend = useMemo(
    () => trendSeries(rows.map((row) => row.submittedAt), { from: range.from, to: range.to, now }),
    [rows, range.from, range.to, now],
  );

  // The small line in each tile: the same day (or week) buckets as the trend, one series per figure.
  const kpiSeries = useMemo(() => {
    const bucketCounts = (predicate: (row: PartnerLeadRow) => boolean) =>
      trendSeries(rows.filter(predicate).map((row) => row.submittedAt), { from: range.from, to: range.to, now }).buckets.map((bucket) => bucket.count);
    const submitted = bucketCounts(() => true);
    const progress = bucketCounts(isOpen);
    const applications = bucketCounts(isSold);
    let leadsSoFar = 0;
    let soldSoFar = 0;
    const conversion = submitted.map((count, index) => {
      leadsSoFar += count;
      soldSoFar += applications[index] ?? 0;
      return leadsSoFar ? (soldSoFar / leadsSoFar) * 100 : 0;
    });
    return { submitted, progress, applications, conversion };
  }, [rows, range.from, range.to, now]);

  const selected = memberStats.find((item) => item.user.user_id === selectedUserId) ?? null;
  const selectedLeads = useMemo(() => !selected ? [] : rows.filter((row) => { const submitterId = row.submittedBy.id ?? row.submittedBy.name; return submitterId === selected.user.user_id || row.submittedBy.name === selected.user.name; }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [rows, selected]);
  const rangeInvalid = !draftFrom || !draftTo || draftTo < draftFrom || spanDays(draftFrom, draftTo) > 366;
  function toggleDetail(userId: string) { if (detailOpen && selected?.user.user_id === userId) { setDetailOpen(false); setSelectedUserId(null); } else { setSelectedUserId(userId); setDetailOpen(true); } }
  function apply(event: FormEvent) {
    event.preventDefault();
    if (rangeInvalid || (draftFrom === range.from && draftTo === range.to)) return;
    setLoading(true);
    setRange({ from: draftFrom, to: draftTo });
  }

  const reload = () => { setError(null); setLoading(true); setRetryToken((value) => value + 1); };
  const visible = paginate(memberStats, page, pageSize);
  const insights = useMemo(() => buildInsights(rows, now), [rows, now]);
  const products = useMemo(() => productBreakdown(rows), [rows]);
  const weekdays = useMemo(() => weekdayCounts(rows), [rows]);
  const where = useMemo(() => whereLeadsAre(rows), [rows]);
  const today = localDay(new Date(now))!;
  const presetDays = [7, 30, 90].find((preset) => range.to === today && days === preset);
  const customRange = custom || presetDays === undefined;
  function choosePeriod(value: string) {
    if (value === "custom") { setCustom(true); return; }
    const count = Number(value);
    setCustom(false);
    const from = shiftDay(today, -(count - 1));
    setDraftFrom(from);
    setDraftTo(today);
    if (from === range.from && today === range.to) return;
    setLoading(true);
    setRange({ from, to: today });
  }
  const conversionNow = metrics.conversion;
  const conversionPrev = previous?.conversion ?? null;

  if (!loaded) return <PageLoading />;

  return <div className="m-stagger flex min-h-0 w-full flex-1 flex-col gap-6">
    <PageHeader
      title="Team performance"
      description="Review submitted leads and member performance."
      hideTitle
      breadcrumbs={[{ label: "Organization" }, { label: "Team Performance" }]}
      actions={<form className="flex flex-wrap items-center gap-2" onSubmit={apply}>
        <SelectMenu
          label="Period"
          value={customRange ? "custom" : String(presetDays)}
          onChange={choosePeriod}
          className="w-40"
          panelClassName="w-48"
          panelAlign="end"
          options={[
            { value: "7", label: "Last 7 days" },
            { value: "30", label: "Last 30 days" },
            { value: "90", label: "Last 90 days" },
            { value: "custom", label: "Custom range" },
          ]}
        />
        {customRange && <>
          <input type="date" aria-label="Review start date" className={toolbarControl} value={draftFrom} max={draftTo || undefined} onChange={(event) => setDraftFrom(event.target.value)} />
          <span className="text-sm text-muted-foreground" aria-hidden="true">–</span>
          <input type="date" aria-label="Review end date" className={toolbarControl} value={draftTo} min={draftFrom || undefined} onChange={(event) => setDraftTo(event.target.value)} />
          <Button type="submit" variant="secondary" size="sm" disabled={rangeInvalid || (draftFrom === range.from && draftTo === range.to)}>Apply</Button>
        </>}
        <RefreshButton onClick={reload} refreshing={loading} labelClassName="sr-only" className="px-2.5" />
        <Button variant="outline" size="icon" asChild title="Export report"><a href={`/api/partner/leads/export?${new URLSearchParams({ limit: "5000", date_from: range.from, date_to: range.to })}`} aria-label="Export report"><Download aria-hidden="true" /></a></Button>
      </form>}
    />
    {rangeInvalid && <p role="alert" className="rounded-md border border-[var(--error)] bg-[var(--error-surface)] px-4 py-2.5 text-sm text-[var(--error-ink)]">Choose an end date on or after the start date, within a year.</p>}
    {error && <p role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--error)] bg-[var(--error-surface)] px-4 py-2 text-sm text-[var(--error-ink)]">Team performance could not be loaded: {error}<Button type="button" variant="outline" size="sm" onClick={reload}>Try again</Button></p>}

    <KpiRow label={`${partnerName} team review, ${rangeLabel(range.from, range.to, new Date(now))}`}>
      <KpiTile
        icon={Send}
        label="Leads submitted"
        value={loading ? "—" : metrics.submitted}
        series={loading ? undefined : kpiSeries.submitted}
        change={loading ? undefined : change(metrics.submitted, previous?.submitted)}
        note={loading || !previous ? undefined : beforeNote(previous.submitted, days, "leads")}
      />
      <KpiTile
        icon={Hourglass}
        label="In progress"
        value={loading ? "—" : metrics.progress}
        series={loading ? undefined : kpiSeries.progress}
        change={loading ? undefined : change(metrics.progress, previous?.progress, "neither")}
        note={loading || !previous ? undefined : beforeNote(previous.progress, days, "leads")}
      />
      <KpiTile
        icon={FileCheck2}
        label="Applications"
        value={loading ? "—" : metrics.applications}
        series={loading ? undefined : kpiSeries.applications}
        change={loading ? undefined : change(metrics.applications, previous?.applications)}
        note={loading || !previous ? undefined : beforeNote(previous.applications, days, "applications")}
      />
      <KpiTile
        icon={Percent}
        label="Conversion"
        value={loading || conversionNow === null ? "—" : `${conversionNow.toFixed(1)}%`}
        series={loading ? undefined : kpiSeries.conversion}
        change={loading || metrics.submitted < MIN_CONVERSION_SAMPLE || !previous || previous.submitted < MIN_CONVERSION_SAMPLE ? undefined : change(conversionNow ?? 0, conversionPrev)}
        note={loading ? undefined : metrics.submitted === 0 ? "No leads yet" : metrics.submitted < MIN_CONVERSION_SAMPLE ? `${metrics.applications} of ${metrics.submitted} leads: too few for a trend` : `${metrics.applications} of ${metrics.submitted} leads became applications`}
      />
    </KpiRow>

    <div className="grid min-h-[19rem] grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(16rem,1fr)]">
      <HomePanel title="Submission trend" period={`leads per ${trend.step === 1 ? "day" : "week"}`} className="min-h-[19rem]">
        {loading ? <SectionLoading rows={4} columns={1} label="Loading trend" />
          : !trend.buckets.length ? <p className="m-auto text-sm text-muted-foreground">Choose a range to see the trend.</p>
          : <LineSeries
              points={trend.buckets.map((bucket) => ({ key: bucket.key, label: bucket.label, value: bucket.count }))}
              summary={`${metrics.submitted} leads submitted between ${rangeLabel(range.from, range.to, new Date(now))}`}
              unit="leads"
              className="flex-1"
              minHeight={180}
            />}
      </HomePanel>
      <HomePanel title="Lead status" link={{ label: "Pipeline", href: "/partner/pipeline" }} className="min-h-[19rem]">
        {loading ? <SectionLoading rows={4} columns={1} label="Loading" />
          : !rows.length ? <p className="m-auto text-sm text-muted-foreground">Nothing submitted in this period.</p>
          : <DonutChart
              className="flex-1 justify-center"
              centerValue={String(rows.length)}
              centerLabel="leads"
              summary={`Where ${rows.length} leads are now`}
              unit="leads"
              segments={[
                { key: "waiting", label: "Waiting for an agent", value: where.waiting, tone: "warning" },
                { key: "progress", label: "With a closer", value: where.inProgress, tone: "strong" },
                { key: "closed", label: "Closed without a sale", value: where.closed, tone: "quiet" },
                { key: "apps", label: "Became applications", value: where.applications, tone: "success" },
              ]}
            />}
      </HomePanel>
    </div>

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <HomePanel title="By product" period="share of leads" className="min-h-[19rem]">
        {loading ? <SectionLoading rows={3} columns={1} label="Loading products" />
          : !products.length ? <p className="m-auto text-sm text-muted-foreground">Products show once leads arrive.</p>
          : <DonutChart
              className="flex-1 justify-center"
              centerValue={String(rows.length)}
              centerLabel="leads"
              summary={`Leads by product: ${products.map((line) => `${line.product} ${line.leads}`).join(", ")}`}
              unit="leads"
              segments={products.slice(0, 5).map((line, index) => ({ key: line.product, label: line.product, value: line.leads, tone: (["strong", "mid", "soft", "faint", "quiet"] as const)[index], detail: line.conversion === null ? undefined : `${line.conversion.toFixed(0)}% convert` }))}
            />}
      </HomePanel>
      <HomePanel title="Leads by weekday" period="when they arrive" className="min-h-[19rem]">
        {loading ? <SectionLoading rows={3} columns={1} label="Loading weekdays" />
          : !rows.length ? <p className="m-auto text-sm text-muted-foreground">Weekday pattern shows once leads arrive.</p>
          : <LineSeries
              points={WEEKDAY_SHORT.map((label, index) => ({ key: label, label, value: weekdays[index] }))}
              summary={`Leads by weekday: ${WEEKDAY_SHORT.map((label, index) => `${label} ${weekdays[index]}`).join(", ")}`}
              unit="leads"
              labels="all"
              className="flex-1"
              minHeight={160}
            />}
      </HomePanel>
      <HomePanel title="Needs your attention" period={rangeLabel(range.from, range.to, new Date(now))} className="min-h-[19rem]">
        {loading ? <SectionLoading rows={3} columns={1} label="Reading your leads" />
          : !insights.length ? <p className="m-0 py-1 text-sm text-muted-foreground">{rows.length ? "All clear: nothing is waiting on you in this period." : "No leads in this period yet. Insights appear as soon as your team submits."}</p>
          : <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
            {insights.map((insight) => <li key={insight.key} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
              <div className="flex items-start gap-2.5">
                {insight.tone === "info"
                  ? <Lightbulb className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  : <TriangleAlert className={`mt-0.5 size-4 shrink-0 ${insight.tone === "action" ? "text-[var(--error-ink)]" : "text-[var(--warning-ink)]"}`} aria-hidden="true" />}
                <span className="min-w-0 flex-1 text-sm leading-normal text-foreground">{insight.text}</span>
              </div>
              {insight.href && <Link href={insight.href} className="inline-flex items-center gap-0.5 self-start pl-[1.625rem] text-sm font-semibold text-[var(--accent-ink)] hover:underline">{insight.hrefLabel}<ChevronRight className="size-4" aria-hidden="true" /></Link>}
            </li>)}
          </ul>}
      </HomePanel>
    </div>

    <TableCard
        className="flex min-h-[18rem] flex-1 flex-col"
        bodyClassName="flex min-h-0 flex-1 flex-col"
        title="Members"
        action={<Button asChild variant="ghost" size="sm"><Link href="/partner/team">Manage access<ChevronRight aria-hidden="true" /></Link></Button>}
        footer={!loading && memberStats.length > pageSize ? <Pager page={visible.current} total={memberStats.length} noun="members" pageSize={pageSize} onPage={setPage} /> : undefined}
      >
        {loading ? <SectionLoading rows={5} columns={6} />
          : !memberStats.length ? <div className="flex min-h-48 flex-1 items-center justify-center"><EmptyState title="No partner users yet" hint="Invite teammates from Team access." /></div>
          : <Table>
            <TableHeader><TableRow>
              <TableHead>Member</TableHead>
              <TableHead className="w-[110px] text-right">Submitted</TableHead>
              <TableHead className="w-[110px] text-right">In progress</TableHead>
              <TableHead className="w-[120px] text-right">Applications</TableHead>
              <TableHead className="w-[110px] text-right">Conversion</TableHead>
              <TableHead className="w-[140px]">Last activity</TableHead>
              <TableHead className="w-[70px] text-right"><span className="sr-only">Details</span></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {visible.rows.map(({ user, stats }) => {
                const isSelected = detailOpen && selected?.user.user_id === user.user_id;
                return <TableRow key={user.user_id} data-state={isSelected ? "selected" : undefined}>
                  <TableCell><strong className="font-semibold text-foreground">{user.name}</strong>{user.status !== "active" && <span className="block text-xs text-muted-foreground">Deactivated</span>}</TableCell>
                  <TableCell className="text-right tabular-nums">{stats.submitted}</TableCell>
                  <TableCell className="text-right tabular-nums">{stats.progress}</TableCell>
                  <TableCell className="text-right tabular-nums">{stats.applications}</TableCell>
                  <TableCell className="text-right tabular-nums" title={stats.submitted && stats.submitted < MIN_CONVERSION_SAMPLE ? `${stats.applications} of ${stats.submitted} — too few leads for a rate` : undefined}>{stats.submitted >= MIN_CONVERSION_SAMPLE ? `${((stats.applications / stats.submitted) * 100).toFixed(1)}%` : "—"}</TableCell>
                  <TableCell>{user.last_login_at ? activityLabel(Date.parse(user.last_login_at), now) : "Never"}</TableCell>
                  <TableCell className="text-right"><Button type="button" variant="ghost" size="icon" title={isSelected ? "Close" : "View leads"} aria-label={isSelected ? `Close ${user.name}` : `View leads from ${user.name}`} aria-expanded={isSelected} onClick={() => toggleDetail(user.user_id)}><ArrowRight aria-hidden="true" /></Button></TableCell>
                </TableRow>;
              })}
            </TableBody>
          </Table>}
      </TableCard>
    {detailOpen && selected && <SelectedTeammateDrawer selected={selected} leads={selectedLeads} onClose={() => { setDetailOpen(false); setSelectedUserId(null); }} />}
  </div>;
}
