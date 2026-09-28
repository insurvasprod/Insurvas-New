"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowRight, Download, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { activityLabel, dayMonth } from "@/lib/format/ago";
import { dayMonthYear, viewerTimeZone } from "@/lib/format/dates";
import { HELD_STATUSES, SALE_DISPOSITIONS } from "@/lib/partnerLeads/lanes";
import type { PartnerLeadRow } from "@/lib/partnerLeads/types";
import { durationLabel } from "@/lib/partnerTeamReview/pulse";

type PartnerUser = { user_id: string; name: string; email: string; role: "partner_admin" | "partner_user"; status: "active" | "revoked"; accepted_at: string | null; last_login_at: string | null };
type MemberStats = { submitted: number; progress: number; applications: number; lastActivity: string };
type SelectedMember = { user: PartnerUser; stats: MemberStats };

function initials(name: string) { return name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?"; }
// The team's leads load in an effect, so the viewer's zone is safe here.
function formatDate(value: string) { return dayMonthYear(value, viewerTimeZone()); }

function SelectedTeammateDrawer({ selected, leads, onClose }: { selected: SelectedMember; leads: PartnerLeadRow[]; onClose: () => void }) {
  const drawerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    function handleOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && !drawerRef.current?.contains(target)) onClose();
    }
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer);
  }, [onClose]);

  return <aside ref={drawerRef} className="portal-team-review-detail" aria-label={`${selected.user.name} lead activity`}>
    <div className="portal-team-review-detail-header justify-end"><button type="button" className="portal-team-review-detail-close" aria-label="Close teammate details" onClick={onClose}><X className="size-5" aria-hidden="true" /></button></div>
    <div className="portal-team-review-detail-person"><span>{initials(selected.user.name)}</span><div><h2>{selected.user.name}</h2><p>{selected.user.role === "partner_admin" ? "Partner admin" : "Partner user"}</p></div></div>
    <dl><div><dt>Leads this period</dt><dd>{selected.stats.submitted}</dd></div><div><dt>Application rate</dt><dd>{selected.stats.submitted ? `${((selected.stats.applications / selected.stats.submitted) * 100).toFixed(1)}%` : "—"}</dd></div><div><dt>In progress</dt><dd>{selected.stats.progress}</dd></div></dl>
    <div className="portal-team-review-detail-leads"><div className="portal-team-review-detail-leads-heading"><strong>Submitted leads</strong><span>{leads.length} total</span></div>{leads.length ? leads.map((lead) => <article className="portal-team-review-detail-lead" key={lead.id}><div className="portal-team-review-detail-lead-heading"><div><strong>{lead.customer}</strong><span>{lead.product}</span></div><Badge variant="secondary">{lead.stageName || lead.status || "Submitted"}</Badge></div><dl><div><dt>Outcome</dt><dd>{lead.outcome ?? lead.disposition ?? "Awaiting update"}</dd></div><div><dt>Submitted</dt><dd>{formatDate(lead.submittedAt)}</dd></div><div><dt>Last update</dt><dd>{formatDate(lead.updatedAt)}</dd></div></dl>{lead.outcomeNote && <p className="portal-team-review-detail-lead-note">{lead.outcomeNote}</p>}</article>) : <p className="portal-team-review-detail-empty">No leads submitted in this period.</p>}</div>
    <Link href={`/partner/pipeline?closer_id=${selected.user.user_id}`} className="portal-team-review-detail-link">View partner pipeline <ArrowRight className="size-4" aria-hidden="true" /></Link>
  </aside>;
}

/** Below this many leads a member's conversion rate is noise, and showing it would rank people on it. */
const MIN_CONVERSION_SAMPLE = 10;
const DAY_MS = 86_400_000;
const PAGE_SIZE = 25;

function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function parseDay(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}
/** Whole days in an inclusive range. */
function spanDays(from: string, to: string) {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / DAY_MS) + 1;
}
function shiftDay(value: string, days: number) {
  const date = parseDay(value);
  date.setDate(date.getDate() + days);
  return localDay(date);
}
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

export function PartnerTeamReviewWorkspace({ partnerName }: { partnerName: string }) {
  // The board's default: the last 30 days, ending today, in the viewer's own calendar.
  const [initialTo] = useState(() => localDay(new Date()));
  const initialFrom = shiftDay(initialTo, -29);
  const [draftFrom, setDraftFrom] = useState(initialFrom);
  const [draftTo, setDraftTo] = useState(initialTo);
  const [range, setRange] = useState({ from: initialFrom, to: initialTo });
  const [users, setUsers] = useState<PartnerUser[]>([]);
  const [rows, setRows] = useState<PartnerLeadRow[]>([]);
  const [previous, setPrevious] = useState<Figures | null>(null);
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [loading, setLoading] = useState(true);
  // The first read draws the page skeleton; a new range keeps the page and its date controls.
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [now] = useState(() => Date.now());
  const days = spanDays(range.from, range.to);

  useEffect(() => {
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
  }, [range, days, retryToken]);

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
  // One bar a day; past two months a day is too thin to read, so a bar is a week.
  const trend = useMemo(() => {
    const step = days > 62 ? 7 : 1;
    const buckets: Array<{ key: string; label: string; count: number }> = [];
    for (let offset = 0; offset < days; offset += step) {
      const start = shiftDay(range.from, offset);
      const end = shiftDay(range.from, Math.min(days - 1, offset + step - 1));
      buckets.push({ key: start, label: step === 1 ? dayMonth(parseDay(start), new Date(now)) : `${dayMonth(parseDay(start), new Date(now))} – ${dayMonth(parseDay(end), new Date(now))}`, count: 0 });
    }
    for (const row of rows) {
      const submitted = new Date(row.submittedAt);
      if (Number.isNaN(submitted.getTime())) continue;
      const dayIndex = spanDays(range.from, localDay(submitted)) - 1;
      const bucket = dayIndex >= 0 ? buckets[Math.floor(dayIndex / step)] : undefined;
      if (bucket) bucket.count += 1;
    }
    const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
    return { step, buckets: buckets.map((bucket) => ({ ...bucket, height: bucket.count ? Math.max(4, Math.round((bucket.count / max) * 100)) : 0 })) };
  }, [rows, range.from, days, now]);

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
  const tone = (current: number, before: number | null | undefined) => (!loading && before !== null && before !== undefined && current > before ? "good" as const : undefined);
  const reload = () => { setError(null); setLoading(true); setRetryToken((value) => value + 1); };
  const visible = paginate(memberStats, page, PAGE_SIZE);

  if (!loaded) return <PageLoading />;

  return <div className="m-stagger space-y-6">
    <PageHeader
      title="Team review"
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
    <StatStrip label={`${partnerName} team review, ${rangeLabel(range.from, range.to, new Date(now))}`}>
      <StatTile label="Leads submitted" value={loading ? "—" : metrics.submitted} valueTone={tone(metrics.submitted, previous?.submitted)} footnote={loading || !previous ? undefined : changeLabel(metrics.submitted, previous.submitted, days)} reserveFootnote />
      <StatTile label="In progress" value={loading ? "—" : metrics.progress} footnote={loading || !previous ? undefined : changeLabel(metrics.progress, previous.progress, days)} reserveFootnote />
      <StatTile label="Applications" value={loading ? "—" : metrics.applications} valueTone={tone(metrics.applications, previous?.applications)} footnote={loading || !previous ? undefined : changeLabel(metrics.applications, previous.applications, days)} reserveFootnote />
      <StatTile
        label="Conversion rate"
        value={loading || metrics.conversion === null ? "—" : metrics.conversion.toFixed(1)}
        unit={loading || metrics.conversion === null ? undefined : "%"}
        valueTone={conversionChange !== null && conversionChange > 0 && !loading ? "good" : undefined}
        footnote={loading ? undefined : `${metrics.applications} of ${metrics.submitted}${conversionChange === null ? "" : ` · ${conversionChange >= 0 ? "+" : "−"}${Math.abs(conversionChange).toFixed(1)} pts vs previous ${days} days`}`}
        reserveFootnote
      />
      <StatTile
        label="Avg response time"
        labelTitle={pulse?.responses ? `Over ${pulse.responses} ${pulse.responses === 1 ? "reply" : "replies"} to your agent` : undefined}
        value={loading ? "—" : pulse?.averageResponseMinutes != null ? durationLabel(pulse.averageResponseMinutes) : pulse ? "No replies yet" : "Unavailable"}
        footnote={loading ? undefined : pulse ? `${pulse.pendingFollowUps} pending follow-up${pulse.pendingFollowUps === 1 ? "" : "s"}` : "pending follow-ups unavailable"}
        reserveFootnote
      />
      <StatTile
        label="Active members"
        value={loading ? "—" : activeInPeriod}
        meter={loading ? undefined : { value: activeInPeriod, max: members.length || 1, tone: "good", label: `${activeInPeriod} of ${members.length} members active in this period` }}
        footnote={loading ? undefined : `of ${members.length} · ${invitesOutstanding} invite${invitesOutstanding === 1 ? "" : "s"} outstanding`}
        reserveFootnote
      />
    </StatStrip>
    <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="partner-review-trend-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="partner-review-trend-heading" className="text-lg font-semibold leading-[1.28] tracking-[-0.015em]">Submission trend</h2>
        <p className="text-sm text-muted-foreground">Leads per {trend.step === 1 ? "day" : "week"} · {rangeLabel(range.from, range.to, new Date(now))}</p>
      </div>
      {loading ? <div className="mt-4"><SectionLoading rows={4} columns={1} label="Loading trend" /></div>
        : <div className="mt-4 flex h-[150px] items-end gap-1.5 border-b border-border" role="img" aria-label={`${metrics.submitted} leads submitted between ${rangeLabel(range.from, range.to, new Date(now))}`}>
          {trend.buckets.map((bucket) => <span key={bucket.key} className="min-w-[2px] flex-1 rounded-t-[2px] bg-[var(--primary)]" style={{ height: `${bucket.height}%` }} title={`${bucket.label}: ${bucket.count} ${bucket.count === 1 ? "lead" : "leads"}`} />)}
        </div>}
    </section>
    <TableCard
      title="Partner performance"
      action={<RefreshButton onClick={reload} refreshing={loading} />}
      footer={!loading && memberStats.length ? <Pager page={visible.current} total={memberStats.length} noun="members" pageSize={PAGE_SIZE} onPage={setPage} /> : undefined}
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
    {/* On the body, not in the page: the page animates in with a transform, and a transformed
        ancestor turns position: fixed into position: absolute. */}
    {detailOpen && selected && createPortal(<><div className="portal-partner-review-backdrop" aria-hidden="true" /><SelectedTeammateDrawer selected={selected} leads={selectedLeads} onClose={() => { setDetailOpen(false); setSelectedUserId(null); }} /></>, document.body)}
  </div>;
}
