import { HomePanel } from "@/components/app/home/home-panel";
import { firstOpenable } from "@/lib/dashboard/roleHome";
import { monthOf } from "@/lib/dashboard/views/agency";
import { dayKey, loadSalesSnapshot } from "@/lib/dashboard/views/sales";
import { funnelCard } from "./agency-cards";
import { DashChart, DashFunnel, DashHero, DashLayout, DashList, DashNeeds, DashTable } from "@/components/app/home/dash/dash-kit";
import { DonutChart, LineSeries, type ChartTone } from "@/components/ui/chart";
import { dollars, loadLeadsView } from "@/lib/dashboard/views/leads";

import type { DashViewProps } from "./view-props";

/** The donut's ramp, largest slice first; "Other sources" is always the quiet one. */
const RAMP: ChartTone[] = ["strong", "mid", "soft", "faint", "quiet"];

/**
 * Dashboard › Leads (/app/dashboard?view=leads, owner 2026-11-06). Everything is read by
 * lib/dashboard/views/leads (scope, page gates and money rules there); a part that was not read is left
 * out, never drawn as zero.
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

/** The Applications page, as data (lib/menu: no menu key inside a conditional). */
const SALES_PAGE = ["sell.applications"] as const;

export async function LeadsView(props: DashViewProps) {
  // Lead to policy reads the same cases and applications as the Overview and the agency dashboard, so the three
  // funnels agree and every step is one cohort (the dial funnel's steps came from different lists).
  const salesHref = firstOpenable(SALES_PAGE, props.available, props.context.role, props.solo);
  const [data, deals] = await Promise.all([
    loadLeadsView(props),
    salesHref ? loadSalesSnapshot(props.context.tenantId, props.scope).catch(() => null) : Promise.resolve(null),
  ]);
  const n = (value: number) => value.toLocaleString("en-US");

  const needs = data.needs ? <DashNeeds items={data.needs} /> : null;

  const big = data.chart ? (
    <DashChart
      title="Leads in"
      link={{ label: "Open leads", href: data.chart.href }}
      total={n(data.chart.totalIn)}
      totalLine={`this month · ${n(data.chart.totalCalled)} called${data.chart.capped ? " · first 20,000 read" : ""}`}
      legend={[{ label: "Leads in", tone: "primary" }, { label: "Leads called", tone: "info" }]}
    >
      <LineSeries
        points={data.chart.leadsIn}
        compare={{ points: data.chart.leadsCalled, label: "Leads called" }}
        summary={`Leads in and leads called per day this month: ${n(data.chart.totalIn)} in, ${n(data.chart.totalCalled)} called.`}
        unit="leads"
        hrefFor={() => data.chart!.href}
      />
    </DashChart>
  ) : null;

  const side = data.sources ? (
    <HomePanel title="Leads by source" period="this month" link={{ label: "Sources", href: data.sources.href }}>
      <DonutChart
        segments={data.sources.slices.map((slice, index) => ({ key: slice.key, label: slice.label, value: slice.value, tone: slice.key === "other" ? "quiet" : RAMP[Math.min(index, RAMP.length - 2)], ...(slice.href ? { href: slice.href } : {}) }))}
        summary={`${n(data.sources.total)} leads this month by source: ${data.sources.slices.map((slice) => `${slice.label} ${n(slice.value)}`).join(", ")}.`}
        centerLabel="leads"
      />
    </HomePanel>
  ) : null;

  const month = monthOf(dayKey(props.now, props.zone));
  const left = funnelCard({ leads: data.chart?.totalIn ?? null, called: data.chart?.totalCalled ?? null, quotes: deals?.quotes ?? null, apps: deals?.applications ?? null, month, zone: props.zone, href: data.funnel?.href ?? data.chart?.href ?? salesHref }) ?? leadsFunnelCard(data);

  const right = data.vendors ? (
    <DashTable
      title={data.vendors.source === "scorecard" ? "Vendors" : "Sources"}
      period="this month"
      link={data.vendors.href ? { label: data.vendors.source === "scorecard" ? "True CPA" : "Open leads", href: data.vendors.href } : undefined}
      heads={data.vendors.heads}
      rows={data.vendors.rows}
      empty="No vendor leads this month."
    />
  ) : null;

  const heroData = data.hero;
  const hero = !heroData ? null : heroData.kind === "spend" ? (
    <DashHero
      kicker="Lead spend · this month"
      value={dollars(heroData.spendCents)}
      line={heroData.costPerSaleCents === null ? "No sale yet this month" : `${dollars(heroData.costPerSaleCents)} per sale`}
      facts={[
        ...(heroData.costPerLeadCents === null ? [] : [{ label: "Per lead", value: dollars(heroData.costPerLeadCents) }]),
        { label: "Issued", value: n(heroData.issued) },
      ]}
      href={heroData.href}
    />
  ) : heroData.kind === "ready" ? (
    <DashHero kicker="Leads ready to dial" value={n(heroData.ready)} line="waiting in the queue now" href={heroData.href} />
  ) : (
    <DashHero kicker="Leads in · this month" value={n(heroData.leadsIn)} facts={[{ label: "Called", value: n(heroData.called) }]} href={heroData.href} />
  );

  const list = data.speed ? (
    <DashList title="Speed to lead" period="newest" link={{ label: "All leads", href: data.speed.href }} items={data.speed.items} empty="No leads yet." />
  ) : null;

  return <DashLayout needs={needs} big={big} side={side} left={left} right={right} hero={hero} list={list} />;
}
