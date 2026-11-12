"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChartHeading, LineSeries, ShareBar, type LinePoint } from "@/components/ui/chart";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { Switch } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { InReportsSlot, useUrlTab } from "@/components/app/reports/reports-slot";
import { reportDay, reportPeriod } from "@/lib/reports/periodText";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { PageLoading } from "@/components/ui/page-loading";
import { FramedLoading } from "@/components/app/reports/reports-slot";
import { EmptyState, ErrorState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { useShow } from "@/components/ui/view-switch";
import { compareHoldout, pts, VERDICT_CHIP } from "@/lib/scoring/holdout";
import { bySignalOrder, pointsFigure, signalTone, type CohortDay } from "@/lib/scoring/series";
import { showHref } from "@/lib/reports/show";
import { load as loadResource, peek, readResource, seed } from "@/lib/client/resource-cache";

import { ChangeWeightsDialog, type WeightRow, type WeightsDraft } from "@/components/app/scoring/change-weights-dialog";
import { QueueNextUp } from "@/components/app/scoring/next-up";

type Cohort = { cohort: string; served: number; contacted: number; contactRatePct: number | null; averageScore: number | null; since: string | null };
type VendorRate = { vendorId: string; name: string; attempts: number; contacts: number; ratePct: number };
type Period = "14d" | "all";
type Overview = {
  enabled: boolean;
  holdoutPct: number;
  weights: WeightRow[];
  cohorts: Cohort[];
  period?: Period;
  periodFrom?: string | null;
  periodSupported?: boolean;
  vendorRates?: VendorRate[];
  /** The comparison by day, each arm's rate to date (lib/scoring/series.ts). Absent from an answer kept before round 7. */
  daily?: CohortDay[];
};

/** Since a day until today, in the Reports format ("20 Oct – 3 Nov", lib/reports/periodText.ts). */
function range(since: string | null, until = new Date()) {
  if (!since) return null;
  const from = new Date(since);
  if (Number.isNaN(from.getTime())) return null;
  const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return reportPeriod(day(from), day(until));
}
/** The page's read, as the app's cache keys it (lib/client/resource-cache.ts); the default 14 days is kept across a reload. */
const scoringKey = (span: Period) => `/api/app/scoring?period=${span}`;
const SCORING_KEY = scoringKey("14d");
const pct = (value: number | null) => (value === null ? "—" : `${value.toFixed(1)}%`);
/** An axis or hover figure for a rate: "3.6%", "4%". */
const ratePct = (value: number) => `${Math.round(value * 10) / 10}%`;
const READ_ONLY = "You can see how the queue is ordered, not change it.";

/**
 * Queue scoring (p-app-scoring): whether the queue is ranked, by what, and whether the ranking is measurably beating
 * the plain order. Drawn with the scorer's own seven signals (the calling window is a gate, not a weight: an
 * out-of-window lead is never served at all, so it is not drawn as if it were).
 *
 * Reports round 7 (owner picks 3·B + 3·C + 3·3, 2026-11-11; docs/la4/mockups-r7/reports.html §3). Two tabs on the
 * title line (`?tab=weights|next`), the "Table · Chart" switch beside them (`?show=`, the chart first):
 * - Weights · Chart: the comparison kept as four cards, each scored, plain and difference card with a small line
 *   of its figure to date (3·C); the two arms' contact rates by day, one line per cohort (3·B); the weights as one
 *   ShareBar in the kit's tones, each segment opening Change weights at that signal (3·C).
 * - Weights · Table (3·1): one line a signal, read-only; Change weights (title line, primary) opens the form.
 * - Next up · Chart (3·3) and Table (3·2): components/app/scoring/next-up.tsx; a lead's score is a dialog with ‹ ›.
 * Turning scoring off asks first (3·5); a read-only plan sees Change weights off, saying why on hover.
 *
 * `framed`: inside the Reports page (components/app/reports/reports-page.tsx), which draws the title; the tabs and
 * the comparison window go to its top row, the switch and Change weights to its corner.
 */
export function ScoringWorkspace({ readOnly = false, framed = false }: { readOnly?: boolean; framed?: boolean } = {}) {
  const [data, setData] = useState<Overview | null>(() => seed<Overview>(SCORING_KEY, true)?.data ?? null);
  /** Whether the first render already drew a kept answer (a client navigation). */
  const [seeded] = useState(() => Boolean(seed(SCORING_KEY, true)?.data));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [holdoutWindow, setHoldoutWindow] = useState<Period>("14d");
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [editing, setEditing] = useState<{ focus: string | null } | null>(null);
  const [nextCount, setNextCount] = useState<number | null>(null);
  const { tab, setTab } = useUrlTab(["weights", "next"] as const, "weights");
  const show = useShow("chart");
  const pathname = usePathname();
  const query = useSearchParams();

  // `fresh` after a save and on Try again, so the answer is never the one from before it.
  const load = useCallback((span: Period = "14d", fresh = false) => (fresh ? loadResource<Overview>(scoringKey(span), { persist: span === "14d" }) : readResource<Overview>(scoringKey(span), { persist: span === "14d" }))
    .then((overview) => { setLoadError(null); setData(overview); })
    .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : "Could not load queue scoring")), []);

  useEffect(() => {
    // A fresh document (a reload) starts from the kept answer as soon as it has hydrated, then asks again.
    const kept = peek<Overview>(SCORING_KEY, true)?.data;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the kept answer, read from storage after hydration
    if (kept && !seeded) setData((current) => current ?? kept);
    void load();
  }, [load, seeded]);

  // A weights segment is a link (`?edit=<signal>`): open Change weights at that signal, then take it out of the address.
  const editParam = query.get("edit");
  useEffect(() => {
    if (!editParam || readOnly) return;
    setEditing({ focus: editParam }); // eslint-disable-line react-hooks/set-state-in-effect -- the address asked for the form
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("edit");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    } catch { /* the form is open either way */ }
  }, [editParam, readOnly]);

  const scored = data?.cohorts.find((cohort) => cohort.cohort === "scored");
  const control = data?.cohorts.find((cohort) => cohort.cohort === "control");
  const comparison = compareHoldout(scored, control);
  const lift = comparison.differencePts;
  const since = [scored?.since, control?.since].filter((value): value is string => Boolean(value)).sort()[0] ?? null;
  const period = range(since);
  const weightList = useMemo(() => bySignalOrder(data?.weights ?? []), [data]);

  /** One PUT for every change: the switch, or the dialog's weights and holdout. */
  async function put(next: { enabled: boolean; holdoutPct: number; weights: Array<{ signal: string; weight: number }> }, done: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/app/scoring", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next.enabled, holdout_pct: next.holdoutPct, weights: next.weights }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) { notify.block(body?.error ?? "Could not save queue scoring"); return false; }
      notify.done(done);
      await load(holdoutWindow, true);
      return true;
    } finally { setBusy(false); }
  }
  const savedWeights = () => weightList.map((weight) => ({ signal: weight.signal, weight: weight.weight }));
  const saveDraft = async (draft: WeightsDraft) => {
    if (!data) return false;
    const saved = await put({
      enabled: data.enabled,
      holdoutPct: Math.max(0, Math.min(50, Math.round(Number(draft.holdout)) || 0)),
      weights: weightList.map((weight) => ({ signal: weight.signal, weight: Number(draft.weights[weight.signal]) || 0 })),
    }, "Weights saved. They apply to the next lead served.");
    if (saved) setEditing(null);
    return saved;
  };
  const setEnabled = (enabled: boolean) => {
    if (!data) return;
    // Off asks first (3·5): everyone is served in plain order and the comparison stops counting.
    if (!enabled) { setConfirmOff(true); return; }
    void put({ enabled: true, holdoutPct: data.holdoutPct, weights: savedWeights() }, "Queue scoring is on. It applies to the next lead served.");
  };

  if (loadError && !data) return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {!framed && <PageHeader title="Queue scoring" />}
      <TableCard><ErrorState title="Queue scoring did not load" detail={loadError} action={<Button variant="outline" onClick={() => void load(holdoutWindow, true)}>Try again</Button>} /></TableCard>
    </div>
  );
  if (!data) return framed ? <FramedLoading /> : <PageLoading />;
  const verdict = VERDICT_CHIP[comparison.verdict];
  const periodSupported = data.periodSupported === true;
  const shownPeriod: Period = data.period ?? "all";
  const vendorRates = data.vendorRates ?? [];
  const daily = data.daily ?? [];
  const noDials = !scored && !control;
  const periodLabel = shownPeriod === "14d" ? (data.periodFrom ? range(data.periodFrom) : "Last 14 days") : period ?? "All time";
  const total = weightList.reduce((sum, weight) => sum + Math.max(0, weight.weight), 0);
  const shareOf = (weight: WeightRow) => (total > 0 ? Math.round((100 * Math.max(0, weight.weight)) / total) : 0);
  const atDefault = weightList.filter((weight) => (weight.defaultWeight === null ? weight.isDefault : weight.weight === weight.defaultWeight)).length;
  const base = `${pathname}?${query.toString()}`;

  function choosePeriod(next: Period) {
    if (next === holdoutWindow) return;
    setHoldoutWindow(next);
    void load(next);
  }
  const openEdit = (focus: string | null = null) => { if (!readOnly) setEditing({ focus }); };

  // The page's actions (3·1): the switch, then Change weights (the one primary, top-right).
  const corner = <>
    <span className="inline-flex h-9 items-center gap-2.5 text-sm font-medium text-[var(--body)]" title={readOnly ? READ_ONLY : undefined}>
      <Switch id="scoring-enabled" label="Enable queue scoring" checked={data.enabled} disabled={readOnly || busy} onChange={setEnabled} />
      <label htmlFor="scoring-enabled">{data.enabled ? "Scoring is on" : "Scoring is off"}</label>
    </span>
    <span title={readOnly ? READ_ONLY : undefined}>
      <Button type="button" disabled={readOnly || busy} onClick={() => openEdit()}>Change weights</Button>
    </span>
  </>;

  // The comparison's lines, to date by day (3·B) and on the cards (3·C): the last point is each card's figure.
  const points = (pick: (day: CohortDay) => number | null): LinePoint[] => daily.map((day) => ({ key: day.day, label: reportDay(day.day), value: pick(day) ?? 0 }));
  const scoredLine = points((day) => day.scoredRatePct);
  const plainLine = points((day) => day.controlRatePct);
  const diffLine = daily.filter((day) => day.scoredRatePct !== null && day.controlRatePct !== null).map((day) => (day.scoredRatePct ?? 0) - (day.controlRatePct ?? 0));

  const weightsChart = (
    <div className="flex min-w-0 flex-col gap-4">
      {/* Is it working? Scored order against the plain-order holdout, as a difference over a named sample (3·C: the
          comparison stays four cards, each with a small line of its figure to date). */}
      <StatStrip label="Scored order against the plain-order holdout">
        <StatTile label="Scored order · contact rate" value={pct(scored?.contactRatePct ?? comparison.scoredPct)} trend={scoredLine.length > 1 ? { points: scoredLine.map((point) => point.value), tone: "primary", placement: "under" } : undefined} footnote={noDials ? "no dials yet" : `${(scored?.served ?? 0).toLocaleString()} dials · ${(scored?.contacted ?? 0).toLocaleString()} contacts`} />
        <StatTile label="Plain order · holdout" value={pct(control?.contactRatePct ?? comparison.holdoutPct)} trend={plainLine.length > 1 ? { points: plainLine.map((point) => point.value), tone: "neutral", placement: "under" } : undefined} footnote={noDials ? "no dials yet" : `${(control?.served ?? 0).toLocaleString()} dials · ${(control?.contacted ?? 0).toLocaleString()} contacts`} />
        <StatTile label="Difference" value={lift === null ? "—" : pts(lift)} trend={diffLine.length > 1 ? { points: diffLine, tone: "primary", placement: "under" } : undefined} footnote={<StatusChip tone={verdict.tone}>{verdict.label}</StatusChip>} />
        <StatTile label="95% interval" value={comparison.interval ? `${pts(comparison.interval.low).replace(" pts", "")} to ${pts(comparison.interval.high)}` : "—"} footnote={comparison.interval ? periodLabel : `${periodLabel} · called once each side has 30 dials`} />
      </StatStrip>

      {/* 3·B: the two rates over time, one line per cohort. */}
      <Card className="px-4">
        <ChartHeading title="Contact rate by day, scored and plain" period={`${periodLabel} · each day's rate counts every dial to the end of that day${shownPeriod === "all" && daily.length ? ` · the last ${daily.length} days drawn` : ""}`} />
        {daily.length === 0 ? (
          <EmptyState title="No dials in this window yet" hint={data.enabled ? "The lines start with the first lead served after scoring was turned on." : "Turn scoring on: the lines start with the first lead it serves."} />
        ) : (
          <LineSeries
            points={scoredLine}
            summary={`Contact rate to date by day, ${periodLabel}: scored order ${pct(comparison.scoredPct)}, plain order ${pct(comparison.holdoutPct)}`}
            format={ratePct}
            unit="contact rate"
            legend={{ label: "Scored order", figure: pct(comparison.scoredPct) }}
            lines={[{ key: "plain", label: "Plain order (holdout)", points: plainLine, tone: "quiet", dashed: true, figure: pct(comparison.holdoutPct) }]}
          />
        )}
      </Card>

      {/* 3·C: the weights as one bar in the kit's tones; a segment opens Change weights at that signal. */}
      <Card className="px-4">
        <ChartHeading
          title="How the score is divided"
          period={`${atDefault} of ${weightList.length} signals at default · ${pointsFigure(total)} points a lead can score · ${data.holdoutPct}% of serves go in plain order`}
          action={<Link href={showHref(base, "table")} className="whitespace-nowrap text-sm text-foreground underline-offset-2 hover:underline">Open as a table ›</Link>}
        />
        {total > 0 ? (
          <ShareBar
            summary={weightList.map((weight) => `${weight.label} ${shareOf(weight)}% of the score`).join(", ")}
            unit="points"
            format={pointsFigure}
            segments={weightList.map((weight) => ({ key: weight.signal, label: weight.label, value: Math.max(0, weight.weight), tone: signalTone(weight.signal), href: readOnly ? showHref(base, "table") : showHref(base, "chart", { edit: weight.signal }) }))}
          />
        ) : (
          <EmptyState title="No weight set on any signal" hint="Every lead scores the same, so the queue is in plain order. Change weights to give a signal points." />
        )}
      </Card>
    </div>
  );

  const weightsTable = (
    <TableCard
      footer={<span>Rules mode: the weights are rules, nothing refits them · {data.holdoutPct}% of serves go in plain order (the holdout) · what each signal measures is its row&apos;s tooltip</span>}
    >
      <table className="portal-lead-table w-full text-left text-sm">
        <thead><tr><th>Signal</th><th className="text-right">Share of score</th><th className="text-right">Weight</th><th className="text-right">Default</th><th>Status</th></tr></thead>
        <tbody>
          {weightList.map((weight) => {
            const atItsDefault = weight.defaultWeight === null ? weight.isDefault : weight.weight === weight.defaultWeight;
            const vendorLine = weight.signal === "vendor_contact_rate"
              ? (vendorRates.length === 0
                ? "No vendor has 30 dispositioned dials yet, so every vendor scores neutral."
                : `${vendorRates.slice(0, 4).map((vendor) => `${vendor.name} contacts at ${Math.round(vendor.ratePct)}%`).join(", ")}${vendorRates.length > 4 ? `, and ${vendorRates.length - 4} more` : ""}. Vendors under 30 dials score neutral.`)
              : null;
            const measures = [weight.blurb, vendorLine, `${shareOf(weight)}% of the score.`].filter(Boolean).join(" ");
            return (
              <tr key={weight.signal} title={measures} className={readOnly ? undefined : "cursor-pointer"} onClick={readOnly ? undefined : () => openEdit(weight.signal)}>
                <td className="whitespace-nowrap font-medium text-foreground">{weight.label}</td>
                <td className="text-right tabular-nums">{total > 0 ? `${shareOf(weight)}%` : "—"}</td>
                <td className="text-right tabular-nums">{pointsFigure(weight.weight)}</td>
                <td className="text-right tabular-nums">{weight.defaultWeight === null ? <span className="text-muted-foreground">—</span> : pointsFigure(weight.defaultWeight)}</td>
                <td><StatusChip tone={atItsDefault ? "neutral" : "info"} dot={false}>{atItsDefault ? "At default" : "Changed"}</StatusChip></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableCard>
  );

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <InReportsSlot framed={framed} slot="corner">{framed ? corner : <PageHeader title="Queue scoring" description="How the dialer picks the next lead" actions={corner} />}</InReportsSlot>

      {/* The two views on the title line: the weights, and who is next. The comparison window beside them re-reads the
          comparison only. */}
      <InReportsSlot framed={framed} slot="lead">
        <ViewTabs label="Queue scoring views" value={tab} onChange={setTab} idPrefix="scoring-view" tabs={[{ key: "weights", label: "Weights" }, { key: "next", label: "Next up", count: nextCount }]} />
        {tab === "weights" && (
          <select
            aria-label="Holdout comparison period"
            className={toolbarControl}
            value={shownPeriod}
            title={!periodSupported ? "The 14-day view needs a database update that has not been applied yet." : undefined}
            onChange={(event) => choosePeriod(event.target.value as Period)}
          >
            <option value="14d" disabled={!periodSupported}>Compare over the last 14 days</option>
            <option value="all">Compare over all time</option>
          </select>
        )}
      </InReportsSlot>

      {tab === "weights" ? (show === "chart" ? weightsChart : weightsTable) : <QueueNextUp show={show} onCount={setNextCount} />}

      <ChangeWeightsDialog open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }} weights={weightList} holdoutPct={data.holdoutPct} focus={editing?.focus} onSave={saveDraft} />
      <ConfirmDialog
        open={confirmOff}
        onOpenChange={setConfirmOff}
        busy={busy}
        title="Turn queue scoring off?"
        description="The dialer serves in plain order (oldest due first) for everyone. The weights are kept; the comparison stops counting."
        cancelLabel="Keep it on"
        confirmLabel="Turn off"
        onConfirm={async () => {
          const off = await put({ enabled: false, holdoutPct: data.holdoutPct, weights: savedWeights() }, "Queue scoring is off. Leads are served in plain order.");
          if (off) setConfirmOff(false);
        }}
      />
    </div>
  );
}
