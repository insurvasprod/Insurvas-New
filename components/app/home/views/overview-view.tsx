import { Suspense, type ReactNode } from "react";
import { BookOpen, Calculator, FilePenLine, LifeBuoy, ShieldCheck, Users } from "lucide-react";

import { DashBars, DashChart, DashHero, DashList, DashModules, DashPhone, DashRecent, DashRing, DashTable, type DashBar, type DashItem, type DashLine, type DashNeed, type DashTone } from "@/components/app/home/dash/dash-kit";
import { DashNeedsLive } from "@/components/app/home/dash/dash-needs-live";
import { GoalSheetButton } from "@/components/app/home/goal-sheet";
import { HomePanel } from "@/components/app/home/home-panel";
import { funnelCard, lastDay, premiumCard } from "./agency-cards";
import { BarSeries, LineSeries } from "@/components/ui/chart";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { cn } from "@/lib/utils";
import { personName } from "@/lib/format/personName";
import { issuedIn, monthName, monthOf, pctChange, placementOf, submittedIn } from "@/lib/dashboard/views/agency";
import { dayKey, gaugeMax, recentBusiness, salesAverage, salesToday, versusAverage, type SalesSnapshot } from "@/lib/dashboard/views/sales";
import { attentionItems, clock, hourText, scheduleItems, weekTotals, type AttentionLinks, type DueCallback } from "@/lib/dashboard/homeView";
import { HOME_GOAL, issuedByMonths, issuedByWeeks, ringOf, type HomeKind, type HomePageKey } from "@/lib/dashboard/homeKinds";
import { GOAL_MONEY } from "@/lib/dashboard/goalRules";
import { APPLICATION_OUTCOME_LABEL, APPLICATION_OUTCOME_TONE, APPLICATION_STATUS_LABEL, APPLICATION_STATUS_TONE } from "@/lib/applications/constants";
import { STEP_LABELS } from "@/lib/retention/cases/ladder";
import type { ApplicationRow } from "@/lib/applications/listRules";
import type { DashboardToday } from "@/lib/dashboard/today";
import type { DashboardMoney } from "@/lib/dashboard/money";
import type { DashboardViewKey } from "@/lib/dashboard/views";
import type { GoalRead } from "@/lib/dashboard/goals";
import { loadLeadsView } from "@/lib/dashboard/views/leads";
import { casesHref, loadRetentionView, rateText, SCORE_PERIOD } from "@/lib/dashboard/views/retention";
import { loadBookView } from "@/lib/dashboard/views/book";
import { loadAccountingView } from "@/lib/dashboard/views/accounting";
import { loadComplianceView } from "@/lib/dashboard/views/compliance";
import { leadsHeadline } from "./leads-view";
import { retentionHeadline, retentionNeeds } from "./retention-view";
import { bookHeadline, bookIssuedChart } from "./book-view";
import { accountingHeadline, accountingNeeds } from "./accounting-view";
import { complianceHeadline, complianceNeeds } from "./compliance-view";
import type { DashViewProps } from "./view-props";

/**
 * The dashboard's Home (roles r1, owner 2026-11-18: board docs/design/roles-r1/dashboards-and-partners.html screens
 * 1–8, "Build 2"): one compact layout for every role, each role with its own cards, fitting the screen like the
 * module views (no page scroll from lg up):
 *
 *   Needs you     the low strip: what waits on this person across every module of the plan, with the blocks the
 *                 spec keeps on Home folded in — setup (LA-0.3), close-outs (LA-2.12), pending cases (LA-3.15) and
 *                 the one upgrade line (Sixteen #15)
 *   My numbers    the role's figures, each with its change against the period before and its shape
 *   main          the role's big chart beside its goal or side card, then two working cards
 *   right column  the role's hero (money in, My pay, the scorecard, the queue…), then Today
 *
 * Every figure opens the page behind it, filtered. Money only for a reader with the money permission
 * (`viewProps.noMoney`, lib/dashboard/access): a manager, setter, assistant or retention rep sees counts. Each
 * module's figures come from that module's own view loader (`forOverview`), only for the modules this reader's
 * views offer; every read keeps the view's scope and the menu's gate.
 */
type Pending = { awaitingPolicyNumber: { count: number }; waitingOnClient: { count: number }; counteroffersExpiring: { count: number } } | null;
type Due = ReadonlyArray<DueCallback & { leadId?: string }>;

export type HomeViewProps = {
  kind: HomeKind;
  today: Promise<DashboardToday | null>;
  money: Promise<DashboardMoney | null> | null;
  callbacks: Promise<Due | null>;
  links: AttentionLinks;
  pendingHref: string | null;
  closeOutHref: string | null;
  activityHref: string | null;
  calendarHref: string | null;
  callbacksHref: string | null;
  dialerHref: string | null;
  /** The lead's own page, when the reader can open leads. */
  leadHref: (leadId: string) => string | null;
  /** Sixteen #15: the one upgrade line, when the agency's own data makes the case. */
  upgrade: { featureHref: string; rowsHref: string } | null;
  /** LA-0.3: setup steps still open, folded into Needs you; null when finished or hidden. */
  setup: { left: number; href: string } | null;
  zone: string;
  /** The module views this reader is offered: the modules the Home reads. */
  views: readonly DashboardViewKey[];
  viewProps: DashViewProps;
  /** Sales has no view: its page and pending cases, when the reader may open applications. */
  sales: { href: string; pending: Promise<Pending>; snapshot: Promise<SalesSnapshot<ApplicationRow> | null> } | null;
  /** The role's daily pages this reader can open (lib/dashboard/homeKinds HOME_PAGES). */
  pages: Partial<Record<HomePageKey, string | null>>;
  /** The ring's stored goal (null: this home has none) and whether this reader may set it. */
  goal: { read: Promise<GoalRead>; canSet: boolean } | null;
  /** A producer's own balance from the pay ledger (My pay), when they may open it. */
  myPay: Promise<{ owedCents: number } | null> | null;
};

type Reads = {
  data: Promise<DashboardToday | null>;
  money: Promise<DashboardMoney | null>;
  due: Promise<Due | null>;
  leads: Promise<Awaited<ReturnType<typeof loadLeadsView>> | null>;
  retention: Promise<Awaited<ReturnType<typeof loadRetentionView>> | null>;
  book: Promise<Awaited<ReturnType<typeof loadBookView>> | null>;
  accounting: Promise<Awaited<ReturnType<typeof loadAccountingView>> | null>;
  compliance: Promise<Awaited<ReturnType<typeof loadComplianceView>> | null>;
  pending: Promise<Pending>;
  deals: Promise<SalesSnapshot<ApplicationRow> | null>;
  goal: Promise<GoalRead | null>;
  myPay: Promise<{ owedCents: number } | null>;
};
type RowProps = HomeViewProps & { reads: Reads };

const fill = "lg:[&>*]:h-full lg:[&>*]:min-h-0 lg:[&>*]:overflow-hidden";

/**
 * Every read starts once, together; each part of the page is its own Suspense boundary holding its own place, so a
 * part lands as soon as its reads do (speed pass 2026-11-10).
 */
export function HomeView(props: HomeViewProps) {
  const { views, viewProps, sales, today, money, callbacks, kind } = props;
  const has = (key: DashboardViewKey) => views.includes(key);
  const safe = <T,>(read: () => Promise<T>) => read().catch(() => null);
  const lite: DashViewProps = { ...viewProps, forOverview: true };
  const reads: Reads = {
    data: today,
    money: money ?? Promise.resolve(null),
    due: callbacks,
    leads: has("leads") ? safe(() => loadLeadsView(lite)) : Promise.resolve(null),
    retention: has("retention") ? safe(() => loadRetentionView(lite)) : Promise.resolve(null),
    book: has("book") ? safe(() => loadBookView(lite)) : Promise.resolve(null),
    // The bookkeeper's Home is the money: the whole Accounting read (the month's trend, what came in, what is owed out).
    accounting: has("accounting") ? safe(() => loadAccountingView(kind === "bookkeeper" ? viewProps : lite)) : Promise.resolve(null),
    // The owner's Needs you carries the compliance gaps; no other home draws them.
    compliance: has("compliance") && (kind === "owner" || kind === "solo") ? safe(() => loadComplianceView(lite)) : Promise.resolve(null),
    pending: sales ? sales.pending.catch(() => null) : Promise.resolve(null),
    deals: sales ? sales.snapshot.catch(() => null) : Promise.resolve(null),
    goal: props.goal ? props.goal.read.catch(() => null) : Promise.resolve(null),
    myPay: props.myPay ? props.myPay.catch(() => null) : Promise.resolve(null),
  };
  const row = { ...props, reads };
  return (
    // m-dash-ov (§ Motion, 2026-11-09): the parts rise in one after another. From lg up the Home is exactly the screen's
    // height (the page root locks it); the two card rows share what the strips leave.
    <div className="m-dash-ov flex w-full min-w-0 flex-col gap-3 lg:min-h-0 lg:flex-1">
      <Suspense fallback={<StripSkeleton tall={false} />}><NeedsRow {...row} /></Suspense>
      <Suspense fallback={<StripSkeleton tall />}><NumbersRow {...row} /></Suspense>
      <div className="grid min-w-0 grid-cols-1 items-stretch gap-3 lg:min-h-0 lg:flex-1 xl:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 grid-cols-1 gap-3 lg:min-h-0 lg:grid-rows-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <Suspense fallback={<RowSkeleton className="lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" />}><TopRow {...row} /></Suspense>
          <Suspense fallback={<RowSkeleton className="lg:grid-cols-2" />}><LowerRow {...row} /></Suspense>
        </div>
        <Suspense fallback={<RowSkeleton className="lg:grid-rows-[auto_minmax(0,1fr)]" />}><RightColumn {...row} /></Suspense>
      </div>
    </div>
  );
}

/* ── Needs you ─────────────────────────────────────────────────────────────────────────────────── */

async function NeedsRow({ kind, reads, links, upgrade, pendingHref, closeOutHref, setup, dialerHref, activityHref }: RowProps) {
  const [data, moneyData, leads, retention, book, accounting, compliance] = await Promise.all([reads.data, reads.money, reads.leads, reads.retention, reads.book, reads.accounting, reads.compliance]);
  const needs: DashNeed[] = attentionItems(data, links).map((item) => ({ key: item.key, count: item.count, label: sentence(item.label), detail: item.detail, tone: item.tone, href: item.href }));
  // LA-0.3: the setup checklist stays on Home until it is done, as one tile (it opens Get set up).
  if (setup && setup.left > 0) needs.push({ key: "setup", count: setup.left, label: setup.left === 1 ? "Setup step left" : "Setup steps left", detail: "Get set up", tone: "info", href: setup.href });
  // Sixteen #15: the one upgrade line, only when the agency's own data makes the case.
  if (upgrade && moneyData?.exposurePolicies) {
    needs.push({ key: "upgrade", count: moneyData.exposurePolicies, label: moneyData.exposurePolicies === 1 ? "Policy you could protect" : "Policies you could protect", detail: "Inside the chargeback window", tone: "info", href: upgrade.featureHref });
  }
  // The setter's own queue and the week's no-shows (the setter scorecard).
  if (kind === "setter") {
    if (dialerHref && data?.queueReady) needs.push({ key: "queue", count: data.queueReady, label: data.queueReady === 1 ? "Lead ready to dial" : "Leads ready to dial", tone: "info", href: dialerHref });
    if (activityHref && data?.setterWeek?.noShow) needs.push({ key: "no-shows", count: data.setterWeek.noShow, label: data.setterWeek.noShow === 1 ? "No-show to rebook" : "No-shows to rebook", detail: "last 7 days", tone: "warning", href: activityHref });
  }
  // The bookkeeper's statements to review (the money profile's first figure).
  if (kind === "bookkeeper") {
    const statements = moneyData?.figures.find((figure) => figure.key === "statements");
    const count = statements ? Number(statements.value.replace(/[^\d]/g, "")) : 0;
    if (statements && count > 0) needs.push({ key: "statements", count, label: count === 1 ? "Statement to review" : "Statements to review", detail: statements.caption, tone: "warning", href: statements.href });
  }
  for (const item of [...(leads?.needs ?? []), ...(retention ? retentionNeeds(retention) : []), ...(book?.needs ?? []), ...(accounting ? accountingNeeds(accounting) : []), ...(compliance ? complianceNeeds(compliance) : [])]) {
    if (!needs.some((need) => need.key === item.key)) needs.push(item);
  }
  return <DashNeedsLive compact items={needs} pendingHref={pendingHref} closeOutHref={closeOutHref} />;
}

/* ── My numbers ────────────────────────────────────────────────────────────────────────────────── */

async function NumbersRow(props: RowProps) {
  const { kind, reads, viewProps, zone, sales, activityHref, calendarHref, callbacksHref, pages } = props;
  const [data, moneyData, book, deals, accounting, retention] = await Promise.all([reads.data, reads.money, reads.book, reads.deals, reads.accounting, reads.retention]);
  const money = !viewProps.noMoney;
  const todayKey = dayKey(viewProps.now, zone);
  const month = monthOf(todayKey);
  const previous = monthOf(todayKey, -1);
  const soFar = Number(todayKey.slice(8, 10));
  const rows = book?.book?.rows ?? null;
  const apps = deals?.applications ?? null;
  const policiesHref = book?.links.policies ?? pages.policies ?? null;
  const monthHref = policiesHref ? `${policiesHref}?from=${month}-01&to=${lastDay(month)}` : undefined;
  const tiles: ReactNode[] = [];
  const spark = (points: number[]) => (points.length > 1 && points.some((value) => value > 0) ? { points, tone: "primary" as const, placement: "under" as const } : undefined);

  const issuedPremium = () => {
    if (!rows || !money) return;
    const now = issuedIn(rows, month);
    const then = issuedIn(rows, previous, soFar);
    const change = pctChange(now.cents, then.cents);
    tiles.push(<StatTile key="premium" label="Issued premium" value={dollars(now.cents)} delta={change !== null ? { value: change } : undefined} trend={spark(issuedByMonths(rows, todayKey).map((m) => m.cents))} href={monthHref} />);
  };
  const policiesIssued = (label: string) => {
    if (!rows) return;
    const now = issuedIn(rows, month);
    const then = issuedIn(rows, previous, soFar);
    tiles.push(<StatTile key="issued" label={label} value={count(now.count)} delta={now.count !== then.count ? { value: now.count - then.count, unit: "" } : undefined} trend={spark(issuedByMonths(rows, todayKey).map((m) => m.count))} href={monthHref} />);
  };
  const appsSubmitted = () => {
    if (!apps || !sales) return;
    const now = submittedIn(apps, month, zone);
    const then = submittedIn(apps, previous, zone);
    tiles.push(<StatTile key="apps" label="Apps submitted" value={count(now)} delta={then && now !== then ? { value: now - then, unit: "" } : undefined} footnote={`${monthName(month)} so far`} href={sales.href} />);
  };
  const placement = () => {
    if (!apps || !sales) return;
    const placed = placementOf(apps, month, zone);
    const before = placementOf(apps, previous, zone);
    if (!placed) return;
    tiles.push(<StatTile key="placement" label="Placement" value={`${placed.pct}%`} delta={before && placed.pct !== before.pct ? { value: placed.pct - before.pct, unit: " pts" } : undefined} footnote={`${count(placed.issued)} of ${count(placed.submitted)} issued`} href={sales.href} />);
  };
  const contactRate = () => {
    if (!data || !activityHref) return;
    const week = weekTotals(data.series);
    if (!week.read || week.rate === null) return;
    const change = week.priorRate === null ? null : Math.round(week.rate - week.priorRate);
    const points = data.series.slice(-7).map((day) => (day.dials ? Math.round(((day.contacts ?? 0) / day.dials) * 100) : 0));
    tiles.push(<StatTile key="rate" label="Contact rate" value={`${Math.round(week.rate)}%`} delta={change ? { value: change, unit: " pts" } : undefined} footnote="Last 7 days" trend={spark(points)} href={activityHref} />);
  };
  const dialsToday = () => {
    if (!data || data.dialsToday === null || !activityHref) return;
    const change = data.dialsYesterday ? data.dialsToday - data.dialsYesterday : null;
    tiles.push(<StatTile key="dials" label="Dials today" value={count(data.dialsToday)} delta={change ? { value: change, unit: "" } : undefined} footnote="Against yesterday at this time" trend={spark(data.series.map((day) => day.dials ?? 0))} href={activityHref} />);
  };
  const commissionIn = () => {
    const statement = money ? accounting?.statement ?? null : null;
    if (!statement || !accounting) return;
    tiles.push(<StatTile key="commission" label="Commission in" value={dollars(statement.inCents)} footnote={`From carriers · ${accounting.month.label}`} href={accounting.hrefs.pnl ?? "/app/dashboard?view=accounting"} />);
  };
  const moneyFigure = (key: string) => {
    const figure = moneyData?.figures.find((item) => item.key === key);
    if (figure && money) tiles.push(<StatTile key={`m-${key}`} label={figure.label} value={figure.value} valueTone={figure.tone === "danger" || figure.tone === "warning" ? "warning" : undefined} footnote={figure.caption} href={figure.href} />);
  };

  switch (kind) {
    case "owner": {
      issuedPremium();
      policiesIssued("Policies issued");
      placement();
      if (retention?.persistency13) tiles.push(<StatTile key="m13" label="13-month persistency" value={retention.persistency13.text} footnote="Still paying after a year" href={retention.links.persistency ? `${retention.links.persistency}?view=persistency` : undefined} />);
      moneyFigure("exposure");
      if (tiles.length < 5) commissionIn();
      break;
    }
    case "solo":
      issuedPremium();
      appsSubmitted();
      placement();
      contactRate();
      commissionIn();
      break;
    case "manager":
      policiesIssued("Team policies issued");
      appsSubmitted();
      placement();
      dialsToday();
      break;
    case "producer": {
      issuedPremium();
      appsSubmitted();
      placement();
      contactRate();
      const closeOut = data?.closeOut;
      const total = closeOut ? closeOut.showed + closeOut.noShow + closeOut.awaiting : 0;
      if (closeOut && total && activityHref) tiles.push(<StatTile key="closeout" label="Close-out" value={`${Math.round(((closeOut.showed + closeOut.noShow) / total) * 100)}%`} footnote={closeOut.awaiting ? `${count(closeOut.awaiting)} need an outcome` : "Every appointment closed out"} href={activityHref} />);
      break;
    }
    case "setter": {
      const week = data?.setterWeek ?? null;
      if (week && activityHref) {
        const days = week.days.map((day) => day.booked);
        tiles.push(<StatTile key="booked" label="Booked this week" value={count(week.booked)} footnote="Last 7 days" trend={spark(days)} href={activityHref} />);
        tiles.push(<StatTile key="shown" label="Shown" value={count(week.showed)} footnote={`${count(week.noShow)} no-show`} href={activityHref} />);
        // LA-2.12 / Sixteen #12: a show rate never travels without its coverage.
        if (week.booked) tiles.push(<StatTile key="show-rate" label="Show rate" value={`${Math.round((week.showed / week.booked) * 100)}%`} footnote={`Closed out ${count(week.closedOut)} of ${count(week.closeable)}`} href={activityHref} />);
      }
      dialsToday();
      contactRate();
      break;
    }
    case "assistant": {
      const needs = data?.needs;
      const inboundHref = pages.inbound ?? null;
      if (needs?.transfersWaiting !== null && needs?.transfersWaiting !== undefined && inboundHref) tiles.push(<StatTile key="waiting" label="Transfers waiting" value={count(needs.transfersWaiting)} footnote={needs.slaBreaching ? `${count(needs.slaBreaching)} past the wait limit` : "None past the wait limit"} href={inboundHref} />);
      if (needs?.oldestWaitingSeconds !== null && needs?.oldestWaitingSeconds !== undefined && inboundHref) tiles.push(<StatTile key="oldest" label="Longest wait" value={waitText(needs.oldestWaitingSeconds)} footnote={needs.slaMinutes ? `Limit ${needs.slaMinutes} min` : "Waiting now"} href={inboundHref} />);
      if (data?.inboundToday && inboundHref) tiles.push(<StatTile key="inbound" label="Transfers today" value={count(data.inboundToday.total)} footnote="Sent in today" trend={spark(data.inboundToday.byHour.map((hour) => hour.count))} href={inboundHref} />);
      if (needs?.callbacksToday !== null && needs?.callbacksToday !== undefined && callbacksHref) tiles.push(<StatTile key="callbacks" label="Callbacks due today" value={count(needs.callbacksToday)} footnote={needs.callbacksOverdue ? `${count(needs.callbacksOverdue)} overdue` : "None overdue"} href={callbacksHref} />);
      if (data?.appointmentsToday !== null && data?.appointmentsToday !== undefined && calendarHref) tiles.push(<StatTile key="appointments" label="Appointments today" value={count(data.appointmentsToday)} href={calendarHref} />);
      break;
    }
    case "bookkeeper":
      for (const key of ["statements", "discrepancies", "owed", "exposure"]) moneyFigure(key);
      commissionIn();
      break;
    case "retention": {
      const cases = retention?.cases ?? null;
      const casesLink = retention?.links.cases ?? null;
      if (cases && casesLink) {
        const months = cases.months;
        const last = months[months.length - 2];
        const closed = casesHref(casesLink, { step: "closed" });
        tiles.push(<StatTile key="saved" label="Saved this month" value={count(cases.thisMonth.saved)} delta={last && cases.thisMonth.saved !== last.saved ? { value: cases.thisMonth.saved - last.saved, unit: "" } : undefined} trend={spark(months.map((m) => m.saved))} href={closed} />);
        const decided = cases.score.saved + cases.score.lost;
        if (decided) tiles.push(<StatTile key="rate" label="Save rate" value={rateText(cases.score)} footnote="Last 6 months" href={retention?.links.scorecard ? `${retention.links.scorecard}?period=${SCORE_PERIOD}` : closed} />);
        tiles.push(<StatTile key="open" label="Open cases" value={count(cases.open)} href={casesLink} />);
        tiles.push(<StatTile key="past" label="Past deadline" value={count(cases.pastDue)} valueTone={cases.pastDue ? "warning" : undefined} href={casesHref(casesLink, { deadline: "over" })} />);
        tiles.push(<StatTile key="lost" label="Lost this month" value={count(cases.thisMonth.lost)} href={closed} />);
      }
      break;
    }
  }
  if (!tiles.length) return null;
  return <StatStrip label="My numbers">{tiles.slice(0, 5)}</StatStrip>;
}

/* ── Big chart + side card ─────────────────────────────────────────────────────────────────────── */

async function TopRow(props: RowProps) {
  const { kind, reads, zone, viewProps, activityHref, pages } = props;
  const [data, book, deals, accounting, retention, goal] = await Promise.all([reads.data, reads.book, reads.deals, reads.accounting, reads.retention, reads.goal]);
  const money = !viewProps.noMoney;
  const todayKey = dayKey(viewProps.now, zone);
  const month = monthOf(todayKey);
  const previous = monthOf(todayKey, -1);
  const rows = book?.book?.rows ?? null;
  const policiesHref = book?.links.policies ?? pages.policies ?? null;
  const series = data?.series ?? [];
  let big: ReactNode = null;
  let side: ReactNode = null;

  switch (kind) {
    case "owner":
    case "solo":
    case "producer":
      big = (rows && deals && money ? premiumCard({ rows, apps: deals.applications, today: todayKey, zone, policiesHref, facts: false }) : null) ?? (book ? bookIssuedChart(book) : null) ?? callsChart(data, activityHref, series);
      side = rows ? goalRing(props, goal, { value: money ? issuedIn(rows, month).cents : issuedIn(rows, month).count, last: money ? issuedIn(rows, previous).cents : issuedIn(rows, previous).count, money, monthKey: month, policiesHref, title: kind === "owner" ? `${monthName(month)} goal` : "My goal", unit: money ? "$" : "policies" }) : null;
      break;
    case "manager": {
      if (rows) {
        const weeks = issuedByWeeks(rows, todayKey);
        const issued = issuedIn(rows, month).count;
        big = (
          <DashChart title="Team policies issued" link={policiesHref ? { label: "Policies", href: `${policiesHref}?from=${weeks[0].key}&to=${todayKey}` } : undefined} total={count(issued)} totalLine={`issued in ${monthName(month)} · counts only`}>
            <LineSeries points={weeks.map((week) => ({ key: week.key, label: `Week of ${week.label}`, value: week.count }))} summary={`Policies your team issued each week over the last ${weeks.length} weeks.`} unit="policies" hrefFor={policiesHref ? (point) => `${policiesHref}?from=${point.key}&to=${addDays(point.key, 6)}` : undefined} />
          </DashChart>
        );
        side = goalRing(props, goal, { value: issued, last: issuedIn(rows, previous).count, money: false, monthKey: month, policiesHref, title: "Team goal", unit: "policies" });
      } else big = callsChart(data, activityHref, series);
      break;
    }
    case "setter": {
      const week = data?.setterWeek ?? null;
      if (week && activityHref) {
        const target = goal?.state === "set" ? goal.target : null;
        const perDay = target ? Math.ceil(target / 5) : null;
        big = (
          <DashChart title="Booked per day" link={{ label: "My scorecard", href: activityHref }} total={count(week.booked)} totalLine={target ? `booked this week · target ${count(target)}` : "booked · last 7 days"}>
            {week.days.length > 1 ? (
              <LineSeries
                points={week.days.map((day) => ({ key: day.day, label: shortDay(day.day), value: day.booked }))}
                compare={perDay ? { points: week.days.map((day) => ({ key: day.day, label: shortDay(day.day), value: perDay })), label: "Daily pace" } : undefined}
                summary="Appointments you booked each day of the last week."
                unit="booked"
                hrefFor={(point) => `${activityHref}?from=${point.key}&to=${point.key}`}
              />
            ) : <p className="m-0 text-sm text-muted-foreground">Your days show here once you book from the dialer.</p>}
          </DashChart>
        );
        side = goalRing(props, goal, { value: week.booked, last: null, money: false, monthKey: month, policiesHref: activityHref, title: "Weekly target", unit: "appointments" });
      }
      break;
    }
    case "assistant": {
      const inbound = data?.inboundToday ?? null;
      const inboundHref = pages.inbound ?? null;
      if (inbound && inboundHref) {
        const busiest = inbound.byHour.reduce((top, hour) => (hour.count > top.count ? hour : top), { hour: -1, count: 0 });
        big = (
          <DashChart title="Inbound per hour" link={{ label: "Inbound", href: inboundHref }} total={count(inbound.total)} totalLine={busiest.count ? `transfers today · busiest ${hourText(busiest.hour)}` : "transfers today"}>
            <BarSeries bars={inbound.byHour.map((hour) => ({ key: String(hour.hour), label: hourText(hour.hour), value: hour.count }))} summary="Partner transfers sent in each hour today." unit="transfers" />
          </DashChart>
        );
      }
      const needs = data?.needs;
      if (needs && needs.transfersWaiting !== null && inboundHref) {
        const waiting = needs.transfersWaiting;
        const late = needs.slaBreaching ?? 0;
        side = (
          <DashRing
            title="Waiting now"
            link={{ label: "Inbound", href: inboundHref }}
            value={waiting ? waiting - late : 0}
            max={Math.max(1, waiting)}
            center={count(waiting)}
            tone={late ? "warning" : "primary"}
            label={`${waiting} transfers waiting, ${late} past the wait limit`}
            lines={[
              { label: "Past the wait limit", value: count(late), href: inboundHref },
              { label: "Longest wait", value: needs.oldestWaitingSeconds === null ? "—" : waitText(needs.oldestWaitingSeconds), href: inboundHref },
            ]}
          />
        );
      }
      break;
    }
    case "bookkeeper": {
      const trend = accounting?.trend ?? null;
      if (trend && trend.length > 1 && accounting && money) {
        const now = trend[trend.length - 1];
        big = (
          <DashChart title="Money in and out" link={accounting.hrefs.pnl ? { label: "P&L", href: accounting.hrefs.pnl } : undefined} total={dollars(now.inCents)} totalLine={`in · ${now.label}`} legend={[{ label: "In", tone: "primary" }, { label: "Out", tone: "info" }]} legendTop>
            <LineSeries points={trend.map((point) => ({ key: point.month, label: point.label, value: Math.round(point.inCents / 100) }))} compare={{ points: trend.map((point) => ({ key: point.month, label: point.label, value: Math.round(point.outCents / 100) })), label: "Out" }} summary="Money in from carriers and money paid out, by month." format={(value) => `$${value.toLocaleString("en-US")}`} hrefFor={accounting.hrefs.pnl ? (point) => `${accounting.hrefs.pnl}?from=${point.key}` : undefined} />
          </DashChart>
        );
      }
      const statement = money ? accounting?.statement ?? null : null;
      if (statement && accounting) {
        side = <DashHero kicker="Profit this month" value={dollars(statement.netProfitCents)} line={`${accounting.month.label} · in ${dollars(statement.inCents)}`} href={accounting.hrefs.pnl ?? "/app/dashboard?view=accounting"} />;
      }
      break;
    }
    case "retention": {
      const cases = retention?.cases ?? null;
      const casesLink = retention?.links.cases ?? null;
      if (cases && casesLink) {
        const closed = casesHref(casesLink, { step: "closed" });
        const saved = cases.months.reduce((sum, m) => sum + m.saved, 0);
        big = (
          <DashChart title="Saved and lost" link={{ label: "Closed cases", href: closed }} total={count(cases.thisMonth.saved)} totalLine={`saved · ${count(cases.thisMonth.lost)} lost this month`} legend={[{ label: "Saved", tone: "primary" }, { label: "Lost", tone: "info" }]} legendTop>
            {saved + cases.months.reduce((sum, m) => sum + m.lost, 0) > 0
              ? <LineSeries points={cases.months.map((m) => ({ key: m.start, label: m.label, value: m.saved }))} compare={{ points: cases.months.map((m) => ({ key: m.start, label: m.label, value: m.lost })), label: "Lost" }} summary="Cases saved and lost each month, counts." unit="cases" labels="all" hrefFor={() => closed} />
              : <p className="m-0 text-sm text-muted-foreground">A month shows here once a carrier file closes a case as saved or lost.</p>}
          </DashChart>
        );
        const lastMonth = cases.months[cases.months.length - 2];
        side = goalRing(props, goal, { value: cases.thisMonth.saved, last: lastMonth ? lastMonth.saved : null, money: false, monthKey: month, policiesHref: closed, title: "Monthly target", unit: "saves" });
      }
      break;
    }
  }
  return <Row first={big} second={side} wide />;
}

/** The goal ring: the stored goal, else last month's figure (as before goals were stored), with Set goal for who may. */
function goalRing(props: RowProps, goal: GoalRead | null, input: { value: number; last: number | null; money: boolean; monthKey: string; policiesHref: string | null; title: string; unit: string }) {
  const spec = HOME_GOAL[props.kind];
  if (!spec) return null;
  const stored = goal?.state === "set" ? goal.target : null;
  // A premium goal in counts (a reader without money) has no stored target to compare: it uses last month's count.
  const target = stored !== null && GOAL_MONEY[spec.kind] === input.money ? stored : input.last;
  const show = (value: number) => (input.money ? dollars(value) : count(value));
  const href = input.policiesHref ? (input.policiesHref.startsWith("/app/policies") ? `${input.policiesHref}?from=${input.monthKey}-01&to=${lastDay(input.monthKey)}` : input.policiesHref) : undefined;
  const ring = target ? ringOf(input.value, target) : null;
  const fallbackLine = input.last !== null ? `${spec.kind === "booked" ? "Without a target" : "Without a goal"} the ring uses ${spec.kind === "booked" ? "nothing" : `last month: ${show(input.last)}`}.` : "Without a target the ring has nothing to measure.";
  const action = props.goal?.canSet ? (
    <GoalSheetButton
      kind={spec.kind}
      whose={spec.whose}
      label={spec.kind === "booked" || spec.kind === "saves" ? "Set target" : "Set goal"}
      title={input.title}
      unit={input.unit}
      current={stored === null ? null : GOAL_MONEY[spec.kind] ? Math.round(stored / 100) : stored}
      fallback={fallbackLine}
      needsUpdate={goal?.state === "missing"}
    />
  ) : undefined;
  const sub = stored !== null && target === stored ? (spec.whose === "agency" ? "The agency's goal" : "Your goal") : input.last !== null ? "Against last month" : undefined;
  return (
    <DashRing
      size={132}
      title={input.title}
      sub={sub}
      action={action}
      tone={ring?.reached ? "highlight" : "primary"}
      value={ring?.pct ?? 0}
      center={ring ? `${ring.pct}%` : "—"}
      label={ring ? `${ring.pct}% of ${show(target!)}` : "No goal yet"}
      lines={[
        { label: spec.kind === "booked" ? "Booked this week" : spec.kind === "saves" ? "Saved this month" : "This month", value: target ? `${show(input.value)} of ${show(target)}` : show(input.value), href },
        ...(ring && !ring.reached ? [{ label: "To go", value: show(ring.left), href }] : []),
      ]}
    />
  );
}

/* ── Two working cards ─────────────────────────────────────────────────────────────────────────── */

async function LowerRow(props: RowProps) {
  const { kind, reads, views, viewProps, zone, sales, activityHref, callbacksHref, leadHref, pages } = props;
  const [data, leads, retention, book, accounting, compliance, pending, deals, due] = await Promise.all([reads.data, reads.leads, reads.retention, reads.book, reads.accounting, reads.compliance, reads.pending, reads.deals, reads.due]);
  const todayKey = dayKey(viewProps.now, zone);
  const month = monthOf(todayKey);
  const funnel = () => funnelCard({ leads: leads?.chart?.totalIn ?? null, called: leads?.chart?.totalCalled ?? null, quotes: deals?.quotes ?? null, apps: deals?.applications ?? null, month, zone, href: leads?.funnel?.href ?? leads?.chart?.href ?? sales?.href ?? null });
  let first: ReactNode = null;
  let second: ReactNode = null;

  switch (kind) {
    case "owner":
      first = funnel();
      second = modulesCard(views, viewProps.noMoney, { leads, retention, book, accounting, compliance, pending, sales });
      break;
    case "solo":
    case "producer":
      first = phoneCard(props, data, deals);
      second = recentCard(props, deals) ?? funnel();
      break;
    case "manager": {
      first = funnel();
      const rows = book?.book?.rows ?? null;
      const policiesHref = book?.links.policies ?? null;
      if (rows) {
        const previous = monthOf(todayKey, -1);
        const by = new Map<string, { id: string; name: string; now: number; then: number }>();
        for (const row of rows) {
          if (!row.agentUserId || !row.issueDate || row.issueDate > todayKey) continue;
          const at = row.issueDate.slice(0, 7);
          if (at !== month && at !== previous) continue;
          const entry = by.get(row.agentUserId) ?? { id: row.agentUserId, name: row.agentName ?? "Unnamed producer", now: 0, then: 0 };
          if (at === month) entry.now += 1;
          else entry.then += 1;
          by.set(row.agentUserId, entry);
        }
        const people = [...by.values()].sort((a, b) => b.now - a.now || b.then - a.then || a.name.localeCompare(b.name));
        second = (
          <DashTable
            title="My producers"
            period={`issued in ${monthName(month)}`}
            link={pages.producers ? { label: "Producers", href: pages.producers } : undefined}
            heads={["Producer", monthName(month).slice(0, 3), monthName(previous).slice(0, 3)]}
            rows={people.map((person) => ({ key: person.id, cells: [person.name, count(person.now), count(person.then)], href: policiesHref ? `${policiesHref}?agent=${encodeURIComponent(person.id)}&from=${month}-01&to=${lastDay(month)}` : undefined }))}
            empty={`No one on your team has a policy in ${monthName(month)} or ${monthName(previous)} yet.`}
          />
        );
      }
      break;
    }
    case "setter": {
      const outcomes = data?.insights?.outcomes ?? [];
      if (activityHref && outcomes.length) first = <DashBars title="How calls ended" period="last 7 days" link={{ label: "My scorecard", href: activityHref }} rows={outcomes.slice(0, 6).map((outcome) => ({ key: outcome.key, label: outcome.label, value: outcome.count, shown: count(outcome.count), tone: (outcome.contact ? "good" : "info") as DashTone, href: weekHref(activityHref, data) }))} />;
      const heat = data?.insights?.heat ?? null;
      if (activityHref && heat) {
        const hours = heat.hours.map((hour, index) => ({ hour, dials: heat.days.reduce((sum, day) => sum + (day.cells[index]?.dials ?? 0), 0), contacts: heat.days.reduce((sum, day) => sum + (day.cells[index]?.contacts ?? 0), 0) }))
          .filter((hour) => hour.dials > 0).sort((a, b) => b.contacts - a.contacts || b.dials - a.dials).slice(0, 5);
        second = <DashTable title="Best hours" period="last 7 days" link={{ label: "Activity", href: activityHref }} heads={["Hour", "Contacts", "Dials"]} rows={hours.map((hour) => ({ key: String(hour.hour), cells: [`${hourText(hour.hour).replace(/ (AM|PM)$/, "")}–${hourText(hour.hour + 1)}`, count(hour.contacts), count(hour.dials)], href: activityHref }))} empty="Your best hours show here after a week of dialling." />;
      }
      break;
    }
    case "assistant": {
      if (callbacksHref) {
        const items: DashItem[] = (due ?? []).slice(0, 8).map((callback, index) => ({
          key: callback.id ?? String(index),
          mark: "☏",
          tone: callback.isOverdue ? "danger" : "neutral",
          title: callback.customerName,
          detail: callback.isOverdue ? "Overdue" : "Due today",
          value: callback.isOverdue ? "Now" : clock(callback.scheduledAtUtc, zone),
          href: (callback.leadId ? leadHref(callback.leadId) : null) ?? callbacksHref,
        }));
        first = <DashList title="Callbacks due" link={{ label: "Callbacks", href: callbacksHref }} items={items} empty="No callback is due today." />;
      }
      second = modulesCard(views, true, { leads, retention, book, accounting, compliance, pending, sales });
      break;
    }
    case "bookkeeper": {
      const owed = accounting?.producers ?? null;
      if (owed && !viewProps.noMoney) {
        first = <DashTable title="Owed to producers" period={`${dollars(owed.owedCents)} in all`} link={pages.payouts ? { label: "Payouts", href: pages.payouts } : undefined} heads={["Producer", "Owed"]} rows={owed.rows.map((row) => ({ key: row.userId, cells: [row.name, dollars(row.owedCents)], href: pages.payouts ?? accounting?.hrefs.splits ?? undefined }))} empty="No producer is owed anything right now." />;
      }
      const needs = book?.needs ?? [];
      if (book && (book.links.files || needs.length)) {
        second = <DashList title="Carrier files to review" link={book.links.files ? { label: "Carrier files", href: book.links.files } : undefined} items={needs.filter((need) => need.count > 0).map((need) => ({ key: need.key, mark: count(need.count), tone: need.tone, title: need.label, detail: need.detail, href: need.href }))} empty="Nothing in the carrier files needs you." />;
      }
      break;
    }
    case "retention": {
      const cases = retention?.cases ?? null;
      const casesLink = retention?.links.cases ?? null;
      if (cases && casesLink) {
        first = (
          <DashTable
            title="Cases by deadline"
            period="closing soonest"
            link={{ label: "Due this week", href: casesHref(casesLink, { deadline: "week" }) }}
            heads={["Client", "Step", "Due"]}
            rows={cases.closingSoon.map((item) => ({ key: item.id, href: `${casesLink}/${item.id}`, cells: [item.clientName ? personName(item.clientName) : `Policy ${item.policyNumber}`, STEP_LABELS[item.step], item.daysLeft === 0 ? "Today" : item.daysLeft === 1 ? "Tomorrow" : item.deadline ? shortDay(item.deadline) : "—"] }))}
            empty="No open case has a carrier deadline ahead."
          />
        );
        const reasons = cases.byReason.slice(0, 5);
        second = reasons.length
          ? <DashBars title="Why policies are at risk" period="open cases" link={{ label: "Cases", href: casesLink }} rows={reasons.map((reason) => ({ key: reason.reason, label: reason.label, value: reason.count, shown: count(reason.count), tone: "warning" as DashTone, href: casesHref(casesLink, { reason: reason.reason }) }))} />
          : <HomePanel title="Why policies are at risk" link={{ label: "Cases", href: casesLink }}><p className="m-0 text-sm text-muted-foreground">No open case: a policy shows here when a carrier file flags it.</p></HomePanel>;
      }
      break;
    }
  }
  return <Row first={first} second={second} />;
}

/* ── Right column: the hero, then Today ────────────────────────────────────────────────────────── */

async function RightColumn(props: RowProps) {
  const { kind, reads, viewProps, zone, dialerHref, pages } = props;
  const [data, moneyData, due, book, accounting, retention, myPay] = await Promise.all([reads.data, reads.money, reads.due, reads.book, reads.accounting, reads.retention, reads.myPay]);
  const money = !viewProps.noMoney;
  const todayKey = dayKey(viewProps.now, zone);
  const month = monthOf(todayKey);
  const rows = book?.book?.rows ?? null;
  let hero: ReactNode = null;
  let list: ReactNode = todayList(props, data, due);

  const commissionHero = () => {
    const statement = money ? accounting?.statement ?? null : null;
    if (!statement || !accounting || statement.inCents <= 0) return null;
    const received = accounting.receivedCents;
    return (
      <DashHero
        kicker="Commission in"
        value={dollars(statement.inCents)}
        line={received !== null ? `${dollars(received)} in the bank · ${accounting.month.label}` : `from carriers · ${accounting.month.label}`}
        facts={statement.netProfitCents > 0 ? [{ label: "Profit", value: dollars(statement.netProfitCents) }] : []}
        href={accounting.hrefs.pnl ?? "/app/dashboard?view=accounting"}
      />
    );
  };
  const queueHero = () => (dialerHref && data?.queueReady !== null && data?.queueReady !== undefined ? <DashHero kicker="Ready to dial" value={count(data.queueReady)} line={data.queueReady === 1 ? "lead in your queue" : "leads in your queue"} href={dialerHref} /> : null);

  switch (kind) {
    case "owner":
    case "solo": {
      const figure = moneyData?.figures[0];
      hero = commissionHero() ?? (figure && money ? <DashHero kicker={figure.label} value={figure.value} line={figure.caption} href={figure.href} /> : queueHero());
      break;
    }
    case "producer":
      hero = myPay && pages.myPay ? <DashHero kicker="My pay" value={dollars(Math.max(0, myPay.owedCents))} line={myPay.owedCents > 0 ? "owed to you on the pay ledger" : "nothing owed to you right now"} href={pages.myPay} /> : queueHero();
      break;
    case "manager": {
      const producers = rows ? new Set(rows.filter((row) => row.agentUserId && row.issueDate?.slice(0, 7) === month && row.issueDate <= todayKey).map((row) => row.agentUserId)).size : null;
      const team = rows ? new Set(rows.map((row) => row.agentUserId).filter(Boolean)).size : null;
      hero = pages.producers && producers !== null ? <DashHero kicker="My producers" value={`${count(producers)} of ${count(team ?? producers)}`} line={`with a policy issued in ${monthName(month)}`} href={pages.producers} /> : queueHero();
      // Team activity: what went well, counts only (the audit's money leak: no premium here).
      if (rows && book?.links.policies) {
        const issued = rows.filter((row) => row.issueDate && row.issueDate.slice(0, 7) === month && row.issueDate <= todayKey).sort((a, b) => (b.issueDate ?? "").localeCompare(a.issueDate ?? ""));
        list = <DashList title="Team activity" period={`${monthName(month)}`} link={{ label: "Policies", href: `${book.links.policies}?from=${month}-01&to=${lastDay(month)}` }} items={issued.slice(0, 12).map((row) => ({ key: `${row.carrierId}-${row.policyNumber}`, mark: initials(row.agentName), tone: "good" as DashTone, title: `${row.agentName ?? "A producer"} issued a policy`, detail: row.carrierName, when: shortDay(row.issueDate!), href: row.href ?? `${book.links.policies}?q=${encodeURIComponent(row.policyNumber)}` }))} empty={`No policy issued in ${monthName(month)} yet.`} />;
      }
      break;
    }
    case "setter":
      hero = queueHero();
      break;
    case "assistant": {
      const href = pages.floor ?? pages.inbound ?? null;
      const waiting = data?.needs.transfersWaiting ?? null;
      hero = href && waiting !== null ? <DashHero kicker={pages.floor ? "Inbound floor" : "Inbound"} value={count(waiting)} line={waiting === 1 ? "transfer waiting now" : "transfers waiting now"} facts={data?.needs.callbacksOverdue ? [{ label: "Callbacks overdue", value: count(data.needs.callbacksOverdue) }] : []} href={href} /> : null;
      break;
    }
    case "bookkeeper": {
      const toPay = accounting ? (accounting.needs.producerToPay ?? 0) + (accounting.needs.partnerDrafts ?? 0) : null;
      const payoutsHref = pages.payouts ?? accounting?.hrefs.producerPayouts ?? accounting?.hrefs.payouts ?? null;
      hero = payoutsHref && toPay !== null ? <DashHero kicker="Payouts to send" value={count(toPay)} line={toPay === 1 ? "pay run ready to send" : "pay runs ready to send"} facts={accounting?.billsToPayCents ? [{ label: "Bills approved", value: dollars(accounting.billsToPayCents) }] : []} href={payoutsHref} /> : commissionHero();
      const recent = money ? accounting?.recent ?? null : null;
      if (recent) list = <DashList title="Recent money" link={accounting?.hrefs.bank ? { label: "Bank", href: accounting.hrefs.bank } : undefined} items={recent.slice(0, 8).map((item) => ({ key: item.key, mark: "$", tone: item.tone === "danger" ? "danger" : item.tone === "warning" ? "warning" : "info", title: item.title, detail: item.detail, value: dollars(item.cents), when: shortDay(item.on), href: item.href }))} empty="Deposits, bills and pay runs show here." />;
      else list = null;
      break;
    }
    case "retention": {
      const cases = retention?.cases ?? null;
      const scoreHref = retention?.links.scorecard ? `${retention.links.scorecard}?period=${SCORE_PERIOD}` : null;
      hero = cases && scoreHref ? <DashHero kicker="My scorecard" value={rateText(cases.score)} line="save rate · last 6 months" facts={[{ label: "Saved", value: count(cases.score.saved) }, { label: "Lost", value: count(cases.score.lost) }]} href={scoreHref} /> : null;
      const casesLink = retention?.links.cases ?? null;
      if (cases && casesLink) {
        const soon = cases.closingSoon.filter((item) => item.daysLeft !== null && item.daysLeft <= 2);
        list = <DashList title="Due now" period="today and the next two days" link={{ label: "Cases", href: casesHref(casesLink, { deadline: "week" }) }} items={soon.map((item) => ({ key: item.id, mark: "!", tone: item.daysLeft === 0 ? "danger" : "warning", title: item.clientName ? personName(item.clientName) : `Policy ${item.policyNumber}`, detail: `${STEP_LABELS[item.step]} · ${item.carrierName}`, value: item.daysLeft === 0 ? "Today" : `${item.daysLeft} ${item.daysLeft === 1 ? "day" : "days"}`, href: `${casesLink}/${item.id}` }))} empty="No case reaches its carrier deadline in the next two days." />;
      }
      break;
    }
  }
  return <div className="flex min-w-0 flex-col gap-3 lg:min-h-0 lg:[&>*:last-child]:min-h-0 lg:[&>*:last-child]:flex-1 lg:[&>*:last-child]:overflow-hidden">{hero}{list}</div>;
}

/** Today: the reader's appointments and callbacks, late callbacks first. */
function todayList({ zone, calendarHref, callbacksHref, leadHref }: RowProps, data: DashboardToday | null, due: Due | null) {
  if (!callbacksHref && !calendarHref) return null;
  const { items, total } = scheduleItems(data?.appointmentsTodayList ?? null, due, { appointments: calendarHref, callbacks: callbacksHref }, 12);
  const listItems: DashItem[] = items.map((item) => {
    const leadId = item.kind === "callback" ? due?.find((callback) => `c-${callback.id}` === item.id)?.leadId : undefined;
    return {
      key: item.id,
      mark: item.kind === "appointment" ? "◷" : "☏",
      tone: item.late ? "danger" : item.kind === "appointment" ? "info" : "neutral",
      title: item.name,
      detail: item.kind === "appointment" ? `Appointment${item.who ? ` · ${item.who}` : ""}` : item.late ? "Callback · overdue" : "Callback",
      value: item.late ? "Now" : clock(item.atUtc, zone),
      href: (leadId ? leadHref(leadId) : null) ?? item.href,
    };
  });
  return <DashList title="Today" period={total ? `${total} ${total === 1 ? "thing" : "things"}` : undefined} link={{ label: calendarHref ? "Calendar" : "Callbacks", href: (calendarHref ?? callbacksHref) as string }} items={listItems} empty="Nothing booked for today." />;
}

/* ── Shared cards ──────────────────────────────────────────────────────────────────────────────── */

/** Your modules — exactly the modules of the plan, each with its one figure, opening its view. */
function modulesCard(views: readonly DashboardViewKey[], noMoney: boolean, data: {
  leads: Awaited<Reads["leads"]>; retention: Awaited<Reads["retention"]>; book: Awaited<Reads["book"]>; accounting: Awaited<Reads["accounting"]>; compliance: Awaited<Reads["compliance"]>; pending: Pending; sales: HomeViewProps["sales"];
}) {
  const has = (key: DashboardViewKey) => views.includes(key);
  const { leads, retention, book, accounting, compliance, pending, sales } = data;
  const pendingCount = pending ? pending.awaitingPolicyNumber.count + pending.waitingOnClient.count + pending.counteroffersExpiring.count : null;
  const modules: Array<{ key: string; label: string; figure: string; line: string; href: string; icon: ReactNode }> = [];
  const add = (key: string, label: string, icon: ReactNode, href: string, headline: { figure: string; line: string } | null) => modules.push({ key, label, icon, href, figure: headline?.figure ?? "Open", line: headline?.line ?? "" });
  if (has("leads")) add("leads", "Leads", <Users className="size-4" aria-hidden="true" />, "/app/dashboard?view=leads", leads ? leadsHeadline(leads) : null);
  if (sales) add("sales", "Sales", <FilePenLine className="size-4" aria-hidden="true" />, sales.href, pendingCount === null ? null : { figure: pendingCount.toLocaleString("en-US"), line: pendingCount === 1 ? "case pending" : "cases pending" });
  if (has("retention")) add("retention", "Retention", <LifeBuoy className="size-4" aria-hidden="true" />, "/app/dashboard?view=retention", retention ? retentionHeadline(retention, noMoney) : null);
  if (has("book")) add("book", "Book of business", <BookOpen className="size-4" aria-hidden="true" />, "/app/dashboard?view=book", book ? bookHeadline(book) : null);
  if (has("accounting")) add("accounting", "Accounting", <Calculator className="size-4" aria-hidden="true" />, "/app/dashboard?view=accounting", accounting ? accountingHeadline(accounting) : null);
  if (has("compliance")) add("compliance", "Compliance", <ShieldCheck className="size-4" aria-hidden="true" />, "/app/dashboard?view=compliance", compliance ? complianceHeadline(compliance) : null);
  return modules.length ? <DashModules modules={modules} /> : null;
}

/** "On the phone today": dials against the fortnight's best day, today's steps, three facts. */
function phoneCard({ viewProps, zone, activityHref, calendarHref, dialerHref, sales }: RowProps, data: DashboardToday | null, deals: SalesSnapshot<ApplicationRow> | null) {
  if (!data || (data.dialsToday === null && data.queueReady === null)) return null;
  const series = data.series;
  const nowMs = viewProps.now;
  const last = series[series.length - 1];
  const dayHref = activityHref && last ? `${activityHref}?from=${last.key}&to=${last.key}` : activityHref;
  const todaySales = deals ? salesToday(deals.applications, deals.quotes ?? [], nowMs, zone) : null;
  const dials = data.dialsToday ?? 0;
  const top = gaugeMax(series, dials);
  const contacts = data.contactsToday ?? 0;
  const pct = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;
  const bars: DashBar[] = [{ key: "contacts", label: "Contacts", value: contacts, shown: count(data.contactsToday), tone: "info", note: dials ? `${pct(contacts, dials)} of dials` : "No dials yet", href: dayHref ?? undefined }];
  if (todaySales && deals?.quotes) bars.push({ key: "quotes", label: "Quotes", value: todaySales.quotes, shown: count(todaySales.quotes), tone: "info", note: contacts ? `${pct(todaySales.quotes, contacts)} of contacts` : "No contacts yet", href: sales?.href });
  if (todaySales) bars.push({ key: "sales", label: "Sales", value: todaySales.sales, shown: count(todaySales.sales), tone: "good", note: "Submitted today", href: sales?.href });
  else bars.push({ key: "appointments", label: "Appointments", value: data.appointmentsToday ?? 0, shown: count(data.appointmentsToday), tone: "good", note: "Booked for today", href: calendarHref ?? undefined });
  const best = data.insights?.heat?.best ?? null;
  const rate = data.contactRatePct;
  const facts: DashLine[] = [
    { label: "Contact rate", value: rate === null ? "—" : `${Math.round(rate)}%`, href: dayHref ?? undefined },
    { label: "Best hour", value: best ? `${hourText(best.hour).replace(/ (AM|PM)$/, "")}–${hourText(best.hour + 1)}` : "—", href: activityHref ?? undefined },
    data.queueReady !== null && dialerHref ? { label: "Next in queue", value: `${count(data.queueReady)} ${data.queueReady === 1 ? "lead" : "leads"}`, href: dialerHref } : { label: "Appointments", value: count(data.appointmentsToday), href: calendarHref ?? undefined },
  ];
  const versus = deals && todaySales ? versusAverage(todaySales.sales, salesAverage(deals.applications, nowMs, zone)) : null;
  return (
    <DashPhone
      title="On the phone today"
      // Only good news on the chip (owner 2026-11-06): it shows when today is ahead of the average.
      badge={versus?.ahead ? { tone: "good", label: versus.text } : undefined}
      link={activityHref ? { label: "Activity", href: activityHref } : undefined}
      gauge={{ value: dials, max: top, caption: `of ${top.toLocaleString("en-US")} dials`, label: `${dials} dials today; the best day of the last two weeks was ${top}`, href: dayHref ?? undefined }}
      bars={bars}
      facts={facts}
    />
  );
}

/** "My recent business": the cases worked in the last seven days; the premium only for a reader with money. */
function recentCard({ viewProps, sales }: RowProps, deals: SalesSnapshot<ApplicationRow> | null) {
  if (!sales || !deals) return null;
  return (
    <DashRecent
      title="My recent business"
      sub="Last 7 days"
      link={{ label: "Applications", href: sales.href }}
      rows={recentBusiness(deals.applications, viewProps.now).map((row) => ({
        key: row.applicationId,
        title: row.clientName,
        detail: [row.carrierName, row.productLabel].filter(Boolean).join(" · ") || "No product yet",
        // Roles r1: no money without the money permission (the audit's manager leak).
        value: viewProps.noMoney ? "" : row.monthlyPremiumCents === null ? "—" : `${usd(row.monthlyPremiumCents)}/mo`,
        chip: dealStatus(row),
        href: `/app/applications/${row.caseId}`,
      }))}
      empty="No case worked in the last seven days."
    />
  );
}

/** Without the book: dials over the last fourteen days, contacts under them. Nothing at all without an activity page. */
function callsChart(data: DashboardToday | null, activityHref: string | null, series: DashboardToday["series"]) {
  // Roles r1: no placeholder card for a role with no calls page (the audit's dead card). No activity page, no card.
  if (!activityHref || series.length < 2 || !series.some((day) => day.dials !== null)) return null;
  const dials = series.reduce((sum, day) => sum + (day.dials ?? 0), 0);
  const change = data && data.dialsToday !== null && data.dialsYesterday ? Math.round(((data.dialsToday - data.dialsYesterday) / data.dialsYesterday) * 100) : null;
  return (
    <DashChart title="Calls" link={{ label: "Activity", href: activityHref }} total={dials.toLocaleString("en-US")} totalLine={`dials · last ${series.length} days${change !== null && change > 0 ? ` · up ${change}% on yesterday` : ""}`} legend={[{ label: "Dials", tone: "primary" }, { label: "Contacts", tone: "info" }]}>
      <LineSeries
        points={series.map((day) => ({ key: day.key, label: day.label, value: day.dials ?? 0 }))}
        compare={{ points: series.map((day) => ({ key: day.key, label: day.label, value: day.contacts ?? 0 })), label: "Contacts" }}
        summary={`Dials per day over the last ${series.length} days, with contacts.`}
        hrefFor={(point) => `${activityHref}?from=${point.key}&to=${point.key}`}
      />
    </DashChart>
  );
}

/** A row of one or two cards; one card takes the whole width, never a blank half. */
function Row({ first, second, wide = false }: { first: ReactNode; second: ReactNode; wide?: boolean }) {
  if (!first && !second) return null;
  return <div className={cn("grid min-w-0 grid-cols-1 gap-3 lg:min-h-0", fill, first && second && (wide ? "lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" : "lg:grid-cols-2"))}>{first}{second}</div>;
}

function RowSkeleton({ className }: { className: string }) {
  return (
    <div aria-hidden="true" className={cn("grid min-w-0 grid-cols-1 gap-3 lg:min-h-0", fill, className)}>
      {Array.from({ length: 2 }).map((_, index) => (
        <div key={index} className="flex min-h-40 flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <div className="h-3 w-28 m-skel rounded-full" />
          <div className="h-7 w-20 m-skel rounded-md" />
          <div className="mt-auto h-16 w-full m-skel rounded-md" />
        </div>
      ))}
    </div>
  );
}

function StripSkeleton({ tall }: { tall: boolean }) {
  return (
    <div role="status" aria-live="polite" className="shrink-0 overflow-hidden rounded-lg border border-border">
      <span className="sr-only">Loading</span>
      <div aria-hidden="true" className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className={cn("space-y-2 bg-card px-4", tall ? "py-3.5" : "py-2")}>
            <div className="h-3 w-20 m-skel rounded-full" />
            {tall && <div className="h-6 w-14 m-skel rounded-md" />}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Formatting ────────────────────────────────────────────────────────────────────────────────── */

const count = (value: number | null | undefined) => (value === null || value === undefined ? "—" : value.toLocaleString("en-US"));
const dollars = (cents: number) => `${cents < 0 ? "−" : ""}$${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;
const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const shortDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const initials = (name: string | null) => (name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
const waitText = (seconds: number) => (seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s` : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`);
/** Activity filtered to the last seven days of the series, as Activity reads its range. */
const weekHref = (activityHref: string, data: DashboardToday | null) => {
  const week = (data?.series ?? []).slice(-7);
  return week.length ? `${activityHref}?from=${week[0].key}&to=${week[week.length - 1].key}` : activityHref;
};

/** Where a case stands: its outcome once closed, else its attempt's status, in the Applications page's words. */
function dealStatus(row: ApplicationRow): { tone: DashTone; label: string } {
  const tone = (value: string): DashTone => (value === "action" ? "info" : (value as DashTone));
  if (row.status === "closed" && row.outcome) return { tone: tone(APPLICATION_OUTCOME_TONE[row.outcome]), label: APPLICATION_OUTCOME_LABEL[row.outcome] };
  return { tone: tone(APPLICATION_STATUS_TONE[row.status]), label: APPLICATION_STATUS_LABEL[row.status] };
}
