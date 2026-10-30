"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, Download, FileCheck2, Hourglass, Percent, Send, Timer, Users } from "lucide-react";

import { StatusChip } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { BarSeries } from "@/components/ui/chart";
import { HomePanel } from "@/components/app/home/home-panel";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { activityLabel, dayMonth } from "@/lib/format/ago";
import { dayMonthYear, viewerTimeZone } from "@/lib/format/dates";
import { HELD_STATUSES, SALE_DISPOSITIONS } from "@/lib/partnerLeads/lanes";
import { localDay, parseDay, shiftDay, spanDays, trendSeries } from "@/lib/partnerLeads/trend";
import type { PartnerLeadRow } from "@/lib/partnerLeads/types";
import { durationLabel } from "@/lib/partnerTeamReview/pulse";
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

function isSold(row: PartnerLeadRow) {
  return row.status === "completed" && row.disposition !== null && (SALE_DISPOSITIONS as readonly string[]).includes(row.disposition);
}
function isOpen(row: PartnerLeadRow) {
  return row.status === "unclaimed" || (HELD_STATUSES as readonly string[]).includes(row.status);
}
function figures(rows: PartnerLeadRow[]) {
  const applications = rows.filter(isSold).length;
  return { submitted: rows.length, progress: rows.filter(isOpen).length, applications, conversion: rows.length ? (applications / rows.length) * 100 : null };
}
/** The change pill's number. Nothing to compare against is no pill, not a rise from nothing. */
function delta(current: number, previous: number | null | undefined) {
  if (previous === null || previous === undefined || previous === 0) return undefined;
  return { value: Math.round(((current - previous) / previous) * 100), goodWhen: "up" as const };
}

/** "+14% vs previous 30 days"; a previous period with nothing in it has no percentage to compare to. */
function changeLabel(current: number, previous: number, days: number) {
  if (previous === 0) return current === 0 ? `none in the previous ${days} days either` : `none in the previous ${days} days`;
  const change = Math.round(((current - previous) / previous) * 100);
  return `${change > 0 ? "+" : change < 0 ? "−" : "±"}${Math.abs(change)}% vs previous ${days} days`;
}
function rangeLabel(from: string, to: string, now: Date) {
  const start = parseDay(from);
  const end = parseDay(to);
  const sameYear = start.getFullYear() === end.getFullYear();
  return `${dayMonth(start, sameYear ? end : now)} – ${dayMonth(end, new Date(end.getFullYear() + 1, 0, 1))}`;
}

type Figures = ReturnType<typeof figures>;
type Pulse = { averageResponseMinutes: number | null; responses: number; pendingFollowUps: number };

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
export type PartnerTeamReviewSample = { rows: PartnerLeadRow[]; previousRows: PartnerLeadRow[]; users: PartnerUser[]; pulse: Pulse | null };

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
  const [pulse, setPulse] = useState<Pulse | null>(sample?.pulse ?? null);
  const [loading, setLoading] = useState(!sample);
  // The first read draws the page skeleton; a new range keeps the page and its date controls.
  const [loaded, setLoaded] = useState(sampled);
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(480, 45);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
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
      fetch(`/api/partner/team-review/pulse?${new URLSearchParams({ from: range.from, to: range.to })}`, { cache: "no-store", signal: AbortSignal.timeout(15000) }),
    ]).then(async ([currentResponse, previousResponse, usersResponse, pulseResponse]) => {
      const [current, before, members, pulseBody] = await Promise.all([currentResponse, previousResponse, usersResponse, pulseResponse].map((response) => response.json().catch(() => null)));
      if (cancelled) return;
      if (!currentResponse.ok || !usersResponse.ok) { setError(current?.error ?? members?.error ?? "Could not load team review"); return; }
      setRows(Array.isArray(current?.rows) ? current.rows : []);
      setPrevious(previousResponse.ok && Array.isArray(before?.rows) ? figures(before.rows) : null);
      setUsers(Array.isArray(members?.users) ? members.users : []);
      // The pulse is a side card: if it fails, the page still stands and the card says so.
      setPulse(pulseResponse.ok && pulseBody ? pulseBody as Pulse : null);
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

  const selected = memberStats.find((item) => item.user.user_id === selectedUserId) ?? null;
  const selectedLeads = useMemo(() => !selected ? [] : rows.filter((row) => { const submitterId = row.submittedBy.id ?? row.submittedBy.name; return submitterId === selected.user.user_id || row.submittedBy.name === selected.user.name; }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [rows, selected]);
  const members = users.filter((user) => user.status === "active" && user.accepted_at);
  const activeInPeriod = members.filter((user) => (memberStats.find((item) => item.user.user_id === user.user_id)?.stats.submitted ?? 0) > 0).length;
  const invitesOutstanding = users.filter((user) => user.status === "active" && !user.accepted_at).length;
  const rangeInvalid = !draftFrom || !draftTo || draftTo < draftFrom || spanDays(draftFrom, draftTo) > 366;
  function toggleDetail(userId: string) { if (detailOpen && selected?.user.user_id === userId) { setDetailOpen(false); setSelectedUserId(null); } else { setSelectedUserId(userId); setDetailOpen(true); } }
  function apply(event: FormEvent) {
    event.preventDefault();
    if (rangeInvalid || (draftFrom === range.from && draftTo === range.to)) return;
    setLoading(true);
    setRange({ from: draftFrom, to: draftTo });
  }

  const conversionChange = metrics.conversion !== null && previous?.conversion !== null && previous?.conversion !== undefined ? metrics.conversion - previous.conversion : null;
  const reload = () => { setError(null); setLoading(true); setRetryToken((value) => value + 1); };
  const visible = paginate(memberStats, page, pageSize);

  if (!loaded) return <PageLoading />;

  return <div className="m-stagger space-y-6">
    <PageHeader
      title="Team review"
      description="Review submitted leads and member performance."
      visible
      infoDescription
      actions={<form className="flex flex-wrap items-center gap-2" onSubmit={apply}>
        <input type="date" aria-label="Review start date" className={toolbarControl} value={draftFrom} max={draftTo || undefined} onChange={(event) => setDraftFrom(event.target.value)} />
        <span className="text-sm text-muted-foreground" aria-hidden="true">–</span>
        <input type="date" aria-label="Review end date" className={toolbarControl} value={draftTo} min={draftFrom || undefined} onChange={(event) => setDraftTo(event.target.value)} />
        <Button type="submit" variant="outline" disabled={rangeInvalid || (draftFrom === range.from && draftTo === range.to)}>Apply</Button>
        <Button variant="outline" asChild><a href={`/api/partner/leads/export?${new URLSearchParams({ limit: "5000", date_from: range.from, date_to: range.to })}`}><Download aria-hidden="true" />Export report</a></Button>
      </form>}
    />
    {rangeInvalid && <p role="alert" className="rounded-md border border-[var(--error)] bg-[var(--error-surface)] px-4 py-2.5 text-sm text-[var(--error-ink)]">Choose an end date on or after the start date, within a year.</p>}
    {error && <p role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--error)] bg-[var(--error-surface)] px-4 py-2 text-sm text-[var(--error-ink)]">Team review could not be loaded: {error}<Button type="button" variant="outline" onClick={reload}>Try again</Button></p>}
    {/* Six figures read as two rows of three, not five and a stray. */}
    <StatRow label={`${partnerName} team review, ${rangeLabel(range.from, range.to, new Date(now))}`} className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard
        icon={Send}
        label="Leads submitted"
        value={loading ? "—" : metrics.submitted}
        delta={delta(metrics.submitted, previous?.submitted)}
        fact={loading || !previous ? undefined : { label: changeLabel(metrics.submitted, previous.submitted, days) }}
      />
      <StatCard
        icon={Hourglass}
        label="In progress"
        value={loading ? "—" : metrics.progress}
        fact={loading || !previous ? undefined : { label: changeLabel(metrics.progress, previous.progress, days) }}
      />
      <StatCard
        icon={FileCheck2}
        label="Applications"
        value={loading ? "—" : metrics.applications}
        delta={delta(metrics.applications, previous?.applications)}
        fact={loading || !previous ? undefined : { label: changeLabel(metrics.applications, previous.applications, days) }}
      />
      <StatCard
        icon={Percent}
        label="Conversion rate"
        value={loading || metrics.conversion === null ? "—" : metrics.conversion.toFixed(1)}
        unit={loading || metrics.conversion === null ? undefined : "%"}
        // Points, not a percentage of a percentage: a rate that goes 20% → 25% rose five points.
        delta={conversionChange === null || loading ? undefined : { value: Math.round(conversionChange * 10) / 10, unit: " pts", goodWhen: "up" }}
        fact={loading ? undefined : { label: `${metrics.applications} of ${metrics.submitted}`, value: conversionChange === null ? undefined : `vs previous ${days} days` }}
      />
      <StatCard
        icon={Timer}
        label="Avg response time"
        labelTitle={pulse?.responses ? `Over ${pulse.responses} ${pulse.responses === 1 ? "reply" : "replies"} to your agent` : undefined}
        value={loading ? "—" : pulse?.averageResponseMinutes != null ? durationLabel(pulse.averageResponseMinutes) : pulse ? "No replies yet" : "Unavailable"}
        fact={loading ? undefined : { label: pulse ? `${pulse.pendingFollowUps} pending follow-up${pulse.pendingFollowUps === 1 ? "" : "s"}` : "pending follow-ups unavailable" }}
      />
      <StatCard
        icon={Users}
        label="Active members"
        value={loading ? "—" : activeInPeriod}
        meter={loading ? undefined : { value: activeInPeriod, max: members.length || 1, tone: "good", label: `${activeInPeriod} of ${members.length} members active in this period` }}
        fact={loading ? undefined : { label: `of ${members.length} · ${invitesOutstanding} invite${invitesOutstanding === 1 ? "" : "s"} outstanding` }}
      />
    </StatRow>
    <HomePanel title="Submission trend" period={`leads per ${trend.step === 1 ? "day" : "week"} · ${rangeLabel(range.from, range.to, new Date(now))}`} className="min-h-[14rem]">
      {loading ? <SectionLoading rows={4} columns={1} label="Loading trend" />
        : !trend.buckets.length ? <p className="m-auto text-sm text-muted-foreground">Choose a range to see the trend.</p>
        : <BarSeries
            bars={trend.buckets.map((bucket) => ({ key: bucket.key, label: bucket.label, value: bucket.count }))}
            summary={`${metrics.submitted} leads submitted between ${rangeLabel(range.from, range.to, new Date(now))}`}
            unit="leads"
            className="flex-1"
            minHeight={150}
          />}
    </HomePanel>
    <TableCard
      title="Partner performance"
      action={<RefreshButton onClick={reload} refreshing={loading} />}
      footer={!loading && memberStats.length ? <Pager page={visible.current} total={memberStats.length} noun="members" pageSize={pageSize} onPage={setPage} /> : undefined}
    >
      {loading ? <SectionLoading rows={5} columns={6} />
        : !memberStats.length ? <EmptyState title="No partner users yet" hint="Invite teammates from Team access." action={<Button asChild variant="outline"><Link href="/partner/team">Team access</Link></Button>} />
        : <Table>
          <TableHeader><TableRow>
            <TableHead>Member</TableHead>
            <TableHead className="w-[120px] text-right">Submitted</TableHead>
            <TableHead className="w-[130px] text-right">In progress</TableHead>
            <TableHead className="w-[130px] text-right">Applications</TableHead>
            <TableHead className="w-[120px] text-right">Conversion</TableHead>
            <TableHead className="w-[160px]">Last activity</TableHead>
            <TableHead className="w-[100px] text-right"><span className="sr-only">Details</span></TableHead>
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
                <TableCell className="text-right"><Button type="button" variant="outline" size="sm" aria-expanded={isSelected} onClick={() => toggleDetail(user.user_id)}>{isSelected ? "Close" : "View"}</Button></TableCell>
              </TableRow>;
            })}
          </TableBody>
        </Table>}
    </TableCard>
    {detailOpen && selected && <SelectedTeammateDrawer selected={selected} leads={selectedLeads} onClose={() => { setDetailOpen(false); setSelectedUserId(null); }} />}
  </div>;
}
