"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState, LoadingRows } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { sectionForPath } from "@/lib/menu/definition";
import { compareHoldout, pts, VERDICT_CHIP } from "@/lib/scoring/holdout";
import { heldBackSentence, leadLine, scoreShare, shareLabel, type QueuePreview } from "@/lib/scoring/preview";

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

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold leading-normal tracking-[-0.02em] tabular-nums text-foreground">{children}</p>
    </div>
  );
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-4 py-3.5">
      <p className="text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--info-ink)]">{title}</p>
      <p className="mt-1.5 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">{children}</p>
    </div>
  );
}

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
    <section id="queue-preview" className="overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="queue-preview-title">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-[var(--surface-alt)] px-4 py-3">
        <span id="queue-preview-title" className="text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">Next up, and why</span>
        <span className="flex flex-wrap items-center gap-2.5">
          <label htmlFor="preview-agent" className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">Agent</label>
          <select
            id="preview-agent"
            value={agentId}
            disabled={!data || data.agents.length === 0 || loading}
            onChange={(event) => { setAgentId(event.target.value); setLoading(true); void load(event.target.value); }}
            className="h-8 max-w-[240px] rounded-lg border border-[var(--border-strong)] bg-card px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {(data?.agents ?? []).map((agent) => <option key={agent.userId} value={agent.userId}>{agent.name} · {ROLE_LABEL[agent.role] ?? agent.role}</option>)}
          </select>
          <Button type="button" variant="outline" className="h-8 border-[var(--border-strong)] px-4" disabled={loading} onClick={() => { setLoading(true); void load(agentId); }}>{loading ? "Loading…" : "Refresh"}</Button>
          <Button type="button" variant="outline" className="h-8 border-[var(--border-strong)] px-4" onClick={onClose}>Close</Button>
        </span>
      </div>
      {error && data && <p role="alert" className="px-5 pt-3 text-sm leading-normal tracking-[-0.02em] text-[var(--error-ink)]">{error}</p>}

      {error && !data ? (
        <ErrorState title="The preview did not load" detail={error} action={<Button variant="outline" onClick={() => { setLoading(true); void load(agentId); }}>Try again</Button>} />
      ) : !data ? (
        <LoadingRows rows={4} />
      ) : data.agents.length === 0 ? (
        <p className="px-5 py-4 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">No active owner, producer or setter can dial yet, so there is no queue to preview.</p>
      ) : !data.available || !preview ? (
        <p className="px-5 py-4 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">The queue preview needs a database update that has not been applied yet.</p>
      ) : (
        <>
          <p className="px-5 pt-4 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">
            {preview.servableCount.toLocaleString()} {preview.servableCount === 1 ? "lead" : "leads"} servable to {agentName} now.{" "}
            {preview.ranked
              ? "Tier first, then score — scoring orders leads within a tier, never across tiers."
              : preview.enabled
                ? "Scoring is on, but no scored-cohort lead is servable, so Serve next falls back to the plain order: tier, then oldest first."
                : "Scoring is off, so this is the plain order: tier, then oldest first. The score is what the scorer would give."}
          </p>
          {preview.capacityGate && !preview.poolOpen && (
            <p className="px-5 pt-2 text-sm leading-normal tracking-[-0.02em] text-[var(--warning-ink)]">{agentName} is at their open-lead ceiling, so Serve next hands them only leads already assigned to them.</p>
          )}
          {preview.rows.length === 0 ? (
            <p className="px-5 py-4 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">Nothing is servable to {agentName} right now.</p>
          ) : (
            <ol className="mt-3">
              {preview.rows.map((row) => {
                const share = scoreShare(row.score, preview.totalWeight);
                const why = [row.tierReason, ...row.reasons.map(sentence)].filter(Boolean).join(" · ");
                return (
                  <li key={row.workItemId} className="flex items-start gap-4 border-t border-border px-5 py-3">
                    <span className="w-6 shrink-0 pt-0.5 text-right text-sm font-semibold tabular-nums text-muted-foreground">{row.position}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">{leadLine(row)}</span>
                      <span className="mt-0.5 block text-xs leading-normal text-muted-foreground">{why}</span>
                    </span>
                    {row.cohort === "control" && <StatusChip tone="neutral" dot={false}>Holdout</StatusChip>}
                    <span className="shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-foreground" title={row.score === null ? "No score" : `${row.score.toFixed(1)} of ${preview.totalWeight.toFixed(0)} weight points`}>{shareLabel(share)}</span>
                  </li>
                );
              })}
            </ol>
          )}

          <div className="border-t border-border px-5 py-3">
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

          <p className="border-t border-border px-5 py-3 text-xs leading-normal text-muted-foreground">
            The order within a tier can differ from Serve next: it breaks ties with a weighted draw over the campaign mix
            {preview.enabled && preview.holdoutPct > 0 ? `, and about ${preview.holdoutPct}% of serves draw the holdout, served in the plain order` : ""}.
            Looking changes nothing — no lead is claimed and no scoring decision is recorded.
          </p>
        </>
      )}
    </section>
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

  const header = <PageHeader eyebrow={sectionForPath("/app/scoring") ?? undefined} title="Queue scoring" description="The order leads are served in, and whether it beats the plain order." />;
  if (loadError && !data) return <div className="m-stagger flex w-full min-w-0 flex-col gap-6">{header}<section className="rounded-xl border border-border bg-card"><ErrorState title="Queue scoring did not load" detail={loadError} action={<Button variant="outline" onClick={() => void load(holdoutWindow)}>Try again</Button>} /></section></div>;
  if (!data) return <div className="m-stagger flex w-full min-w-0 flex-col gap-6">{header}<section className="rounded-xl border border-border bg-card"><LoadingRows rows={6} /></section></div>;
  const verdict = VERDICT_CHIP[comparison.verdict];
  const periodSupported = data.periodSupported === true;
  const shownPeriod: Period = data.period ?? "all";
  const vendorRates = data.vendorRates ?? [];
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
        eyebrow={sectionForPath("/app/scoring") ?? undefined}
        title="Queue scoring"
        description="The order leads are served in, and whether it beats the plain order."
        actions={<Button type="button" variant="outline" className="border-[var(--border-strong)]" onClick={openPreview}>Preview the queue</Button>}
      />

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between md:gap-6">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">{enabled ? "Scoring is on" : "Scoring is off"}</h2>
            <p className="mt-1 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">Within each tier, leads are served highest score first — a due callback still comes before a retry, and a retry before a fresh lead, whatever the score. Off by default. Turning it off returns the queue to callbacks, then retries due, then fresh — nothing breaks.</p>
          </div>
          <div className="flex shrink-0 items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--body)]">Enable queue scoring</span>
              <span className="mt-1 block max-w-[420px] text-xs leading-normal text-muted-foreground">Applies to the next lead served, never to a queue already handed out.</span>
            </span>
            <label className="portal-toggle shrink-0">
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} aria-label="Enable queue scoring" />
              <span />
            </label>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4">
          <label htmlFor="holdout" className="text-sm font-semibold leading-normal tracking-[-0.02em] text-[var(--body)]">Holdout</label>
          <span className="inline-flex items-center gap-2">
            <input id="holdout" inputMode="numeric" value={holdout} onChange={(event) => setHoldout(event.target.value)} className="h-[38px] w-[88px] rounded-lg border border-[var(--border-strong)] bg-card px-3 text-right text-base tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <span className="text-sm text-muted-foreground">% of serves</span>
          </span>
          <span className="text-xs leading-normal text-muted-foreground">Served in the plain order, to compare against. Capped at 50.</span>
          {dirty && <StatusChip tone="warning">Not saved yet</StatusChip>}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-4 border-b border-border bg-[var(--surface-alt)] px-4 py-3">
          <span className="text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">Weights</span>
          <span className="flex flex-wrap items-center justify-end gap-2.5">
            {/* User decision: learned mode is a label only. The weights are the rules below; nothing
                refits them from observed contacts. */}
            <StatusChip tone="neutral" dot={false} title="The score is the weighted sum of the signals below, with the weights you set. Nothing refits them from observed contacts.">Rules mode · not learned yet</StatusChip>
            <StatusChip tone="neutral">{atDefault} of {weightList.length} at default</StatusChip>
            <Button type="button" className="h-8 px-4" disabled={saving || !dirty} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button>
          </span>
        </div>
        {weightList.map((weight, index) => {
          const value = weights[weight.signal] ?? "";
          const atItsDefault = weight.defaultWeight === null ? weight.isDefault : same(value, weight.defaultWeight);
          const typed = Number(value);
          const share = typedTotal > 0 && Number.isFinite(typed) && typed > 0 ? (100 * typed) / typedTotal : 0;
          return (
            <div key={weight.signal} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 ${index ? "border-t border-border" : ""}`}>
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
              <input aria-label={`${weight.label} weight`} inputMode="decimal" value={value} onChange={(event) => setWeights((current) => ({ ...current, [weight.signal]: event.target.value }))} className="h-[38px] w-[88px] rounded-lg border border-[var(--border-strong)] bg-card px-3 text-right text-base tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" />
              <span className="flex-grow" />
              <StatusChip tone={atItsDefault ? "neutral" : "action"} dot={false}>{atItsDefault ? "Default" : "Overridden"}</StatusChip>
              {!atItsDefault && weight.defaultWeight !== null && (
                <Button type="button" variant="outline" className="h-8 border-[var(--border-strong)] px-4" title={`Back to the default, ${weight.defaultWeight.toFixed(2)}. Save to apply.`} onClick={() => setWeights((current) => ({ ...current, [weight.signal]: weight.defaultWeight!.toFixed(2) }))}>Reset</Button>
              )}
            </div>
          );
        })}
      </section>

      <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
        <section className="min-w-0 flex-grow rounded-xl border border-border bg-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em] text-foreground">Is it working?</h2>
              <p className="mt-1 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">
                Scored order against the unscored holdout, {shownPeriod === "14d" ? "last 14 days" : "all time"}
                {shownPeriod === "14d" ? (data.periodFrom ? ` (${range(data.periodFrom)})` : "") : period ? `, ${period}` : ""}.
              </p>
            </div>
            <span className="flex flex-wrap items-center gap-2.5">
              <span role="group" aria-label="Holdout comparison period" className="inline-flex rounded-lg border border-[var(--border-strong)] p-0.5">
                {(["14d", "all"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={shownPeriod === option}
                    disabled={option === "14d" && !periodSupported}
                    title={option === "14d" && !periodSupported ? "The 14-day view needs a database update that has not been applied yet." : undefined}
                    onClick={() => choosePeriod(option)}
                    className={`h-7 rounded-md px-3 text-xs font-semibold leading-normal disabled:cursor-not-allowed disabled:opacity-60 ${shownPeriod === option ? "bg-[var(--surface-alt)] text-foreground" : "text-muted-foreground"}`}
                  >
                    {option === "14d" ? "Last 14 days" : "All time"}
                  </button>
                ))}
              </span>
              <StatusChip tone={verdict.tone}>{verdict.label}</StatusChip>
            </span>
          </div>
          {!periodSupported && <p className="mt-2 text-xs leading-normal text-muted-foreground">Showing all time: the 14-day view needs a database update that has not been applied yet.</p>}
          {!scored && !control ? (
            <p className="mt-4 text-sm leading-normal tracking-[-0.02em] text-muted-foreground">No dials recorded yet. Once leads have been served in both arms, their contact rates appear here.</p>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
                <Fact label="Scored contact rate">{pct(scored?.contactRatePct ?? comparison.scoredPct)}</Fact>
                <Fact label="Unscored holdout">{pct(control?.contactRatePct ?? comparison.holdoutPct)}</Fact>
                <Fact label="Difference">{lift === null ? "—" : pts(lift)}</Fact>
                <Fact label="95% interval">{comparison.interval ? `${pts(comparison.interval.low).replace(" pts", "")} to ${pts(comparison.interval.high)}` : "—"}</Fact>
              </div>
              {/* Stated as a difference with its interval rather than a verdict on its own. A few hundred
                  dials is not evidence, and the screen says how many there are so the reader can judge. */}
              <p className="mt-3.5 text-sm leading-normal tracking-[-0.02em] text-[var(--body)]">
                Sample: <strong>{(scored?.served ?? 0).toLocaleString()} scored dials · {(scored?.contacted ?? 0).toLocaleString()} contacts</strong> vs{" "}
                <strong>{(control?.served ?? 0).toLocaleString()} holdout dials · {(control?.contacted ?? 0).toLocaleString()} contacts</strong>.{" "}
                {comparison.verdict === "noise" && "The interval crosses zero, so this lift is not distinguishable from noise yet. "}
                {comparison.verdict === "better" && "The interval clears zero, so the ranking is doing something — a wide interval still means do not re-weight on this alone. "}
                {comparison.verdict === "worse" && "The interval sits below zero: the plain order is contacting more people. Revisit the weights, or turn scoring off. "}
                {comparison.verdict === "too_few" && "Either arm has too few dials to compare yet. "}
                Treat a small sample as noise — a screen that only ever praises itself is not worth having.
              </p>
            </>
          )}
        </section>
        <div className="flex w-full shrink-0 flex-col gap-6 xl:w-[340px]">
          <Note title="Default means default">A weight is marked overridden only when it differs from the system default. Saving one weight used to mark all seven, which made the badge meaningless.</Note>
          <Note title="Agents see the reason, not the score">The score itself is never shown to an agent — only the reason a lead was chosen. A number nobody can explain gets ignored, and then the ordering is worse than no ordering at all.</Note>
          {/* Concept board LA-2 §13. Its copy says the vendor score is "imported and stored"; it is
              not by default — a CSV column that is not mapped to a lead-template field is dropped
              at import — so the sentence says what actually happens. */}
          <Note title="The vendor's own score is not used">Some vendor files carry a vendor_score column whose meaning no vendor will define. Nothing here ranks on it, because nothing should order an agent&apos;s day in a way nobody can explain to them. An import keeps it only if your lead template has a field mapped to it.</Note>
        </div>
      </div>

      {previewOpen && <QueuePreviewCard onClose={() => setPreviewOpen(false)} />}
    </div>
  );
}
