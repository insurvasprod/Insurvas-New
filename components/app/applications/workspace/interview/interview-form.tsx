"use client";

/**
 * The interview's questions, drawn from any template (LA-3.1 / 3.2; board l3-ws-interview). No
 * workspace state: the Interview step and the Settings template preview both render this, so the
 * preview matches the interview exactly. Numbered top-level questions — the five persistency
 * questions first — with a section label where the section changes, follow-ups nested under the
 * answer that opened them (a follow-up that closes takes its answer with it), and knockouts drawn so
 * they cannot be missed. The medication list is not in here: it has its own card (MedicationTable).
 */

import { Fragment, type ReactNode } from "react";

import type { InterviewQuestion, InterviewView, MedicationRow } from "@/lib/applications/types";

import { answerText, FollowUps, isAnswered, isKnockedOut, QuestionRow, type AnswerValue, type ChipTone } from "./question-input";

export type Answers = InterviewView["answers"];

export function isVisible(q: InterviewQuestion, byKey: Map<string, InterviewQuestion>, answers: Answers, depth = 0): boolean {
  if (!q.showWhen) return true;
  const parent = byKey.get(q.showWhen.key);
  if (parent && depth < 8 && !isVisible(parent, byKey, answers, depth + 1)) return false;
  const v = answers[q.showWhen.key]?.value;
  return v !== null && v !== undefined && String(v) === String(q.showWhen.equals);
}

/** A follow-up that is no longer shown takes its answer with it (hidden answers are not stored). */
export function pruneHidden(questions: InterviewQuestion[], answers: Answers): Answers {
  const byKey = new Map(questions.map((q) => [q.key, q]));
  const next = { ...answers };
  for (const q of questions) if (q.key in next && !isVisible(q, byKey, next)) delete next[q.key];
  return next;
}

/** The flow's layout: top-level questions (persistency first, then template order) and each one's follow-ups. */
export function interviewLayout(questions: InterviewQuestion[]) {
  const flow = questions.filter((q) => q.type !== "medication_list");
  const inFlow = new Set(flow.map((q) => q.key));
  const childrenOf = new Map<string, InterviewQuestion[]>();
  const roots: InterviewQuestion[] = [];
  for (const q of flow) {
    const parent = q.showWhen?.key;
    if (parent && inFlow.has(parent) && parent !== q.key) {
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent)!.push(q);
    } else roots.push(q);
  }
  roots.sort((a, b) => Number(Boolean(b.persistency)) - Number(Boolean(a.persistency)));
  return { roots, childrenOf, medicationQuestion: questions.find((q) => q.type === "medication_list") ?? null };
}

/** "9 of 14" answered among the questions on screen; whether every required one is answered; any knockout. */
export function interviewProgress(questions: InterviewQuestion[], answers: Answers, medications: MedicationRow[]) {
  const byKey = new Map(questions.map((q) => [q.key, q]));
  const visible = questions.filter((q) => isVisible(q, byKey, answers));
  const flow = visible.filter((q) => q.type !== "medication_list");
  const required = visible.filter((q) => q.required);
  const missing = required.filter((q) => !isAnswered(q, answers[q.key], medications)).length;
  return {
    answered: flow.filter((q) => isAnswered(q, answers[q.key], medications)).length,
    shown: flow.length,
    missingRequired: missing,
    allRequired: missing === 0,
    knockedOut: visible.some((q) => isKnockedOut(q, answers[q.key])),
  };
}

const PERSISTENCY_HEADING = "Before we start";
/**
 * The heading a question sits under. Keyed by the words shown, not by where the question came from:
 * a template whose first section is itself called "Before we start" puts its other questions right
 * after the persistency block, and keying them apart printed the same heading twice in a row.
 */
const sectionHeading = (q: InterviewQuestion) => (q.persistency ? PERSISTENCY_HEADING : q.section);
const sectionKey = (q: InterviewQuestion) => sectionHeading(q).trim().toLowerCase();

export function InterviewQuestionList({ questions, answers, readOnly, onAnswers }: {
  questions: InterviewQuestion[];
  answers: Answers;
  readOnly: boolean;
  /** The whole answer set after a change, hidden follow-ups already removed. */
  onAnswers: (next: Answers) => void;
}) {
  const byKey = new Map(questions.map((q) => [q.key, q]));
  const { roots, childrenOf } = interviewLayout(questions);
  const visible = (q: InterviewQuestion) => isVisible(q, byKey, answers);

  const setAnswer = (key: string, value: AnswerValue) => onAnswers(pruneHidden(questions, { ...answers, [key]: { ...answers[key], value } }));
  const setNotes = (key: string, notes: string) => onAnswers({ ...answers, [key]: { value: answers[key]?.value ?? null, ...(notes ? { notes } : {}) } });

  /** Red for the knockout answer, amber for an answer that opens a follow-up, green otherwise. */
  const toneFor = (q: InterviewQuestion) => (value: AnswerValue): ChipTone => {
    if (q.knockout && value !== null && String(value) === String(q.knockout.when)) return "danger";
    if ((childrenOf.get(q.key) ?? []).some((c) => c.showWhen && String(c.showWhen.equals) === String(value))) return "warning";
    return "good";
  };

  const row = (q: InterviewQuestion, number: number | null, followUp: boolean): ReactNode => {
    const kids = (childrenOf.get(q.key) ?? []).filter(visible);
    return (
      <QuestionRow
        key={q.key}
        q={q}
        number={number}
        answer={answers[q.key]}
        readOnly={readOnly}
        followUp={followUp}
        onAnswer={(v) => setAnswer(q.key, v)}
        onNotes={(n) => setNotes(q.key, n)}
        toneFor={toneFor(q)}
      >
        {kids.length > 0 && (
          <FollowUps because={answerText(answers[q.key]?.value)}>
            {kids.map((k) => row(k, null, true))}
          </FollowUps>
        )}
      </QuestionRow>
    );
  };

  const shown = roots.filter(visible);
  const sections = new Set(shown.map(sectionKey)).size;
  return (
    <>
      {shown.map((q, i) => (
        <Fragment key={q.key}>
          {sections > 1 && (i === 0 || sectionKey(shown[i - 1]) !== sectionKey(q)) && (
            <div className="border-t border-[var(--border)] bg-[var(--canvas)] px-5 py-2 text-xs font-semibold uppercase tracking-[0.02em] text-[var(--muted)]">
              {sectionHeading(q)}
            </div>
          )}
          {row(q, i + 1, false)}
        </Fragment>
      ))}
    </>
  );
}
