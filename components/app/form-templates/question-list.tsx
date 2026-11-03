"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Ellipsis, Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { cardHead, cardSurface } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InfoTip } from "@/components/ui/info-tip";
import { StatusChip } from "@/components/ui/status-chip";
import { AddQuestion } from "@/components/app/form-templates/add-question";
import type { Picked } from "@/components/app/form-templates/form-canvas";
import type { TemplateField, TemplateFieldType, TemplateFormDefinition } from "@/lib/templates/constants";
import { fieldMoveBounds } from "@/lib/templates/formMoves";
import { TEMPLATE_SECTION_GROUP_LABELS, sectionAvailability, sectionGroup } from "@/lib/templates/sectionAvailability";

/**
 * Form setup, left: the form as a short list. Parts are numbered and renamed in place; each question
 * is one row with its up and down arrows; a click opens it in the editor. What partners get is the
 * preview beside it (owner 2026-11-03).
 */
export function QuestionList({ form, fields, picked, changed, onPick, onMoveField, onRenameSection, onMoveSection, onRemoveSection, onAddQuestion, onReuse, onAddSection }: {
  form: TemplateFormDefinition;
  fields: TemplateField[];
  picked: Picked;
  /** Field keys whose question or placement differs from the live form. */
  changed: ReadonlySet<string>;
  onPick: (fieldKey: string, sectionKey: string | null) => void;
  onMoveField: (sectionKey: string, fieldKey: string, by: -1 | 1) => void;
  onRenameSection: (sectionKey: string, label: string) => void;
  onMoveSection: (sectionKey: string, by: -1 | 1) => void;
  onRemoveSection: (sectionKey: string) => void;
  onAddQuestion: (sectionKey: string, type: TemplateFieldType) => void;
  onReuse: (sectionKey: string, fieldKey: string) => void;
  onAddSection: () => void;
}) {
  const [addIn, setAddIn] = useState<string | null>(null);
  const fieldMap = new Map(fields.map((field) => [field.field_key, field]));
  const availability = sectionAvailability(form);

  return (
    <section aria-label="Questions" className={cn(cardSurface, "flex min-h-0 min-w-0 flex-col lg:h-full")}>
      <div className={cn(cardHead, "flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-3")}>
        <span className="text-xs font-semibold text-[var(--ink)]">Questions</span>
        <InfoTip label="About the questions">Parts group the questions. Click a question to change it; the preview shows what partners get once you publish.</InfoTip>
        <Button onClick={onAddSection} type="button" variant="outline" size="sm" className="ml-auto"><Plus aria-hidden="true" />Add a part</Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-3 sm:p-4">
        {form.sections.map((section, index) => {
          const inSection = new Set(section.fields.map((field) => field.field_key));
          const topic = sectionGroup(section);
          const topicOn = topic ? availability[topic] : true;
          return (
            <section key={section.section_key} aria-label={`Part ${index + 1}: ${section.label}`} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <span aria-hidden="true" className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-xs font-semibold text-[var(--surface)]">{index + 1}</span>
                <label className="sr-only" htmlFor={`part-name-${section.section_key}`}>Name of part {index + 1}</label>
                <input
                  id={`part-name-${section.section_key}`}
                  value={section.label}
                  maxLength={120}
                  onChange={(event) => onRenameSection(section.section_key, event.target.value)}
                  className="h-9 w-0 min-w-0 flex-1 rounded-[8px] border border-transparent bg-transparent px-2 text-base font-semibold text-[var(--ink)] outline-none hover:border-[var(--border)] focus-visible:border-[var(--border-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] md:text-sm"
                />
                {topic && <StatusChip tone={topicOn ? "neutral" : "warning"}>{topicOn ? TEMPLATE_SECTION_GROUP_LABELS[topic] : `${TEMPLATE_SECTION_GROUP_LABELS[topic]} · off`}</StatusChip>}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" size="icon" aria-label={`More for part “${section.label}”`}><Ellipsis aria-hidden="true" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem disabled={index === 0} onSelect={() => onMoveSection(section.section_key, -1)}><ArrowUp aria-hidden="true" />Move part up</DropdownMenuItem>
                    <DropdownMenuItem disabled={index === form.sections.length - 1} onSelect={() => onMoveSection(section.section_key, 1)}><ArrowDown aria-hidden="true" />Move part down</DropdownMenuItem>
                    <DropdownMenuItem disabled={form.sections.length < 2} variant="destructive" onSelect={() => onRemoveSection(section.section_key)}><Trash2 aria-hidden="true" />Remove part</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <ul className="m-0 flex list-none flex-col p-0">
                {section.fields.length === 0 && <li className="px-2 py-1.5 text-sm text-[var(--body)]">No questions in this part yet.</li>}
                {section.fields.map((formField) => {
                  const field = fieldMap.get(formField.field_key);
                  if (!field) {
                    return <li key={formField.field_key} className="px-2 py-1.5 text-sm text-[var(--body)]">A question that no longer exists ({formField.field_key}). Publishing drops it.</li>;
                  }
                  const isPicked = picked?.fieldKey === field.field_key && picked.sectionKey === section.section_key;
                  const required = field.is_required || formField.is_required;
                  const condition = formField.show_when ?? formField.conditional_on ?? null;
                  const after = condition ? fieldMap.get(condition.field_key)?.label ?? condition.field_key : null;
                  const bounds = fieldMoveBounds(form, section.section_key, field.field_key);
                  return (
                    <li key={field.field_key} className={cn("group flex items-center gap-1 rounded-[8px] border-t border-[var(--border)] pr-1 first:border-t-0", isPicked && "bg-[var(--primary-soft)]")}>
                      <button
                        type="button"
                        onClick={() => onPick(field.field_key, section.section_key)}
                        aria-pressed={isPicked}
                        aria-label={`Change “${field.label}”`}
                        className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-[8px] px-2 text-left hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ring-color)]"
                      >
                        <span className="min-w-0 truncate text-sm font-medium text-[var(--ink)]">
                          {field.label || "Untitled question"}
                          {required && <span className="text-[var(--error-ink)]" aria-label="must answer"> *</span>}
                        </span>
                        {after && <span className="hidden shrink-0 rounded-full bg-[var(--info-surface)] px-2 py-0.5 text-xs font-semibold text-[var(--info-ink)] sm:inline">after {condition?.equals ? `“${condition.equals}” to ` : ""}{after}</span>}
                        {changed.has(field.field_key) && <span className="shrink-0 text-xs font-semibold text-[var(--muted)]">edited</span>}
                      </button>
                      <Button onClick={() => onMoveField(section.section_key, field.field_key, -1)} type="button" variant="ghost" size="icon-sm" disabled={!bounds?.up} aria-label={`Move “${field.label}” up`}><ArrowUp aria-hidden="true" /></Button>
                      <Button onClick={() => onMoveField(section.section_key, field.field_key, 1)} type="button" variant="ghost" size="icon-sm" disabled={!bounds?.down} aria-label={`Move “${field.label}” down`}><ArrowDown aria-hidden="true" /></Button>
                    </li>
                  );
                })}
              </ul>

              {addIn === section.section_key ? (
                <AddQuestion
                  sectionLabel={section.label}
                  reusable={fields.filter((field) => !inSection.has(field.field_key))}
                  onPick={(type) => { onAddQuestion(section.section_key, type); setAddIn(null); }}
                  onReuse={(fieldKey) => { onReuse(section.section_key, fieldKey); setAddIn(null); }}
                  onClose={() => setAddIn(null)}
                />
              ) : (
                <button
                  onClick={() => setAddIn(section.section_key)}
                  type="button"
                  className="mt-1 flex h-8 items-center gap-1.5 self-start rounded-[8px] border-0 bg-transparent px-2 text-sm font-semibold text-[var(--accent-ink)] hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                >
                  <Plus aria-hidden="true" className="size-4" />Add a question
                </button>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}
