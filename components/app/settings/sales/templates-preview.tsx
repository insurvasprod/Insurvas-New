"use client";

/**
 * LA-3.1 · the underwriting preview, drawn exactly as the agent sees it on the call (owner 2026-10-28):
 * the same card, sections and footer as the Interview step (components/app/applications/workspace/
 * steps/interview-step.tsx). The stored definition goes through `interviewQuestions()` (the converter
 * the interview reads a template with); the questions through `InterviewQuestionList` with its
 * folding sections; the medication question as the step's own Medications section ("Takes none",
 * Add medication, `MedicationTable`); and the footer with the template's name and version, what is
 * still required and the way on. Answers are not kept, and the way on goes nowhere.
 */

import { useMemo, useState } from "react";
import { ArrowRight, Check, Plus } from "lucide-react";

import { InterviewQuestionList, interviewLayout, interviewProgress, type Answers } from "@/components/app/applications/workspace/interview/interview-form";
import { MedicationTable, newMedicationRow } from "@/components/app/applications/workspace/interview/medication-table";
import { NO_MEDICATIONS, questionDomId } from "@/components/app/applications/workspace/interview/question-input";
import { FoldSection } from "@/components/app/applications/workspace/fold-section";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { interviewQuestions, type StoredDefinition } from "@/lib/applications/templates";
import type { MedicationRow } from "@/lib/applications/types";

export function TemplatePreview({ definition, sample, name, version }: { definition: StoredDefinition; sample: boolean; name?: string; version?: number }) {
  const questions = useMemo(() => interviewQuestions(definition), [definition]);
  const { medicationQuestion } = useMemo(() => interviewLayout(questions), [questions]);
  const [answers, setAnswers] = useState<Answers>({});
  const [medications, setMedications] = useState<MedicationRow[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const progress = interviewProgress(questions, answers, medications);

  if (questions.length === 0) return <EmptyState title="Nothing to preview yet" hint="Add a question to the template to see it here." />;

  const medKey = medicationQuestion?.key ?? null;
  const takesNone = Boolean(medKey && answers[medKey]?.value === NO_MEDICATIONS);
  const setTakesNone = (none: boolean) => {
    if (!medKey) return;
    setAnswers({ ...answers, [medKey]: { ...answers[medKey], value: none ? NO_MEDICATIONS : null } });
  };
  const addMedication = () => {
    const row = newMedicationRow();
    if (takesNone) setTakesNone(false);
    setMedications((list) => [...list, row]);
    requestAnimationFrame(() => document.getElementById(`med-${row.id}-name`)?.focus());
  };
  const medsDone = medications.length > 0 || takesNone;
  const medicationSection = medicationQuestion ? (
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
          <p className="min-w-0 text-card-title text-[var(--ink)]">{medicationQuestion.label || "What medications do you take?"}{medicationQuestion.required && <span className="text-[var(--error-ink)]"> *</span>}</p>
          <span className="flex flex-wrap items-center gap-2">
            {medications.length === 0 && (
              <Button type="button" size="sm" variant={takesNone ? "default" : "outline"} aria-pressed={takesNone} onClick={() => setTakesNone(!takesNone)}>
                {takesNone && <Check aria-hidden="true" />}Takes none
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={addMedication}><Plus aria-hidden="true" />Add medication</Button>
          </span>
        </div>
        {(medications.length > 0 || !takesNone) && (
          <MedicationTable id={questionDomId(medicationQuestion.key)} rows={medications} onChange={setMedications} readOnly={false} sample={sample} />
        )}
      </div>
    </FoldSection>
  ) : null;

  return (
    <section aria-label="Preview of the interview" className="m-glass flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--border)] p-[18px]">
      <InterviewQuestionList questions={questions} answers={answers} readOnly={false} collapse={{ openKey, onOpen: setOpenKey }} beforeNotes={medicationSection} onAnswers={setAnswers} />
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">
        {name && <span>{name}{version ? ` · v${version}` : ""}</span>}
        {progress.knockedOut && <span className="font-semibold text-[var(--error-ink)]">A knockout rules out this carrier, not the client: try another on the Quote step.</span>}
        <span className="ml-auto flex items-center gap-3">
          {(Object.keys(answers).length > 0 || medications.length > 0) && (
            <Button type="button" variant="ghost" size="sm" onClick={() => { setAnswers({}); setMedications([]); }}>Clear the answers</Button>
          )}
          {!progress.allRequired && <span>{progress.missingRequired} required left</span>}
          <Button type="button" variant={progress.allRequired ? "default" : "outline"} disabled title="A preview: the agent moves on to the quote from here.">
            Next: quote<ArrowRight aria-hidden="true" />
          </Button>
        </span>
      </div>
    </section>
  );
}
