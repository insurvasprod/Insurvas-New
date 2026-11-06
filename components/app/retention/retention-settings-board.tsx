"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Advanced, FormSection, FormSections } from "@/components/app/settings/patterns";
import { DraftActions } from "@/components/app/settings/primitives";
import { LockedNote, SectionTabs, SettingRow, useAnchorTab } from "@/components/app/settings/setting-row";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { checkboxControl, inputControl, Switch, textareaControl } from "@/components/ui/field";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { MoreMenu } from "@/components/ui/more-menu";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { Segmented } from "@/components/ui/view-tabs";
import { LA5_OWNER_ROLE_LABELS, LA5_OWNER_ROLES, LA5_QUEUE_LABELS, LA5_QUEUES, type La5OwnerRole, type La5Queue } from "@/lib/retention/assignment";
import { PLATFORM_TALK_TRACK } from "@/lib/retention/campaign";
import { PLATFORM_CAPS, PLATFORM_DEFAULT_SETTINGS, WINBACK_REASONS, type RetentionSettings } from "@/lib/retention/constants";
import { SORT_LABELS, SORTS } from "@/lib/retention/queue";
import { AFFORDABILITY_CONFIRMATION, FIELDS, HOLDOUT_EXPLANATION, resetSection, thresholdConsequence, WINBACK_LABELS, WINBACK_LIMITS, type HubSection } from "@/lib/retention/settingsHub";
import type { Hub } from "@/lib/retention/settingsHubStore";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

/**
 * LA-5.11 (Notion sprint) · every LA-5 setting in one place. Caps are shown, locked, beside the
 * setting they guard. Weights have their own page (/app/retention-settings/weights): previewed before
 * they are saved, and a save is a new version. The holdout's explanation sits above its switch and
 * cannot be edited; switching it on needs the explanation acknowledged.
 *
 * Money & compliance redesign A (owner pick 2026-11-03, docs/settings/MONEY-COMPLIANCE-SETTINGS.md):
 * tabs on the title line, Start here first (who reaches the save queue, with today's count), a line
 * under every setting saying what it changes, Insurvas's value shown only where yours differs, rarely
 * changed values under Advanced, and one save bar for the page (it replaced a Save and a Reset in
 * every card). Reset goes back to Insurvas's values one tab at a time, from More.
 */
type Tab = "start" | "who" | "campaigns" | "holdout";
const TABS: { key: Tab; label: string }[] = [
  { key: "start", label: "Start here" },
  { key: "who", label: "Who works it" },
  { key: "campaigns", label: "Campaigns & win-back" },
  { key: "holdout", label: "Holdout" },
];
/** Every anchor Settings search links to (#holdout), and the tab that holds it. */
export const SECTION_TAB = {
  weights: "start",
  thresholds: "start",
  queue: "start",
  signals: "start",
  assignment: "who",
  campaigns: "campaigns",
  reinstatement: "campaigns",
  servicing: "campaigns",
  winback: "campaigns",
  holdout: "holdout",
} as const satisfies Record<string, Tab>;
/** The hub sections a tab's reset puts back (weights reset on their own page). */
const TAB_SECTIONS: Record<Tab, HubSection[]> = {
  start: ["thresholds", "queue", "signals"],
  who: ["assignment"],
  campaigns: ["campaigns", "reinstatement", "servicing", "winback"],
  holdout: ["holdout"],
};

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/app/retention/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? "That didn't save");
  return json as { changes?: unknown[] };
}

const n = (v: string) => (v.trim() === "" ? NaN : Number(v));
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const count = (v: number) => v.toLocaleString("en-US");

export function RetentionSettingsBoard({ hub, canEdit }: { hub: Hub; canEdit: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("start");
  useAnchorTab(SECTION_TAB, setTab);
  const [saved, setSaved] = useState<RetentionSettings>(hub.settings);
  const [draft, setDraft] = useState<RetentionSettings>(hub.settings);
  const [savedRules, setSavedRules] = useState(hub.rules);
  const [rules, setRules] = useState(hub.rules);
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  // The typed word for a shorter affordability wait is asked for on Save, in the confirm.
  const [asking, setAsking] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [resetting, setResetting] = useState(false);
  const set = <K extends keyof RetentionSettings>(k: K, v: RetentionSettings[K]) => setDraft((cur) => ({ ...cur, [k]: v }));
  const dis = !canEdit;
  const consequence = useMemo(() => (hub.distribution ? thresholdConsequence(hub.distribution, draft) : null), [hub.distribution, draft]);

  const settingsDirty = !sameJson(draft, saved);
  const rulesDirty = !sameJson(rules, savedRules);
  const pending = (Object.keys(draft) as (keyof RetentionSettings)[]).filter((k) => !sameJson(draft[k], saved[k])).length + LA5_QUEUES.filter((q) => rules[q] !== savedRules[q]).length;
  const dirty = settingsDirty || rulesDirty;
  const shortening = draft.winbackDays.affordability < saved.winbackDays.affordability;
  const turningHoldoutOn = draft.holdoutEnabled && !saved.holdoutEnabled;

  /** True when it saved; the leave guard keeps the owner on the page otherwise. */
  const save = async (typed?: string): Promise<boolean> => {
    if (shortening && typed === undefined) { setAsking(true); return false; }
    setBusy(true);
    try {
      let changed = 0;
      if (settingsDirty) {
        const json = await post({ action: "save_settings", settings: draft, confirmation: typed ?? null, holdout_acknowledged: acknowledged });
        changed += json.changes?.length ?? 0;
        setSaved(draft);
      }
      if (rulesDirty) {
        const json = await post({ action: "save_rules", rules });
        changed += json.changes?.length ?? 0;
        setSavedRules(rules);
      }
      notify.done(changed ? `Saved ${changed} change${changed === 1 ? "" : "s"}` : "Nothing changed");
      setAsking(false);
      setConfirmation("");
      router.refresh();
      return true;
    } catch (e) {
      notify.fail(e instanceof Error ? e.message : "That didn't save");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const discard = () => { setDraft(saved); setRules(savedRules); setAcknowledged(false); };
  const resetTab = async () => {
    setBusy(true);
    try {
      let changed = 0;
      let next = saved;
      for (const section of TAB_SECTIONS[tab]) {
        changed += (await post({ action: "reset", section, confirmation: null })).changes?.length ?? 0;
        next = resetSection(next, section as Exclude<HubSection, "weights">);
      }
      setSaved(next);
      setDraft(next);
      notify.done(changed ? `${changed} value${changed === 1 ? "" : "s"} back to Insurvas's` : "Already on Insurvas's values");
      setResetting(false);
      router.refresh();
    } catch (e) {
      notify.fail(e instanceof Error ? e.message : "That didn't reset");
    } finally {
      setBusy(false);
    }
  };

  /** A number setting. `scale` turns stored units into shown ones (basis points → %, cents → $). */
  const num = (k: keyof RetentionSettings, label: string, opts: { scale?: number; unit?: string; prefix?: string } = {}) => {
    const scale = opts.scale ?? 1;
    const spec = FIELDS[k as keyof typeof FIELDS];
    return (
      <span className="flex items-center gap-2 text-sm text-[var(--muted)]">
        {opts.prefix}
        <input aria-label={label} className={cn(inputControl, "w-28 tabular-nums")} disabled={dis} type="number" step={scale === 1 ? 1 : 0.01}
          min={spec?.min !== undefined ? spec.min / scale : undefined} max={spec?.max !== undefined ? spec.max / scale : undefined}
          value={Number.isFinite(draft[k] as number) ? (draft[k] as number) / scale : ""} onChange={(e) => set(k, Math.round(n(e.target.value) * scale) as never)} />
        {opts.unit}
      </span>
    );
  };
  /** Insurvas's value, only where yours differs. */
  const platform = (k: keyof RetentionSettings, show: (v: never) => ReactNode = (v) => String(v)) => (sameJson(draft[k], PLATFORM_DEFAULT_SETTINGS[k]) ? undefined : show(PLATFORM_DEFAULT_SETTINGS[k] as never));
  const inline = (label: string, control: ReactNode) => <span className="flex flex-col gap-1.5 text-label text-[var(--body)]">{label}{control}</span>;

  return (
    <div className="flex flex-col gap-6">
      <SectionTabs label="Retention settings" tabs={TABS} value={tab} onChange={setTab}
        actions={<MoreMenu items={[
          canEdit && { label: "Reset this tab to Insurvas values", onSelect: () => setResetting(true), disabled: dirty },
          { label: "History", href: "/app/settings?history=retention#settings-history" },
          { label: "Retention results", href: "/app/retention-results" },
        ]} />} />
      <LeaveGuard dirty={dirty} onSave={() => save()} onDiscard={discard} what="the retention settings" />
      {!canEdit ? <p className="m-0 text-sm text-[var(--muted)]">Read only: your plan is paused.</p> : null}

      {tab === "start" && (
        <FormSections>
          <FormSection id="thresholds" title="Which policies your team works" info="Every in-force policy gets a risk score out of 100. These decide which ones reach the save queue.">
            <SettingRow label="The save queue takes" platform={platform("queueMinBand", (v: string) => `${v} and above`)}>
              <Segmented label="The save queue takes" disabled={dis} value={draft.queueMinBand} onChange={(v) => set("queueMinBand", v)} options={[{ key: "medium", label: "Medium and above" }, { key: "high", label: "High and above" }, { key: "critical", label: "Critical only" }]} />
              {consequence ? (
                <p className="m-0 text-sm text-[var(--ink)]" aria-live="polite">Today your queue would hold <strong className="tabular-nums">{count(consequence.queue)}</strong> card{consequence.queue === 1 ? "" : "s"}{consequence.queue > consequence.shown ? `, showing ${count(consequence.shown)} at a time` : ""}. Across the book, <strong className="tabular-nums">{count(consequence.bands.critical)}</strong> policies are critical, <strong className="tabular-nums">{count(consequence.bands.high)}</strong> high, {count(consequence.bands.medium)} medium and {count(consequence.bands.low)} low; policies Insurvas knows too little about stay off the queue.</p>
              ) : <p className="m-0 text-sm text-[var(--muted)]">No policy is scored yet, so there is no count to show.</p>}
            </SettingRow>
            <SettingRow label="Risk bands" sub="Score out of 100" change="Where a score turns medium, high and critical. The count above follows as you type.">
              <div className="flex flex-wrap gap-4">
                {inline("Medium from", num("mediumFrom", "Medium from"))}
                {inline("High from", num("highFrom", "High from"))}
                {inline("Critical from", num("criticalFrom", "Critical from"))}
              </div>
              {(["mediumFrom", "highFrom", "criticalFrom"] as const).some((k) => draft[k] !== PLATFORM_DEFAULT_SETTINGS[k]) && <p className="m-0 text-xs text-[var(--muted)]">Insurvas: {PLATFORM_DEFAULT_SETTINGS.mediumFrom} / {PLATFORM_DEFAULT_SETTINGS.highFrom} / {PLATFORM_DEFAULT_SETTINGS.criticalFrom}</p>}
            </SettingRow>
            {/* 2026-11-05: Retention is the files' facts (the ladder), so its rules replace the radar's weights here. */}
            <SettingRow id="weights" label="What puts a policy on the ladder" change="Its own page: each reason from the carrier files on or off, and when a deadline is urgent.">
              <span className="flex flex-wrap items-center gap-3 text-sm text-[var(--ink)]">Missed and bounced payments, lapse notices, lapses, chargebacks and paperwork<Button asChild variant="outline" size="sm"><Link href="/app/retention-settings/ladder">Ladder rules</Link></Button></span>
            </SettingRow>
            <Advanced summary="Advanced" hint={`Queue: rest ${draft.workedCooldownDays} days · ${draft.maxCards} cards · ${SORT_LABELS[draft.queueDefaultSort].replace(" (default)", "").toLowerCase()}. Signals: floors ${draft.sampleFloor} and ${draft.carrierSampleFloor} · danger months ${draft.dangerMonthFrom}–${draft.dangerMonthTo}`}>
              <div id="queue" className="flex scroll-mt-24 flex-col gap-4">
                <SettingRow label="Rest a worked card for" platform={platform("workedCooldownDays")} change="A card someone worked leaves the queue for this long.">{num("workedCooldownDays", "Worked-card cooldown", { unit: "days" })}</SettingRow>
                <SettingRow label="Show at most" platform={platform("maxCards")} change="A queue of 400 is not a queue. The rest wait their turn by sort order.">{num("maxCards", "Most cards shown", { unit: "cards" })}</SettingRow>
                <SettingRow label="Sort the queue by" platform={platform("queueDefaultSort", (v: keyof typeof SORT_LABELS) => SORT_LABELS[v])} change="The order a rep sees until they pick another.">
                  <select aria-label="Default sort" className={cn(inputControl, "w-64")} disabled={dis} value={draft.queueDefaultSort} onChange={(e) => set("queueDefaultSort", e.target.value as RetentionSettings["queueDefaultSort"])}>
                    {SORTS.map((s) => <option key={s} value={s}>{SORT_LABELS[s]}</option>)}
                  </select>
                </SettingRow>
                <SettingRow label="With nothing high risk" platform={platform("includeMediumWhenEmpty", (v: boolean) => (v ? "show medium" : "an empty queue"))} change="What the queue shows when no policy reaches its band.">
                  <Segmented label="With nothing high risk" disabled={dis} value={draft.includeMediumWhenEmpty ? "yes" : "no"} onChange={(v) => set("includeMediumWhenEmpty", v === "yes")} options={[{ key: "no", label: "Show an empty queue" }, { key: "yes", label: "Show medium instead" }]} />
                </SettingRow>
              </div>
              <div id="signals" className="flex scroll-mt-24 flex-col gap-4">
                <SettingRow label="Too few policies to judge" change="Below this many policies from a lead source or a carrier, its signal is left out rather than counted as weak.">
                  <div className="flex flex-wrap gap-4">{inline("Lead source", num("sampleFloor", "Lead-source sample floor", { unit: "policies" }))}{inline("Carrier", num("carrierSampleFloor", "Carrier sample floor", { unit: "policies" }))}</div>
                </SettingRow>
                <SettingRow label="Premium against income" change="Premium below the first share of income is affordable; above the second it is unaffordable.">
                  <div className="flex flex-wrap gap-4">{inline("Affordable below", num("affordabilityLowBp", "Affordable below (% of income)", { scale: 100, unit: "%" }))}{inline("Unaffordable above", num("affordabilityHighBp", "Unaffordable above (% of income)", { scale: 100, unit: "%" }))}</div>
                </SettingRow>
                <SettingRow label="Danger window" change="Months since issue when a policy is most likely to lapse.">
                  <div className="flex flex-wrap gap-4">{inline("From month", num("dangerMonthFrom", "Danger window from month"))}{inline("To month", num("dangerMonthTo", "Danger window to month"))}</div>
                </SettingRow>
              </div>
            </Advanced>
          </FormSection>
        </FormSections>
      )}

      {tab === "who" && (
        <FormSections>
          <FormSection id="assignment" title="Who works retention" info="Which role owns each retention queue, and how retention reps share it.">
            <SettingRow label="Who owns each queue" change="A role with nobody in it falls back: the save queue to each policy's writing agent, the others to you.">
              <div className="grid max-w-[640px] gap-3">
                {LA5_QUEUES.map((q: La5Queue) => (
                  <label key={q} className="grid items-center gap-2 text-sm text-[var(--ink)] @xl:grid-cols-[14rem_minmax(0,1fr)]">{LA5_QUEUE_LABELS[q]}
                    <select className={cn(inputControl, "w-60")} disabled={dis} value={rules[q]} onChange={(e) => setRules({ ...rules, [q]: e.target.value as La5OwnerRole })}>
                      {LA5_OWNER_ROLES.map((r) => <option key={r} value={r}>{LA5_OWNER_ROLE_LABELS[r]}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </SettingRow>
            <SettingRow label="Share work between retention reps" sub={hub.reps.length ? `${hub.reps.length} rep${hub.reps.length === 1 ? "" : "s"}: ${hub.reps.map((r) => r.name).join(", ")}` : "Nobody holds the retention role yet"} change="Round-robin takes turns. By carrier gives each carrier to one rep. By exposure gives the largest advance at risk to your first rep.">
              <Segmented label="Share work between retention reps" disabled={dis} value={draft.assignmentStrategy} onChange={(v) => set("assignmentStrategy", v)} options={[{ key: "round_robin", label: "Round-robin" }, { key: "by_carrier", label: "By carrier" }, { key: "by_exposure", label: "By exposure" }]} />
              {hub.reps.length > 0 && draft.assignmentStrategy === "by_carrier" && (
                <div className="grid max-w-[640px] gap-2">
                  {hub.carriers.map((c) => (
                    <label key={c.id} className="grid items-center gap-2 text-sm text-[var(--ink)] @xl:grid-cols-[14rem_minmax(0,1fr)]">{c.name}
                      <select className={cn(inputControl, "w-60")} disabled={dis} value={draft.assignmentCarrierReps[c.id] ?? ""} onChange={(e) => { const next = { ...draft.assignmentCarrierReps }; if (e.target.value) next[c.id] = e.target.value; else delete next[c.id]; set("assignmentCarrierReps", next); }}>
                        <option value="">Round-robin</option>
                        {hub.reps.map((r) => <option key={r.userId} value={r.userId}>{r.name}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              {hub.reps.length > 0 && draft.assignmentStrategy === "by_exposure" && (
                <ol className="m-0 flex max-w-[480px] list-none flex-col gap-2 p-0 text-sm">
                  {[...hub.reps].sort((a, b) => ((draft.assignmentRepOrder.indexOf(a.userId) + 1) || 999) - ((draft.assignmentRepOrder.indexOf(b.userId) + 1) || 999)).map((r, i, list) => (
                    <li key={r.userId} className="flex items-center gap-2">
                      <span className="w-6 tabular-nums text-[var(--muted)]">{i + 1}.</span>
                      <span className="flex-1 text-[var(--ink)]">{r.name}</span>
                      <Button size="sm" variant="outline" disabled={dis || i === 0} onClick={() => { const ids = list.map((x) => x.userId); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; set("assignmentRepOrder", ids); }}>Move up</Button>
                    </li>
                  ))}
                </ol>
              )}
            </SettingRow>
            <SettingRow label="Hand a reinstatement to the writing agent" platform={platform("reinstatementEscalateDays")} change="Inside this many days of the carrier's deadline, the agent who sold the policy takes the case over.">
              {num("reinstatementEscalateDays", "To the writing agent inside (days)", { unit: "days before its deadline" })}
            </SettingRow>
            <p className="m-0 text-sm text-[var(--muted)]">Who holds the retention role is set in <Link className="underline" href="/app/settings#team-access">Team &amp; access</Link>.</p>
          </FormSection>
        </FormSections>
      )}

      {tab === "campaigns" && (
        <FormSections>
          <FormSection id="campaigns" title="Paper bill to bank draft" info="The campaign that moves clients billed by mail onto a bank draft.">
            <SettingRow label="After a client says no, ask again in" platform={platform("billDeclineCooloffDays")} change="They leave the campaign list until then.">
              {num("billDeclineCooloffDays", "Paper-bill decline cooling-off (days)", { unit: "days" })}
            </SettingRow>
            <SettingRow label="Talk track" sub="Empty uses Insurvas's" change="What the rep reads on the campaign card.">
              <textarea aria-label="Talk track" className={cn(textareaControl, "mt-0 min-h-28 max-w-[640px]")} disabled={dis} maxLength={4000} placeholder={PLATFORM_TALK_TRACK} value={draft.billTalkTrack ?? ""} onChange={(e) => set("billTalkTrack", e.target.value.trim() ? e.target.value : null)} />
            </SettingRow>
          </FormSection>

          <FormSection id="reinstatement" title="Reinstatement countdown" info="How a lapsed policy's reinstatement case is marked as its deadline nears.">
            <SettingRow label="Turn a case" change="Days left before the carrier's reinstatement deadline. Each carrier's window is kept by Insurvas.">
              <div className="flex flex-wrap gap-4">
                {inline("Amber with", num("reinstatementAmberDays", "Amber inside (days)", { unit: "days" }))}
                {inline("Red with", num("reinstatementRedDays", "Red inside (days)", { unit: "days" }))}
                {inline("Pinned to the top with", num("reinstatementPinDays", "Pinned inside (days)", { unit: "days" }))}
              </div>
            </SettingRow>
            <Advanced summary="Advanced" hint={`Fail a servicing request ${draft.servicingGraceDays} days after its expected date`}>
              <SettingRow id="servicing" label="Fail a servicing request" platform={platform("servicingGraceDays")} change="A carrier file that still disagrees this many days after a change was due fails the request.">
                {num("servicingGraceDays", "Days after the expected date before a request fails", { unit: "days after its expected date" })}
              </SettingRow>
            </Advanced>
          </FormSection>

          <FormSection id="winback" title="Win-back: wait before calling a lapsed client" info="How long a lapsed client rests before they come back as a lead, by why the policy lapsed.">
            <div className="grid max-w-[720px] gap-3">
              {WINBACK_REASONS.map((r) => (
                <div key={r} className="grid items-center gap-2 text-sm text-[var(--ink)] @xl:grid-cols-[minmax(0,20rem)_auto_minmax(0,1fr)]">
                  {WINBACK_LABELS[r]}
                  <span className="flex items-center gap-2 text-[var(--muted)]"><input aria-label={`${WINBACK_LABELS[r]} (days)`} className={cn(inputControl, "w-24 tabular-nums")} disabled={dis} type="number" min={WINBACK_LIMITS[r].min} max={WINBACK_LIMITS[r].max} value={draft.winbackDays[r]} onChange={(e) => set("winbackDays", { ...draft.winbackDays, [r]: Math.round(n(e.target.value)) })} />days</span>
                  <span className="text-xs text-[var(--muted)]">{draft.winbackDays[r] !== PLATFORM_DEFAULT_SETTINGS.winbackDays[r] ? `Insurvas: ${PLATFORM_DEFAULT_SETTINGS.winbackDays[r]}` : ""}</span>
                </div>
              ))}
            </div>
            <LockedNote>Someone who said they could not afford it is never called back sooner than {PLATFORM_CAPS.winbackAffordabilityFloorDays} days. Shortening their wait asks you to type a word to confirm.</LockedNote>
          </FormSection>
        </FormSections>
      )}

      {tab === "holdout" && (
        <FormSections>
          <FormSection id="holdout" title="Holdout" info="A measured way to know whether working the save queue saves policies.">
            {/* Four paragraphs open by default buried the switch; the text is one click away. */}
            <Advanced summary="How the holdout works" hint={saved.holdoutEnabled || acknowledged ? undefined : "Read this before switching it on"}>
              <div className="flex max-w-[78ch] flex-col gap-2 text-sm text-[var(--ink)]">
                {HOLDOUT_EXPLANATION.map((p, i) => <p key={i} className="m-0">{p}</p>)}
              </div>
            </Advanced>
            {!saved.holdoutEnabled && canEdit && (
              <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                <input type="checkbox" className={checkboxControl} checked={acknowledged} onChange={(e) => { setAcknowledged(e.target.checked); if (!e.target.checked) set("holdoutEnabled", false); }} />
                I have read what the holdout does
              </label>
            )}
            <SettingRow label="Holdout" sub={!saved.holdoutEnabled && !acknowledged ? "Read the text above first" : undefined} change={turningHoldoutOn ? "Saving switches it on. Policies start being held back in the next radar run." : undefined}>
              <span className="flex items-center gap-3 text-sm text-[var(--ink)]">
                <Switch label="Holdout" checked={draft.holdoutEnabled} disabled={dis || (!saved.holdoutEnabled && !acknowledged)} onChange={(on) => set("holdoutEnabled", on)} />
                {draft.holdoutEnabled ? "On" : "Off"}
              </span>
            </SettingRow>
            <SettingRow label="Hold back" change="How much of the queue is held back, the advance at risk above which a policy never is, and how long after a prediction the outcome is read on Retention results.">
              <div className="flex flex-wrap gap-4">
                {inline("Share", num("holdoutShareBp", "Share held back (%)", { scale: 100, unit: "%" }))}
                {inline("Never hold back above", num("holdoutMaxExposureCents", "Never hold back above ($ at risk)", { scale: 100, prefix: "$", unit: "at risk" }))}
                {inline("Look after", num("predictionHorizonDays", "Look after (days)", { unit: "days" }))}
              </div>
            </SettingRow>
            <LockedNote>The share can never be more than {PLATFORM_CAPS.holdoutCeilingBp / 100}%. <Link className="underline" href="/app/retention-results">Retention results</Link></LockedNote>
          </FormSection>
          <p className="m-0 text-sm text-[var(--muted)]">Insurvas keeps each carrier&apos;s retention windows, grace periods and chargeback rules. Draft days are capped at the {PLATFORM_CAPS.draftDayCap}th: carriers reject the 29th to the 31st.</p>
        </FormSections>
      )}

      <SettingsSaveBar visible={canEdit && dirty} note={`${pending} unsaved change${pending === 1 ? "" : "s"} to the retention settings`}>
        <DraftActions dirty={dirty} saving={busy} disabled={turningHoldoutOn && !acknowledged} onDiscard={discard} onSave={() => void save()} />
      </SettingsSaveBar>

      <ConfirmDialog open={asking} onOpenChange={(open) => { if (!open) { setAsking(false); setConfirmation(""); } }} busy={busy}
        title="Call people who could not afford it sooner?"
        description={`You are shortening the wait from ${saved.winbackDays.affordability} to ${draft.winbackDays.affordability} days for clients who said they could not afford their policy.`}
        confirmLabel={`Shorten to ${draft.winbackDays.affordability} days`} cancelLabel={`Keep ${saved.winbackDays.affordability} days`}
        confirmDisabled={confirmation.trim() !== AFFORDABILITY_CONFIRMATION}
        fields={<label className="flex flex-col gap-1.5 text-label text-[var(--body)]">Type {AFFORDABILITY_CONFIRMATION} to confirm<input className={inputControl} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" /></label>}
        onConfirm={() => void save(confirmation)} />
      <ConfirmDialog open={resetting} onOpenChange={setResetting} busy={busy} destructive={false}
        title={`Reset ${TABS.find((t) => t.key === tab)?.label} to Insurvas values?`}
        description={`Every value on this tab goes back to Insurvas's.${tab === "who" ? " Queue owners are not touched." : ""} The change is recorded in History.`}
        confirmLabel="Reset to Insurvas values" cancelLabel="Keep my values" onConfirm={() => void resetTab()} />
    </div>
  );
}
