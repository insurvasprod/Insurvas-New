"use client";

/**
 * Step ② — the underwriting interview (LA-3.2 on LA-3.1 templates; board l3-ws-interview). One card
 * of numbered questions — the five persistency questions first — with follow-ups nested under the
 * answer that opened them, knockouts that cannot be missed, and the medication rows in their own
 * card. Every answer autosaves as it is given. The template decides everything shown: a Term Life
 * case gets the Term Life template from the server and this renders it the same way.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Plus } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { Meter } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { appliesToInsured, insuredFacts } from "@/lib/applications/templates";
import type { MedicationRow } from "@/lib/applications/types";

import { useWorkspace } from "@/components/app/applications/workspace/context";
import { StepCard } from "@/components/app/applications/workspace/step-card";
import { InterviewQuestionList, interviewLayout, interviewProgress } from "@/components/app/applications/workspace/interview/interview-form";
import { MedicationTable, newMedicationRow } from "@/components/app/applications/workspace/interview/medication-table";
import { questionDomId } from "@/components/app/applications/workspace/interview/question-input";
import { AutosaveChip, calendarDate } from "./step-bits";

export function InterviewStep() {
  const { interview, attempt, readOnly, sample, updateInterview, actions, goTo } = useWorkspace();
  const [completing, setCompleting] = useState(false);
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
  const leave = useRef<{ complete: boolean; run: () => Promise<boolean> }>({ complete: false, run: actions.completeInterview });
  useEffect(() => {
    leave.current = { complete: Boolean(interview) && !interview?.completedAt && !readOnly && !sample && progress.allRequired && !completing, run: actions.completeInterview };
  });
  useEffect(() => () => {
    if (leave.current.complete) void leave.current.run();
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
  const count = `${progress.answered} of ${progress.shown}`;

  const setMedications = (rows: MedicationRow[]) => updateInterview({ medications: rows });
  const addMedication = () => {
    const row = newMedicationRow();
    setMedications([...medications, row]);
    requestAnimationFrame(() => document.getElementById(`med-${row.id}-name`)?.focus());
  };

  // Continuing with every required question answered completes the interview; later changes are amendments.
  const cont = async () => {
    if (!readOnly && !interview.completedAt && progress.allRequired) {
      leave.current.complete = false;
      setCompleting(true);
      try {
        if (!(await actions.completeInterview())) return;
        if (sample) updateInterview({ completedAt: new Date().toISOString() });
        notify.done("Interview complete");
      } finally {
        setCompleting(false);
      }
    }
    goTo("quote");
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
        <StepCard
          title={`${interview.templateName} · v${interview.templateRevision}`}
          chips={<>
            <AutosaveChip />
            {interview.completedAt
              ? <StatusChip tone="good" title="Changes made after this are recorded with who and when.">Completed {calendarDate(interview.completedAt)}</StatusChip>
              : <StatusChip tone="neutral" dot>{count}</StatusChip>}
          </>}
          bodyClassName="gap-0 p-0"
          footerNote={progress.knockedOut ? "A knockout rules out this carrier, not the client — try another on the Quote step." : interview.completedAt && !readOnly ? "Changes after the call are recorded with who and when." : undefined}
          actions={<>
            <Button type="button" variant="outline" onClick={() => goTo("verify")}><ArrowLeft aria-hidden="true" />Back to Verify</Button>
            <Button type="button" onClick={() => { void cont(); }} disabled={completing} title={completing ? "Saving the interview" : undefined}>
              {completing ? "Completing…" : "Continue to Quote"}<ArrowRight aria-hidden="true" />
            </Button>
          </>}
        >
          <div className="flex flex-col gap-1.5 px-5 pt-3.5 pb-4">
            <Meter value={progress.answered} max={progress.shown || 1} tone="primary" label={`${count} answered`} className="h-1.5" />
            <span className="text-xs text-[var(--muted)]">
              {count} answered
              {!interview.completedAt && progress.missingRequired > 0 && ` · ${progress.missingRequired} required still to ask`}
              {progress.knockedOut && <span className="font-semibold text-[var(--error-ink)]"> · knockout answered</span>}
            </span>
          </div>
          <InterviewQuestionList questions={asked} answers={answers} readOnly={readOnly} onAnswers={(next) => updateInterview({ answers: Object.fromEntries(Object.entries(next).filter(([key]) => !notAsked.has(key))) })} />
        </StepCard>

        {medicationQuestion && (
          <StepCard
            title={medicationQuestion.label || "Medications"}
            chips={<>
              <StatusChip tone="neutral" dot>{medications.length === 1 ? "1 row" : `${medications.length} rows`}</StatusChip>
              {!readOnly && <Button type="button" variant="outline" onClick={addMedication}><Plus aria-hidden="true" />Add medication</Button>}
            </>}
            bodyClassName="gap-0 p-0"
          >
            <MedicationTable id={questionDomId(medicationQuestion.key)} rows={medications} onChange={setMedications} readOnly={readOnly} sample={sample} />
          </StepCard>
        )}
    </div>
  );
}
