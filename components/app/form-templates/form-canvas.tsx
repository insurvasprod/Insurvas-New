"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Columns2, Ellipsis, Plus, RectangleHorizontal, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InfoTip } from "@/components/ui/info-tip";
import { PartnerField } from "@/components/partner/partner-portal-workspace";
import { AddQuestion } from "@/components/app/form-templates/add-question";
import type { TemplateField, TemplateFieldType, TemplateFormDefinition, TemplateFormField } from "@/lib/templates/constants";
import { fieldMoveBounds } from "@/lib/templates/formMoves";
import { placementWidth, type PlacementWidth } from "@/lib/templates/placementWidth";
import { TEMPLATE_SECTION_GROUP_LABELS, sectionAvailability, sectionGroup } from "@/lib/templates/sectionAvailability";
import { StatusChip } from "@/components/ui/status-chip";
import { cardHead, cardSurface } from "@/components/ui/card";

export type Picked = { fieldKey: string; sectionKey: string | null } | null;

const noop = () => {};

/**
 * Form templates, layout A: the form partners fill in, drawn with the partner portal's own field
 * renderer, so what is edited is what partners get. Click a question to change it in the side panel;
 * the picked one carries up / down / size / delete on its own label row. Parts are numbered and
 * renamed in place; moving or removing one is in its ⋯ menu. Questions kept for agents only live in
 * the side panel, since partners never see them.
 */
export function FormCanvas({ form, fields, renderEditor, picked, changed, onPick, onMoveField, onWidth, onDeleteField, onRenameSection, onMoveSection, onRemoveSection, onAddQuestion, onReuse, onAddSection }: {
  form: TemplateFormDefinition;
  fields: TemplateField[];
  /** The picked question's editor, opened in place under it (owner 2026-11-03: no popup). */
  renderEditor: (fieldKey: string, sectionKey: string) => ReactNode;
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
}) {
  // On a phone the preview is what a partner on a phone gets: one column (the switch is hidden there).
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)");
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const [addIn, setAddIn] = useState<string | null>(null);
  /** Parts folded to their header line; every part starts open. */
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const toggleFold = (key: string) => setFolded((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  // The partners' own grid: two columns on a computer, one on a phone (globals.css, 640px).
  const twoColumns = !narrow;
  const fieldMap = new Map(fields.map((field) => [field.field_key, field]));
  const availability = sectionAvailability(form);

  function question(sectionKey: string, formField: TemplateFormField) {
    const field = fieldMap.get(formField.field_key);
    if (!field) {
      return (
        <p key={formField.field_key} className="m-0 rounded-[10px] border border-dashed border-[var(--border-strong)] px-3 py-2 text-sm text-[var(--body)]">
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
      <Fragment key={field.field_key}>
      <div
        className={cn(
          "relative min-w-0 rounded-[10px] px-2 py-1 transition-colors",
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
            {isPicked && bounds && (
              <span role="toolbar" aria-label={`Move, resize or delete “${field.label}”`} className="pointer-events-auto relative z-10 ml-auto flex items-center gap-0.5">
                <Button onClick={() => onMoveField(sectionKey, field.field_key, -1)} type="button" variant="ghost" size="icon-sm" disabled={!bounds.up} aria-label="Move up" title="Move up"><ArrowUp aria-hidden="true" /></Button>
                <Button onClick={() => onMoveField(sectionKey, field.field_key, 1)} type="button" variant="ghost" size="icon-sm" disabled={!bounds.down} aria-label="Move down" title="Move down"><ArrowDown aria-hidden="true" /></Button>
                {twoColumns && <Button onClick={() => onWidth(sectionKey, field.field_key, full ? "half" : "full")} type="button" variant="ghost" size="icon-sm" aria-label={full ? "Make it a half row" : "Make it a full row"} title={full ? "Full row: press for a half row" : "Half row: press for a full row"}>{full ? <RectangleHorizontal aria-hidden="true" /> : <Columns2 aria-hidden="true" />}</Button>}
                <Button onClick={() => onDeleteField(field.field_key)} type="button" variant="ghost" size="icon-sm" className="text-[var(--error-ink)]" aria-label={`Delete “${field.label}”`} title="Delete question"><Trash2 aria-hidden="true" /></Button>
              </span>
            )}
          </div>
          <div inert aria-hidden="true">
            <PartnerField field={field} value={undefined} onChange={noop} />
          </div>
          {field.help_text && <p className="m-0 truncate text-xs text-[var(--body)]">{field.help_text}</p>}
        </div>
      </div>
      {isPicked && <div className="col-span-full my-1">{renderEditor(field.field_key, sectionKey)}</div>}
      </Fragment>
    );
  }

  return (
    <section aria-label="Questions" className={cn(cardSurface, "flex min-h-0 min-w-0 flex-col lg:h-full")}>
      <div className={cn(cardHead, "flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-3")}>
        <span className="text-xs font-semibold text-[var(--ink)]">Questions</span>
        <InfoTip label="About the questions">Click a question to change it. Parts group the questions; open ⋯ on a part to move or remove it. Open the preview to see what partners get.</InfoTip>
      </div>

      {/* The header above stays put; the questions scroll in here. */}
      {/* The canvas: the form sits on it as the sheet a partner sees, so a short or folded form is a small
          sheet on a quiet ground, not a card that looks empty. */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[color-mix(in_srgb,var(--canvas)_60%,transparent)] p-3 sm:p-5">
      <div className={cn("mx-auto flex w-full flex-col gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3 sm:p-4", "max-w-[760px]")}>

        {form.sections.map((section, index) => {
          const count = section.fields.length;
          const inSection = new Set(section.fields.map((field) => field.field_key));
          const open = !folded.has(section.section_key);
          const topic = sectionGroup(section);
          const topicLabel = topic ? TEMPLATE_SECTION_GROUP_LABELS[topic] : "";
          const topicOn = topic ? availability[topic] : true;
          return (
            <section key={section.section_key} aria-label={`Part ${index + 1}: ${section.label}`} className="flex flex-col gap-1 border-t border-[var(--border)] pt-2 first-of-type:border-t-0 first-of-type:pt-0">
              <div className="flex items-center gap-1.5">
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
                  className="h-9 w-0 min-w-0 flex-1 rounded-[8px] border border-transparent bg-transparent px-2 text-base font-semibold text-[var(--ink)] outline-none hover:border-[var(--border)] focus-visible:border-[var(--border-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] md:text-sm"
                />
                <span className="min-w-0 truncate text-xs text-[var(--body)]">
                  <span className="tabular-nums">{count} {count === 1 ? "question" : "questions"}</span>
                  {!open && count > 0 && `: ${section.fields.slice(0, 3).map((item) => fieldMap.get(item.field_key)?.label ?? item.field_key).join(", ")}${count > 3 ? "…" : ""}`}
                </span>
                {/* The topic this part belongs to (Topics in the side panel), and whether partners still get it. */}
                {topic && <span className="hidden sm:inline-flex"><StatusChip tone={topicOn ? "neutral" : "warning"}>{topicOn ? topicLabel : `${topicLabel} · off`}</StatusChip></span>}
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
              {open && (
              <div id={`part-body-${section.section_key}`} className={cn("grid gap-x-3 gap-y-0", twoColumns ? "grid-cols-2" : "grid-cols-1")}>
              {count === 0 && <p className="col-span-full m-0 px-3 py-1 text-sm text-[var(--body)]">No questions in this part yet. Add the first one below.</p>}
              {section.fields.map((formField) => question(section.section_key, formField))}
              <div className="col-span-full mt-0.5">
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
                  className="flex h-8 items-center gap-1.5 rounded-[10px] border border-dashed border-[var(--border-strong)] bg-transparent px-3 text-sm font-semibold text-[var(--body)] transition-colors hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
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

        <Button onClick={onAddSection} type="button" variant="outline" className="self-start"><Plus aria-hidden="true" />Add a part</Button>
      </div>
      </div>
    </section>
  );
}
