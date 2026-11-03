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
import { MIN_RATE_SAMPLE, PERIOD_LABELS, PERIODS, VERDICT_TEXT, type ArmComparison, type Cell, type Period } from "@/lib/retention/effectiveness";
import type { Effectiveness } from "@/lib/retention/effectivenessStore";

const cellText = (c: Cell) => (c.n === 0 ? "—" : c.rate === null ? `${c.lapsed} of ${c.n}` : `${Math.round(c.rate * 100)}%`);
const capital = (s: string) => s[0].toUpperCase() + s.slice(1);

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
      <StatStrip label="Measuring the radar">
        <StatTile label="Predictions checked" href={viewHref("predictions")} value={accuracy.total.toLocaleString("en-US")} footnote={`unworked, at ${data.horizonDays} days`} />
        <StatTile label="Still to check" value={data.awaitingPredictions.toLocaleString("en-US")} footnote="waiting for their horizon" />
        <StatTile label="Holdout" href={viewHref("holdout")} value={holdout.enabled ? `On · ${holdout.shareBp / 100}%` : "Off"} footnote={holdout.enabled ? `${holdout.heldNow.toLocaleString("en-US")} held back now` : "off in Retention settings"} />
        <StatTile label="Left on past due" value={holdout.leftPastDue.toLocaleString("en-US")} labelTitle="Held-back policies that fell past due: they left the holdout at once and went on the Lapse risk board like any other." footnote="an emergency is never withheld" />
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
          footer={<span>{VERDICT_TEXT[accuracy.verdict]}</span>}
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
