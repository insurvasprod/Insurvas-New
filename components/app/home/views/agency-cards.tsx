import { DashChart, DashColumns, DashRing } from "@/components/app/home/dash/dash-kit";
import { HomePanel } from "@/components/app/home/home-panel";
import { DonutChart, LineSeries, type ChartTone } from "@/components/ui/chart";
import { DeltaChip } from "@/components/ui/stat";
import {
  issuedIn,
  issuedYearToDate,
  leadToPolicy,
  monthName,
  pctChange,
  placementOf,
  premiumByMonth,
  type AppLite,
  type PolicyLite,
} from "@/lib/dashboard/views/agency";

/**
 * The cards the agency dashboard and the dashboard's Overview share (owner 2026-11-06: "same cards on the
 * dashboard"), drawn as round 2 screens 1–2 and round 3 screen 1. Each takes the rows its page already read and
 * the links this reader may open; none reads anything itself.
 */
export const dollars = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
export const n = (value: number) => value.toLocaleString("en-US");
export const lastDay = (key: string) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).toISOString().slice(0, 10);
const pctText = (pct: number) => `${pct < 10 && pct % 1 ? pct.toFixed(1) : Math.round(pct)}%`;

/** "Premium · submitted and issued": this year by month, hover for each month's figures, and the year's facts. */
export function premiumCard({ rows, apps, today, zone, policiesHref }: { rows: readonly PolicyLite[]; apps: readonly AppLite[]; today: string; zone: string; policiesHref: string | null }) {
  const year = today.slice(0, 4);
  const months = premiumByMonth(rows, apps, today, zone);
  if (months.length < 2) return null;
  const ytd = issuedYearToDate(rows, year, today);
  const ytdBefore = issuedYearToDate(rows, String(Number(year) - 1), today);
  const change = pctChange(ytd, ytdBefore);
  const submitted = months.reduce((sum, month) => sum + month.submitted, 0);
  const issuedCount = rows.filter((row) => row.issueDate && row.issueDate >= `${year}-01-01` && row.issueDate <= today).length;
  const best = months.reduce((top, month) => (month.issued > top.issued ? month : top), months[0]);
  const facts = [
    { label: "Policies issued", value: n(issuedCount) },
    { label: "Submitted", value: dollars(submitted) },
    { label: "Average policy", value: issuedCount ? `${dollars(ytd / issuedCount)}/yr` : "—" },
    { label: "Best month", value: best.issued ? `${best.label} · ${dollars(best.issued)}` : "—" },
  ];
  return (
    <DashChart
      title="Premium · submitted and issued"
      link={policiesHref ? { label: "Policies", href: `${policiesHref}?from=${year}-01-01&to=${today}` } : undefined}
      total={dollars(ytd)}
      totalLine="issued this year"
      change={change !== null && change > 0 ? <DeltaChip value={change} title={`On ${Number(year) - 1} to this day`} /> : undefined}
      legend={[{ label: "Issued", tone: "primary" }, { label: "Submitted", tone: "info" }]}
      legendTop
    >
      <LineSeries
        points={months.map((point) => ({ key: point.key, label: `${point.label} ${year}`, value: Math.round(point.issued / 100) }))}
        compare={{ points: months.map((point) => ({ key: point.key, label: point.label, value: Math.round(point.submitted / 100) })), label: "Submitted" }}
        summary={`Annual premium issued and submitted each month of ${year}.`}
        format={(value) => `$${value.toLocaleString("en-US")}`}
        unit="issued"
        hrefFor={policiesHref ? (point) => `${policiesHref}?from=${point.key}-01&to=${lastDay(point.key)}` : undefined}
      />
      <dl className="m-0 mt-2 grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0 rounded-xl bg-[var(--surface-alt)] px-3 py-2">
            <dt className="truncate text-[0.6875rem] text-muted-foreground">{fact.label}</dt>
            <dd className="m-0 truncate text-[0.8125rem] font-semibold tabular-nums text-foreground">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </DashChart>
  );
}

/** "Lead to policy": leads in, called, quoted, apps, issued this month, as columns. */
export function funnelCard({ leads, called, quotes, apps, month, zone, href, monthLabel }: {
  leads: number | null;
  called: number | null;
  quotes: ReadonlyArray<{ caseId: string; createdAt: string; outcome: string }> | null;
  apps: readonly AppLite[] | null;
  month: string;
  zone: string;
  href: string | null;
  monthLabel?: string;
}) {
  const built = leadToPolicy({ leads, called, quotes, apps }, month, zone);
  if (!built) return null;
  const last = built.steps[built.steps.length - 1];
  return (
    <DashColumns
      title={last.key === "issued" ? "Lead to policy" : `Lead to ${last.label.toLowerCase()}`}
      sub={`Every lead in ${monthLabel ?? monthName(month)}, to ${last.key === "issued" ? "an issued policy" : last.label.toLowerCase()}`}
      rate={pctText(built.rate)}
      steps={built.steps.map((step) => ({ key: step.key, label: step.label, count: step.count, pct: step.pct, ...(href ? { href } : {}) }))}
      link={href ? { label: "Open the funnel", href } : undefined}
    />
  );
}

/** "November goal": issued premium against the goal (last month's issued; no goal is stored), placement, persistency. */
export function goalCard({ rows, apps, month, previous, zone, policiesHref, applicationsHref, persistency, persistencyHref }: {
  rows: readonly PolicyLite[];
  apps: readonly AppLite[] | null;
  month: string;
  previous: string;
  zone: string;
  policiesHref: string | null;
  applicationsHref: string | null;
  persistency: { text: string } | null;
  persistencyHref: string | null;
}) {
  const now = issuedIn(rows, month);
  const goal = issuedIn(rows, previous);
  const target = Math.max(goal.cents, now.cents, 1);
  const share = Math.round((now.cents / target) * 100);
  const placed = apps ? placementOf(apps, month, zone) : null;
  const monthHref = policiesHref ? `${policiesHref}?from=${month}-01&to=${lastDay(month)}` : undefined;
  return (
    <DashRing
      title={`${monthName(month)} goal`}
      link={monthHref ? { label: "Policies", href: monthHref } : undefined}
      value={share}
      center={`${share}%`}
      label={`${share}% of the ${monthName(month)} goal, ${monthName(previous)}'s issued premium`}
      lines={[
        { label: "Issued", value: `${dollars(now.cents)} of ${dollars(goal.cents || now.cents)}`, href: monthHref },
        { label: "Policies issued", value: n(now.count), href: monthHref },
        ...(placed ? [{ label: "Placement rate", value: `${placed.pct}%`, href: applicationsHref ?? undefined }] : []),
        ...(persistency ? [{ label: "13-month persistency", value: persistency.text, href: persistencyHref ?? undefined }] : []),
      ]}
    />
  );
}

/** "Premium by carrier": one colour per carrier, the year's premium in force in the middle. */
const CARRIER_TONES: ChartTone[] = ["cat1", "cat2", "cat3", "cat4", "cat6", "quiet"];
export function carrierCard({ shares, totalCents, inForce, money, policiesHref }: { shares: ReadonlyArray<{ key: string; label: string; value: number; href: string }>; totalCents: number; inForce: number; money: boolean; policiesHref: string }) {
  return (
    <HomePanel title={money ? "Premium by carrier" : "Policies by carrier"} sub="In force" link={{ label: "Policies in force", href: `${policiesHref}?show=inforce` }} roundLink bodyClassName="justify-center">
      {shares.length ? (
        <DonutChart
          segments={shares.map((share, index) => ({ key: share.key, label: share.label, value: share.value, tone: share.key === "other" || /other/i.test(share.label) ? "quiet" : CARRIER_TONES[Math.min(index, CARRIER_TONES.length - 2)], href: share.href }))}
          summary={money ? "Annual premium in force, by carrier." : "Policies in force, by carrier."}
          centerValue={money ? dollars(totalCents) : n(inForce)}
          centerLabel={money ? "a year" : "in force"}
          format={money ? dollars : n}
          legend="share"
          className="gap-3 [&>div:first-of-type]:size-36 [&>div:first-of-type_span:first-child]:text-lg"
        />
      ) : <p className="m-0 text-sm text-muted-foreground">No policy is in force yet.</p>}
    </HomePanel>
  );
}
