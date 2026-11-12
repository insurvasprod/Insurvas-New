import type { ReactNode } from "react";
import Link from "next/link";

import { Card } from "@/components/ui/card";
import { BarList, BarSeries, ChartHeading, ChartLegend, type BarListRow } from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/page-states";
import { STEP_LABELS, type Step } from "@/lib/retention/cases/ladder";
import { hasFigures, resultRateText, type ResultLine, type Results } from "@/lib/retention/cases/results";
import { rateText, type ScoreLine } from "@/lib/retention/cases/scorecard";
import type { ReasonLine } from "@/lib/retention/scorecard";

import { casesHref, money } from "./scorecard-tables";

/**
 * Retention › Scorecard's and Results' chart views (Reports round 7, owner pick "recommended, no donuts", 2026-11-11;
 * docs/la4/mockups-r7/reports.html 9·2, 9·4, 10·2, 10·3). Server-safe: no "use client", so both the server pages and
 * the Radar check's client board draw them. Every row, bar and key row opens the cases behind it.
 */

const n = (value: number) => value.toLocaleString("en-US");
const kept = (cents: number) => (cents ? `${money(cents)}/mo` : null);
const join = (...parts: Array<string | null | false>) => parts.filter(Boolean).join(" · ");
/** The rate beside the saves: "3 of 3" under the floor, "75%" over it, nothing with none decided. */
const rateShort = (text: string) => (text === "—" ? null : text.replace(/ saved$/, ""));
const LINK = "whitespace-nowrap text-sm text-foreground underline-offset-2 hover:underline";

/** A chart's card: the heading (its title, the period line, one link), the chart, its key. */
/** `toolbar`: the board's own controls (the period, the person) over the heading, where its table card has them. */
export function ChartCard({ title, period, link, children, legend, toolbar }: { title: string; period?: string; link?: { label: string; href: string }; children: ReactNode; legend?: ReactNode; toolbar?: ReactNode }) {
  return (
    <Card className="px-4">
      {toolbar}
      <ChartHeading title={title} period={period} action={link ? <Link href={link.href} className={LINK}>{link.label} ›</Link> : undefined} />
      {children}
      {legend}
    </Card>
  );
}

const EMPTY = <EmptyState title="No cases in this period" hint="Cases come from the carrier files; they show here as they are worked and closed." />;

/** The key for "open, with the saves solid inside". */
function OpenSavedKey({ outer, owner }: { outer: string; owner: string | null }) {
  return (
    <ChartLegend
      items={[
        { key: "outer", label: outer, tone: "faint", href: casesHref({ owner }) },
        { key: "saved", label: "Saved (proven by a file)", tone: "strong", href: casesHref({ step: "closed", owner }) },
      ]}
    />
  );
}

/** 9·2 By person: a person's open cases, their saves solid inside; a row opens the person. */
export function ScorecardPeopleChart({ people, total, names, viewerId, personHref, periodLabel, tableHref }: { people: ScoreLine[]; total: ScoreLine; names: Record<string, string>; viewerId: string; personHref: (userId: string) => string; periodLabel: string; tableHref: string }) {
  const nothing = total.open + total.saved + total.lost + total.closedNoSave === 0;
  const rows: BarListRow[] = people.map((l) => {
    const owner = l.key === "nobody" ? null : l.key === viewerId ? "me" : l.key;
    return {
      key: l.key,
      label: l.key === "nobody" ? "Nobody yet" : names[l.key] ?? "Someone no longer here",
      value: l.open,
      inner: l.saved,
      figure: `${n(l.open)} open`,
      caption: join(`${n(l.saved)} saved`, rateShort(rateText(l)), kept(l.keptCents)),
      href: l.key === "nobody" ? casesHref({ owner }) : personHref(l.key),
    };
  });
  return (
    <ChartCard title="Cases by person" period={join(periodLabel, `${n(total.open)} open`, `${n(total.saved)} saved`, `${n(total.lost)} lost`, kept(total.keptCents) && `${kept(total.keptCents)} kept`)} link={{ label: "Open the rows", href: tableHref }} legend={nothing ? undefined : <OpenSavedKey outer="Open" owner={null} />}>
      {nothing ? EMPTY : <BarList rows={rows} summary="Open cases by person, with the saves inside each bar" unit="cases" />}
    </ChartCard>
  );
}

/**
 * 9·2 By step and 9·4 a person's page: where the open cases sit, by the step each is on (the board's donut, drawn as
 * bars). A row opens Cases at that step (and the person's, on their page).
 */
export function ScorecardStepChart({ steps, total, owner, title, periodLabel, tableHref }: { steps: ScoreLine[]; total: ScoreLine; owner: string | null; title: string; periodLabel: string; tableHref: string }) {
  const nothing = total.open + total.saved + total.lost + total.closedNoSave === 0;
  const rows: BarListRow[] = steps.filter((l) => l.open + l.saved + l.lost + l.closedNoSave > 0).sort((a, b) => b.open - a.open).map((l) => ({
    key: l.key,
    label: STEP_LABELS[l.key as Step] ?? l.key,
    value: l.open,
    inner: l.saved,
    figure: n(l.open),
    caption: join(`${n(l.saved)} saved`, kept(l.keptCents)),
    href: casesHref({ step: l.key as Step, owner }),
  }));
  return (
    <ChartCard title={title} period={join(periodLabel, `${n(total.open)} open`, `${n(total.saved)} saved`, `${n(total.lost)} lost`, kept(total.keptCents) && `${kept(total.keptCents)} kept`)} link={{ label: "Open the rows", href: tableHref }} legend={nothing ? undefined : <OpenSavedKey outer="Open" owner={owner} />}>
      {nothing ? EMPTY : <BarList rows={rows} summary="Open cases by the step each is on, with the saves inside" unit="cases" total={{ label: "Open cases", figure: n(total.open), href: casesHref({ owner }) }} />}
    </ChartCard>
  );
}

/** 10·2: opened, the saves solid inside, sorted by opened; a row opens Cases at that step or carrier. */
function openedRows(lines: ResultLine[], href: (l: ResultLine) => string): BarListRow[] {
  return lines.filter(hasFigures).sort((a, b) => b.opened - a.opened || b.saved - a.saved).map((l) => ({
    key: l.key,
    label: l.label,
    value: l.opened,
    inner: l.saved,
    figure: `${n(l.opened)} opened`,
    caption: join(`${n(l.saved)} saved`, rateShort(resultRateText(l)), kept(l.keptCents)),
    href: href(l),
  }));
}

const resultsLine = (results: Results, periodLabel: string) => join(periodLabel, `${n(results.total.opened)} opened`, `${n(results.total.saved)} saved`, kept(results.total.keptCents) && `${kept(results.total.keptCents)} kept`, results.total.openCents > 0 && `${money(results.total.openCents)}/mo still at stake`);

export function ResultsStepChart({ results, periodLabel, tableHref }: { results: Results; periodLabel: string; tableHref: string }) {
  const nothing = !hasFigures(results.total);
  return (
    <ChartCard title="What the ladder saved, by step" period={resultsLine(results, periodLabel)} link={{ label: "Open the rows", href: tableHref }} legend={nothing ? undefined : <OpenSavedKey outer="Opened" owner={null} />}>
      {nothing ? EMPTY : <BarList rows={openedRows(results.byStep, (l) => casesHref({ step: l.key as Step }))} summary="Cases opened by the step they were on, with the saves inside" unit="cases" />}
    </ChartCard>
  );
}

export function ResultsCarrierChart({ results, periodLabel, tableHref }: { results: Results; periodLabel: string; tableHref: string }) {
  const nothing = !hasFigures(results.total);
  const count = results.byCarrier.filter(hasFigures).length;
  return (
    <ChartCard title="Cases by carrier" period={join(periodLabel, `${n(count)} ${count === 1 ? "carrier" : "carriers"}`, `${n(results.total.saved)} saved`)} link={{ label: "Open the rows", href: tableHref }} legend={nothing ? undefined : <OpenSavedKey outer="Opened" owner={null} />}>
      {nothing ? EMPTY : <BarList rows={openedRows(results.byCarrier, (l) => casesHref({ carrier: l.key }))} summary="Cases opened by carrier, with the saves inside" unit="cases" />}
    </ChartCard>
  );
}

const days = (value: number | null) => (value === null ? "—" : `${n(value)} ${value === 1 ? "day" : "days"}`);

/** 10·3 Time to save: saves by how long they took, opened to proven (from each save's opened and resolved dates). */
export function ResultsTimeChart({ results, periodLabel, tableHref }: { results: Results; periodLabel: string; tableHref: string }) {
  const t = results.totalTime;
  return (
    <ChartCard title="Days from opened to proven" period={join(`saves closed in ${periodLabel.replace(/^The /, "the ")}`, `${n(t.saves)}`)} link={{ label: "Open the saves", href: casesHref({ step: "closed" }) }}>
      {t.saves === 0 ? (
        <EmptyState title="No saves in this period" hint="A save counts when a later carrier file proves it. Widen the period." />
      ) : (
        <>
          <BarSeries
            bars={results.saveDays.map((b) => ({ key: b.key, label: b.label, value: b.saves }))}
            summary={`Saves by how many days they took: ${results.saveDays.map((b) => `${b.label} ${b.saves}`).join(", ")}`}
            unit="saves"
            labels="all"
            names={{ value: "Saves" }}
            hrefFor={() => casesHref({ step: "closed" })}
          />
          <p className="m-0 text-sm text-muted-foreground">
            Median {days(t.medianDays)} · fastest {days(t.fastestDays)} · slowest {days(t.slowestDays)} · <Link href={tableHref} className={LINK}>by step ›</Link>
          </p>
        </>
      )}
    </ChartCard>
  );
}

/* ── The LA-5.8 card's chart view (the fallback before the ladder's tables exist; owner 2026-11-12: the Table · Chart
   switch on every Reports sub-page). Counts only: the save rate lives in the by-reason table alone (LA-5.8). ──── */

type FallbackCard = { userId: string; name: string; policiesWorked: number; blended: ReasonLine };

/** Everyone: each person's cases worked, the saved solid inside; a row opens the person's reasons as rows. */
export function FallbackPeopleChart({ cards, periodLabel, personHref, tableHref, toolbar }: { cards: FallbackCard[]; periodLabel: string; personHref: (userId: string) => string; tableHref: string; toolbar?: ReactNode }) {
  const cases = cards.reduce((sum, c) => sum + c.blended.cases, 0);
  const saved = cards.reduce((sum, c) => sum + c.blended.saved, 0);
  const rows: BarListRow[] = [...cards].sort((a, b) => b.blended.cases - a.blended.cases || b.blended.saved - a.blended.saved).map((c) => ({
    key: c.userId,
    label: c.name,
    value: c.blended.cases,
    inner: c.blended.saved,
    figure: `${n(c.blended.cases)} worked`,
    caption: join(`${n(c.blended.saved)} saved`, `${n(c.blended.lost)} lost`, `${n(c.policiesWorked)} ${c.policiesWorked === 1 ? "policy" : "policies"}`),
    href: personHref(c.userId),
  }));
  return (
    <ChartCard toolbar={toolbar} title="Cases worked by person" period={join(periodLabel, `${n(cases)} worked`, `${n(saved)} saved`)} link={{ label: "Open the rows", href: tableHref }} legend={cases ? <ChartLegend items={[{ key: "worked", label: "Worked (a policy, for one reason)", tone: "faint", href: tableHref }, { key: "saved", label: "Saved (in force after being worked)", tone: "strong", href: tableHref }]} /> : undefined}>
      {cases ? <BarList rows={rows} summary="Cases worked by person, with the saved inside each bar" unit="cases" /> : <EmptyState title="Nothing worked in this period" hint="Calls logged on the Save queue and the paper-bill campaign show here." />}
    </ChartCard>
  );
}

/** A person's reasons: cases worked for each reason, the saved solid inside; a row opens the by-reason table. */
export function FallbackReasonChart({ name, lines, blended, labels, periodLabel, tableHref, toolbar }: { name: string; lines: ReasonLine[]; blended: ReasonLine; labels: Record<string, string>; periodLabel: string; tableHref: string; toolbar?: ReactNode }) {
  const rows: BarListRow[] = [...lines].sort((a, b) => b.cases - a.cases || b.saved - a.saved).map((l) => ({
    key: l.reason,
    label: labels[l.reason] ?? l.reason,
    value: l.cases,
    inner: l.saved,
    figure: `${n(l.cases)} worked`,
    caption: join(`${n(l.saved)} saved`, `${n(l.lost)} lost`, l.unreachable > 0 && `${n(l.unreachable)} unreachable`),
    href: tableHref,
  }));
  return (
    <ChartCard toolbar={toolbar} title={`${name}'s cases by reason`} period={join(periodLabel, `${n(blended.cases)} worked`, `${n(blended.saved)} saved`, `${n(blended.unreachable)} unreachable`)} link={{ label: "Open the save rate", href: tableHref }} legend={lines.length ? <ChartLegend items={[{ key: "worked", label: "Worked", tone: "faint", href: tableHref }, { key: "saved", label: "Saved", tone: "strong", href: tableHref }]} /> : undefined}>
      {lines.length ? <BarList rows={rows} summary={`${name}'s cases worked by reason, with the saved inside each bar`} unit="cases" total={{ label: "All reasons", figure: `${n(blended.cases)} worked`, href: tableHref }} /> : <EmptyState title="No cases in this period" hint="A case is one policy worked for one reason." />}
    </ChartCard>
  );
}
