"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronRight, Hand, Inbox, Lightbulb, Send, TriangleAlert } from "lucide-react";

import { HomePanel, PanelFact } from "@/components/app/home/home-panel";
import { Button } from "@/components/ui/button";
import { DonutChart, LineSeries, type ChartTone, type DonutSegment } from "@/components/ui/chart";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { KpiRow, KpiTile } from "@/components/ui/kpi-tile";
import { LiveStamp } from "@/components/ui/live-stamp";
import { PageHeader } from "@/components/ui/page-header";
import { SelectMenu } from "@/components/ui/select-menu";
import { DeltaChip } from "@/components/ui/stat";
import { oldestOpenLabel } from "@/lib/format/age";
import { formatCentsAsCurrency } from "@/lib/money";
import type { PartnerRole } from "@/lib/partnerAuth/roles";
import type { PartnerLeadRow, PartnerPipelineStage } from "@/lib/partnerLeads/types";
import { buildInsights, isHeld, isSold } from "@/lib/partnerLeads/insights";
import { laneShares } from "@/lib/partnerLeads/overview";
import { bestBucket, compareTail, localDay, shiftDay, spanDays, trendSeries } from "@/lib/partnerLeads/trend";
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

function rangeLabel(from: string, to: string) {
  const format = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
  const start = format.format(new Date(`${from}T12:00:00`));
  const end = format.format(new Date(`${to}T12:00:00`));
  return from === to ? start : `${start} – ${end}`;
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
  const [range, setRange] = useState(() => { const to = localDay(new Date())!; return { from: shiftDay(to, -(WINDOW_DAYS - 1)), to }; });
  const [draftRange, setDraftRange] = useState(range);
  const rangeDays = spanDays(range.from, range.to);
  const rangeText = rangeLabel(range.from, range.to);
  const rangeInvalid = !draftRange.from || !draftRange.to || draftRange.to < draftRange.from || spanDays(draftRange.from, draftRange.to) > 366;

  function applyRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rangeInvalid || (draftRange.from === range.from && draftRange.to === range.to)) return;
    setRange(draftRange);
  }

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
  const terms = pipeline?.terms ?? null;

  const trend = useMemo(
    () => (windowRows ? trendSeries(windowRows.map((row) => row.submittedAt), { from: range.from, to: range.to, now }) : null),
    // `now` only re-labels the year on a bucket, so a 15-second tick cannot reshuffle the bars.
    [windowRows, range.from, range.to, now],
  );
  const week = trend ? compareTail(trend.buckets, 7) : null;
  const best = trend ? bestBucket(trend.buckets) : null;
  const shares = useMemo<DonutSegment[] | null>(
    () => (windowRows ? laneShares(windowRows).map((lane) => ({ key: lane.key, label: lane.label, value: lane.count, tone: LANE_TONES[lane.key] ?? "soft" })) : null),
    [windowRows],
  );
  // The small line in each tile: the same day (or week) buckets as the trend, one series per figure.
  const kpiSeries = useMemo(() => {
    if (!windowRows) return null;
    const perBucket = (match: (row: PartnerLeadRow) => boolean) =>
      trendSeries(windowRows.filter(match).map((row) => row.submittedAt), { from: range.from, to: range.to, now }).buckets.map((bucket) => bucket.count);
    return {
      submitted: perBucket(() => true),
      claimed: perBucket(isHeld),
      converted: perBucket(isSold),
      open: perBucket((row) => row.status === "unclaimed" || isHeld(row)),
    };
  }, [windowRows, range.from, range.to, now]);
  // What needs the partner: the server's alerts first, then what the leads themselves say.
  const attention = useMemo(() => {
    const fromServer = (extras?.alerts ?? []).map((alert) => ({ key: alert.id, tone: "action" as const, text: `${alert.title}. ${alert.body}`, href: alert.link, hrefLabel: alert.actionLabel }));
    const fromLeads = windowRows ? buildInsights(windowRows, now) : [];
    return [...fromServer, ...fromLeads];
  }, [extras, windowRows, now]);
  const today = localDay(new Date(now))!;
  const presetDays = [7, 30, 90].find((preset) => range.to === today && rangeDays === preset);
  const [customPeriod, setCustomPeriod] = useState(false);
  const customRange = customPeriod || presetDays === undefined;
  function choosePeriod(value: string) {
    if (value === "custom") { setCustomPeriod(true); return; }
    const next = { from: shiftDay(today, -(Number(value) - 1)), to: today };
    setCustomPeriod(false);
    setDraftRange(next);
    setRange(next);
  }

  const latestStatement = statements?.[0] ?? null;
  const statementBars = (statements ?? []).slice(0, STATEMENT_BARS).reverse().map((run) => ({
    key: run.periodStart,
    label: shortPeriod(run.periodStart, run.periodEnd),
    value: run.netCents / 100,
  }));

  const stats = [
    { key: "today", icon: Send, label: "Submitted today", value: figure(counters?.submittedToday), series: kpiSeries?.submitted, note: "Since midnight, your time", href: `${PIPELINE}?date_from=${todayIso()}&view=table` },
    { key: "claimed", icon: Hand, label: "With a closer", value: figure(counters?.claimed), series: kpiSeries?.claimed, note: "Claimed or on a call", href: PIPELINE },
    { key: "converted", icon: CheckCircle2, label: "Converted · 30 days", value: figure(counters?.converted), series: kpiSeries?.converted, note: "Won on the board", href: PIPELINE },
    { key: "open", icon: Inbox, label: "Still open", value: figure(counters?.stillOpen), series: kpiSeries?.open, note: oldestOpenLabel(counters?.stillOpen ?? 0, pipeline?.oldestOpenAt, now), href: PIPELINE },
  ];

  const reviewHref = `${TEAM_REVIEW}?from=${range.from}&to=${range.to}`;

  return (
    <div className="m-stagger flex min-h-0 w-full min-w-0 flex-1 flex-col gap-6">
      <PageHeader
        title="Overview"
        description="Your submissions and pipeline at a glance."
        hideTitle
        breadcrumbs={[{ label: "Home" }, { label: "Overview" }]}
        actions={<>
          <form className="flex flex-wrap items-center gap-2" onSubmit={applyRange}>
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
              <input type="date" aria-label="Report start date" className={toolbarControl} value={draftRange.from} max={draftRange.to || undefined} onChange={(event) => setDraftRange((current) => ({ ...current, from: event.target.value }))} />
              <span className="text-sm text-muted-foreground" aria-hidden="true">–</span>
              <input type="date" aria-label="Report end date" className={toolbarControl} value={draftRange.to} min={draftRange.from || undefined} onChange={(event) => setDraftRange((current) => ({ ...current, to: event.target.value }))} />
              <Button type="submit" variant="secondary" size="sm" disabled={rangeInvalid || (draftRange.from === range.from && draftRange.to === range.to)}>Apply</Button>
            </>}
          </form>
          {updatedAt !== null && <LiveStamp updatedAt={updatedAt} staleAfterSeconds={stale ? 0 : 45} />}
          {canSubmit && <Button asChild size="sm"><a href="/partner/submit-lead"><Send aria-hidden="true" />Submit New Lead</a></Button>}
        </>}
      />

      {error && <p role="alert" className="rounded-md border border-[var(--error)] bg-[var(--error-surface)] px-4 py-2.5 text-sm text-[var(--error-ink)]">{error}</p>}

      <KpiRow label="Partner activity">
        {stats.map((stat) => (
          <Link key={stat.key} href={stat.href} className="block min-w-0 rounded-lg text-inherit no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]">
            <KpiTile icon={stat.icon} label={stat.label} value={stat.value} series={stat.series} note={stat.note} className="h-full" />
          </Link>
        ))}
      </KpiRow>

      <div className="@container">
        <div className="grid min-w-0 grid-cols-1 gap-4 @4xl:grid-cols-12">

          <HomePanel
            title="Submissions"
            period={rangeText}
            link={{ label: "Team performance", href: reviewHref }}
            className="min-h-[19rem] @4xl:col-span-8"
            bodyClassName="pt-1"
            footer={<>
              {best && <PanelFact label="Best day" value={`${best.label} · ${best.count}`} />}
              {trend && <PanelFact label={`Total · ${rangeDays} ${rangeDays === 1 ? "day" : "days"}`} value={trend.total} />}
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
                title="No submissions in this range"
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
                <LineSeries
                  points={trend.buckets.map((bucket) => ({ key: bucket.key, label: bucket.label, value: bucket.count }))}
                  summary={`Leads submitted per ${trend.step === 1 ? "day" : "week"} from ${range.from} to ${range.to}: ${trend.total} in all`}
                  unit="leads"
                  className="flex-1"
                />
              </div>
            )}
          </HomePanel>

          <HomePanel
            title="Lead status"
            link={{ label: "Pipeline", href: PIPELINE }}
            className="min-h-[19rem] @4xl:col-span-4"
            bodyClassName="pt-1"
            footer={<>
              <PanelFact label={`Submitted · ${rangeDays} ${rangeDays === 1 ? "day" : "days"}`} value={windowRows ? windowRows.length : "—"} />
              <PanelFact label="Stopped by screening" value={figure(extras?.rejectedCompliance)} />
            </>}
          >
            {windowRows === undefined ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3" aria-label="Loading outcomes" aria-busy="true">
                <span className="m-skel size-32 rounded-full" />
              </div>
            ) : windowRows === null ? (
              <Unavailable what="outcomes" />
            ) : !windowRows.length ? (
              <Nothing title="Nothing to break down yet" detail="No submissions fall in this date range." />
            ) : (
              <DonutChart
                className="flex-1 justify-center"
                centerValue={String(windowRows.length)}
                centerLabel="leads"
                segments={shares!}
                unit="leads"
                summary={`Where submissions from ${range.from} to ${range.to} stand: ${shares!.map((share) => `${share.label} ${share.value}`).join(", ")}`}
              />
            )}
          </HomePanel>

          {isAdmin && (
            <HomePanel
              title="Your agency"
              link={{ label: "Team performance", href: reviewHref }}
              className="min-h-[19rem] @4xl:col-span-4"
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
              link={{ label: "Commissions", href: "/partner/payouts" }}
              className="min-h-[19rem] @4xl:col-span-4"
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
              ) : statementBars.length < 2 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-1 py-6 text-center">
                  <span className="font-[family-name:var(--font-display)] text-[2.5rem] font-semibold leading-none tracking-[-0.035em] tabular-nums text-foreground">{dollars(statementBars[0].value)}</span>
                  <span className="text-sm text-[var(--body)]">{statementBars[0].label} · your first statement</span>
                </div>
              ) : (
                <LineSeries
                  points={statementBars}
                  summary={`Net payable by statement period: ${statementBars.map((bar) => `${bar.label} ${dollars(bar.value)}`).join(", ")}`}
                  format={dollars}
                  className="flex-1"
                  minHeight={150}
                />
              )}
            </HomePanel>
          )}

          <HomePanel title="Needs your attention" className={`min-h-[19rem] ${isAdmin ? "@4xl:col-span-4" : "@4xl:col-span-12"}`} bodyClassName="pt-1">
            {windowRows === undefined && !(extras?.alerts.length) ? (
              <div className="flex flex-col gap-3" aria-label="Reading your leads" aria-busy="true">
                {Array.from({ length: 3 }, (unused, index) => <span key={index} className="m-skel h-4 w-full rounded" />)}
              </div>
            ) : !attention.length ? (
              <p className="m-0 py-1 text-sm text-muted-foreground">{windowRows?.length ? "All clear: nothing is waiting on you in this period." : "No leads in this period yet. Insights appear as soon as your team submits."}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
                {attention.map((item) => (
                  <li key={item.key} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start gap-2.5">
                      {item.tone === "info"
                        ? <Lightbulb className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        : <TriangleAlert className={`mt-0.5 size-4 shrink-0 ${item.tone === "action" ? "text-[var(--error-ink)]" : "text-[var(--warning-ink)]"}`} aria-hidden="true" />}
                      <span className="min-w-0 flex-1 text-sm leading-normal text-foreground">{item.text}</span>
                    </div>
                    {item.href && <Link href={item.href} className="inline-flex items-center gap-0.5 self-start pl-[1.625rem] text-sm font-semibold text-[var(--accent-ink)] hover:underline">{item.hrefLabel}<ChevronRight className="size-4" aria-hidden="true" /></Link>}
                  </li>
                ))}
              </ul>
            )}
          </HomePanel>
        </div>
      </div>
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
