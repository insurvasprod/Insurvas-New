"use client";

/**
 * Owner pick C, 2026-10-28 (canvas M3 · Qualify): answered questions fold to one line and the next one is
 * marked "Ask now", so the agent always knows where they are. The client card beside every step
 * (../client-card.tsx) turns the answers into facts and lists the required questions still to ask; a click
 * there opens the folded question here.
 *
 * Step ② — the underwriting interview (LA-3.2 on LA-3.1 templates; board l3-ws-interview). One card
 * of numbered questions — the five persistency questions first — with follow-ups nested under the
 * answer that opened them, knockouts that cannot be missed, and the medication rows in their own
 * card. Every answer autosaves as it is given. The template decides everything shown: a Term Life
 * case gets the Term Life template from the server and this renders it the same way.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Plus } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { appliesToInsured, insuredFacts } from "@/lib/applications/templates";
import type { MedicationRow } from "@/lib/applications/types";

import { useWorkspace } from "@/components/app/applications/workspace/context";
import { StepCard } from "@/components/app/applications/workspace/step-card";
import { InterviewQuestionList, interviewLayout, interviewProgress } from "@/components/app/applications/workspace/interview/interview-form";
import { MedicationTable, newMedicationRow } from "@/components/app/applications/workspace/interview/medication-table";
import { NO_MEDICATIONS, questionDomId } from "@/components/app/applications/workspace/interview/question-input";
import { FoldSection } from "@/components/app/applications/workspace/fold-section";
import { AutosaveChip, calendarDate } from "./step-bits";

export function InterviewStep() {
  const { interview, attempt, readOnly, sample, updateInterview, actions, goTo } = useWorkspace();
  const [completing, setCompleting] = useState(false);
  // The answered question opened again from its folded line (or from a fact on the client card).
  const [openKey, setOpenKey] = useState<string | null>(null);
  const questions = useMemo(() => interview?.questions ?? [], [interview]);
  const { medicationQuestion } = useMemo(() => interviewLayout(questions), [questions]);
  // "Applies to" (LA-3.1): a question for smokers, or for one age band, is asked only of that insured.
  const asked = useMemo(() => {
    const facts = insuredFacts(attempt.values, interview?.answers ?? {});
    return questions.filter((q) => appliesToInsured(q, facts));
  }, [attempt.values, interview?.answers, questions]);
  const progress = interviewProgress(asked, interview?.answers ?? {}, interview?.medications ?? []);

  // Leaving the step any other way than Continue — a click on the step rail, the sidebar, Back —
  // completes the interview too, once every required question is answered. Without this the rail's
  // tick depended on which button the agent happened to use.
  const leave = useRef<{ complete: boolean; sampleDone: boolean; run: () => Promise<boolean>; markDone: () => void; toQuote: () => void }>({ complete: false, sampleDone: false, run: actions.completeInterview, markDone: () => {}, toQuote: () => {} });
  useEffect(() => {
    const open = Boolean(interview) && !interview?.completedAt && !readOnly && progress.allRequired && !completing;
    leave.current = {
      complete: open && !sample, sampleDone: open && sample, run: actions.completeInterview,
      markDone: () => updateInterview({ completedAt: new Date().toISOString() }), toQuote: () => goTo("quote"),
    };
  });
  useEffect(() => () => {
    if (leave.current.complete) void leave.current.run();
  }, []);

  // The client card's "Next: quote": with every required question answered it completes the interview
  // (later changes are amendments), then moves on.
  useEffect(() => {
    const onContinue = async () => {
      const l = leave.current;
      if (l.complete || l.sampleDone) {
        l.complete = false;
        setCompleting(true);
        try {
          if (l.sampleDone) l.markDone();
          else if (!(await l.run())) return;
          notify.done("Interview complete");
        } finally {
          setCompleting(false);
        }
      }
      l.toQuote();
    };
    window.addEventListener("workspace:interview-continue", onContinue);
    return () => window.removeEventListener("workspace:interview-continue", onContinue);
  }, []);

  // A fact or a "still to ask" line on the client card, or a Review fix, opens its question here.
  useEffect(() => {
    const open = (id: string) => { if (id.startsWith("health.")) setOpenKey(id.slice("health.".length)); };
    open(decodeURIComponent(window.location.hash.slice(1)));
    const onField = (e: Event) => open(String((e as CustomEvent<string>).detail ?? ""));
    window.addEventListener("workspace:field", onField);
    return () => window.removeEventListener("workspace:field", onField);
  }, []);

  if (!interview) {
    // The doorway opens the interview with the case; a case started before it did, or a spouse added
    // by hand, starts it here.
    const start = async () => {
      setCompleting(true);
      try {
        await actions.startInterview();
      } finally {
        setCompleting(false);
      }
    };
    return (
      <StepCard title="Underwriting interview" actions={<><Button type="button" variant="outline" onClick={() => goTo("verify")}><ArrowLeft aria-hidden="true" />Back to Verify</Button><Button type="button" onClick={() => goTo("quote")}>Continue to Quote<ArrowRight aria-hidden="true" /></Button></>}>
        <EmptyState
          title="No interview for this insured"
          hint={readOnly ? "This attempt is closed, so no interview can be started on it." : "Start it now and ask the questions while the client is on the line."}
          action={readOnly ? undefined : <Button type="button" onClick={() => { void start(); }} disabled={completing} title={completing ? "Starting the interview" : undefined}>{completing ? "Starting…" : "Start the interview"}</Button>}
        />
      </StepCard>
    );
  }
  if (questions.length === 0) {
    return (
      <StepCard title={interview.templateName} actions={<><Button type="button" variant="outline" onClick={() => goTo("verify")}><ArrowLeft aria-hidden="true" />Back to Verify</Button><Button type="button" onClick={() => goTo("quote")}>Continue to Quote<ArrowRight aria-hidden="true" /></Button></>}>
        <EmptyState title="No interview template" hint="Publish an underwriting template in Settings › Sales." />
      </StepCard>
    );
  }

  const { answers, medications } = interview;
  const notAsked = new Set(questions.filter((q) => !asked.includes(q)).map((q) => q.key));

  const setMedications = (rows: MedicationRow[]) => updateInterview({ medications: rows });
  const medKey = medicationQuestion?.key ?? null;
  const takesNone = Boolean(medKey && answers[medKey]?.value === NO_MEDICATIONS);
  /** "Takes none" is stored as the medication question's answer; adding a row clears it. */
  const setTakesNone = (none: boolean) => {
    if (!medKey) return;
    updateInterview({ answers: { ...answers, [medKey]: { ...answers[medKey], value: none ? NO_MEDICATIONS : null } } });
  };
  const addMedication = () => {
    const row = newMedicationRow();
    if (takesNone) setTakesNone(false);
    setMedications([...medications, row]);
    requestAnimationFrame(() => document.getElementById(`med-${row.id}-name`)?.focus());
  };
  const medsDone = medications.length > 0 || takesNone;
  const medicationSection = medicationQuestion && asked.includes(medicationQuestion) ? (
    <FoldSection
      heading="Medications"
      done={medsDone ? 1 : 0}
      total={1}
      complete={medsDone}
      keepOpen={openKey === medKey}
      progressLabel="None added yet"
      completeLabel={takesNone ? "Complete · takes none" : `Complete · ${medications.length} medication${medications.length === 1 ? "" : "s"}`}
    >
      <div className="flex flex-col gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface-alt)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-card-title text-[var(--ink)]">{medicationQuestion.label || "What medications do you take?"}{medicationQuestion.required && <span className="text-[var(--error-ink)]"> *</span>}</p>
          </div>
          {!readOnly && (
            <span className="flex flex-wrap items-center gap-2">
              {medications.length === 0 && (
                <Button type="button" size="sm" variant={takesNone ? "default" : "outline"} aria-pressed={takesNone} onClick={() => setTakesNone(!takesNone)}>
                  {takesNone && <Check aria-hidden="true" />}Takes none
                </Button>
              )}
              <Button type="button" size="sm" variant="outline" onClick={addMedication}><Plus aria-hidden="true" />Add medication</Button>
            </span>
          )}
        </div>
        {(medications.length > 0 || !takesNone) && (
          <MedicationTable id={questionDomId(medicationQuestion.key)} rows={medications} onChange={setMedications} readOnly={readOnly} sample={sample} />
        )}
      </div>
    </FoldSection>
  ) : null;


  return (
      <div className="flex min-w-0 flex-col gap-5">
        {/* Owner pick C, 2026-10-28: one card of questions, "Next: quote" at its bottom right. */}
        <section aria-label={`${interview.templateName} · v${interview.templateRevision}`} className="m-glass flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--border)] p-[18px]">
          <InterviewQuestionList questions={asked} answers={answers} readOnly={readOnly} collapse={{ openKey, onOpen: setOpenKey }} beforeNotes={medicationSection} onAnswers={(next) => updateInterview({ answers: Object.fromEntries(Object.entries(next).filter(([key]) => !notAsked.has(key))) })} />
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">
            <AutosaveChip />
            {interview.completedAt && <StatusChip tone="good" title="Changes made after this are recorded with who and when.">Completed {calendarDate(interview.completedAt)}</StatusChip>}
            {/* S14 (owner 2026-10-30): the agent can see which questions these are and why, and a
                knockout goes straight to Quote. */}
            <span className="inline-flex items-center gap-1">
              {interview.templateName} · v{interview.templateRevision}
              <InfoTip label="Why these questions?">
                Your agency picks the health questions for each product, and for a carrier that asks different ones. This call loads {interview.templateName}, version {interview.templateRevision}. Settings › Underwriting templates shows them all.
              </InfoTip>
            </span>
            {progress.knockedOut && (
              <span className="inline-flex flex-wrap items-center gap-2 font-semibold text-[var(--error-ink)]">
                A knockout rules out this carrier, not the client.
                {!readOnly && <Button type="button" variant="outline" size="sm" onClick={() => goTo("quote")}>Quote another carrier<ArrowRight aria-hidden="true" /></Button>}
              </span>
            )}
            {/* The way on, bottom right of the questions (owner 2026-10-28): lit once every required question is answered. */}
            <span className="ml-auto flex items-center gap-3">
              {!progress.allRequired && !interview.completedAt && <span>{progress.missingRequired} required left</span>}
              <Button type="button" variant={progress.allRequired || interview.completedAt ? "default" : "outline"} onClick={() => window.dispatchEvent(new Event("workspace:interview-continue"))} disabled={completing} title={progress.allRequired ? undefined : "You can move on and come back; the interview completes once every required question is answered."}>
                {completing ? "Completing…" : "Next: quote"}<ArrowRight aria-hidden="true" />
              </Button>
            </span>
          </div>
        </section>

        {/* Monthly income is no longer asked here (owner 2026-10-28): the template's financial justification
            questions cover it, and the Payment step still captures it beside the draft date (LA-5.10). */}
      </div>
  );
}
