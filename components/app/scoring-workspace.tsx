"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { cn } from "@/lib/utils";
import { compareHoldout, pts, VERDICT_CHIP } from "@/lib/scoring/holdout";
import { breakdownLine, heldBackSentence, leadLine, scoreShare, shareLabel, type QueuePreview } from "@/lib/scoring/preview";

type Weight = { signal: string; label: string; blurb: string; weight: number; isDefault: boolean; defaultWeight: number | null };
type Cohort = { cohort: string; served: number; contacted: number; contactRatePct: number | null; averageScore: number | null; since: string | null };
type VendorRate = { vendorId: string; name: string; attempts: number; contacts: number; ratePct: number };
type Period = "14d" | "all";
type Overview = {
  enabled: boolean;
  holdoutPct: number;
  weights: Weight[];
  cohorts: Cohort[];
  period?: Period;
  periodFrom?: string | null;
  periodSupported?: boolean;
  vendorRates?: VendorRate[];
};
type Agent = { userId: string; name: string; role: string };
type PreviewResponse = { agents: Agent[]; agentId: string | null; preview: QueuePreview | null; available: boolean };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "1–22 September", "28 August – 22 September", "3 December 2025 – 22 September 2026". */
function range(since: string | null, until = new Date()) {
  if (!since) return null;
  const from = new Date(since);
  if (Number.isNaN(from.getTime())) return null;
  if (from.getFullYear() !== until.getFullYear()) return `${from.getDate()} ${MONTHS[from.getMonth()]} ${from.getFullYear()} – ${until.getDate()} ${MONTHS[until.getMonth()]} ${until.getFullYear()}`;
  if (from.getMonth() !== until.getMonth()) return `${from.getDate()} ${MONTHS[from.getMonth()]} – ${until.getDate()} ${MONTHS[until.getMonth()]}`;
  return `${from.getDate()}–${until.getDate()} ${MONTHS[until.getMonth()]}`;
}
const pct = (value: number | null) => (value === null ? "—" : `${value.toFixed(1)}%`);
const same = (value: string, target: number | null) => target !== null && Number(value) === target;

const ROLE_LABEL: Record<string, string> = { owner: "Owner", producer: "Producer", setter: "Setter" };
const sentence = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

/**
 * "Next up, and why" (concept board LA-2 §13): the leads Serve next would hand one chosen agent,
 * each with its tier reason, the scorer's reasons and its score as 0–1, and the due leads the
 * calling window is holding back. Read-only — scoring_queue_preview claims nothing and records no
 * scoring decision, so looking never moves the holdout comparison.
 */
function QueuePreviewCard({ onClose }: { onClose: () => void }) {
  const [agentId, setAgentId] = useState<string>("");
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // True from the start: the first load runs from the effect, and a setState there would cascade.
  const [loading, setLoading] = useState(true);
  // LA-2.13-2: the lead whose per-signal breakdown is open.
  const [openRow, setOpenRow] = useState<string | null>(null);

  const load = useCallback((agent: string) => {
    const query = agent ? `?agent=${encodeURIComponent(agent)}` : "";
    return fetch(`/api/app/scoring/preview${query}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? "Could not preview the queue");
        const next = body as PreviewResponse;
        setError(null);
        setData(next);
        if (next.agentId) setAgentId(next.agentId);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not preview the queue"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { void load(""); }, [load]);

  const preview = data?.preview ?? null;
  const agentName = data?.agents.find((agent) => agent.userId === agentId)?.name ?? "this agent";

  return (
    <div id="queue-preview">
      <TableCard
        title="Next up, and why"
        toolbar={
          <DataToolbar
            actions={<>
              <Button type="button" variant="outline" onClick={onClose}>Close</Button>
              <RefreshButton onClick={() => { setLoading(true); void load(agentId); }} refreshing={loading} />
            </>}
          >
            <select
              id="preview-agent"
              aria-label="Agent"
              value={agentId}
              disabled={!data || data.agents.length === 0 || loading}
              onChange={(event) => { setAgentId(event.target.value); setLoading(true); void load(event.target.value); }}
              className={cn(toolbarControl, "max-w-[260px]")}
            >
              {(data?.agents ?? []).map((agent) => <option key={agent.userId} value={agent.userId}>{agent.name} · {ROLE_LABEL[agent.role] ?? agent.role}</option>)}
            </select>
          </DataToolbar>
        }
        footer={preview && data?.available ? <span>{preview.servableCount.toLocaleString()} {preview.servableCount === 1 ? "lead" : "leads"} servable to {agentName} now · looking claims nothing</span> : undefined}
      >
        {error && data && <p role="alert" className="px-4 pt-3 text-sm leading-normal tracking-[-0.02em] text-[var(--error-ink)]">{error}</p>}

        {error && !data ? (
          <ErrorState title="The preview did not load" detail={error} action={<Button variant="outline" onClick={() => { setLoading(true); void load(agentId); }}>Try again</Button>} />
        ) : !data ? (
          <SectionLoading rows={4} label="Loading the queue preview" />
        ) : data.agents.length === 0 ? (
          <EmptyState title="No queue to preview" hint="No active owner, producer or setter can dial yet." />
        ) : !data.available || !preview ? (
          <EmptyState title="Preview unavailable" hint="The queue preview needs a database update that has not been applied yet." />
        ) : (
          <>
            {preview.capacityGate && !preview.poolOpen && (
              <p className="px-4 pt-3 text-sm leading-normal tracking-[-0.02em] text-[var(--warning-ink)]">{agentName} is at their open-lead ceiling, so Serve next hands them only leads already assigned to them.</p>
            )}
            {preview.rows.length === 0 ? (
              <p className="px-4 py-4 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">Nothing is servable to {agentName} right now.</p>
            ) : (
              <ol>
                {preview.rows.map((row) => {
                  const share = scoreShare(row.score, preview.totalWeight);
                  const why = [row.tierReason, ...row.reasons.map(sentence)].filter(Boolean).join(" · ");
                  return (
                    <li key={row.workItemId} className="border-t border-border px-4 py-3 first:border-t-0">
                      <div className="flex items-start gap-4">
                        <span className="w-6 shrink-0 pt-0.5 text-right text-sm font-semibold tabular-nums text-muted-foreground">{row.position}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">{leadLine(row)}</span>
                          <span className="mt-0.5 block text-xs leading-normal text-muted-foreground">{why}</span>
                        </span>
                        {row.cohort === "control" && <StatusChip tone="neutral" dot={false}>Holdout</StatusChip>}
                        <span className="shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-foreground" title={row.score === null ? "No score" : `${row.score.toFixed(1)} of ${preview.totalWeight.toFixed(0)} weight points`}>{shareLabel(share)}</span>
                        {row.breakdown && row.breakdown.length > 0 && (
                          <Button type="button" variant="outline" size="sm" aria-expanded={openRow === row.workItemId} aria-controls={`breakdown-${row.workItemId}`} onClick={() => setOpenRow(openRow === row.workItemId ? null : row.workItemId)}>
                            {openRow === row.workItemId ? "Hide" : "Breakdown"}
                          </Button>
                        )}
                      </div>
                      {openRow === row.workItemId && row.breakdown && (
                        <table id={`breakdown-${row.workItemId}`} className="mt-2 ml-10 w-[calc(100%-2.5rem)] max-w-[560px] text-xs leading-normal" aria-label={`Score breakdown for ${row.name ?? "this lead"}`}>
                          <thead>
                            <tr className="text-left text-muted-foreground">
                              <th scope="col" className="py-1 pr-3 font-semibold">Signal</th>
                              <th scope="col" className="py-1 pr-3 text-right font-semibold">Factor</th>
                              <th scope="col" className="py-1 text-right font-semibold">Points</th>
                            </tr>
                          </thead>
                          <tbody>
                            {row.breakdown.map((part) => (
                              <tr key={part.signal} className="border-t border-border">
                                <td className="py-1 pr-3 text-foreground">{part.label}</td>
                                <td className="py-1 pr-3 text-right tabular-nums text-foreground">{part.factor.toFixed(2)}</td>
                                <td className="py-1 text-right tabular-nums text-foreground">{breakdownLine(part)}</td>
                              </tr>
                            ))}
                            <tr className="border-t border-border font-semibold">
                              <td className="py-1 pr-3 text-foreground">Score</td>
                              <td className="py-1 pr-3" />
                              <td className="py-1 text-right tabular-nums text-foreground">{/* The scorer's own total (its factors are shown rounded to three places). */}{(row.score ?? row.breakdown.reduce((sum, part) => sum + part.points, 0)).toFixed(1)} of {preview.totalWeight.toFixed(0)} pts</td>
                            </tr>
                          </tbody>
                        </table>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}

            <div className="border-t border-border px-4 py-3">
              <p className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">Held back by the calling window · {preview.heldBackCount.toLocaleString()}</p>
              {preview.heldBack.length === 0 ? (
                <p className="mt-1.5 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">No due lead is waiting on the calling window.</p>
              ) : (
                <ul className="mt-1">
                  {preview.heldBack.map((row) => (
                    <li key={row.workItemId} className="py-1.5">
                      <span className="block text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">{leadLine(row)}</span>
                      <span className="mt-0.5 block text-xs leading-normal text-muted-foreground">{heldBackSentence(row)}</span>
                    </li>
                  ))}
                  {preview.heldBackCount > preview.heldBack.length && (
                    <li className="pt-1 text-xs leading-normal text-muted-foreground">The {preview.heldBack.length} soonest to open are shown.</li>
                  )}
                </ul>
              )}
            </div>
          </>
        )}
      </TableCard>
    </div>
  );
}

/**
 * Queue scoring (p-app-scoring): whether the queue is ranked, by what, and whether the ranking is
 * measurably beating the plain order. Drawn to the board with the scorer's own seven signals — the
 * board's "Calling window" and "Product value" are not signals the scorer has (the calling window is
 * a gate, not a weight: an out-of-window lead is never served at all), so they are not drawn as if
 * they were.
 */
export function ScoringWorkspace() {
  const [data, setData] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [holdout, setHoldout] = useState("10");
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [holdoutWindow, setHoldoutWindow] = useState<Period>("14d");
  const [previewOpen, setPreviewOpen] = useState(false);

  const load = useCallback((span: Period = "14d", resetForm = true) => fetch(`/api/app/scoring?period=${span}`, { cache: "no-store" })
    .then(async (response) => {
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load queue scoring");
      const overview = body as Overview;
      setLoadError(null);
      setData(overview);
      // Switching the holdout window re-reads the comparison only; it must not discard unsaved edits.
      if (!resetForm) return;
      setEnabled(overview.enabled);
      setHoldout(String(overview.holdoutPct));
      setWeights(Object.fromEntries(overview.weights.map((weight) => [weight.signal, weight.weight.toFixed(2)])));
    })
    .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : "Could not load queue scoring")), []);

  useEffect(() => { void load(); }, [load]);

  const scored = data?.cohorts.find((cohort) => cohort.cohort === "scored");
  const control = data?.cohorts.find((cohort) => cohort.cohort === "control");
  const comparison = compareHoldout(scored, control);
  const lift = comparison.differencePts;
  const since = [scored?.since, control?.since].filter((value): value is string => Boolean(value)).sort()[0] ?? null;
  const period = range(since);

  const weightList = useMemo(() => data?.weights ?? [], [data]);
  const atDefault = weightList.filter((weight) => (weight.defaultWeight === null ? weight.isDefault : same(weights[weight.signal] ?? "", weight.defaultWeight))).length;
  const dirty = Boolean(data) && (enabled !== data?.enabled || Number(holdout) !== data?.holdoutPct || weightList.some((weight) => Number(weights[weight.signal]) !== weight.weight));

  async function save() {
    const invalid = weightList.find((weight) => { const value = Number(weights[weight.signal]); return !Number.isFinite(value) || value < 0 || value > 100; });
    if (invalid) { notify.block(`${invalid.label}: a weight is a number from 0 to 100.`); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/app/scoring", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          holdout_pct: Math.max(0, Math.min(50, Math.round(Number(holdout)) || 0)),
          weights: Object.entries(weights).map(([signal, value]) => ({ signal, weight: Number(value) || 0 })),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) { notify.block(body?.error ?? "Could not save queue scoring"); return; }
      notify.done("Queue scoring saved. It applies to the next lead served.");
      await load(holdoutWindow);
    } finally { setSaving(false); }
  }

  if (loadError && !data) return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <PageHeader title="Queue scoring" />
      <section className="rounded-lg border border-border bg-card"><ErrorState title="Queue scoring did not load" detail={loadError} action={<Button variant="outline" onClick={() => void load(holdoutWindow)}>Try again</Button>} /></section>
    </div>
  );
  if (!data) return <PageLoading />;
  const verdict = VERDICT_CHIP[comparison.verdict];
  const periodSupported = data.periodSupported === true;
  const shownPeriod: Period = data.period ?? "all";
  const vendorRates = data.vendorRates ?? [];
  const noDials = !scored && !control;
  const periodLabel = shownPeriod === "14d" ? (data.periodFrom ? range(data.periodFrom) : "Last 14 days") : period ?? "All time";
  // Share of the score each signal carries, from the numbers as typed — so an edit shows its effect
  // on the split before it is saved.
  const typedTotal = weightList.reduce((sum, weight) => { const value = Number(weights[weight.signal]); return sum + (Number.isFinite(value) && value > 0 ? value : 0); }, 0);

  function openPreview() {
    setPreviewOpen(true);
    requestAnimationFrame(() => document.getElementById("queue-preview")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  function choosePeriod(next: Period) {
    if (next === holdoutWindow) return;
    setHoldoutWindow(next);
    void load(next, false);
  }

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Queue scoring"
        actions={<>
          {dirty && <StatusChip tone="warning">Not saved yet</StatusChip>}
          {/* The holdout comparison's window; it re-reads the figures below and leaves unsaved edits alone. */}
          <select
            aria-label="Holdout comparison period"
            className={toolbarControl}
            value={shownPeriod}
            title={!periodSupported ? "The 14-day view needs a database update that has not been applied yet." : undefined}
            onChange={(event) => choosePeriod(event.target.value as Period)}
          >
            <option value="14d" disabled={!periodSupported}>Last 14 days</option>
            <option value="all">All time</option>
          </select>
          <Button type="button" variant="outline" onClick={openPreview}>Preview the queue</Button>
          <Button type="button" disabled={saving || !dirty} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button>
        </>}
      />

      {/* Scored order against the unscored holdout, as a difference over a named sample — never a verdict on its own. */}
      <StatStrip label="Scored order against the unscored holdout">
        <StatTile label="Scored contact rate" value={pct(scored?.contactRatePct ?? comparison.scoredPct)} footnote={noDials ? "no dials yet" : `${(scored?.served ?? 0).toLocaleString()} dials · ${(scored?.contacted ?? 0).toLocaleString()} contacts`} />
        <StatTile label="Unscored holdout" value={pct(control?.contactRatePct ?? comparison.holdoutPct)} footnote={noDials ? "no dials yet" : `${(control?.served ?? 0).toLocaleString()} dials · ${(control?.contacted ?? 0).toLocaleString()} contacts`} />
        <StatTile label="Difference" value={lift === null ? "—" : pts(lift)} footnote={<StatusChip tone={verdict.tone}>{verdict.label}</StatusChip>} />
        <StatTile label="95% interval" value={comparison.interval ? `${pts(comparison.interval.low).replace(" pts", "")} to ${pts(comparison.interval.high)}` : "—"} footnote={periodLabel} />
      </StatStrip>

      <TableCard
        title={enabled ? "Scoring is on" : "Scoring is off"}
        action={<>
          {/* User decision: learned mode is a label only. The weights are the rules below; nothing
              refits them from observed contacts. */}
          <StatusChip tone="neutral" dot={false} title="The score is the weighted sum of the signals below, with the weights you set. Nothing refits them from observed contacts.">Rules mode · not learned yet</StatusChip>
          <StatusChip tone="neutral">{atDefault} of {weightList.length} at default</StatusChip>
        </>}
        toolbar={
          <div className="flex w-full flex-wrap items-center gap-x-6 gap-y-2">
            <label className="inline-flex items-center gap-3 text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--body)]">
              <span className="portal-toggle shrink-0">
                <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} aria-label="Enable queue scoring" />
                <span />
              </span>
              Enable queue scoring
            </label>
            <span className="inline-flex items-center gap-2">
              <label htmlFor="holdout" className="text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--body)]">Holdout</label>
              <input id="holdout" inputMode="numeric" value={holdout} onChange={(event) => setHoldout(event.target.value)} className={cn(toolbarControl, "w-[88px] text-right tabular-nums")} />
              <span className="text-sm text-muted-foreground">% of serves, up to 50</span>
            </span>
          </div>
        }
      >
        {weightList.map((weight) => {
          const value = weights[weight.signal] ?? "";
          const atItsDefault = weight.defaultWeight === null ? weight.isDefault : same(value, weight.defaultWeight);
          const typed = Number(value);
          const share = typedTotal > 0 && Number.isFinite(typed) && typed > 0 ? (100 * typed) / typedTotal : 0;
          return (
            <div key={weight.signal} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3">
              <span className="w-full min-w-0 sm:w-[260px]">
                <span className="block text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">{weight.label}</span>
                <span className="mt-0.5 block text-xs leading-normal text-muted-foreground">{weight.blurb}</span>
                <span className="mt-0.5 block text-xs font-semibold leading-normal tabular-nums text-[var(--body)]">
                  {typedTotal > 0 ? `${Math.round(share)}% of the score` : "No weight set on any signal"}
                </span>
                {weight.signal === "vendor_contact_rate" && (
                  <span className="mt-0.5 block text-xs leading-normal text-muted-foreground">
                    {vendorRates.length === 0
                      ? "No vendor has 30 dispositioned dials yet, so every vendor scores neutral."
                      : `${vendorRates.slice(0, 4).map((vendor) => `${vendor.name} contacts at ${Math.round(vendor.ratePct)}%`).join(", ")}${vendorRates.length > 4 ? `, and ${vendorRates.length - 4} more` : ""}. Vendors under 30 dials score neutral.`}
                  </span>
                )}
              </span>
              <input aria-label={`${weight.label} weight`} inputMode="decimal" value={value} onChange={(event) => setWeights((current) => ({ ...current, [weight.signal]: event.target.value }))} className={cn(toolbarControl, "w-[88px] text-right tabular-nums")} />
              <span className="flex-grow" />
              <StatusChip tone={atItsDefault ? "neutral" : "action"} dot={false}>{atItsDefault ? "Default" : "Overridden"}</StatusChip>
              {!atItsDefault && weight.defaultWeight !== null && (
                <Button type="button" variant="outline" size="sm" title={`Back to the default, ${weight.defaultWeight.toFixed(2)}. Save to apply.`} onClick={() => setWeights((current) => ({ ...current, [weight.signal]: weight.defaultWeight!.toFixed(2) }))}>Reset</Button>
              )}
            </div>
          );
        })}
      </TableCard>

      {previewOpen && <QueuePreviewCard onClose={() => setPreviewOpen(false)} />}
    </div>
  );
}
