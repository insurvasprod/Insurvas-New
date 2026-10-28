"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { InfoTip } from "@/components/ui/info-tip";
import { TableCard } from "@/components/ui/table-card";
import { LA5_OWNER_ROLE_LABELS, LA5_OWNER_ROLES, LA5_QUEUE_LABELS, LA5_QUEUES, type La5OwnerRole, type La5Queue } from "@/lib/retention/assignment";
import { PLATFORM_TALK_TRACK } from "@/lib/retention/campaign";
import { ASSIGNMENT_STRATEGIES, ASSIGNMENT_STRATEGY_LABELS, PLATFORM_CAPS, PLATFORM_DEFAULT_SETTINGS, SIGNAL_LABELS, SIGNALS, WINBACK_REASONS, type RetentionSettings, type Weights } from "@/lib/retention/constants";
import { SORT_LABELS, SORTS } from "@/lib/retention/queue";
import { AFFORDABILITY_CONFIRMATION, FIELDS, HOLDOUT_EXPLANATION, HUB_SECTION_LABELS, thresholdConsequence, WINBACK_LABELS, WINBACK_LIMITS, weightTotal, type HubSection } from "@/lib/retention/settingsHub";
import type { Hub } from "@/lib/retention/settingsHubStore";
import { notify } from "@/lib/notify";

type Preview = { moved: number; up: number; down: number; intoCritical: number; total: number };

async function post(body: Record<string, unknown>) {
  const res = await fetch("/api/app/retention/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? "That didn't save");
  return json;
}

const field = "flex flex-col gap-1 text-sm";
const n = (v: string) => (v.trim() === "" ? NaN : Number(v));
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The settings keys a section saves (the rest of the draft is left as saved). */
function keysOf(section: HubSection): Array<keyof RetentionSettings> {
  const keys = (Object.keys(FIELDS) as Array<keyof typeof FIELDS>).filter((k) => FIELDS[k].section === section) as Array<keyof RetentionSettings>;
  if (section === "winback") keys.push("winbackDays");
  if (section === "assignment") keys.push("assignmentCarrierReps", "assignmentRepOrder");
  return keys;
}

/**
 * LA-5.11 (Notion sprint) · every LA-5 setting in one place. Each section saves on its own and resets
 * to the platform's values on its own. Caps are shown, locked. Weights are previewed before they are
 * saved, and a save is a new version. The holdout's explanation sits above its switch and cannot be
 * edited; switching it on needs the explanation acknowledged.
 */
export function RetentionSettingsBoard({ hub, canEdit }: { hub: Hub; canEdit: boolean }) {
  const router = useRouter();
  const [saved, setSaved] = useState<RetentionSettings>(hub.settings);
  const [draft, setDraft] = useState<RetentionSettings>(hub.settings);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [rules, setRules] = useState(hub.rules);
  const [weights, setWeights] = useState<Weights>(hub.weights);
  const [preview, setPreview] = useState<{ for: string; result: Preview } | null>(null);
  const set = <K extends keyof RetentionSettings>(k: K, v: RetentionSettings[K]) => setDraft((cur) => ({ ...cur, [k]: v }));
  const dis = !canEdit;
  const total = weightTotal(weights);
  const weightsKey = JSON.stringify(weights);
  const consequence = useMemo(() => (hub.distribution ? thresholdConsequence(hub.distribution, draft) : null), [hub.distribution, draft]);

  const run = async (label: string, body: Record<string, unknown>, done: (json: { changes?: unknown[] }) => void) => {
    setBusy(label);
    try {
      const json = await post(body);
      done(json);
      notify.done(json.changes?.length ? `Saved ${json.changes.length} change${json.changes.length === 1 ? "" : "s"}` : "Nothing changed");
      router.refresh();
    } catch (e) {
      notify.fail(e instanceof Error ? e.message : "That didn't save");
    } finally {
      setBusy(null);
    }
  };
  const saveSection = (section: HubSection) => {
    const next = { ...saved } as RetentionSettings;
    for (const k of keysOf(section)) (next as Record<string, unknown>)[k] = draft[k];
    void run(section, { action: "save_settings", settings: next, confirmation: confirmation || null, holdout_acknowledged: acknowledged }, () => { setSaved(next); setConfirmation(""); });
  };
  const resetSection = (section: HubSection) => {
    void run(`reset-${section}`, { action: "reset", section, confirmation: confirmation || null }, () => {
      if (section === "weights") { setWeights({ ...hub.platformWeights }); return; }
      const next = { ...saved, winbackDays: { ...saved.winbackDays } } as RetentionSettings;
      for (const k of keysOf(section)) (next as Record<string, unknown>)[k] = (PLATFORM_DEFAULT_SETTINGS as Record<string, unknown>)[k];
      if (section === "assignment") { next.assignmentCarrierReps = {}; next.assignmentRepOrder = []; }
      setSaved(next);
      setDraft((cur) => ({ ...cur, ...Object.fromEntries(keysOf(section).map((k) => [k, next[k]])) }));
    });
  };
  const dirty = (section: HubSection) => keysOf(section).some((k) => !sameJson(draft[k], saved[k]));

  const section = (id: HubSection | "locked" | "recent-changes", title: string, children: ReactNode, opts: { save?: boolean; note?: ReactNode } = {}) => (
    <TableCard>
      <div id={id} className="flex scroll-mt-24 flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{title}</h2>
          {canEdit && opts.save && id !== "locked" && id !== "recent-changes" ? (
            <span className="flex gap-2">
              <Button variant="outline" disabled={busy !== null} onClick={() => resetSection(id as HubSection)}>Reset to defaults</Button>
              {id !== "weights" && <Button disabled={busy !== null || !dirty(id as HubSection)} onClick={() => saveSection(id as HubSection)}>{busy === id ? "Saving…" : "Save"}</Button>}
            </span>
          ) : null}
        </div>
        {children}
        {opts.note ? <div className="text-xs text-muted-foreground">{opts.note}</div> : null}
      </div>
    </TableCard>
  );
  const num = (k: keyof RetentionSettings, label: string, opts: { suffix?: string; scale?: number; tip?: string } = {}) => {
    const scale = opts.scale ?? 1;
    const spec = FIELDS[k as keyof typeof FIELDS];
    return (
      <label className={field}>
        <span className="inline-flex items-center gap-1">{label}{opts.tip ? <InfoTip label={`About ${label}`}>{opts.tip}</InfoTip> : null}</span>
        <input className={toolbarControl} disabled={dis} type="number" step={scale === 1 ? 1 : 0.01} min={spec?.min !== undefined ? spec.min / scale : undefined} max={spec?.max !== undefined ? spec.max / scale : undefined}
          value={Number.isFinite(draft[k] as number) ? (draft[k] as number) / scale : ""} onChange={(e) => set(k, Math.round(n(e.target.value) * scale) as never)} />
        <span className="text-xs text-muted-foreground">Platform: {(PLATFORM_DEFAULT_SETTINGS[k] as number) / scale}{opts.suffix ?? ""}</span>
      </label>
    );
  };

  const affordabilityShorter = draft.winbackDays.affordability < saved.winbackDays.affordability;
  const turningHoldoutOn = draft.holdoutEnabled && !saved.holdoutEnabled;

  return (
    <div className="flex flex-col gap-6">
      {!canEdit ? <p className="text-sm text-muted-foreground">Read only: your plan is paused.</p> : null}

      {section("weights", HUB_SECTION_LABELS.weights, (
        <>
          <table className="portal-lead-table w-full min-w-[560px] text-left text-sm">
            <thead><tr><th>Signal</th><th className="w-[140px] text-right">Weight</th><th className="w-[140px] text-right">Platform</th></tr></thead>
            <tbody>
              {SIGNALS.map((s) => (
                <tr key={s}>
                  <td>{SIGNAL_LABELS[s]}</td>
                  <td className="text-right"><input aria-label={`${SIGNAL_LABELS[s]} weight`} className={`${toolbarControl} w-24 text-right`} disabled={dis} type="number" min={0} max={100} value={weights[s]} onChange={(e) => setWeights({ ...weights, [s]: Math.round(n(e.target.value)) || 0 })} /></td>
                  <td className="text-right tabular-nums text-muted-foreground">{hub.platformWeights[s]}</td>
                </tr>
              ))}
              <tr className="font-semibold"><td>Total</td><td className={`text-right tabular-nums ${total === 100 ? "" : "text-[var(--error-ink)]"}`}>{total}</td><td className="text-right tabular-nums text-muted-foreground">100</td></tr>
            </tbody>
          </table>
          {total !== 100 && <p role="alert" className="text-sm text-[var(--error-ink)]">The weights add up to {total}. They must add up to 100 to be saved.</p>}
          {preview && preview.for === weightsKey && (
            <p className="text-sm">Against today&apos;s book: <strong>{preview.result.moved.toLocaleString("en-US")}</strong> of {preview.result.total.toLocaleString("en-US")} policies change band ({preview.result.up.toLocaleString("en-US")} up, {preview.result.down.toLocaleString("en-US")} down; {preview.result.intoCritical.toLocaleString("en-US")} newly critical).</p>
          )}
          {canEdit && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" disabled={busy !== null || total !== 100} onClick={() => { setBusy("preview"); post({ action: "preview_weights", weights }).then((j) => setPreview({ for: weightsKey, result: j.preview })).catch((e) => notify.fail(e.message)).finally(() => setBusy(null)); }}>{busy === "preview" ? "Previewing…" : "Preview"}</Button>
              <Button disabled={busy !== null || total !== 100 || preview?.for !== weightsKey || sameJson(weights, hub.weights)} onClick={() => void run("weights", { action: "save_weights", weights }, () => setPreview(null))}>{busy === "weights" ? "Saving…" : `Save as version ${hub.weightVersion + 1}`}</Button>
            </div>
          )}
        </>
      ), { save: true, note: <>Now scoring with version {hub.weightVersion}{hub.weightIsPlatform ? " (the platform's)" : ""}. Saving makes a new version; scores already made keep theirs, so Does it work? can compare them. Preview before saving.</> })}

      {section("thresholds", HUB_SECTION_LABELS.thresholds, (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            {num("mediumFrom", "Medium from")}
            {num("highFrom", "High from")}
            {num("criticalFrom", "Critical from")}
            <label className={field}>Save queue takes
              <select className={toolbarControl} disabled={dis} value={draft.queueMinBand} onChange={(e) => set("queueMinBand", e.target.value as RetentionSettings["queueMinBand"])}>
                <option value="medium">Medium and above</option><option value="high">High and above</option><option value="critical">Critical only</option>
              </select>
              <span className="text-xs text-muted-foreground">Platform: high and above</span>
            </label>
          </div>
          {consequence ? (
            <p className="text-sm">At these thresholds, <strong>{consequence.bands.critical.toLocaleString("en-US")}</strong> policies are critical and <strong>{consequence.bands.high.toLocaleString("en-US")}</strong> high ({consequence.bands.medium.toLocaleString("en-US")} medium, {consequence.bands.low.toLocaleString("en-US")} low) — your queue would hold <strong>{consequence.queue.toLocaleString("en-US")}</strong> cards{consequence.queue > consequence.shown ? `, showing ${consequence.shown}` : ""}.</p>
          ) : <p className="text-sm text-muted-foreground">No policy is scored yet, so there is no volume to show.</p>}
        </>
      ), { save: true })}

      {section("queue", HUB_SECTION_LABELS.queue, (
        <div className="grid gap-3 sm:grid-cols-4">
          {num("workedCooldownDays", "Worked-card cooldown (days)")}
          {num("maxCards", "Most cards shown")}
          <label className={field}>Default sort
            <select className={toolbarControl} disabled={dis} value={draft.queueDefaultSort} onChange={(e) => set("queueDefaultSort", e.target.value as RetentionSettings["queueDefaultSort"])}>
              {SORTS.map((s) => <option key={s} value={s}>{SORT_LABELS[s]}</option>)}
            </select>
            <span className="text-xs text-muted-foreground">Platform: risk × money</span>
          </label>
          <label className={field}>With nothing high risk
            <select className={toolbarControl} disabled={dis} value={draft.includeMediumWhenEmpty ? "yes" : "no"} onChange={(e) => set("includeMediumWhenEmpty", e.target.value === "yes")}>
              <option value="no">Show an empty queue</option><option value="yes">Show medium instead</option>
            </select>
            <span className="text-xs text-muted-foreground">Platform: an empty queue</span>
          </label>
        </div>
      ), { save: true })}

      {section("signals", HUB_SECTION_LABELS.signals, (
        <div className="grid gap-3 sm:grid-cols-3">
          {num("sampleFloor", "Lead-source sample floor", { tip: "Below this many policies from a lead source, its survival rate is unavailable rather than weak." })}
          {num("carrierSampleFloor", "Carrier sample floor", { tip: "Below this many policies with a carrier, its lapse rate is unavailable rather than weak." })}
          <span />
          {num("affordabilityLowBp", "Affordable below (% of income)", { scale: 100, suffix: "%" })}
          {num("affordabilityHighBp", "Unaffordable above (% of income)", { scale: 100, suffix: "%" })}
          <span />
          {num("dangerMonthFrom", "Danger window from month")}
          {num("dangerMonthTo", "Danger window to month")}
        </div>
      ), { save: true })}

      {section("campaigns", HUB_SECTION_LABELS.campaigns, (
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-3">{num("billDeclineCooloffDays", "Paper-bill decline cooling-off (days)")}</div>
          <label className={field}>Talk track
            <textarea className={`${toolbarControl} min-h-28 py-2`} disabled={dis} maxLength={4000} placeholder={PLATFORM_TALK_TRACK} value={draft.billTalkTrack ?? ""} onChange={(e) => set("billTalkTrack", e.target.value.trim() ? e.target.value : null)} />
            <span className="text-xs text-muted-foreground">Empty uses the platform&apos;s.</span>
          </label>
        </div>
      ), { save: true })}

      {section("servicing", HUB_SECTION_LABELS.servicing, (
        <div className="grid gap-3 sm:grid-cols-3">{num("servicingGraceDays", "Days after the expected date before a request fails", { tip: "A carrier file that still disagrees this many days after a change was due fails the request." })}</div>
      ), { save: true })}

      {section("reinstatement", HUB_SECTION_LABELS.reinstatement, (
        <div className="grid gap-3 sm:grid-cols-4">
          {num("reinstatementAmberDays", "Amber inside (days)")}
          {num("reinstatementRedDays", "Red inside (days)")}
          {num("reinstatementPinDays", "Pinned inside (days)")}
          {num("reinstatementEscalateDays", "To the writing agent inside (days)", { tip: "Inside this many days of the deadline a case moves from the retention rep to the agent who sold it." })}
        </div>
      ), { save: true, note: <>Insurvas keeps each carrier&apos;s reinstatement window.</> })}

      {section("winback", HUB_SECTION_LABELS.winback, (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {WINBACK_REASONS.map((r) => (
              <label key={r} className={field}>{WINBACK_LABELS[r]} (days)
                <input className={toolbarControl} disabled={dis} type="number" min={WINBACK_LIMITS[r].min} max={WINBACK_LIMITS[r].max} value={draft.winbackDays[r]} onChange={(e) => set("winbackDays", { ...draft.winbackDays, [r]: Math.round(n(e.target.value)) })} />
                <span className="text-xs text-muted-foreground">Platform: {PLATFORM_DEFAULT_SETTINGS.winbackDays[r]}{r === "affordability" ? ` · never under ${PLATFORM_CAPS.winbackAffordabilityFloorDays}` : ""}</span>
              </label>
            ))}
          </div>
          {affordabilityShorter && (
            <label className={`${field} max-w-sm`}>
              <span className="text-[var(--error-ink)]">Shortening the cooling-off for someone who said they could not afford it. Type {AFFORDABILITY_CONFIRMATION} to confirm.</span>
              <input className={toolbarControl} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" />
            </label>
          )}
        </>
      ), { save: true })}

      {section("holdout", HUB_SECTION_LABELS.holdout, (
        <>
          <div className="flex flex-col gap-2 text-sm text-foreground">
            {HOLDOUT_EXPLANATION.map((p, i) => <p key={i}>{p}</p>)}
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className={field}>Holdout
              <select className={toolbarControl} disabled={dis || (!saved.holdoutEnabled && !acknowledged)} value={draft.holdoutEnabled ? "on" : "off"} onChange={(e) => set("holdoutEnabled", e.target.value === "on")}>
                <option value="off">Off</option><option value="on">On</option>
              </select>
              <span className="text-xs text-muted-foreground">Platform: off</span>
            </label>
            {num("holdoutShareBp", "Share held back (%)", { scale: 100, suffix: "%" })}
            {num("holdoutMaxExposureCents", "Never hold back above ($ at risk)", { scale: 100 })}
            {num("predictionHorizonDays", "Look after (days)", { tip: "Days between a prediction and the look at what happened, for both the predictions and the holdout." })}
          </div>
          {!saved.holdoutEnabled && canEdit && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={acknowledged} onChange={(e) => { setAcknowledged(e.target.checked); if (!e.target.checked) set("holdoutEnabled", false); }} />
              I have read what the holdout does.
            </label>
          )}
          {turningHoldoutOn && !acknowledged ? <p role="alert" className="text-sm text-[var(--error-ink)]">Read what the holdout does before switching it on.</p> : null}
        </>
      ), { save: true, note: <>The share can never be more than {PLATFORM_CAPS.holdoutCeilingBp / 100}%. Results are on <Link className="underline" href="/app/retention-results">Does it work?</Link>.</> })}

      {section("assignment", HUB_SECTION_LABELS.assignment, (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {LA5_QUEUES.map((q: La5Queue) => (
              <label key={q} className={field}>{LA5_QUEUE_LABELS[q]}
                <select className={toolbarControl} disabled={dis} value={rules[q]} onChange={(e) => setRules({ ...rules, [q]: e.target.value as La5OwnerRole })}>
                  {LA5_OWNER_ROLES.map((r) => <option key={r} value={r}>{LA5_OWNER_ROLE_LABELS[r]}</option>)}
                </select>
              </label>
            ))}
          </div>
          {canEdit && <div className="flex justify-end"><Button variant="outline" disabled={busy !== null || sameJson(rules, hub.rules)} onClick={() => void run("rules", { action: "save_rules", rules }, () => undefined)}>{busy === "rules" ? "Saving…" : "Save queue owners"}</Button></div>}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={field}>Among retention reps
              <select className={toolbarControl} disabled={dis} value={draft.assignmentStrategy} onChange={(e) => set("assignmentStrategy", e.target.value as RetentionSettings["assignmentStrategy"])}>
                {ASSIGNMENT_STRATEGIES.map((s) => <option key={s} value={s}>{ASSIGNMENT_STRATEGY_LABELS[s]}</option>)}
              </select>
            </label>
          </div>
          {hub.reps.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody holds the retention role, so the save queue goes to each policy&apos;s writing agent and the other queues to you. Add a retention rep in <Link className="underline" href="/app/settings#team-access">Team &amp; access</Link>.</p>
          ) : draft.assignmentStrategy === "by_carrier" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {hub.carriers.map((c) => (
                <label key={c.id} className="flex items-center justify-between gap-3 text-sm">{c.name}
                  <select className={toolbarControl} disabled={dis} value={draft.assignmentCarrierReps[c.id] ?? ""} onChange={(e) => { const next = { ...draft.assignmentCarrierReps }; if (e.target.value) next[c.id] = e.target.value; else delete next[c.id]; set("assignmentCarrierReps", next); }}>
                    <option value="">Round-robin</option>
                    {hub.reps.map((r) => <option key={r.userId} value={r.userId}>{r.name}</option>)}
                  </select>
                </label>
              ))}
            </div>
          ) : draft.assignmentStrategy === "by_exposure" ? (
            <ol className="flex flex-col gap-2 text-sm">
              {[...hub.reps].sort((a, b) => ((draft.assignmentRepOrder.indexOf(a.userId) + 1) || 999) - ((draft.assignmentRepOrder.indexOf(b.userId) + 1) || 999)).map((r, i, list) => (
                <li key={r.userId} className="flex items-center gap-2">
                  <span className="w-6 tabular-nums text-muted-foreground">{i + 1}.</span>
                  <span className="flex-1">{r.name}</span>
                  <Button size="sm" variant="outline" disabled={dis || i === 0} onClick={() => { const ids = list.map((x) => x.userId); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; set("assignmentRepOrder", ids); }}>Up</Button>
                </li>
              ))}
            </ol>
          ) : null}
        </>
      ), { save: true, note: <>Who holds the retention role is set in <Link className="underline" href="/app/settings#team-access">Team &amp; access</Link>.</> })}

      {section("locked", "Locked", (
        <ul className="flex flex-col gap-2 text-sm">
          <li><strong>Holdout ceiling: {PLATFORM_CAPS.holdoutCeilingBp / 100}%.</strong> <span className="text-muted-foreground">A misconfiguration must never withhold most of the queue.</span></li>
          <li><strong>Win-back affordability floor: {PLATFORM_CAPS.winbackAffordabilityFloorDays} days.</strong> <span className="text-muted-foreground">Someone who could not afford it is never called back sooner.</span></li>
          <li><strong>Draft day cap: the {PLATFORM_CAPS.draftDayCap}th.</strong> <span className="text-muted-foreground">Carriers reject the 29th to the 31st.</span></li>
        </ul>
      ), { note: <>Insurvas keeps each carrier&apos;s retention windows, grace periods and chargeback rules, never here.</> })}

      {hub.changes.length ? section("recent-changes", "Recent changes", (
        <ul className="text-sm">{hub.changes.map((c, i) => <li key={i}>{c.at.slice(0, 16).replace("T", " ")} — {c.by} — {c.setting.replace(/_/g, " ")}: {JSON.stringify(c.from)} → {JSON.stringify(c.to)}</li>)}</ul>
      )) : null}
    </div>
  );
}
