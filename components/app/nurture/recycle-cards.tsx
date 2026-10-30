"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, History, Layers, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, inputControl, textareaControl } from "@/components/ui/field";
import { InfoTip } from "@/components/ui/info-tip";
import { StatCard, StatRow } from "@/components/ui/stat-card";
import { StatusChip } from "@/components/ui/status-chip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { NumberStepper } from "@/components/app/campaigns/number-stepper";
import { Callout } from "@/components/app/settings/primitives";
import type { NurtureCampaignReport, NurtureReport } from "@/lib/nurture/report";
import { ANGLE_MAX, ANGLE_MIN, DEFAULT_PASS_CEILING, MAX_PASS_CEILING, RECYCLABLE_DISPOSITIONS, SAID_NO_MIN_DAYS, SCRIPT_MAX, STALLED_MINUTES, type RecycleBatch } from "@/lib/nurture/contract";
import { cn } from "@/lib/utils";
import { canContinue, count, label, money, percent, plural, stamp, startBlockedFor, type RuleDraft } from "@/components/app/nurture/format";

/**
 * Lead sources › 6 Recycle, one campaign's panel (board C + A, 2026-10-29: the page is a table of
 * campaigns, components/app/nurture/recycle-table.tsx; a row opens these in a DetailPanel):
 *   RecycleFlow        ① who is ready (count + breakdown, and the fix for whatever stops it),
 *                      ② the new angle (required), ③ Bring them back — and what that does.
 *                      A batch part-way screened replaces ②–③ with its progress and Resume.
 *   RulePanel          the campaign's rule: outcomes as chips, rest and cap as steppers,
 *                      Save only once something changed (the workspace guards leaving).
 *   RecyclePerformance recycled against fresh — only the figures that exist (owner rule: no "—"
 *                      tiles); it opens in the Compare dialog beside the fresh-vs-recycled table.
 * LA-2.20 (Notion): reactivation by rule per campaign, re-scrub, attempts reset with history kept,
 * suppression since stays suppressed, lowest queue tier (serve_next_lead tier 6), recycled vs fresh.
 */

export type Progress = { batchId: string; campaignId: string; screened: number; cleared: number; blocked: number; failed: number; pending: number };

/** Quick fills for the angle; the field stays free text. */
export const ANGLES = ["A new, lower price", "A carrier they have not heard of", "Birthday check-in"];

/** A section of the campaign panel: its label, then its body. */
export function PanelSection({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="flex min-h-6 flex-wrap items-center gap-2">
        <h3 className="m-0 text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">{title}</h3>
        {aside && <span className="ml-auto flex items-center gap-2">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** One numbered step of the flow. */
function Step({ n, title, children, aside }: { n: number; title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--primary-soft)] text-xs font-semibold text-[var(--accent-ink)]" aria-hidden="true">{n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex min-h-6 flex-wrap items-center gap-2">
          <h3 className="m-0 text-sm font-semibold text-[var(--ink)]">{title}</h3>
          {aside}
        </div>
        {children}
      </div>
    </section>
  );
}

export function RecycleFlow({ campaign, readOnly, readOnlyReason, busy, batchesReady, viewer, progress, stopped, onStart, onResume, onRaiseCap, onEditRule }: {
  campaign: NurtureCampaignReport;
  readOnly: boolean;
  readOnlyReason: string;
  busy: boolean;
  batchesReady: boolean;
  viewer: NurtureReport["viewer"];
  progress: Progress | null;
  /** Why screening stopped on this page, when it did (the service down mid-batch). */
  stopped: string | null;
  onStart: (input: { angle: string; script: string; attemptCeiling: number }) => void;
  onResume: (batch: RecycleBatch) => void;
  onRaiseCap: () => void;
  onEditRule: () => void;
}) {
  const [angle, setAngle] = useState("");
  const [script, setScript] = useState("");
  const [ceilingText, setCeilingText] = useState(String(DEFAULT_PASS_CEILING));
  const [more, setMore] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const pool = campaign.pool;
  const open = campaign.openBatch;
  const live = progress?.campaignId === campaign.campaign_id ? progress : null;
  const resume = open ? canContinue(open, viewer) : null;
  const ceiling = Number(ceilingText);
  const startBlocked = startBlockedFor(campaign, batchesReady);
  const angleOk = angle.trim().length >= ANGLE_MIN;
  const ceilingOk = Number.isInteger(ceiling) && ceiling >= 1 && ceiling <= MAX_PASS_CEILING;
  const why = readOnly ? readOnlyReason : startBlocked || (!angleOk ? "Write the new angle first" : !ceilingOk ? `Attempts this pass must be between 1 and ${MAX_PASS_CEILING}` : "");
  const locked = readOnly || busy;
  const wait = campaign.rule.wait_days;
  const saidNoAllowed = campaign.rule.allowed_dispositions.includes("not_interested");
  const ownerOnly = pool && viewer.role !== "owner" ? pool.ownerOnly : 0;
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

  // The one fix for whatever stops this campaign, under its count (a running batch has its own block).
  let fix: ReactNode = null;
  if (!batchesReady) fix = <Callout tone="warning" title="Batches need a database update that has not been applied yet">The rule can still be saved.</Callout>;
  else if (!open && !live && campaign.rule.max_recycles === 0) {
    fix = <Callout tone="warning" title="The recycle cap is 0, so no lead can come back">
      <Button type="button" variant="outline" size="sm" className="mt-1" disabled={readOnly} title={readOnly ? readOnlyReason : undefined} onClick={onRaiseCap}>Raise the cap in the rule</Button>
    </Callout>;
  } else if (!open && !live && campaign.eligibleNow === 0) {
    fix = pool?.tooRecent
      ? <Callout tone="info" title={`${plural(pool.tooRecent, "lead is", "leads are")} resting`}>
        Each is ready {plural(wait, "day")} after its last dial{saidNoAllowed ? ` (said no: ${SAID_NO_MIN_DAYS} days)` : ""}.
        <Button type="button" variant="outline" size="sm" className="ml-2" disabled={readOnly} title={readOnly ? readOnlyReason : undefined} onClick={onEditRule}>Shorten the rest</Button>
      </Callout>
      : pool?.outcomeNotInRule
        ? <Callout tone="info" title={`${plural(pool.outcomeNotInRule, "lead has", "leads have")} an outcome this rule skips`}>
          <Button type="button" variant="outline" size="sm" className="mt-1" disabled={readOnly} title={readOnly ? readOnlyReason : undefined} onClick={onEditRule}>Choose outcomes in the rule</Button>
        </Callout>
        : <Callout tone="info" title="No lead in this campaign has run out of attempts yet">
          Leads land here once the dialer works them to the ceiling. <Link href="/app/lead-sources" className="font-semibold text-[var(--accent-ink)] hover:underline">See its list</Link>
        </Callout>;
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
        <Step n={1} title="Who is ready">
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
            <strong className="text-4xl font-semibold leading-none tracking-[-0.03em] tabular-nums text-[var(--ink)]">{count(campaign.eligibleNow)}</strong>
            <span className="pb-0.5 text-sm text-[var(--body)]">ready to call again · rested {plural(wait, "day")} since the last dial</span>
          </div>
          {pool && (
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusChip tone="good" title="Meets the rule now. Each is screened against do-not-call and suppression again before it can be dialled.">{count(campaign.eligibleNow)} ready</StatusChip>
              <StatusChip tone="neutral" title={`Dialled less than ${plural(wait, "day")} ago${saidNoAllowed ? `, or said no less than ${SAID_NO_MIN_DAYS} days ago` : ""}. They become ready on their own.`}>{count(pool.tooRecent)} too recent</StatusChip>
              <StatusChip tone="danger" title="Do not call, litigator, complaint or a suppression hit — never recycled, even if added since.">{count(pool.never)} never</StatusChip>
              {ownerOnly > 0 && <StatusChip tone="warning" title={`They said no. Only an owner can bring them back, ${SAID_NO_MIN_DAYS}+ days after the outcome.`}>{count(ownerOnly)} said no · owner only</StatusChip>}
              <InfoTip label="Who is in the pool">
                {plural(pool.exhaustedNoOutcome, "exhausted lead")} never reached, {plural(pool.saidNo, "said no", "said no")}{pool.eligibleSaidNo ? ` (${count(pool.eligibleSaidNo)} of them eligible now)` : ""}.{notPicked.length ? ` Not picked up: ${notPicked.join(" · ")}.` : ""}
              </InfoTip>
            </div>
          )}
          {fix}
        </Step>

        {live ? (
          <Callout tone="info" title={<span className="inline-flex items-center gap-2"><RefreshCw className="size-4 animate-spin" aria-hidden="true" />Screening</span>}>
            <span role="status">{count(live.screened)} screened · {count(live.cleared)} cleared · {count(live.blocked)} blocked · {count(live.failed)} held{live.pending ? ` · ${count(live.pending)} to go` : ""}</span>
          </Callout>
        ) : open ? (
          <Callout tone={stopped ? "error" : "warning"} title={stopped ? "Screening stopped part-way" : `Batch being screened · “${open.angle}”`}>
            <span className="block">
              {stopped ? `${stopped} Nothing is lost: numbers not yet screened are never dialled. ` : ""}
              {count(open.queued - open.pending)} of {count(open.queued)} screened · {count(open.cleared)} cleared · {count(open.blocked)} blocked · {count(open.failed)} held · started by {open.createdByName ?? "a teammate"} {stamp(open.createdAt)}{open.stalled ? ` · no progress for ${STALLED_MINUTES}+ minutes` : ""}
            </span>
            {resume && !resume.ok && <span className="mt-1 block text-xs">{resume.reason}</span>}
            <Button type="button" size="sm" className="mt-2" disabled={readOnly || busy || !resume?.ok} title={readOnly ? readOnlyReason : resume?.reason || undefined} onClick={() => onResume(open)}>
              <RefreshCw aria-hidden="true" />{stopped || (open.stalled && open.createdBy !== viewer.userId) ? "Resume screening" : "Continue screening"}
            </Button>
          </Callout>
        ) : (
          <>
            <Step n={2} title="The new angle" aside={<span className="text-xs text-[var(--body)]">required</span>}>
              <input id="recycle-angle" aria-label="The new angle" value={angle} maxLength={ANGLE_MAX} disabled={locked} required onChange={(event) => setAngle(event.target.value)} placeholder="What is different this time" className={inputControl} />
              <span className="flex flex-wrap gap-1.5" aria-label="Quick angles" role="group">
                {ANGLES.map((item) => <ToggleChip key={item} selected={angle === item} disabled={locked} onClick={() => setAngle(angle === item ? "" : item)}>{item}</ToggleChip>)}
              </span>
            </Step>

            <Step n={3} title="Bring them back">
              <span className="flex flex-wrap items-center gap-2">
                <Button type="button" disabled={locked || Boolean(why)} title={why || undefined} onClick={() => setConfirming(true)}>{busy && !live ? "Starting…" : campaign.eligibleNow === 0 ? "None ready yet" : `Bring ${count(campaign.eligibleNow)} back`}</Button>
                <Button type="button" variant="ghost" aria-expanded={more} aria-controls="recycle-more" onClick={() => setMore((value) => !value)}>More<ChevronDown className={cn("transition-transform", more && "rotate-180")} aria-hidden="true" /></Button>
                {why && campaign.eligibleNow > 0 && <span className="text-xs text-[var(--body)]">{why}</span>}
              </span>
              <ul aria-label="What happens" className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-[var(--body)]">
                <li className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5" aria-hidden="true" />Re-screened first</li>
                <li className="inline-flex items-center gap-1.5"><RotateCcw className="size-3.5" aria-hidden="true" />Attempts reset{ceilingOk ? ` · ${plural(ceiling, "dial")} this pass` : ""}</li>
                <li className="inline-flex items-center gap-1.5"><History className="size-3.5" aria-hidden="true" />History kept</li>
                <li className="inline-flex items-center gap-1.5"><Layers className="size-3.5" aria-hidden="true" />Lowest queue tier</li>
              </ul>
              {more && (
                <div id="recycle-more" className="grid gap-3 sm:grid-cols-2">
                  <Field label="Script — optional" htmlFor="recycle-script" className="sm:col-span-2">
                    <textarea id="recycle-script" value={script} maxLength={SCRIPT_MAX} rows={3} disabled={locked} onChange={(event) => setScript(event.target.value)} className={textareaControl} />
                  </Field>
                  <Field label={`Attempts this pass (1–${MAX_PASS_CEILING})`} htmlFor="recycle-ceiling">
                    <NumberStepper id="recycle-ceiling" value={ceilingText} onChange={setCeilingText} min={1} max={MAX_PASS_CEILING} label="attempts this pass" disabled={locked} />
                  </Field>
                  <span className="flex min-w-0 flex-col gap-1.5">
                    <span className="text-label text-[var(--body)]">Cost to attribute</span>
                    <span className="flex h-9 items-center text-sm font-semibold text-[var(--ink)]">$0.00 — already paid for</span>
                  </span>
                </div>
              )}
            </Step>
          </>
        )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        destructive={false}
        title={`Bring ${plural(campaign.eligibleNow, "lead")} back?`}
        description="Every lead is screened against do-not-call and suppression again before it can be dialled. A batch keeps its progress if you close the tab."
        confirmLabel="Scrub and create"
        onConfirm={() => { setConfirming(false); onStart({ angle, script, attemptCeiling: ceiling }); }}
      >
        “{angle.trim()}” · {campaign.campaign_name} · {plural(ceiling, "attempt")} this pass{script.trim() ? " · with a script" : ""}
      </ConfirmDialog>
    </div>
  );
}

/** The campaign's state, for the panel's header. */
export function campaignStatus(campaign: NurtureCampaignReport, screeningNow: boolean): ReactNode {
  if (screeningNow) return <StatusChip tone="info">Screening now</StatusChip>;
  if (campaign.openBatch) return <StatusChip tone="warning" title={`“${campaign.openBatch.angle}”`}>Being screened</StatusChip>;
  return <StatusChip tone={campaign.status === "active" ? "good" : "neutral"}>{label(campaign.status)}</StatusChip>;
}

/** The campaign's rule, editable but secondary. Save and Discard appear once something changed. */
export function RulePanel({ campaign, draft, onDraft, dirty, problem, saving, lockedReason, screeningNow, onSave, onDiscard }: {
  campaign: NurtureCampaignReport;
  draft: RuleDraft;
  onDraft: (next: RuleDraft) => void;
  dirty: boolean;
  problem: string;
  saving: boolean;
  /** Why the rule cannot be changed now (read-only, a batch screening), or null. */
  lockedReason: string | null;
  screeningNow: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const locked = lockedReason !== null || saving;
  const run = campaign.lastRun;
  const toggle = (option: string) => onDraft({ ...draft, outcomes: draft.outcomes.includes(option) ? draft.outcomes.filter((value) => value !== option) : [...draft.outcomes, option] });
  return (
    <PanelSection title="Rule">
      <div className="flex flex-col gap-4">
        <div role="group" aria-labelledby="rule-outcomes" className="flex flex-col gap-1.5">
          <span id="rule-outcomes" className="text-label text-[var(--body)]">Recycle after</span>
          <div className="flex flex-wrap gap-1.5" title={lockedReason ?? undefined}>
            {RECYCLABLE_DISPOSITIONS.map((option) => {
              const on = draft.outcomes.includes(option);
              const when = option === "not_interested" ? `${SAID_NO_MIN_DAYS}+ d · owner` : `${draft.wait || "?"} d`;
              return <ToggleChip key={option} selected={on} disabled={locked} onClick={() => toggle(option)}>{label(option)}{on && <span className="text-[var(--body)]">· {when}</span>}</ToggleChip>;
            })}
            <StatusChip tone="danger" className="h-7" title="Do not call, litigator, complaint or any suppression hit — never recycled, even when added after the first campaign.">Do not call · never</StatusChip>
          </div>
        </div>
        <Field label="Rests after the last dial" htmlFor="rule-wait">
          <NumberStepper id="rule-wait" value={draft.wait} onChange={(wait) => onDraft({ ...draft, wait })} min={1} max={3650} label="rest days" after="days" disabled={locked} />
        </Field>
        <Field label="At most" htmlFor="rule-max">
          <NumberStepper id="rule-max" value={draft.max} onChange={(max) => onDraft({ ...draft, max })} min={0} max={100} label="recycles per lead" after="times per lead" disabled={locked} />
        </Field>
        <span className="text-xs leading-normal text-[var(--body)]">
          {count(campaign.eligible_count)} in nurture · {count(campaign.reactivated_count)} recycled so far · scrub {campaign.scrub_status.replaceAll("_", " ")}
          <br />
          {run ? <>Last run {stamp(run.at)}: {count(run.cleared)} cleared · {count(run.blocked)} blocked · {count(run.failed)} held</> : "Never run"}
        </span>
        {lockedReason && !screeningNow && <span className="text-xs text-[var(--body)]">{lockedReason}</span>}
      </div>
      {dirty && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {problem && <span role="alert" className="mr-auto text-xs text-[var(--error-ink)]">{problem}</span>}
          <Button type="button" variant="ghost" disabled={saving} onClick={onDiscard}>Discard</Button>
          <Button type="button" disabled={saving || Boolean(problem)} onClick={onSave}>{saving ? "Saving…" : "Save rule"}</Button>
        </div>
      )}
    </PanelSection>
  );
}

/** Recycled against fresh: only the figures that exist. Null when there are none yet. */
export function RecyclePerformance({ data, onCompare }: { data: NurtureReport; onCompare?: () => void }) {
  const { contactRate, conversion, recycledAllTime, totals, batches } = data;
  const spent = batches.reduce((sum, batch) => sum + batch.costCents, 0);
  const policies = batches.reduce((sum, batch) => sum + batch.policies, 0);
  const compare = onCompare ? <button type="button" onClick={onCompare} className="text-xs font-semibold text-foreground hover:underline">Compare</button> : undefined;
  const cards: ReactNode[] = [];
  if (contactRate?.recycled != null) {
    cards.push(<StatCard key="contact" label="Contact rate" period="recycled" value={percent(contactRate.recycled)} fact={{ label: "Fresh", value: percent(contactRate.fresh) }} action={compare} />);
  }
  if (conversion && conversion.recycled.leads > 0) {
    cards.push(<StatCard key="conversion" label="Recycled conversion" period="per 100 worked" value={percent(conversion.recycled.percent)} fact={{ label: `${plural(conversion.recycled.policies, "policy", "policies")} · vs ${percent(conversion.fresh.percent)} fresh` }} action={cards.length ? undefined : compare} />);
  } else if (recycledAllTime && recycledAllTime.recycled > 0) {
    cards.push(<StatCard key="policies" label="Policies" period="recycled" value={count(recycledAllTime.policies)} fact={{ label: `from ${count(recycledAllTime.recycled)} recycled` }} />);
  }
  if (policies > 0) cards.push(<StatCard key="cpp" label="Cost per policy" period="recycled" value={money(spent / policies)} fact={{ label: "New spend on batches", value: money(spent) }} />);
  if (totals.recycledThisMonth + totals.blockedThisMonth > 0) {
    cards.push(<StatCard key="month" label="Recycled" period="this month" value={count(totals.recycledThisMonth)} fact={{ label: "Blocked on re-screening", value: count(totals.blockedThisMonth) }} />);
  }
  if (!cards.length) return null;
  // auto-fill: one or two cards keep a card's width instead of stretching across the row.
  return <StatRow label="Recycled against fresh" className="grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">{cards}</StatRow>;
}
