"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { CountLink, NumberField, putLadderRules, SettingDialog, useDialogSave } from "@/components/app/retention/retention-settings-rows";
import { GroupRow, NowCell, SettingFoot, SettingRow, SettingTable, UsedCell, ValueCell, type Column, type ValueKind } from "@/components/app/settings/money/setting-kit";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { Segmented } from "@/components/ui/view-tabs";
import { DEFAULT_LADDER_SETTINGS, FROM_FLAG, REASON_LABELS, REASON_STEP, REASONS, STEP_LABELS, type Reason } from "@/lib/retention/cases/ladder";
import type { FlaggedWord, LadderRules } from "@/lib/retention/cases/rulesStore";
import { notify } from "@/lib/notify";

/**
 * Settings › Retention › Ladder (round 7, owner pick 7·A, 2026-11-10; docs/la4/mockups-r7/retention.html 7·A). The
 * old Ladder rules page folded into the section's first tab: one row per fact the carrier files bring (the step it
 * puts the policy on, whether it counts, the open cases with that reason), then the two thresholds, then the carrier
 * words Insurvas flags, read-only. Each row opens its own dialog; a save sends the whole rule set, as the page did,
 * and re-runs the ladder at once.
 */
export const SAVED_LADDER = "Saved. The cases follow the new rules now.";

type Open = { kind: "fact"; reason: Reason } | { kind: "urgent" } | { kind: "unreachable" } | { kind: "words" };

/** How many of the agency's ladder values differ from Insurvas's. */
export const ladderChanges = (rules: LadderRules) =>
  rules.disabled.length + (rules.urgentDays !== DEFAULT_LADDER_SETTINGS.urgentDays ? 1 : 0) + (rules.unreachableAfter !== DEFAULT_LADDER_SETTINGS.unreachableAfter ? 1 : 0);
// The reason on every step of Cases (a reason link with no step looks across the ladder, round 7).
const casesFor = (reason: Reason) => `/app/retention?reason=${reason}`;
// Settings r8: the shared one-line setting rows (Setting · Now · Used by · Open now · Value · ›).
const LADDER_COLUMNS: Column[] = [
  { label: "What the files show", className: "w-[30%]" },
  { label: "Puts the policy on" },
  { label: "Counts", md: true },
  { label: "Open now", className: "w-[1%] text-right" },
  { label: "Value", className: "w-[1%]" },
];

export function LadderRulesBoard({ rules, words, openByReason, canEdit, onSaved }: {
  rules: LadderRules;
  words: FlaggedWord[];
  /** Open cases per reason (a head count each), or null when they could not be counted. */
  openByReason: Partial<Record<Reason, number>> | null;
  canEdit: boolean;
  onSaved: (next: LadderRules) => void;
}) {
  const [open, setOpen] = useState<Open | null>(null);
  const carriers = new Set(words.map((w) => w.carrierName)).size;
  const urgentYours = rules.urgentDays !== DEFAULT_LADDER_SETTINGS.urgentDays;
  const unreachableYours = rules.unreachableAfter !== DEFAULT_LADDER_SETTINGS.unreachableAfter;
  // The row's one chip (Settings r8 money pattern): Yours when the agency changed it, Owner for a read-only viewer.
  const valueOf = (yours: boolean): ValueKind => (!canEdit ? "owner" : yours ? "yours" : "insurvas");
  const values: ValueKind[] = [...REASONS.map((r) => valueOf(rules.disabled.includes(r))), valueOf(urgentYours), valueOf(unreachableYours), "locked"];

  return (
    <>
      <SettingTable columns={LADDER_COLUMNS} footer={<SettingFoot values={values} />}>
        <tbody>
          {REASONS.map((r) => {
            const on = !rules.disabled.includes(r);
            const count = openByReason?.[r];
            return (
              <SettingRow key={r} label={REASON_LABELS[r]} onOpen={() => setOpen({ kind: "fact", reason: r })}>
                <NowCell>{STEP_LABELS[REASON_STEP[r]]}</NowCell>
                <UsedCell>{on ? "Counts" : "Does not count"}{r === "payment_date_change" ? " · opened by a person" : ""}</UsedCell>
                <td className="whitespace-nowrap text-right tabular-nums">{count === undefined || (!on && count === 0) ? <span className="text-[var(--muted)]">—</span> : <CountLink href={casesFor(r)} value={count} />}</td>
                <ValueCell value={valueOf(!on)} />
              </SettingRow>
            );
          })}
          <GroupRow span={6}>Thresholds</GroupRow>
          <SettingRow label="A deadline is urgent within" onOpen={() => setOpen({ kind: "urgent" })}>
            <NowCell>{rules.urgentDays} {rules.urgentDays === 1 ? "day" : "days"}</NowCell>
            <UsedCell>Cases, the urgent sort</UsedCell>
            <td />
            <ValueCell value={valueOf(urgentYours)} />
          </SettingRow>
          <SettingRow label="Unreachable after" onOpen={() => setOpen({ kind: "unreachable" })}>
            <NowCell>{rules.unreachableAfter} {rules.unreachableAfter === 1 ? "try" : "tries"}</NowCell>
            <UsedCell>Cases, the Unreachable step</UsedCell>
            <td />
            <ValueCell value={valueOf(unreachableYours)} />
          </SettingRow>
          <SettingRow label="Carrier words that count" onOpen={() => setOpen({ kind: "words" })}>
            <NowCell>{words.length ? `${words.length} ${words.length === 1 ? "word" : "words"} · ${carriers} ${carriers === 1 ? "carrier" : "carriers"}` : "None yet"}</NowCell>
            <UsedCell>Set per carrier by Insurvas</UsedCell>
            <td />
            <ValueCell value="locked" />
          </SettingRow>
        </tbody>
      </SettingTable>
      {open?.kind === "fact" && <FactDialog reason={open.reason} rules={rules} canEdit={canEdit} onSaved={onSaved} onClose={() => setOpen(null)} />}
      {(open?.kind === "urgent" || open?.kind === "unreachable") && <ThresholdDialog which={open.kind} rules={rules} canEdit={canEdit} onSaved={onSaved} onClose={() => setOpen(null)} />}
      {open?.kind === "words" && <WordsDialog words={words} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Save the whole rule set, toast, and let the page read the cases again. */
function useLadderSave(onSaved: (next: LadderRules) => void, onClose: () => void) {
  const router = useRouter();
  const save = useDialogSave();
  const send = (next: LadderRules) => save.run(async () => {
    await putLadderRules(next);
    notify.done(SAVED_LADDER);
    onSaved(next);
    router.refresh();
    onClose();
  });
  return { ...save, send };
}

/** A fact on or off (7·2 "Ladder · a fact"). Insurvas counts every fact; off is the agency's own. */
function FactDialog({ reason, rules, canEdit, onSaved, onClose }: { reason: Reason; rules: LadderRules; canEdit: boolean; onSaved: (next: LadderRules) => void; onClose: () => void }) {
  const wasOn = !rules.disabled.includes(reason);
  const [on, setOn] = useState(wasOn);
  const { busy, error, send } = useLadderSave(onSaved, onClose);
  const withFact = (counts: boolean): LadderRules => ({ ...rules, disabled: counts ? rules.disabled.filter((r) => r !== reason) : [...rules.disabled.filter((r) => r !== reason), reason] });
  return (
    <SettingDialog
      title={REASON_LABELS[reason]}
      said={<>Puts the policy on {STEP_LABELS[REASON_STEP[reason]]}.{reason === "payment_date_change" ? " Opened by a person: no file carries it." : ""} A switched-off fact opens nothing.</>}
      canEdit={canEdit}
      readValue={wasOn ? "Counts: on" : "Counts: off"}
      error={error}
      busy={busy}
      saveDisabled={on === wasOn}
      onSave={() => void send(withFact(on))}
      onBack={wasOn ? null : () => void send(withFact(true))}
      onClose={onClose}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-label text-[var(--body)]">Counts</span>
        <Segmented label="Counts" value={on ? "on" : "off"} onChange={(v) => setOn(v === "on")} options={[{ key: "on", label: "On" }, { key: "off", label: "Off" }]} />
      </div>
    </SettingDialog>
  );
}

/** When a deadline is urgent, or after how many tries a client is unreachable (7·2 "Ladder · a threshold"). */
function ThresholdDialog({ which, rules, canEdit, onSaved, onClose }: { which: "urgent" | "unreachable"; rules: LadderRules; canEdit: boolean; onSaved: (next: LadderRules) => void; onClose: () => void }) {
  const urgent = which === "urgent";
  const current = urgent ? rules.urgentDays : rules.unreachableAfter;
  const insurvas = urgent ? DEFAULT_LADDER_SETTINGS.urgentDays : DEFAULT_LADDER_SETTINGS.unreachableAfter;
  const [draft, setDraft] = useState(String(current));
  const { busy, error, setError, send } = useLadderSave(onSaved, onClose);
  const [min, max] = urgent ? [0, 60] : [1, 20];
  const value = Number(draft);
  const problem = draft.trim() === "" || !Number.isInteger(value) || value < min || value > max ? `Enter ${min} to ${max} ${urgent ? "days" : "tries"}.` : null;
  const next = (v: number): LadderRules => (urgent ? { ...rules, urgentDays: v } : { ...rules, unreachableAfter: v });
  const unit = urgent ? "days" : "tries";
  return (
    <SettingDialog
      title={urgent ? "A deadline is urgent within" : "Unreachable after"}
      said={<>{urgent ? "A payment problem this close to its deadline moves up to Pending lapse." : "Calls in a row that reach nobody."} {current === insurvas ? "Insurvas's value." : `Insurvas's is ${insurvas}.`}</>}
      canEdit={canEdit}
      readValue={`${current} ${unit}`}
      error={error}
      busy={busy}
      saveDisabled={value === current && !problem}
      onSave={() => { if (problem) setError(problem); else void send(next(value)); }}
      onBack={current === insurvas ? null : () => void send(next(insurvas))}
      onClose={onClose}
    >
      <NumberField id={`ladder-${which}`} autoFocus label={urgent ? "Days" : "Tries"} value={draft} onChange={(v) => { setDraft(v.replace(/\D/g, "").slice(0, 2)); setError(null); }} />
    </SettingDialog>
  );
}

/** The carrier status words Insurvas has flagged for the ladder. Insurvas keeps the map, so this is read-only. */
function WordsDialog({ words, onClose }: { words: FlaggedWord[]; onClose: () => void }) {
  return (
    <SettingDialog
      title="Carrier words that count"
      said="Insurvas sets these per carrier as it reads their files. Ask support to flag a word your carrier uses."
      canEdit={false}
      kept
      readValue={words.length === 0 ? (
        <EmptyState title="No carrier words flagged yet" hint="Until one is, the ladder reads the status, the paid-to date and the commission file. A flagged word (a banking problem, a lapse notice, a pending action) adds its own reason." />
      ) : (
        <TableCard bodyClassName="max-h-[50vh] overflow-y-auto">
          <table className="portal-lead-table w-full text-left text-sm" data-even="off">
            <thead><tr><th>Carrier</th><th>Their word</th><th>Counts as</th></tr></thead>
            <tbody>
              {words.map((w) => (
                <tr key={`${w.carrierName}|${w.word}`}>
                  <td className="whitespace-nowrap font-medium text-foreground">{w.carrierName}</td>
                  <td className="whitespace-nowrap">&ldquo;{w.word}&rdquo;</td>
                  <td className="whitespace-nowrap">{REASON_LABELS[FROM_FLAG[w.flag]]} · {STEP_LABELS[REASON_STEP[FROM_FLAG[w.flag]]]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
      onClose={onClose}
    />
  );
}
