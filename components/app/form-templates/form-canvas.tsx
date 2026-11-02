"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Ellipsis, Play, Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InfoTip } from "@/components/ui/info-tip";
import { Segmented } from "@/components/ui/view-tabs";
import { PartnerField } from "@/components/partner/partner-portal-workspace";
import { AddQuestion } from "@/components/app/form-templates/add-question";
import type { TemplateField, TemplateFieldType, TemplateFormDefinition, TemplateFormField } from "@/lib/templates/constants";
import { fieldMoveBounds } from "@/lib/templates/formMoves";
import { placementWidth, type PlacementWidth } from "@/lib/templates/placementWidth";
import { TEMPLATE_SECTION_GROUP_LABELS, sectionAvailability, sectionGroup } from "@/lib/templates/sectionAvailability";
import { StatusChip } from "@/components/ui/status-chip";
import { cardHead, cardSurface } from "@/components/ui/card";

export type Picked = { fieldKey: string; sectionKey: string | null } | null;
type Width = "computer" | "phone";
const WIDTHS: ReadonlyArray<{ key: Width; label: string }> = [{ key: "computer", label: "Computer" }, { key: "phone", label: "Phone" }];

const noop = () => {};

/**
 * Form templates, layout A: the form partners fill in, drawn with the partner portal's own field
 * renderer, so what is edited is what partners get. Click a question to change it in the side panel;
 * the picked one carries up / down / size / delete on its own label row. Parts are numbered and
 * renamed in place; moving or removing one is in its ⋯ menu. Questions kept for agents only live in
 * the side panel, since partners never see them.
 */
export function FormCanvas({ form, fields, productName, picked, changed, onPick, onMoveField, onWidth, onDeleteField, onRenameSection, onMoveSection, onRemoveSection, onAddQuestion, onReuse, onAddSection, onTry }: {
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
  onTry: () => void;
}) {
  const [width, setWidth] = useState<Width>("computer");
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
  const twoColumns = width === "computer" && !narrow;
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
                <Button onClick={() => onMoveField(sectionKey, field.field_key, -1)} type="button" variant="ghost" size="icon" disabled={!bounds.up} aria-label="Move up"><ArrowUp aria-hidden="true" /></Button>
                <Button onClick={() => onMoveField(sectionKey, field.field_key, 1)} type="button" variant="ghost" size="icon" disabled={!bounds.down} aria-label="Move down"><ArrowDown aria-hidden="true" /></Button>
                {twoColumns && <Button onClick={() => onWidth(sectionKey, field.field_key, full ? "half" : "full")} type="button" variant="outline" aria-label={full ? "Make it a half row" : "Make it a full row"}>{full ? "Full row" : "Half row"}</Button>}
                <Button onClick={() => onDeleteField(field.field_key)} type="button" variant="ghost" size="icon" className="text-[var(--error-ink)]" aria-label={`Delete “${field.label}”`}><Trash2 aria-hidden="true" /></Button>
              </span>
            )}
          </div>
          <div inert aria-hidden="true">
            <PartnerField field={field} value={undefined} onChange={noop} />
          </div>
          {field.help_text && <p className="m-0 truncate text-xs text-[var(--body)]">{field.help_text}</p>}
        </div>
      </div>
    );
  }

  return (
    <section aria-label="What partners see" className={cn(cardSurface, "flex min-w-0 flex-col")}>
      <div className={cn(cardHead, "flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-3")}>
        <span className="text-xs font-semibold text-[var(--ink)]">What partners see</span>
        <InfoTip label="About this preview">Drawn from your changes, as partners will get it once you publish. Nothing typed here is saved.</InfoTip>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="hidden sm:contents"><Segmented label="Preview width" options={WIDTHS} value={width} onChange={setWidth} /></span>
          <Button onClick={onTry} type="button" variant="outline"><Play aria-hidden="true" />Try the form</Button>
        </div>
      </div>

      <div className={cn("mx-auto flex w-full flex-col gap-5 p-4 transition-[max-width] duration-200 sm:p-6", width === "phone" ? "max-w-[390px]" : "max-w-[760px]")}>
        <p className="m-0 text-base font-semibold text-[var(--ink)]">Send us a {productName} lead</p>

        {form.sections.map((section, index) => {
          const count = section.fields.length;
          const inSection = new Set(section.fields.map((field) => field.field_key));
          const open = !folded.has(section.section_key);
          const topic = sectionGroup(section);
          const topicLabel = topic ? TEMPLATE_SECTION_GROUP_LABELS[topic] : "";
          const topicOn = topic ? availability[topic] : true;
          return (
            <section key={section.section_key} aria-label={`Part ${index + 1}: ${section.label}`} className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-3 first-of-type:border-t-0 first-of-type:pt-0">
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
              <div id={`part-body-${section.section_key}`} className={cn("grid gap-x-3 gap-y-1", twoColumns ? "grid-cols-2" : "grid-cols-1")}>
              {count === 0 && <p className="col-span-full m-0 px-3 py-1 text-sm text-[var(--body)]">No questions in this part yet. Add the first one below.</p>}
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

        <Button onClick={onAddSection} type="button" variant="outline" className="self-start"><Plus aria-hidden="true" />Add a part</Button>
        <p className="m-0 border-t border-[var(--border)] pt-3 text-xs text-[var(--body)]">Partners press <strong className="font-semibold text-[var(--ink)]">Send lead</strong> here. It’s off while you edit.</p>
      </div>
    </section>
  );
}
