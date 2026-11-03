"use client";

/**
 * Settings › Underwriting templates · the question bank (owner pick C, 2026-10-28). Insurvas's recommended
 * questions by topic, each with a tick: ticked means the agents ask it. Ticking adds the question and its
 * follow-ups to the template; unticking takes them out. The five persistency questions are always on. The
 * agency's own questions are written with "Add a question" in the list beside this, and any question is
 * changed by clicking it there (the editor then takes this panel's place).
 */

import { useState } from "react";
import { Check, ChevronRight, Lock } from "lucide-react";

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
  const roots = (t: (typeof BANK_TOPICS)[number]) => t.questions.filter((q) => !q.showWhen);
  const asked = BANK_TOPICS.flatMap(roots).filter((q) => inDraft(draft, q.key)).length;
  const offered = BANK_TOPICS.flatMap(roots).length;
  // Round 2 (owner 2026-10-30): each topic folds under its own line with a ticked count, so the bank
  // is short on a phone; the five always-on questions, already first in the list beside it, are one line.
  // The bank only renders once a template is opened (in the browser), so the screen width is known here.
  const [closed, setClosed] = useState<Record<string, boolean>>(() =>
    typeof window !== "undefined" && !window.matchMedia("(min-width: 1024px)").matches ? Object.fromEntries(BANK_TOPICS.map((t) => [t.key, true])) : {});
  const always = BANK_TOPICS.find((t) => t.key === "persistency");
  return (
    <SettingsCard title="Question bank" sub={`Insurvas recommends these for ${templateName}. Tick one to ask it. ${asked} of ${offered} ticked.`}>
      <div className="flex flex-col gap-3">
        {always && (
          <div className="flex items-start gap-3 rounded-[10px] border border-[color-mix(in_srgb,var(--primary)_40%,var(--border))] bg-[var(--primary-soft)] px-3 py-2.5">
            <span aria-hidden="true" className="mt-0.5 inline-grid size-5 shrink-0 place-items-center rounded-[6px] bg-[var(--primary)] text-[var(--on-primary)]"><Lock className="size-3" /></span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[var(--ink)]">{roots(always).length} always-on questions</span>
              <span className="block text-xs leading-[1.5] text-[var(--body)]">{always.title}: in every template, first on the call.</span>
            </span>
          </div>
        )}
        {BANK_TOPICS.filter((t) => t.key !== "persistency").map((topic) => {
          const list = roots(topic);
          const ticked = list.filter((q) => inDraft(draft, q.key)).length;
          const isOpen = !closed[topic.key];
          const id = `bank-${topic.key}`;
          return (
            <section key={topic.key} aria-label={topic.title} className="flex flex-col gap-1.5">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={id}
                onClick={() => setClosed({ ...closed, [topic.key]: isOpen })}
                className="flex w-full items-center gap-2 rounded-[8px] py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
              >
                <ChevronRight aria-hidden="true" className={cn("size-4 shrink-0 text-[var(--ink)] transition-transform duration-200", isOpen && "rotate-90")} />
                <span className="min-w-0 flex-1 text-sm font-semibold text-[var(--ink)]">{topic.title}</span>
                <span className="text-xs font-semibold tabular-nums text-[var(--body)]">{ticked} of {list.length}</span>
              </button>
              {isOpen && (
                <div id={id} className="m-swap flex flex-col gap-1.5">
                  <p className="m-0 text-xs leading-[1.5] text-[var(--body)]">{topic.note}</p>
                  <ul className="m-0 flex list-none flex-col gap-1 p-0">
                    {list.map((q) => {
                      const on = inDraft(draft, q.key);
                      const kids = topic.questions.filter((x) => x.showWhen?.key === q.key);
                      return (
                        <li key={q.key}>
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={on}
                            disabled={readOnly}
                            title={readOnly ? "Read-only" : on ? "Untick to stop asking it" : "Tick to ask it"}
                            onClick={() => onChange(on ? removeFromBank(draft, q.key) : addFromBank(draft, q.key))}
                            className={cn(
                              "flex w-full items-start gap-3 rounded-[10px] border px-3 py-2.5 text-left transition-colors disabled:cursor-default",
                              on ? "border-[color-mix(in_srgb,var(--primary)_40%,var(--border))] bg-[var(--primary-soft)]" : "border-[var(--border)] bg-[var(--surface-alt)] hover:border-[var(--border-strong)]",
                            )}
                          >
                            <span aria-hidden="true" className={cn("mt-0.5 inline-grid size-5 shrink-0 place-items-center rounded-[6px] border-[1.5px]", on ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]" : "border-[var(--border-strong)]")}>
                              {on ? <Check className="size-3.5" /> : null}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-[var(--ink)]">{q.label}</span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--body)]">
                                <span>{TYPE[q.type]}</span>
                                {q.required ? <span>Required</span> : <span>Optional</span>}
                                {q.knockout && <StatusChip dot={false} tone="danger">Knockout</StatusChip>}
                                {kids.length > 0 && <span>Opens {kids.length} follow-up{kids.length === 1 ? "" : "s"}: {kids.map((k) => k.label).join(" · ")}</span>}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </SettingsCard>
  );
}
