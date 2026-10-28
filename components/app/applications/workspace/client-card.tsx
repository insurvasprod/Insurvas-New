"use client";

/**
 * The client card (owner pick C, 2026-10-28, canvas M3 · Application): on every step, beside the step.
 *
 * - What we know: the interview's answers in plain words (lib/applications/clientFacts.ts) and the quote on
 *   the application. A fact opens the question it came from.
 * - This step, still to do: the pre-submission checks (LA-3.11) that belong to the step on screen, each a
 *   button to its field; on the interview, the required questions not yet asked. It replaces the right-hand
 *   QA rail: the whole verdict lives on the Review step.
 */

import { useMemo } from "react";


import { clientFacts, type FactTone } from "@/lib/applications/clientFacts";
import { WORKSPACE_STEPS } from "@/lib/applications/constants";
import { appliesToInsured, insuredFacts } from "@/lib/applications/templates";
import { formatCentsAsCurrency } from "@/lib/money";
import { cn } from "@/lib/utils";

import { face } from "@/components/app/applications/parts";
import { isVisible } from "@/components/app/applications/workspace/interview/interview-form";
import { isAnswered, questionDomId } from "@/components/app/applications/workspace/interview/question-input";
import { useWorkspace } from "./context";

const EDGE: Record<FactTone, string> = { good: "border-l-[var(--primary)]", warning: "border-l-[var(--warning)]", danger: "border-l-[var(--error)]", neutral: "border-l-[var(--border-strong)]" };
const LABEL = new Map(WORKSPACE_STEPS.map((s) => [s.key, s.label]));

export function ClientCard({ name }: { name: string }) {
  const { attempt, interview, qa, step, goTo, readOnly } = useWorkspace();
  const questions = useMemo(() => interview?.questions ?? [], [interview]);
  const answers = useMemo(() => interview?.answers ?? {}, [interview]);
  const medications = useMemo(() => interview?.medications ?? [], [interview]);
  const asked = useMemo(() => {
    const facts = insuredFacts(attempt.values, answers);
    return questions.filter((q) => appliesToInsured(q, facts));
  }, [attempt.values, answers, questions]);

  const facts = clientFacts(asked, answers, medications);
  const quote = attempt.quotes.find((q) => q.id === attempt.selectedQuoteId);
  const state = typeof attempt.values["addr.state"]?.value === "string" ? String(attempt.values["addr.state"]?.value) : null;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");

  const onInterview = step === "interview" && Boolean(interview);
  const live = attempt.status === "draft" || attempt.status === "ready";
  const byKey = new Map(asked.map((q) => [q.key, q]));
  const toAsk = step === "interview" && interview && !interview.completedAt
    ? asked.filter((q) => q.required && isVisible(q, byKey, answers) && !isAnswered(q, answers[q.key], medications))
    : [];
  const items = live && !readOnly ? [...qa.blocking.map((i) => ({ ...i, level: "block" as const })), ...qa.warnings.map((i) => ({ ...i, level: "warn" as const }))].filter((i) => i.step === step) : [];
  const elsewhere = live && !readOnly ? qa.blocking.filter((i) => i.step !== step).length : 0;
  const nothingLeft = toAsk.length === 0 && items.length === 0;

  return (
    <aside aria-label="The client and what is left" className="m-glass flex flex-col gap-3 rounded-xl border border-[color-mix(in_srgb,var(--primary)_30%,var(--border))] p-4 lg:sticky lg:top-[calc(var(--top-bar-h)+16px)]">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="inline-grid size-11 shrink-0 place-items-center rounded-[12px] bg-[var(--primary-soft)] text-sm font-bold text-[var(--accent-ink)]">{initials || "?"}</span>
        <span className="min-w-0">
          <strong className="block truncate text-base font-semibold text-[var(--ink)]">{name}{state ? `, ${state}` : ""}</strong>
          <span className="text-xs text-[var(--muted)]">{onInterview ? "Builds itself from the answers" : "What we know"}</span>
        </span>
      </div>

      {facts.length === 0 && !quote ? (
        <p className="m-0 text-sm text-[var(--muted)]">{onInterview ? "Answers turn into facts here as you ask." : "The interview’s answers turn into facts here: the draft date, a replacement notice, a knockout, the medications."}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {facts.map((f) => (
            <li key={f.key}>
              <button type="button" onClick={() => f.questionKey && goTo("interview", questionDomId(f.questionKey))} disabled={!f.questionKey} className={cn("w-full rounded-[10px] border border-[var(--border)] border-l-[3px] bg-[var(--surface-alt)] px-3 py-2.5 text-left disabled:cursor-default", EDGE[f.tone])}>
                <strong className="block text-sm font-semibold text-[var(--ink)]">{f.title}</strong>
                <span className="text-xs leading-[1.5] text-[var(--muted)]">{f.detail}</span>
              </button>
            </li>
          ))}
          {quote && (
            <li>
              <button type="button" onClick={() => goTo("quote")} className={cn("w-full rounded-[10px] border border-[var(--border)] border-l-[3px] bg-[var(--surface-alt)] px-3 py-2.5 text-left", EDGE.neutral)}>
                <strong className="block text-sm font-semibold text-[var(--ink)]">{[attempt.carrierName, quote.productLabel].filter(Boolean).join(" · ") || "The quote"}</strong>
                <span className="text-xs leading-[1.5] text-[var(--muted)]">{formatCentsAsCurrency(quote.monthlyPremiumCents)} a month · {face(quote.faceAmountCents)}</span>
              </button>
            </li>
          )}
        </ul>
      )}

      {onInterview ? (
        // How many required questions are left; the way on is at the questions' own foot (owner 2026-10-28).
        <div className="mt-auto flex flex-col gap-2 border-t border-[var(--border)] pt-3">
          <span className="text-sm text-[var(--body)]">
            {interview?.completedAt ? "Interview complete." : toAsk.length === 0 ? "Every required question is answered." : `${toAsk.length} required question${toAsk.length === 1 ? "" : "s"} left.`}
          </span>
        </div>
      ) : (
      <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
        <span className="text-xs font-semibold tracking-[0.04em] text-[var(--muted)] uppercase">{LABEL.get(step) ?? step} · still to do</span>
        {!live || readOnly ? (
          <span className="text-sm text-[var(--muted)]">{readOnly ? "Read-only: nothing on this attempt can change." : "Submitted: nothing left to fill in here."}</span>
        ) : nothingLeft ? (
          <span className="text-sm text-[var(--accent-ink)]">Nothing left on this step.</span>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {toAsk.slice(0, 4).map((q) => (
              <li key={q.key}><button type="button" onClick={() => goTo("interview", questionDomId(q.key))} className="flex w-full items-start gap-2 rounded-[8px] px-1.5 py-1 text-left text-sm text-[var(--body)] hover:bg-[var(--surface-alt)]"><span aria-hidden="true" className="mt-[7px] size-[7px] shrink-0 rounded-full bg-[var(--warning)]" />{q.label}</button></li>
            ))}
            {toAsk.length > 4 && <li className="px-1.5 text-xs text-[var(--muted)]">and {toAsk.length - 4} more required questions</li>}
            {items.map((i, n) => (
              <li key={`${i.code}-${n}`}><button type="button" onClick={() => goTo(i.step, i.fieldKey)} className="flex w-full items-start gap-2 rounded-[8px] px-1.5 py-1 text-left text-sm text-[var(--body)] hover:bg-[var(--surface-alt)]"><span aria-hidden="true" className={cn("mt-[7px] size-[7px] shrink-0 rounded-full", i.level === "block" ? "bg-[var(--error)]" : "bg-[var(--warning)]")} />{i.message}</button></li>
            ))}
          </ul>
        )}
        {elsewhere > 0 && step !== "review" && (
          <button type="button" onClick={() => goTo("review")} className="self-start text-xs font-semibold text-[var(--accent-ink)] hover:underline">{elsewhere} more to fix on other steps · see Review</button>
        )}
      </div>
      )}
    </aside>
  );
}
