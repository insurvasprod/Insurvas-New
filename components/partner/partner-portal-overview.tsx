"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CheckCircle2, CircleAlert, Hand, Inbox, LineChart, MessageSquare, Send, Users, WalletCards } from "lucide-react";

import { HomePanel, PanelFact } from "@/components/app/home/home-panel";
import { HomeShortcuts, ShortcutLink } from "@/components/app/home/home-extras";
import { Button } from "@/components/ui/button";
import { BarSeries, ShareBar, type ChartTone, type ShareSegment } from "@/components/ui/chart";
import { LiveStamp } from "@/components/ui/live-stamp";
import { PageHeader } from "@/components/ui/page-header";
import { DeltaChip } from "@/components/ui/stat";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { oldestOpenLabel } from "@/lib/format/age";
import { formatCentsAsCurrency } from "@/lib/money";
import type { PartnerRole } from "@/lib/partnerAuth/roles";
import type { PartnerLeadRow, PartnerPipelineStage } from "@/lib/partnerLeads/types";
import { laneShares } from "@/lib/partnerLeads/overview";
import { bestBucket, compareTail, localDay, shiftDay, trendSeries } from "@/lib/partnerLeads/trend";
import { termLabel, type PartnerTerm } from "@/lib/partners/payout";
import { durationLabel } from "@/lib/partnerTeamReview/pulse";

type PipelineSummary = {
  rows: PartnerLeadRow[];
  stages: PartnerPipelineStage[];
  counters: { submittedToday: number; claimed: number; converted: number; stillOpen: number };
  oldestOpenAt?: string | null;
  terms?: PartnerTerm | null;
  total: number;
};
/** /api/partner/overview: counts only, partner-scoped on the server; team and pulse for admins. */
type OverviewExtras = {
  rejectedCompliance: number | null;
  alerts: Array<{ id: string; title: string; body: string; link: string; actionLabel: string }>;
  team?: { active: number; pending: number } | null;
  pulse?: { averageResponseMinutes: number | null; responses: number; pendingFollowUps: number } | null;
};
type Statement = { periodStart: string; periodEnd: string; status: "published" | "paid"; netCents: number; paidOn: string | null };

const PIPELINE = "/partner/pipeline";
const TEAM_REVIEW = "/partner/team-review";

/** The window every chart on this page is drawn over. Long enough to see a habit, short enough to read. */
const WINDOW_DAYS = 30;
/** The chart is day-grained; a two-minute-old 30-day shape is not a stale one. */
const WINDOW_REFRESH_MS = 300_000;
/** Statement periods are months. Eight of them is a year and a bit — a trend, not a ledger. */
const STATEMENT_BARS = 8;

/** Today as YYYY-MM-DD in the viewer's calendar, for the pipeline's "From" filter. */
function todayIso() {
  return new Date().toLocaleDateString("en-CA");
}

const dollars = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`;

/** Converted strongest, Closed quietest: the ramp reads as progress through the pipeline. */
const LANE_TONES: Record<string, ChartTone> = { new: "faint", claimed: "soft", verification: "mid", converted: "strong", closed: "quiet" };

/**
 * Partner Overview: an analytical page, from reads that already exist.
 *
 * It used to answer nothing a partner actually asks — one bar at 100%, three rows of "—", and three
 * link tiles. It now answers the four: am I sending more than last week, do my leads convert, how
 * fast does the agency move, and what am I earning. The 30-day series is the same read Team review
 * makes, bucketed by the same tested helper (`lib/partnerLeads/trend.ts`), so the two pages cannot
 * disagree about a week the partner can see on both.
 *
 * It never draws a figure it did not read: a window that failed says so, and a rate out of no
 * submissions is "—", never 0%.
 */
/**
 * What `/design/overview` hands the page instead of three endpoints. A partner's own Overview never
 * passes it; with it set the page reads nothing at all, so a preview cannot touch live data
 * (lib/partnerLeads/fixtures.ts).
 */
export type PartnerOverviewSample = {
  pipeline: PipelineSummary;
  extras: OverviewExtras;
  windowRows: PartnerLeadRow[] | null;
  statements: Statement[] | null;
};

export function PartnerPortalOverview({ role, partnerStatus, sample }: { role: PartnerRole; partnerStatus: "draft" | "active" | "paused" | "offboarded"; partnerName?: string | null; sample?: PartnerOverviewSample }) {
  const isAdmin = role === "partner_admin";
  const sampled = Boolean(sample);
  const canSubmit = partnerStatus === "active";
  const [pipeline, setPipeline] = useState<PipelineSummary | null>(sample?.pipeline ?? null);
  const [extras, setExtras] = useState<OverviewExtras | null>(sample?.extras ?? null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(() => (sample ? Date.now() : null));
  const [stale, setStale] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // The 30-day window, on its own clock: undefined while it is reading, null when it could not be.
  const [windowRows, setWindowRows] = useState<PartnerLeadRow[] | null | undefined>(sample ? sample.windowRows : undefined);
  // A partner user never reads statements, so theirs start settled at "none" rather than loading.
  const [statements, setStatements] = useState<Statement[] | null | undefined>(sample ? sample.statements : isAdmin ? undefined : null);

  // Fixed for the life of the page, so the chart's bars do not shuffle under a 15-second poll.
  const [range] = useState(() => { const to = localDay(new Date())!; return { from: shiftDay(to, -(WINDOW_DAYS - 1)), to }; });

  const load = useCallback(async () => {
    try {
      // The stage counts and counters come with the first page; one row is enough.
      const [pipelineResponse, extrasResponse] = await Promise.all([
        fetch("/api/partner/leads/pipeline?limit=1&offset=0", { cache: "no-store" }),
        fetch("/api/partner/overview", { cache: "no-store" }),
      ]);
      const nextPipeline = await pipelineResponse.json().catch(() => null);
      const nextExtras = await extrasResponse.json().catch(() => null);
      if (!pipelineResponse.ok || !extrasResponse.ok) throw new Error("load failed");
      setPipeline(nextPipeline as PipelineSummary);
      setExtras(nextExtras as OverviewExtras);
      setError(null);
      setStale(false);
      setUpdatedAt(Date.now());
      setNow(Date.now());
    } catch {
      setStale(true);
      setPipeline((current) => {
        if (!current) setError("Some overview details could not be loaded. Try refreshing the page.");
        return current;
      });
    }
  }, []);

  useEffect(() => {
    let polling = false;
    const poll = () => {
      if (sampled || document.visibilityState !== "visible" || polling) return;
      polling = true;
      void load().finally(() => { polling = false; });
    };
    const kickoff = window.setTimeout(() => { if (!sampled) void load(); }, 0);
    const refresh = window.setInterval(poll, 15_000);
    const clock = window.setInterval(() => setNow(Date.now()), 15_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(refresh);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [load, sampled]);

  // The window is a second read, on a slower clock, and never blocks the cards: it is up to 5,000
  // rows, which is what Team review already asks of this endpoint for the same chart.
  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const response = await fetch(`/api/partner/leads/pipeline?${new URLSearchParams({ limit: "5000", date_from: range.from, date_to: range.to })}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
        const body = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || !Array.isArray(body?.rows)) throw new Error("window failed");
        setWindowRows(body.rows as PartnerLeadRow[]);
      } catch { if (!cancelled) setWindowRows((current) => (current === undefined ? null : current)); }
    };
    if (!sampled) void read();
    const refresh = window.setInterval(() => { if (!sampled && document.visibilityState === "visible") void read(); }, WINDOW_REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(refresh); };
  }, [range.from, range.to, sampled]);

  // Statements are the partner organisation's money: admins only, as the route enforces.
  useEffect(() => {
    if (!isAdmin || sampled) return;
    let cancelled = false;
    const read = async () => {
      try {
        const response = await fetch("/api/partner/payouts", { cache: "no-store" });
        const body = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || !Array.isArray(body?.runs)) throw new Error("statements failed");
        setStatements(body.runs as Statement[]);
      } catch { if (!cancelled) setStatements((current) => (current === undefined ? null : current)); }
    };
    void read();
    const refresh = window.setInterval(() => { if (document.visibilityState === "visible") void read(); }, WINDOW_REFRESH_MS);
    return () => { cancelled = true; window.clearInterval(refresh); };
  }, [isAdmin, sampled]);

  const counters = pipeline?.counters;
  const ready = pipeline !== null;
  const figure = (value: number | null | undefined) => (!ready || value == null ? "—" : value);
  const pulse = extras?.pulse;
  const team = extras?.team;
  const terms = pipeline?.terms ?? null;

  const trend = useMemo(
    () => (windowRows ? trendSeries(windowRows.map((row) => row.submittedAt), { from: range.from, to: range.to, now }) : null),
    // `now` only re-labels the year on a bucket, so a 15-second tick cannot reshuffle the bars.
    [windowRows, range.from, range.to, now],
  );
  const week = trend ? compareTail(trend.buckets, 7) : null;
  const best = trend ? bestBucket(trend.buckets) : null;
  const shares = useMemo<ShareSegment[] | null>(
    () => (windowRows ? laneShares(windowRows).map((lane) => ({ key: lane.key, label: lane.label, value: lane.count, tone: LANE_TONES[lane.key] ?? "soft" })) : null),
    [windowRows],
  );

  const latestStatement = statements?.[0] ?? null;
  const statementBars = (statements ?? []).slice(0, STATEMENT_BARS).reverse().map((run) => ({
    key: run.periodStart,
    label: shortPeriod(run.periodStart, run.periodEnd),
    value: run.netCents / 100,
  }));
  const statementDetail = statements === undefined ? "Statements"
    : statements === null ? "Statements unavailable"
    : latestStatement === null ? "No statements yet"
    : `${latestStatement.status === "paid" ? "Paid" : "Published"} · ${formatCentsAsCurrency(latestStatement.netCents)}`;

  const stats = [
    { key: "today", icon: Send, label: "Submitted today", value: figure(counters?.submittedToday), fact: { label: "Since midnight, your time" }, href: `${PIPELINE}?date_from=${todayIso()}&view=table` },
    { key: "claimed", icon: Hand, label: "With a closer", value: figure(counters?.claimed), fact: { label: "Claimed or on a call" }, href: PIPELINE },
    { key: "converted", icon: CheckCircle2, label: "Converted · 30 days", value: figure(counters?.converted), fact: { label: "Won on the board" }, href: PIPELINE },
    { key: "open", icon: Inbox, label: "Still open", value: figure(counters?.stillOpen), fact: { label: oldestOpenLabel(counters?.stillOpen ?? 0, pipeline?.oldestOpenAt, now) }, href: PIPELINE },
  ];

  const reviewHref = `${TEAM_REVIEW}?from=${range.from}&to=${range.to}`;

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-4">
      <PageHeader
        title="Overview"
        description="Your submissions and pipeline at a glance."
        visible
        infoDescription
        actions={<>
          {updatedAt !== null && <LiveStamp updatedAt={updatedAt} staleAfterSeconds={stale ? 0 : 45} />}
          {canSubmit && <Button asChild><a href="/partner/submit-lead"><Send aria-hidden="true" />Submit a new lead</a></Button>}
        </>}
      />

      {error && <p role="alert" className="rounded-md border border-[var(--error)] bg-[var(--error-surface)] px-4 py-2.5 text-sm text-[var(--error-ink)]">{error}</p>}

      {(extras?.alerts.length ?? 0) > 0 && <section aria-label="Needs attention" className="flex flex-col gap-2">
        {extras!.alerts.map((alert) => (
          <Link key={alert.id} href={alert.link} className="flex min-w-0 items-center gap-3 rounded-lg border border-[var(--warning)]/35 bg-[var(--warning-surface)] px-3.5 py-2.5 text-sm text-[var(--warning-ink)] no-underline hover:border-[var(--warning)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate"><strong className="font-semibold">{alert.title}</strong><span className="ml-2 text-[var(--muted-foreground)]">{alert.body}</span></span>
            <span className="shrink-0 font-semibold">{alert.actionLabel}<ArrowUpRight className="ml-1 inline size-3.5" aria-hidden="true" /></span>
          </Link>
        ))}
      </section>}

      <div className="@container">
        <StatRow label="Partner activity" className="grid-cols-1 @lg:grid-cols-2 @4xl:grid-cols-4">
          {stats.map((stat) => (
            <Link key={stat.key} href={stat.href} className="block min-w-0 rounded-lg text-inherit no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
              <StatCard icon={stat.icon} label={stat.label} value={stat.value} fact={stat.fact} className="h-full min-h-[132px]" />
            </Link>
          ))}
        </StatRow>
      </div>

      <div className="@container">
        <div className="grid min-w-0 grid-cols-1 gap-3 @4xl:grid-cols-12">

          <HomePanel
            title="Submissions"
            period={`${WINDOW_DAYS} days`}
            link={{ label: "Team review", href: reviewHref }}
            className="min-h-[296px] @4xl:col-span-8"
            bodyClassName="pt-1"
            footer={<>
              {best && <PanelFact label="Best day" value={`${best.label} · ${best.count}`} />}
              {trend && <PanelFact label={`Total · ${WINDOW_DAYS} days`} value={trend.total} />}
            </>}
          >
            {windowRows === undefined ? (
              <div className="flex flex-1 items-end gap-1.5 pb-6 pt-4" aria-label="Loading submissions" aria-busy="true">
                {Array.from({ length: 14 }, (unused, index) => <span key={index} className="m-skel min-h-4 flex-1 rounded-t" style={{ height: `${30 + ((index * 37) % 60)}%` }} />)}
              </div>
            ) : windowRows === null ? (
              <Unavailable what="submission history" />
            ) : trend && trend.total === 0 ? (
              <Nothing
                title="No submissions in the last 30 days"
                detail={canSubmit ? "Send one and it appears here within a minute." : "Your organisation is not able to submit at the moment."}
              />
            ) : trend && (
              <div className="flex min-h-0 flex-1 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="font-[family-name:var(--font-display)] text-[1.875rem] font-semibold leading-none tracking-[-0.035em] tabular-nums text-foreground">{week!.recent}</span>
                  <span className="text-[0.8125rem] text-muted-foreground">leads · 7 days</span>
                  {week!.change !== null && (
                    <span className="inline-flex items-center gap-1.5">
                      <DeltaChip value={Math.round(week!.change * 10) / 10} goodWhen="up" />
                      <span className="text-xs text-muted-foreground">vs. the 7 days before</span>
                    </span>
                  )}
                </div>
                <BarSeries
                  bars={trend.buckets.map((bucket, index) => ({ key: bucket.key, label: bucket.label, value: bucket.count, partial: index === trend.buckets.length - 1 }))}
                  summary={`Leads submitted per ${trend.step === 1 ? "day" : "week"} over ${WINDOW_DAYS} days: ${trend.total} in all`}
                  unit="leads"
                  className="flex-1"
                />
              </div>
            )}
          </HomePanel>

          <HomePanel
            title="Where they end up"
            period={`${WINDOW_DAYS} days`}
            link={{ label: "View pipeline", href: PIPELINE }}
            className="min-h-[296px] @4xl:col-span-4"
            bodyClassName="pt-1"
            // The conversion rate is the Converted row of the breakdown itself, so it is not repeated
            // here: two roundings of one figure side by side is how a page contradicts itself.
            footer={<>
              <PanelFact label={`Submitted · ${WINDOW_DAYS} days`} value={windowRows ? windowRows.length : "—"} />
              <PanelFact label="Stopped by screening" value={figure(extras?.rejectedCompliance)} />
            </>}
          >
            {windowRows === undefined ? (
              <div className="flex flex-1 flex-col justify-center gap-3" aria-label="Loading outcomes" aria-busy="true">
                <span className="m-skel h-3 w-full rounded" />
                {Array.from({ length: 4 }, (unused, index) => <span key={index} className="m-skel h-4 w-full rounded" />)}
              </div>
            ) : windowRows === null ? (
              <Unavailable what="outcomes" />
            ) : !windowRows.length ? (
              <Nothing title="Nothing to break down yet" detail="Outcomes appear once leads have been sent." />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col justify-center gap-4 py-2">
                <ShareBar segments={shares!} unit="leads" summary={`Where the last ${WINDOW_DAYS} days of submissions stand: ${shares!.map((share) => `${share.label} ${share.value}`).join(", ")}`} />
              </div>
            )}
          </HomePanel>

          {isAdmin && (
            <HomePanel
              title="Your agency"
              period="how fast they move"
              link={{ label: "Team review", href: reviewHref }}
              className="min-h-[220px] @4xl:col-span-4"
              bodyClassName="pt-1"
            >
              <dl className="m-0 flex min-h-0 flex-1 flex-col justify-center divide-y divide-[var(--border)]">
                <Figure
                  label="Average reply in chat"
                  value={pulse?.averageResponseMinutes != null ? durationLabel(pulse.averageResponseMinutes) : "—"}
                  detail={pulse?.responses ? `Across ${pulse.responses} replies` : "No replies recorded yet"}
                />
                <Figure
                  label="Longest wait right now"
                  value={oldestOpenLabel(counters?.stillOpen ?? 0, pipeline?.oldestOpenAt, now)}
                  detail={`${figure(counters?.stillOpen)} still open`}
                />
                <Figure
                  label="Conversations needing your team"
                  value={pulse ? String(pulse.pendingFollowUps) : "—"}
                  detail="Replies they are waiting on"
                  href="/partner/messages"
                />
              </dl>
            </HomePanel>
          )}

          {isAdmin && (
            <HomePanel
              title="Earnings"
              period={termLabel(terms) ?? "your statements"}
              link={{ label: "Statements", href: "/partner/payouts" }}
              className="min-h-[220px] @4xl:col-span-8"
              bodyClassName="pt-1"
              footer={latestStatement ? <>
                <PanelFact label={latestStatement.status === "paid" ? "Paid" : "Published"} value={formatCentsAsCurrency(latestStatement.netCents)} />
                <PanelFact label="Period" value={shortPeriod(latestStatement.periodStart, latestStatement.periodEnd)} />
              </> : undefined}
            >
              {statements === undefined ? (
                <div className="flex flex-1 items-end gap-2 pb-6 pt-4" aria-label="Loading statements" aria-busy="true">
                  {Array.from({ length: 6 }, (unused, index) => <span key={index} className="m-skel min-h-4 flex-1 rounded-t" style={{ height: `${40 + ((index * 29) % 50)}%` }} />)}
                </div>
              ) : statements === null ? (
                <Unavailable what="statements" />
              ) : !statementBars.length ? (
                <Nothing title="No published statements yet" detail="Your agency publishes these at the end of a period." />
              ) : (
                <BarSeries
                  bars={statementBars}
                  summary={`Net paid per statement period: ${statementBars.map((bar) => `${bar.label} ${dollars(bar.value)}`).join(", ")}`}
                  format={dollars}
                  className="flex-1"
                  minHeight={112}
                />
              )}
            </HomePanel>
          )}
        </div>
      </div>

      <HomeShortcuts>
        <ShortcutLink icon={LineChart} label="Pipeline" href={PIPELINE} figure={ready ? String(counters?.stillOpen ?? 0) : undefined} caption="still open" />
        <ShortcutLink icon={MessageSquare} label="Messages" href="/partner/messages" figure={pulse ? String(pulse.pendingFollowUps) : undefined} caption="waiting on your team" />
        {isAdmin && <ShortcutLink icon={Users} label="Team" href="/partner/team" figure={team ? String(team.active) : undefined} caption="active members" />}
        {isAdmin && <ShortcutLink icon={WalletCards} label="Statements" href="/partner/payouts" figure={latestStatement ? formatCentsAsCurrency(latestStatement.netCents) : undefined} caption={statementDetail} />}
      </HomeShortcuts>
    </div>
  );
}

/** One figure in a stacked list, optionally the thing you click to act on it. */
function Figure({ label, value, detail, href }: { label: string; value: string; detail: string; href?: string }) {
  const body = (
    <>
      <dt className="m-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 mt-1 text-xl font-semibold leading-none tabular-nums text-foreground">{value}</dd>
      <p className="m-0 mt-1.5 text-xs text-muted-foreground">{detail}</p>
    </>
  );
  return href
    ? <Link href={href} className="block py-3.5 text-inherit no-underline first:pt-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">{body}</Link>
    : <div className="py-3.5 first:pt-1">{body}</div>;
}

/** A read that did not land. It says so rather than drawing zero, which would be a lie about the data. */
function Unavailable({ what }: { what: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-8 text-center">
      <p className="m-0 text-sm font-semibold text-foreground">Could not load {what}</p>
      <p className="m-0 text-xs text-muted-foreground">The rest of this page is up to date. This panel retries on its own.</p>
    </div>
  );
}

/** A read that landed and found nothing, which is a different thing and reads differently. */
function Nothing({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-8 text-center">
      <p className="m-0 text-sm font-semibold text-foreground">{title}</p>
      <p className="m-0 max-w-[22rem] text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function shortPeriod(start: string, end: string) {
  const startDate = new Date(`${start}T12:00:00`);
  const endDate = new Date(`${end}T12:00:00`);
  const sameMonth = startDate.getFullYear() === endDate.getFullYear() && startDate.getMonth() === endDate.getMonth();
  const startLabel = startDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const endLabel = sameMonth
    ? String(endDate.getDate())
    : endDate.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(startDate.getFullYear() !== endDate.getFullYear() ? { year: "numeric" } : {}) });
  return `${startLabel}–${endLabel}`;
}
