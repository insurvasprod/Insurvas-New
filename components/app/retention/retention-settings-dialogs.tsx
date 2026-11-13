"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { NumberField, postSettings, SettingDialog, useDialogSave } from "@/components/app/retention/retention-settings-rows";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { checkboxControl, control, Field, inputControl, Switch, textareaControl } from "@/components/ui/field";
import { Segmented } from "@/components/ui/view-tabs";
import { DEFAULT_OWNER_ROLE, LA5_OWNER_ROLE_LABELS, LA5_OWNER_ROLES, LA5_QUEUE_LABELS, type La5OwnerRole, type La5Queue } from "@/lib/retention/assignment";
import { PLATFORM_TALK_TRACK } from "@/lib/retention/campaign";
import { PLATFORM_CAPS, PLATFORM_DEFAULT_SETTINGS, type RetentionSettings, type WinbackReason } from "@/lib/retention/constants";
import { SORT_LABELS, SORTS } from "@/lib/retention/queue";
import { AFFORDABILITY_CONFIRMATION, FIELDS, HOLDOUT_EXPLANATION, thresholdConsequence, validate, WINBACK_LABELS, WINBACK_LIMITS } from "@/lib/retention/settingsHub";
import type { Hub } from "@/lib/retention/settingsHubStore";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

/**
 * Settings › Retention, round 7 (owner pick 7·A, 2026-11-10; docs/la4/mockups-r7/retention.html 7·2) and round 8
 * (a right sheet per row, docs/design/settings-r8/money-compliance-settings.html §4): one sheet per setting row. Each sends the agency's whole settings with its one change merged in (the hub's save takes the
 * whole draft, as the long form did), so nothing else moves. Two changes still ask first: a shorter wait for clients
 * who could not afford it (today's typed confirm), and switching the holdout on (its explanation acknowledged).
 */

export type NumKey = { [K in keyof RetentionSettings]: RetentionSettings[K] extends number ? K : never }[keyof RetentionSettings];
export type NumSpec = { key: NumKey; label: string; unit?: string; scale?: number };

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const count = (v: number) => v.toLocaleString("en-US");
export const isYours = (settings: RetentionSettings, keys: readonly (keyof RetentionSettings)[]) => keys.some((k) => !sameJson(settings[k], PLATFORM_DEFAULT_SETTINGS[k]));
const withDefaults = (settings: RetentionSettings, keys: readonly (keyof RetentionSettings)[]): RetentionSettings => {
  const next = { ...settings } as Record<string, unknown>;
  for (const k of keys) next[k] = PLATFORM_DEFAULT_SETTINGS[k];
  return next as RetentionSettings;
};

/**
 * Save the merged settings, toast what changed with Undo (round 8: "Undo puts the last value back"), and let the page
 * read them again. Undo sends `before` back the same way; a change that needs a typed confirm says why it can't.
 */
function useSettingsSave(onSaved: (next: RetentionSettings) => void, onClose: () => void, before: RetentionSettings) {
  const router = useRouter();
  const save = useDialogSave();
  const send = (next: RetentionSettings, opts: { confirmation?: string | null; acknowledged?: boolean; back?: boolean } = {}) => save.run(async () => {
    const json = await postSettings({ action: "save_settings", settings: next, confirmation: opts.confirmation ?? null, holdout_acknowledged: opts.acknowledged ?? false });
    const n = json.changes?.length ?? 0;
    const undo = n ? {
      action: {
        label: "Undo",
        onClick: () => void postSettings({ action: "save_settings", settings: before, confirmation: null, holdout_acknowledged: false }).then(
          () => { onSaved(before); router.refresh(); notify.done("Put back as it was."); },
          (err: unknown) => notify.fail(err instanceof Error ? err.message : "That didn't save"),
        ),
      },
    } : undefined;
    notify.done(opts.back ? (n ? `${plural(n, "value")} back to Insurvas's` : "Already on Insurvas's values") : n ? `Saved ${plural(n, "change")}` : "Nothing changed", undo);
    onSaved(next);
    router.refresh();
    onClose();
  });
  return { ...save, send };
}

/** A stored number in its shown units ("10" for 1,000 basis points). */
const shown = (settings: RetentionSettings, spec: NumSpec) => String(settings[spec.key] / (spec.scale ?? 1));

/** The drafts as stored numbers, or the first problem in words. */
function readNumbers(specs: NumSpec[], drafts: Record<string, string>): Partial<RetentionSettings> | string {
  const out: Record<string, number> = {};
  for (const spec of specs) {
    const scale = spec.scale ?? 1;
    const limits = FIELDS[spec.key as keyof typeof FIELDS];
    const range = limits?.min !== undefined && limits.max !== undefined ? `${count(limits.min / scale)} to ${count(limits.max / scale)}` : "a number";
    const text = (drafts[spec.key] ?? "").trim();
    const value = Math.round(Number(text) * scale);
    if (!text || !Number.isFinite(value) || (limits?.min !== undefined && value < limits.min) || (limits?.max !== undefined && value > limits.max)) {
      return `${spec.label}: enter ${range}${spec.unit ? ` ${spec.unit === "$" ? "dollars" : spec.unit}` : ""}.`;
    }
    out[spec.key] = value;
  }
  return out as Partial<RetentionSettings>;
}

/**
 * A setting made of numbers, and any choices beside them (`extra`): the queue's rest and size, the bands, the signal
 * floors, the countdown. "Back to Insurvas's" puts every value in the row back at once.
 */
export function SettingsDialog({ title, said, settings, specs = [], keys = [], extra, readValue, canEdit, onSaved, onClose }: {
  title: string;
  said?: ReactNode;
  settings: RetentionSettings;
  specs?: NumSpec[];
  /** The row's other settings, edited in `extra`. */
  keys?: (keyof RetentionSettings)[];
  extra?: (draft: RetentionSettings, set: <K extends keyof RetentionSettings>(k: K, v: RetentionSettings[K]) => void) => ReactNode;
  readValue: ReactNode;
  canEdit: boolean;
  onSaved: (next: RetentionSettings) => void;
  onClose: () => void;
}) {
  const all = [...specs.map((s) => s.key), ...keys];
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(specs.map((s) => [s.key, shown(settings, s)])));
  const [draft, setDraft] = useState<RetentionSettings>(settings);
  const { busy, error, setError, send } = useSettingsSave(onSaved, onClose, settings);
  const set = <K extends keyof RetentionSettings>(k: K, v: RetentionSettings[K]) => { setDraft((cur) => ({ ...cur, [k]: v })); setError(null); };
  const yours = isYours(settings, all);
  const insurvas = specs.length ? specs.map((s) => count(PLATFORM_DEFAULT_SETTINGS[s.key] / (s.scale ?? 1))).join(" · ") : null;

  const save = () => {
    const numbers = readNumbers(specs, drafts);
    if (typeof numbers === "string") { setError(numbers); return; }
    const next = { ...settings, ...Object.fromEntries(keys.map((k) => [k, draft[k]])), ...numbers } as RetentionSettings;
    const problem = validate(next);
    if (problem) { setError(problem); return; }
    void send(next);
  };

  return (
    <SettingDialog
      title={title}
      said={<>{said}{said ? " " : ""}{yours && insurvas ? `Insurvas's is ${insurvas}.` : !yours ? "Insurvas's value." : null}</>}
      canEdit={canEdit}
      readValue={readValue}
      error={error}
      busy={busy}
      onSave={save}
      onBack={yours ? () => void send(withDefaults(settings, all), { back: true }) : null}
      onClose={onClose}
    >
      {specs.length > 0 && (
        <div className={cn("grid gap-4", specs.length > 1 && "sm:grid-cols-2")}>
          {specs.map((spec, i) => (
            <NumberField key={spec.key} id={`rs-${spec.key}`} autoFocus={i === 0} label={spec.label} unit={spec.unit} value={drafts[spec.key] ?? ""} onChange={(v) => { setDrafts((cur) => ({ ...cur, [spec.key]: v })); setError(null); }} />
          ))}
        </div>
      )}
      {extra?.(draft, set)}
    </SettingDialog>
  );
}

const BAND_CHOICES = [{ key: "medium", label: "Medium and above" }, { key: "high", label: "High and above" }, { key: "critical", label: "Critical only" }] as const;
export const BAND_TAKES: Record<RetentionSettings["queueMinBand"], string> = { medium: "Medium and above", high: "High and above", critical: "Critical only" };

/** The save queue takes (Radar): the band, with today's count as it changes. */
export function QueueTakesDialog({ hub, settings, canEdit, onSaved, onClose }: { hub: Hub; settings: RetentionSettings; canEdit: boolean; onSaved: (next: RetentionSettings) => void; onClose: () => void }) {
  return (
    <SettingsDialog title="The save queue takes" said="Every in-force policy gets a risk score out of 100. This decides which ones reach the save queue." settings={settings} keys={["queueMinBand"]} canEdit={canEdit} onSaved={onSaved} onClose={onClose}
      readValue={BAND_TAKES[settings.queueMinBand]}
      extra={(draft, set) => {
        const consequence = hub.distribution ? thresholdConsequence(hub.distribution, draft) : null;
        return (
          <>
            <Segmented label="The save queue takes" value={draft.queueMinBand} onChange={(v) => set("queueMinBand", v)} options={BAND_CHOICES} />
            {consequence ? (
              <p className="m-0 text-sm text-[var(--ink)]" aria-live="polite">Today your queue would hold <strong className="tabular-nums">{count(consequence.queue)}</strong> card{consequence.queue === 1 ? "" : "s"}{consequence.queue > consequence.shown ? `, showing ${count(consequence.shown)} at a time` : ""}.</p>
            ) : <p className="m-0 text-sm text-[var(--muted)]">No policy is scored yet, so there is no count to show.</p>}
          </>
        );
      }} />
  );
}

/** Queue: rest, most shown, sort, and what it shows with nothing high risk (Radar). */
export function QueueDialog({ settings, canEdit, onSaved, onClose, readValue }: { settings: RetentionSettings; canEdit: boolean; onSaved: (next: RetentionSettings) => void; onClose: () => void; readValue: ReactNode }) {
  return (
    <SettingsDialog title="Queue: rest, most shown, sort" said="A card someone worked leaves the queue for its rest; the rest wait their turn by sort order." settings={settings} canEdit={canEdit} onSaved={onSaved} onClose={onClose} readValue={readValue}
      specs={[{ key: "workedCooldownDays", label: "Rest a worked card for", unit: "days" }, { key: "maxCards", label: "Show at most", unit: "cards" }]}
      keys={["queueDefaultSort", "includeMediumWhenEmpty"]}
      extra={(draft, set) => (
        <>
          <Field label="Sort the queue by" htmlFor="rs-sort">
            <select id="rs-sort" className={control} value={draft.queueDefaultSort} onChange={(e) => set("queueDefaultSort", e.target.value as RetentionSettings["queueDefaultSort"])}>
              {SORTS.map((s) => <option key={s} value={s}>{SORT_LABELS[s]}</option>)}
            </select>
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-label text-[var(--body)]">With nothing high risk</span>
            <Segmented label="With nothing high risk" value={draft.includeMediumWhenEmpty ? "yes" : "no"} onChange={(v) => set("includeMediumWhenEmpty", v === "yes")} options={[{ key: "no", label: "Show an empty queue" }, { key: "yes", label: "Show medium instead" }]} />
          </div>
        </>
      )} />
  );
}

/** The talk track for the paper-bill campaign (Requests). Empty uses Insurvas's. */
export function TalkTrackDialog({ settings, canEdit, onSaved, onClose }: { settings: RetentionSettings; canEdit: boolean; onSaved: (next: RetentionSettings) => void; onClose: () => void }) {
  return (
    <SettingsDialog title="Talk track" said="What the rep reads on the campaign card. Empty uses Insurvas's." settings={settings} keys={["billTalkTrack"]} canEdit={canEdit} onSaved={onSaved} onClose={onClose}
      readValue={settings.billTalkTrack ?? PLATFORM_TALK_TRACK}
      extra={(draft, set) => (
        <Field label="Talk track" htmlFor="rs-talk">
          <textarea id="rs-talk" autoFocus className={cn(textareaControl, "min-h-40")} maxLength={4000} placeholder={PLATFORM_TALK_TRACK} value={draft.billTalkTrack ?? ""} onChange={(e) => set("billTalkTrack", e.target.value.trim() ? e.target.value : null)} />
        </Field>
      )} />
  );
}

/** Share work between retention reps (Who works it): the mode, and by carrier or by exposure, who. */
export function ShareDialog({ hub, settings, canEdit, onSaved, onClose, readValue }: { hub: Hub; settings: RetentionSettings; canEdit: boolean; onSaved: (next: RetentionSettings) => void; onClose: () => void; readValue: ReactNode }) {
  return (
    <SettingsDialog title="Share work between retention reps" said="Round-robin takes turns. By carrier gives each carrier to one rep. By exposure gives the largest advance at risk to your first rep." settings={settings} keys={["assignmentStrategy", "assignmentCarrierReps", "assignmentRepOrder"]} canEdit={canEdit} onSaved={onSaved} onClose={onClose} readValue={readValue}
      extra={(draft, set) => (
        <>
          <Segmented label="Share work between retention reps" value={draft.assignmentStrategy} onChange={(v) => set("assignmentStrategy", v)} options={[{ key: "round_robin", label: "Round-robin" }, { key: "by_carrier", label: "By carrier" }, { key: "by_exposure", label: "By exposure" }]} />
          {hub.reps.length > 0 && draft.assignmentStrategy === "by_carrier" && (
            <div className="grid max-h-[40vh] gap-2 overflow-y-auto">
              {hub.carriers.map((c) => (
                <label key={c.id} className="grid items-center gap-2 text-sm text-[var(--ink)] sm:grid-cols-[minmax(0,1fr)_14rem]">{c.name}
                  <select className={inputControl} value={draft.assignmentCarrierReps[c.id] ?? ""} onChange={(e) => { const next = { ...draft.assignmentCarrierReps }; if (e.target.value) next[c.id] = e.target.value; else delete next[c.id]; set("assignmentCarrierReps", next); }}>
                    <option value="">Round-robin</option>
                    {hub.reps.map((r) => <option key={r.userId} value={r.userId}>{r.name}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
          {hub.reps.length > 0 && draft.assignmentStrategy === "by_exposure" && (
            <ol className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
              {[...hub.reps].sort((a, b) => ((draft.assignmentRepOrder.indexOf(a.userId) + 1) || 999) - ((draft.assignmentRepOrder.indexOf(b.userId) + 1) || 999)).map((r, i, list) => (
                <li key={r.userId} className="flex items-center gap-2">
                  <span className="w-6 tabular-nums text-[var(--muted)]">{i + 1}.</span>
                  <span className="flex-1 text-[var(--ink)]">{r.name}</span>
                  <Button size="sm" variant="outline" disabled={i === 0} onClick={() => { const ids = list.map((x) => x.userId); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; set("assignmentRepOrder", ids); }}>Move up</Button>
                </li>
              ))}
            </ol>
          )}
          {hub.reps.length === 0 && <p className="m-0 text-sm text-[var(--muted)]">Nobody holds the retention role yet.</p>}
        </>
      )} />
  );
}

/** Who owns a queue (Who works it). Saved through the queue rules, not the settings. */
export function OwnerDialog({ queue, rules, canEdit, onSaved, onClose }: { queue: La5Queue; rules: Record<La5Queue, La5OwnerRole>; canEdit: boolean; onSaved: (next: Record<La5Queue, La5OwnerRole>) => void; onClose: () => void }) {
  const router = useRouter();
  const [role, setRole] = useState<La5OwnerRole>(rules[queue]);
  const { busy, error, run } = useDialogSave();
  const insurvas = DEFAULT_OWNER_ROLE[queue];
  const send = (to: La5OwnerRole, back = false) => run(async () => {
    const next = { ...rules, [queue]: to };
    const json = await postSettings({ action: "save_rules", rules: next });
    const n = json.changes?.length ?? 0;
    notify.done(back ? (n ? `${plural(n, "value")} back to Insurvas's` : "Already on Insurvas's values") : n ? `Saved ${plural(n, "change")}` : "Nothing changed");
    onSaved(next);
    router.refresh();
    onClose();
  });
  return (
    <SettingDialog title={`Who owns ${LA5_QUEUE_LABELS[queue]}`} said={`A role with nobody in it falls back: the save queue to each policy's writing agent, the others to you. ${rules[queue] === insurvas ? "Insurvas's value." : `Insurvas's is ${LA5_OWNER_ROLE_LABELS[insurvas]}.`}`}
      canEdit={canEdit} readValue={LA5_OWNER_ROLE_LABELS[rules[queue]]} error={error} busy={busy}
      onSave={() => void send(role)} onBack={rules[queue] === insurvas ? null : () => void send(insurvas, true)} onClose={onClose}>
      <Segmented label={`Who owns ${LA5_QUEUE_LABELS[queue]}`} value={role} onChange={setRole} options={LA5_OWNER_ROLES.map((r) => ({ key: r, label: LA5_OWNER_ROLE_LABELS[r] }))} />
    </SettingDialog>
  );
}

/**
 * A lapse reason's wait before calling (Win-back). A shorter wait for clients who said they could not afford it
 * asks first, with today's typed confirm.
 */
export function WinbackDialog({ reason, settings, canEdit, onSaved, onClose }: { reason: WinbackReason; settings: RetentionSettings; canEdit: boolean; onSaved: (next: RetentionSettings) => void; onClose: () => void }) {
  const saved = settings.winbackDays[reason];
  const insurvas = PLATFORM_DEFAULT_SETTINGS.winbackDays[reason];
  const limits = WINBACK_LIMITS[reason];
  const [draftText, setDraftText] = useState(String(saved));
  const [asking, setAsking] = useState<{ days: number; back: boolean } | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const { busy, error, setError, send } = useSettingsSave(onSaved, onClose, settings);
  const withDays = (days: number): RetentionSettings => ({ ...settings, winbackDays: { ...settings.winbackDays, [reason]: days } });
  const go = (days: number, back = false) => {
    if (reason === "affordability" && days < saved) { setAsking({ days, back }); return; }
    void send(withDays(days), { back });
  };
  const save = () => {
    const days = Number(draftText);
    if (!draftText.trim() || !Number.isInteger(days) || days < limits.min || days > limits.max) { setError(`Enter ${limits.min} to ${limits.max} days.`); return; }
    go(days);
  };
  return (
    <>
      <SettingDialog title={WINBACK_LABELS[reason]} said={<>How long a lapsed client rests before they come back as a lead. {saved === insurvas ? "Insurvas's value." : `Insurvas's is ${insurvas}.`}{reason === "affordability" ? ` Never sooner than ${PLATFORM_CAPS.winbackAffordabilityFloorDays} days.` : ""}</>}
        canEdit={canEdit} readValue={`${saved} days`} error={error} busy={busy && !asking}
        onSave={save} onBack={saved === insurvas ? null : () => go(insurvas, true)} onClose={onClose}>
        <NumberField id={`rs-winback-${reason}`} autoFocus label="Wait before calling" unit="days" value={draftText} onChange={(v) => { setDraftText(v.replace(/\D/g, "").slice(0, 4)); setError(null); }} />
      </SettingDialog>
      <ConfirmDialog open={asking !== null} onOpenChange={(open) => { if (!open) { setAsking(null); setConfirmation(""); } }} busy={busy}
        title="Call people who could not afford it sooner?"
        description={`You are shortening the wait from ${saved} to ${asking?.days ?? saved} days for clients who said they could not afford their policy.`}
        confirmLabel={`Shorten to ${asking?.days ?? saved} days`} cancelLabel={`Keep ${saved} days`}
        confirmDisabled={confirmation.trim() !== AFFORDABILITY_CONFIRMATION}
        fields={<label className="flex flex-col gap-1.5 text-label text-[var(--body)]">Type {AFFORDABILITY_CONFIRMATION} to confirm<input className={inputControl} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" /></label>}
        onConfirm={() => { if (asking) void send(withDays(asking.days), { confirmation, back: asking.back }).then(() => setAsking(null)); }} />
    </>
  );
}

const HOLDOUT_KEYS = ["holdoutEnabled", "holdoutShareBp", "holdoutMaxExposureCents", "predictionHorizonDays"] as const;
const HOLDOUT_SPECS: NumSpec[] = [
  { key: "holdoutShareBp", label: "Share", unit: "%", scale: 100 },
  { key: "holdoutMaxExposureCents", label: "Never above", unit: "$", scale: 100 },
  { key: "predictionHorizonDays", label: "Look after", unit: "days" },
];

/**
 * Holdout (Radar): on or off, how much of the queue is held back, the advance at risk above which a policy never is,
 * and how long after a prediction the outcome is read. The explanation is fixed and comes before the switch, and the
 * switch cannot be turned on until it has been read.
 */
export function HoldoutDialog({ settings: saved, canEdit, onSaved, onClose }: { settings: RetentionSettings; canEdit: boolean; onSaved: (next: RetentionSettings) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<RetentionSettings>(saved);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(HOLDOUT_SPECS.map((s) => [s.key, shown(saved, s)])));
  const [acknowledged, setAcknowledged] = useState(false);
  const { busy, error, setError, send } = useSettingsSave(onSaved, onClose, saved);
  const dis = !canEdit;
  const yours = isYours(saved, HOLDOUT_KEYS);
  const save = () => {
    const numbers = readNumbers(HOLDOUT_SPECS, drafts);
    if (typeof numbers === "string") { setError(numbers); return; }
    const next = { ...saved, holdoutEnabled: draft.holdoutEnabled, ...numbers } as RetentionSettings;
    const problem = validate(next);
    if (problem) { setError(problem); return; }
    void send(next, { acknowledged });
  };
  return (
    <SettingDialog title="Holdout" said={`How much of the queue is held back, the advance at risk above which a policy never is, and how long after a prediction the outcome is read on Results. The share can never be more than ${PLATFORM_CAPS.holdoutCeilingBp / 100}%.`}
      canEdit={canEdit} readValue={saved.holdoutEnabled ? `On · ${saved.holdoutShareBp / 100}% held back` : "Off"} error={error} busy={busy}
      saveDisabled={draft.holdoutEnabled && !saved.holdoutEnabled && !acknowledged}
      onSave={save} onBack={yours ? () => void send(withDefaults(saved, HOLDOUT_KEYS), { back: true }) : null} onClose={onClose}>
      <details className="text-sm text-[var(--ink)]" open={!saved.holdoutEnabled}>
        <summary className="cursor-pointer font-medium text-[var(--accent-ink)]">How the holdout works</summary>
        <div className="mt-2 flex max-h-[30vh] flex-col gap-2 overflow-y-auto">
          {HOLDOUT_EXPLANATION.map((p, i) => <p key={i} className="m-0">{p}</p>)}
        </div>
      </details>
      {!saved.holdoutEnabled && (
        <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
          <input type="checkbox" className={checkboxControl} checked={acknowledged} onChange={(e) => { setAcknowledged(e.target.checked); if (!e.target.checked) setDraft((cur) => ({ ...cur, holdoutEnabled: false })); }} />
          I have read what the holdout does
        </label>
      )}
      <span className="flex items-center gap-3 text-sm text-[var(--ink)]">
        <Switch label="Holdout" checked={draft.holdoutEnabled} disabled={dis || (!saved.holdoutEnabled && !acknowledged)} onChange={(on) => { setDraft((cur) => ({ ...cur, holdoutEnabled: on })); setError(null); }} />
        {draft.holdoutEnabled ? "On" : "Off"}
      </span>
      <div className="grid gap-4 sm:grid-cols-3">
        {HOLDOUT_SPECS.map((spec) => (
          <NumberField key={spec.key} id={`rs-${spec.key}`} label={spec.label} unit={spec.unit} value={drafts[spec.key] ?? ""} onChange={(v) => { setDrafts((cur) => ({ ...cur, [spec.key]: v })); setError(null); }} />
        ))}
      </div>
      <Link href="/app/retention-results" className="text-sm font-medium text-[var(--accent-ink)] hover:underline">Results</Link>
    </SettingDialog>
  );
}
