"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
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
import { ClearFiltersButton, DataToolbar, FilterButton, FilterPanel, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { control, Field } from "@/components/ui/field";
import { ToggleChip } from "@/components/ui/toggle-chip";
import type { TemplateField, TemplateRow } from "@/lib/templates/constants";
import type { PipelineStage } from "@/lib/pipelines/types";
import { pruneHiddenTemplateValues, templateFormFieldVisible } from "@/lib/templates/visibility";
import { cn } from "@/lib/utils";
import { LeadStageHint } from "@/components/app/applications/lead-stage-hint";
import { DispositionPicker, ListView, StagesView, TABLE_SCOPES, TableView, dispositionGroups, durationLabel, inStageMs, initials, isOverdue, tableScopeCounts, type TableScope, type ViewContext } from "@/components/app/pipeline-views";
import { SavedViews, type BuiltInView, type ViewState } from "@/components/ui/saved-views";
import { Segmented, UnderlineTabs } from "@/components/ui/view-tabs";

type Lead = { id: string; pipeline_id: string; stage_id: string; values: Record<string, unknown>; screening_outcome?: string | null; screening_warning?: string | null; created_at: string; updated_at: string; submitter_name?: string | null; owner_user_id?: string | null; owner_name?: string | null; disposition?: string | null; disposition_at?: string | null; stage_entered_at?: string | null; monthly_premium_cents?: number | null };
type Pipeline = { id: string; name: string; partner_type: string; stages: PipelineStage[] };
type PageData = { template: { assignment: { template_version: number }; template: TemplateRow; latest: { version: number; name: string } | null }; pipelines: Pipeline[]; leads: Lead[]; role?: string; currentUserId?: string; money?: boolean; readOnly: boolean };
type LeadDetail = { lead: Lead & { product_line: string; definition_version: number }; template: TemplateRow; queue: { status: string; owner_user_id: string | null; claimed_at: string | null; disposition: string | null } | null; partner: { name: string; partner_type: string } | null; stage: PipelineStage | null; submitter: { name: string } | null; owner: { name: string } | null; screening: { outcome: string | null; warning: string | null }; timeline: Array<{ id: string; label: string; at: string; actor: string; detail: string | null }>; readOnly: boolean };

/** The combined view. A sentinel rather than a pipeline id, because it is not one. */
/** Leads whose stage is archived or belongs to no stage on this board. */
const UNMAPPED = "__unmapped";

function display(value: unknown) { return Array.isArray(value) ? value.join(", ") : value === null || value === undefined || value === "" ? "Not provided" : String(value); }
function leadName(lead: Lead) { return display(lead.values.full_name ?? lead.values.name ?? ([lead.values.first_name, lead.values.last_name].filter(Boolean).join(" ") || "Unnamed lead")); }
function when(value: string) { return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); }
function stageTone(stage: PipelineStage | undefined) { if (!stage) return "lead-stage-neutral"; if (stage.stage_type === "won") return "lead-stage-won"; if (stage.stage_type === "lost") return "lead-stage-lost"; return "lead-stage-open"; }
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
  return <Input id={id} aria-labelledby={labelId} aria-label={labelId ? undefined : field.label} type={inputType} step={field.type === "currency" ? 1 : field.type === "number" ? "any" : undefined} value={value === undefined ? "" : String(value)} onChange={(event) => { const raw = event.target.value; onChange(raw === "" ? undefined : ["number", "currency"].includes(field.type) ? Number(raw) : raw); }} />;
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

function PipelineCard({ lead, selected, readOnly, now, money, late, onSelect, onDragStart }: { lead: Lead; selected: boolean; readOnly: boolean; now: number; money: boolean; late: boolean; onSelect: () => void; onDragStart: () => void }) {
  const premium = money && lead.monthly_premium_cents != null ? annual(lead.monthly_premium_cents) : null;
  // Time in the current stage when it is known (20260925100000); until then, time since arrival.
  const stageMs = inStageMs(lead, now);
  return (
    <article draggable={!readOnly} onDragStart={onDragStart} className={cn("m-card w-full shrink-0 overflow-hidden rounded-xl border m-glass-inset", !readOnly && "cursor-grab active:cursor-grabbing", late ? "border-[color-mix(in_srgb,var(--error)_55%,transparent)]" : "border-border", selected && "border-[var(--primary)] shadow-[var(--shadow-hover)]")}>
      <button type="button" onClick={onSelect} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left" title={readOnly ? undefined : "Open to see the lead, or drag it to another stage — you will be asked which disposition"}>
        <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--primary-soft)] text-xs font-semibold text-[var(--accent-ink)]">{initials(leadName(lead))}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">{leadName(lead)}</span>
          <span className={cn("mt-[3px] block truncate text-xs leading-normal tracking-[-0.01em] tabular-nums", late ? "font-semibold text-[var(--error-ink)]" : "text-muted-foreground")}>
            {lead.submitter_name ?? "Workspace"} · {premium ?? (stageMs != null ? `${durationLabel(stageMs)} in stage` : <span title={`Arrived ${when(lead.created_at)}`}>{now ? age(lead.created_at, now) : ""}</span>)}
          </span>
        </span>
      </button>
      {lead.screening_warning && <span role="status" className="mx-3 mb-2.5 block rounded-md bg-[var(--warning-surface)] px-2 py-1 text-xs text-[var(--warning-ink)]">{lead.screening_warning}</span>}
    </article>
  );
}

/** Cards per board column before "Show more". */
const BOARD_PAGE = 10;

function PipelineBoard({ stages, leads, selectedId, readOnly, now, money, context, onSelect, onStageChange }: { stages: PipelineStage[]; leads: Lead[]; selectedId: string | null; readOnly: boolean; now: number; money: boolean; context: ViewContext | null; onSelect: (lead: Lead) => void; onStageChange: (lead: Lead, stage: string) => void }) {
  const [draggedId, setDraggedId] = useState<string | null>(null); const [dragOver, setDragOver] = useState<string | null>(null);
  // A column draws BOARD_PAGE cards and pages on with "Show more": a board is scrolled down a column,
  // so it grows in place rather than flipping pages, and a busy stage no longer draws every card at once.
  const [shown, setShown] = useState<Record<string, number>>({});
  const activeStages = stages.filter((stage) => !stage.is_archived).sort((a, b) => a.position - b.position);
  const live = new Set(activeStages.map((stage) => stage.id));
  // A lead on an archived stage, or a stage this pipeline no longer has, still gets a column — it
  // is never silently reassigned and never dropped off the board.
  const unmapped = leads.filter((lead) => !live.has(lead.stage_id));
  const columns: Column[] = [
    ...activeStages.map((stage) => ({ id: stage.id, name: stage.name, color: stage.color, stage })),
    ...(unmapped.length ? [{ id: UNMAPPED, name: "Unmapped", color: "var(--muted-foreground)", stage: null }] : []),
  ];
  return (
    <div className="flex min-w-0 gap-3 overflow-x-auto pb-1.5" style={{ height: "max(480px, calc(100dvh - var(--top-bar-h) - 244px))" }}>
      {columns.map((column) => {
        const columnLeads = column.id === UNMAPPED ? unmapped : leads.filter((lead) => lead.stage_id === column.id);
        const premium = columnLeads.reduce((sum, lead) => sum + (lead.monthly_premium_cents ?? 0), 0);
        // A stage no disposition lands on cannot be entered, so it does not accept a drop.
        const enterable = column.stage ? (context?.dispositionsByStage[column.id]?.length ?? 0) > 0 : false;
        const dropTarget = column.id !== UNMAPPED && !readOnly && (!context || enterable);
        const late = columnLeads.filter((lead) => isOverdue(lead, context, now)).length;
        const allowed = column.stage ? context?.stageRules[column.id]?.timeAllowedMinutes : null;
        return (
          <section
            key={column.id}
            aria-label={`${column.name}: ${columnLeads.length} ${columnLeads.length === 1 ? "lead" : "leads"}`}
            className={cn("m-glass flex min-h-0 min-w-[240px] flex-1 basis-0 flex-col overflow-hidden rounded-xl border border-t-[3px] border-border", dragOver === column.id && "border-[var(--primary)] bg-[var(--primary-soft)]")}
            style={{ borderTopColor: column.color }}
            onDragOver={(event) => { if (column.id === UNMAPPED || readOnly) return; event.preventDefault(); setDragOver(column.id); }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(event) => { event.preventDefault(); setDragOver(null); const lead = leads.find((item) => item.id === draggedId); setDraggedId(null); if (!lead || lead.stage_id === column.id) return; if (!dropTarget) { notify.block(`Map a disposition to ${column.name} in Settings › Dispositions to move leads there.`); return; } onStageChange(lead, column.id); }}
          >
            <header className="px-3 pt-3 pb-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">{column.name}</h3>
                <span className="text-sm font-semibold tabular-nums text-muted-foreground">{columnLeads.length.toLocaleString()}</span>
              </div>
              <div className={cn("mt-[3px] text-xs leading-normal tracking-[-0.01em] tabular-nums", late ? "font-semibold text-[var(--error-ink)]" : "text-muted-foreground")}>
                {column.id === UNMAPPED ? "stage retired or moved" : late ? `${late} past the ${durationLabel((allowed ?? 0) * 60_000)} allowed` : money ? `${premium > 0 ? compactAnnual(premium) : "—"} annualised` : `${columnLeads.length === 1 ? "1 lead" : `${columnLeads.length.toLocaleString()} leads`}`}
              </div>
            </header>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
              {/* Closed columns show their leads like every other column — no "Show closed" click first. */}
              {columnLeads.slice(0, shown[column.id] ?? BOARD_PAGE).map((lead) => <PipelineCard key={lead.id} lead={lead} selected={lead.id === selectedId} readOnly={readOnly} now={now} money={money} late={isOverdue(lead, context, now)} onSelect={() => onSelect(lead)} onDragStart={() => setDraggedId(lead.id)} />)}
              {columnLeads.length > (shown[column.id] ?? BOARD_PAGE) && (
                <div className="flex flex-col items-center gap-1.5 pt-1">
                  <span className="text-xs tabular-nums text-muted-foreground">Showing {(shown[column.id] ?? BOARD_PAGE).toLocaleString()} of {columnLeads.length.toLocaleString()}</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => setShown((state) => ({ ...state, [column.id]: (state[column.id] ?? BOARD_PAGE) + BOARD_PAGE }))}>Show {Math.min(BOARD_PAGE, columnLeads.length - (shown[column.id] ?? BOARD_PAGE))} more</Button>
                </div>
              )}
              {columnLeads.length === 0 && <div className="lead-column-empty">{readOnly ? "No leads here" : column.stage && context && !enterable ? "No disposition lands here" : "Drop a lead here"}</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function LeadPreviewPanel({ lead, stages, readOnly, onMove, onClose, onReconciled }: { lead: Lead; stages: PipelineStage[]; readOnly: boolean; onMove: () => void; onClose: () => void; onReconciled?: () => void }) {
  const [tab, setTab] = useState<"submission" | "timeline">("submission"); const [data, setData] = useState<LeadDetail | null>(null); const [error, setError] = useState("");
  // The selected lead changes the external request and resets the preview while it loads.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { let cancelled = false; setData(null); setError(""); void fetch(`/api/app/leads/${encodeURIComponent(lead.id)}`, { cache: "no-store" }).then(async (response) => ({ response, body: await response.json().catch(() => null) })).then(({ response, body }) => { if (cancelled) return; if (!response.ok) { setError(body?.error ?? "Could not load this lead"); return; } setData(body); }).catch(() => { if (!cancelled) setError("Could not load this lead"); }); return () => { cancelled = true; }; }, [lead.id, lead.stage_id]);
  const fieldEntries = data ? Object.entries(data.lead.values) : [];
  const liveStages = stages.filter((item) => !item.is_archived).sort((a, b) => a.position - b.position);
  // Split beside the board or table (DetailPanel), kept in view while the board scrolls.
  return <DetailPanel
    mode="split"
    title={leadName(lead)}
    subtitle={<>{data?.lead.product_line ?? productOf(lead)} · {data?.partner?.name ?? "Partner submission"}</>}
    onClose={onClose}
    bodyClassName="flex flex-col"
    className="lg:sticky lg:top-[calc(var(--top-bar-h)+1rem)] lg:max-h-[calc(100dvh-var(--top-bar-h)-2rem)] lg:min-h-[32rem] lg:self-start"
    footer={<Link href={`/app/leads/${lead.id}`} className="lead-full-link">Open full lead workspace <ExternalLink className="size-4" /></Link>}
  >
    {/* Moving a lead from the keyboard: the board's cards are drag-only, so the move lives here too —
        as a disposition, the same as a drop. */}
    <div className="flex items-center gap-2 border-b border-border px-4 py-2.5"><span className="text-xs text-muted-foreground">Stage</span><span className="flex-1 truncate text-sm font-semibold">{liveStages.find((item) => item.id === lead.stage_id)?.name ?? "Unmapped"}</span><Button type="button" variant="outline" size="sm" aria-label={`Move ${leadName(lead)} to stage`} disabled={readOnly} onClick={onMove}>Move</Button></div>
      {/* LA-3.23 · when the application has moved on but the card was held back by hand. */}
      <LeadStageHint leadId={lead.id} boardStageId={lead.stage_id} readOnly={readOnly} onReconciled={onReconciled} />
    <UnderlineTabs label="Lead preview" tabs={[{ key: "submission", label: "Submission" }, { key: "timeline", label: "Timeline" }]} value={tab} onChange={setTab} idPrefix="lead-preview-tab" controls="lead-preview-tabpanel" className="px-4" />{error ? <div className="lead-preview-state text-destructive">{error}</div> : !data ? <div className="flex-1"><SectionLoading rows={6} columns={2} label="Loading lead" /></div> : tab === "submission" ? <div key="submission" id="lead-preview-tabpanel" role="tabpanel" aria-labelledby="lead-preview-tab-submission" className="lead-preview-scroll"><div className="lead-preview-banner"><span className={`lead-stage-pill ${stageTone(data.stage ?? undefined)}`}>{data.stage?.name ?? "Open"}</span><span>{data.screening.outcome ?? "Screening pending"}</span></div><div className="lead-preview-section"><div className="lead-section-heading"><h3>Form as submitted</h3><span>Version {data.lead.definition_version}</span></div><div className="lead-form-snapshot">{fieldEntries.map(([key, value]) => <div key={key} className="lead-snapshot-row"><span>{data.template.fields.find((field) => field.field_key === key)?.label ?? key}</span><strong>{display(value)}</strong></div>)}</div></div><div className="lead-preview-section"><div className="lead-section-heading"><h3>Submission details</h3></div><dl className="lead-detail-list"><div><dt>Submitted</dt><dd>{when(data.lead.created_at)}</dd></div><div><dt>Submitted by</dt><dd>{data.submitter?.name ?? lead.submitter_name ?? "Workspace"}</dd></div><div><dt>Owner</dt><dd>{data.owner?.name ?? "Unclaimed"}</dd></div><div><dt>Queue status</dt><dd>{data.queue?.status ?? "Not queued"}</dd></div></dl></div></div> : <div key="timeline" id="lead-preview-tabpanel" role="tabpanel" aria-labelledby="lead-preview-tab-timeline" className="lead-preview-scroll"><div className="lead-preview-section"><div className="lead-section-heading"><h3>Submission timeline</h3></div><div className="lead-timeline">{data.timeline.length ? data.timeline.map((event) => <div key={event.id} className="lead-timeline-item"><span className="lead-timeline-dot" /><div><strong>{event.label}</strong><p>{event.detail ?? event.actor}</p><time>{when(event.at)}</time></div></div>) : <p className="text-sm text-muted-foreground">No timeline events yet.</p>}</div></div></div>}</DetailPanel>;
}

const VIEW_LABEL = { stages: "Stages", board: "Board", table: "Table", list: "List" } as const;

export function LeadWorkspace() {
  const [data, setData] = useState<PageData | null>(null); const [error, setError] = useState(""); const [search, setSearch] = useState(""); const [query, setQuery] = useState(""); const [view, setView] = useState<"stages" | "board" | "table" | "list">("board"); const [selected, setSelected] = useState<Lead | null>(null); const [moreFilters, setMoreFilters] = useState(false); const [product, setProduct] = useState(""); const [stageFilter, setStageFilter] = useState(""); const [submitter, setSubmitter] = useState(""); const [outcome, setOutcome] = useState(""); const [fromDate, setFromDate] = useState(""); const [toDate, setToDate] = useState("");
  const [pipelineId, setPipelineId] = useState(""); const [adding, setAdding] = useState(false); const [refreshing, setRefreshing] = useState(false);
  // Ages and "today" are measured against the moment the data arrived, read in the browser.
  const [now, setNow] = useState(0);
  // Stage rules, the dispositions that land on each stage, unmapped outcomes: the pipeline views'
  // context, read alongside the leads.
  const [context, setContext] = useState<ViewContext | null>(null);
  // The disposition picker: which leads are moving, and to which stage when a drop named one.
  const [picker, setPicker] = useState<{ leads: Lead[]; stageId: string | null; source: "board" | "table" | "list" } | null>(null);
  const [moving, setMoving] = useState(false);
  // A bulk move from the Table waits here, after the disposition is picked, until it is confirmed.
  const [confirmMove, setConfirmMove] = useState<{ leadIds: string[]; key: string; label: string; where: string } | null>(null);
  // The Table's scope (All, Assigned to me, Unassigned, Overdue in stage), set from Saved views.
  const [tableScope, setTableScope] = useState<TableScope>("all");
  const loadContext = useCallback(async () => { const response = await fetch("/api/app/leads/pipeline-context", { cache: "no-store" }); const body = await response.json().catch(() => null); if (response.ok) setContext(body); }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadContext(); }, [loadContext]);
  const load = useCallback(async (nextQuery: string) => { const response = await fetch(`/api/app/leads${nextQuery ? `?${nextQuery}` : ""}`, { cache: "no-store" }); const body = await response.json().catch(() => null); if (!response.ok) { setError(body?.error ?? "Could not load leads"); return; } setError(""); setData(body); setNow(Date.now()); setSelected((current) => (current ? (body.leads ?? []).find((lead: Lead) => lead.id === current.id) ?? null : null)); }, []);
  // This client effect intentionally hydrates the interactive workspace from the authenticated API.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(""); }, [load]);
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
  async function refresh() { setRefreshing(true); try { await Promise.all([load(query), loadContext()]); } finally { setRefreshing(false); } }
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
  function updateStage(lead: Lead, nextStage: string) { if (!nextStage || nextStage === lead.stage_id) return; setPicker({ leads: [lead], stageId: nextStage, source: "board" }); }
  async function moveLeads(leadIds: string[], key: string, source: "board" | "table" | "list"): Promise<boolean> {
    setMoving(true);
    try {
      const response = await fetch("/api/app/leads/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lead_ids: leadIds, disposition_key: key, source }) });
      const body = await response.json().catch(() => null);
      const moved = body?.moved?.length ?? 0;
      const failed = body?.failed?.length ?? 0;
      if (!response.ok && !moved) { notify.block(body?.error ?? "Could not move the lead"); return false; }
      if (failed || response.status === 207) notify.block(`${moved} of ${leadIds.length} moved${body?.error ? ` — ${body.error}` : ""}`);
      else notify.done(moved === 1 ? "Lead moved" : `${moved} leads moved`);
      await Promise.all([load(query), loadContext()]);
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
    { id: "mine", name: "Assigned to me", state: { pipeline: pipelineKey, scope: "mine" }, count: scopeCounts.mine, disabled: !data.currentUserId },
    { id: "unassigned", name: "Unassigned", state: { pipeline: pipelineKey, scope: "unassigned" }, count: scopeCounts.unassigned },
    { id: "overdue", name: "Overdue in stage", state: { pipeline: pipelineKey, scope: "overdue" }, count: scopeCounts.overdue, disabled: !context?.schemaReady, title: !context?.schemaReady ? "Needs time allowed per stage (database update 20260925100000)" : undefined },
  ];

  return (
    <div className="m-stagger lead-workspace-page flex flex-col gap-6">
      <PageHeader
        title="Leads"
        description="Every lead by stage. Drag a card to record the outcome that moves it."
        actions={
          <>
            {data.template.latest && <Button type="button" variant="outline" onClick={async () => { const response = await fetch("/api/app/templates/assignment", { method: "POST" }); if (!response.ok) notify.block("Could not update the template"); else { notify.done("Template updated"); void load(query); } }}>Update template</Button>}
            <Button asChild variant="outline"><a href={`/api/app/leads/export${exportParams}`}>Export CSV</a></Button>
            <Button type="button" disabled={data.readOnly || formStages.length === 0} onClick={() => setAdding(true)}>Add lead</Button>
          </>
        }
      />

      {error && <p role="alert" className="rounded-lg border border-[var(--error)]/30 bg-[var(--error-surface)] px-4 py-2.5 text-sm text-[var(--error-ink)]">{error}</p>}

      {/* Leads A1 (2026-10-25): one pipeline at a time, its tabs under the title. */}
      {pipelines.length > 0 && (
        <UnderlineTabs label="Pipeline" tabs={pipelines.map((item) => ({ key: item.id, label: item.name, count: countFor(item.id) }))} value={activePipeline?.id ?? ""} onChange={selectPipeline} className="-mt-2" />
      )}

      {/* The board or table, with the lead preview split beside it from lg (DetailPanel). On the board
          the card itself steps back, so the glass columns sit on the page as in the mockup. */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <TableCard
          // Full height in every view: the card reaches the bottom of the window even when a view is short.
          className={cn("min-w-0 flex-1 min-h-[calc(100dvh-var(--top-bar-h)-121px)]", view === "board" && "border-transparent bg-transparent shadow-none")}
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
          <div className={view === "board" ? "pt-3" : undefined}>
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
        {selected && (view === "board" || view === "table") && <LeadPreviewPanel lead={selected} stages={selectedStages} readOnly={data.readOnly} onMove={() => setPicker({ leads: [selected], stageId: null, source: "board" })} onClose={() => setSelected(null)} onReconciled={() => void refresh()} />}
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

      <LeadFormDialog open={adding} onOpenChange={setAdding} template={template} stages={formStages} readOnly={data.readOnly} onCreated={() => void load(query)} />
    </div>
  );
}
