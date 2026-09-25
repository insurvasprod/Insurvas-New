"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { CampaignComparison, ComparisonMetricKey, VendorScorecardRow } from "@/lib/vendorScorecard/types";
import { Callout } from "@/components/app/settings/primitives";
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

  return <Card><CardHeader><CardTitle className="text-base">Compare campaigns honestly</CardTitle><CardDescription>Match the number of days and starting weekday before deciding whether a difference is real. No automatic winner or budget shift is applied.</CardDescription></CardHeader><CardContent className="space-y-4">
    <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" onSubmit={compare}>
      <div className="space-y-1.5"><Label htmlFor="comparison-campaign-a">Campaign A</Label><select id="comparison-campaign-a" required className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={campaignA} onChange={(event) => setCampaignA(event.target.value)}><option value="">Choose campaign</option>{rows.map((row) => <option key={`a-${row.campaign_id}`} value={row.campaign_id}>{row.campaign_name} · {row.vendor_name}</option>)}</select></div>
      <div className="space-y-1.5"><Label htmlFor="comparison-campaign-b">Campaign B</Label><select id="comparison-campaign-b" required className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={campaignB} onChange={(event) => setCampaignB(event.target.value)}><option value="">Choose campaign</option>{rows.map((row) => <option key={`b-${row.campaign_id}`} value={row.campaign_id}>{row.campaign_name} · {row.vendor_name}</option>)}</select></div>
      <div className="space-y-1.5"><Label htmlFor="comparison-metric">Metric</Label><select id="comparison-metric" className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={metric} onChange={(event) => setMetric(event.target.value as ComparisonMetricKey)}>{Object.entries(label).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></div>
      <div className="flex items-end"><Button type="submit" disabled={loading || rows.length < 2}>{loading ? "Comparing…" : "Compare campaigns"}</Button></div>
      <fieldset className="rounded-md border p-3 md:col-span-2"><legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Campaign A period</legend><div className="grid grid-cols-2 gap-3"><Input aria-label="Campaign A from" type="date" value={fromA} onChange={(event) => setFromA(event.target.value)} /><Input aria-label="Campaign A to" type="date" value={toA} onChange={(event) => setToA(event.target.value)} /></div></fieldset>
      <fieldset className="rounded-md border p-3 md:col-span-2"><legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Campaign B period</legend><div className="grid grid-cols-2 gap-3"><Input aria-label="Campaign B from" type="date" value={fromB} onChange={(event) => setFromB(event.target.value)} /><Input aria-label="Campaign B to" type="date" value={toB} onChange={(event) => setToB(event.target.value)} /></div></fieldset>
    </form>
    {!check.ok && check.problem !== "order" && !error && <Callout tone="info" title="These periods are not matched yet">{check.message}</Callout>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {offer && <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-[var(--surface-alt)] p-3 text-sm">
      <span>Matched period for B: <strong className="tabular-nums">{periodLabel(offer)}</strong> &middot; {periodDays(offer)} days, starting on the same weekday as A.</span>
      <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => takeMatched(offer)}>{campaignA && campaignB ? "Compare with this period" : "Use this period"}</Button>
    </div>}
    {!rows.length && <p className="text-sm text-muted-foreground">Load at least two campaign rows to compare.</p>}
    {result && <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 p-4"><div><p className="text-sm font-semibold">{result.confidence.statement}</p>{result.confidence.size_warning && <p className="mt-1 text-sm text-[var(--warning-ink)]">{result.confidence.size_warning}</p>}<p className="mt-1 text-xs text-muted-foreground">{result.matched_periods.days} matched days · {result.confidence.sample_a} observations in A · {result.confidence.sample_b} in B</p></div><Badge variant={result.confidence.level === "strong" ? "secondary" : result.confidence.level === "insufficient" ? "destructive" : "outline"}>{result.confidence.level.replaceAll("_", " ")}</Badge></div>
      {result.cadence && <Callout tone={CADENCE_TONE[result.cadence.status]} title={CADENCE_TITLE[result.cadence.status]}>{result.cadence.message}</Callout>}
      <div className="grid gap-4 md:grid-cols-3"><Card><CardContent className="pt-5"><p className="text-xs font-semibold uppercase text-muted-foreground">Metric</p><p className="mt-2 text-lg font-semibold">{label[result.metric.key]}</p><p className="mt-1 text-sm text-muted-foreground">A {metricValue(result.metric.a_value, result.metric.unit)} · B {metricValue(result.metric.b_value, result.metric.unit)}</p></CardContent></Card><Card><CardContent className="pt-5"><p className="text-xs font-semibold uppercase text-muted-foreground">Difference B − A</p><p className="mt-2 text-lg font-semibold">{metricValue(result.metric.difference, result.metric.unit)}</p><p className="mt-1 text-sm text-muted-foreground">Negative cost is better; positive rates are better.</p></CardContent></Card><Card><CardContent className="pt-5"><p className="text-xs font-semibold uppercase text-muted-foreground">Allocated spend</p><p className="mt-2 text-lg font-semibold">{dollars(result.campaign_a.allocated_spend_cents)} · {dollars(result.campaign_b.allocated_spend_cents)}</p><p className="mt-1 text-sm text-muted-foreground">A · B, allocated from campaign unit cost.</p></CardContent></Card></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><caption className="mb-2 text-left text-sm font-semibold">Side-by-side funnel volumes</caption><thead className="border-b text-xs uppercase tracking-wide text-muted-foreground"><tr><th className="p-3">Stage</th><th className="p-3">A volume</th><th className="p-3">B volume</th><th className="p-3">Difference</th><th className="p-3">A rate</th><th className="p-3">B rate</th></tr></thead><tbody>{result.funnel.map((stage) => <tr key={stage.stage} className="border-b last:border-0"><td className="p-3 font-medium">{stage.stage.replaceAll("_", " ")}</td><td className="p-3">{stage.a_count.toLocaleString()}</td><td className="p-3">{stage.b_count.toLocaleString()}</td><td className="p-3">{stage.difference > 0 ? "+" : ""}{stage.difference.toLocaleString()}</td><td className="p-3">{stage.a_rate_percent == null ? "—" : `${stage.a_rate_percent}%`}</td><td className="p-3">{stage.b_rate_percent == null ? "—" : `${stage.b_rate_percent}%`}</td></tr>)}</tbody></table></div>
    </div>}
  </CardContent></Card>;
}
