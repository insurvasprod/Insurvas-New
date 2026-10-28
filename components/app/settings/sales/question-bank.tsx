"use client";

/**
 * Settings › Underwriting questions · the question bank (owner pick C, 2026-10-28). Insurvas's recommended
 * questions by topic, each with a tick: ticked means the agents ask it. Ticking adds the question and its
 * follow-ups to the template; unticking takes them out. The five persistency questions are always on. The
 * agency's own questions are written with "Add a question" in the list beside this, and any question is
 * changed by clicking it there (the editor then takes this panel's place).
 */

import { Check, Lock } from "lucide-react";

import { SettingsCard } from "@/components/app/settings/primitives";
import { StatusChip } from "@/components/ui/status-chip";
import { addFromBank, BANK_TOPICS, inDraft, removeFromBank } from "@/lib/salesSettings/questionBank";
import type { UwDraft, UwQuestion } from "@/lib/salesSettings/templateDefinition";
import { cn } from "@/lib/utils";

const TYPE: Record<UwQuestion["type"], string> = {
  boolean: "Yes / No", single_select: "One choice", multi_select: "Several choices", date: "Date", number: "Number", currency: "Dollar amount",
  text: "Free text", long_text: "Long free text", medication_list: "Medication list",
};

export function QuestionBank({ draft, onChange, readOnly, templateName }: { draft: UwDraft; onChange: (next: UwDraft) => void; readOnly: boolean; templateName: string }) {
  const asked = BANK_TOPICS.flatMap((t) => t.questions).filter((q) => !q.showWhen && inDraft(draft, q.key)).length;
  const offered = BANK_TOPICS.flatMap((t) => t.questions).filter((q) => !q.showWhen).length;
  return (
    <SettingsCard
      title="Pick what your agents ask"
      sub={`Insurvas recommends these for ${templateName}. Tick one to ask it, untick to skip it. ${asked} of ${offered} ticked.`}
    >
      <div className="flex flex-col gap-5">
        {BANK_TOPICS.map((topic) => (
          <section key={topic.key} aria-label={topic.title} className="flex flex-col gap-1.5">
            <div>
              <h4 className="m-0 text-sm font-semibold text-[var(--ink)]">{topic.title}</h4>
              <p className="m-0 text-xs leading-[1.5] text-[var(--muted)]">{topic.note}</p>
            </div>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {topic.questions.filter((q) => !q.showWhen).map((q) => {
                const on = inDraft(draft, q.key);
                const locked = q.persistency;
                const kids = topic.questions.filter((x) => x.showWhen?.key === q.key);
                return (
                  <li key={q.key}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      disabled={readOnly || locked}
                      title={locked ? "One of the five persistency questions: on in every template." : readOnly ? "Read-only" : on ? "Untick to stop asking it" : "Tick to ask it"}
                      onClick={() => onChange(on ? removeFromBank(draft, q.key) : addFromBank(draft, q.key))}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-[10px] border px-3 py-2.5 text-left transition-colors disabled:cursor-default",
                        on ? "border-[color-mix(in_srgb,var(--primary)_40%,var(--border))] bg-[var(--primary-soft)]" : "border-[var(--border)] bg-[var(--surface-alt)] hover:border-[var(--border-strong)]",
                      )}
                    >
                      <span aria-hidden="true" className={cn("mt-0.5 inline-grid size-5 shrink-0 place-items-center rounded-[6px] border-[1.5px]", on ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]" : "border-[var(--border-strong)]")}>
                        {locked ? <Lock className="size-3" /> : on ? <Check className="size-3.5" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-[var(--ink)]">{q.label}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
                          <span>{TYPE[q.type]}</span>
                          {q.required ? <span>Required</span> : <span>Optional</span>}
                          {q.knockout && <StatusChip dot={false} tone="danger">Knockout</StatusChip>}
                          {locked && <span className="font-semibold text-[var(--accent-ink)]">Always on</span>}
                          {kids.length > 0 && <span>Opens {kids.length} follow-up{kids.length === 1 ? "" : "s"}: {kids.map((k) => k.label).join(" · ")}</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </SettingsCard>
  );
}
