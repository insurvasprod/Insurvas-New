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

import { FoldSection } from "@/components/app/applications/workspace/fold-section";

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

/**
 * A top-level question and every follow-up it opened are answered (the client card folds these to one line).
 * Medications are not in the flow, so they never count here.
 */
export function rootDone(q: InterviewQuestion, questions: InterviewQuestion[], answers: Answers): boolean {
  const byKey = new Map(questions.map((x) => [x.key, x]));
  const { childrenOf } = interviewLayout(questions);
  const done = (x: InterviewQuestion): boolean => isAnswered(x, answers[x.key], []) && (childrenOf.get(x.key) ?? []).filter((k) => isVisible(k, byKey, answers)).every(done);
  return done(q);
}

/** The first top-level question still to ask, in the order the list draws them. */
export function nextToAsk(questions: InterviewQuestion[], answers: Answers): InterviewQuestion | null {
  const byKey = new Map(questions.map((x) => [x.key, x]));
  return interviewLayout(questions).roots.filter((q) => isVisible(q, byKey, answers)).find((q) => !rootDone(q, questions, answers)) ?? null;
}

export function InterviewQuestionList({ questions, answers, readOnly, onAnswers, collapse, beforeNotes }: {
  questions: InterviewQuestion[];
  answers: Answers;
  readOnly: boolean;
  /** The whole answer set after a change, hidden follow-ups already removed. */
  onAnswers: (next: Answers) => void;
  /**
   * The client card (owner pick C, 2026-10-28): a question answered with its follow-ups folds to one line
   * showing the answer; a click opens it again. The next question to ask is marked "Ask now". A knockout
   * answer never folds. Omitted (the Settings preview): every question drawn in full.
   */
  collapse?: { openKey: string | null; onOpen: (key: string | null) => void };
  /** A section drawn just above the Notes section (or last, with no Notes): the interview's Medications. */
  beforeNotes?: ReactNode;
}) {
  const byKey = new Map(questions.map((q) => [q.key, q]));
  const { roots, childrenOf } = interviewLayout(questions);
  const visible = (q: InterviewQuestion) => isVisible(q, byKey, answers);
  const next = collapse ? nextToAsk(questions, answers) : null;
  const knockedAnywhere = (q: InterviewQuestion): boolean => isKnockedOut(q, answers[q.key]) || (childrenOf.get(q.key) ?? []).filter(visible).some(knockedAnywhere);

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

  if (collapse) {
    // Owner, 2026-10-28: sections that fold like the call's verification (FoldSection), two questions to
    // a line. The section holding the question asked for (a fact on the client card, a Review fix) stays
    // open, and one with a knockout answer never folds. The next question to ask is marked "Ask now".
    const groups: { key: string; heading: string; items: { q: InterviewQuestion; n: number }[] }[] = [];
    shown.forEach((q, i) => {
      const key = sectionKey(q);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.items.push({ q, n: i + 1 });
      else groups.push({ key, heading: sectionHeading(q), items: [{ q, n: i + 1 }] });
    });
    const done = (q: InterviewQuestion) => rootDone(q, questions, answers);
    const notesAt = groups.findIndex((g) => g.key === "notes");
    return (
      <div className="flex flex-col gap-2">
        {groups.map((g, gi) => (
          <Fragment key={g.key}>
          {gi === notesAt && beforeNotes}
          <FoldSection
            key={g.key}
            heading={g.heading}
            done={g.items.filter((x) => done(x.q)).length}
            total={g.items.length}
            complete={g.items.every((x) => done(x.q)) && !g.items.some((x) => knockedAnywhere(x.q))}
            keepOpen={g.items.some((x) => x.q.key === collapse.openKey)}
          >
            {g.items.map(({ q, n: number }) => (
              <QuestionRow
                key={q.key}
                q={q}
                number={number}
                answer={answers[q.key]}
                readOnly={readOnly}
                card={{ isNext: next?.key === q.key }}
                onAnswer={(v) => setAnswer(q.key, v)}
                onNotes={(note) => setNotes(q.key, note)}
                toneFor={toneFor(q)}
              >
                {(childrenOf.get(q.key) ?? []).filter(visible).length > 0 && (
                  <FollowUps because={answerText(answers[q.key]?.value)}>
                    {(childrenOf.get(q.key) ?? []).filter(visible).map((k) => row(k, null, true))}
                  </FollowUps>
                )}
              </QuestionRow>
            ))}
          </FoldSection>
          </Fragment>
        ))}
        {notesAt === -1 && beforeNotes}
      </div>
    );
  }

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
