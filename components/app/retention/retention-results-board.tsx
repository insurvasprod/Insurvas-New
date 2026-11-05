"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { ViewTabs } from "@/components/ui/view-tabs";
import { ReportsSlot, useUrlTab } from "@/components/app/reports/reports-slot";
import { BAND_LABELS, type Band } from "@/lib/retention/constants";
import { MIN_RATE_SAMPLE, PERIOD_LABELS, PERIODS, VERDICT_TEXT, type ArmComparison, type Cell, type Period, type Verdict } from "@/lib/retention/effectiveness";
import type { Effectiveness } from "@/lib/retention/effectivenessStore";

const cellText = (c: Cell) => (c.n === 0 ? "—" : c.rate === null ? `${c.lapsed} of ${c.n}` : `${Math.round(c.rate * 100)}%`);
const capital = (s: string) => s[0].toUpperCase() + s.slice(1);
/** The answer to "do the bands come true?", in a word (the sentence is the tile's title). */
const VERDICT_WORD: Record<Verdict, string> = { separates: "Yes", mixed: "Partly", noise: "No", too_early: "Too soon" };
const bandsFootnote = (bands: Array<Cell & { band: Band }>) => {
  const top = bands.find((b) => b.band === "critical");
  const low = bands.find((b) => b.band === "low");
  return top && low && top.n && low.n ? `critical ${cellText(top)} lapsed · low ${cellText(low)}` : "on policies nobody worked";
};
type Holdout = Effectiveness["holdout"];
/** "Does working it help?": only a difference beyond chance is an answer; anything else says why not yet. */
const holdoutWord = (h: Holdout) => {
  const o = h.comparison.overall;
  if (!h.enabled && !h.drawn) return "Off";
  if (o.worked.rate === null || o.holdout.rate === null) return "Too soon";
  if (!o.meaningful) return "Not yet";
  return o.worked.rate < o.holdout.rate ? "Yes" : "No";
};
const holdoutFootnote = (h: Holdout) => {
  const o = h.comparison.overall;
  if (!h.enabled && !h.drawn) return "switch it on in Retention settings";
  // Name the side that is short (walk 2026-11-05: "24 held back · needs 20" when the worked side was the short one).
  if (o.holdout.rate === null) return `${o.holdout.n.toLocaleString("en-US")} held back checked · needs ${MIN_RATE_SAMPLE}`;
  if (o.worked.rate === null) return `${o.worked.n.toLocaleString("en-US")} worked checked · needs ${MIN_RATE_SAMPLE}`;
  return `worked ${cellText(o.worked)} lapsed · held back ${cellText(o.holdout)}`;
};

/**
 * LA-5.9 (Notion sprint) · does the radar work. Two views: the predictions (on policies nobody worked,
 * the lapse rate should fall from critical to low) and the holdout (worked against held back). Under
 * 20 policies a cell shows the count, never a percentage; the plain sentence carries its caveats.
 */
export function RetentionResultsBoard({ data }: { data: Effectiveness }) {
  const router = useRouter();
  const pathname = usePathname();
  const [refreshing, startRefresh] = useTransition();
  // Foundation pass (2026-11-03): the view is in the address (`?view=`), and the verdict and the holdout's
  // plain sentences are the table's foot, not lines in its toolbar or a block over its rows.
  const { tab: view, setTab: setView, href: viewHref } = useUrlTab(["predictions", "holdout"] as const, "predictions", "view");
  const [cut, setCut] = useState<"band" | "version" | "confidence">("band");
  const { accuracy, holdout } = data;

  const period = (
    <select aria-label="Period" className={toolbarControl} value={data.period} onChange={(e) => router.push(e.target.value === "quarter" ? pathname : `${pathname}?period=${e.target.value}`)}>
      {(Object.keys(PERIODS) as Period[]).map((p) => <option key={p} value={p}>{capital(PERIOD_LABELS[p].replace(/^over /, "").replace(/^since /, "since "))}</option>)}
    </select>
  );
  const actions = <RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />;

  return (
    <>
      {/* ReA (owner pick 2026-11-05): the page's two questions are its first two tiles, answered in a word and
          linking to their table; the verdict sentence is the tile's title, no longer a line under the table. */}
      <StatStrip label="Measuring the radar">
        <StatTile label="Do the bands come true?" href={viewHref("predictions")} value={VERDICT_WORD[accuracy.verdict]} valueTone={accuracy.verdict === "separates" ? "good" : accuracy.verdict === "noise" ? "danger" : accuracy.verdict === "mixed" ? "warning" : undefined} labelTitle={VERDICT_TEXT[accuracy.verdict]} footnote={bandsFootnote(accuracy.byBand)} />
        <StatTile label="Does working beat the holdout?" href={viewHref("holdout")} value={holdoutWord(holdout)} valueTone={holdout.comparison.overall.meaningful ? (holdout.comparison.overall.worked.rate !== null && holdout.comparison.overall.holdout.rate !== null && holdout.comparison.overall.worked.rate < holdout.comparison.overall.holdout.rate ? "good" : "danger") : undefined} labelTitle={holdout.sentence.join(" ")} footnote={holdoutFootnote(holdout)} />
        <StatTile label="Predictions checked" href={viewHref("predictions")} value={accuracy.total.toLocaleString("en-US")} footnote={`unworked, at ${data.horizonDays} days · ${data.awaitingPredictions.toLocaleString("en-US")} waiting`} />
        <StatTile label="Holdout" href={holdout.enabled ? viewHref("holdout") : "/app/retention-settings#holdout"} value={holdout.enabled ? `On · ${holdout.shareBp / 100}%` : "Off"} labelTitle="Held-back policies that fall past due leave the holdout at once and go on the Lapse risk board like any other." footnote={holdout.enabled ? `${holdout.heldNow.toLocaleString("en-US")} held back · ${holdout.leftPastDue.toLocaleString("en-US")} left on past due` : "off in Retention settings"} />
      </StatStrip>

      {/* The two questions are the view's tabs, on the title line (Reports frame, owner 2026-11-02). */}
      <ReportsSlot slot="lead"><ViewTabs label="Views" value={view} onChange={setView} tabs={[{ key: "predictions", label: "Were the predictions right?" }, { key: "holdout", label: "Does working it help?" }]} /></ReportsSlot>

      {view === "predictions" ? (
        <TableCard
          toolbar={
            <DataToolbar actions={actions}>
              {period}
              <div role="radiogroup" aria-label="Break down by" className="flex flex-wrap items-center gap-2">
                {([["band", "By band"], ["version", "By weight version"], ["confidence", "By confidence"]] as const).map(([key, label]) => <ToggleChip key={key} role="radio" selected={cut === key} onClick={() => setCut(key)}>{label}</ToggleChip>)}
              </div>
            </DataToolbar>
          }
          footer={<span>{accuracy.total.toLocaleString("en-US")} unworked {accuracy.total === 1 ? "policy" : "policies"} checked {data.horizonDays} days after the prediction</span>}
        >
          {accuracy.total === 0 ? (
            <EmptyState title="Nothing to check yet" hint={`A prediction is checked ${data.horizonDays} days after it is made, on policies nobody worked. ${data.awaitingPredictions ? `${data.awaitingPredictions.toLocaleString("en-US")} are waiting.` : "Predictions start with the next radar run."}`} />
          ) : cut === "band" ? (
            <BandTable rows={accuracy.byBand} horizon={data.horizonDays} />
          ) : cut === "version" ? (
            <GridTable title="Weight version" rows={accuracy.byVersion.map((v) => ({ label: `v${v.version}`, bands: v.bands }))} />
          ) : (
            <GridTable title="Confidence" rows={accuracy.byConfidence.map((c) => ({ label: capital(c.confidence), bands: c.bands }))} />
          )}
        </TableCard>
      ) : (
        <TableCard
          toolbar={
            <DataToolbar actions={actions}>
              {period}
            </DataToolbar>
          }
          // LA-5.9: the page states the sample and the period, and says plainly when a difference is not yet meaningful.
          footer={<span className="flex flex-col gap-1">
            <span title={`${holdout.neverEligible.toLocaleString("en-US")} too large (or unknown) to hold out`}>{holdout.drawn.toLocaleString("en-US")} drawn · {holdout.awaiting.toLocaleString("en-US")} still waiting</span>
            {holdout.sentence.map((line, i) => <span key={i}>{line}</span>)}
          </span>}
        >
          {holdout.comparison.bands.length > 0
            ? <ArmTable rows={[...holdout.comparison.bands, holdout.comparison.overall]} />
            : !holdout.enabled && !holdout.drawn
              ? <EmptyState title="The holdout is off" hint="Read what it does before switching it on." action={<Button asChild variant="outline"><Link href="/app/retention-settings#holdout">Open Retention settings</Link></Button>} />
              : <EmptyState title="Nothing to compare yet" hint="Held-back and worked policies are compared once both reach their horizon." />}
        </TableCard>
      )}
    </>
  );
}

function BandTable({ rows, horizon }: { rows: Array<Cell & { band: Band }>; horizon: number }) {
  return (
    <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
      <thead>
        <tr>
          <th>Band</th>
          <th className="text-right">Policies</th>
          <th className="text-right">Lapsed within {horizon} days</th>
          <th className="text-right"><span className="inline-flex items-center gap-1">Rate <InfoTip label="About the rate">The rate should fall as you read down. Under {MIN_RATE_SAMPLE} policies the count is shown instead.</InfoTip></span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.band}>
            <td className="font-semibold text-foreground">{capital(BAND_LABELS[r.band])}</td>
            <td className="text-right tabular-nums">{r.n.toLocaleString("en-US")}</td>
            <td className="text-right tabular-nums">{r.lapsed.toLocaleString("en-US")}</td>
            <td className="text-right tabular-nums">{cellText(r)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GridTable({ title, rows }: { title: string; rows: Array<{ label: string; bands: Array<Cell & { band: Band }> }> }) {
  const bands = rows[0]?.bands.map((b) => b.band) ?? [];
  return (
    <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
      <thead>
        <tr>
          <th>{title}</th>
          {bands.map((b) => <th key={b} className="text-right">{capital(BAND_LABELS[b])} lapsed</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td className="font-semibold text-foreground">{r.label}</td>
            {r.bands.map((c) => <td key={c.band} className="text-right tabular-nums">{cellText(c)}{c.n ? <span className="block text-xs text-muted-foreground">of {c.n.toLocaleString("en-US")}</span> : null}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ArmTable({ rows }: { rows: ArmComparison[] }) {
  return (
    <table className="portal-lead-table w-full min-w-[720px] text-left text-sm">
      <thead>
        <tr>
          <th>Band</th>
          <th className="text-right">Worked</th>
          <th className="text-right">Worked, lapsed</th>
          <th className="text-right">Held back</th>
          <th className="text-right">Held back, lapsed</th>
          <th className="text-right"><span className="inline-flex items-center gap-1">Beyond chance? <InfoTip label="About the test">Both groups need {MIN_RATE_SAMPLE} policies, and the difference must clear a 95% two-proportion test. Until then it is not a result.</InfoTip></span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.band} className={r.band === "all" ? "font-semibold" : undefined}>
            <td className="text-foreground">{r.band === "all" ? "All bands" : capital(BAND_LABELS[r.band])}</td>
            <td className="text-right tabular-nums">{r.worked.n.toLocaleString("en-US")}</td>
            <td className="text-right tabular-nums">{cellText(r.worked)}</td>
            <td className="text-right tabular-nums">{r.holdout.n.toLocaleString("en-US")}</td>
            <td className="text-right tabular-nums">{cellText(r.holdout)}</td>
            <td className="text-right">{r.worked.rate === null || r.holdout.rate === null ? "Too few" : r.meaningful ? "Yes" : "Not yet"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
