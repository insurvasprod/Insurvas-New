"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { Segmented, ViewTabs } from "@/components/app/view-tabs";
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

/** The tab's one card reaches the bottom of the window. */
const FILL = "flex min-h-[calc(100dvh-var(--top-bar-h)-330px)] flex-col [&>*:nth-child(2)]:flex-1";
const th = "bg-[var(--surface-alt)] px-3 py-2 text-left text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] whitespace-nowrap text-muted-foreground first:pl-4 last:pr-4";
const td = "border-t border-border px-3 py-2 text-sm leading-normal tracking-[-0.02em] text-[var(--body)] first:pl-4 last:pr-4";

const ROLE_LABEL: Record<string, string> = { owner: "Owner", producer: "Producer", setter: "Setter" };
const sentence = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

/**
 * "Next up, and why" (concept board LA-2 §13): the leads Serve next would hand one chosen agent,
 * each with its tier reason, the scorer's reasons and its score as 0–1, and the due leads the
 * calling window is holding back. Read-only — scoring_queue_preview claims nothing and records no
 * scoring decision, so looking never moves the holdout comparison.
 *
 * 2026-10-06 redesign: the page's second tab; one even row per lead, and the held-back leads are
 * the toolbar's second view rather than a block under the list.
 */
function QueuePreviewCard({ onClose }: { onClose: () => void }) {
  const [agentId, setAgentId] = useState<string>("");
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // True from the start: the first load runs from the effect, and a setState there would cascade.
  const [loading, setLoading] = useState(true);
  // LA-2.13-2: the lead whose per-signal breakdown is open.
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [list, setList] = useState<"next" | "held">("next");

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
        className="flex min-h-[calc(100dvh-var(--top-bar-h)-330px)] flex-col [&>*:nth-child(3)]:flex-1"
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
            {preview && data?.available && (
              <Segmented
                label="Which leads"
                value={list}
                onChange={setList}
                options={[
                  { key: "next", label: "Next up", count: preview.rows.length },
                  { key: "held", label: "Held back by the calling window", count: preview.heldBackCount },
                ]}
              />
            )}
          </DataToolbar>
        }
        footer={preview && data?.available ? <span>{preview.servableCount.toLocaleString()} {preview.servableCount === 1 ? "lead" : "leads"} servable to {agentName} now · looking claims nothing{list === "held" && preview.heldBackCount > preview.heldBack.length ? ` · the ${preview.heldBack.length} soonest to open are shown` : ""}</span> : undefined}
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
            {list === "held" ? (
              preview.heldBack.length === 0 ? (
                <EmptyState title="Nothing held back" hint="No due lead is waiting on the calling window." />
              ) : (
                <table className="w-full min-w-[720px] border-collapse text-left">
                  <thead><tr><th className={th}>Lead</th><th className={th}>Why it waits</th></tr></thead>
                  <tbody>
                    {preview.heldBack.map((row) => (
                      <tr key={row.workItemId} className="m-row">
                        <td className={`${td} max-w-[320px] truncate font-semibold text-foreground`} title={leadLine(row)}>{leadLine(row)}</td>
                        <td className={`${td} max-w-[480px] truncate text-muted-foreground`} title={heldBackSentence(row)}>{heldBackSentence(row)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            ) : preview.rows.length === 0 ? (
              <EmptyState title="Nothing to serve" hint={`Nothing is servable to ${agentName} right now.`} />
            ) : (
              <table className="w-full min-w-[900px] border-collapse text-left">
                <thead><tr>
                  <th className={`${th} text-right`}>#</th>
                  <th className={th}>Lead</th>
                  <th className={th}>Why</th>
                  <th className={th}>Arm</th>
                  <th className={`${th} text-right`}>Score</th>
                  <th className={`${th} text-right`}><span className="sr-only">Breakdown</span></th>
                </tr></thead>
                <tbody>
                  {preview.rows.map((row) => {
                    const share = scoreShare(row.score, preview.totalWeight);
                    const why = [row.tierReason, ...row.reasons.map(sentence)].filter(Boolean).join(" · ");
                    return (
                      <Fragment key={row.workItemId}>
                        <tr className="m-row">
                          <td className={`${td} w-10 text-right font-semibold tabular-nums text-muted-foreground`}>{row.position}</td>
                          <td className={`${td} max-w-[280px] truncate font-semibold text-foreground`} title={leadLine(row)}>{leadLine(row)}</td>
                          <td className={`${td} max-w-[420px] truncate text-muted-foreground`} title={why}>{why || "—"}</td>
                          <td className={td}>{row.cohort === "control" ? <StatusChip tone="neutral" dot={false}>Holdout</StatusChip> : <span className="text-muted-foreground">Scored</span>}</td>
                          <td className={`${td} text-right font-semibold tabular-nums text-foreground`} title={row.score === null ? "No score" : `${row.score.toFixed(1)} of ${preview.totalWeight.toFixed(0)} weight points`}>{shareLabel(share)}</td>
                          <td className={`${td} text-right`}>
                            {row.breakdown && row.breakdown.length > 0 && (
                              <Button type="button" variant="outline" size="sm" aria-expanded={openRow === row.workItemId} aria-controls={`breakdown-${row.workItemId}`} onClick={() => setOpenRow(openRow === row.workItemId ? null : row.workItemId)}>
                                {openRow === row.workItemId ? "Hide" : "Breakdown"}
                              </Button>
                            )}
                          </td>
                        </tr>
                        {openRow === row.workItemId && row.breakdown && (
                          <tr>
                            <td colSpan={6} className="border-t border-border bg-[var(--canvas)] px-4 py-2">
                              <table id={`breakdown-${row.workItemId}`} className="ml-10 w-[calc(100%-2.5rem)] max-w-[560px] text-xs leading-normal" aria-label={`Score breakdown for ${row.name ?? "this lead"}`}>
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
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
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
 *
 * 2026-10-06 redesign: the weights and the queue preview are two tabs; each signal is one even row.
 */
export function ScoringWorkspace() {
  const [data, setData] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [holdout, setHoldout] = useState("10");
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [holdoutWindow, setHoldoutWindow] = useState<Period>("14d");
  const [tab, setTab] = useState<"weights" | "preview">("weights");

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

      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* "Preview the queue" is the second tab: the leads Serve next would hand an agent, and why. */}
        <ViewTabs
          label="Queue scoring views"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "weights", label: "Weights", count: weightList.length },
            { key: "preview", label: "Preview the queue" },
          ]}
        />
        {/* The holdout comparison's window; it re-reads the figures above and leaves unsaved edits alone. */}
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
      </div>

      {tab === "preview" ? <QueuePreviewCard onClose={() => setTab("weights")} /> : (
      <TableCard
        className={FILL}
        toolbar={
          <DataToolbar
            actions={<>
              {/* User decision: learned mode is a label only. The weights are the rules below; nothing
                  refits them from observed contacts. */}
              <StatusChip tone="neutral" dot={false} title="The score is the weighted sum of the signals below, with the weights you set. Nothing refits them from observed contacts.">Rules mode · not learned yet</StatusChip>
              <StatusChip tone="neutral">{atDefault} of {weightList.length} at default</StatusChip>
            </>}
          >
            <label className="inline-flex h-9 items-center gap-3 text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--body)]">
              <span className="portal-toggle shrink-0">
                <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} aria-label="Enable queue scoring" />
                <span />
              </span>
              {enabled ? "Scoring is on" : "Scoring is off"}
            </label>
            <span className="inline-flex items-center gap-2">
              <label htmlFor="holdout" className="text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--body)]">Holdout</label>
              <input id="holdout" inputMode="numeric" value={holdout} onChange={(event) => setHoldout(event.target.value)} className={cn(toolbarControl, "w-[88px] text-right tabular-nums")} />
              <span className="text-sm text-muted-foreground">% of serves, up to 50</span>
            </span>
          </DataToolbar>
        }
        footer={<span>{typedTotal > 0 ? "Each signal's share of the score follows the weights as typed; Save applies them to the next lead served." : "No weight set on any signal"}</span>}
      >
        <table className="w-full min-w-[1000px] border-collapse text-left">
          <thead><tr>
            <th className={th}>Signal</th>
            <th className={th}>What it measures</th>
            <th className={`${th} text-right`}>Share</th>
            <th className={`${th} text-right`}>Weight</th>
            <th className={th}>State</th>
            <th className={`${th} text-right`}><span className="sr-only">Reset</span></th>
          </tr></thead>
          <tbody>
            {weightList.map((weight) => {
              const value = weights[weight.signal] ?? "";
              const atItsDefault = weight.defaultWeight === null ? weight.isDefault : same(value, weight.defaultWeight);
              const typed = Number(value);
              const share = typedTotal > 0 && Number.isFinite(typed) && typed > 0 ? (100 * typed) / typedTotal : 0;
              const vendorLine = weight.signal === "vendor_contact_rate"
                ? (vendorRates.length === 0
                  ? "No vendor has 30 dispositioned dials yet, so every vendor scores neutral."
                  : `${vendorRates.slice(0, 4).map((vendor) => `${vendor.name} contacts at ${Math.round(vendor.ratePct)}%`).join(", ")}${vendorRates.length > 4 ? `, and ${vendorRates.length - 4} more` : ""}. Vendors under 30 dials score neutral.`)
                : null;
              const measures = [weight.blurb, vendorLine].filter(Boolean).join(" ");
              return (
                <tr key={weight.signal} className="m-row">
                  <td className={`${td} whitespace-nowrap font-semibold text-foreground`}>{weight.label}</td>
                  <td className={`${td} max-w-[520px] truncate text-muted-foreground`} title={measures}>{measures}</td>
                  <td className={`${td} whitespace-nowrap text-right font-semibold tabular-nums`}>{typedTotal > 0 ? `${Math.round(share)}% of the score` : "—"}</td>
                  <td className={`${td} text-right`}>
                    <input aria-label={`${weight.label} weight`} inputMode="decimal" value={value} onChange={(event) => setWeights((current) => ({ ...current, [weight.signal]: event.target.value }))} className={cn(toolbarControl, "w-[88px] text-right tabular-nums")} />
                  </td>
                  <td className={td}><StatusChip tone={atItsDefault ? "neutral" : "action"} dot={false}>{atItsDefault ? "Default" : "Overridden"}</StatusChip></td>
                  <td className={`${td} text-right`}>
                    {!atItsDefault && weight.defaultWeight !== null && (
                      <Button type="button" variant="outline" size="sm" title={`Back to the default, ${weight.defaultWeight.toFixed(2)}. Save to apply.`} onClick={() => setWeights((current) => ({ ...current, [weight.signal]: weight.defaultWeight!.toFixed(2) }))}>Reset</Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableCard>
      )}
    </div>
  );
}
