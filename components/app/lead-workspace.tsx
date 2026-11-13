"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, CircleAlert, ExternalLink } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DetailPanel } from "@/components/ui/detail-panel";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { StatusChip } from "@/components/ui/status-chip";
import { ClearFiltersButton, DataToolbar, FilterButton, FilterPanel, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { control, Field } from "@/components/ui/field";
import { ToggleChip } from "@/components/ui/toggle-chip";
import type { TemplateField, TemplateRow } from "@/lib/templates/constants";
import type { PipelineStage } from "@/lib/pipelines/types";
import { pruneHiddenTemplateValues, templateFormFieldVisible } from "@/lib/templates/visibility";
import { cn } from "@/lib/utils";
import { dayMonthYear } from "@/lib/format/dates";
import { productLineLabel } from "@/lib/format/productLine";
import { LeadStageHint } from "@/components/app/applications/lead-stage-hint";
import { DispositionPicker, ListView, StageWhy, StagesView, TABLE_SCOPES, TableView, callPathOnly, dispositionGroups, dispositionLabel, durationLabel, inStageMs, isOverdue, tableScopeCounts, type TableScope, type ViewContext } from "@/components/app/pipeline-views";
import { SavedViews, type BuiltInView, type ViewState } from "@/components/ui/saved-views";
import { useSolo } from "@/components/app/solo-context";
import { Segmented, UnderlineTabs } from "@/components/ui/view-tabs";
import { load as loadResource, peek, readResource, seed } from "@/lib/client/resource-cache";

type Lead = { id: string; pipeline_id: string; stage_id: string; values: Record<string, unknown>; screening_outcome?: string | null; screening_warning?: string | null; created_at: string; updated_at: string; submitter_name?: string | null; owner_user_id?: string | null; owner_name?: string | null; disposition?: string | null; disposition_at?: string | null; stage_entered_at?: string | null; monthly_premium_cents?: number | null };
type Pipeline = { id: string; name: string; partner_type: string; stages: PipelineStage[] };
type PageData = { template: { assignment: { template_version: number }; template: TemplateRow; latest: { version: number; name: string } | null }; pipelines: Pipeline[]; leads: Lead[]; role?: string; currentUserId?: string; money?: boolean; readOnly: boolean };
type LeadDetail = { lead: Lead & { product_line: string; definition_version: number }; template: TemplateRow; queue: { status: string; owner_user_id: string | null; claimed_at: string | null; disposition: string | null } | null; partner: { name: string; partner_type: string } | null; stage: PipelineStage | null; submitter: { name: string } | null; owner: { name: string } | null; screening: { outcome: string | null; warning: string | null }; timeline: Array<{ id: string; label: string; at: string; actor: string; detail: string | null }>; readOnly: boolean };

/** The combined view. A sentinel rather than a pipeline id, because it is not one. */
/** Leads whose stage is archived or belongs to no stage on this board. */
/** The workspace's reads, as the app's cache keys them (lib/client/route-resources.ts warms the first on hover). */
const leadsKey = (query: string) => `/api/app/leads${query ? `?${query}` : ""}`;
const CONTEXT_KEY = "/api/app/leads/pipeline-context";
const UNMAPPED = "__unmapped";

function display(value: unknown) { return Array.isArray(value) ? value.join(", ") : value === null || value === undefined || value === "" ? "Not provided" : String(value); }
function leadName(lead: Lead) { return display(lead.values.full_name ?? lead.values.name ?? ([lead.values.first_name, lead.values.last_name].filter(Boolean).join(" ") || "Unnamed lead")); }
function when(value: string) { return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
function productOf(lead: Lead) { return String(lead.values.product ?? lead.values.product_name ?? lead.values.product_line ?? "Life insurance"); }
/** "4 min", "11h 02m", "2d 04h" — how long a lead has been waiting, as the board writes it. */
function age(fromIso: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${String(hours % 24).padStart(2, "0")}h`;
}
/** Annual premium in whole dollars: "$3,120". */
const annual = (monthlyCents: number) => `$${Math.round((monthlyCents * 12) / 100).toLocaleString("en-US")}`;
/** A column or tile total: "$412k". */
function compactAnnual(monthlyCents: number) {
  const dollars = (monthlyCents * 12) / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(dollars >= 10_000_000 ? 0 : 1)}m`;
  if (dollars >= 1_000) return `$${Math.round(dollars / 1_000)}k`;
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}

function FieldInput({ field, value, onChange, id, labelId }: { field: TemplateField; value: unknown; onChange: (value: unknown) => void; id?: string; labelId?: string }) {
  if (field.type === "boolean") return <select id={id} aria-labelledby={labelId} aria-label={labelId ? undefined : field.label} className="lead-form-control" value={value === undefined ? "" : String(value)} onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value === "true")}><option value="">Choose…</option><option value="true">Yes</option><option value="false">No</option></select>;
  if (field.type === "single_select") return <select id={id} aria-labelledby={labelId} aria-label={labelId ? undefined : field.label} className="lead-form-control" value={String(value ?? "")} onChange={(event) => onChange(event.target.value || undefined)}><option value="">Choose…</option>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
  if (field.type === "multi_select") return <div id={id} role="group" aria-labelledby={labelId} aria-label={labelId ? undefined : field.label} className="flex flex-wrap gap-2">{field.options.map((option) => { const selected = Array.isArray(value) && value.includes(option); return <label key={option} className="flex items-center gap-1 text-xs"><input type="checkbox" aria-label={option} checked={selected} onChange={(event) => onChange([...(Array.isArray(value) ? value : []).filter((item) => item !== option), ...(event.target.checked ? [option] : [])])} />{option}</label>; })}</div>;
  if (field.type === "long_text") return <textarea id={id} aria-labelledby={labelId} aria-label={labelId ? undefined : field.label} className="lead-form-control min-h-24 py-2" value={String(value ?? "")} onChange={(event) => onChange(event.target.value || undefined)} />;
  const inputType = field.type === "number" || field.type === "currency" ? "number" : field.type === "date" ? "date" : field.type === "phone" ? "tel" : field.type === "email" ? "email" : "text";
  // A currency field is kept in whole cents (the template's rule): the person types dollars, so it is shown
  // as dollars and sent as cents (E2E 2026-11-03: "10000" typed was kept as $100.00).
  if (field.type === "currency") return <Input id={id} aria-labelledby={labelId} aria-label={labelId ? undefined : field.label} type="number" inputMode="decimal" step="0.01" min={0} value={typeof value === "number" ? String(value / 100) : ""} onChange={(event) => { const raw = event.target.value; onChange(raw === "" ? undefined : Math.round(Number(raw) * 100)); }} />;
  return <Input id={id} aria-labelledby={labelId} aria-label={labelId ? undefined : field.label} type={inputType} step={field.type === "number" ? "any" : undefined} value={value === undefined ? "" : String(value)} onChange={(event) => { const raw = event.target.value; onChange(raw === "" ? undefined : field.type === "number" ? Number(raw) : raw); }} />;
}

/**
 * "Add lead", as a dialog. The draft is fetched when it opens and saved every 30 seconds while it
 * stays open, so a half-typed lead survives a reload — the promise the board's note makes.
 */
function LeadFormDialog({ open, onOpenChange, template, stages, readOnly, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; template: TemplateRow; stages: PipelineStage[]; readOnly: boolean; onCreated: () => void }) {
  const [values, setValues] = useState<Record<string, unknown>>({}); const [stage, setStage] = useState(stages[0]?.id ?? ""); const [saving, setSaving] = useState(false); const [draftStatus, setDraftStatus] = useState("Draft autosaves every 30 seconds");
  const fields = useMemo(() => new Map(template.fields.map((field) => [field.field_key, field])), [template.fields]);
  useEffect(() => { if (!open) return; let cancelled = false; void fetch("/api/app/leads/draft", { cache: "no-store" }).then(async (response) => ({ response, body: await response.json().catch(() => null) })).then(({ response, body }) => { if (cancelled) return; if (response.ok && body?.draft?.payload) { setValues(body.draft.payload); setDraftStatus("Draft resumed"); } else if (!response.ok) { setDraftStatus("Draft could not be loaded; starting a new draft"); } }).catch(() => { if (!cancelled) setDraftStatus("Draft could not be loaded; starting a new draft"); }); return () => { cancelled = true; }; }, [open, template.definition_version]);
  useEffect(() => { if (!open) return; const timer = window.setInterval(() => { setDraftStatus("Saving draft…"); void fetch("/api/app/leads/draft", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload: values }) }).then((response) => { if (response.ok) setDraftStatus("Draft saved"); }).catch(() => setDraftStatus("Draft could not be saved; your typed data is still here")); }, 30000); return () => window.clearInterval(timer); }, [open, values]);
  // A pipeline switch changes which stages are offered; keep the choice valid.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (!stages.some((item) => item.id === stage)) setStage(stages[0]?.id ?? ""); }, [stages, stage]);
  function updateValue(fieldKey: string, value: unknown) { setValues((current) => pruneHiddenTemplateValues(template.form_definition, { ...current, [fieldKey]: value })); }
  async function submit(event: React.FormEvent) { event.preventDefault(); setSaving(true); try { const response = await fetch("/api/app/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values, stage_id: stage }) }); if (!response.ok) { notify.block("Could not create lead. Check your connection and try again."); return; } setValues({}); onOpenChange(false); notify.done("Lead added to the pipeline"); onCreated(); } catch { notify.fail("Could not create lead. Check your connection and try again."); } finally { setSaving(false); } }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add a lead</DialogTitle>
          <DialogDescription>Captured with the active {template.product_name} template.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          {template.form_definition.sections.map((section) => <fieldset key={section.section_key} className="space-y-3 rounded-lg border border-border p-3"><legend className="px-1 text-sm font-semibold">{section.label}</legend>{section.fields.map((formField) => { const field = fields.get(formField.field_key); if (!field || !templateFormFieldVisible(formField, values)) return null; const fieldId = `lead-field-${field.field_key}`; const fieldLabelId = `${fieldId}-label`; const isGroup = field.type === "multi_select"; return <div key={formField.field_key} className="space-y-1.5"><Label id={fieldLabelId} htmlFor={isGroup ? undefined : fieldId}>{field.label}{(formField.is_required || field.is_required) && <span className="text-destructive"> *</span>}</Label>{field.help_text && <p className="text-xs text-muted-foreground">{field.help_text}</p>}<FieldInput id={fieldId} labelId={fieldLabelId} field={field} value={values[field.field_key]} onChange={(value) => updateValue(field.field_key, value)} /></div>; })}</fieldset>)}
          <div className="space-y-1.5"><Label htmlFor="lead-stage">Starting stage</Label><select id="lead-stage" className="lead-form-control" value={stage} onChange={(event) => setStage(event.target.value)}>{stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted-foreground">{draftStatus}</span><Button type="submit" disabled={readOnly || saving}>{readOnly ? "Read-only account" : saving ? "Adding…" : "Add lead"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type Column = { id: string; name: string; color: string; stage: PipelineStage | null };

/**
 * The board drawn as the partner portal's Pipeline draws it (owner 2026-11-09: "copy the same design that is on
 * partners pipeline"; components/partner/partner-lead-pipeline.tsx). Each stage is a lane in its own colour (2026-11-10:
 * the top edge, a tinted header, a dot and the count), full height with its cards scrolling inside, a header with the name and a count pill, folding to a narrow strip; cards are the partner card — name, a product
 * chip, then a footer line with the age — and every card of a stage is in its lane, which scrolls (owner 2026-11-10: no pager in the stages). The lead board's own rules
 * stay: a drop asks for the disposition that moves the lead, a click opens the lead beside the board, a lead past its
 * stage's time allowed is flagged red.
 */
function PipelineCard({ lead, status, selected, readOnly, now, money, late, dragging = false, onSelect, onDragStart, onDragEnd }: { lead: Lead; status: string; selected: boolean; readOnly: boolean; now: number; money: boolean; late: boolean; dragging?: boolean; onSelect: () => void; onDragStart: () => void; onDragEnd?: () => void }) {
  const premium = money && lead.monthly_premium_cents != null ? annual(lead.monthly_premium_cents) : null;
  // Time in the current stage when it is known (20260925100000); until then, time since arrival.
  const stageMs = inStageMs(lead, now);
  const ageText = stageMs != null ? durationLabel(stageMs) : now ? age(lead.created_at, now) : "—";
  return (
    // m-drop-in (§ Motion, Wave 3): a card settles into its column — on the first draw, after a page turn, and where it
    // lands when moved; the card being dragged fades back in place until it is dropped.
    <article draggable={!readOnly} onDragStart={onDragStart} onDragEnd={onDragEnd} data-dragging={dragging ? "" : undefined} className={cn("m-drop-in group w-full rounded-md border bg-card transition-colors hover:border-[var(--primary)] hover:bg-[var(--surface-alt)]", !readOnly && "cursor-grab active:cursor-grabbing", selected ? "border-[var(--primary)]" : "border-border")}>
      <button type="button" onClick={onSelect} className="block w-full p-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]" title={readOnly ? undefined : "Open to see the lead, or drag it to another stage — you will be asked which disposition"}>
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">{leadName(lead)}</span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{lead.owner_name ?? lead.submitter_name ?? "Workspace"}</span>
          </span>
          <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </span>
        <span className="mt-2 flex flex-wrap items-center gap-1.5">
          <StatusChip tone="neutral" className="border border-border">{productOf(lead)}</StatusChip>
          {premium && <StatusChip tone="neutral" className="border border-border tabular-nums">{premium} a year</StatusChip>}
        </span>
        {/* The last outcome and the waiting time stay together; past the stage's time allowed the age is a red badge. */}
        <span className="mt-2 flex min-w-0 items-center justify-between gap-2 border-t border-border pt-1.5">
          <span className="min-w-0 truncate text-xs text-muted-foreground">{status}</span>
          {late ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-badge bg-[var(--error-surface)] px-1.5 py-0.5 text-xs font-medium tabular-nums text-[var(--error-ink)]">
              <CircleAlert className="size-3 shrink-0" aria-hidden="true" />{ageText}<span className="sr-only"> — past the time allowed</span>
            </span>
          ) : <span className="shrink-0 tabular-nums text-muted-foreground" title={stageMs != null ? "Time in this stage" : `Arrived ${when(lead.created_at)}`}>{ageText}</span>}
        </span>
      </button>
      {lead.screening_warning && <span role="status" className="mx-3 mb-3 block rounded-md bg-[var(--warning-surface)] px-2 py-1 text-xs text-[var(--warning-ink)]">{lead.screening_warning}</span>}
    </article>
  );
}

function PipelineBoard({ stages, leads, selectedId, readOnly, now, money, context, onSelect, onStageChange }: { stages: PipelineStage[]; leads: Lead[]; selectedId: string | null; readOnly: boolean; now: number; money: boolean; context: ViewContext | null; onSelect: (lead: Lead) => void; onStageChange: (lead: Lead, stage: string) => void }) {
  const [draggedId, setDraggedId] = useState<string | null>(null); const [dragOver, setDragOver] = useState<string | null>(null);
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const toggleLane = (id: string) => setFolded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const activeStages = stages.filter((stage) => !stage.is_archived).sort((a, b) => a.position - b.position);
  const live = new Set(activeStages.map((stage) => stage.id));
  // A lead on an archived stage, or a stage this pipeline no longer has, still gets a column — it
  // is never silently reassigned and never dropped off the board.
  const unmapped = leads.filter((lead) => !live.has(lead.stage_id));
  const columns: Column[] = [
    ...activeStages.map((stage) => ({ id: stage.id, name: stage.name, color: stage.color, stage })),
    ...(unmapped.length ? [{ id: UNMAPPED, name: "Unmapped", color: "var(--muted-foreground)", stage: null }] : []),
  ];
  // Below md the lanes stack into one vertical read; on wider screens they sit side by side.
  return (
    <div className="flex min-h-[24rem] flex-1 flex-col gap-3 overflow-x-auto p-3 md:h-[calc(100dvh-var(--top-bar-h)-14.5rem)] md:flex-row">
      {columns.map((column) => {
        const columnLeads = column.id === UNMAPPED ? unmapped : leads.filter((lead) => lead.stage_id === column.id);
        const premium = columnLeads.reduce((sum, lead) => sum + (lead.monthly_premium_cents ?? 0), 0);
        // A stage no disposition lands on cannot be entered, so it does not accept a drop.
        const enterable = column.stage ? (context?.dispositionsByStage[column.id]?.length ?? 0) > 0 : false;
        const dropTarget = column.id !== UNMAPPED && !readOnly && (!context || enterable);
        const late = columnLeads.filter((lead) => isOverdue(lead, context, now)).length;
        const allowed = column.stage ? context?.stageRules[column.id]?.timeAllowedMinutes : null;
        const isFolded = folded.has(column.id);
        const total = columnLeads.length;
        const footnote = column.id === UNMAPPED ? "Stage retired or moved" : late ? `${late} past the ${durationLabel((allowed ?? 0) * 60_000)} allowed` : money && premium > 0 ? `${compactAnnual(premium)} annualised` : undefined;
        return (
          <section
            key={column.id}
            data-stage={column.id}
            aria-label={`${column.name}: ${total} ${total === 1 ? "lead" : "leads"}`}
            className={cn("flex min-w-0 flex-col rounded-md border bg-[var(--canvas)] transition-colors duration-[var(--t-micro)]", isFolded ? "md:w-12 md:min-w-12 md:flex-none" : "md:w-0 md:min-h-0 md:min-w-[18rem] md:flex-1", dragOver === column.id ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-border")}
            onDragOver={(event) => { if (column.id === UNMAPPED || readOnly) return; event.preventDefault(); setDragOver(column.id); }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(event) => { event.preventDefault(); setDragOver(null); const lead = leads.find((item) => item.id === draggedId); setDraggedId(null); if (!lead || lead.stage_id === column.id) return; if (!dropTarget) { notify.block(`Map a disposition to ${column.name} in Settings › Dispositions to move leads there.`); return; } onStageChange(lead, column.id); }}
          >
            <header className="sticky top-0 z-10 rounded-t-md border-t-[3px] border-b border-b-border text-sm font-semibold text-foreground md:static" style={{ borderTopColor: column.color, background: `color-mix(in srgb, ${column.color} 16%, var(--color-card))` }} title={footnote}>
              <div className={cn("flex w-full items-center gap-2 px-3 py-2", isFolded && "md:flex-col md:px-0 md:py-3")}>
                <button
                  type="button"
                  aria-expanded={!isFolded}
                  aria-label={`${column.name}, ${total.toLocaleString()} ${total === 1 ? "lead" : "leads"}. ${isFolded ? "Open" : "Fold"} this stage`}
                  onClick={() => toggleLane(column.id)}
                  className={cn("flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left font-[inherit] text-inherit outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", isFolded && "md:flex-none md:flex-col")}
                >
                  <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isFolded && "-rotate-90")} />
                  <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: column.color }} />
                  <h3 className={cn("min-w-0 flex-1 truncate", isFolded && "md:flex-none md:[writing-mode:vertical-rl]")}>{column.name}</h3>
                </button>
                {column.stage && !isFolded && <StageWhy stage={column.stage} first={column.stage.id === activeStages[0]?.id} context={context} />}
                <span className="inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground" style={{ background: `color-mix(in srgb, ${column.color} 30%, transparent)` }}>{total.toLocaleString()}</span>
              </div>
              {!isFolded && footnote && <p className={cn("-mt-1 truncate px-3 pb-2 text-xs font-normal tabular-nums", late ? "font-semibold text-[var(--error-ink)]" : "text-muted-foreground")}>{footnote}</p>}
            </header>
            <div className={cn("grid content-start gap-2 p-2 md:min-h-0 md:flex-1 md:overflow-y-auto", isFolded && "hidden")} style={{ background: `color-mix(in srgb, ${column.color} 5%, transparent)` }}>
              {columnLeads.map((lead) => <PipelineCard key={lead.id} lead={lead} status={dispositionLabel(lead.disposition, context) ?? column.name} selected={lead.id === selectedId} readOnly={readOnly} now={now} money={money} late={isOverdue(lead, context, now)} onSelect={() => onSelect(lead)} dragging={lead.id === draggedId} onDragStart={() => setDraggedId(lead.id)} onDragEnd={() => { setDraggedId(null); setDragOver(null); }} />)}
              {/* An empty lane is one quiet line on a phone, not 420px of nothing. */}
              {!total && <p className="px-2 py-2 text-center text-xs text-muted-foreground md:py-6">{readOnly ? "Nothing here right now" : column.stage && context && !enterable ? "No disposition lands here" : "Nothing here right now"}</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** A submitted value as a person reads it: Yes/No, dollars, a date, a phone number, a list. */
function fieldValue(field: TemplateField | undefined, value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not provided";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Not provided";
  if (field?.type === "boolean" || typeof value === "boolean") return value === true || value === "true" ? "Yes" : value === false || value === "false" ? "No" : String(value);
  // A currency field is kept in whole cents (the template's rule).
  if (field?.type === "currency" && Number.isFinite(Number(value))) return `$${(Number(value) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (field?.type === "number" && Number.isFinite(Number(value))) return Number(value).toLocaleString("en-US");
  if (field?.type === "date" && /^\d{4}-\d{2}-\d{2}/.test(String(value))) return dayMonthYear(String(value).slice(0, 10));
  if (field?.type === "phone") { const digits = String(value).replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""); if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`; }
  return String(value);
}
/** A key the template no longer names, in words: "qa_seed" → "Qa seed". */
const keyLabel = (key: string) => { const words = key.replace(/[_-]+/g, " ").trim(); return words ? words.charAt(0).toUpperCase() + words.slice(1) : key; };
/** The name is the panel's title, so the name fields are not repeated in the list. */
const NAME_KEYS = new Set(["full_name", "name", "first_name", "last_name"]);

function PanelRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-baseline gap-3 border-b border-border py-2.5 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

/**
 * The lead beside the board (owner 2026-11-10: "fit the full height of the page … redesign it a bit better"). It runs
 * the board's full height with its body scrolling inside; the stage is a coloured chip with how long the lead has
 * been there; three facts sit in one strip; the form reads as plain rows with real values (Yes/No, dollars, dates,
 * phone numbers) instead of a wall of capitals; the timeline is a line of events. Open full lead workspace is the
 * one primary action, Move the other.
 */
function LeadPreviewPanel({ lead, stages, readOnly, now, onMove, onClose, onReconciled }: { lead: Lead; stages: PipelineStage[]; readOnly: boolean; now: number; onMove: () => void; onClose: () => void; onReconciled?: () => void }) {
  const [tab, setTab] = useState<"submission" | "timeline">("submission"); const [data, setData] = useState<LeadDetail | null>(null); const [error, setError] = useState("");
  // The selected lead changes the external request and resets the preview while it loads.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { let cancelled = false; setData(null); setError(""); void fetch(`/api/app/leads/${encodeURIComponent(lead.id)}`, { cache: "no-store" }).then(async (response) => ({ response, body: await response.json().catch(() => null) })).then(({ response, body }) => { if (cancelled) return; if (!response.ok) { setError(body?.error ?? "Could not load this lead"); return; } setData(body); }).catch(() => { if (!cancelled) setError("Could not load this lead"); }); return () => { cancelled = true; }; }, [lead.id, lead.stage_id]);
  const liveStages = stages.filter((item) => !item.is_archived).sort((a, b) => a.position - b.position);
  const stage = liveStages.find((item) => item.id === lead.stage_id) ?? null;
  const fields = new Map((data?.template.fields ?? []).map((field) => [field.field_key, field]));
  // The template's own order first, then anything it no longer names; the name fields are the title.
  const ordered = data ? [
    ...data.template.fields.map((field) => field.field_key).filter((key) => key in data.lead.values),
    ...Object.keys(data.lead.values).filter((key) => !fields.has(key)),
  ].filter((key) => !NAME_KEYS.has(key)) : [];
  const inStage = inStageMs(lead, now);
  const screening = data?.screening.outcome ?? null;
  const screeningTone = screening === "clear" ? "good" : screening === "blocked" ? "danger" : "neutral";
  return <DetailPanel
    mode="split"
    title={leadName(lead)}
    subtitle={<>{productLineLabel(data?.lead.product_line ?? productOf(lead))} · {data?.partner?.name ?? "Partner submission"}</>}
    status={<>
      <span className="inline-flex items-center gap-1.5 rounded-badge border border-border px-2 py-0.5 text-xs font-semibold text-foreground" style={stage ? { background: `color-mix(in srgb, ${stage.color} 18%, transparent)` } : undefined}>
        <span aria-hidden="true" className="size-2 rounded-full" style={{ background: stage?.color ?? "var(--muted-foreground)" }} />{stage?.name ?? "Unmapped"}
      </span>
      <StatusChip tone={screeningTone}>{screening ? `Screening ${screening}` : "Screening pending"}</StatusChip>
    </>}
    onClose={onClose}
    bodyClassName="flex flex-col"
    // The board's full height (the TableCard beside it is calc(100dvh - top bar - 153px)), held in view while the page scrolls.
    className="lg:sticky lg:top-[calc(var(--top-bar-h)+1rem)] lg:h-[calc(100dvh-var(--top-bar-h)-153px)] lg:self-start"
    footer={<>
      <Button asChild className="flex-1"><Link href={`/app/leads/${lead.id}`}>Open full lead workspace <ExternalLink className="size-4" aria-hidden="true" /></Link></Button>
      {/* Moving from the keyboard: the board's cards are drag-only, so the move lives here too, as a disposition. */}
      <Button type="button" variant="outline" aria-label={`Move ${leadName(lead)} to stage`} disabled={readOnly} onClick={onMove}>Move</Button>
    </>}
  >
    {/* Three facts in one strip, hairlines between. */}
    <div className="grid shrink-0 grid-cols-3 border-b border-border">
      {[
        { label: "In stage", value: inStage != null ? durationLabel(inStage) : "—" },
        { label: "Owner", value: data ? data.owner?.name ?? "Unclaimed" : lead.owner_name ?? "…" },
        { label: "Submitted", value: dayMonthYear(lead.created_at) },
      ].map((fact) => (
        <div key={fact.label} className="min-w-0 border-r border-border px-4 py-3 last:border-r-0">
          <p className="m-0 text-xs text-muted-foreground">{fact.label}</p>
          <p className="m-0 mt-0.5 truncate text-sm font-semibold tabular-nums text-foreground" title={fact.value}>{fact.value}</p>
        </div>
      ))}
    </div>
    {/* LA-3.23 · when the application has moved on but the card was held back by hand. */}
    <LeadStageHint leadId={lead.id} boardStageId={lead.stage_id} readOnly={readOnly} onReconciled={onReconciled} />
    <UnderlineTabs label="Lead preview" tabs={[{ key: "submission", label: "Submission" }, { key: "timeline", label: "Timeline", count: data?.timeline.length }]} value={tab} onChange={setTab} idPrefix="lead-preview-tab" controls="lead-preview-tabpanel" className="shrink-0 px-4 pt-1" />
    {error ? <p role="alert" className="m-0 px-4 py-6 text-sm text-[var(--error-ink)]">{error}</p>
      : !data ? <div className="flex-1 p-4"><SectionLoading rows={6} columns={2} label="Loading lead" /></div>
      : tab === "submission" ? (
        <div key="submission" id="lead-preview-tabpanel" role="tabpanel" aria-labelledby="lead-preview-tab-submission" className="m-content-in flex flex-col gap-5 px-4 py-4">
          <section>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <h3 className="m-0 text-sm font-semibold text-foreground">Form as submitted</h3>
              <span className="text-xs text-muted-foreground">Version {data.lead.definition_version}</span>
            </div>
            {ordered.length ? (
              <dl className="m-0">
                {ordered.map((key) => <PanelRow key={key} label={fields.get(key)?.label ?? keyLabel(key)}>{fieldValue(fields.get(key), data.lead.values[key])}</PanelRow>)}
              </dl>
            ) : <p className="m-0 py-2 text-sm text-muted-foreground">Nothing was filled in beyond the name.</p>}
          </section>
          <section>
            <h3 className="m-0 mb-1 text-sm font-semibold text-foreground">Submission details</h3>
            <dl className="m-0">
              <PanelRow label="Submitted">{when(data.lead.created_at)}</PanelRow>
              <PanelRow label="Submitted by">{data.submitter?.name ?? lead.submitter_name ?? "Workspace"}</PanelRow>
              <PanelRow label="Owner">{data.owner?.name ?? "Unclaimed"}</PanelRow>
              <PanelRow label="Queue status">{data.queue?.status ? keyLabel(data.queue.status) : "Not queued"}</PanelRow>
            </dl>
          </section>
        </div>
      ) : (
        <div key="timeline" id="lead-preview-tabpanel" role="tabpanel" aria-labelledby="lead-preview-tab-timeline" className="m-content-in px-4 py-4">
          {data.timeline.length ? (
            <ol className="m-0 list-none p-0">
              {data.timeline.map((event, index) => (
                <li key={event.id} className="relative grid grid-cols-[1rem_minmax(0,1fr)] gap-3 pb-4 last:pb-0">
                  {index < data.timeline.length - 1 && <span aria-hidden="true" className="absolute top-4 bottom-0 left-[0.4375rem] w-px bg-border" />}
                  <span aria-hidden="true" className={cn("mt-1 size-3.5 rounded-full border-2 bg-card", index === 0 ? "border-[var(--primary)]" : "border-[var(--border-strong)]")} />
                  <div className="min-w-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="m-0 text-sm font-semibold text-foreground">{event.label}</p>
                      <time className="shrink-0 text-xs tabular-nums text-muted-foreground">{when(event.at)}</time>
                    </div>
                    <p className="m-0 mt-0.5 text-xs text-muted-foreground">{event.detail ?? event.actor}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : <p className="m-0 text-sm text-muted-foreground">No timeline events yet.</p>}
        </div>
      )}
  </DetailPanel>;
}

const VIEW_LABEL = { stages: "Stages", board: "Board", table: "Table", list: "List" } as const;

export function LeadWorkspace() {
  // Solo mode (owner 2026-10-29): every lead is the one agent's, so "Assigned to me" and "Unassigned" say nothing.
  const solo = useSolo();
  const [data, setData] = useState<PageData | null>(() => seed<PageData>(leadsKey(""), true)?.data ?? null); const [error, setError] = useState(""); const [search, setSearch] = useState(""); const [query, setQuery] = useState(""); const [view, setView] = useState<"stages" | "board" | "table" | "list">("board"); const [selected, setSelected] = useState<Lead | null>(null); const [moreFilters, setMoreFilters] = useState(false); const [product, setProduct] = useState(""); const [stageFilter, setStageFilter] = useState(""); const [submitter, setSubmitter] = useState(""); const [outcome, setOutcome] = useState(""); const [fromDate, setFromDate] = useState(""); const [toDate, setToDate] = useState("");
  const [pipelineId, setPipelineId] = useState(""); const [adding, setAdding] = useState(false); const [refreshing, setRefreshing] = useState(false);
  // Ages and "today" are measured against the moment the data arrived, read in the browser.
  const [now, setNow] = useState(() => seed(leadsKey(""), true)?.at ?? 0);
  // Stage rules, the dispositions that land on each stage, unmapped outcomes: the pipeline views'
  // context, read alongside the leads.
  const [context, setContext] = useState<ViewContext | null>(() => seed<ViewContext>(CONTEXT_KEY, true)?.data ?? null);
  // The disposition picker: which leads are moving, and to which stage when a drop named one.
  const [picker, setPicker] = useState<{ leads: Lead[]; stageId: string | null; source: "board" | "table" | "list" } | null>(null);
  const [moving, setMoving] = useState(false);
  // A bulk move from the Table waits here, after the disposition is picked, until it is confirmed.
  const [confirmMove, setConfirmMove] = useState<{ leadIds: string[]; key: string; label: string; where: string } | null>(null);
  // The Table's scope (All, Assigned to me, Unassigned, Overdue in stage), set from Saved views.
  const [tableScope, setTableScope] = useState<TableScope>("all");
  // Both reads go through the app's cache (lib/client/resource-cache.ts): a repeat visit draws the last answer at
  // once and this replaces it when the fresh one lands (speed pass 2026-11-09).
  const loadContext = useCallback(async (fresh = false) => { try { setContext(await (fresh ? loadResource<ViewContext>(CONTEXT_KEY, { persist: true }) : readResource<ViewContext>(CONTEXT_KEY, { persist: true }))); } catch { /* the board works without its rules */ } }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadContext(); }, [loadContext]);
  const load = useCallback(async (nextQuery: string, fresh = false) => { let body: PageData; try { body = await (fresh ? loadResource<PageData>(leadsKey(nextQuery), { persist: !nextQuery }) : readResource<PageData>(leadsKey(nextQuery), { persist: !nextQuery })); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load leads"); return; } setError(""); setData(body); setNow(Date.now()); setSelected((current) => (current ? (body.leads ?? []).find((lead: Lead) => lead.id === current.id) ?? null : null)); }, []);
  // This client effect intentionally hydrates the interactive workspace from the authenticated API.
  useEffect(() => {
    // A fresh document (a reload) starts from the kept answer as soon as it has hydrated, then asks again.
    const kept = peek<PageData>(leadsKey(""), true);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the kept answer, read from storage after hydration
    if (kept?.data) { setData((current) => current ?? kept.data ?? null); setNow((current) => current || kept.at); }
    const keptContext = peek<ViewContext>(CONTEXT_KEY, true);
    if (keptContext?.data) setContext((current) => current ?? keptContext.data ?? null);
    void load("");
  }, [load]);
  const template = data?.template.template;
  const money = Boolean(data?.money);
  // Which pipeline's board is on screen.
  //
  // This used to be inferred and never offered: the first lead's pipeline, else the marketing
  // default, else whichever came back first. A tenant with three pipelines could only ever see one,
  // and leads belonging to the others still arrived in `leads` with a `stage_id` matching no column
  // on screen — so they were counted in the filters and rendered nowhere. Choosing is now explicit,
  // and the board only ever shows the leads that belong to the pipeline being shown.
  const pipelines = useMemo(() => data?.pipelines ?? [], [data]);
  // One pipeline on screen at a time, chosen from the pipeline tabs above the list. Every pipeline has
  // its own stages, so there is no honest single set of columns across them, and the old "All
  // pipelines" view stacked one board per pipeline down a long scroll.
  const activePipeline = useMemo(() => pipelines.find((item) => item.id === pipelineId) ?? pipelines.find((item) => item.partner_type === "marketing") ?? pipelines[0], [pipelines, pipelineId]);
  const allStages = useMemo(() => activePipeline?.stages ?? [], [activePipeline]);
  // A new lead is filed into the pipeline on screen.
  const formPipeline = activePipeline;
  const formStages = useMemo(() => { const stages = formPipeline?.stages ?? []; const live = stages.filter((stage) => !stage.is_archived); return live.length ? live : stages; }, [formPipeline]);
  const leadsInPipeline = useMemo(() => (data?.leads ?? []).filter((lead) => !activePipeline || lead.pipeline_id === activePipeline.id), [data, activePipeline]);
  const countFor = useCallback((id: string) => (data?.leads ?? []).filter((lead) => lead.pipeline_id === id).length, [data]);
  // One lookup across every pipeline, so the table and stage filter can resolve a
  // stage id without knowing which board it came from.
  const stageIndex = useMemo(() => { const map = new Map<string, { stage: PipelineStage; pipelineName: string }>(); for (const pipeline of pipelines) for (const stage of pipeline.stages) map.set(stage.id, { stage, pipelineName: pipeline.name }); return map; }, [pipelines]);
  const filterStages = useMemo(() => allStages.filter((stage) => !stage.is_archived).map((stage) => ({ stage, pipelineName: "" })), [allStages]);
  const isOwner = data?.role === "owner";
  // Scoped to the pipeline on screen, so the filter menus never offer a value that would return
  // nothing here.
  const submitters = useMemo(() => [...new Set(leadsInPipeline.map((lead) => lead.submitter_name ?? "Workspace"))].sort(), [leadsInPipeline]); const products = useMemo(() => [...new Set(leadsInPipeline.map(productOf))].sort(), [leadsInPipeline]);
  const visibleLeads = useMemo(() => leadsInPipeline.filter((lead) => (!product || productOf(lead) === product) && (!stageFilter || lead.stage_id === stageFilter) && (!submitter || (lead.submitter_name ?? "Workspace") === submitter) && (!outcome || String(lead.screening_outcome ?? "Pending") === outcome) && (!fromDate || lead.created_at.slice(0, 10) >= fromDate) && (!toDate || lead.created_at.slice(0, 10) <= toDate)), [leadsInPipeline, product, stageFilter, submitter, outcome, fromDate, toDate]);
  const activeFilters = [product, stageFilter, submitter, outcome, fromDate, toDate].filter(Boolean).length;
  function applySearch(event: React.FormEvent) { event.preventDefault(); const params = new URLSearchParams(); if (search.trim()) params.set("q", search.trim()); const next = params.toString(); setQuery(next); void load(next); }
  function resetFilters() { setSearch(""); setQuery(""); setProduct(""); setStageFilter(""); setSubmitter(""); setOutcome(""); setFromDate(""); setToDate(""); void load(""); }
  async function refresh() { setRefreshing(true); try { await Promise.all([load(query, true), loadContext(true)]); } finally { setRefreshing(false); } }
  // Saved views (2026-10-09 saved views): the Table's scope plus every workspace filter, the search
  // and the pipeline tab, as one state the Saved views control can name, save and hand back.
  const viewState: ViewState = { pipeline: activePipeline?.id ?? "", scope: tableScope === "all" ? "" : tableScope, product, stage: stageFilter, submitter, outcome, from: fromDate, to: toDate, q: new URLSearchParams(query).get("q") ?? "" };
  function applyView(state: ViewState) {
    const text = (key: string) => (typeof state[key] === "string" ? (state[key] as string) : "");
    const nextPipeline = pipelines.find((item) => item.id === text("pipeline")) ?? activePipeline;
    if (nextPipeline && nextPipeline.id !== activePipeline?.id) { setPipelineId(nextPipeline.id); setSelected(null); }
    // A stage belongs to one pipeline: a saved stage that is not on this board is dropped, not shown as an empty board.
    const stage = text("stage");
    setStageFilter(stage && nextPipeline?.stages.some((item) => item.id === stage) ? stage : "");
    const scope = text("scope");
    setTableScope(TABLE_SCOPES.includes(scope as TableScope) ? (scope as TableScope) : "all");
    setProduct(text("product")); setSubmitter(text("submitter")); setOutcome(text("outcome")); setFromDate(text("from")); setToDate(text("to"));
    const q = text("q").trim();
    const params = new URLSearchParams(); if (q) params.set("q", q);
    const next = params.toString();
    setSearch(q);
    if (next !== query) { setQuery(next); void load(next); }
  }
  // Switching pipeline clears the stage filter and any open preview. A stage id belongs to exactly
  // one pipeline, so carrying the filter across would silently show an empty board, and the
  // previewed lead is not on the new board at all.
  function selectPipeline(id: string) { setPipelineId(id); setStageFilter(""); setSelected(null); }
  // A stage change is a disposition. A drop names the target stage, so the picker offers only the
  // dispositions that land there; the preview and the table offer every one, grouped.
  // A drop on the board moves the card straight into that stage (owner 2026-11-10: "just put it on the exact thing,
  // without the extra step"). A move is still a disposition (POST /api/app/leads/move), so the drop records the outcome
  // mapped to that stage: the one named like the stage, else the first. Outcomes only a call can record (Callback,
  // Do not call) are never picked here. The card moves at once; a move the server refuses puts it back. A drop never
  // opens the outcome picker (owner 2026-11-10): if the stage rules have not arrived yet, they are read first.
  async function updateStage(lead: Lead, nextStage: string) {
    if (!nextStage || nextStage === lead.stage_id) return;
    const rules = context ?? await readResource<ViewContext>(CONTEXT_KEY, { persist: true }).catch(() => null);
    if (!rules) { notify.block("Could not load the stage rules. Check your connection and try again."); return; }
    if (!context) setContext(rules);
    const stageName = stageIndex.get(nextStage)?.stage.name ?? "that stage";
    const fromName = stageIndex.get(lead.stage_id)?.stage.name ?? "Unmapped";
    const options = (rules.dispositionsByStage[nextStage] ?? []).filter((option) => !callPathOnly(option));
    if (!options.length) { notify.block(`Only a call can move a lead to ${stageName}. Record it from the lead or the dialer.`); return; }
    const pick = options.find((option) => option.label.trim().toLowerCase() === stageName.trim().toLowerCase()) ?? options[0];
    const at = new Date().toISOString();
    setData((current) => (current ? { ...current, leads: current.leads.map((item) => (item.id === lead.id ? { ...item, stage_id: nextStage, stage_entered_at: at, disposition: pick.key } : item)) } : current));
    const ok = await moveLeads([lead.id], pick.key, "board", `${leadName(lead)} moved from ${fromName} to ${stageName}`);
    if (!ok) void load(query, true);
  }
  async function moveLeads(leadIds: string[], key: string, source: "board" | "table" | "list", doneText?: string): Promise<boolean> {
    setMoving(true);
    try {
      const response = await fetch("/api/app/leads/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lead_ids: leadIds, disposition_key: key, source }) });
      const body = await response.json().catch(() => null);
      const moved = body?.moved?.length ?? 0;
      const failed = body?.failed?.length ?? 0;
      if (!response.ok && !moved) { notify.block(body?.error ?? "Could not move the lead"); return false; }
      if (failed || response.status === 207) notify.block(`${moved} of ${leadIds.length} moved${body?.error ? ` — ${body.error}` : ""}`);
      else notify.done(doneText ?? (moved === 1 ? "Lead moved" : `${moved} leads moved`));
      await Promise.all([load(query, true), loadContext(true)]);
      return true;
    } catch {
      notify.fail("Could not move the lead. Check your connection and try again.");
      return false;
    } finally {
      setMoving(false);
    }
  }
  if (error && !data) return <div className="flex flex-col gap-6"><PageHeader title="Leads" /><TableCard><ErrorState detail={error} action={<Button type="button" variant="outline" onClick={() => void load(query)}>Try again</Button>} /></TableCard></div>;
  if (!data || !template) return <PageLoading strip={false} />;
  const exportParams = query ? `?${query}` : "";
  const toggle = (lead: Lead) => setSelected((current) => (current?.id === lead.id ? null : lead));
  const selectedStages = selected ? pipelines.find((item) => item.id === selected.pipeline_id)?.stages ?? [] : [];

  const stageLabel = (stageId: string) => stageIndex.get(stageId)?.stage.name ?? "Unknown stage";
  // An empty Table or List: "no matches" while a search or filter narrows it, otherwise the way to fill it.
  const filtersOn = activeFilters > 0 || Boolean(query);
  const canImport = data.role === "owner" || data.role === "producer" || data.role === "assistant";
  const emptyAction = data.readOnly ? undefined : (
    <span className="flex flex-wrap justify-center gap-2">
      {canImport && <Button asChild variant="outline"><Link href="/app/import">Import a list</Link></Button>}
      {formStages.length > 0 && <Button type="button" onClick={() => setAdding(true)}>Add lead</Button>}
    </span>
  );
  const filterChips: Array<{ key: string; label: string; clear: () => void }> = [
    ...(product ? [{ key: "product", label: product, clear: () => setProduct("") }] : []),
    ...(stageFilter ? [{ key: "stage", label: stageLabel(stageFilter), clear: () => setStageFilter("") }] : []),
    ...(submitter ? [{ key: "submitter", label: `By ${submitter}`, clear: () => setSubmitter("") }] : []),
    ...(outcome ? [{ key: "outcome", label: outcome === "clear" ? "Clear" : outcome === "blocked" ? "Blocked" : outcome, clear: () => setOutcome("") }] : []),
    ...(fromDate ? [{ key: "from", label: `From ${fromDate}`, clear: () => setFromDate("") }] : []),
    ...(toDate ? [{ key: "to", label: `To ${toDate}`, clear: () => setToDate("") }] : []),
  ];
  // Built-in views: only what the workspace's filters can already say. Counted over the whole
  // pipeline, because applying a view replaces the filters rather than adding to them.
  const scopeCounts = tableScopeCounts(leadsInPipeline, context, now, data.currentUserId ?? null);
  const pipelineKey = activePipeline?.id ?? "";
  const builtInViews: BuiltInView[] = [
    { id: "all", name: "All", state: { pipeline: pipelineKey }, count: scopeCounts.all },
    ...(solo ? [] : [
      { id: "mine", name: "Assigned to me", state: { pipeline: pipelineKey, scope: "mine" }, count: scopeCounts.mine, disabled: !data.currentUserId },
      { id: "unassigned", name: "Unassigned", state: { pipeline: pipelineKey, scope: "unassigned" }, count: scopeCounts.unassigned },
    ] satisfies BuiltInView[]),
    { id: "overdue", name: "Overdue in stage", state: { pipeline: pipelineKey, scope: "overdue" }, count: scopeCounts.overdue, disabled: !context?.schemaReady, title: !context?.schemaReady ? "Needs time allowed per stage (database update 20260925100000)" : undefined },
  ];

  return (
    <div className="m-stagger lead-workspace-page flex flex-col gap-6">
      <PageHeader
        title="Leads"
        description="Every lead by stage. Drag a card to record the outcome that moves it."
        // Leads A1 (2026-10-25): one pipeline at a time; its tabs are the page's sub-page bar, on the title's line (§8b).
        tabs={pipelines.length > 0 ? <UnderlineTabs label="Pipeline" tabs={pipelines.map((item) => ({ key: item.id, label: item.name, count: countFor(item.id) }))} value={activePipeline?.id ?? ""} onChange={selectPipeline} /> : undefined}
        actions={
          <>
            {data.template.latest && <Button type="button" variant="outline" onClick={async () => { const response = await fetch("/api/app/templates/assignment", { method: "POST" }); if (!response.ok) notify.block("Could not update the template"); else { notify.done("Template updated"); void load(query, true); } }}>Update template</Button>}
            <Button asChild variant="outline"><a href={`/api/app/leads/export${exportParams}`}>Export CSV</a></Button>
            <Button type="button" disabled={data.readOnly || formStages.length === 0} onClick={() => setAdding(true)}>Add lead</Button>
          </>
        }
      />

      {error && <p role="alert" className="rounded-lg border border-[var(--error)]/30 bg-[var(--error-surface)] px-4 py-2.5 text-sm text-[var(--error-ink)]">{error}</p>}

      {/* The board or table, with the lead preview split beside it from lg (DetailPanel). The board sits in the
          card, as the partner Pipeline's does (owner 2026-11-09). */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <TableCard
          // Full height in every view: the card reaches the bottom of the window even when a view is short.
          className="min-w-0 flex-1 min-h-[calc(100dvh-var(--top-bar-h)-153px)]"
          toolbar={
            <div className="flex w-full flex-col gap-3">
            {/* Enter in the search box searches (server side); the hidden submit is for screen readers
                that announce the form. */}
            <form onSubmit={applySearch} className="w-full">
              <DataToolbar
                actions={
                  <>
                    <Segmented label="View" options={(["stages", "board", "table", "list"] as const).map((option) => ({ key: option, label: VIEW_LABEL[option] }))} value={view} onChange={(option) => { setView(option); if (option === "stages" || option === "list") setSelected(null); }} />
                    <RefreshButton onClick={() => void refresh()} refreshing={refreshing} />
                  </>
                }
              >
                <ToolbarSearch value={search} onChange={setSearch} placeholder="Search name, phone, policy" />
                <FilterButton open={moreFilters} controls="lead-filters" onClick={() => setMoreFilters((value) => !value)} count={activeFilters} />
                {/* Saved views name the Table's scope too, so they sit on the Table. Per-browser for now. */}
                {view === "table" && <SavedViews storageKey="leads.table" current={viewState} builtIns={builtInViews} onApply={applyView} />}
                {filterChips.map((chip) => <ToggleChip key={chip.key} onRemove={chip.clear}>{chip.label}</ToggleChip>)}
                {(activeFilters > 0 || query) && <ClearFiltersButton onClick={resetFilters} />}
                <button type="submit" className="sr-only">Search</button>
              </DataToolbar>
            </form>
            </div>
          }
          filters={
            // Inline under the toolbar (UI-CONSISTENCY §6a): labelled fields that push the list down.
            <FilterPanel id="lead-filters" open={moreFilters}>
              <Field label="Product" htmlFor="lead-filter-product"><select id="lead-filter-product" className={control} value={product} onChange={(event) => setProduct(event.target.value)}><option value="">All products</option>{products.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
              <Field label="Stage" htmlFor="lead-filter-stage"><select id="lead-filter-stage" className={control} value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}><option value="">All stages</option>{filterStages.map((entry) => <option key={entry.stage.id} value={entry.stage.id}>{entry.pipelineName ? `${entry.pipelineName} · ${entry.stage.name}` : entry.stage.name}</option>)}</select></Field>
              <Field label="Submitted by" htmlFor="lead-filter-submitter"><select id="lead-filter-submitter" className={control} value={submitter} onChange={(event) => setSubmitter(event.target.value)}><option value="">Everyone</option>{submitters.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
              <Field label="Outcome" htmlFor="lead-filter-outcome"><select id="lead-filter-outcome" className={control} value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="">Any outcome</option><option value="clear">Clear</option><option value="blocked">Blocked</option></select></Field>
              <Field label="Submitted from" htmlFor="lead-filter-from"><input id="lead-filter-from" type="date" className={control} value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></Field>
              <Field label="Submitted to" htmlFor="lead-filter-to"><input id="lead-filter-to" type="date" className={control} value={toDate} onChange={(event) => setToDate(event.target.value)} /></Field>
            </FilterPanel>
          }
        >
          {/* The board's columns sit inset; Stages, Table and List render bare, edge to edge in the card. */}
          {/* Keyed by the view, so switching board / table / list / stages settles the new view in (§ Motion). */}
          <div key={view} className={cn("m-content-in")}>
            {view === "stages" && (
              <StagesView
                pipelines={activePipeline ? [activePipeline] : []}
                leads={visibleLeads}
                context={context}
                isOwner={isOwner}
                now={now}
              />
            )}
            {view === "list" && (
              <ListView
                pipelines={activePipeline ? [activePipeline] : []}
                leads={visibleLeads}
                context={context}
                now={now}
                readOnly={data.readOnly}
                onMove={(lead, key) => moveLeads([lead.id], key, "list")}
                filtered={filtersOn}
                onClearFilters={resetFilters}
                emptyAction={emptyAction}
              />
            )}
            {view === "board" && !activePipeline ? (
              <EmptyState title="No pipelines yet" hint={isOwner ? "Set up a pipeline to start sorting leads." : "Ask an owner to set up a pipeline."} action={isOwner ? <Button asChild variant="outline"><Link href="/app/settings#pipelines">Open Settings › Pipelines</Link></Button> : undefined} />
            ) : view === "board" ? (
              <PipelineBoard stages={allStages} leads={visibleLeads} selectedId={selected?.id ?? null} readOnly={data.readOnly} now={now} money={money} context={context} onSelect={toggle} onStageChange={updateStage} />
            ) : view === "table" ? (
              <TableView
                // Keyed by scope, so a new scope starts on page 1 with nothing ticked.
                key={tableScope}
                scope={tableScope}
                onScopeChange={setTableScope}
                leads={visibleLeads}
                // Resolved through the cross-pipeline stage index: in the All view there is no active
                // board, and a lead's stage belongs to whichever pipeline it is in.
                stageName={(stageId) => { const entry = stageIndex.get(stageId); return { name: entry ? (entry.stage.is_archived ? `${entry.stage.name} (archived)` : entry.stage.name) : "Unmapped", color: entry?.stage.color ?? "var(--muted-foreground)", pipeline: entry?.pipelineName ?? "" }; }}
                context={context}
                now={now}
                money={money}
                currentUserId={data.currentUserId ?? null}
                readOnly={data.readOnly}
                onOpen={(lead) => setSelected(lead as Lead)}
                onBulkMove={(leadIds) => setPicker({ leads: visibleLeads.filter((lead) => leadIds.includes(lead.id)), stageId: null, source: "table" })}
                filtered={filtersOn}
                onClearFilters={resetFilters}
                emptyAction={emptyAction}
              />
            ) : null}
          </div>
        </TableCard>
        {selected && (view === "board" || view === "table") && <LeadPreviewPanel lead={selected} stages={selectedStages} readOnly={data.readOnly} now={now} onMove={() => setPicker({ leads: [selected], stageId: null, source: "board" })} onClose={() => setSelected(null)} onReconciled={() => void refresh()} />}
      </div>

      {picker && (() => {
        const first = picker.leads[0];
        const pipeline = pipelines.find((item) => item.id === first?.pipeline_id);
        const target = picker.stageId ? stageIndex.get(picker.stageId)?.stage : undefined;
        const groups = picker.stageId
          ? [{ label: `Moves to ${target?.name ?? "that stage"}`, options: context?.dispositionsByStage[picker.stageId] ?? [] }]
          : dispositionGroups(pipeline, picker.leads.length === 1 ? first?.stage_id ?? null : null, context);
        return (
          <DispositionPicker
            open
            onOpenChange={(open) => { if (!open) setPicker(null); }}
            title={picker.leads.length === 1 ? `Move ${leadName(first)}` : `Move ${picker.leads.length} leads`}
            description={picker.stageId ? `Which disposition sends ${picker.leads.length === 1 ? "this lead" : "them"} to ${target?.name ?? "that stage"}?` : "Pick an outcome — it sets the stage."}
            groups={groups}
            busy={moving}
            emptyText={picker.stageId ? undefined : "Map dispositions to this pipeline's stages in Settings › Pipelines to move its leads."}
            onPick={async (key) => {
              // Several leads from the Table: say how many and where they go before anything moves.
              if (picker.source === "table" && picker.leads.length > 1) {
                const group = groups.find((item) => item.options.some((option) => option.key === key));
                const option = group?.options.find((item) => item.key === key);
                setConfirmMove({ leadIds: picker.leads.map((lead) => lead.id), key, label: option?.label ?? key.replaceAll("_", " "), where: group ? group.label.charAt(0).toLowerCase() + group.label.slice(1) : "moves to the stage it maps to" });
                setPicker(null);
                return;
              }
              const ok = await moveLeads(picker.leads.map((lead) => lead.id), key, picker.source); if (ok) setPicker(null);
            }}
          />
        );
      })()}

      {/* The bulk move's confirmation (2026-10-09 saved views): one POST /api/app/leads/move with every ticked lead. */}
      <Dialog open={confirmMove !== null} onOpenChange={(open) => { if (!open && !moving) setConfirmMove(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move {confirmMove?.leadIds.length ?? 0} leads?</DialogTitle>
            <DialogDescription>
              Each of the {confirmMove?.leadIds.length ?? 0} leads gets the disposition “{confirmMove?.label}” and {confirmMove?.where}. Every move is written to the lead&rsquo;s stage history and the audit log. A lead that cannot move is skipped, and you will see how many moved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={moving} onClick={() => setConfirmMove(null)}>Cancel</Button>
            <Button type="button" disabled={moving || data.readOnly || !confirmMove} onClick={async () => { if (!confirmMove) return; const ok = await moveLeads(confirmMove.leadIds, confirmMove.key, "table"); if (ok) setConfirmMove(null); }}>
              {moving ? "Moving…" : `Move ${confirmMove?.leadIds.length ?? 0} leads`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LeadFormDialog open={adding} onOpenChange={setAdding} template={template} stages={formStages} readOnly={data.readOnly} onCreated={() => void load(query, true)} />
    </div>
  );
}
