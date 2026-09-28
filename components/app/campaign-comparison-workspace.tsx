"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataToolbar, toolbarControl } from "@/components/ui/data-toolbar";
import { TableCard } from "@/components/ui/table-card";
import type { CampaignComparison, ComparisonMetricKey, VendorScorecardRow } from "@/lib/vendorScorecard/types";
import type { CadenceCaveat } from "@/lib/cadence/history";
import { checkComparisonPeriods, periodDays, periodLabel, type ComparisonPeriod } from "@/lib/vendorScorecard/comparePeriods";

/** The comparison plus the cadence caveat the compare route adds (lib/cadence/history.ts). */
type ComparisonWithCadence = CampaignComparison & { cadence?: CadenceCaveat };

/** The board's caveat, titled by what it found. Never absent: a comparison that cannot tell says so. */
const CADENCE_TITLE: Record<CadenceCaveat["status"], string> = {
  different: "Same period, different cadence",
  changed: "The cadence changed during the period",
  unknown: "Which cadence ran is not known for this period",
  pending: "Cadence history is not recorded yet",
  same: "Both periods ran the same cadence",
};
const CADENCE_TONE: Record<CadenceCaveat["status"], "info" | "warning" | "success"> = {
  different: "info",
  changed: "info",
  unknown: "warning",
  pending: "warning",
  same: "success",
};

const TONE_TEXT: Record<"info" | "warning" | "success", string> = {
  info: "text-[var(--info-ink)]",
  warning: "text-[var(--warning-ink)]",
  success: "text-[var(--success-ink)]",
};
const fact = "text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground";

const label: Record<ComparisonMetricKey, string> = { contact_rate: "Contact rate", conversion_rate: "Issued conversion", cost_per_issued: "Cost per issued policy" };
function dollars(cents: number | null) { return cents == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }
function metricValue(value: number | null, unit: "percent" | "cents") { return value == null ? "—" : unit === "cents" ? dollars(value) : `${value}%`; }

export function CampaignComparisonWorkspace({ rows, defaultFrom, defaultTo }: { rows: VendorScorecardRow[]; defaultFrom: string; defaultTo: string }) {
  const [campaignA, setCampaignA] = useState("");
  const [campaignB, setCampaignB] = useState("");
  const [fromA, setFromA] = useState(defaultFrom);
  const [toA, setToA] = useState(defaultTo);
  const [fromB, setFromB] = useState(defaultFrom);
  const [toB, setToB] = useState(defaultTo);
  const [metric, setMetric] = useState<ComparisonMetricKey>("contact_rate");
  const [result, setResult] = useState<ComparisonWithCadence | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<ComparisonPeriod | null>(null);
  // Checked as the dates change, by the same rule the database applies, so a mismatch is explained
  // and the matched period offered before anyone presses Compare.
  const today = new Date().toISOString().slice(0, 10);
  const check = checkComparisonPeriods({ from: fromA, to: toA }, { from: fromB, to: toB }, today);
  const offer = !check.ok ? check.suggestion : suggestion;

  async function run(periodB: ComparisonPeriod) {
    setLoading(true); setError(null); setSuggestion(null);
    const params = new URLSearchParams({ campaign_a_id: campaignA, campaign_b_id: campaignB, from_a: fromA, to_a: toA, from_b: periodB.from, to_b: periodB.to, metric });
    try {
      const response = await fetch(`/api/app/true-cpa/compare?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setSuggestion(body?.suggestion ?? null); throw new Error(body?.error ?? "Could not compare campaigns"); }
      setResult(body);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not compare campaigns"); }
    finally { setLoading(false); }
  }

  function compare(event: React.FormEvent) {
    event.preventDefault();
    if (!check.ok) { setError(check.message); return; }
    void run({ from: fromB, to: toB });
  }

  /** Take the matched period for B and compare with it — the fix, not only the refusal. */
  function takeMatched(period: ComparisonPeriod) {
    setFromB(period.from); setToB(period.to);
    if (campaignA && campaignB) void run(period);
    else setError(null);
  }

  return <TableCard
    title="Compare campaigns"
    toolbar={<form className="w-full" onSubmit={compare}>
      <DataToolbar actions={<Button type="submit" disabled={loading || rows.length < 2}>{loading ? "Comparing…" : "Compare"}</Button>}>
        <select id="comparison-campaign-a" aria-label="Campaign A" required className={`${toolbarControl} max-w-[240px]`} value={campaignA} onChange={(event) => setCampaignA(event.target.value)}><option value="">Campaign A</option>{rows.map((row) => <option key={`a-${row.campaign_id}`} value={row.campaign_id}>{row.campaign_name} · {row.vendor_name}</option>)}</select>
        <input aria-label="Campaign A from" type="date" className={toolbarControl} value={fromA} onChange={(event) => setFromA(event.target.value)} />
        <input aria-label="Campaign A to" type="date" className={toolbarControl} value={toA} onChange={(event) => setToA(event.target.value)} />
        <select id="comparison-campaign-b" aria-label="Campaign B" required className={`${toolbarControl} max-w-[240px]`} value={campaignB} onChange={(event) => setCampaignB(event.target.value)}><option value="">Campaign B</option>{rows.map((row) => <option key={`b-${row.campaign_id}`} value={row.campaign_id}>{row.campaign_name} · {row.vendor_name}</option>)}</select>
        <input aria-label="Campaign B from" type="date" className={toolbarControl} value={fromB} onChange={(event) => setFromB(event.target.value)} />
        <input aria-label="Campaign B to" type="date" className={toolbarControl} value={toB} onChange={(event) => setToB(event.target.value)} />
        <select id="comparison-metric" aria-label="Metric" className={toolbarControl} value={metric} onChange={(event) => setMetric(event.target.value as ComparisonMetricKey)}>{Object.entries(label).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select>
      </DataToolbar>
    </form>}
  >
    {!rows.length && <p className="px-4 py-6 text-sm text-muted-foreground">Load at least two campaign rows to compare.</p>}
    {!check.ok && check.problem !== "order" && !error && <p className={`border-b border-border px-4 py-2.5 text-sm ${TONE_TEXT.info}`}>{check.message}</p>}
    {error && <p role="alert" className="border-b border-border px-4 py-2.5 text-sm text-[var(--error-ink)]">{error}</p>}
    {offer && <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5 text-sm">
      <span>Matched period for B: <strong className="tabular-nums">{periodLabel(offer)}</strong> &middot; {periodDays(offer)} days, starting on the same weekday as A.</span>
      <Button type="button" variant="outline" disabled={loading} onClick={() => takeMatched(offer)}>{campaignA && campaignB ? "Compare with this period" : "Use this period"}</Button>
    </div>}
    {result && <>
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{result.confidence.statement}</p>
          {result.confidence.size_warning && <p className="mt-0.5 text-sm text-[var(--warning-ink)]">{result.confidence.size_warning}</p>}
          <p className="mt-0.5 text-xs text-muted-foreground">{result.matched_periods.days} matched days · {result.confidence.sample_a} observations in A · {result.confidence.sample_b} in B</p>
          {result.cadence && <p className={`mt-0.5 text-xs ${TONE_TEXT[CADENCE_TONE[result.cadence.status]]}`}><strong className="font-semibold">{CADENCE_TITLE[result.cadence.status]}.</strong> {result.cadence.message}</p>}
        </div>
        <Badge variant={result.confidence.level === "strong" ? "secondary" : result.confidence.level === "insufficient" ? "destructive" : "outline"}>{result.confidence.level.replaceAll("_", " ")}</Badge>
      </div>
      <dl className="grid gap-x-6 gap-y-3 border-t border-border px-4 py-3 sm:grid-cols-3">
        <div><dt className={fact}>{label[result.metric.key]}</dt><dd className="mt-1 text-sm font-semibold tabular-nums">A {metricValue(result.metric.a_value, result.metric.unit)} · B {metricValue(result.metric.b_value, result.metric.unit)}</dd></div>
        <div><dt className={fact}>Difference B − A</dt><dd className="mt-1 text-sm font-semibold tabular-nums">{metricValue(result.metric.difference, result.metric.unit)} <span className="text-xs font-normal text-muted-foreground">{result.metric.unit === "cents" ? "lower is better" : "higher is better"}</span></dd></div>
        <div><dt className={fact}>Allocated spend</dt><dd className="mt-1 text-sm font-semibold tabular-nums">A {dollars(result.campaign_a.allocated_spend_cents)} · B {dollars(result.campaign_b.allocated_spend_cents)}</dd></div>
      </dl>
      <table className="portal-lead-table w-full min-w-[720px] border-t border-border text-left">
        <caption className="sr-only">Side-by-side funnel volumes</caption>
        <thead><tr><th scope="col">Stage</th><th scope="col" className="!text-right">A volume</th><th scope="col" className="!text-right">B volume</th><th scope="col" className="!text-right">Difference</th><th scope="col" className="!text-right">A rate</th><th scope="col" className="!text-right">B rate</th></tr></thead>
        <tbody>{result.funnel.map((stage) => <tr key={stage.stage}>
          <td className="font-medium capitalize">{stage.stage.replaceAll("_", " ")}</td>
          <td className="text-right tabular-nums">{stage.a_count.toLocaleString()}</td>
          <td className="text-right tabular-nums">{stage.b_count.toLocaleString()}</td>
          <td className="text-right tabular-nums">{stage.difference > 0 ? "+" : ""}{stage.difference.toLocaleString()}</td>
          <td className="text-right tabular-nums">{stage.a_rate_percent == null ? "—" : `${stage.a_rate_percent}%`}</td>
          <td className="text-right tabular-nums">{stage.b_rate_percent == null ? "—" : `${stage.b_rate_percent}%`}</td>
        </tr>)}</tbody>
      </table>
    </>}
  </TableCard>;
}
