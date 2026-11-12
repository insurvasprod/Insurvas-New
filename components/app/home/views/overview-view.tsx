import { Suspense, type ReactNode } from "react";
import { BookOpen, Calculator, FilePenLine, LifeBuoy, ShieldCheck, Users } from "lucide-react";

import { DashBars, DashChart, DashHero, DashList, DashModules, DashPhone, DashRecent, DashTable, type DashBar, type DashItem, type DashLine, type DashNeed, type DashTone } from "@/components/app/home/dash/dash-kit";
import { DashNeedsLive } from "@/components/app/home/dash/dash-needs-live";
import { funnelCard, goalCard, premiumCard } from "./agency-cards";
import { monthOf } from "@/lib/dashboard/views/agency";
import { dayKey } from "@/lib/dashboard/views/sales";
import { cn } from "@/lib/utils";
import { LineSeries } from "@/components/ui/chart";
import { DeltaChip } from "@/components/ui/stat";
import { HomePanel } from "@/components/app/home/home-panel";
import { attentionItems, clock, hourText, scheduleItems, type AttentionLinks, type DueCallback } from "@/lib/dashboard/homeView";
import { APPLICATION_OUTCOME_LABEL, APPLICATION_OUTCOME_TONE, APPLICATION_STATUS_LABEL, APPLICATION_STATUS_TONE } from "@/lib/applications/constants";
import type { ApplicationRow } from "@/lib/applications/listRules";
import { gaugeMax, recentBusiness, salesAverage, salesToday, versusAverage, type SalesSnapshot } from "@/lib/dashboard/views/sales";
import type { DashboardToday } from "@/lib/dashboard/today";
import type { DashboardMoney } from "@/lib/dashboard/money";
import type { DashboardViewKey } from "@/lib/dashboard/views";
import { loadLeadsView } from "@/lib/dashboard/views/leads";
import { loadRetentionView } from "@/lib/dashboard/views/retention";
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
 * The dashboard's Overview (owner 2026-11-06, canvas round 3 screen 1, as drawn):
 *
 *   Needs you      the standard figure strip, what waits on this person across every module of the plan
 *   top row        policies issued (with lapses) beside "Your modules" — Leads, Sales, Retention, Book of business,
 *                  Accounting, Compliance, each with its one figure, opening its view
 *   bottom row     "On the phone today" beside "My recent business", arranged as round 2 screen 4 draws them
 *                  (the `side` card renders in the bottom-left slot, `left` beside the chart)
 *   right column   the money card, then today's callbacks and appointments
 *
 * Each module's figures come from that module's own view loader, read for the Overview (`forOverview`: only
 * what the Overview draws), only for the modules this reader's views offer, all at once. Every read keeps the
 * view's scope and role rules.
 */
type Pending = { awaitingPolicyNumber: { count: number }; waitingOnClient: { count: number }; counteroffersExpiring: { count: number } } | null;

type OverviewProps = {
  today: Promise<DashboardToday | null>;
  money: Promise<DashboardMoney | null> | null;
  callbacks: Promise<ReadonlyArray<DueCallback & { leadId?: string }> | null>;
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
  zone: string;
  /** The module views this reader is offered: the modules the Overview reads. */
  views: readonly DashboardViewKey[];
  viewProps: DashViewProps;
  /** Sales has no view: its page and pending cases, when the reader may open applications. */
  sales: { href: string; pending: Promise<Pending>; snapshot: Promise<SalesSnapshot<ApplicationRow> | null> } | null;
};

/** Every read the Overview makes, started once, together; each row awaits only the ones it draws. */
type Reads = {
  data: Promise<DashboardToday | null>;
  money: Promise<DashboardMoney | null>;
  due: Promise<ReadonlyArray<DueCallback & { leadId?: string }> | null>;
  leads: Promise<Awaited<ReturnType<typeof loadLeadsView>> | null>;
  retention: Promise<Awaited<ReturnType<typeof loadRetentionView>> | null>;
  book: Promise<Awaited<ReturnType<typeof loadBookView>> | null>;
  accounting: Promise<Awaited<ReturnType<typeof loadAccountingView>> | null>;
  compliance: Promise<Awaited<ReturnType<typeof loadComplianceView>> | null>;
  pending: Promise<Pending>;
  deals: Promise<SalesSnapshot<ApplicationRow> | null>;
};
type RowProps = OverviewProps & { reads: Reads };

const fill = "lg:[&>*]:h-full lg:[&>*]:min-h-0 lg:[&>*]:overflow-hidden";
const column = "flex flex-col gap-4 xl:absolute xl:inset-0 xl:[&>*:last-child]:min-h-0 xl:[&>*:last-child]:flex-1 xl:[&>*:last-child]:overflow-hidden";

/**
 * Speed pass 2026-11-10: the reads still start together, but the page no longer waits for the slowest of
 * them. Each row is its own Suspense boundary holding its own height, so the calls, the money card and
 * Today arrive as soon as their reads do; and the module loaders read only what the Overview draws
 * (`forOverview`), not their whole views. The rows render the same elements as before, so the stagger
 * (m-dash-ov) still applies as each row lands.
 */
export function OverviewView(props: OverviewProps) {
  const { views, viewProps, sales, today, money, callbacks } = props;
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
    accounting: has("accounting") ? safe(() => loadAccountingView(lite)) : Promise.resolve(null),
    compliance: has("compliance") ? safe(() => loadComplianceView(lite)) : Promise.resolve(null),
    pending: sales ? sales.pending.catch(() => null) : Promise.resolve(null),
    deals: sales ? sales.snapshot.catch(() => null) : Promise.resolve(null),
  };
  const row = { ...props, reads };
  const grid = (cols: string) => cn("grid min-w-0 grid-cols-1 gap-4", cols);

  // ── Round 3 screen 1, as drawn: premium · goal, then modules · lead to policy, the money card and Today beside
  // them ending on the same line as Lead to policy; under them (a little scroll, owner 2026-11-06) the phone and
  // the recent business of round 2. ──
  return (
    // m-dash-ov (§ Motion, 2026-11-09): the cards rise in one after another, as DashLayout's do.
    <div className="m-dash-ov flex w-full min-w-0 flex-col gap-4 pb-4">
      <Suspense fallback={<NeedsSkeleton />}><NeedsRow {...row} /></Suspense>
      <div className="grid min-w-0 grid-cols-1 items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Suspense fallback={<RowSkeleton className={grid("lg:h-[380px] lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]")} cards={2} />}><TopRow {...row} /></Suspense>
          <Suspense fallback={<RowSkeleton className={grid("lg:h-[330px] lg:grid-cols-2")} cards={2} />}><MiddleRow {...row} /></Suspense>
        </div>
        {/* Today ends where Lead to policy ends: the column takes the rows' height and never sets it. */}
        <div className="relative min-w-0">
          <Suspense fallback={<RowSkeleton className={column} cards={2} />}><RightColumn {...row} /></Suspense>
        </div>
      </div>
      <Suspense fallback={<RowSkeleton className={grid("lg:h-[320px] lg:grid-cols-2")} cards={2} />}><BottomRow {...row} /></Suspense>
    </div>
  );
}

/** Needs you: today's own items, then every module's, most urgent first (the strip keeps six). */
async function NeedsRow({ reads, links, upgrade, pendingHref, closeOutHref }: RowProps) {
  const [data, moneyData, leads, retention, book, accounting, compliance] = await Promise.all([reads.data, reads.money, reads.leads, reads.retention, reads.book, reads.accounting, reads.compliance]);
  const needs: DashNeed[] = attentionItems(data, links).map((item) => ({ key: item.key, count: item.count, label: sentence(item.label), detail: item.detail, tone: item.tone, href: item.href }));
  if (upgrade && moneyData?.exposurePolicies) {
    needs.push({ key: "upgrade", count: moneyData.exposurePolicies, label: moneyData.exposurePolicies === 1 ? "Policy you could protect" : "Policies you could protect", detail: "Inside the chargeback window", tone: "info", href: upgrade.featureHref });
  }
  for (const item of [...(leads?.needs ?? []), ...(retention ? retentionNeeds(retention) : []), ...(book?.needs ?? []), ...(accounting ? accountingNeeds(accounting) : []), ...(compliance ? complianceNeeds(compliance) : [])]) {
    if (!needs.some((need) => need.key === item.key)) needs.push(item);
  }
  return <DashNeedsLive items={needs} pendingHref={pendingHref} closeOutHref={closeOutHref} />;
}

/** Big: premium submitted and issued (else the Book view's chart, else the calls) beside the month's goal. */
async function TopRow({ reads, zone, viewProps, activityHref, sales }: RowProps) {
  const [data, book, deals, retention] = await Promise.all([reads.data, reads.book, reads.deals, reads.retention]);
  const series = data?.series ?? [];
  const bookChart = book ? bookIssuedChart(book) : null;
  const todayKey = dayKey(viewProps.now, zone);
  const month = monthOf(todayKey);
  const previous = monthOf(todayKey, -1);
  const rows = book?.book?.rows ?? null;
  const policiesHref = book?.links.policies ?? null;
  // Round 3 screen 1: premium submitted and issued this year (hover for each month), else the book's or the calls' chart.
  const premium = rows && deals && !viewProps.noMoney ? premiumCard({ rows, apps: deals.applications, today: todayKey, zone, policiesHref }) : null;
  const big = premium ?? bookChart ?? callsChart(data, activityHref, series);
  // The month's goal beside it: issued against last month's issued (no goal is stored), placement, persistency.
  const goal = rows && !viewProps.noMoney ? goalCard({ rows, apps: deals?.applications ?? null, month, previous, zone, policiesHref, applicationsHref: sales?.href ?? null, persistency: retention?.persistency13 ?? null, persistencyHref: retention?.links.persistency ? `${retention.links.persistency}?view=persistency` : null }) : null;
  const top = [big, goal].filter(Boolean);
  return <div className={cn("grid min-w-0 grid-cols-1 gap-4 lg:h-[380px]", fill, top.length === 2 && "lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]")}>{big}{goal}</div>;
}

/** Your modules — exactly the modules of the plan, each with its one figure, opening its view — beside lead to policy. */
async function MiddleRow({ reads, views, viewProps, zone, sales }: RowProps) {
  const has = (key: DashboardViewKey) => views.includes(key);
  const [leads, retention, book, accounting, compliance, pending, deals] = await Promise.all([reads.leads, reads.retention, reads.book, reads.accounting, reads.compliance, reads.pending, reads.deals]);
  const pendingCount = pending ? pending.awaitingPolicyNumber.count + pending.waitingOnClient.count + pending.counteroffersExpiring.count : null;
  const noMoney = viewProps.noMoney;
  const modules: Array<{ key: string; label: string; figure: string; line: string; href: string; icon: ReactNode }> = [];
  const add = (key: string, label: string, icon: ReactNode, href: string, headline: { figure: string; line: string } | null) => modules.push({ key, label, icon, href, figure: headline?.figure ?? "Open", line: headline?.line ?? "" });
  if (has("leads")) add("leads", "Leads", <Users className="size-4" aria-hidden="true" />, "/app/dashboard?view=leads", leads ? leadsHeadline(leads) : null);
  if (sales) add("sales", "Sales", <FilePenLine className="size-4" aria-hidden="true" />, sales.href, pendingCount === null ? null : { figure: pendingCount.toLocaleString("en-US"), line: pendingCount === 1 ? "case pending" : "cases pending" });
  if (has("retention")) add("retention", "Retention", <LifeBuoy className="size-4" aria-hidden="true" />, "/app/dashboard?view=retention", retention ? retentionHeadline(retention, noMoney) : null);
  if (has("book")) add("book", "Book of business", <BookOpen className="size-4" aria-hidden="true" />, "/app/dashboard?view=book", book ? bookHeadline(book) : null);
  if (has("accounting")) add("accounting", "Accounting", <Calculator className="size-4" aria-hidden="true" />, "/app/dashboard?view=accounting", accounting ? accountingHeadline(accounting) : null);
  if (has("compliance")) add("compliance", "Compliance", <ShieldCheck className="size-4" aria-hidden="true" />, "/app/dashboard?view=compliance", compliance ? complianceHeadline(compliance) : null);
  const left = modules.length ? <DashModules modules={modules} /> : null;
  // Lead to policy: leads in this month, called, quoted, apps, issued — the agency dashboard's own card.
  const month = monthOf(dayKey(viewProps.now, zone));
  const funnel = funnelCard({ leads: leads?.chart?.totalIn ?? null, called: leads?.chart?.totalCalled ?? null, quotes: deals?.quotes ?? null, apps: deals?.applications ?? null, month, zone, href: leads?.funnel?.href ?? leads?.chart?.href ?? sales?.href ?? null });
  const middle = [left, funnel].filter(Boolean);
  if (!middle.length) return null;
  return <div className={cn("grid min-w-0 grid-cols-1 gap-4 lg:h-[330px]", fill, middle.length === 2 && "lg:grid-cols-2")}>{left}{funnel}</div>;
}

/** The money card, then today's callbacks and appointments. */
async function RightColumn({ reads, viewProps, zone, dialerHref, calendarHref, callbacksHref, leadHref }: RowProps) {
  const [data, moneyData, due, book, accounting] = await Promise.all([reads.data, reads.money, reads.due, reads.book, reads.accounting]);
  // Round 3 draws the month's commission here (owner 2026-11-06: good news on the dashboard): the carriers' money in
  // this month from the P&L statement, with profit and the month's policies under it. Without the books, the role's
  // own money figures, then the dialer queue.
  const figures = moneyData?.figures ?? [];
  const rows = book?.book?.rows ?? null;
  const policiesHref = book?.links.policies ?? null;
  const month = monthOf(dayKey(viewProps.now, zone));
  const statement = !viewProps.noMoney ? accounting?.statement ?? null : null;
  const monthPolicies = rows ? rows.filter((row) => row.issueDate?.slice(0, 7) === month).length : null;
  const commissionHero = statement && statement.inCents > 0 ? (
    <DashHero
      kicker={`COMMISSION · ${accounting!.month.label.split(" ")[0].toUpperCase()}`}
      value={usd(statement.inCents).replace(/\.\d+$/, "")}
      line={`in from carriers · ${accounting!.month.label}`}
      facts={[
        ...(statement.netProfitCents > 0 ? [{ label: "Profit", value: usd(statement.netProfitCents).replace(/\.\d+$/, "") }] : []),
        ...(monthPolicies ? [{ label: "Policies issued", value: monthPolicies.toLocaleString("en-US") }] : []),
      ]}
      href={accounting!.hrefs.pnl ?? policiesHref ?? "/app/dashboard?view=accounting"}
    />
  ) : null;
  const hero = commissionHero ?? (figures.length
    ? <DashHero kicker={figures[0].label.toUpperCase()} value={figures[0].value} line={figures[0].caption} facts={figures.slice(1, 3).map((figure) => ({ label: figure.label, value: figure.value }))} href={figures[0].href} />
    : dialerHref && data?.queueReady !== null && data?.queueReady !== undefined
      ? <DashHero kicker="READY TO DIAL" value={data.queueReady.toLocaleString("en-US")} line="leads in your queue" href={dialerHref} />
      : null);

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
  const list = callbacksHref || calendarHref
    ? <DashList title="Today" period={total ? `${total} ${total === 1 ? "thing" : "things"}` : undefined} link={{ label: calendarHref ? "Calendar" : "Callbacks", href: (calendarHref ?? callbacksHref) as string }} items={listItems} empty="Nothing booked for today." />
    : null;
  return <div className={column}>{hero}{list}</div>;
}

/** "On the phone today" beside "My recent business"; without sales, the week's calls. */
async function BottomRow({ reads, viewProps, zone, activityHref, calendarHref, dialerHref, sales }: RowProps) {
  const [data, deals] = await Promise.all([reads.data, reads.deals]);
  const series = data?.series ?? [];
  const nowMs = viewProps.now;
  // ── Side: "On the phone today" — dials against the fortnight's best day, today's steps, three facts ──
  const rate = data?.contactRatePct ?? null;
  const last = series[series.length - 1];
  const dayHref = activityHref && last ? `${activityHref}?from=${last.key}&to=${last.key}` : activityHref;
  const todaySales = deals ? salesToday(deals.applications, deals.quotes ?? [], nowMs, zone) : null;
  const side = data && (data.dialsToday !== null || data.queueReady !== null) ? (() => {
    const dials = data.dialsToday ?? 0;
    const top = gaugeMax(series, dials);
    const contacts = data.contactsToday ?? 0;
    const pct = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;
    const bars: DashBar[] = [{ key: "contacts", label: "Contacts", value: contacts, shown: count(data.contactsToday), tone: "info", note: dials ? `${pct(contacts, dials)} of dials` : "No dials yet", href: dayHref ?? undefined }];
    if (todaySales && deals?.quotes) bars.push({ key: "quotes", label: "Quotes", value: todaySales.quotes, shown: count(todaySales.quotes), tone: "info", note: contacts ? `${pct(todaySales.quotes, contacts)} of contacts` : "No contacts yet", href: sales?.href });
    if (todaySales) {
      const quoted = deals?.quotes ? todaySales.quotes : 0;
      // "1 in N quotes" only when today's quotes outnumber its sales; many of today's sales were quoted on earlier days.
      const note = todaySales.sales && quoted > todaySales.sales ? `1 in ${Math.round(quoted / todaySales.sales)} quotes` : todaySales.sales ? "Submitted today" : quoted ? `${quoted} quoted today` : "Submitted today";
      bars.push({ key: "sales", label: "Sales", value: todaySales.sales, shown: count(todaySales.sales), tone: "good", note, href: sales?.href });
    } else bars.push({ key: "appointments", label: "Appointments", value: data.appointmentsToday ?? 0, shown: count(data.appointmentsToday), tone: "good", note: "Booked for today", href: calendarHref ?? undefined });
    const best = data.insights?.heat?.best ?? null;
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
  })() : null;

  // ── Right: "My recent business" — the cases worked in the last seven days; without sales, the week's calls ──
  const right = sales && deals ? (
    <DashRecent
      title="My recent business"
      sub="Last 7 days"
      link={{ label: "Applications", href: sales.href }}
      rows={recentBusiness(deals.applications, nowMs).map((row) => ({
        key: row.applicationId,
        title: row.clientName,
        detail: [row.carrierName, row.productLabel].filter(Boolean).join(" · ") || "No product yet",
        value: row.monthlyPremiumCents === null ? "—" : `${usd(row.monthlyPremiumCents)}/mo`,
        chip: dealStatus(row),
        href: `/app/applications/${row.caseId}`,
      }))}
      empty="No case worked in the last seven days."
    />
  ) : weekCard(data, activityHref, series);
  const bottom = [side, right].filter(Boolean);
  if (!bottom.length) return null;
  return <div className={cn("grid min-w-0 grid-cols-1 gap-4 lg:h-[320px]", fill, bottom.length === 2 && "lg:grid-cols-2")}>{side}{right}</div>;
}

/** A row's place while its reads arrive: its own height and columns, so nothing moves when the cards land. */
function RowSkeleton({ className, cards }: { className: string; cards: number }) {
  return (
    <div aria-hidden="true" className={cn(className, fill)}>
      {Array.from({ length: cards }).map((_, index) => (
        <div key={index} className="flex min-h-40 flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <div className="h-3 w-28 m-skel rounded-full" />
          <div className="h-7 w-20 m-skel rounded-md" />
          <div className="mt-auto h-24 w-full m-skel rounded-md" />
        </div>
      ))}
    </div>
  );
}

/** The needs strip's place, in the standard figure strip's shape. */
function NeedsSkeleton() {
  return (
    <div role="status" aria-live="polite" className="overflow-hidden rounded-lg border border-border">
      <span className="sr-only">Loading</span>
      <div aria-hidden="true" className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="space-y-2.5 bg-card px-4 py-3.5">
            <div className="h-3 w-20 m-skel rounded-full" />
            <div className="h-6 w-14 m-skel rounded-md" />
            <div className="h-3 w-32 max-w-full m-skel rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Without the book: dials over the last fourteen days, contacts under them; a day opens that day's activity. */
function callsChart(data: DashboardToday | null, activityHref: string | null, series: DashboardToday["series"]) {
  if (!activityHref || series.length < 2) return <HomePanel title="Calls"><p className="m-0 text-sm text-muted-foreground">Calls show here once the dialer is in use.</p></HomePanel>;
  const dials = series.reduce((sum, day) => sum + (day.dials ?? 0), 0);
  const change = data && data.dialsToday !== null && data.dialsYesterday ? Math.round(((data.dialsToday - data.dialsYesterday) / data.dialsYesterday) * 100) : null;
  return (
    <DashChart title="Calls" link={{ label: "Activity", href: activityHref }} total={dials.toLocaleString("en-US")} totalLine={`dials · last ${series.length} days`} change={change !== null ? <DeltaChip value={change} title="Today against yesterday" /> : undefined} legend={[{ label: "Dials", tone: "primary" }, { label: "Contacts", tone: "info" }]}>
      <LineSeries
        points={series.map((day) => ({ key: day.key, label: day.label, value: day.dials ?? 0 }))}
        compare={{ points: series.map((day) => ({ key: day.key, label: day.label, value: day.contacts ?? 0 })), label: "Contacts" }}
        summary={`Dials per day over the last ${series.length} days, with contacts.`}
        minHeight={160}
        hrefFor={(point) => `${activityHref}?from=${point.key}&to=${point.key}`}
      />
    </DashChart>
  );
}

/** Without the funnel: the team's standings (the whole agency) or how the week's calls ended. */
function weekCard(data: DashboardToday | null, activityHref: string | null, series: DashboardToday["series"]) {
  const week = series.slice(-7);
  const weekHref = activityHref && week.length ? `${activityHref}?from=${week[0].key}&to=${week[week.length - 1].key}` : activityHref;
  const leaders = data?.insights?.leaders ?? null;
  const outcomes = data?.insights?.outcomes ?? [];
  if (leaders && leaders.length) return <DashTable title="Team" period="last 7 days" link={weekHref ? { label: "Activity", href: weekHref } : undefined} heads={["Producer", "Dials", "Contacts"]} rows={leaders.map((leader) => ({ key: leader.userId, cells: [leader.name, leader.dials.toLocaleString("en-US"), leader.contacts.toLocaleString("en-US")], href: weekHref ?? undefined }))} />;
  if (outcomes.length) return <DashBars title="How calls ended" period="last 7 days" link={weekHref ? { label: "Activity", href: weekHref } : undefined} rows={outcomes.map((outcome) => ({ key: outcome.key, label: outcome.label, value: outcome.count, shown: outcome.count.toLocaleString("en-US"), tone: (outcome.contact ? "good" : "info") as DashTone, href: weekHref ?? undefined }))} />;
  return null;
}

const count = (value: number | null | undefined) => (value === null || value === undefined ? "—" : value.toLocaleString("en-US"));
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** Where a case stands: its outcome once closed, else its attempt's status, in the Applications page's words. */
function dealStatus(row: ApplicationRow): { tone: DashTone; label: string } {
  const tone = (value: string): DashTone => (value === "action" ? "info" : (value as DashTone));
  if (row.status === "closed" && row.outcome) return { tone: tone(APPLICATION_OUTCOME_TONE[row.outcome]), label: APPLICATION_OUTCOME_LABEL[row.outcome] };
  return { tone: tone(APPLICATION_STATUS_TONE[row.status]), label: APPLICATION_STATUS_LABEL[row.status] };
}
