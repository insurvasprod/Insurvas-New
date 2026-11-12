import type { ReactNode } from "react";
import Link from "next/link";

import { DataToolbar } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { STEP_SLUG, type Step } from "@/lib/retention/cases/ladder";
import { MIN_RESULTS_DECIDED, hasFigures, resultRateText, type ResultLine, type Results, type SaveTime } from "@/lib/retention/cases/results";

import type { CaseTrend } from "@/lib/retention/cases/trend";

import { CountLink, RateChip, casesHref, money } from "./scorecard-tables";

/**
 * Retention › Results, what the ladder saved (round 7, owner pick 6·A, 2026-11-10; docs/la4/mockups-r7/retention.html).
 * Server-drawn. Saves: four figures, then a row a step the case was on; By carrier: the same table a row a carrier;
 * Time to save: days from opened to proven, by step. Every count opens Cases filtered; under 20 decided cases a cell
 * shows the counts, never a percentage. Nothing in a row decides or edits anything.
 */

const NUM = "whitespace-nowrap text-right tabular-nums";
const FIRST = "whitespace-nowrap font-medium text-foreground";
const EMPTY = <EmptyState title="No cases in this period" hint="Cases come from the carrier files; they show here as they are worked and closed." />;
const FOOT = <span>Saved only when a later carrier file proves it · under {MIN_RESULTS_DECIDED} decided cases a cell shows the count, never a percentage</span>;
const nothing = (l: ResultLine) => !hasFigures(l);

/** Six columns (round 7, 10·1): closed without a save leaves the rows and is a link on the toolbar line when not zero. */
const closedLink = (total: ResultLine) => total.closedNoSave ? (
  <DataToolbar>
    <Link href={casesHref({ step: "closed" })} className="text-sm text-foreground underline-offset-2 hover:underline">{total.closedNoSave.toLocaleString("en-US")} closed without a save ›</Link>
  </DataToolbar>
) : undefined;

/** A card's small chart (Reports round 7, 0·C): the same figure a week at a time, when there are two points. */
export const spark = (points: number[] | undefined) => (points && points.length > 1 ? { points, tone: "primary" as const, placement: "under" as const } : undefined);

/** Board 6·A's strip: Saved · Lost · Still open, each said once and each opening Cases (the rate is the table's). */
export function ResultsStrip({ total, trend }: { total: ResultLine; trend?: CaseTrend }) {
  // "Advance kept" is left out: the ladder does not keep the advance at risk on the day a case was saved, and today's
  // unearned figure on a saved policy is not what the save kept. It joins the strip when the save records it.
  return (
    <StatStrip label="What the ladder saved">
      <StatTile label="Saved" href={casesHref({ step: "closed" })} value={total.saved.toLocaleString("en-US")} footnote={`${money(total.keptCents)}/mo kept · proven by a file`} trend={spark(trend?.saved)} />
      <StatTile label="Lost" href={casesHref({ step: "closed" })} value={total.lost.toLocaleString("en-US")} footnote={`${total.closedNoSave.toLocaleString("en-US")} closed without a save`} trend={spark(trend?.lost)} />
      <StatTile label="Still open" href={casesHref({})} value={total.open.toLocaleString("en-US")} footnote={`${money(total.openCents)}/mo at stake`} trend={spark(trend?.open)} />
    </StatStrip>
  );
}

function Row({ l, first, step, carrier, strong = false }: { l: ResultLine; first: ReactNode; step?: Step; carrier?: string; strong?: boolean }) {
  return (
    <tr data-total={strong || undefined}>
      <td className={FIRST}>{first}</td>
      <td className={NUM}><CountLink value={l.opened} href={casesHref({ step, carrier })} label="Open the cases in Cases" /></td>
      <td className={NUM}><CountLink value={l.saved} href={casesHref({ step: "closed", carrier })} label="Saved, on Cases › Closed" /></td>
      <td className={NUM}><CountLink value={l.lost} href={casesHref({ step: "closed", carrier })} label="Lost, on Cases › Closed" /></td>
      <td className={NUM}>{l.keptCents ? `${money(l.keptCents)}/mo` : <span className="text-muted-foreground">—</span>}</td>
      <td className="whitespace-nowrap"><RateChip text={resultRateText(l)} /></td>
    </tr>
  );
}

function Head({ first }: { first: string }) {
  return (
    <thead>
      <tr>
        <th>{first}</th>
        <th className="text-right">Opened</th>
        <th className="text-right">Saved</th>
        <th className="text-right">Lost</th>
        <th className="text-right">Premium kept</th>
        <th title={`Saved of saved and lost; under ${MIN_RESULTS_DECIDED} decided cases the counts are shown.`}>Save rate</th>
      </tr>
    </thead>
  );
}

/** Saves: a row a step the case was on (a step's name opens its tab in Cases). */
export function ResultsByStep({ results }: { results: Results }) {
  return (
    <TableCard footer={FOOT} toolbar={closedLink(results.total)}>
      {nothing(results.total) ? EMPTY : (
        <table className="portal-lead-table w-full text-left text-sm">
          <Head first="Step it was on" />
          <tbody>
            {results.byStep.map((l) => (
              <Row key={l.key} l={l} step={l.key as Step} first={<Link href={`/app/retention?step=${STEP_SLUG[l.key as Step]}`} className="underline-offset-2 hover:underline">{l.label}</Link>} />
            ))}
            <Row l={results.total} first="All steps" strong />
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

/** By carrier: the same table, a row a carrier with cases (a carrier's name opens Cases filtered to it). */
export function ResultsByCarrier({ results }: { results: Results }) {
  const rows = results.byCarrier.filter(hasFigures);
  return (
    <TableCard footer={FOOT} toolbar={closedLink(results.total)}>
      {nothing(results.total) ? EMPTY : (
        <table className="portal-lead-table w-full text-left text-sm">
          <Head first="Carrier" />
          <tbody>
            {rows.map((l) => (
              <Row key={l.key} l={l} carrier={l.key} first={<Link href={casesHref({ carrier: l.key })} className="underline-offset-2 hover:underline">{l.label}</Link>} />
            ))}
            {rows.length > 1 && <Row l={results.total} first="All carriers" strong />}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

const days = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("en-US")} ${n === 1 ? "day" : "days"}`);

/** Time to save: days from opened to proven saved, by step (the median, the fastest, the slowest, and how many). */
export function ResultsTimeToSave({ results }: { results: Results }) {
  const row = (t: SaveTime, first: ReactNode, strong = false) => (
    <tr key={t.key} data-total={strong || undefined}>
      <td className={FIRST}>{first}</td>
      <td className={NUM}><CountLink value={t.saves} href={casesHref({ step: "closed" })} label="Saved, on Cases › Closed" /></td>
      <td className={NUM}>{days(t.medianDays)}</td>
      <td className={NUM}>{days(t.fastestDays)}</td>
      <td className={NUM}>{days(t.slowestDays)}</td>
    </tr>
  );
  return (
    <TableCard footer={<span>From the day the case opened to the day a carrier file proved it saved · saves closed in the period</span>}>
      {results.totalTime.saves === 0 ? (
        <EmptyState title="No saves in this period" hint="A case is saved when a later carrier file proves it fixed; how long that took shows here." />
      ) : (
        <table className="portal-lead-table w-full text-left text-sm">
          <thead>
            <tr>
              <th>Step it was on</th>
              <th className="text-right">Saves</th>
              <th className="text-right">Median</th>
              <th className="text-right">Fastest</th>
              <th className="text-right">Slowest</th>
            </tr>
          </thead>
          <tbody>
            {results.times.map((t) => row(t, t.label))}
            {row(results.totalTime, "All steps", true)}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
