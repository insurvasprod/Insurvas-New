"use client";

/**
 * One interview question (LA-3.2; board l3-ws-interview): "Q4" and the question on the left, the
 * answer on the right as chips, a knockout the agent cannot miss (red row, red chip, an alert line),
 * a note per answer, and — nested under it — the follow-ups its answer opened. Each control carries
 * `health.<key>` as its DOM id, the field key QA's knockout items deep-link to. Nothing here knows
 * which template it is rendering.
 */

import { useState, type ReactNode } from "react";
import { OctagonAlert, StickyNote } from "lucide-react";

import { control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import type { InterviewQuestion, InterviewView, MedicationRow } from "@/lib/applications/types";
import { cn } from "@/lib/utils";

import { MedicationTable } from "./medication-table";

export type Answer = InterviewView["answers"][string];
export type AnswerValue = Answer["value"];

export const questionDomId = (key: string) => `health.${key}`;

export function isAnswered(q: InterviewQuestion, answer: Answer | undefined, medications: MedicationRow[]) {
  if (q.type === "medication_list") return medications.length > 0;
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
          <button key={o.label} id={i === 0 ? id : undefined} type="button" aria-pressed={on} disabled={readOnly} title={readOnly ? "This attempt is closed" : undefined} className={chipClass(on, toneFor(o.v))} onClick={() => onAnswer(on ? null : o.v)}>
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
              <button key={o} id={i === 0 ? id : undefined} type="button" aria-pressed={on} disabled={readOnly} title={readOnly ? "This attempt is closed" : undefined} className={chipClass(on, "good")} onClick={() => onAnswer(on ? picked.filter((p) => p !== o) : [...picked, o])}>
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
      return <textarea id={id} aria-labelledby={labelId} className={cn(control, "h-auto min-h-20 py-2")} value={typeof value === "string" ? value : ""} disabled={readOnly} onChange={(e) => onAnswer(e.target.value || null)} />;
    default:
      return null;
  }
}

/** Types whose control sits to the right of the question on one line. */
const INLINE = new Set<InterviewQuestion["type"]>(["boolean", "single_select", "number", "date", "text"]);

const plainTone = (): ChipTone => "good";

export function QuestionRow({ q, number = null, answer, readOnly, onAnswer, onNotes, toneFor = plainTone, followUp = false, children, medications, onMedications }: {
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
      {showNote && (
        <textarea
          id={noteId}
          aria-label={`Note on: ${q.label}`}
          placeholder="Note"
          className={cn(control, "mt-2 h-auto min-h-16 py-2")}
          value={answer?.notes ?? ""}
          disabled={readOnly}
          onChange={(e) => onNotes(e.target.value)}
        />
      )}
      {children}
    </>
  );

  if (followUp) return <div className={cn("flex flex-col", knocked && "-mx-3 rounded-[8px] bg-[var(--error-surface)] px-3 py-2")}>{body}</div>;
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
