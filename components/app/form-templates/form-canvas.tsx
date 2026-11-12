"use client";

import { useState, type DragEvent } from "react";
import { ArrowLeft, ArrowRight, Copy, Ellipsis, GripVertical, Plus, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { Segmented } from "@/components/ui/view-tabs";
import { inputControl } from "@/components/ui/field";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { TemplateField, TemplateFieldType, TemplateFormDefinition, TemplateFormField } from "@/lib/templates/constants";
import { cleanLogic, logicRuleCount, placementLogic } from "@/lib/templates/logic";
import { placementWidth } from "@/lib/templates/placementWidth";
import { applicationFieldsFor } from "@/lib/templates/applicationMatch";
import { LIBRARY_DRAG, TYPE_SHORT, type LibraryItem } from "@/components/app/form-templates/add-question";

export type Picked = { fieldKey: string; sectionKey: string | null } | null;

/** A question being dragged inside the canvas. */
const QUESTION_DRAG = "application/x-insurvas-form-question";
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

function readDrop(event: DragEvent): { item: LibraryItem } | { move: { fieldKey: string; from: string } } | null {
  const lib = event.dataTransfer.getData(LIBRARY_DRAG);
  if (lib) { try { return { item: JSON.parse(lib) as LibraryItem }; } catch { return null; } }
  const moved = event.dataTransfer.getData(QUESTION_DRAG);
  if (moved) { try { return { move: JSON.parse(moved) as { fieldKey: string; from: string } }; } catch { return null; } }
  return null;
}
const carries = (event: DragEvent) => event.dataTransfer.types.includes(LIBRARY_DRAG) || event.dataTransfer.types.includes(QUESTION_DRAG);

/** One question as it sits on the page: the handle, the words, and what it is in a few words. */
function QuestionCard({ field, placed, picked, changed, dropping, onPick, onDragStart, onDragOver, onDrop, onDuplicate, onMove, onRemove, canUp, canDown, pages, sectionKey }: {
  field: TemplateField;
  placed: TemplateFormField;
  picked: boolean;
  changed: boolean;
  dropping: boolean;
  onPick: () => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDuplicate: (() => void) | null;
  onMove: (to: { by: number } | { page: string }) => void;
  onRemove: () => void;
  canUp: boolean;
  canDown: boolean;
  pages: Array<{ key: string; label: string }>;
  sectionKey: string;
}) {
  const logic = placementLogic(placed);
  const rules = logicRuleCount(logic);
  const lands = applicationFieldsFor(field.field_key);
  const required = field.is_required || placed.is_required;
  return (
    <div className={cn("min-w-0", placementWidth(field, placed) === "full" && "sm:col-span-2")} onDragOver={onDragOver} onDrop={onDrop}>
      {dropping && <div aria-hidden="true" className="mb-2 h-9 rounded-[10px] border-2 border-dashed border-[var(--primary)] bg-[var(--primary-soft)]" />}
      <div
        draggable
        onDragStart={onDragStart}
        onClick={onPick}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPick(); } }}
        role="button"
        tabIndex={0}
        aria-pressed={picked}
        aria-label={`${field.label || "Untitled question"}${required ? ", must be answered" : ""}`}
        className={cn(
          "group relative flex min-w-0 cursor-pointer items-start gap-2 rounded-[10px] border bg-[var(--surface)] py-2.5 pr-2 pl-1.5 transition-colors",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]",
          picked ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)] hover:border-[var(--border-strong)]",
        )}
      >
        <GripVertical aria-hidden="true" className="mt-0.5 size-4 shrink-0 cursor-grab text-[var(--muted)]" />
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-sm font-semibold text-[var(--ink)]">{field.label || "Untitled question"}{required && <span className="text-[var(--error-ink)]"> *</span>}</p>
          <p className="m-0 mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[var(--muted)]">
            <span>{TYPE_SHORT[field.type]}</span>
            {rules > 0 ? <StatusChip tone="info">{rules === 1 ? "Shows when 1 rule matches" : `Shows when ${rules} rules match`}</StatusChip> : lands.length > 0 ? <span className="truncate">· goes to the application’s {lands.join(", ")}</span> : null}
            {changed && <span>· changed</span>}
          </p>
        </div>
        <span className="flex shrink-0 items-center opacity-70 group-hover:opacity-100" onClick={(event) => event.stopPropagation()}>
          {onDuplicate && <Button type="button" variant="ghost" size="icon-xs" aria-label={`Duplicate ${field.label}`} title="Duplicate" onClick={onDuplicate}><Copy aria-hidden="true" /></Button>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-xs" aria-label={`More for ${field.label}`} title="More"><Ellipsis aria-hidden="true" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={!canUp} onSelect={() => onMove({ by: -1 })}>Move up</DropdownMenuItem>
              <DropdownMenuItem disabled={!canDown} onSelect={() => onMove({ by: 1 })}>Move down</DropdownMenuItem>
              {pages.filter((page) => page.key !== sectionKey).map((page) => <DropdownMenuItem key={page.key} onSelect={() => onMove({ page: page.key })}>Move to {page.label}</DropdownMenuItem>)}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-[var(--error-ink)]" onSelect={onRemove}><Trash2 aria-hidden="true" />Remove</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
    </div>
  );
}

/**
 * The builder's centre (board A2): the form's pages as tabs, the open page's questions in order with
 * drag handles, a drop line where a dragged question or library field will land, and the open page's
 * name. Questions dragged onto another page's tab move to the end of that page.
 */
export function FormCanvas({ form, fields, page, onPage, picked, changed, onPick, onDropItem, onMove, onDuplicate, onRemoveField, onAddPage, onRenamePage, onMovePage, onRemovePage, onAddType, matched }: {
  form: TemplateFormDefinition;
  fields: TemplateField[];
  page: string;
  onPage: (sectionKey: string) => void;
  picked: Picked;
  changed: ReadonlySet<string>;
  onPick: (fieldKey: string, sectionKey: string) => void;
  onDropItem: (item: LibraryItem, sectionKey: string, index: number) => void;
  onMove: (fieldKey: string, from: string, to: string, index: number) => void;
  onDuplicate: ((fieldKey: string, sectionKey: string) => void) | null;
  onRemoveField: (fieldKey: string, sectionKey: string) => void;
  onAddPage: () => void;
  onRenamePage: (sectionKey: string, label: string) => void;
  onMovePage: (sectionKey: string, by: -1 | 1) => void;
  onRemovePage: (sectionKey: string) => void;
  onAddType: ((type: TemplateFieldType) => void) | null;
  matched: { matched: number; total: number };
}) {
  const [over, setOver] = useState<{ section: string; index: number } | null>(null);
  const byKey = new Map(fields.map((field) => [field.field_key, field]));
  const sectionIndex = Math.max(0, form.sections.findIndex((section) => section.section_key === page));
  const section = form.sections[sectionIndex];
  const pages = form.sections.map((item, index) => ({ key: item.section_key, label: `${index + 1} · ${item.label || "Untitled page"}` }));

  function dropAt(event: DragEvent, sectionKey: string, index: number) {
    event.preventDefault();
    setOver(null);
    const read = readDrop(event);
    if (!read) return;
    if ("item" in read) onDropItem(read.item, sectionKey, index);
    else onMove(read.move.fieldKey, read.move.from, sectionKey, index);
  }
  function overAt(event: DragEvent, sectionKey: string, index: number) {
    if (!carries(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes(QUESTION_DRAG) ? "move" : "copy";
    if (!over || over.section !== sectionKey || over.index !== index) setOver({ section: sectionKey, index });
  }
  /** A drop on a page's tab: to the end of that page. */
  function dropOnTabs(event: DragEvent) {
    const tab = (event.target as HTMLElement).closest('[role="radio"]');
    const row = tab?.parentElement;
    if (!tab || !row) return;
    const index = [...row.querySelectorAll(':scope > [role="radio"]')].indexOf(tab);
    const target = form.sections[index];
    if (target) dropAt(event, target.section_key, target.fields.length);
  }

  return (
    <section aria-label="The form" className="m-glass flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-[var(--border)]">
      <div className="m-glass-head flex min-w-0 items-center gap-2 border-b border-[var(--border)] px-3" onDragOver={(event) => { if (carries(event)) event.preventDefault(); }} onDrop={dropOnTabs}>
        <div className="min-w-0 flex-1 overflow-x-auto py-2"><Segmented label="Pages" value={section?.section_key ?? ""} onChange={onPage} options={pages} /></div>
        <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={onAddPage}><Plus aria-hidden="true" />Page</Button>
      </div>
      {section ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto flex w-full max-w-[680px] flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <input aria-label="Page name" className={cn(inputControl, "h-8 max-w-[260px] flex-1 text-sm font-semibold")} maxLength={120} value={section.label} onChange={(event) => onRenamePage(section.section_key, event.target.value)} />
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Move this page earlier" title="Move this page earlier" disabled={sectionIndex === 0} onClick={() => onMovePage(section.section_key, -1)}><ArrowLeft aria-hidden="true" /></Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Move this page later" title="Move this page later" disabled={sectionIndex === form.sections.length - 1} onClick={() => onMovePage(section.section_key, 1)}><ArrowRight aria-hidden="true" /></Button>
              <Button type="button" variant="ghost" size="sm" className="text-[var(--error-ink)]" disabled={form.sections.length < 2} onClick={() => onRemovePage(section.section_key)}>Remove page</Button>
            </div>
            <p className="m-0 text-xs text-[var(--muted)]">Partners see this page {ORDINALS[sectionIndex] ?? `number ${sectionIndex + 1}`}. Drag a field by its handle, or drag one in from the left.</p>
            <div className="grid gap-2.5 sm:grid-cols-2" onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(null); }}>
              {section.fields.map((placed, index) => {
                const field = byKey.get(placed.field_key);
                if (!field) return null;
                return (
                  <QuestionCard
                    key={placed.field_key}
                    field={field}
                    placed={placed}
                    sectionKey={section.section_key}
                    pages={pages}
                    picked={picked?.fieldKey === placed.field_key && picked.sectionKey === section.section_key}
                    changed={changed.has(placed.field_key)}
                    dropping={over?.section === section.section_key && over.index === index}
                    onPick={() => onPick(placed.field_key, section.section_key)}
                    onDragStart={(event) => { event.dataTransfer.setData(QUESTION_DRAG, JSON.stringify({ fieldKey: placed.field_key, from: section.section_key })); event.dataTransfer.effectAllowed = "move"; }}
                    onDragOver={(event) => overAt(event, section.section_key, index)}
                    onDrop={(event) => dropAt(event, section.section_key, index)}
                    onDuplicate={onDuplicate ? () => onDuplicate(placed.field_key, section.section_key) : null}
                    onMove={(to) => ("by" in to ? onMove(placed.field_key, section.section_key, section.section_key, index + to.by + (to.by > 0 ? 1 : 0)) : onMove(placed.field_key, section.section_key, to.page, form.sections.find((item) => item.section_key === to.page)?.fields.length ?? 0))}
                    onRemove={() => onRemoveField(placed.field_key, section.section_key)}
                    canUp={index > 0}
                    canDown={index < section.fields.length - 1}
                  />
                );
              })}
              <div
                className={cn("flex min-h-12 items-center justify-center rounded-[10px] border-2 border-dashed text-sm sm:col-span-2", over?.section === section.section_key && over.index === section.fields.length ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "border-[var(--border)] text-[var(--muted)]")}
                onDragOver={(event) => overAt(event, section.section_key, section.fields.length)}
                onDrop={(event) => dropAt(event, section.section_key, section.fields.length)}
              >
                {section.fields.length ? "Drop a field here to add it at the end" : "This page is empty. Drag a field here, or pick one on the left."}
              </div>
            </div>
            {section.fields.some((placed) => cleanLogic(placed.logic) || placed.show_when) && <p className="m-0 text-xs text-[var(--muted)]">Questions with rules show only when their rules match. Preview to try them.</p>}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-[var(--muted)]">This form has no pages yet.</div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] px-3 py-2">
        {onAddType && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button type="button" variant="outline" size="sm"><Plus aria-hidden="true" />Add a field</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {(Object.keys(TYPE_SHORT) as TemplateFieldType[]).map((type) => <DropdownMenuItem key={type} onSelect={() => onAddType(type)}>{TYPE_SHORT[type]}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <span className="flex-1" />
        <span className="text-xs text-[var(--muted)]">Values reach the application by field name · {matched.matched} of {matched.total} matched</span>
      </div>
    </section>
  );
}
