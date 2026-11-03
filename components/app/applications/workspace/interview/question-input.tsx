"use client";

/**
 * One interview question (LA-3.2; board l3-ws-interview): "Q4" and the question on the left, the
 * answer on the right as chips, a knockout the agent cannot miss (red row, red chip, an alert line),
 * a note per answer, and — nested under it — the follow-ups its answer opened. Each control carries
 * `health.<key>` as its DOM id, the field key QA's knockout items deep-link to. Nothing here knows
 * which template it is rendering.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Loader2, Mic, MicOff, OctagonAlert, StickyNote, X } from "lucide-react";

import { control } from "@/components/app/settings/primitives";
import { useDictation } from "@/components/app/dialer/use-dictation";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import type { InterviewQuestion, InterviewView, MedicationRow } from "@/lib/applications/types";
import { cn } from "@/lib/utils";

import { MedicationTable } from "./medication-table";

export type Answer = InterviewView["answers"][string];
export type AnswerValue = Answer["value"];

export const questionDomId = (key: string) => `health.${key}`;

/** The medication question's answer when the client takes none (lib/applications/templates.ts reads it too). */
export const NO_MEDICATIONS = "none";

/** Answers typed out (not picked): they need a "Done", or the section would fold mid-word. */
export const TYPED_TYPES = new Set<InterviewQuestion["type"]>(["text", "long_text", "number", "date"]);

export function isAnswered(q: InterviewQuestion, answer: Answer | undefined, medications: MedicationRow[]) {
  // "Takes none" is an answer too (owner 2026-10-28): the medication question is not left open.
  if (q.type === "medication_list") return medications.length > 0 || answer?.value === NO_MEDICATIONS;
  const v = answer?.value;
  if (v === null || v === undefined || v === "") return false;
  return !(Array.isArray(v) && v.length === 0);
}

export function isKnockedOut(q: InterviewQuestion, answer: Answer | undefined) {
  const v = answer?.value;
  return Boolean(q.knockout && v !== null && v !== undefined && String(v) === String(q.knockout.when));
}

/** How a given answer reads on its chip: red for a knockout, amber when it opens a follow-up, green otherwise. */
export type ChipTone = "good" | "warning" | "danger";

const CHIP_ON: Record<ChipTone, string> = {
  good: "border-transparent bg-[var(--success-surface)] text-[var(--success-ink)]",
  warning: "border-transparent bg-[var(--warning-surface)] text-[var(--warning-ink)]",
  danger: "border-transparent bg-[var(--error-surface)] text-[var(--error-ink)] ring-1 ring-[var(--error)]",
};
const chipClass = (on: boolean, tone: ChipTone) => cn(
  "inline-flex h-9 min-w-12 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed",
  on ? CHIP_ON[tone] : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--border-strong)] hover:text-[var(--ink)] disabled:opacity-60",
);

export const answerText = (v: unknown) => (v === true ? "yes" : v === false ? "no" : Array.isArray(v) ? v.join(", ") : String(v ?? ""));

function Control({ q, value, labelId, readOnly, onAnswer, toneFor }: {
  q: InterviewQuestion;
  value: AnswerValue | undefined;
  labelId: string;
  readOnly: boolean;
  onAnswer: (value: AnswerValue) => void;
  toneFor: (value: AnswerValue) => ChipTone;
}) {
  const id = questionDomId(q.key);
  const options = q.options ?? [];
  const chips = (list: { v: string | boolean; label: string }[]) => (
    <span role="group" aria-labelledby={labelId} className="inline-flex flex-wrap items-center gap-1.5">
      {list.map((o, i) => {
        const on = value === o.v;
        return (
          <button key={o.label} id={i === 0 ? id : undefined} type="button" aria-pressed={on} disabled={readOnly} title={readOnly ? "Read-only — nothing on this attempt can change" : undefined} className={chipClass(on, toneFor(o.v))} onClick={() => onAnswer(on ? null : o.v)}>
            {on && toneFor(o.v) === "danger" && <span className="size-1.5 rounded-full bg-[var(--error)]" aria-hidden="true" />}
            {o.label}
          </button>
        );
      })}
    </span>
  );

  switch (q.type) {
    case "boolean":
      return chips([{ v: true, label: "Yes" }, { v: false, label: "No" }]);
    case "single_select":
      if (options.length <= 3) return chips(options.map((o) => ({ v: o, label: o })));
      return (
        <select id={id} aria-labelledby={labelId} className={cn(control, "mt-0 w-full md:w-56")} value={typeof value === "string" ? value : ""} disabled={readOnly} onChange={(e) => onAnswer(e.target.value || null)}>
          <option value="">Choose…</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case "multi_select": {
      const picked = Array.isArray(value) ? value : [];
      return (
        <span role="group" aria-labelledby={labelId} className="inline-flex flex-wrap items-center gap-1.5">
          {options.map((o, i) => {
            const on = picked.includes(o);
            return (
              <button key={o} id={i === 0 ? id : undefined} type="button" aria-pressed={on} disabled={readOnly} title={readOnly ? "Read-only — nothing on this attempt can change" : undefined} className={chipClass(on, "good")} onClick={() => onAnswer(on ? picked.filter((p) => p !== o) : [...picked, o])}>
                {o}
              </button>
            );
          })}
        </span>
      );
    }
    case "number":
      return <input id={id} aria-labelledby={labelId} type="number" inputMode="decimal" className={cn(control, "mt-0 w-32")} value={typeof value === "number" ? value : ""} disabled={readOnly} onChange={(e) => onAnswer(e.target.value === "" ? null : Number(e.target.value))} />;
    case "date":
      return <input id={id} aria-labelledby={labelId} type="date" className={cn(control, "mt-0 w-44")} value={typeof value === "string" ? value : ""} disabled={readOnly} onChange={(e) => onAnswer(e.target.value || null)} />;
    case "text":
      return <input id={id} aria-labelledby={labelId} className={cn(control, "mt-0 w-full md:w-72")} value={typeof value === "string" ? value : ""} disabled={readOnly} onChange={(e) => onAnswer(e.target.value || null)} />;
    case "long_text":
      // Owner 2026-10-28: dictation inside the answer, bottom right, as on a note.
      return <DictationBox id={id} labelledBy={labelId} value={typeof value === "string" ? value : ""} readOnly={readOnly} onChange={(text) => onAnswer(text || null)} placeholder="Type the answer, or press Dictate and say it" minH="min-h-20" />;
    default:
      return null;
  }
}

/** Types whose control sits to the right of the question on one line. */
const INLINE = new Set<InterviewQuestion["type"]>(["boolean", "single_select", "number", "date", "text"]);

const plainTone = (): ChipTone => "good";

/**
 * A question's note (owner 2026-10-28): the dialer's dictation as a microphone inside the box — speak
 * and the words are added to what is typed — and an × in its corner to close it, for an agent who
 * only wanted to answer yes or no. A note with words in it is removed by the ×.
 */
function NoteField({ id, label, value, readOnly, onChange, onHide }: { id: string; label: string; value: string; readOnly: boolean; onChange: (notes: string) => void; onHide: () => void }) {
  return (
    <DictationBox
      id={id}
      ariaLabel={`Note on: ${label}`}
      value={value}
      readOnly={readOnly}
      onChange={onChange}
      placeholder="Type the note, or press Dictate and say it"
      minH="min-h-16"
      left={(stop) => (
        <Button type="button" size="sm" variant="ghost" onClick={() => { stop(); onHide(); }} aria-label={value ? "Remove the note" : "Close the note"} title={value ? "Remove the note" : "Close the note"}>
          <X aria-hidden="true" />{value ? "Remove" : "Close"}
        </Button>
      )}
    />
  );
}

/**
 * A text box with the dialer's dictation inside it (owner 2026-10-28): the words on top, and in the
 * box's own foot an optional action on the left and Dictate on the bottom right. Speaking adds to what
 * is already typed; nothing is saved by speaking alone.
 */
function DictationBox({ id, ariaLabel, labelledBy, value, readOnly, onChange, placeholder, minH, left }: {
  id: string; ariaLabel?: string; labelledBy?: string; value: string; readOnly: boolean;
  onChange: (text: string) => void; placeholder: string; minH: string;
  left?: (stopDictation: () => void) => ReactNode;
}) {
  const latest = useRef(value);
  useEffect(() => { latest.current = value; }, [value]);
  const dictation = useDictation(useCallback((text: string) => {
    if (!text) return;
    const current = latest.current;
    onChange(current.trim() ? `${current.replace(/\s+$/, "")} ${text}` : text);
  }, [onChange]));
  return (
    <div className="flex flex-col gap-1">
      <div className={cn("flex flex-col rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] transition-colors focus-within:border-[var(--primary)]", dictation.listening && "border-[var(--error)]")}>
        <textarea
          id={id}
          aria-label={ariaLabel}
          aria-labelledby={labelledBy}
          placeholder={dictation.supported && !readOnly ? placeholder : placeholder.replace(/, or press Dictate and say it$/, "")}
          className={cn(minH, "w-full resize-y border-0 bg-transparent px-3 pt-2 pb-1 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--body)] disabled:opacity-60")}
          value={value}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value)}
        />
        {!readOnly && (
          <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5">
            <span>{left?.(dictation.stop)}</span>
            {dictation.supported ? (
              <Button
                type="button"
                size="sm"
                variant={dictation.listening ? "default" : "ghost"}
                onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
                disabled={dictation.transcribing}
                aria-pressed={dictation.listening}
                title={dictation.listening ? "Stop dictating" : "Say it instead of typing it"}
              >
                {dictation.transcribing ? <Loader2 className="animate-spin" aria-hidden="true" /> : dictation.listening ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
                {dictation.listening ? "Stop" : dictation.transcribing ? "Writing…" : "Dictate"}
              </Button>
            ) : dictation.checked ? <span className="px-1.5 text-xs text-[var(--body)]">No dictation in this browser</span> : null}
          </div>
        )}
      </div>
      {dictation.listening && (
        <p role="status" aria-live="polite" className="m-0 flex items-center gap-2 text-xs text-[var(--body)]">
          <span className="size-2 shrink-0 animate-pulse rounded-full bg-[var(--error)]" aria-hidden="true" />
          {dictation.engine === "device"
            ? <span className="tabular-nums">Recording {Math.floor(dictation.seconds / 60)}:{String(dictation.seconds % 60).padStart(2, "0")} · press Stop to write it</span>
            : dictation.heard ? <span className="italic">{dictation.heard}</span> : "Listening… say it."}
        </p>
      )}
      {dictation.transcribing && dictation.download !== null && dictation.download < 100 && (
        <p role="status" className="m-0 text-xs text-[var(--body)]">Getting the speech model ready, the first time only · {dictation.download}%</p>
      )}
      {dictation.problem && !dictation.listening && <p role="alert" className="m-0 text-xs text-[var(--error-ink)]">{dictation.problem}</p>}
    </div>
  );
}

export function QuestionRow({ q, number = null, answer, readOnly, onAnswer, onNotes, toneFor = plainTone, followUp = false, children, medications, onMedications, card }: {
  /** The interview's own look (a rounded row, answers under the question); `isNext` marks "Ask now". */
  card?: { isNext: boolean };
  q: InterviewQuestion;
  /** "Q4" for a top-level question; follow-ups are not numbered. */
  number?: number | null;
  answer: Answer | undefined;
  readOnly: boolean;
  onAnswer: (value: AnswerValue) => void;
  onNotes: (notes: string) => void;
  toneFor?: (value: AnswerValue) => ChipTone;
  /** Drawn inside its parent's row, under the "Follow-up, because…" line. */
  followUp?: boolean;
  /** The follow-ups this answer opened. */
  children?: ReactNode;
  /**
   * Older callers (the Settings template preview) pass a medication-list question through here with
   * its rows; the interview itself draws medications in their own card. Prefer InterviewQuestionList.
   */
  medications?: MedicationRow[];
  onMedications?: (rows: MedicationRow[]) => void;
  /** Accepted for older callers; the label is always shown now. */
  labelHidden?: boolean;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const labelId = `q-${q.key}-label`;
  const noteId = `q-${q.key}-note`;
  const showNote = noteOpen || Boolean(answer?.notes);
  const knocked = isKnockedOut(q, answer);
  const inline = INLINE.has(q.type);
  // Owner 2026-10-28: a note opened by mistake closes again; one with words in it is removed with them.
  const hideNote = () => { if (answer?.notes) onNotes(""); setNoteOpen(false); };

  const noteButton = !readOnly && !showNote && (
    <Button type="button" variant="ghost" size="icon" aria-controls={noteId} aria-label={`Add a note to: ${q.label}`} title="Add a note" onClick={() => { setNoteOpen(true); requestAnimationFrame(() => document.getElementById(noteId)?.focus()); }}>
      <StickyNote aria-hidden="true" />
    </Button>
  );
  const control_ = <Control q={q} value={answer?.value} labelId={labelId} readOnly={readOnly} onAnswer={onAnswer} toneFor={toneFor} />;

  const label = (
    <div className="min-w-0">
      <p id={labelId} className={cn("text-sm leading-[1.5]", followUp ? "text-[var(--ink)]" : "text-[var(--body)]")}>
        {number !== null && <strong className="mr-1.5 font-semibold text-[var(--muted)]">Q{number}</strong>}
        {q.label}
        {q.required && <span className="text-[var(--error-ink)]"> *</span>}
      </p>
      {q.help && <p className="mt-0.5 text-xs leading-[1.5] text-[var(--muted)]">{q.help}</p>}
    </div>
  );

  const body = (
    <>
      <div className={cn("flex flex-col gap-3", inline && "md:flex-row md:items-center md:justify-between md:gap-4")}>
        {label}
        <span className={cn("flex flex-wrap items-center gap-2", inline && "md:shrink-0 md:justify-end")}>
          {knocked && <StatusChip tone="danger">Knockout</StatusChip>}
          {inline && control_}
          {!inline && noteButton}
          {inline && noteButton}
        </span>
      </div>
      {!inline && q.type !== "medication_list" && <div className="mt-2">{control_}</div>}
      {q.type === "medication_list" && medications && onMedications && (
        <div className="mt-2"><MedicationTable id={questionDomId(q.key)} rows={medications} onChange={onMedications} readOnly={readOnly} sample /></div>
      )}
      {knocked && q.knockout && (
        <p role="alert" className="mt-2 flex items-center gap-2 text-sm font-semibold text-[var(--error-ink)]">
          <OctagonAlert className="size-4 shrink-0" aria-hidden="true" />
          {/* The note is required to save, so a blank one is only ever an unsaved builder draft. */}
          Knockout — {q.knockout.note?.trim() || "this answer rules this carrier out."}
        </p>
      )}
      {showNote && <div className="mt-2"><NoteField id={noteId} label={q.label} value={answer?.notes ?? ""} readOnly={readOnly} onChange={onNotes} onHide={hideNote} /></div>}
      {children}
    </>
  );

  if (followUp) return <div className={cn("flex flex-col", knocked && "-mx-3 rounded-[8px] bg-[var(--error-surface)] px-3 py-2")}>{body}</div>;
  if (card) {
    // The interview's own row (owner pick C, 2026-10-28): the number in a circle, the question in bold with
    // "Ask now" beside it, why it is asked under it, and the answers under that.
    return (
      <div className={cn(
        "flex h-full gap-3 rounded-[14px] border p-3",
        knocked ? "border-[color-mix(in_srgb,var(--error)_60%,transparent)] bg-[var(--error-surface)]"
          : card.isNext ? "border-[color-mix(in_srgb,var(--primary)_60%,transparent)] bg-[var(--primary-soft)]"
          : "border-[var(--border)] bg-[var(--surface-alt)]",
      )}>
        <span aria-hidden="true" className="inline-grid size-[30px] shrink-0 place-items-center rounded-full bg-[var(--surface)] text-xs font-bold text-[var(--muted)]">{number ?? "·"}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <p id={labelId} className="text-card-title text-[var(--ink)]">
                {number !== null && <span className="sr-only">Question {number}: </span>}
                {q.label}
                {q.required && <span className="text-[var(--error-ink)]"> *</span>}
                {card.isNext && <span className="ml-2 inline-flex rounded-full bg-[var(--primary)] px-2 py-0.5 align-middle text-xs font-bold text-[var(--ink)]">Ask now</span>}
              </p>
              {q.help && <p className="mt-0.5 text-xs leading-[1.5] text-[var(--muted)]">{q.help}</p>}
            </div>
            {/* A typed answer's way to finish sits top right of its card (owner 2026-10-28). */}
            {!readOnly && TYPED_TYPES.has(q.type) && (isAnswered(q, answer, []) ? (
              <Button type="button" size="sm" className="shrink-0" onClick={(e) => e.currentTarget.blur()}><Check aria-hidden="true" />Done</Button>
            ) : !q.required && (
              <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => onAnswer("Nothing to add")}>Nothing to add</Button>
            ))}
          </div>
          {q.type !== "medication_list" && (TYPED_TYPES.has(q.type) ? (
            // A typed answer says when it is finished (owner 2026-10-28): "Done" (or Enter; Ctrl+Enter in a
            // long answer) leaves the field, and only then can its section fold. An optional one can be
            // closed with "Nothing to add".
            <div
              className="flex flex-col gap-2"
              onKeyDown={(e) => {
                const t = e.target as HTMLElement;
                if (e.key === "Enter" && (t.tagName === "INPUT" || (t.tagName === "TEXTAREA" && (e.ctrlKey || e.metaKey)))) { e.preventDefault(); t.blur(); }
              }}
            >
              {control_}
              {/* No separate note on a typed answer (owner 2026-10-28): the answer is the note. */}
              {!readOnly && <span className="text-xs text-[var(--body)]">{q.type === "long_text" ? "Ctrl+Enter when finished" : "Enter when finished"}</span>}
            </div>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              {control_}
              {noteButton}
            </span>
          ))}
          {knocked && q.knockout && (
            <p role="alert" className="flex items-center gap-2 text-xs font-semibold text-[var(--error-ink)]">
              <OctagonAlert className="size-3.5 shrink-0" aria-hidden="true" />
              Knockout · {q.knockout.note?.trim() || "this answer rules this carrier out."}
            </p>
          )}
          {showNote && <NoteField id={noteId} label={q.label} value={answer?.notes ?? ""} readOnly={readOnly} onChange={onNotes} onHide={hideNote} />}
          {children}
        </div>
      </div>
    );
  }
  return (
    <div className={cn("border-t border-[var(--border)] px-5 py-4", knocked ? "border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] pl-[17px]" : "bg-[var(--surface)]")}>
      {body}
    </div>
  );
}

/** The block a follow-up sits in: a rule on the left and why it is there. */
export function FollowUps({ because, children }: { because: string; children: ReactNode }) {
  return (
    <div className="mt-3 flex flex-col gap-3 border-l-2 border-[var(--border)] pl-3">
      <span className="text-xs leading-[1.5] text-[var(--muted)]">Follow-up, because the answer was {because}</span>
      {children}
    </div>
  );
}
