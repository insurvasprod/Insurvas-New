import type { ReactNode } from "react";

import { firstOpenable } from "@/lib/dashboard/roleHome";
import { leadToPolicy, monthOf } from "@/lib/dashboard/views/agency";
import { dayKey, loadSalesSnapshot } from "@/lib/dashboard/views/sales";
import { funnelCard } from "./agency-cards";
import { DashChart, DashFunnel, DashHero, DashList, DashNeedsBar, DashTable } from "@/components/app/home/dash/dash-kit";
import { LineSeries } from "@/components/ui/chart";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { cn } from "@/lib/utils";
import { dollars, durationLabel, loadLeadsView } from "@/lib/dashboard/views/leads";

import type { DashViewProps } from "./view-props";

/**
 * Dashboard › Leads (/app/dashboard?view=leads; redesigned 2026-11-19, owner: "the leads dashboard is horrible … put
 * more tiles"): on the agency dashboard's frame, as the Ledger home is — a strip of tiles for the month (leads in,
 * called, speed to lead, ready to dial, quoted, applications, and lead spend for money roles), then a short chart of
 * leads in against leads called beside the lead-to-policy funnel, the sources table (no donut, owner 2026-11-11), the
 * vendor scorecard when there is one, and on the right the hero and the newest leads' speed to lead.
 *
 * Everything is read by lib/dashboard/views/leads (scope, page gates and money rules there); a part that was not
 * read is left out, never drawn as zero. An empty month still draws the frame, each card saying how to fill it.
 */
/** One figure for the Overview's "Your modules". */
export function leadsHeadline(data: Awaited<ReturnType<typeof loadLeadsView>>): { figure: string; line: string } | null {
  const hero = data.hero;
  if (!hero) return null;
  if (hero.kind === "spend") return { figure: dollars(hero.spendCents), line: hero.costPerSaleCents === null ? "lead spend this month" : `lead spend · ${dollars(hero.costPerSaleCents)} per sale` };
  if (hero.kind === "ready") return { figure: hero.ready.toLocaleString("en-US"), line: "ready to dial" };
  return { figure: hero.leadsIn.toLocaleString("en-US"), line: "leads in this month" };
}

/** The lead-to-policy funnel card, drawn by this view and by the Overview. */
export function leadsFunnelCard(data: Awaited<ReturnType<typeof loadLeadsView>>) {
  const left = data.funnel ? (
    <DashFunnel
      title={data.funnel.title}
      period="this month"
      link={data.funnel.href ? { label: "Open", href: data.funnel.href } : undefined}
      rate={data.funnel.rate}
      steps={data.funnel.steps}
    />
  ) : null;
  return left;
}

/** Pages the tiles open, as data (lib/menu: no menu key inside a conditional). */
const SALES_PAGE = ["sell.applications"] as const;
const QUOTES_PAGE = ["sell.quoting"] as const;

export async function LeadsView(props: DashViewProps) {
  // Lead to policy reads the same cases and applications as the Overview and the agency dashboard, so the three
  // funnels agree and every step is one cohort (the dial funnel's steps came from different lists).
  const salesHref = firstOpenable(SALES_PAGE, props.available, props.context.role, props.solo);
  const quotesHref = firstOpenable(QUOTES_PAGE, props.available, props.context.role, props.solo) ?? salesHref;
  const [data, deals] = await Promise.all([
    loadLeadsView(props),
    salesHref ? loadSalesSnapshot(props.context.tenantId, props.scope).catch(() => null) : Promise.resolve(null),
  ]);
  const n = (value: number) => value.toLocaleString("en-US");
  const month = monthOf(dayKey(props.now, props.zone));
  const workspace = data.chart?.href ?? null;
  const leadsIn = data.chart?.totalIn ?? null;
  const called = data.chart?.totalCalled ?? null;

  // The month's cohort, as the funnel counts it: quoted, applications in, issued.
  const cohort = leadToPolicy({ leads: leadsIn, called, quotes: deals?.quotes ?? null, apps: deals?.applications ?? null }, month, props.zone);
  const step = (key: string) => cohort?.steps.find((s) => s.key === key)?.count ?? null;
  const inMonth = (iso: string | null | undefined) => Boolean(iso) && dayKey(iso as string, props.zone).slice(0, 7) === month;
  const quoted = step("quoted") ?? (deals?.quotes ? new Set(deals.quotes.filter((q) => q.outcome !== "discarded" && inMonth(q.createdAt)).map((q) => q.caseId)).size : null);
  const submitted = step("apps") ?? (deals?.applications ? deals.applications.filter((app) => inMonth(app.submittedAt)).length : null);
  const issued = step("issued") ?? (deals?.applications ? deals.applications.filter((app) => app.outcome === "issued" && inMonth(app.closedAt ?? app.updatedAt)).length : null);

  /* ── Needs you: only when something is waiting (the empty "nothing waiting" bar took a row) ─────────────── */
  const needs = data.needs?.some((need) => need.count > 0) ? <DashNeedsBar items={data.needs} /> : null;

  /* ── The strip ─────────────────────────────────────────────────────────────────────────────────────────── */
  const tiles: ReactNode[] = [];
  const pulse = data.pulse;
  if (leadsIn !== null && workspace) tiles.push(<StatTile key="in" label="Leads in" value={n(leadsIn)} footnote="this month" href={workspace} />);
  if (leadsIn !== null && called !== null && workspace) {
    const share = leadsIn > 0 ? Math.round((called / leadsIn) * 100) : null;
    tiles.push(<StatTile key="called" label="Called" value={share === null ? "—" : `${share}%`} footnote={leadsIn ? `${n(called)} of ${n(leadsIn)}${pulse?.notCalled ? ` · ${n(pulse.notCalled)} not yet` : ""}` : "no leads yet"} valueTone={pulse && pulse.notCalled > 0 ? "warning" : undefined} href={workspace} />);
  }
  if (pulse && workspace) tiles.push(<StatTile key="speed" label="Speed to lead" value={pulse.medianSeconds === null ? "—" : durationLabel(pulse.medianSeconds)} valueTone={pulse.medianSeconds !== null && pulse.medianSeconds > 300 ? "warning" : undefined} footnote={pulse.medianSeconds === null ? "no lead dialled yet" : "median to first dial"} href={workspace} />);
  if (pulse && pulse.ready !== null) tiles.push(<StatTile key="ready" label="Ready to dial" value={n(pulse.ready)} footnote="waiting in the queue" href="/app/dialer" />);
  if (quoted !== null && quotesHref) tiles.push(<StatTile key="quoted" label="Quoted" value={n(quoted)} footnote="this month" href={quotesHref} />);
  if (submitted !== null && salesHref) tiles.push(<StatTile key="apps" label="Applications" value={n(submitted)} footnote={issued ? `${n(issued)} issued` : "submitted this month"} href={salesHref} />);
  if (data.hero?.kind === "spend") tiles.push(<StatTile key="spend" label="Lead spend" value={dollars(data.hero.spendCents)} footnote={data.hero.costPerSaleCents === null ? "no sale yet" : `${dollars(data.hero.costPerSaleCents)} per sale`} href={data.hero.href} />);
  const strip = tiles.length ? <StatStrip label="Your leads this month">{tiles}</StatStrip> : null;

  /* ── Row 1: leads in vs called · lead to policy ───────────────────────────────────────────────────────── */
  const chart = data.chart ? (
    <DashChart
      title="Leads in"
      link={{ label: "Open Leads", href: data.chart.href }}
      total={n(data.chart.totalIn)}
      totalLine={`this month · ${n(data.chart.totalCalled)} called${data.chart.capped ? " · first 20,000 read" : ""}`}
      legend={[{ label: "Leads in", tone: "primary" }, { label: "Leads called", tone: "info" }]}
    >
      <LineSeries
        points={data.chart.leadsIn}
        compare={{ points: data.chart.leadsCalled, label: "Leads called" }}
        summary={`Leads in and leads called per day this month: ${n(data.chart.totalIn)} in, ${n(data.chart.totalCalled)} called.`}
        unit="leads"
        minHeight={180}
        hrefFor={() => data.chart!.href}
      />
    </DashChart>
  ) : null;
  const funnelHref = data.funnel?.href ?? workspace ?? salesHref;
  const funnel = funnelCard({ leads: leadsIn, called, quotes: deals?.quotes ?? null, apps: deals?.applications ?? null, month, zone: props.zone, href: funnelHref })
    ?? leadsFunnelCard(data)
    ?? (leadsIn !== null ? (
      <DashTable
        title="Lead to policy"
        period="this month"
        link={funnelHref ? { label: "Open the Funnel", href: funnelHref } : undefined}
        heads={["Step", "Leads"]}
        rows={[["leads", "Leads in", leadsIn], ["called", "Called", called], ["quoted", "Quoted", quoted], ["apps", "Applications", submitted], ["issued", "Issued", issued]]
          .filter((row): row is [string, string, number] => row[2] !== null)
          .map(([key, label, count]) => ({ key, cells: [label, n(count)], ...(funnelHref ? { href: funnelHref } : {}) }))}
        empty="No leads this month yet."
      />
    ) : null);

  /* ── Row 2: where leads came from · the vendor scorecard ─────────────────────────────────────────────── */
  const sources = workspace ? (
    <DashTable
      title="Leads by source"
      period="this month"
      link={data.sources ? { label: "Sources", href: data.sources.href } : { label: "Lead Sources", href: "/app/lead-sources" }}
      heads={["Source", "Leads", "Called"]}
      rows={(data.sources?.slices ?? []).map((slice) => ({ key: slice.key, cells: [slice.label, n(slice.value), slice.value ? `${Math.round((slice.called / slice.value) * 100)}%` : "—"], href: slice.href ?? workspace }))}
      empty="No leads this month. Import a list, or add a publisher or vendor, and their leads count here."
    />
  ) : null;
  const vendors = data.vendors && data.vendors.source === "scorecard" ? (
    <DashTable title="Vendors" period="this month" link={data.vendors.href ? { label: "True CPA", href: data.vendors.href } : undefined} heads={data.vendors.heads} rows={data.vendors.rows} empty="No vendor leads this month." />
  ) : null;

  /* ── Right column: the hero · speed to lead ─────────────────────────────────────────────────────────── */
  const heroData = data.hero;
  const hero = !heroData ? null : heroData.kind === "spend" ? (
    <DashHero
      kicker="Lead spend · this month"
      value={dollars(heroData.spendCents)}
      line={heroData.costPerSaleCents === null ? "No sale yet this month" : `${dollars(heroData.costPerSaleCents)} per sale`}
      facts={[...(heroData.costPerLeadCents === null ? [] : [{ label: "Per lead", value: dollars(heroData.costPerLeadCents) }]), { label: "Issued", value: n(heroData.issued) }]}
      href={heroData.href}
    />
  ) : heroData.kind === "ready" ? (
    <DashHero kicker="Leads ready to dial" value={n(heroData.ready)} line="waiting in the queue now" facts={leadsIn !== null ? [{ label: "In this month", value: n(leadsIn) }, ...(called !== null ? [{ label: "Called", value: n(called) }] : [])] : []} href={heroData.href} />
  ) : (
    <DashHero kicker="Leads in · this month" value={n(heroData.leadsIn)} facts={[{ label: "Called", value: n(heroData.called) }]} href={heroData.href} />
  );
  const list = data.speed ? (
    <DashList title="Speed to lead" period="newest" link={{ label: "All Leads", href: data.speed.href }} items={data.speed.items} empty="No leads yet. The newest leads show here with how fast each was first dialled." />
  ) : null;

  /* ── The page ─────────────────────────────────────────────────────────────────────────────────────────── */
  const fill = "lg:[&>*]:h-full lg:[&>*]:min-h-0 lg:[&>*]:overflow-hidden";
  const row1 = [chart, funnel].filter(Boolean);
  const row2 = [sources, vendors].filter(Boolean);
  const rowCount = (row1.length ? 1 : 0) + (row2.length ? 1 : 0);
  return (
    <div className="m-dash-ov flex w-full min-w-0 flex-col gap-4 pb-4 lg:min-h-0 lg:flex-1 lg:pb-0">
      {needs}
      {strip}
      <div className="grid min-w-0 grid-cols-1 items-stretch gap-4 lg:min-h-0 lg:flex-1 xl:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className={cn("grid min-w-0 grid-cols-1 gap-4 lg:min-h-0", rowCount === 2 ? "lg:grid-rows-[minmax(0,1.1fr)_minmax(0,1fr)]" : "lg:grid-rows-[minmax(0,1fr)]")}>
          {row1.length > 0 && <div className={cn("grid min-w-0 grid-cols-1 gap-4 lg:min-h-0", fill, row1.length === 2 && "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]")}>{chart}{funnel}</div>}
          {row2.length > 0 && <div className={cn("grid min-w-0 grid-cols-1 gap-4 lg:min-h-0", fill, row2.length === 2 && "lg:grid-cols-2")}>{sources}{vendors}</div>}
        </div>
        <div className="relative min-w-0">
          <div className="flex flex-col gap-4 xl:absolute xl:inset-0 xl:[&>*:last-child]:min-h-0 xl:[&>*:last-child]:flex-1 xl:[&>*:last-child]:overflow-hidden">{hero}{list}</div>
        </div>
      </div>
    </div>
  );
}
