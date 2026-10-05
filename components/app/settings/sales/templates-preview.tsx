"use client";

/**
 * LA-3.1 · the underwriting preview. It renders the builder's draft with the interview's own parts:
 * the stored definition goes through `interviewQuestions()` (the converter the interview reads a
 * template with), the questions through `InterviewQuestionList` (the Interview step's renderer —
 * numbering, persistency first, section labels, follow-ups nested and pruned, knockouts), and the
 * medication question through `MedicationTable`, as the Interview step does. Answers are not kept.
 */

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { InterviewQuestionList, interviewLayout, type Answers } from "@/components/app/applications/workspace/interview/interview-form";
import { MedicationTable, newMedicationRow } from "@/components/app/applications/workspace/interview/medication-table";
import { questionDomId } from "@/components/app/applications/workspace/interview/question-input";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { interviewQuestions, type StoredDefinition } from "@/lib/applications/templates";
import type { MedicationRow } from "@/lib/applications/types";

import { WithReason } from "./shared";

export function TemplatePreview({ definition, sample }: { definition: StoredDefinition; sample: boolean }) {
  const questions = useMemo(() => interviewQuestions(definition), [definition]);
  const { medicationQuestion } = useMemo(() => interviewLayout(questions), [questions]);
  const [answers, setAnswers] = useState<Answers>({});
  const [medications, setMedications] = useState<MedicationRow[]>([]);

  const addMedication = () => {
    const row = newMedicationRow();
    setMedications((list) => [...list, row]);
    requestAnimationFrame(() => document.getElementById(`med-${row.id}-name`)?.focus());
  };
  const answered = Object.keys(answers).length > 0 || medications.length > 0;

  return (
    <>
      <TableCard
        title="Preview"
        description="What the agent sees on the Interview step. Answers here are not kept."
        action={questions.length > 0 ? (
          <WithReason reason={answered ? null : "Nothing has been answered yet."}>
            <Button type="button" variant="outline" disabled={!answered} onClick={() => { setAnswers({}); setMedications([]); }}>Clear the answers</Button>
          </WithReason>
        ) : undefined}
      >
        {questions.length === 0
          ? <EmptyState title="Nothing to preview yet" hint="Add a question to the template to see it here." />
          : <InterviewQuestionList questions={questions} answers={answers} readOnly={false} onAnswers={setAnswers} />}
      </TableCard>
      {medicationQuestion && (
        <TableCard
          title={medicationQuestion.label || "Medications"}
          action={<Button type="button" variant="outline" onClick={addMedication}><Plus aria-hidden="true" />Add medication</Button>}
        >
          <MedicationTable id={questionDomId(medicationQuestion.key)} rows={medications} onChange={setMedications} readOnly={false} sample={sample} />
        </TableCard>
      )}
    </>
  );
}
