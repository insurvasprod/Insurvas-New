"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { DetailPanel } from "@/components/ui/detail-panel";
import type { NurtureCampaignReport, NurtureReport, RotationSlot } from "@/lib/nurture/report";
import { ANGLE_MAX, DEFAULT_PASS_CEILING, MAX_PASS_CEILING, SAID_NO_MIN_DAYS, SCRIPT_MAX, STALLED_MINUTES, type RecycleBatch } from "@/lib/nurture/contract";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, ErrorState } from "@/components/ui/page-states";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { Pager, paginate } from "@/components/ui/pager";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs, fullHeightCard, useFittingPageSize } from "@/components/app/lead-ops-view-tabs";
import { RefreshButton } from "@/components/ui/data-toolbar";
import { NextStepLine } from "@/components/app/next-step-line";
import { cn } from "@/lib/utils";

/**
 * Lead recycling (redesign 2026-10-26, owner pick A, canvas M2 · Assignment): the campaigns in one table,
 * the one you pick open beside it with its rule, who is in its pool, the last run and the batch builder —
 * no pop-up. A "Next step" line names the campaign with leads ready. Fresh against recycled (this month,
 * and conversion all time) moved here from Activity; it sits with the past batches.
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
const INPUT = "h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm font-normal";
const FIELD_LABEL = "text-xs font-semibold text-muted-foreground";

function stamp(iso: string) { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
function offset(ms: number) {
  if (ms === 0) return "day 0";
  const hours = Math.round(ms / 3_600_000);
  return hours < 48 ? `${hours}h after the first dial` : `day ${Math.round(hours / 24)}`;
}

function Figure({ value, tone, children }: { value: number | string; tone: "good" | "danger" | "warning" | "neutral"; children: React.ReactNode }) {
  const ink = { good: "text-[var(--success-ink)]", danger: "text-[var(--error-ink)]", warning: "text-[var(--warning-ink)]", neutral: "text-foreground" }[tone];
  return (
    <span className="min-w-0">
      <span className={cn("block text-xl font-semibold leading-[1.21] tracking-[-0.02em] tabular-nums", ink)}>{typeof value === "number" ? count(value) : value}</span>
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

/** Why a campaign can't start a batch now, or "" when it can. */
function startBlockedFor(campaign: NurtureCampaignReport, batchesReady: boolean) {
  return !batchesReady ? "Batches need a database update that has not been applied yet."
    : campaign.openBatch ? "This campaign already has a batch being screened."
    : campaign.rule.max_recycles === 0 ? "The recycle cap is 0."
    : campaign.eligibleNow === 0 ? "Nothing in this campaign meets the rule yet."
    : "";
}

/** One campaign's rule, opened beside the table: the rule, its pool, the last run, and the batch builder. */
function RulePanel({ campaign, readOnly, busy, batchesReady, viewer, progress, building, onBuilding, onChange, onSave, onStart, onResume, onClose }: {
  campaign: NurtureCampaignReport;
  readOnly: boolean;
  busy: boolean;
  batchesReady: boolean;
  viewer: NurtureReport["viewer"];
  progress: Progress | null;
  building: boolean;
  onBuilding: (next: boolean) => void;
  onChange: (change: Partial<NurtureCampaignReport["rule"]>) => void;
  onSave: () => void;
  onStart: (input: { angle: string; script: string; attemptCeiling: number }) => void;
  onResume: (batch: RecycleBatch) => void;
  onClose: () => void;
}) {
  const [angle, setAngle] = useState("");
  const [script, setScript] = useState("");
  const [ceiling, setCeiling] = useState(DEFAULT_PASS_CEILING);
  const active = campaign.status === "active";
  const run = campaign.lastRun;
  const pool = campaign.pool;
  const open = campaign.openBatch;
  const idPrefix = `recycle-${campaign.campaign_id}`;
  const angleOk = angle.trim().length >= 3;
  const startBlocked = startBlockedFor(campaign, batchesReady);
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

  const status = (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold", active ? "bg-[var(--success-surface)] text-[var(--success-ink)]" : "bg-[var(--surface-alt)] text-[var(--body)]")}>
      <span className={cn("size-1.5 rounded-full", active ? "bg-[var(--success)]" : "bg-[var(--muted-foreground)]")} aria-hidden="true" />{label(campaign.status)}
    </span>
  );

  // Building a batch replaces the rule in the panel; starting still asks for the angle first, because a
  // cleared lead goes back to the dialer.
  if (building) {
    return (
      <DetailPanel
        mode="split"
        title="Build a recycle batch"
        subtitle={`${campaign.campaign_name} · ${count(campaign.eligibleNow)} match${pool ? ` · ${count(pool.tooRecent)} left out as too recent` : ""}`}
        onClose={() => onBuilding(false)}
        closeLabel="Back to the rule"
        className="m-glass lg:sticky lg:top-[calc(var(--top-bar-h)+16px)] lg:max-h-[calc(100dvh-var(--top-bar-h)-32px)] lg:self-start"
        footer={(
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onBuilding(false)}>Cancel</Button>
            <Button type="button" disabled={busy || !angleOk || !Number.isInteger(ceiling) || ceiling < 1 || ceiling > MAX_PASS_CEILING} title={angleOk ? undefined : "The angle is required"} onClick={() => { onBuilding(false); onStart({ angle, script, attemptCeiling: ceiling }); }}>{busy ? "Starting…" : "Scrub and create"}</Button>
          </div>
        )}
      >
        <label htmlFor={`${idPrefix}-angle`} className={FIELD_LABEL}>The new angle — required</label>
        <textarea id={`${idPrefix}-angle`} value={angle} maxLength={ANGLE_MAX} rows={2} onChange={(event) => setAngle(event.target.value)} placeholder="What is different this time — a new carrier, a lower premium, a different product" className="-mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
        <label htmlFor={`${idPrefix}-script`} className={FIELD_LABEL}>Script — optional</label>
        <textarea id={`${idPrefix}-script`} value={script} maxLength={SCRIPT_MAX} rows={3} onChange={(event) => setScript(event.target.value)} className="-mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5"><span className={FIELD_LABEL}>Attempts this pass (1–{MAX_PASS_CEILING})</span><input type="number" min={1} max={MAX_PASS_CEILING} aria-label={`${campaign.campaign_name}: dials each recycled lead gets on this pass`} value={ceiling} onChange={(event) => setCeiling(Number(event.target.value))} className={INPUT} /></label>
          <span className="flex flex-col gap-1.5"><span className={FIELD_LABEL}>Cost to attribute</span><span className="text-sm font-semibold">$0.00 — already paid for</span></span>
        </div>
        <p className="m-0 rounded-lg bg-[var(--surface-alt)] px-3 py-2.5 text-xs leading-normal text-[var(--body)]">Every lead is screened against do-not-call and suppression again before it can be dialled. A batch keeps its progress if you close the tab.</p>
      </DetailPanel>
    );
  }

  return (
    <DetailPanel
      mode="split"
      title={campaign.campaign_name}
      subtitle={`${count(campaign.eligibleNow)} ready now · ${count(campaign.eligible_count)} in nurture or exhausted · ${count(campaign.reactivated_count)} recycled so far · scrub ${campaign.scrub_status.replaceAll("_", " ")}`}
      status={status}
      onClose={onClose}
      className="m-glass lg:sticky lg:top-[calc(var(--top-bar-h)+16px)] lg:max-h-[calc(100dvh-var(--top-bar-h)-32px)] lg:self-start"
      footer={(
        <div className="flex flex-col gap-2">
          {startBlocked && !readOnly && <span className="text-xs text-[var(--body)]">{startBlocked}</span>}
          <div className="flex items-center justify-between gap-2">
            <Button type="button" variant="outline" disabled={readOnly || busy} onClick={onSave}>{busy && !live ? "Saving…" : "Save rule"}</Button>
            <Button type="button" disabled={readOnly || busy || Boolean(startBlocked)} title={startBlocked || undefined} onClick={() => onBuilding(true)}>Build a recycle batch</Button>
          </div>
        </div>
      )}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5"><span className={FIELD_LABEL}>Rests (days since the last dial)</span><input type="number" min={1} max={3650} aria-label={`${campaign.campaign_name}: days rested since the last dial before recycling`} value={campaign.rule.wait_days} disabled={readOnly || busy} onChange={(event) => onChange({ wait_days: Number(event.target.value) })} className={INPUT} /></label>
        <label className="flex flex-col gap-1.5"><span className={FIELD_LABEL}>Recycle at most (per lead)</span><input type="number" min={0} max={100} aria-label={`${campaign.campaign_name}: most times one lead is recycled`} value={campaign.rule.max_recycles} disabled={readOnly || busy} onChange={(event) => onChange({ max_recycles: Number(event.target.value) })} className={INPUT} /></label>
      </div>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className={cn(FIELD_LABEL, "mb-2")}>Recycles after</legend>
        {OPTIONS.map((option) => {
          const checked = campaign.rule.allowed_dispositions.includes(option);
          return (
            <label key={option} className="inline-flex items-center gap-2 text-sm font-normal" title={option === "not_interested" ? `Recycled by an owner only, and only ${SAID_NO_MIN_DAYS}+ days after the outcome` : undefined}>
              <input type="checkbox" checked={checked} disabled={readOnly || busy} onChange={(event) => onChange({ allowed_dispositions: event.target.checked ? [...campaign.rule.allowed_dispositions, option] : campaign.rule.allowed_dispositions.filter((value) => value !== option) })} className="size-4 accent-[var(--primary)]" />
              {label(option)}{option === "not_interested" ? ` · owners, ${SAID_NO_MIN_DAYS}+ days` : ""}
            </label>
          );
        })}
      </fieldset>
      <p className="m-0 text-xs text-muted-foreground">Never included: do not call · litigator · complaint · any suppression hit</p>

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <div className="grid grid-cols-3 gap-3">
          <Figure value={campaign.eligibleNow} tone="neutral">eligible now</Figure>
          {pool && <Figure value={pool.tooRecent} tone="neutral">too recent — under {plural(campaign.rule.wait_days, "day")}{saidNoAllowed ? ` (${SAID_NO_MIN_DAYS} for said no)` : ""}</Figure>}
          {pool && <Figure value={pool.never} tone="danger">never recyclable</Figure>}
        </div>
        {pool && (
          <p className="m-0 text-xs leading-normal text-[var(--body)]">
            <span className="font-semibold text-[var(--ink)]">Who is in the pool: </span>{plural(pool.exhaustedNoOutcome, "exhausted lead")} never reached, {plural(pool.saidNo, "said no", "said no")}{pool.eligibleSaidNo ? ` (${count(pool.eligibleSaidNo)} of them eligible now)` : ""}.{notPicked.length ? ` Not picked up: ${notPicked.join(" · ")}.` : ""}
          </p>
        )}
        {run && (
          <div className="grid grid-cols-3 gap-3">
            <Figure value={run.cleared} tone="good">cleared — last run, {stamp(run.at)}</Figure>
            <Figure value={run.blocked} tone="danger">blocked on re-screening</Figure>
            <Figure value={run.failed} tone="warning">held — screening did not complete</Figure>
          </div>
        )}
      </div>

      {live ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-4 py-3" role="status">
          <RefreshCw className="size-4 animate-spin text-[var(--info-ink)]" aria-hidden="true" />
          <span className="min-w-0 flex-grow text-sm leading-normal text-[var(--body)]"><span className="font-semibold text-[var(--info-ink)]">Screening</span> · {count(live.screened)} screened this session · {count(live.cleared)} cleared · {count(live.blocked)} blocked · {count(live.failed)} held{live.pending ? ` · ${count(live.pending)} to go` : ""}</span>
        </div>
      ) : open ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3">
          <span className="text-sm leading-normal">
            <span className="font-semibold text-[var(--warning-ink)]">Batch being screened</span>
            <span className="text-[var(--body)]"> · “{open.angle}” · {count(open.queued - open.pending)} of {count(open.queued)} screened · {count(open.cleared)} cleared · {count(open.blocked)} blocked · {count(open.failed)} held · started by {open.createdByName ?? "a teammate"} {stamp(open.createdAt)}{open.stalled ? ` · no progress for ${STALLED_MINUTES}+ minutes` : ""}</span>
          </span>
          {resume && !resume.ok && <span className="text-xs text-[var(--body)]">{resume.reason}</span>}
          <span><Button type="button" variant="outline" size="sm" disabled={readOnly || busy || !resume?.ok} title={resume?.reason || undefined} onClick={() => onResume(open)}>{open.stalled && open.createdBy !== viewer.userId ? "Resume batch" : "Continue screening"}</Button></span>
        </div>
      ) : null}
    </DetailPanel>
  );
}

/** This month's fresh and recycled leads side by side, and conversion all time (moved from Activity, 2026-10-26). */
function FreshVsRecycled({ data }: { data: Payload }) {
  const rows = (["fresh", "recycled"] as const).map((source) => ({ source, row: data.sources.find((item) => item.source === source) ?? null, conversion: data.conversion?.[source] ?? null }));
  if (!data.sources.length && !data.conversion) return null;
  return (
    <TableCard title="Fresh vs recycled" description="Served, dialled and contacts this month · policies all time">
      <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
        <thead><tr><th scope="col">Source</th><th scope="col" className="text-right">Served</th><th scope="col" className="text-right">Dialled</th><th scope="col" className="text-right">Contacts</th><th scope="col" className="text-right">Contact rate</th><th scope="col" className="text-right">Policies per 100 worked</th></tr></thead>
        <tbody>
          {rows.map(({ source, row, conversion }) => (
            <tr key={source}>
              <td className="font-medium">{label(source)}</td>
              <td className="text-right tabular-nums">{row ? count(row.served) : "—"}</td>
              <td className="text-right tabular-nums">{row ? count(row.dialled) : "—"}</td>
              <td className="text-right tabular-nums">{row ? count(row.contacts) : "—"}</td>
              <td className="text-right tabular-nums">{percent(row?.contactRate ?? null)}</td>
              <td className="text-right tabular-nums" title={conversion ? `${plural(conversion.policies, "policy", "policies")} from ${count(conversion.leads)} leads` : undefined}>{percent(conversion?.percent ?? null)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  );
}

const SLOT_LOOK: Record<RotationSlot["state"], string> = {
  failed: "border-[var(--error)] bg-[var(--error-surface)] [&>div:first-child]:text-[var(--error-ink)]",
  answered: "border-[var(--success)] bg-[var(--success-surface)] [&>div:first-child]:text-[var(--success-ink)]",
  next: "border-[var(--primary)] bg-[var(--primary-soft)] [&>div:first-child]:text-[var(--accent-ink)]",
  untried: "border-border bg-card [&>div:first-child]:text-[var(--body)]",
};

function PastBatches({ batches, baseline, onOpenRules }: { batches: RecycleBatch[]; baseline: number | null; onOpenRules?: () => void }) {
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(400, 45);
  const { current, rows } = paginate(batches, page, pageSize);
  return (
    <TableCard
      className={fullHeightCard(300)}
      description={`Rate vs ${percent(baseline)} for fresh leads over the same span`}
      footer={batches.length ? <Pager page={current} total={batches.length} noun="batches" pageSize={pageSize} onPage={setPage} /> : undefined}
    >
      {batches.length ? (
        <table className="portal-lead-table w-full min-w-[1260px] text-left text-sm">
          <thead>
            <tr>
              <th scope="col">Angle</th>
              <th scope="col" className="w-[170px]">Campaign</th>
              <th scope="col" className="w-[110px]">Started</th>
              <th scope="col" className="w-[140px]">By</th>
              <th scope="col" className="w-[84px] text-right">Dials / lead</th>
              <th scope="col" className="w-[84px] text-right">Cleared</th>
              <th scope="col" className="w-[84px] text-right">Blocked</th>
              <th scope="col" className="w-[70px] text-right">Held</th>
              <th scope="col" className="w-[76px] text-right">Waiting</th>
              <th scope="col" className="w-[70px] text-right">Dials</th>
              <th scope="col" className="w-[84px] text-right">Contacts</th>
              <th scope="col" className="w-[84px] text-right">Reached</th>
              <th scope="col" className="w-[70px] text-right">Rate</th>
              <th scope="col" className="w-[76px] text-right">Policies</th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {rows.map((batch) => {
              const better = batch.contactRate != null && baseline != null ? batch.contactRate >= baseline : null;
              return (
                <tr key={batch.id} className="m-row">
                  <td className="max-w-[260px]">
                    <span className="block truncate font-semibold" title={batch.angle}>{batch.angle}</span>
                    {batch.status === "screening" && <span className="sr-only">still screening</span>}
                  </td>
                  <td className="max-w-[170px] truncate" title={batch.campaignName}>{batch.campaignName}</td>
                  <td className="whitespace-nowrap text-muted-foreground">{stamp(batch.createdAt)}{batch.status === "screening" ? " · screening" : ""}</td>
                  <td className="max-w-[140px] truncate" title={batch.createdByName ?? undefined}>{batch.createdByName ?? "—"}</td>
                  <td className="text-right tabular-nums">{batch.attemptCeiling}</td>
                  <td className="text-right tabular-nums">{count(batch.cleared)}</td>
                  <td className="text-right tabular-nums">{count(batch.blocked)}</td>
                  <td className="text-right tabular-nums">{count(batch.failed)}</td>
                  <td className="text-right tabular-nums">{batch.pending ? count(batch.pending) : "—"}</td>
                  <td className="text-right tabular-nums">{count(batch.dials)}</td>
                  <td className="text-right tabular-nums">{count(batch.contacts)}</td>
                  <td className="text-right tabular-nums">{count(batch.leadsReached)}</td>
                  <td className={cn("text-right font-semibold tabular-nums", better === true && "text-[var(--success-ink)]", better === false && "text-[var(--error-ink)]")}>{percent(batch.contactRate)}</td>
                  <td className="text-right tabular-nums">{count(batch.policies)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <EmptyState
          title="No batch has run yet"
          hint="Build one from a campaign's recycle rule."
          action={onOpenRules ? <Button type="button" variant="outline" onClick={onOpenRules}>Open recycle rules</Button> : undefined}
        />
      )}
    </TableCard>
  );
}

export function NurtureWorkspace() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [tab, setTab] = useState<"rules" | "batches" | "cadence">("rules");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/app/nurture", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setData(body);
      // On a wide screen the campaign with the most ready opens beside the table; a phone keeps the list.
      setSelected((current) => {
        if (current || typeof window === "undefined" || !window.matchMedia("(min-width: 1024px)").matches) return current;
        const ready = (body as Payload).campaigns.filter((campaign) => campaign.eligibleNow > 0).sort((a, b) => b.eligibleNow - a.eligibleNow)[0];
        return ready?.campaign_id ?? null;
      });
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
      notify.fail(`${error instanceof Error ? error.message : "Screening stopped"} — the batch keeps its progress; continue it from the campaign's panel.`);
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

  const header = <PageHeader title="Lead recycling" actions={<RefreshButton onClick={() => void load()} refreshing={loading} />} />;

  if (!data) {
    if (loading) return <PageLoading />;
    return (
      <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
        <PageHeader title="Lead recycling" />
        <TableCard>
          <ErrorState detail="Nurture campaigns could not be loaded." action={<Button type="button" variant="outline" onClick={() => void load()}>Try again</Button>} />
        </TableCard>
      </div>
    );
  }

  const { totals, campaigns, cadence, rotation, contactRate, pool, recycledAllTime, batches, batchBaseline, viewer, batchesReady } = data;
  const readOnly = Boolean(data.readOnly);
  const working = campaigns.filter((campaign) => campaign.eligible_count > 0 || campaign.reactivated_count > 0 || campaign.lastRun || campaign.openBatch || (campaign.pool?.saidNo ?? 0) > 0);
  const idle = campaigns.filter((campaign) => !working.includes(campaign));
  const change = totals.recycledLastMonth > 0 ? Math.round(((totals.recycledThisMonth - totals.recycledLastMonth) / totals.recycledLastMonth) * 100) : null;
  const lastMonthName = MONTHS[(new Date().getMonth() + 11) % 12];
  const opened = campaigns.find((campaign) => campaign.campaign_id === selected) ?? null;
  const choose = (id: string | null, build = false) => { setSelected(id); setBuilding(build); setTab("rules"); };

  // The one thing to do next: a batch part-way screened that this viewer may continue, then the
  // campaigns with leads ready to dial again.
  const resumable = progress ? null : campaigns.find((campaign) => campaign.openBatch && canContinue(campaign.openBatch, viewer).ok) ?? null;
  const ready = campaigns.filter((campaign) => !startBlockedFor(campaign, batchesReady)).sort((a, b) => b.eligibleNow - a.eligibleNow);
  const readyTotal = ready.reduce((sum, campaign) => sum + campaign.eligibleNow, 0);

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {header}

      {!readOnly && resumable?.openBatch ? (
        <NextStepLine action={<Button type="button" size="sm" onClick={() => { choose(resumable.campaign_id); void screen(resumable.openBatch!.id, resumable.campaign_id); }}>{resumable.openBatch.stalled && resumable.openBatch.createdBy !== viewer.userId ? "Resume batch" : "Continue screening"}</Button>}>
          <strong className="font-semibold text-[var(--ink)]">A batch on {resumable.campaign_name} is part-way screened</strong> — {count(resumable.openBatch.pending)} still to check. It picks up where it stopped.
        </NextStepLine>
      ) : !readOnly && !progress && ready.length ? (
        <NextStepLine action={<Button type="button" size="sm" onClick={() => choose(ready[0].campaign_id, true)}>Start with {ready[0].campaign_name}</Button>}>
          <strong className="font-semibold text-[var(--ink)]">{plural(readyTotal, "aged lead")} {readyTotal === 1 ? "is" : "are"} ready</strong> to dial again across {plural(ready.length, "campaign")}. Build a batch — every lead is screened again first.
        </NextStepLine>
      ) : null}

      {/* Four figures an operator acts on (2026-10-06 redesign). "In nurture" is the Eligible
          tile's footnote; the recycled contact rate is the conversion tile's, or its own tile when
          the conversion read is unavailable. */}
      <StatStrip label="Recycling totals">
        <StatTile label="Eligible today" value={count(totals.eligibleNow)} footnote={pool ? `of ${count(totals.inNurture)} in nurture · ${count(pool.tooRecent)} too recent · ${count(pool.never)} never` : `of ${count(totals.inNurture)} in nurture · before the fresh scrub`} />
        <StatTile label="Recycled this month" value={count(totals.recycledThisMonth)} valueTone={totals.recycledThisMonth > 0 ? "good" : undefined} footnote={change == null ? `none in ${lastMonthName}` : `${change >= 0 ? "+" : "−"}${Math.abs(change)}% vs ${lastMonthName}`} />
        <StatTile label="Blocked on re-screening" value={count(totals.blockedThisMonth)} valueTone={totals.blockedThisMonth > 0 ? "danger" : undefined} footnote="suppressed since import" />
        {/* LA-2.20-6 / W3.5: conversion, recycled against fresh, all time — policies per 100 leads worked on each side. */}
        {data.conversion
          ? <StatTile
              label="Recycled conversion"
              value={percent(data.conversion.recycled.percent)}
              footnote={`vs ${percent(data.conversion.fresh.percent)} fresh · ${plural(data.conversion.recycled.policies, "policy", "policies")} from ${count(data.conversion.recycled.leads)} recycled · ${contactRate?.recycled == null ? "no contact rate yet" : `${contactRate.recycled.toFixed(1)}% contact${contactRate.fresh == null ? "" : ` vs ${contactRate.fresh.toFixed(1)}%`}`}`}
              action={<button type="button" onClick={() => setTab("batches")} className="text-xs font-semibold text-foreground hover:underline">Compare</button>}
            />
          : <StatTile
              label="Recycled contact rate"
              value={contactRate?.recycled == null ? "—" : `${contactRate.recycled.toFixed(1)}%`}
              valueTone={contactRate?.recycled == null ? undefined : "primary"}
              footnote={`${contactRate?.fresh == null ? "no fresh dials to compare" : `vs ${contactRate.fresh.toFixed(1)}% fresh`}${recycledAllTime ? ` · ${count(recycledAllTime.recycled)} recycled, ${plural(recycledAllTime.policies, "policy", "policies")}` : ""}`}
              action={<button type="button" onClick={() => setTab("batches")} className="text-xs font-semibold text-foreground hover:underline">Compare</button>}
            />}
      </StatStrip>

      {!batchesReady && (
        <p role="status" className="rounded-lg border border-[var(--warning)]/30 bg-[var(--warning-surface)] px-4 py-2.5 text-sm text-[var(--warning-ink)]">
          Batches need a database update that has not been applied yet. Rules can still be saved.
        </p>
      )}

      <ViewTabs
        label="Recycling views"
        controls="recycle-panel"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: "rules", label: "Campaigns", count: campaigns.length },
          { key: "batches", label: "Past batches", count: batches.length },
          { key: "cadence", label: "Cadence & rotation" },
        ]}
      />

      {/* Campaigns: one row each — the rule, what it would pick up now, the last run and any batch in
          flight. The row you pick opens beside the table (2026-10-26: a side panel, not a pop-up), with
          every control, the never-included line, and Build a recycle batch. Campaigns with work first. */}
      <div key={tab} role="tabpanel" id="recycle-panel" aria-labelledby={`recycle-panel-tab-${tab}`} className="flex min-w-0 flex-col gap-6">
      {tab === "rules" && (
        campaigns.length ? (
          <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
            <TableCard className="min-w-0 flex-1">
              <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
                <thead>
                  <tr>
                    <th scope="col">Campaign</th>
                    <th scope="col" className="w-[120px]">Status</th>
                    <th scope="col" className="w-[80px] text-right">Rests</th>
                    <th scope="col" className="w-[56px] text-right">Cap</th>
                    <th scope="col" className="w-[180px]">Recycles after</th>
                    <th scope="col" className="w-[90px] text-right">Ready</th>
                    <th scope="col" className="w-[90px] text-right">Too recent</th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {[...working, ...idle].map((campaign) => {
                    const live = progress?.campaignId === campaign.campaign_id;
                    const active = campaign.status === "active";
                    const isOpen = campaign.campaign_id === selected;
                    return (
                      <tr key={campaign.campaign_id} className={cn("m-row cursor-pointer", isOpen && "bg-[var(--primary-soft)] shadow-[inset_3px_0_0_var(--primary)]")} onClick={() => choose(isOpen ? null : campaign.campaign_id)}>
                        <td className="max-w-[280px]">
                          <button type="button" className="block max-w-full truncate text-left font-semibold hover:underline" aria-expanded={isOpen} onClick={(event) => { event.stopPropagation(); choose(isOpen ? null : campaign.campaign_id); }} title={campaign.campaign_name}>{campaign.campaign_name}</button>
                          <span className="block truncate text-xs text-muted-foreground">
                            {campaign.lastRun ? <><span className="text-[var(--success-ink)]">{count(campaign.lastRun.cleared)} cleared</span> · <span className="text-[var(--error-ink)]">{count(campaign.lastRun.blocked)} blocked</span>{campaign.lastRun.failed ? <> · <span className="text-[var(--warning-ink)]">{count(campaign.lastRun.failed)} held</span></> : null} · {stamp(campaign.lastRun.at)}</> : "never run"}
                          </span>
                        </td>
                        <td>
                          {live ? <span className="text-xs font-semibold text-[var(--info-ink)]">Screening now</span>
                            : campaign.openBatch ? <span className="text-xs font-semibold text-[var(--warning-ink)]" title={`“${campaign.openBatch.angle}”`}>Being screened</span>
                            : <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold", active ? "bg-[var(--success-surface)] text-[var(--success-ink)]" : "bg-[var(--surface-alt)] text-[var(--body)]")}>{label(campaign.status)}</span>}
                        </td>
                        <td className="text-right tabular-nums">{plural(campaign.rule.wait_days, "day")}</td>
                        <td className="text-right tabular-nums">{campaign.rule.max_recycles}</td>
                        <td className="max-w-[180px] truncate" title={campaign.rule.allowed_dispositions.map(label).join(", ")}>{campaign.rule.allowed_dispositions.map(label).join(", ") || <span className="text-muted-foreground">no outcomes chosen</span>}</td>
                        <td className={cn("text-right font-semibold tabular-nums", campaign.eligibleNow > 0 && "text-[var(--accent-ink)]")}>{count(campaign.eligibleNow)}</td>
                        <td className="text-right tabular-nums text-muted-foreground">{campaign.pool ? count(campaign.pool.tooRecent) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableCard>
            {opened && (
              <RulePanel
                key={opened.campaign_id}
                campaign={opened}
                readOnly={readOnly}
                busy={saving === opened.campaign_id || progress?.campaignId === opened.campaign_id}
                batchesReady={batchesReady}
                viewer={viewer}
                progress={progress}
                building={building}
                onBuilding={setBuilding}
                onChange={(next) => update(opened.campaign_id, next)}
                onSave={() => void save(opened)}
                onStart={(input) => void start(opened, input)}
                onResume={(batch) => void screen(batch.id, opened.campaign_id)}
                onClose={() => choose(null)}
              />
            )}
          </div>
        ) : (
          <TableCard>
            <EmptyState
              title="No campaigns yet"
              hint="Create one to set a recycle rule."
              action={<Button asChild type="button" variant="outline"><Link href="/app/lead-sources?tab=campaigns">Vendors &amp; campaigns</Link></Button>}
            />
          </TableCard>
        )
      )}

      {tab === "batches" && (
        <>
          <FreshVsRecycled data={data} />
          <PastBatches batches={batches} baseline={batchBaseline} onOpenRules={() => setTab("rules")} />
        </>
      )}

      {tab === "cadence" && (
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
          <TableCard
            className="min-w-0 flex-grow"
            title="Retry cadence"
            action={
              <>
                {cadence && <span className="inline-flex whitespace-nowrap rounded-full bg-[var(--primary-soft)] px-2.5 py-0.5 text-xs font-semibold text-[var(--accent-ink)]">{cadence.first72} of {cadence.total} inside 72 hours</span>}
                <Button asChild variant="outline"><Link href="/app/settings#cadence">Edit cadence</Link></Button>
              </>
            }
            footer={cadence?.usingDefaults ? "No cadence is saved, so this is the dialer's built-in schedule." : undefined}
          >
            {cadence ? (
              <table className="portal-lead-table w-full min-w-[620px] text-left text-sm">
                <thead>
                  <tr>
                    <th scope="col" className="w-[80px]">Attempt</th>
                    <th scope="col" className="w-[130px]">Wait</th>
                    <th scope="col" className="w-[220px]">Slot</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {cadence.steps.map((step) => (
                    <tr key={step.attempt} className={cn("m-row", step.offsetMs <= 72 * 3_600_000 && "bg-[var(--primary-soft)]")}>
                      <td className="tabular-nums font-semibold">{step.attempt}</td>
                      <td className="tabular-nums">{step.interval ? `+${step.interval}` : "immediately"}</td>
                      <td>{step.attempt === 1 ? "on import" : step.slot ? PREFERRED[step.slot] ?? step.slot : "a slot not yet tried"}</td>
                      <td className="text-muted-foreground">{offset(step.offsetMs)}{step.attempt === cadence.total ? " · then exhausted" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="border-t border-border px-4 py-6 text-sm text-muted-foreground">The cadence could not be read.</p>
            )}
          </TableCard>

          <TableCard
            className="w-full shrink-0 xl:w-[480px]"
            title="Slot rotation"
            description={rotation ? undefined : "No lead is mid-cadence right now"}
            action={rotation ? <span className="text-sm text-muted-foreground"><Link href={`/app/leads/${rotation.leadId}`} className="font-semibold text-foreground hover:underline">{rotation.leadName}</Link> · attempt {rotation.attempt} of {rotation.ceiling}</span> : undefined}
          >
            {rotation && (
              <div className="grid grid-cols-3 gap-1.5 border-t border-border p-4 sm:grid-cols-6">
                {rotation.slots.map((slot) => (
                  <div key={slot.slot} className={cn("rounded-lg border px-2 py-2.5 text-center", SLOT_LOOK[slot.state])}>
                    <div className="text-xs font-semibold">{SLOT_HOURS[slot.slot] ?? slot.slot}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{slot.note}</div>
                  </div>
                ))}
              </div>
            )}
          </TableCard>
        </div>
      )}
      </div>
    </div>
  );
}
