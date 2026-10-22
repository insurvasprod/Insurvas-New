"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { Segmented, ViewTabs } from "@/components/ui/view-tabs";
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
  const [view, setView] = useState<"predictions" | "holdout">("predictions");
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
        <StatTile label="Predictions checked" value={accuracy.total.toLocaleString("en-US")} footnote={`unworked, at ${data.horizonDays} days`} />
        <StatTile label="Still to check" value={data.awaitingPredictions.toLocaleString("en-US")} footnote="waiting for their horizon" />
        <StatTile label="Holdout" value={holdout.enabled ? `On · ${holdout.shareBp / 100}%` : "Off"} footnote={holdout.enabled ? `${holdout.heldNow.toLocaleString("en-US")} held back now` : "switch it on in Retention settings"} />
        <StatTile label="Left on past due" value={holdout.leftPastDue.toLocaleString("en-US")} labelTitle="Held-back policies that fell past due: they left the holdout at once and went on the Lapse risk board like any other." footnote="an emergency is never withheld" />
      </StatStrip>

      <ViewTabs label="Views" value={view} onChange={setView} tabs={[{ key: "predictions", label: "Were the predictions right?" }, { key: "holdout", label: "Does working it help?" }]} />

      {view === "predictions" ? (
        <TableCard
          toolbar={
            <DataToolbar actions={actions}>
              {period}
              <Segmented label="Break down by" value={cut} onChange={setCut} options={[{ key: "band", label: "By band" }, { key: "version", label: "By weight version" }, { key: "confidence", label: "By confidence" }]} />
              <span className="text-sm text-muted-foreground">{VERDICT_TEXT[accuracy.verdict]}</span>
            </DataToolbar>
          }
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
              <span className="text-sm text-muted-foreground">{holdout.drawn.toLocaleString("en-US")} drawn · {holdout.awaiting.toLocaleString("en-US")} not at their horizon yet · {holdout.neverEligible.toLocaleString("en-US")} too large (or unknown) to hold out</span>
            </DataToolbar>
          }
        >
          <div className="flex flex-col gap-2 p-4 text-sm text-foreground">
            {holdout.sentence.map((line, i) => <p key={i}>{line}</p>)}
            {!holdout.enabled && !holdout.drawn ? <p className="text-muted-foreground">The holdout is off. <Link className="underline" href="/app/retention-settings#holdout">Read what it does</Link> before switching it on.</p> : null}
          </div>
          {holdout.comparison.bands.length > 0 && <ArmTable rows={[...holdout.comparison.bands, holdout.comparison.overall]} />}
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
