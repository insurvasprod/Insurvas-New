"use client";

/**
 * Settings › Dialing cadence · one call's popover (round 8, board A "Edit a call"): the wait after the
 * call before, the part of the day, and which outcomes this call follows. It edits the rule the tab
 * shows — the outcome's own rule when it has one, else the shared rule — through lib/cadence/draft.ts.
 */

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CheckBox } from "@/components/ui/check-box";
import { control } from "@/components/ui/field";
import { DAY_PARTS, SLOTS, type CadenceRow, type PreferredTime } from "@/lib/cadence/engine";
import { OUTCOMES, OUTCOME_LABELS, PREFERENCE_WORDS, intervalOf, splitInterval, type Outcome } from "@/lib/cadence/draft";
import { cn } from "@/lib/utils";

import { Seg, Stepper, dotClass } from "./shared";

type Unit = "minute" | "hour" | "day";
const UNITS: { key: Unit; label: string }[] = [
  { key: "minute", label: "minutes" },
  { key: "hour", label: "hours" },
  { key: "day", label: "days" },
];
const MAIN_TIMES = [
  { key: "any", label: "Any" },
  { key: "morning", label: "Morning" },
  { key: "afternoon", label: "Afternoon", title: "Noon to 3pm, while the lead has not been tried then" },
  { key: "evening", label: "Evening" },
] as const;
type MainTime = (typeof MAIN_TIMES)[number]["key"];
const OTHER_TIMES: PreferredTime[] = [...DAY_PARTS.filter((part) => part === "opposite_half"), ...SLOTS.filter((slot) => slot !== "afternoon")];

const capital = (text: string) => `${text[0].toUpperCase()}${text.slice(1)}`;

export function CallPopover({
  n,
  landsAt,
  rule,
  outcome,
  ownRule,
  rowsForCall,
  readOnly,
  canRemove,
  removeTitle,
  onPatch,
  onSplit,
  onJoin,
  onRemove,
  onClose,
}: {
  n: number;
  /** "Fri 20, 2:30pm" — where the example lands it. */
  landsAt: string;
  /** The rule this tab shows for the call; null for call 1 (no wait). */
  rule: Pick<CadenceRow, "delayInterval" | "preferredSlot"> | null;
  outcome: Outcome;
  /** The tab's outcome has its own rule for this call. */
  ownRule: boolean;
  /** Every rule stored for this call (the shared one and each outcome's own). */
  rowsForCall: CadenceRow[];
  readOnly: boolean;
  canRemove: boolean;
  removeTitle?: string;
  onPatch: (patch: Partial<Pick<CadenceRow, "delayInterval" | "preferredSlot">>) => void;
  onSplit: (outcome: Outcome) => void;
  onJoin: (outcome: Outcome) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const head = (
    <div className="flex items-center gap-2 border-b border-border px-3.5 py-3">
      <span aria-hidden="true" className={dotClass(ownRule ? "own" : "call", "sm")}>{n}</span>
      <b className="text-base font-semibold text-[var(--ink)]">Call {n}</b>
      <span className="truncate text-xs text-[var(--muted)]">{landsAt} in the example</span>
      <Button type="button" variant="ghost" size="icon-sm" className="ml-auto" aria-label="Close" onClick={onClose}><X aria-hidden="true" /></Button>
    </div>
  );

  if (!rule)
    return (
      <div>
        {head}
        <p className="m-0 px-3.5 py-3 text-sm text-[var(--body)]">The first call is made as soon as the lead arrives, at any time your calling windows allow. It has no wait to change.</p>
      </div>
    );

  const wait = splitInterval(rule.delayInterval);
  const pref = rule.preferredSlot ?? null;
  const main: MainTime | null = pref === null ? "any" : pref === "morning" || pref === "afternoon" || pref === "evening" ? pref : null;
  const shared = rowsForCall.find((row) => !row.dispositionScope);
  const ownOf = (code: Outcome) => rowsForCall.find((row) => row.dispositionScope === code);

  return (
    <div>
      {head}
      <div className="flex flex-col gap-1.5 px-3.5 py-3">
        <label htmlFor={`cadence-wait-${n}`} className="text-xs font-semibold text-[var(--ink)]">Wait after call {n - 1}</label>
        <div className="flex flex-wrap items-center gap-2">
          <Stepper
            id={`cadence-wait-${n}`}
            label={`Wait after call ${n - 1}`}
            value={wait.amount}
            min={1}
            max={wait.unit === "minute" ? 9999 : wait.unit === "hour" ? 999 : 99}
            disabled={readOnly}
            onChange={(amount) => onPatch({ delayInterval: intervalOf(amount, wait.unit) })}
          />
          <Seg label="Unit" options={UNITS} value={wait.unit} disabled={readOnly} onChange={(unit) => onPatch({ delayInterval: intervalOf(wait.amount, unit) })} />
        </div>

        <span className="mt-1.5 text-xs font-semibold text-[var(--ink)]">Part of the day</span>
        <Seg
          label="Part of the day"
          options={MAIN_TIMES}
          value={main}
          disabled={readOnly}
          onChange={(key) => onPatch({ preferredSlot: key === "any" ? null : key })}
        />
        <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <span className="shrink-0">Or</span>
          <select
            className={cn(control, "mt-0 h-8 text-sm")}
            disabled={readOnly}
            value={main === null && pref ? pref : ""}
            onChange={(event) => event.target.value && onPatch({ preferredSlot: event.target.value as PreferredTime })}
            aria-label="Another time of day"
          >
            <option value="">another time…</option>
            {OTHER_TIMES.map((time) => (
              <option key={time} value={time}>{capital(PREFERENCE_WORDS[time].replace(/^in the |^at the /, ""))}</option>
            ))}
          </select>
        </label>

        <span className="mt-1.5 text-xs font-semibold text-[var(--ink)]">Make this call after</span>
        {ownRule ? (
          <div className="flex flex-col gap-1.5 text-sm text-[var(--body)]">
            <span>{OUTCOME_LABELS[outcome]} has its own call {n}.{shared ? ` The shared rule waits ${shared.delayInterval}.` : ""}</span>
            {!readOnly && (
              <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onJoin(outcome)}>
                Follow the shared rule again
              </Button>
            )}
          </div>
        ) : (
          <>
            {OUTCOMES.map((code) => {
              const own = ownOf(code);
              return (
                <label key={code} className="flex items-center gap-2 py-0.5 text-sm text-[var(--body)]">
                  <CheckBox checked={!own} disabled={readOnly} onChange={(event) => (event.target.checked ? onJoin(code) : onSplit(code))} />
                  {OUTCOME_LABELS[code]}
                  {own && <span className="ml-auto text-xs text-[var(--accent-ink)]">waits {own.delayInterval} instead</span>}
                </label>
              );
            })}
            <span className="text-xs text-[var(--muted)]">Untick an outcome to give it its own wait for this call. Any other outcome follows this rule.</span>
          </>
        )}
        <span className="mt-1 text-xs text-[var(--muted)]">Lands {landsAt} in the example, inside your calling hours.</span>
      </div>
      {!readOnly && (
        <div className="flex items-center gap-2 border-t border-border px-3.5 py-2.5">
          <Button type="button" variant="outline" size="sm" className="text-[var(--error-ink)]" disabled={!canRemove} title={removeTitle} onClick={onRemove}>Remove call</Button>
          <Button type="button" size="sm" className="ml-auto" onClick={onClose}>Done</Button>
        </div>
      )}
    </div>
  );
}
