"use client";

/**
 * LA-3.1 · the underwriting preview, drawn exactly as the agent sees it on the call (owner 2026-10-28):
 * the same card, sections and footer as the Interview step (components/app/applications/workspace/
 * steps/interview-step.tsx). The stored definition goes through `interviewQuestions()` (the converter
 * the interview reads a template with); the questions through `InterviewQuestionList` with its
 * folding sections; the medication question as the step's own Medications section ("Takes none",
 * Add medication, `MedicationTable`); and the footer with the template's name and version, what is
 * still required and the way on. Answers are not kept, and the way on goes nowhere.
 *
 * Round 2 (owner 2026-10-30): "Ask as" picks the client's age band and tobacco use, and the questions
 * are filtered by `appliesToInsured`, the rule the Interview step uses, so a question set to
 * "Ages 50 and over" is hidden for an under-50 client here exactly as on the call.
 */

import { useMemo, useState } from "react";
import { ArrowRight, Check, Maximize2, Plus } from "lucide-react";

import { InterviewQuestionList, interviewLayout, interviewProgress, type Answers } from "@/components/app/applications/workspace/interview/interview-form";
import { MedicationTable, newMedicationRow } from "@/components/app/applications/workspace/interview/medication-table";
import { NO_MEDICATIONS, questionDomId } from "@/components/app/applications/workspace/interview/question-input";
import { FoldSection } from "@/components/app/applications/workspace/fold-section";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/page-states";
import { Segmented } from "@/components/ui/view-tabs";
import { appliesToInsured, interviewQuestions, type InsuredFacts, type StoredDefinition } from "@/lib/applications/templates";
import type { MedicationRow } from "@/lib/applications/types";

type AgeBand = "any" | "over" | "under";
type Tobacco = "unknown" | "yes" | "no";
const AGE_OF: Record<AgeBand, number | null> = { any: null, over: 65, under: 40 };
const TOBACCO_OF: Record<Tobacco, boolean | null> = { unknown: null, yes: true, no: false };

export function TemplatePreview({ definition, sample, name, version }: { definition: StoredDefinition; sample: boolean; name?: string; version?: number }) {
  const every = useMemo(() => interviewQuestions(definition), [definition]);
  const [age, setAge] = useState<AgeBand>("any");
  const [tobacco, setTobacco] = useState<Tobacco>("unknown");
  const facts: InsuredFacts = { age: AGE_OF[age], tobacco: TOBACCO_OF[tobacco] };
  const questions = useMemo(() => every.filter((q) => appliesToInsured(q, { age: AGE_OF[age], tobacco: TOBACCO_OF[tobacco] })), [every, age, tobacco]);
  const ruled = every.some((q) => Boolean(q.appliesTo));
  const { medicationQuestion } = useMemo(() => interviewLayout(questions), [questions]);
  const [answers, setAnswers] = useState<Answers>({});
  const [medications, setMedications] = useState<MedicationRow[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const progress = interviewProgress(questions, answers, medications);

  if (every.length === 0) return <EmptyState title="Nothing to preview yet" hint="Add a question to the template to see it here." />;

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

  const askAs = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {ruled && <>
      <span className="text-sm font-semibold text-[var(--ink)]">Ask as</span>
      <Segmented label="The client's age" value={age} onChange={setAge} options={[{ key: "any", label: "Any age" }, { key: "over", label: "50 or over" }, { key: "under", label: "Under 50" }]} />
      <Segmented label="The client's tobacco use" value={tobacco} onChange={setTobacco} options={[{ key: "unknown", label: "Tobacco not known" }, { key: "yes", label: "Uses tobacco" }, { key: "no", label: "No tobacco" }]} />
      <span className="text-sm text-[var(--body)]">{questions.length} of {every.length} questions asked{facts.age === null && facts.tobacco === null ? " until the agent knows" : " for this client"}</span>
      </>}
      {/* S7 (owner 2026-10-30): the same interview, alone on the screen, the way the agent meets it on a call. */}
      <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={() => setFull(true)}><Maximize2 aria-hidden="true" />As on a call</Button>
    </div>
  );

  const card = (
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

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {askAs}
      {full ? <p className="m-0 text-sm text-[var(--body)]">Open as on a call.</p> : card}
      <Dialog open={full} onOpenChange={setFull}>
        <DialogContent size="xl" className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{name ?? "Interview"}{version ? ` · v${version}` : ""}</DialogTitle>
            <DialogDescription>The interview as the agent sees it on a call. Answers here are not kept.</DialogDescription>
          </DialogHeader>
          {card}
        </DialogContent>
      </Dialog>
    </div>
  );
}
