"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import type { NurtureCampaignReport, NurtureReport, RotationSlot } from "@/lib/nurture/report";
import { ANGLE_MAX, DEFAULT_PASS_CEILING, MAX_PASS_CEILING, SAID_NO_MIN_DAYS, SCRIPT_MAX, STALLED_MINUTES, type RecycleBatch } from "@/lib/nurture/contract";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat";
import { sectionForPath } from "@/lib/menu/definition";
import { cn } from "@/lib/utils";

/**
 * Lead recycling, as the board draws it: five figures, one card per campaign's recycle rule with
 * what a run would pick up, the cadence recycled leads walk, and one real lead's slot rotation.
 *
 * Added from the LA-2 §4 concept (20260925706500), without moving any of that: the pool a campaign's
 * worked leads fall into (never reached, said no, never recyclable, too recent), a batch that needs
 * an angle and sets its own attempts-this-pass, screening driven a chunk at a time from this page
 * (progress lives in the database, so a closed tab loses nothing and an owner can resume a stalled
 * run), and the past batches with their contact rate against the fresh rate over the same span.
 *
 * Everything shown is read from lib/nurture/report.ts. The writes are: save a rule, start a batch,
 * screen the next chunk. Starting asks to be confirmed, because a cleared lead goes back to the dialer.
 */

type Payload = NurtureReport & { readOnly?: boolean };
type Progress = { batchId: string; campaignId: string; screened: number; cleared: number; blocked: number; failed: number; pending: number };

const OPTIONS = ["no_answer", "voicemail", "not_interested"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SLOT_HOURS: Record<string, string> = { early_morning: "8–10am", late_morning: "10am–12", afternoon: "12–3pm", early_evening: "3–6pm", late_evening: "6–9pm", weekend: "Weekend" };
const PREFERRED: Record<string, string> = { opposite_half: "the other half of the day", morning: "a morning slot", evening: "an evening slot", early_morning: "early morning", late_morning: "late morning", afternoon: "the afternoon", early_evening: "early evening", late_evening: "late evening", weekend: "the weekend" };
const label = (value: string) => value.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
const count = (value: number) => value.toLocaleString("en-US");
const plural = (value: number, one: string, many = `${one}s`) => `${count(value)} ${value === 1 ? one : many}`;
const percent = (value: number | null) => (value == null ? "—" : `${value.toFixed(1)}%`);

function stamp(iso: string) { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
function offset(ms: number) {
  if (ms === 0) return "day 0";
  const hours = Math.round(ms / 3_600_000);
  return hours < 48 ? `${hours}h after the first dial` : `day ${Math.round(hours / 24)}`;
}

function Fact({ label: name, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">{name}</div>
      <div className="mt-1 text-sm font-semibold leading-normal tracking-[-0.02em] tabular-nums text-foreground">{children}</div>
    </div>
  );
}

function Figure({ value, tone, children }: { value: number | string; tone: "good" | "danger" | "warning" | "neutral"; children: React.ReactNode }) {
  const ink = { good: "text-[var(--success-ink)]", danger: "text-[var(--error-ink)]", warning: "text-[var(--warning-ink)]", neutral: "text-foreground" }[tone];
  return (
    <span>
      <span className={cn("block text-2xl font-semibold leading-[1.21] tracking-[-0.02em] tabular-nums", ink)}>{typeof value === "number" ? count(value) : value}</span>
      <span className="mt-0.5 block text-xs leading-normal text-[var(--body)]">{children}</span>
    </span>
  );
}

/** Who may continue a running batch: its starter, or an owner once it has stalled (the SQL's rule). */
function canContinue(batch: RecycleBatch, viewer: NurtureReport["viewer"]) {
  if (batch.createdBy === viewer.userId) return { ok: true, reason: "" };
  if (viewer.role !== "owner") return { ok: false, reason: `Only ${batch.createdByName ?? "the person who started it"} or an owner can continue this batch.` };
  if (!batch.stalled) return { ok: false, reason: `${batch.createdByName ?? "Someone"} is screening it now. An owner can resume it after ${STALLED_MINUTES} minutes without progress.` };
  return { ok: true, reason: "" };
}

function RuleCard({ campaign, readOnly, busy, batchesReady, viewer, progress, onChange, onSave, onStart, onResume }: {
  campaign: NurtureCampaignReport;
  readOnly: boolean;
  busy: boolean;
  batchesReady: boolean;
  viewer: NurtureReport["viewer"];
  progress: Progress | null;
  onChange: (change: Partial<NurtureCampaignReport["rule"]>) => void;
  onSave: () => void;
  onStart: (input: { angle: string; script: string; attemptCeiling: number }) => void;
  onResume: (batch: RecycleBatch) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [angle, setAngle] = useState("");
  const [script, setScript] = useState("");
  const [ceiling, setCeiling] = useState(DEFAULT_PASS_CEILING);
  const active = campaign.status === "active";
  const run = campaign.lastRun;
  const pool = campaign.pool;
  const open = campaign.openBatch;
  const input = "h-[34px] w-[72px] rounded-lg border border-[var(--border-strong)] bg-card px-2.5 text-sm font-normal";
  const idPrefix = `recycle-${campaign.campaign_id}`;
  const angleOk = angle.trim().length >= 3;
  const startBlocked = !batchesReady ? "Batches need a database update that has not been applied yet."
    : open ? "This campaign already has a batch being screened."
    : campaign.rule.max_recycles === 0 ? "The recycle cap is 0."
    : campaign.eligibleNow === 0 ? "Nothing in this campaign meets the rule yet."
    : "";
  const resume = open ? canContinue(open, viewer) : null;
  const live = progress?.campaignId === campaign.campaign_id ? progress : null;
  const saidNoAllowed = campaign.rule.allowed_dispositions.includes("not_interested");
  const notPicked = pool ? [
    pool.capped ? `${count(pool.capped)} at the recycle cap` : "",
    pool.outcomeNotInRule ? `${count(pool.outcomeNotInRule)} with an outcome this rule does not recycle` : "",
    pool.ownerOnly ? `${count(pool.ownerOnly)} said no — an owner can recycle ${pool.ownerOnly === 1 ? "it" : "them"}` : "",
    pool.resting ? `${count(pool.resting)} resting until a set date` : "",
    pool.live ? `${count(pool.live)} already back in the dialer` : "",
    pool.beingWorked ? `${count(pool.beingWorked)} with an agent or a live transfer` : "",
    pool.pending ? `${count(pool.pending)} waiting in a batch` : "",
    pool.noPhone ? `${count(pool.noPhone)} with no phone` : "",
  ].filter(Boolean) : [];

  return (
    <section className="rounded-lg border border-border bg-card p-6 shadow-[0_1px_2px_rgba(16,20,26,.05)]" aria-labelledby={`rule-${campaign.campaign_id}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id={`rule-${campaign.campaign_id}`} className="text-lg font-semibold leading-[1.28] tracking-[-0.015em]">{campaign.campaign_name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{count(campaign.eligible_count)} in nurture or exhausted · {count(campaign.reactivated_count)} recycled so far · scrub {campaign.scrub_status.replaceAll("_", " ")}</p>
        </div>
        <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold", active ? "bg-[var(--success-surface)] text-[var(--success-ink)]" : "bg-[var(--surface-alt)] text-[var(--body)]")}>
          <span className={cn("size-1.5 rounded-full", active ? "bg-[var(--success)]" : "bg-[var(--muted-foreground)]")} aria-hidden="true" />{label(campaign.status)}
        </span>
      </div>

      <div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
        <Fact label="Age threshold">
          <label className="inline-flex items-center gap-2"><input type="number" min={1} max={3650} aria-label={`${campaign.campaign_name}: days rested since the last dial before recycling`} value={campaign.rule.wait_days} disabled={readOnly || busy} onChange={(event) => onChange({ wait_days: Number(event.target.value) })} className={input} />days since the last dial</label>
        </Fact>
        <Fact label="Recycle cap">
          <label className="inline-flex items-center gap-2"><input type="number" min={0} max={100} aria-label={`${campaign.campaign_name}: most times one lead is recycled`} value={campaign.rule.max_recycles} disabled={readOnly || busy} onChange={(event) => onChange({ max_recycles: Number(event.target.value) })} className={input} />per lead</label>
        </Fact>
        <Fact label="Recycles after">
          <span className="flex flex-wrap gap-x-3 gap-y-1">
            {OPTIONS.map((option) => {
              const checked = campaign.rule.allowed_dispositions.includes(option);
              return (
                <label key={option} className="inline-flex items-center gap-1.5 font-normal" title={option === "not_interested" ? `Recycled by an owner only, and only ${SAID_NO_MIN_DAYS}+ days after the outcome` : undefined}>
                  <input type="checkbox" checked={checked} disabled={readOnly || busy} onChange={(event) => onChange({ allowed_dispositions: event.target.checked ? [...campaign.rule.allowed_dispositions, option] : campaign.rule.allowed_dispositions.filter((value) => value !== option) })} className="size-4 accent-[var(--primary)]" />
                  {label(option)}{option === "not_interested" ? ` (owners, ${SAID_NO_MIN_DAYS}+ days)` : ""}
                </label>
              );
            })}
          </span>
        </Fact>
        <Fact label="Never included">Do not call · litigator · complaint · any suppression hit</Fact>
      </div>

      <div className="mt-4 rounded-lg border border-border border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-4 py-3.5">
        <div className="text-sm font-semibold text-[var(--info-ink)]">What will happen when you run this</div>
        <div className="mt-3 flex flex-wrap gap-7">
          <Figure value={campaign.eligibleNow} tone="neutral">eligible now — each re-screened as it runs</Figure>
          {pool && <Figure value={pool.tooRecent} tone="neutral">excluded as too recent — rested under {plural(campaign.rule.wait_days, "day")}{saidNoAllowed ? ` (${SAID_NO_MIN_DAYS} for said no)` : ""}</Figure>}
          {pool && <Figure value={pool.never} tone="danger">never recyclable — do not call, litigator, complaint or a suppression hit</Figure>}
          {run && (
            <>
              <Figure value={run.cleared} tone="good">cleared — last run, {stamp(run.at)}</Figure>
              <Figure value={run.blocked} tone="danger">blocked — suppressed <em>now</em></Figure>
              <Figure value={run.failed} tone="warning">held — the screening did not complete</Figure>
            </>
          )}
        </div>
        {pool && (
          <p className="mt-3 text-xs leading-normal text-[var(--body)]">
            Of this campaign&apos;s worked leads: {plural(pool.exhaustedNoOutcome, "exhausted lead")} never reached, {plural(pool.saidNo, "said no", "said no")}{pool.eligibleSaidNo ? ` (${count(pool.eligibleSaidNo)} of them eligible now)` : ""}.{notPicked.length ? ` Not picked up: ${notPicked.join(" · ")}.` : ""}
          </p>
        )}
        <p className="mt-3 text-xs leading-normal text-[var(--body)]">
          {run ? "" : "This rule has not run yet. "}Blocked and held are different facts and are never collapsed into one total. A held lead stays where it was and can go in a later batch; nothing else in the campaign stops. A lead that cleared six months ago may be on the registry today, which is the entire reason recycling re-screens rather than trusting the import — and a lead is not back in the dialer until its own screening clears.
        </p>
      </div>

      {live ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-4 py-3" role="status">
          <RefreshCw className="size-4 animate-spin text-[var(--info-ink)]" aria-hidden="true" />
          <span className="min-w-0 flex-grow text-sm leading-normal text-[var(--body)]"><span className="font-semibold text-[var(--info-ink)]">Screening</span> · {count(live.screened)} screened this session · {count(live.cleared)} cleared · {count(live.blocked)} blocked · {count(live.failed)} held{live.pending ? ` · ${count(live.pending)} to go` : ""}. Leaving the page pauses it; nothing is lost.</span>
        </div>
      ) : open ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3">
          <div className="min-w-0 flex-grow text-sm leading-normal">
            <span className="font-semibold text-[var(--warning-ink)]">Batch being screened</span>
            <span className="text-[var(--body)]"> · “{open.angle}” · {count(open.queued - open.pending)} of {count(open.queued)} screened · {count(open.cleared)} cleared · {count(open.blocked)} blocked · {count(open.failed)} held · started by {open.createdByName ?? "a teammate"} {stamp(open.createdAt)}{open.stalled ? ` · no progress for ${STALLED_MINUTES}+ minutes` : ""}</span>
          </div>
          {resume && !resume.ok && <span className="text-xs text-[var(--body)]">{resume.reason}</span>}
          <Button type="button" variant="outline" className="h-10 border-[var(--border-strong)] px-4" disabled={readOnly || busy || !resume?.ok} title={resume?.reason || undefined} onClick={() => onResume(open)}>{open.stalled && open.createdBy !== viewer.userId ? "Resume batch" : "Continue screening"}</Button>
        </div>
      ) : null}

      {confirming ? (
        <div className="mt-4 rounded-lg border border-border bg-[var(--canvas)] p-4">
          <div className="text-sm font-semibold">New batch</div>
          <p className="mt-1 text-xs leading-normal text-[var(--body)]">A recycled lead keeps its history and its campaign. Up to {plural(campaign.eligibleNow, "lead")} will be screened again before any of them is dialable.</p>
          <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex min-w-0 flex-col gap-3">
              <label htmlFor={`${idPrefix}-angle`} className="text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">The new angle — required</label>
              <textarea id={`${idPrefix}-angle`} value={angle} maxLength={ANGLE_MAX} rows={2} onChange={(event) => setAngle(event.target.value)} placeholder="What is different this time — a new carrier, a lower premium, a different product" className="w-full rounded-lg border border-[var(--border-strong)] bg-card px-3 py-2 text-sm" />
              <span className="text-xs leading-normal text-[var(--body)]">Calling the same person with the same offer tests the same hypothesis twice. The agent sees this angle on the lead&apos;s Nurture tab.</span>
              <label htmlFor={`${idPrefix}-script`} className="text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">Script — optional</label>
              <textarea id={`${idPrefix}-script`} value={script} maxLength={SCRIPT_MAX} rows={3} onChange={(event) => setScript(event.target.value)} className="w-full rounded-lg border border-[var(--border-strong)] bg-card px-3 py-2 text-sm" />
            </div>
            <div className="flex flex-col gap-4">
              <Fact label="Attempts this pass">
                <label className="inline-flex items-center gap-2"><input type="number" min={1} max={MAX_PASS_CEILING} aria-label={`${campaign.campaign_name}: dials each recycled lead gets on this pass`} value={ceiling} onChange={(event) => setCeiling(Number(event.target.value))} className={input} />of {MAX_PASS_CEILING}</label>
              </Fact>
              <Fact label="Cost to attribute">$0.00 — already paid for</Fact>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
            <span className="text-sm text-[var(--body)]">{count(campaign.eligibleNow)} match{pool ? ` · ${count(pool.tooRecent)} excluded as too recent` : ""}</span>
            <Button type="button" variant="outline" className="h-10 border-[var(--border-strong)] px-4" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button type="button" className="h-10 px-4" disabled={busy || !angleOk || !Number.isInteger(ceiling) || ceiling < 1 || ceiling > MAX_PASS_CEILING} title={angleOk ? undefined : "The angle is required"} onClick={() => { setConfirming(false); onStart({ angle, script, attemptCeiling: ceiling }); }}>{busy ? "Starting…" : "Scrub and create"}</Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          {startBlocked && !readOnly && <span className="text-xs text-[var(--body)]">{startBlocked}</span>}
          <Button type="button" variant="outline" className="h-10 border-[var(--border-strong)] px-4" disabled={readOnly || busy} onClick={onSave}>{busy && !live ? "Saving…" : "Save rule"}</Button>
          <Button type="button" className="h-10 px-4" disabled={readOnly || busy || Boolean(startBlocked)} title={startBlocked || undefined} onClick={() => setConfirming(true)}>Build a recycle batch</Button>
        </div>
      )}
    </section>
  );
}

const SLOT_LOOK: Record<RotationSlot["state"], string> = {
  failed: "border-[var(--error)] bg-[var(--error-surface)] [&>div:first-child]:text-[var(--error-ink)]",
  answered: "border-[var(--success)] bg-[var(--success-surface)] [&>div:first-child]:text-[var(--success-ink)]",
  next: "border-[var(--primary)] bg-[var(--soft-orange-surface)] [&>div:first-child]:text-[var(--accent-ink)]",
  untried: "border-border bg-card [&>div:first-child]:text-[var(--body)]",
};

function PastBatches({ batches, baseline }: { batches: RecycleBatch[]; baseline: number | null }) {
  const head = "px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground";
  const cell = "px-4 py-2.5 align-top text-sm";
  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgba(16,20,26,.05)]" aria-labelledby="past-batches">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-[var(--surface-alt)] px-4 py-3">
        <h2 id="past-batches" className="text-sm font-semibold leading-normal tracking-[-0.02em]">Past batches</h2>
        <span className="text-xs text-muted-foreground">Contact rate against the {percent(baseline)} fresh leads got over the same span</span>
      </div>
      {batches.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={head}>Angle</th>
                <th scope="col" className={head}>Leads</th>
                <th scope="col" className={cn(head, "text-right")}>Dials</th>
                <th scope="col" className={cn(head, "text-right")}>Contacts</th>
                <th scope="col" className={cn(head, "text-right")}>Rate</th>
                <th scope="col" className={cn(head, "text-right")}>Policies</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => {
                const better = batch.contactRate != null && baseline != null ? batch.contactRate >= baseline : null;
                return (
                  <tr key={batch.id} className="m-row border-t border-border first:border-t-0">
                    <td className={cell}>
                      <div className="font-semibold">{batch.angle}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{batch.campaignName} · {stamp(batch.createdAt)}{batch.createdByName ? ` · ${batch.createdByName}` : ""} · {batch.attemptCeiling} {batch.attemptCeiling === 1 ? "dial" : "dials"} a lead{batch.status === "screening" ? " · still screening" : ""}</div>
                    </td>
                    <td className={cn(cell, "tabular-nums")}>
                      {count(batch.cleared)} cleared
                      <div className="text-xs text-muted-foreground">{count(batch.blocked)} blocked · {count(batch.failed)} held{batch.pending ? ` · ${count(batch.pending)} waiting` : ""}</div>
                    </td>
                    <td className={cn(cell, "text-right tabular-nums")}>{count(batch.dials)}</td>
                    <td className={cn(cell, "text-right tabular-nums")}>{count(batch.contacts)}<div className="text-xs text-muted-foreground">{plural(batch.leadsReached, "lead")} reached</div></td>
                    <td className={cn(cell, "text-right font-semibold tabular-nums", better === true && "text-[var(--success-ink)]", better === false && "text-[var(--error-ink)]")}>{percent(batch.contactRate)}</td>
                    <td className={cn(cell, "text-right tabular-nums")}>{count(batch.policies)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-6 text-sm text-muted-foreground">No batch has run yet. The first one appears here with its angle, and what it reached.</p>
      )}
      <div className="border-t border-border bg-[var(--canvas)] px-4 py-3 text-xs leading-normal text-[var(--body)]">
        The rate is contacts per dial, the same measure as the fresh rate beside it. Policies are those marked issued after the lead was recycled. Comparing angles is the point of recording one: a batch with nothing new to say is the one to stop repeating.
      </div>
    </section>
  );
}

export function NurtureWorkspace() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [openIdle, setOpenIdle] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/app/nurture", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setData(body);
    } catch (error) {
      notify.fail(error instanceof Error ? error.message : "Could not load nurture");
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  function update(id: string, change: Partial<NurtureCampaignReport["rule"]>) {
    setData((current) => current && { ...current, campaigns: current.campaigns.map((item) => item.campaign_id === id ? { ...item, rule: { ...item.rule, ...change } } : item) });
  }

  async function post(payload: Record<string, unknown>) {
    const response = await fetch("/api/app/nurture", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? "The request failed");
    return body;
  }

  async function save(campaign: NurtureCampaignReport) {
    setSaving(campaign.campaign_id);
    try {
      await post({ action: "save_rule", campaign_id: campaign.campaign_id, wait_days: campaign.rule.wait_days, allowed_dispositions: campaign.rule.allowed_dispositions, max_recycles: campaign.rule.max_recycles });
      notify.done("Recycle rule saved");
      await load();
    } catch (error) {
      notify.fail(error instanceof Error ? error.message : "Could not save rule");
    } finally {
      setSaving(null);
    }
  }

  /** Screens a batch a chunk at a time until nothing is pending. Stopping midway loses nothing. */
  async function screen(batchId: string, campaignId: string) {
    const totals: Progress = { batchId, campaignId, screened: 0, cleared: 0, blocked: 0, failed: 0, pending: 0 };
    setProgress({ ...totals });
    try {
      for (;;) {
        const step = await post({ action: "screen_chunk", batch_id: batchId }) as { done: boolean; screened: number; cleared: number; blocked: number; failed: number; pending: number; busyElsewhere: boolean };
        totals.screened += step.screened; totals.cleared += step.cleared; totals.blocked += step.blocked; totals.failed += step.failed; totals.pending = step.pending;
        setProgress({ ...totals });
        if (step.done) { notify.done(`${count(totals.cleared)} cleared and back in the dialer, ${count(totals.blocked)} blocked, ${count(totals.failed)} held`); break; }
        if (step.busyElsewhere) { notify.fail("The rest of this batch is being screened in another session. It will finish there."); break; }
      }
    } catch (error) {
      notify.fail(`${error instanceof Error ? error.message : "Screening stopped"} — the batch keeps its progress; continue it from this card.`);
    } finally {
      setProgress(null);
      await load();
    }
  }

  async function start(campaign: NurtureCampaignReport, input: { angle: string; script: string; attemptCeiling: number }) {
    setSaving(campaign.campaign_id);
    let batchId: string | null = null;
    try {
      const body = await post({ action: "start_batch", campaign_id: campaign.campaign_id, angle: input.angle, script: input.script.trim() || null, attempt_ceiling: input.attemptCeiling });
      batchId = String(body.batchId);
      notify.done(`${count(Number(body.queued ?? 0))} leads queued for screening`);
    } catch (error) {
      notify.fail(error instanceof Error ? error.message : "Could not start the batch");
    } finally {
      setSaving(null);
    }
    if (batchId) await screen(batchId, campaign.campaign_id);
  }

  const header = (
    <PageHeader
      eyebrow={sectionForPath("/app/nurture") ?? undefined}
      title="Lead recycling"
      description="Aged leads back in the queue — with a new angle, a fresh scrub, and a cap."
    />
  );

  if (!data) {
    return (
      <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
        {header}
        <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-card py-16 text-sm text-muted-foreground">
          {loading ? <><RefreshCw className="size-4 animate-spin" aria-hidden="true" />Loading nurture campaigns…</> : <>Could not load nurture. <Button variant="outline" size="sm" onClick={() => void load()}>Try again</Button></>}
        </div>
      </div>
    );
  }

  const { totals, campaigns, cadence, rotation, contactRate, pool, recycledAllTime, batches, batchBaseline, viewer, batchesReady } = data;
  const readOnly = Boolean(data.readOnly);
  const working = campaigns.filter((campaign) => campaign.eligible_count > 0 || campaign.reactivated_count > 0 || campaign.lastRun || campaign.openBatch || (campaign.pool?.saidNo ?? 0) > 0);
  const idle = campaigns.filter((campaign) => !working.includes(campaign));
  const change = totals.recycledLastMonth > 0 ? Math.round(((totals.recycledThisMonth - totals.recycledLastMonth) / totals.recycledLastMonth) * 100) : null;
  const lastMonthName = MONTHS[(new Date().getMonth() + 11) % 12];
  const card = (campaign: NurtureCampaignReport) => (
    <RuleCard
      campaign={campaign}
      readOnly={readOnly}
      busy={saving === campaign.campaign_id || progress?.campaignId === campaign.campaign_id}
      batchesReady={batchesReady}
      viewer={viewer}
      progress={progress}
      onChange={(next) => update(campaign.campaign_id, next)}
      onSave={() => void save(campaign)}
      onStart={(input) => void start(campaign, input)}
      onResume={(batch) => void screen(batch.id, campaign.campaign_id)}
    />
  );

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {header}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile label="In nurture" value={count(totals.inNurture)} footnote={`across ${campaigns.length} ${campaigns.length === 1 ? "rule" : "rules"}`} />
        <StatTile label="Eligible today" value={count(totals.eligibleNow)} footnote={pool ? `after caps, before the fresh scrub · ${count(pool.tooRecent)} too recent` : "after caps, before the fresh scrub"} />
        <StatTile label="Recycled this month" value={count(totals.recycledThisMonth)} valueTone={totals.recycledThisMonth > 0 ? "good" : undefined} footnote={change == null ? `none in ${lastMonthName}` : `${change >= 0 ? "+" : "−"}${Math.abs(change)}% vs ${lastMonthName}`} />
        <StatTile label="Blocked on re-screening" value={count(totals.blockedThisMonth)} valueTone={totals.blockedThisMonth > 0 ? "danger" : undefined} footnote="cleared at import, suppressed now" />
        <StatTile
          label="Recycled contact rate"
          value={contactRate?.recycled == null ? "—" : `${contactRate.recycled.toFixed(1)}%`}
          valueTone={contactRate?.recycled == null ? undefined : "primary"}
          footnote={contactRate?.fresh == null ? "no fresh dials to compare" : `vs ${contactRate.fresh.toFixed(1)}% fresh`}
          action={<Link href="/app/activity" className="text-xs font-semibold text-foreground hover:underline">Scorecard</Link>}
        />
      </div>

      {/* The concept board's source pools, one line: where every worked lead stands. */}
      {pool && recycledAllTime ? (
        <section className="flex flex-wrap gap-x-9 gap-y-4 rounded-lg border border-border bg-card px-6 py-4 shadow-[0_1px_2px_rgba(16,20,26,.05)]" aria-label="Recycling pool">
          <Figure value={pool.exhaustedNoOutcome} tone="neutral">exhausted, never reached — every dial used</Figure>
          <Figure value={pool.saidNo} tone="neutral">reached, said no — owners only, {SAID_NO_MIN_DAYS}+ days after</Figure>
          <Figure value={pool.never} tone="danger">never recyclable — do not call, litigator, complaint or a suppression hit</Figure>
          <Figure value={recycledAllTime.recycled} tone="good">recycled so far — {percent(recycledAllTime.contactRate)} contact · {plural(recycledAllTime.policies, "policy", "policies")}</Figure>
        </section>
      ) : (
        !batchesReady && (
          <p className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--body)]">
            Batches, the recycling pool and past batches need a database update that has not been applied yet. Rules can still be saved.
          </p>
        )
      )}

      <div className="flex flex-col gap-5">
        {working.map((campaign) => <div key={campaign.campaign_id}>{card(campaign)}</div>)}
        {/* A campaign with nothing in nurture and nothing ever recycled has no run to preview; a full
            card for each would bury the ones that do. They stay one line each, and open to the same
            rule card when someone wants to set the rule ahead of time. */}
        {idle.length > 0 && (
          <section className="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgba(16,20,26,.05)]">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-[var(--surface-alt)] px-4 py-3">
              <h2 className="text-sm font-semibold leading-normal tracking-[-0.02em]">{working.length ? "Nothing in nurture yet" : "No campaign has anything in nurture yet"}</h2>
              <span className="text-xs text-muted-foreground">{idle.length} {idle.length === 1 ? "campaign" : "campaigns"} · the rule applies once leads exhaust their cadence</span>
            </div>
            {idle.map((campaign) => (
              <div key={campaign.campaign_id} className="border-t border-border first:border-t-0">
                <div className="m-row flex flex-wrap items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-grow truncate text-sm font-semibold">{campaign.campaign_name}</span>
                  <span className="text-xs text-muted-foreground">after {campaign.rule.wait_days} days · up to {campaign.rule.max_recycles} per lead · {campaign.rule.allowed_dispositions.map(label).join(", ") || "no outcomes chosen"}</span>
                  <span className="inline-flex rounded-full bg-[var(--surface-alt)] px-2.5 py-[3px] text-xs font-semibold text-[var(--body)]">{label(campaign.status)}</span>
                  <Button type="button" variant="outline" size="sm" className="h-8 border-[var(--border-strong)] px-3" aria-expanded={openIdle === campaign.campaign_id} onClick={() => setOpenIdle((current) => (current === campaign.campaign_id ? null : campaign.campaign_id))}>{openIdle === campaign.campaign_id ? "Close" : "Edit rule"}</Button>
                </div>
                {openIdle === campaign.campaign_id && (
                  <div className="border-t border-border bg-[var(--canvas)] p-3">{card(campaign)}</div>
                )}
              </div>
            ))}
          </section>
        )}
        {!campaigns.length && (
          <section className="rounded-lg border border-border bg-card py-12 text-center">
            <ShieldCheck className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 font-semibold">No campaigns are configured yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">Create a campaign under Vendors &amp; campaigns before setting a recycle rule.</p>
          </section>
        )}
      </div>

      <div className="flex flex-col gap-6 xl:flex-row">
        <div className="flex min-w-0 flex-grow flex-col gap-6">
          <section className="flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgba(16,20,26,.05)]">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-[var(--surface-alt)] px-4 py-3">
              <h2 className="text-sm font-semibold leading-normal tracking-[-0.02em]">Retry cadence</h2>
              <span className="flex items-center gap-2.5">
                {cadence && <span className="inline-flex whitespace-nowrap rounded-full bg-[var(--soft-orange-surface)] px-2.5 py-[3px] text-xs font-semibold text-[var(--accent-ink)]">{cadence.first72} of {cadence.total} inside 72 hours</span>}
                <Button asChild variant="outline" size="sm" className="h-8 border-[var(--border-strong)] px-4"><Link href="/app/settings#cadence">Edit cadence</Link></Button>
              </span>
            </div>
            {cadence ? (
              cadence.steps.map((step) => (
                <div key={step.attempt} className={cn("m-row flex flex-wrap items-center gap-3.5 border-t border-border px-4 py-2.5 first:border-t-0", step.offsetMs <= 72 * 3_600_000 && "bg-[var(--soft-orange-surface)]")}>
                  <span className="inline-flex size-[22px] items-center justify-center rounded-full bg-[var(--surface-alt)] text-xs font-semibold tabular-nums">{step.attempt}</span>
                  <span className="inline-flex h-[34px] w-[110px] items-center rounded-lg border border-[var(--border-strong)] bg-card px-2.5 text-sm">{step.interval ? `+${step.interval}` : "immediately"}</span>
                  <span className="w-[180px] text-sm text-[var(--body)]">{step.attempt === 1 ? "on import" : step.slot ? PREFERRED[step.slot] ?? step.slot : "a slot not yet tried"}</span>
                  <span className="flex-grow text-xs text-muted-foreground">{offset(step.offsetMs)}{step.attempt === cadence.total ? " · then exhausted" : ""}</span>
                </div>
              ))
            ) : (
              <p className="px-4 py-6 text-sm text-muted-foreground">The cadence could not be read.</p>
            )}
            <div className="border-t border-border bg-[var(--canvas)] px-4 py-3 text-xs leading-normal text-[var(--body)]">
              {cadence?.usingDefaults ? "No cadence is saved, so this is the dialer's built-in schedule. " : ""}Most contacts happen in the first three days, so the attempts live there rather than spread over a fortnight. A recycled lead walks the same ladder from the first rung but stops at its batch&apos;s attempts this pass (default {DEFAULT_PASS_CEILING}). Attempts are added and removed under Settings › Dialing cadence, and an interval that is not a real interval is refused — not stored as text.
            </div>
          </section>

          <PastBatches batches={batches} baseline={batchBaseline} />
        </div>

        <div className="flex w-full shrink-0 flex-col gap-6 xl:w-[520px]">
          <section className="rounded-lg border border-border bg-card p-6 shadow-[0_1px_2px_rgba(16,20,26,.05)]">
            <h2 className="text-lg font-semibold leading-[1.28] tracking-[-0.015em]">Slot rotation</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {rotation ? <><Link href={`/app/leads/${rotation.leadId}`} className="hover:underline">{rotation.leadName}</Link> · attempt {rotation.attempt} of {rotation.ceiling}</> : "No lead is mid-cadence right now"}
            </p>
            {rotation && (
              <div className="mt-4 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                {rotation.slots.map((slot) => (
                  <div key={slot.slot} className={cn("rounded-lg border px-2 py-2.5 text-center", SLOT_LOOK[slot.state])}>
                    <div className="text-xs font-semibold">{SLOT_HOURS[slot.slot] ?? slot.slot}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{slot.note}</div>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3.5 text-sm leading-normal text-[var(--body)]">
              Calling the same person at 10am four days running tests one hypothesis four times. Morning, lunchtime, evening, Saturday tests four. <strong>A lead is not retried into a slot it has already failed in while an untried slot is left</strong>; once every slot has been tried, the one tried longest ago comes next.
            </p>
          </section>

          <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
            <p className="font-semibold text-[var(--info-ink)]">How a recycled lead is counted</p>
            <p className="mt-1.5 text-[var(--body)]">An aged lead recycled six months later is the same person: <strong>one lead, with its history and its campaign</strong>, because the attempt history is what makes slot rotation work. The batch records the angle and a $0 cost — the lead was paid for when it was bought — so recycling never adds spend to the campaign, and a policy it produces is counted once.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
