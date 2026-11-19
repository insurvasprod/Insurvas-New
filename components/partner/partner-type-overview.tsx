"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Copy, Send, UserPlus } from "lucide-react";

import { DashChart, DashFunnel, DashHero, DashList, DashTable, type DashItem, type DashStep } from "@/components/app/home/dash/dash-kit";
import { HomePanel, HomePanelLoading } from "@/components/app/home/home-panel";
import { Button } from "@/components/ui/button";
import { LineSeries } from "@/components/ui/chart";
import { LiveStamp } from "@/components/ui/live-stamp";
import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { formatCentsAsCurrency } from "@/lib/money";
import { notify } from "@/lib/notify";
import type { PartnerRole } from "@/lib/partnerAuth/roles";
import { PARTNER_WORDS } from "@/lib/partnerAuth/portalAccess";
import type { PartnerLeadRow, PartnerPipelineStage } from "@/lib/partnerLeads/types";
import type { CampaignGroup } from "@/lib/partnerLeads/campaignsCore";
import { isSold } from "@/lib/partnerLeads/insights";
import { localDay, trendSeries } from "@/lib/partnerLeads/trend";
import { closerBoard, estimateCents, figures, inDays, isAccepted, monthToDate, reach, share, stageCounts, weekly, type MonthFigures } from "@/lib/partnerLeads/typeOverview";
import { termLabel, type PartnerTerm } from "@/lib/partners/payout";
import type { PartnerType } from "@/lib/partners/constants";

/**
 * The partner home by type (roles board P1–P3, owner 2026-11-18 "Build 1, 2 and 3"): the same portal
 * and the same reads, but the figures and cards follow the partner's job —
 *
 *   Publisher  transfers today · claimed or on a call · accepted this month · estimated payout ·
 *              compliance rejects (a count only); transfers per day, the closer leaderboard, the oldest
 *              unclaimed, the latest statement.
 *   Marketing  leads this month · form / call · contacted · converted · what is owed (or the rate);
 *              leads and conversions per week, leads by campaign, the own pipeline, recent outcomes.
 *   Affiliate  clicks · referrals · qualified · submitted · estimated payout; clicks to sales, my
 *              links, recent referrals, the latest statement.
 *
 * Every figure is a link to the rows behind it. Nothing here shows another partner, the agency's
 * commission (a revenue share shows its rate, never an estimate), the agent floor, or a rejected number
 * — compliance rejects are a count. Statements are the partner admin's (LA-7.4), so a partner user's
 * home draws its recent outcomes where the statement would be.
 *
 * Reads, all partner-scoped on the server: /api/partner/leads/pipeline (the window, the own pipeline's
 * stages and the terms in force), /api/partner/overview (the compliance count), /api/partner/payouts
 * (admins), /api/partner/campaigns (marketing), /api/partner/links (affiliates).
 */

type Status = "draft" | "active" | "paused" | "offboarded";
type Pipeline = { rows: PartnerLeadRow[]; stages: PartnerPipelineStage[]; terms: PartnerTerm | null; counters: { claimed: number } };
type StatementSummary = { id: string; periodStart: string; netCents: number; status: "published" | "paid"; line: string };
type Link_ = { id: string; slug: string; campaign: string | null; isActive: boolean; clicks: number; referrals: number };
type Data = {
  pipeline: Pipeline | null;
  rejected: number | null;
  statement: StatementSummary | null | undefined;
  campaigns: { groups: CampaignGroup[]; byCampaign: boolean } | null | undefined;
  links: Link_[] | null | undefined;
};

const REFRESH_MS = 60_000;
const PIPELINE = "/partner/pipeline";
const STATEMENTS = "/partner/payouts";

const n = (value: number) => value.toLocaleString("en-US");
const money = (cents: number) => formatCentsAsCurrency(cents).replace(/\.00$/, "");

async function json<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** The latest published statement, as one hero line: "374 accepted transfers × $30 · 2 credits · 1 open dispute". */
async function latestStatement(): Promise<StatementSummary | null> {
  const list = await json<{ runs?: Array<{ id: string; periodStart: string; netCents: number; status: "published" | "paid" }> }>("/api/partner/payouts?limit=1");
  const run = list?.runs?.[0];
  if (!run) return null;
  const detail = await json<{ statement?: { lines: Array<{ label: string; count: number; rateCents: number | null }>; revenueShare: { amountCents: number } | null; credits: { count: number }; disputes: Array<{ status: string }> } }>(`/api/partner/payouts/${run.id}`);
  const s = detail?.statement;
  const parts: string[] = [];
  for (const line of s?.lines ?? []) parts.push(line.rateCents != null ? `${n(line.count)} ${line.label.toLowerCase()} × ${money(line.rateCents)}` : `${n(line.count)} ${line.label.toLowerCase()}`);
  if (s?.revenueShare) parts.push("revenue share");
  if (s?.credits.count) parts.push(`${s.credits.count} ${s.credits.count === 1 ? "credit" : "credits"}`);
  const open = (s?.disputes ?? []).filter((d) => d.status === "open").length;
  if (open) parts.push(`${open} open ${open === 1 ? "dispute" : "disputes"}`);
  return { id: run.id, periodStart: run.periodStart, netCents: run.netCents, status: run.status, line: parts.join(" · ") || (run.status === "paid" ? "Paid" : "Published") };
}

function usePartnerHome(type: PartnerType, isAdmin: boolean, today: string) {
  const [data, setData] = useState<Data | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const month = monthToDate(today);
  // Publishers and marketing read this month and last (for the change badges); an affiliate's clicks are
  // a lifetime count, so its referrals are read for all time to sit on the same footing.
  const windowQuery = type === "affiliate" ? "limit=5000" : `limit=5000&date_from=${month.previousFrom}&date_to=${today}`;
  const load = useCallback(async () => {
    const [pipeline, overview, statement, campaigns, links] = await Promise.all([
      json<Pipeline>(`/api/partner/leads/pipeline?${windowQuery}`),
      json<{ rejectedCompliance: number | null }>("/api/partner/overview"),
      isAdmin ? latestStatement() : Promise.resolve(undefined),
      type === "marketing" ? json<{ groups: CampaignGroup[]; byCampaign: boolean }>(`/api/partner/campaigns?date_from=${month.from}&date_to=${today}`) : Promise.resolve(undefined),
      type === "affiliate" ? json<{ links: Link_[] }>("/api/partner/links").then((body) => body?.links ?? null) : Promise.resolve(undefined),
    ]);
    setData({ pipeline: pipeline && Array.isArray(pipeline.rows) ? pipeline : null, rejected: overview?.rejectedCompliance ?? null, statement, campaigns, links });
    setUpdatedAt(Date.now());
  }, [windowQuery, isAdmin, type, month.from, today]);
  useEffect(() => {
    const kickoff = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, REFRESH_MS);
    return () => { window.clearTimeout(kickoff); window.clearInterval(timer); };
  }, [load]);
  return { data, updatedAt, month };
}

export function PartnerTypeOverview({ role, partnerStatus, partnerName, partnerType }: { role: PartnerRole; partnerStatus: Status; partnerName: string; partnerType: PartnerType }) {
  const isAdmin = role === "partner_admin";
  const [today] = useState(() => localDay(new Date())!);
  const { data, updatedAt, month } = usePartnerHome(partnerType, isAdmin, today);
  const words = PARTNER_WORDS[partnerType];
  const canSubmit = partnerStatus === "active";
  const submitIcon = partnerType === "publisher" ? <Send aria-hidden="true" /> : <UserPlus aria-hidden="true" />;

  return (
    // At a laptop screen and up the home is exactly the stage's height (agency-dashboard look): two rows of
    // cards share it and clip what does not fit; below lg it stacks and scrolls like any page.
    <div className="m-stagger flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4 lg:h-[calc(100dvh-var(--top-bar-h)-3.5rem)]">
      <PageHeader
        title="Overview"
        description={`${partnerName} · ${partnerType === "publisher" ? "your transfers, what the agency accepted and what it pays" : partnerType === "marketing" ? "your leads, what happened to each, and what is owed" : "your links, your referrals and what they became"}.`}
        hideTitle
        breadcrumbs={[{ label: "Home" }, { label: "Overview" }]}
        actions={<>
          {updatedAt !== null && <LiveStamp updatedAt={updatedAt} staleAfterSeconds={120} />}
          {canSubmit && <Button asChild size="sm"><Link href={words.submitPath}>{submitIcon}{words.submitLabel}</Link></Button>}
        </>}
      />
      {!data ? <Loading /> : partnerType === "publisher"
        ? <PublisherHome data={data} today={today} month={month} isAdmin={isAdmin} />
        : partnerType === "marketing"
          ? <MarketingHome data={data} today={today} month={month} isAdmin={isAdmin} />
          : <AffiliateHome data={data} month={month} isAdmin={isAdmin} />}
    </div>
  );
}

/* ── Shared frame ─────────────────────────────────────────────────────────────────────────────── */

type Month = ReturnType<typeof monthToDate>;

/** The board's frame: five figures, then two rows of cards sharing the rest of the height. */
function Frame({ tiles, big, side, left, right }: { tiles: ReactNode; big: ReactNode; side: ReactNode; left: ReactNode; right: ReactNode }) {
  const fill = "lg:[&>*]:h-full lg:[&>*]:min-h-0 lg:[&>*]:overflow-hidden";
  return (
    <div className="m-dash flex min-h-0 flex-1 flex-col gap-4">
      {tiles}
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className={`grid min-w-0 grid-cols-1 gap-4 lg:min-h-0 ${fill} ${big && side ? "lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]" : ""}`}>{big}{side}</div>
        <div className={`grid min-w-0 grid-cols-1 gap-4 lg:min-h-0 ${fill} ${left && right ? "lg:grid-cols-2" : ""}`}>{left}{right}</div>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" aria-busy="true" aria-label="Loading your overview">
      <div className="m-glass grid h-[92px] grid-cols-5 gap-4 rounded-lg border border-border p-4">{Array.from({ length: 5 }, (_, index) => <span key={index} className="m-skel block h-full rounded" />)}</div>
      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1.75fr_1fr]"><HomePanelLoading title="Loading" tall /><HomePanelLoading title="Loading" /></div>
    </div>
  );
}

/** A change badge's figure: up good, never a percentage of nothing. */
function delta(now: number, before: number) {
  // A count against a count: the badge says "▲ 6", never "6%".
  return { value: now - before, unit: "", goodWhen: "up" as const };
}

function Tile({ label, value, href, footnote, change }: { label: string; value: string; href?: string; footnote?: string; change?: { value: number; unit?: string; goodWhen: "up" } }) {
  return <StatTile label={label} value={value} href={href} footnote={footnote} delta={change && change.value !== 0 ? change : undefined} reserveFootnote />;
}

/** The latest statement (admins), or the rows' recent outcomes for a partner user. */
function StatementCard({ statement, fallback }: { statement: StatementSummary | null | undefined; fallback: ReactNode }) {
  if (statement === undefined) return <>{fallback}</>;
  if (!statement) return <HomePanel title="Latest statement" link={{ label: "Statements", href: STATEMENTS }}><p className="m-0 text-sm text-muted-foreground">No published statement yet. Your agency publishes one at the end of each period.</p></HomePanel>;
  const monthName = new Date(`${statement.periodStart}T12:00:00`).toLocaleDateString("en-US", { month: "short" });
  return <DashHero kicker="Latest statement" value={`${money(statement.netCents)} · ${monthName}`} line={statement.line} href={STATEMENTS} />;
}

function rowItems(rows: readonly PartnerLeadRow[], detail: (row: PartnerLeadRow) => string): DashItem[] {
  return rows.map((row) => ({
    key: row.id,
    mark: initials(row.customer),
    tone: isSold(row) ? "good" : row.stageType === "lost" ? "danger" : "neutral",
    title: row.customer,
    detail: detail(row),
    value: row.stageName || undefined,
    href: `${PIPELINE}/${row.id}`,
  }));
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "—";
}

function ago(iso: string, now: number) {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

/** What the partner's terms say it is owed so far: an amount where it is arithmetic, else the rate. */
function owed(term: PartnerTerm | null, counts: MonthFigures) {
  const cents = estimateCents(term, counts);
  const rate = termLabel(term);
  if (cents !== null) return { value: money(cents), footnote: rate ? `at ${rate}` : "estimate" };
  if (term?.payoutModel === "revenue_share") return { value: rate ? `rate ${rate.replace(" revenue share", "")}` : "—", footnote: "revenue share · on your statement" };
  return { value: rate ?? "—", footnote: rate ? "your rate" : "no terms on file" };
}

const Unavailable = ({ title }: { title: string }) => <HomePanel title={title}><p className="m-0 text-sm text-muted-foreground">Could not load this. It retries on its own.</p></HomePanel>;

/* ── P1 · Publisher ───────────────────────────────────────────────────────────────────────────── */

function PublisherHome({ data, today, month, isAdmin }: { data: Data; today: string; month: Month; isAdmin: boolean }) {
  const [now] = useState(() => Date.now());
  const rows = useMemo(() => data.pipeline?.rows ?? [], [data.pipeline]);
  const thisMonth = useMemo(() => inDays(rows, month.from, today), [rows, month.from, today]);
  const lastMonth = useMemo(() => inDays(rows, month.previousFrom, month.previousTo), [rows, month.previousFrom, month.previousTo]);
  const yesterday = localDay(new Date(Date.parse(`${today}T12:00:00`) - 86_400_000))!;
  const todayCount = inDays(rows, today, today).length;
  const counts = figures(thisMonth);
  const before = figures(lastMonth);
  const pay = owed(data.pipeline?.terms ?? null, counts);
  const trend = trendSeries(thisMonth.map((row) => row.submittedAt), { from: month.from, to: today, now });
  const acceptedTrend = trendSeries(thisMonth.filter(isAccepted).map((row) => row.submittedAt), { from: month.from, to: today, now });
  const closers = closerBoard(thisMonth);
  const oldest = rows.filter((row) => row.status === "unclaimed").sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)).slice(0, 6);
  const tableLink = `${PIPELINE}?view=table&date_from=${month.from}`;

  const recent = <DashList title="Recent outcomes" link={{ label: "Pipeline", href: tableLink }} items={rowItems([...thisMonth].filter((row) => row.status === "completed").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6), (row) => row.submittedBy.name)} empty="No outcomes yet this month." />;
  return (
    <Frame
      tiles={<StatStrip label="Your transfers">
        <Tile label="Transfers today" value={n(todayCount)} href={`${PIPELINE}?view=table&date_from=${today}`} change={delta(todayCount, inDays(rows, yesterday, yesterday).length)} footnote="vs yesterday" />
        <Tile label="Claimed / on a call" value={n(data.pipeline?.counters.claimed ?? counts.held)} href={`${PIPELINE}?lane=claimed`} footnote="with a closer now" />
        <Tile label="Accepted this month" value={n(counts.accepted)} href={tableLink} change={delta(counts.accepted, before.accepted)} footnote="vs last month" />
        <Tile label="Est. payout" value={pay.value} href={isAdmin ? STATEMENTS : undefined} footnote={pay.footnote} />
        <Tile label="Compliance rejects" value={data.rejected == null ? "—" : n(data.rejected)} footnote="count only" />
      </StatStrip>}
      big={!data.pipeline ? <Unavailable title="Transfers per day" /> : (
        <DashChart title="Transfers per day" link={{ label: "Pipeline", href: tableLink }} total={`${n(counts.accepted)} accepted`} totalLine={`this month · ${n(counts.submitted)} sent`}>
          <LineSeries
            points={trend.buckets.map((bucket) => ({ key: bucket.key, label: bucket.label, value: bucket.count }))}
            lines={[{ key: "accepted", label: "Accepted", points: acceptedTrend.buckets.map((bucket) => ({ key: bucket.key, label: bucket.label, value: bucket.count })), figure: n(counts.accepted) }]}
            legend={{ label: "Sent", figure: n(counts.submitted) }}
            summary={`Transfers sent per day this month: ${counts.submitted} sent, ${counts.accepted} accepted`}
            unit="transfers"
            hrefFor={(point) => `${PIPELINE}?view=table&date_from=${point.key}&date_to=${point.key}`}
          />
        </DashChart>
      )}
      side={<DashTable title="Closer leaderboard" period="this month" link={isAdmin ? { label: "Team", href: "/partner/team-review" } : undefined} heads={["Closer", "Sent", "Accepted"]} rows={closers.map((closer) => ({ key: closer.id, cells: [closer.name, n(closer.sent), n(closer.accepted)], href: closer.id.startsWith("name:") ? tableLink : `${tableLink}&closer_id=${closer.id}` }))} empty="No transfers yet this month." />}
      left={<DashList title="Oldest unclaimed" link={{ label: "New", href: `${PIPELINE}?lane=new` }} items={oldest.map((row) => ({ key: row.id, mark: initials(row.customer), tone: "warning", title: `${row.customer} · sent ${ago(row.submittedAt, now)}`, detail: row.submittedBy.name, value: row.stageName || "New transfer", href: `${PIPELINE}/${row.id}` }))} empty="Nothing is waiting to be claimed." />}
      right={<StatementCard statement={data.statement} fallback={recent} />}
    />
  );
}

/* ── P2 · Marketing ───────────────────────────────────────────────────────────────────────────── */

function MarketingHome({ data, today, month, isAdmin }: { data: Data; today: string; month: Month; isAdmin: boolean }) {
  const rows = useMemo(() => data.pipeline?.rows ?? [], [data.pipeline]);
  const thisMonth = useMemo(() => inDays(rows, month.from, today), [rows, month.from, today]);
  const lastMonth = useMemo(() => inDays(rows, month.previousFrom, month.previousTo), [rows, month.previousFrom, month.previousTo]);
  const counts = figures(thisMonth);
  const before = figures(lastMonth);
  const contacted = share(counts.accepted, counts.submitted);
  const contactedBefore = share(before.accepted, before.submitted);
  const pay = owed(data.pipeline?.terms ?? null, counts);
  const groups = data.campaigns?.groups ?? [];
  const form = groups.reduce((sum, group) => sum + group.form, 0);
  const call = groups.reduce((sum, group) => sum + group.call, 0);
  const weeks = weekly(thisMonth, month.from, today);
  const stages = stageCounts(data.pipeline?.stages ?? [], thisMonth).filter((stage) => stage.stageType !== "lost");
  const steps: DashStep[] = stages.map((stage) => ({ key: stage.id, label: stage.name, count: stage.count, pct: share(stage.count, counts.submitted) ?? 0, href: `${PIPELINE}?view=table&stage_id=${stage.id}` }));
  const outcomes = [...thisMonth].filter((row) => row.status === "completed" || row.stageType === "lost" || row.stageType === "won").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
  const tableLink = `${PIPELINE}?view=table&date_from=${month.from}`;
  return (
    <Frame
      tiles={<StatStrip label="Your leads">
        <Tile label="Leads this month" value={n(counts.submitted)} href={tableLink} change={delta(counts.submitted, before.submitted)} footnote="vs last month" />
        <Tile label="Form / call" value={data.campaigns ? `${n(form)} / ${n(call)}` : "—"} href="/partner/campaigns" footnote="by entry stage" />
        <Tile label="Contacted" value={contacted == null ? "—" : `${contacted}%`} href={tableLink} change={contacted != null && contactedBefore != null ? { value: contacted - contactedBefore, unit: " pts", goodWhen: "up" } : undefined} footnote="taken by the agency" />
        <Tile label="Converted" value={n(counts.sold)} href={`${PIPELINE}?lane=converted`} change={delta(counts.sold, before.sold)} footnote="this month" />
        <Tile label="Owed so far" value={pay.value} href={isAdmin ? STATEMENTS : undefined} footnote={pay.footnote} />
      </StatStrip>}
      big={!data.pipeline ? <Unavailable title="Leads and conversions per week" /> : (
        <DashChart title="Leads and conversions per week" link={{ label: "Pipeline", href: tableLink }} total={`${n(counts.submitted)} leads · ${n(counts.sold)} converted`} totalLine="this month">
          <LineSeries
            points={weeks.map((week) => ({ key: week.key, label: week.label, value: week.leads }))}
            lines={[{ key: "converted", label: "Converted", points: weeks.map((week) => ({ key: week.key, label: week.label, value: week.converted })), figure: n(counts.sold) }]}
            legend={{ label: "Leads", figure: n(counts.submitted) }}
            summary={`Leads per week this month: ${counts.submitted} leads, ${counts.sold} converted`}
            unit="leads"
          />
        </DashChart>
      )}
      side={data.campaigns === null ? <Unavailable title="By campaign" /> : (
        <DashTable
          title={data.campaigns?.byCampaign ? "By campaign" : "By source"}
          period={data.campaigns?.byCampaign ? "this month" : "no campaign stored"}
          link={{ label: "Campaigns", href: "/partner/campaigns" }}
          heads={["Campaign", "Leads", "Conv."]}
          rows={groups.slice(0, 6).map((group) => ({ key: group.key, cells: [group.label, n(group.leads), n(group.converted)], href: "/partner/campaigns" }))}
          empty="No leads yet this month."
        />
      )}
      left={<DashFunnel title="Your pipeline" period="this month" link={{ label: "Pipeline", href: PIPELINE }} rate={`${share(counts.sold, counts.submitted) ?? 0}% converted`} steps={steps} />}
      right={<DashList title="Recent outcomes" link={{ label: "Pipeline", href: tableLink }} items={rowItems(outcomes, (row) => row.product)} empty="No outcomes yet this month." />}
    />
  );
}

/* ── P3 · Affiliate ───────────────────────────────────────────────────────────────────────────── */

function AffiliateHome({ data, month, isAdmin }: { data: Data; month: Month; isAdmin: boolean }) {
  const rows = useMemo(() => data.pipeline?.rows ?? [], [data.pipeline]);
  const links = data.links ?? [];
  const clicks = links.reduce((sum, link) => sum + link.clicks, 0);
  const thisMonth = inDays(rows, month.from, month.to).length;
  const counts = figures(rows);
  const pay = owed(data.pipeline?.terms ?? null, counts);
  const reached = reach(stageCounts(data.pipeline?.stages ?? [], rows));
  const qualified = reached.find((stage) => /qualif/i.test(stage.name)) ?? reached[2] ?? null;
  const submitted = reached.find((stage) => stage.stageType === "won") ?? null;
  const steps: DashStep[] = [
    { key: "clicks", label: "Clicks", count: clicks, pct: 100, href: "/partner/links" },
    { key: "referrals", label: "Referrals", count: rows.length, pct: share(rows.length, clicks) ?? 0, href: PIPELINE },
    ...reached.slice(1).map((stage) => ({ key: stage.id, label: stage.name, count: stage.count, pct: share(stage.count, clicks) ?? 0, href: `${PIPELINE}?view=table&stage_id=${stage.id}` })),
  ];
  const recent = [...rows].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)).slice(0, 6);
  const active = links.filter((link) => link.isActive);
  return (
    <Frame
      tiles={<StatStrip label="Your referrals">
        <Tile label="Clicks" value={data.links ? n(clicks) : "—"} href="/partner/links" footnote={`all time · ${active.length} ${active.length === 1 ? "link" : "links"} active`} />
        <Tile label="Referrals" value={n(rows.length)} href={PIPELINE} footnote={`${n(thisMonth)} this month`} />
        <Tile label="Qualified" value={qualified ? n(qualified.count) : "—"} href={qualified ? `${PIPELINE}?view=table&stage_id=${qualified.id}` : PIPELINE} footnote="reached qualified" />
        <Tile label="Submitted" value={n(submitted?.count ?? counts.sold)} href={submitted ? `${PIPELINE}?view=table&stage_id=${submitted.id}` : `${PIPELINE}?lane=converted`} footnote="applications" />
        <Tile label="Est. payout" value={pay.value} href={isAdmin ? STATEMENTS : undefined} footnote={pay.footnote} />
      </StatStrip>}
      big={<DashFunnel title="Clicks to sales" period="all time" link={{ label: "Referrals", href: PIPELINE }} rate={`${share(submitted?.count ?? counts.sold, clicks) ?? 0}% of clicks`} steps={steps} />}
      side={<MyLinkCard links={data.links} />}
      left={<DashList title="Recent referrals" link={{ label: "Referrals", href: PIPELINE }} items={rowItems(recent, (row) => new Date(row.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }))} empty="No referrals yet. Share your link, or refer someone yourself." />}
      right={isAdmin ? <StatementCard statement={data.statement} fallback={null} /> : null}
    />
  );
}

function linkUrl(slug: string) {
  return `${typeof window === "undefined" ? "" : window.location.origin}/affiliate/${slug}`;
}

export async function copyLink(slug: string) {
  try {
    await navigator.clipboard.writeText(linkUrl(slug));
    notify.done("Link copied");
  } catch {
    notify.block("Could not copy. Select the link and copy it yourself.");
  }
}

/** "My link": the active tracked links with a copy button each (read-only; the agency makes them). */
function MyLinkCard({ links }: { links: Link_[] | null | undefined }) {
  if (links === null) return <Unavailable title="My link" />;
  const active = (links ?? []).filter((link) => link.isActive);
  const clicks = (links ?? []).reduce((sum, link) => sum + link.clicks, 0);
  return (
    <HomePanel title={active.length > 1 ? "My links" : "My link"} link={{ label: "All links", href: "/partner/links" }} footer={<span>{active.length} {active.length === 1 ? "link" : "links"} active · {n(clicks)} clicks, all time</span>}>
      {!active.length ? <p className="m-0 text-sm text-muted-foreground">No active link yet. Your agency creates your tracked links; message them to ask for one.</p> : (
        <ul className="m-0 flex min-h-0 list-none flex-col gap-2 overflow-hidden p-0">
          {active.slice(0, 3).map((link) => (
            <li key={link.id} className="flex items-center gap-2 rounded-xl bg-[var(--surface-tile)] px-3 py-2 shadow-[inset_0_0_0_1px_var(--tile-edge)]">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-xs text-foreground">/affiliate/{link.slug}</span>
                <span className="block truncate text-xs text-muted-foreground">{link.campaign ?? "No campaign"} · {n(link.clicks)} clicks</span>
              </span>
              <Button type="button" variant="outline" size="xs" onClick={() => void copyLink(link.slug)} aria-label={`Copy the link /affiliate/${link.slug}`}><Copy aria-hidden="true" />Copy</Button>
            </li>
          ))}
        </ul>
      )}
    </HomePanel>
  );
}
