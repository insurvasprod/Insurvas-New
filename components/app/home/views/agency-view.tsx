import type { ReactNode } from "react";

import { DashGoals, DashHero, DashList, DashReceived, DashStates, type DashItem, type DashTone } from "@/components/app/home/dash/dash-kit";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { cn } from "@/lib/utils";
import {
  daysLeft,
  issuedIn,
  loadAgencyView,
  monthName,
  pctChange,
  placementOf,
  premiumByState,
  producerGoals,
  submittedIn,
  type AgencyPeriod,
} from "@/lib/dashboard/views/agency";
import { carrierCard, dollars, funnelCard, lastDay, n, premiumCard } from "./agency-cards";
import type { DashViewProps } from "./view-props";

/**
 * The agency dashboard (Home › Agency), drawn as round 2 screens 1–2 of the canvas "Dashboards · by role":
 *
 *   the strip      Issued premium · Policies issued · Placement rate · 13-month persistency · Chargebacks
 *   main, row 1    Premium · submitted and issued (1.5) · Lead to policy (1)
 *   main, row 2    Producer goals (1.3) · Premium by carrier (1) · Premium by state (1)
 *   right, 300px   the commission card · Received vs expected · Recent activity, ending level with the main column
 *
 * Full width with the sidebar open or collapsed. Owner 2026-11-06 (second pass): a little scroll is fine, so each
 * row has room to show more; every figure, row and slice opens the page behind it; the activity shows what went
 * well (policies issued, money in), not lapses and clawbacks. A card whose read failed, or whose page this reader
 * cannot open, is left out. A manager (his reports, no agency money) gets no money card.
 */
export async function AgencyView({ props, period }: { props: DashViewProps; period: AgencyPeriod }) {
  const data = await loadAgencyView(props, period);
  const { links, month, previous, today, agency, agencyBefore, book, leads, accounting, persistency, apps, quotes } = data;
  const money = !props.noMoney;
  const zone = props.zone;
  const rows = book?.book?.rows ?? null;
  const policiesHref = links.policies;
  const monthHref = policiesHref ? `${policiesHref}?from=${month}-01&to=${lastDay(month)}` : undefined;
  const name = monthName(month);
  const before = monthName(previous);

  /* ── The strip ─────────────────────────────────────────────────────────────────────────────── */
  const now = rows ? issuedIn(rows, month) : null;
  // This month so far against the same days of last month (a whole month against six days says nothing).
  const soFar = period === "this" ? Number(today.slice(8, 10)) : undefined;
  const then = rows ? issuedIn(rows, previous, soFar) : null;
  const submitted = apps ? submittedIn(apps, month, zone) : null;
  const placed = apps ? placementOf(apps, month, zone) : null;
  const placedBefore = apps ? placementOf(apps, previous, zone) : null;
  // Chargebacks are stored as negative amounts; the tile shows what was taken back.
  const clawed = agency ? Math.abs(agency.producers.reduce((sum, row) => sum + row.chargebackCents, 0)) : null;
  const clawedBefore = agencyBefore ? Math.abs(agencyBefore.producers.reduce((sum, row) => sum + row.chargebackCents, 0)) : null;
  const clawedBy = agency ? agency.producers.filter((row) => row.chargebackCents !== 0).length : 0;

  const tiles: ReactNode[] = [];
  if (now && then && money) {
    const change = pctChange(now.cents, then.cents);
    const gap = now.cents - then.cents;
    tiles.push(<StatTile key="premium" label="Issued premium" value={dollars(now.cents)} delta={change !== null ? { value: change } : undefined} footnote={`${gap >= 0 ? "Up" : "Down"} ${dollars(Math.abs(gap))} on ${before}${soFar ? ` 1–${soFar}` : ""}`} href={monthHref} />);
  }
  if (now && then) {
    const change = pctChange(now.count, then.count);
    tiles.push(<StatTile key="issued" label="Policies issued" value={n(now.count)} delta={change !== null ? { value: change } : undefined} footnote={submitted !== null ? `Submitted ${n(submitted)}` : "This month"} href={monthHref} />);
  }
  if (placed) {
    tiles.push(<StatTile key="placement" label="Placement rate" value={`${placed.pct}%`} delta={placedBefore ? { value: placed.pct - placedBefore.pct, unit: " pts" } : undefined} footnote={`${n(placed.issued)} of ${n(placed.submitted)} issued`} href={links.applications ?? undefined} />);
  }
  if (persistency) {
    tiles.push(<StatTile key="m13" label="13-month persistency" value={persistency.text} footnote="Still paying after a year" href={links.persistency ?? undefined} />);
  }
  if (clawed !== null && money) {
    const change = clawedBefore !== null ? pctChange(clawed, clawedBefore) : null;
    tiles.push(<StatTile key="chargebacks" label="Chargebacks" value={dollars(clawed)} valueTone={clawed > 0 ? "warning" : undefined} delta={change !== null ? { value: change, goodWhen: "down" } : undefined} footnote={clawedBy ? `Clawed back · ${n(clawedBy)} ${clawedBy === 1 ? "producer" : "producers"}` : "Nothing clawed back"} href={links.ledger ?? undefined} />);
  }
  const strip = tiles.length ? <StatStrip label={`The agency in ${name}`}>{tiles}</StatStrip> : null;

  /* ── Row 1: premium, lead to policy ────────────────────────────────────────────────────────── */
  const premium = rows && apps && money ? premiumCard({ rows, apps, today, zone, policiesHref }) : null;
  const funnel = funnelCard({
    leads: leads?.chart?.totalIn ?? null,
    called: leads?.chart?.totalCalled ?? null,
    quotes,
    apps,
    month,
    zone,
    href: leads?.funnel?.href ?? leads?.chart?.href ?? links.applications,
    monthLabel: name,
  });

  /* ── Row 2: producer goals, carriers, states ───────────────────────────────────────────────── */
  const left = daysLeft(today);
  const goals = rows && money ? producerGoals(rows, month, previous) : null;
  // Every producer on the roster, not only those with a policy this month or last: their policies and placement too.
  const roster = new Map((agency?.producers ?? []).map((row) => [row.producerUserId, row]));
  const goalRows = goals ? [...goals] : [];
  for (const row of roster.values()) if (!goalRows.some((goal) => goal.userId === row.producerUserId)) goalRows.push({ userId: row.producerUserId, name: row.name, cents: 0, goalCents: 0 });
  const goalsCard = goals && links.producers ? (
    <DashGoals
      title="Producer goals"
      sub={`Issued premium · ${name} against ${before}`}
      link={{ label: "Producers", href: links.producers }}
      rows={goalRows.map((row) => {
        const record = roster.get(row.userId);
        const facts = [period === "this" ? `${left} ${left === 1 ? "day" : "days"} left` : name, record ? `${n(record.issued)} issued` : null, record && record.submitted ? `${record.placement} placed` : null].filter(Boolean);
        return {
          key: row.userId,
          name: row.name,
          note: facts.join(" · "),
          value: dollars(row.cents),
          of: row.goalCents ? `of ${dollars(row.goalCents)}` : "first month",
          share: row.goalCents ? Math.min(1, row.cents / row.goalCents) : row.cents ? 1 : 0,
          href: record?.producerId ? `/app/producers/${record.producerId}` : policiesHref ? `${policiesHref}?agent=${encodeURIComponent(row.userId)}&from=${month}-01&to=${lastDay(month)}` : undefined,
        };
      })}
      empty={`No producer has a policy in ${name} or ${before} yet.`}
    />
  ) : null;

  const shares = book?.book?.shares ?? null;
  const carriers = shares && policiesHref && book?.book ? carrierCard({ shares, totalCents: book.book.totals.annualCents, inForce: book.book.totals.inForce, money, policiesHref }) : null;

  // The month's issued applications by state, else this year's, so the card has the agency's spread to show.
  const monthStates = apps ? premiumByState(apps, month, previous, zone) : null;
  const yearStates = apps && (monthStates?.length ?? 0) < 3 ? premiumByState(apps, month, previous, zone, 5, true) : null;
  const states = yearStates && yearStates.length > (monthStates?.length ?? 0) ? yearStates : monthStates;
  const statesCard = states && links.applications ? (
    <DashStates
      title={money ? "Premium by state" : "Policies by state"}
      sub={states === yearStates ? `Issued this year · ↑↓ on ${before}` : `Issued in ${name} · ↑↓ on ${before}`}
      link={{ label: "Applications", href: links.applications }}
      heads={["State", "Policies", money ? "Issued" : "Share"]}
      rows={states.map((row) => ({
        key: row.key,
        label: row.label,
        policies: n(row.policies),
        trend: row.trend,
        value: money ? dollars(row.cents) : `${Math.round((row.policies / Math.max(1, states.reduce((sum, item) => sum + item.policies, 0))) * 100)}%`,
        href: links.applications ?? undefined,
      }))}
      empty={`No application issued in ${name} yet.`}
    />
  ) : null;

  /* ── Right column: the commission card, received vs expected, recent activity ──────────────── */
  // The carriers' money in this month (the P&L statement's own "in"), and what the pay issues say is still owed.
  const received = accounting?.statement?.inCents ?? null;
  const owedShort = accounting?.payIssuesOwedCents ?? null;
  const books = accounting?.month.label ?? name;
  const hero = money && received !== null ? (
    <DashHero
      kicker={`COMMISSION · ${books.split(" ")[0].toUpperCase()}`}
      value={dollars(received)}
      line={`in from carriers · ${books}`}
      facts={[
        ...(agency?.overrideCents !== null && agency?.overrideCents !== undefined ? [{ label: "Override", value: dollars(agency.overrideCents) }] : []),
        ...(agency?.payableOutCents !== null && agency?.payableOutCents !== undefined ? [{ label: "Owed out", value: dollars(agency.payableOutCents) }] : []),
      ]}
      href={links.ledger ?? accounting?.hrefs.pnl ?? "/app/ledger"}
    />
  ) : null;
  const expected = received !== null && owedShort !== null ? received + owedShort : null;
  const payIssues = accounting?.needs.payIssues ?? null;
  const receivedCard = money && received !== null && expected !== null ? (
    <DashReceived
      title="Received vs expected"
      received={dollars(received)}
      expected={dollars(expected)}
      pct={expected ? Math.round((received / expected) * 100) : 100}
      short={owedShort ? { text: `${dollars(owedShort)} still owed${payIssues ? ` · ${n(payIssues)} pay ${payIssues === 1 ? "issue" : "issues"}` : ""}`, href: links.discrepancies ?? undefined } : undefined}
      href={links.ledger ?? undefined}
    />
  ) : null;

  // What went well (owner: no negative news here): policies issued and money in. Lapses live on Retention.
  const events: Array<DashItem & { on: string }> = [];
  for (const item of money ? accounting?.recent ?? [] : []) {
    if (item.cents <= 0 || item.tone === "danger" || item.tone === "warning") continue;
    events.push({ key: `m-${item.key}`, mark: "$", tone: "info" as DashTone, title: item.title, detail: item.detail, value: `+${dollars(item.cents)}`, when: item.on.slice(5).replace("-", "/"), href: item.href, on: item.on });
  }
  for (const row of rows ?? []) {
    if (!row.issueDate || row.issueDate.slice(0, 7) !== month) continue;
    events.push({ key: `p-${row.carrierId}-${row.policyNumber}`, mark: "✓", tone: "good", title: "Policy issued", detail: `${row.agentName ?? row.clientName ?? "Policy"} · ${row.carrierName}`, value: row.annualCents ? `+${dollars(row.annualCents)}/yr` : undefined, when: row.issueDate.slice(5).replace("-", "/"), href: row.href ?? `${policiesHref ?? "/app/policies"}?q=${encodeURIComponent(row.policyNumber)}`, on: row.issueDate });
  }
  events.sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0));
  const activity = events.length || book?.changes || accounting?.recent ? (
    <DashList title="Recent activity" link={book?.links.changes ? { label: "All changes", href: book.links.changes } : undefined} items={events.slice(0, 12)} empty="Nothing has happened yet." />
  ) : null;

  /* ── The page, as drawn ────────────────────────────────────────────────────────────────────── */
  const fill = "lg:[&>*]:h-full lg:[&>*]:min-h-0 lg:[&>*]:overflow-hidden";
  const row1 = [premium, funnel].filter(Boolean);
  const row2 = [goalsCard, carriers, statesCard].filter(Boolean);
  return (
    <div className="flex w-full min-w-0 flex-col gap-4 pb-4">
      {strip}
      <div className="grid min-w-0 grid-cols-1 items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_300px] 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          {row1.length > 0 && <div className={cn("grid min-w-0 grid-cols-1 gap-4 lg:h-[380px]", fill, row1.length === 2 && "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]")}>{premium}{funnel}</div>}
          {row2.length > 0 && <div className={cn("grid min-w-0 grid-cols-1 gap-4 lg:h-[360px]", fill, row2.length === 3 ? "lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]" : row2.length === 2 && "lg:grid-cols-2")}>{goalsCard}{carriers}{statesCard}</div>}
        </div>
        {/* The right column ends where the main column ends (owner: "in the same line"): it takes the row's height, never sets it. */}
        <div className="relative min-w-0">
          <div className="flex flex-col gap-4 xl:absolute xl:inset-0 xl:[&>*:last-child]:min-h-0 xl:[&>*:last-child]:flex-1 xl:[&>*:last-child]:overflow-hidden">{hero}{receivedCard}{activity}</div>
        </div>
      </div>
    </div>
  );
}
