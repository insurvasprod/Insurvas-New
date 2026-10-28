"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Play, Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Segmented } from "@/components/ui/view-tabs";
import { PartnerField } from "@/components/partner/partner-portal-workspace";
import { AddQuestion } from "@/components/app/form-templates/add-question";
import type { TemplateField, TemplateFieldType, TemplateFormDefinition, TemplateFormField } from "@/lib/templates/constants";
import { fieldMoveBounds } from "@/lib/templates/formMoves";
import { placementWidth, type PlacementWidth } from "@/lib/templates/placementWidth";

export type Picked = { fieldKey: string; sectionKey: string | null } | null;
type Width = "computer" | "phone";
const WIDTHS: ReadonlyArray<{ key: Width; label: string }> = [{ key: "computer", label: "Computer" }, { key: "phone", label: "Phone" }];
const SIZES: ReadonlyArray<{ key: PlacementWidth; label: string }> = [{ key: "half", label: "Half row" }, { key: "full", label: "Full row" }];

const noop = () => {};

/**
 * Form templates, layout C: the form partners fill in, drawn with the partner portal's own field
 * renderer, so what is edited is what partners get. Click a question to change it in the panel;
 * the picked one carries a small up / down / delete toolbar. Sections are numbered parts that are
 * renamed in place. Fields kept on the lead only sit under the form, "For your agents only".
 */
export function FormCanvas({ form, fields, productName, picked, changed, onPick, onMoveField, onWidth, onDeleteField, onRenameSection, onMoveSection, onRemoveSection, onAddQuestion, onReuse, onAddSection, onAddAgentField, onTry }: {
  form: TemplateFormDefinition;
  fields: TemplateField[];
  productName: string;
  picked: Picked;
  /** Field keys whose question or placement differs from the live form. */
  changed: ReadonlySet<string>;
  onPick: (fieldKey: string, sectionKey: string | null) => void;
  onMoveField: (sectionKey: string, fieldKey: string, by: -1 | 1) => void;
  onWidth: (sectionKey: string, fieldKey: string, width: PlacementWidth) => void;
  onDeleteField: (fieldKey: string) => void;
  onRenameSection: (sectionKey: string, label: string) => void;
  onMoveSection: (sectionKey: string, by: -1 | 1) => void;
  onRemoveSection: (sectionKey: string) => void;
  onAddQuestion: (sectionKey: string, type: TemplateFieldType) => void;
  onReuse: (sectionKey: string, fieldKey: string) => void;
  onAddSection: () => void;
  onAddAgentField: () => void;
  onTry: () => void;
}) {
  const [width, setWidth] = useState<Width>("computer");
  const [addIn, setAddIn] = useState<string | null>(null);
  /** Parts folded to their header line; every part starts open. */
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const toggleFold = (key: string) => setFolded((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  // The partners' own grid: two columns on a computer, one on a phone (globals.css, 640px).
  const twoColumns = width === "computer";
  const fieldMap = new Map(fields.map((field) => [field.field_key, field]));
  const placed = new Set(form.sections.flatMap((section) => section.fields.map((field) => field.field_key)));
  const agentsOnly = fields.filter((field) => !placed.has(field.field_key));

  function question(sectionKey: string, formField: TemplateFormField) {
    const field = fieldMap.get(formField.field_key);
    if (!field) {
      return (
        <p key={formField.field_key} className="m-0 rounded-[10px] border border-dashed border-[var(--border-strong)] px-3 py-2 text-sm text-[var(--muted)]">
          A question that no longer exists ({formField.field_key}). Publishing drops it.
        </p>
      );
    }
    const isPicked = picked?.fieldKey === field.field_key && picked.sectionKey === sectionKey;
    const required = field.is_required || formField.is_required;
    const condition = formField.show_when ?? formField.conditional_on ?? null;
    const after = condition ? fieldMap.get(condition.field_key)?.label ?? condition.field_key : null;
    const bounds = isPicked ? fieldMoveBounds(form, sectionKey, field.field_key) : null;
    const full = placementWidth(field, formField) === "full";
    return (
      <div
        key={field.field_key}
        className={cn(
          "relative min-w-0 rounded-[10px] px-2.5 py-2 transition-colors",
          twoColumns && full && "col-span-2",
          isPicked ? "bg-[var(--primary-soft)] outline-2 outline-[var(--ink)]" : "hover:bg-[var(--surface-alt)]",
        )}
      >
        {/* The whole question is one button over the drawn field, so the field itself never takes focus. */}
        <button
          onClick={() => onPick(field.field_key, sectionKey)}
          type="button"
          aria-pressed={isPicked}
          aria-label={`Change “${field.label}”`}
          className="absolute inset-0 z-0 cursor-pointer rounded-[10px] border-0 bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
        />
        {isPicked && bounds && (
          <div role="toolbar" aria-label={`Move, resize or delete “${field.label}”`} className="absolute -top-10 right-0 z-20 flex items-center gap-1 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-0.5 shadow-[var(--shadow-rest)]">
            <Button onClick={() => onMoveField(sectionKey, field.field_key, -1)} type="button" variant="ghost" size="icon" disabled={!bounds.up} aria-label="Move up"><ArrowUp aria-hidden="true" /></Button>
            <Button onClick={() => onMoveField(sectionKey, field.field_key, 1)} type="button" variant="ghost" size="icon" disabled={!bounds.down} aria-label="Move down"><ArrowDown aria-hidden="true" /></Button>
            <Segmented label="Size" options={SIZES} value={full ? "full" : "half"} onChange={(size) => onWidth(sectionKey, field.field_key, size)} />
            <Button onClick={() => onDeleteField(field.field_key)} type="button" variant="ghost" size="icon" className="text-[var(--error-ink)]" aria-label={`Delete “${field.label}”`}><Trash2 aria-hidden="true" /></Button>
          </div>
        )}
        <div className="pointer-events-none relative flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-semibold text-[var(--ink)]">
              {field.label || "Untitled question"}
              {required && <span className="text-[var(--error-ink)]" aria-label="must answer"> *</span>}
            </span>
            {after && (
              <span className="rounded-full bg-[var(--info-surface)] px-2 py-0.5 text-xs font-semibold text-[var(--info-ink)]">
                after {condition?.equals ? `“${condition.equals}” to ` : ""}{after}
              </span>
            )}
            {changed.has(field.field_key) && <span className="rounded-full bg-[var(--warning-surface)] px-2 py-0.5 text-xs font-semibold text-[var(--warning-ink)]">changed</span>}
          </div>
          <div inert aria-hidden="true">
            <PartnerField field={field} value={undefined} onChange={noop} />
          </div>
          {field.help_text && <p className="m-0 truncate text-xs text-[var(--muted)]">{field.help_text}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-[var(--muted)]">What partners see</span>
        <InfoTip label="About this preview">Drawn from your changes, as partners will get it once you publish. Nothing typed here is saved.</InfoTip>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="hidden sm:contents"><Segmented label="Preview width" options={WIDTHS} value={width} onChange={setWidth} /></span>
          <Button onClick={onTry} type="button" variant="outline"><Play aria-hidden="true" />Try the form</Button>
        </div>
      </div>

      <div className={cn("mx-auto flex w-full flex-col gap-5 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-4 transition-[max-width] duration-200 sm:p-6", width === "phone" ? "max-w-[390px]" : "max-w-[760px]")}>
        <p className="m-0 text-base font-semibold text-[var(--ink)]">Send us a {productName} lead</p>

        {form.sections.map((section, index) => {
          const count = section.fields.length;
          const inSection = new Set(section.fields.map((field) => field.field_key));
          const open = !folded.has(section.section_key);
          return (
            <section key={section.section_key} aria-label={`Part ${index + 1}: ${section.label}`} className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-3 first-of-type:border-t-0 first-of-type:pt-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <Button onClick={() => toggleFold(section.section_key)} type="button" variant="ghost" size="icon" aria-expanded={open} aria-controls={`part-body-${section.section_key}`} aria-label={open ? `Fold part “${section.label}”` : `Open part “${section.label}”`}>
                  <ChevronDown aria-hidden="true" className={cn("transition-transform duration-150", !open && "-rotate-90")} />
                </Button>
                <span aria-hidden="true" className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--ink)] text-xs font-semibold text-[var(--surface)]">{index + 1}</span>
                <label className="sr-only" htmlFor={`part-name-${section.section_key}`}>Name of part {index + 1}</label>
                <input
                  id={`part-name-${section.section_key}`}
                  value={section.label}
                  maxLength={120}
                  onChange={(event) => onRenameSection(section.section_key, event.target.value)}
                  className="h-9 min-w-0 flex-[1_1_160px] rounded-[8px] border border-transparent bg-transparent px-2 text-base font-semibold text-[var(--ink)] outline-none hover:border-[var(--border)] focus-visible:border-[var(--border-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] md:text-sm"
                />
                <span className="min-w-0 truncate text-xs text-[var(--muted)]">
                  <span className="tabular-nums">{count} {count === 1 ? "question" : "questions"}</span>
                  {!open && count > 0 && `: ${section.fields.slice(0, 3).map((item) => fieldMap.get(item.field_key)?.label ?? item.field_key).join(", ")}${count > 3 ? "…" : ""}`}
                </span>
                <span className="flex gap-0.5">
                  <Button onClick={() => onMoveSection(section.section_key, -1)} type="button" variant="ghost" size="icon" disabled={index === 0} aria-label={`Move part “${section.label}” up`}><ArrowUp aria-hidden="true" /></Button>
                  <Button onClick={() => onMoveSection(section.section_key, 1)} type="button" variant="ghost" size="icon" disabled={index === form.sections.length - 1} aria-label={`Move part “${section.label}” down`}><ArrowDown aria-hidden="true" /></Button>
                  <Button onClick={() => onRemoveSection(section.section_key)} type="button" variant="ghost" size="icon" disabled={form.sections.length < 2} className="text-[var(--error-ink)]" aria-label={`Remove part “${section.label}”`}><Trash2 aria-hidden="true" /></Button>
                </span>
              </div>
              {open && (
              <div id={`part-body-${section.section_key}`} className={cn("grid gap-x-3 gap-y-1", twoColumns ? "grid-cols-2" : "grid-cols-1")}>
              {count === 0 && <p className="col-span-full m-0 px-3 py-1 text-sm text-[var(--muted)]">No questions in this part yet. Add the first one below.</p>}
              {section.fields.map((formField) => question(section.section_key, formField))}
              <div className="col-span-full mt-1">
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
                  className="flex h-9 items-center gap-1.5 rounded-[10px] border border-dashed border-[var(--border-strong)] bg-transparent px-3 text-sm font-semibold text-[var(--body)] transition-colors hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
                >
                  <Plus aria-hidden="true" className="size-4" />Add a question to {section.label || `part ${index + 1}`}
                </button>
              )}
              </div>
              </div>
              )}
            </section>
          );
        })}

        <Button onClick={onAddSection} type="button" variant="outline" className="self-start"><Plus aria-hidden="true" />Add a new part to the form</Button>
        <Button type="button" disabled className="self-start">Send lead (turned off while you edit)</Button>
      </div>

      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-2 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-[var(--ink)]">For your agents only</span>
          <InfoTip label="About questions for your agents only">Saved on every lead, but partners never see these. Your agents fill them in.</InfoTip>
          <Button onClick={onAddAgentField} type="button" variant="ghost" className="ml-auto"><Plus aria-hidden="true" />Add one</Button>
        </div>
        {agentsOnly.length ? (
          <div className="flex flex-wrap gap-2">
            {agentsOnly.map((field) => {
              const isPicked = picked?.fieldKey === field.field_key && picked.sectionKey === null;
              return (
                <button
                  key={field.field_key}
                  onClick={() => onPick(field.field_key, null)}
                  type="button"
                  aria-pressed={isPicked}
                  className={cn(
                    "inline-flex h-9 items-center rounded-full border px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]",
                    isPicked ? "border-2 border-[var(--ink)] bg-[var(--primary-soft)] font-semibold text-[var(--ink)]" : "border-[var(--border-strong)] bg-transparent text-[var(--body)] hover:bg-[var(--surface-alt)]",
                  )}
                >
                  {field.label || "Untitled question"}
                  {changed.has(field.field_key) && <span className="ml-1.5 text-xs font-semibold text-[var(--warning-ink)]">changed</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="m-0 text-sm text-[var(--muted)]">None. Every question is on the partner form.</p>
        )}
      </div>
    </div>
  );
}
