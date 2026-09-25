"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink, Search, SlidersHorizontal, X } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { sectionForPath } from "@/lib/menu/definition";
import { DispositionLibrary, PipelineCreateDialog, PipelineStageManager } from "@/components/app/pipeline-stage-manager";
import type { TemplateField, TemplateRow } from "@/lib/templates/constants";
import type { PipelineStage } from "@/lib/pipelines/types";
import { pruneHiddenTemplateValues, templateFormFieldVisible } from "@/lib/templates/visibility";
import { cn } from "@/lib/utils";
import { DispositionPicker, ListView, StagesView, TableView, dispositionGroups, durationLabel, inStageMs, isOverdue, type ViewContext } from "@/components/app/pipeline-views";

type Lead = { id: string; pipeline_id: string; stage_id: string; values: Record<string, unknown>; screening_outcome?: string | null; screening_warning?: string | null; created_at: string; updated_at: string; submitter_name?: string | null; owner_user_id?: string | null; owner_name?: string | null; disposition?: string | null; disposition_at?: string | null; stage_entered_at?: string | null; monthly_premium_cents?: number | null };
type Pipeline = { id: string; name: string; partner_type: string; stages: PipelineStage[] };
type PageData = { template: { assignment: { template_version: number }; template: TemplateRow; latest: { version: number; name: string } | null }; pipelines: Pipeline[]; leads: Lead[]; role?: string; currentUserId?: string; money?: boolean; readOnly: boolean };
type LeadDetail = { lead: Lead & { product_line: string; definition_version: number }; template: TemplateRow; queue: { status: string; owner_user_id: string | null; claimed_at: string | null; disposition: string | null } | null; partner: { name: string; partner_type: string } | null; stage: PipelineStage | null; submitter: { name: string } | null; owner: { name: string } | null; screening: { outcome: string | null; warning: string | null }; timeline: Array<{ id: string; label: string; at: string; actor: string; detail: string | null }>; readOnly: boolean };

/** The combined view. A sentinel rather than a pipeline id, because it is not one. */
const ALL = "all";
/** The pipeline menu's "New pipeline…" entry. Not a pipeline either. */
const NEW_PIPELINE = "__new";
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
    <article draggable={!readOnly} onDragStart={onDragStart} className={cn("m-card w-full shrink-0 overflow-hidden rounded-lg border border-border bg-card", !readOnly && "cursor-grab active:cursor-grabbing", late && "border-l-[3px] border-l-[var(--error)]", selected && "border-[var(--primary)] shadow-[var(--shadow-hover)]")}>
      <button type="button" onClick={onSelect} className="block w-full px-3 py-2.5 text-left" title={readOnly ? undefined : "Open to see the lead, or drag it to another stage — you will be asked which disposition"}>
        <span className="block truncate text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">{leadName(lead)}</span>
        <span className={cn("mt-[3px] block truncate text-xs leading-normal tracking-[-0.01em] tabular-nums", late ? "font-semibold text-[var(--error-ink)]" : "text-muted-foreground")}>
          {lead.submitter_name ?? "Workspace"} · {premium ?? (stageMs != null ? `${durationLabel(stageMs)} in stage` : <span title={`Arrived ${when(lead.created_at)}`}>{now ? age(lead.created_at, now) : ""}</span>)}
        </span>
        {lead.screening_warning && <span role="status" className="mt-2 block rounded-md bg-[var(--warning-surface)] px-2 py-1 text-xs text-[var(--warning-ink)]">{lead.screening_warning}</span>}
      </button>
    </article>
  );
}

function PipelineBoard({ stages, leads, selectedId, readOnly, now, money, context, onSelect, onStageChange, onManageStages }: { stages: PipelineStage[]; leads: Lead[]; selectedId: string | null; readOnly: boolean; now: number; money: boolean; context: ViewContext | null; onSelect: (lead: Lead) => void; onStageChange: (lead: Lead, stage: string) => void; onManageStages: (() => void) | null }) {
  const [draggedId, setDraggedId] = useState<string | null>(null); const [dragOver, setDragOver] = useState<string | null>(null);
  // A terminal "closed" column is history, not work: collapsed until asked for.
  const [openTerminal, setOpenTerminal] = useState<Record<string, boolean>>({});
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
    <div className="flex min-w-0 gap-3 overflow-x-auto pb-1.5" style={{ height: "max(480px, calc(100vh - 360px))" }}>
      {columns.map((column) => {
        const columnLeads = column.id === UNMAPPED ? unmapped : leads.filter((lead) => lead.stage_id === column.id);
        const premium = columnLeads.reduce((sum, lead) => sum + (lead.monthly_premium_cents ?? 0), 0);
        // A stage no disposition lands on cannot be entered, so it does not accept a drop.
        const enterable = column.stage ? (context?.dispositionsByStage[column.id]?.length ?? 0) > 0 : false;
        const dropTarget = column.id !== UNMAPPED && !readOnly && (!context || enterable);
        const late = columnLeads.filter((lead) => isOverdue(lead, context, now)).length;
        const allowed = column.stage ? context?.stageRules[column.id]?.timeAllowedMinutes : null;
        const collapsed = column.stage?.stage_type === "lost" && !openTerminal[column.id] && columnLeads.length > 0;
        return (
          <section
            key={column.id}
            aria-label={`${column.name}: ${columnLeads.length} ${columnLeads.length === 1 ? "lead" : "leads"}`}
            className={cn("flex min-h-0 min-w-[220px] flex-1 basis-0 flex-col overflow-hidden rounded-lg border border-border bg-[var(--surface-alt)]", dragOver === column.id && "border-[var(--primary)] bg-[var(--soft-orange-surface)]")}
            onDragOver={(event) => { if (column.id === UNMAPPED || readOnly) return; event.preventDefault(); setDragOver(column.id); }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(event) => { event.preventDefault(); setDragOver(null); const lead = leads.find((item) => item.id === draggedId); setDraggedId(null); if (!lead || lead.stage_id === column.id) return; if (!dropTarget) { notify.block(`No disposition lands on ${column.name}, so a lead cannot be moved there. An owner maps one under Settings › Dispositions.`); return; } onStageChange(lead, column.id); }}
          >
            <header className="border-b-2 bg-card p-3" style={{ borderBottomColor: column.color }}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">{column.name}</h3>
                <span className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold tabular-nums text-muted-foreground">{columnLeads.length.toLocaleString()}</span>
                  {onManageStages && column.stage && <button type="button" aria-label={`Edit the stages on this board`} title="Edit stages" className="rounded px-1 text-xs tracking-[0.08em] text-muted-foreground hover:text-foreground" onClick={onManageStages}>•••</button>}
                </span>
              </div>
              <div className={cn("mt-[3px] text-xs leading-normal tracking-[-0.01em] tabular-nums", late ? "font-semibold text-[var(--error-ink)]" : "text-muted-foreground")}>
                {column.id === UNMAPPED ? "stage retired or moved" : late ? `${late} past the ${durationLabel((allowed ?? 0) * 60_000)} allowed` : money ? `${premium > 0 ? compactAnnual(premium) : "—"} annualised` : `${columnLeads.length === 1 ? "1 lead" : `${columnLeads.length.toLocaleString()} leads`}`}
              </div>
            </header>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
              {collapsed ? (
                <div className="flex flex-col gap-2 p-1 text-xs text-muted-foreground">
                  <p>Closed leads are history, not work, so this column starts collapsed.</p>
                  <Button type="button" variant="outline" size="sm" className="h-8 border-[var(--border-strong)]" onClick={() => setOpenTerminal((state) => ({ ...state, [column.id]: true }))}>Show the {columnLeads.length.toLocaleString()}</Button>
                </div>
              ) : columnLeads.map((lead) => <PipelineCard key={lead.id} lead={lead} selected={lead.id === selectedId} readOnly={readOnly} now={now} money={money} late={isOverdue(lead, context, now)} onSelect={() => onSelect(lead)} onDragStart={() => setDraggedId(lead.id)} />)}
              {columnLeads.length === 0 && <div className="lead-column-empty">{readOnly ? "No leads here" : column.stage && context && !enterable ? "No disposition lands here" : "Drop to move here — you will be asked which disposition"}</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function LeadPreviewPanel({ lead, stages, readOnly, onMove, onClose }: { lead: Lead; stages: PipelineStage[]; readOnly: boolean; onMove: () => void; onClose: () => void }) {
  const [tab, setTab] = useState<"submission" | "timeline">("submission"); const [data, setData] = useState<LeadDetail | null>(null); const [error, setError] = useState("");
  // The selected lead changes the external request and resets the preview while it loads.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { let cancelled = false; setData(null); setError(""); void fetch(`/api/app/leads/${encodeURIComponent(lead.id)}`, { cache: "no-store" }).then(async (response) => ({ response, body: await response.json().catch(() => null) })).then(({ response, body }) => { if (cancelled) return; if (!response.ok) { setError(body?.error ?? "Could not load this lead"); return; } setData(body); }).catch(() => { if (!cancelled) setError("Could not load this lead"); }); return () => { cancelled = true; }; }, [lead.id, lead.stage_id]);
  const fieldEntries = data ? Object.entries(data.lead.values) : [];
  const liveStages = stages.filter((item) => !item.is_archived).sort((a, b) => a.position - b.position);
  return <aside className="lead-preview-panel"><div className="lead-preview-header"><div><span className="eyebrow">LEAD PREVIEW</span><h2>{leadName(lead)}</h2><p>{data?.lead.product_line ?? productOf(lead)} · {data?.partner?.name ?? "Partner submission"}</p></div><button type="button" className="lead-preview-close" aria-label="Close lead preview" onClick={onClose}><X className="size-5" /></button></div>
    {/* Moving a lead from the keyboard: the board's cards are drag-only, so the move lives here too —
        as a disposition, the same as a drop. */}
    <div className="flex items-center gap-2 border-b border-border px-4 py-2.5"><span className="text-xs text-muted-foreground">Stage</span><span className="flex-1 truncate text-sm font-semibold">{liveStages.find((item) => item.id === lead.stage_id)?.name ?? "Unmapped"}</span><Button type="button" variant="outline" size="sm" className="h-8 border-[var(--border-strong)] px-3" aria-label={`Move ${leadName(lead)} to stage`} disabled={readOnly} onClick={onMove}>Move</Button></div>
    <div className="lead-preview-tabs"><button type="button" className={tab === "submission" ? "is-active" : ""} onClick={() => setTab("submission")}>Submission</button><button type="button" className={tab === "timeline" ? "is-active" : ""} onClick={() => setTab("timeline")}>Timeline</button></div>{error ? <div className="lead-preview-state text-destructive">{error}</div> : !data ? <div className="lead-preview-state">Loading lead detail…</div> : tab === "submission" ? <div className="lead-preview-scroll"><div className="lead-preview-banner"><span className={`lead-stage-pill ${stageTone(data.stage ?? undefined)}`}>{data.stage?.name ?? "Open"}</span><span>{data.screening.outcome ?? "Screening pending"}</span></div><div className="lead-preview-section"><div className="lead-section-heading"><h3>Form as submitted</h3><span>Version {data.lead.definition_version}</span></div><div className="lead-form-snapshot">{fieldEntries.map(([key, value]) => <div key={key} className="lead-snapshot-row"><span>{data.template.fields.find((field) => field.field_key === key)?.label ?? key}</span><strong>{display(value)}</strong></div>)}</div></div><div className="lead-preview-section"><div className="lead-section-heading"><h3>Submission details</h3></div><dl className="lead-detail-list"><div><dt>Submitted</dt><dd>{when(data.lead.created_at)}</dd></div><div><dt>Submitted by</dt><dd>{data.submitter?.name ?? lead.submitter_name ?? "Workspace"}</dd></div><div><dt>Owner</dt><dd>{data.owner?.name ?? "Unclaimed"}</dd></div><div><dt>Queue status</dt><dd>{data.queue?.status ?? "Not queued"}</dd></div></dl></div></div> : <div className="lead-preview-scroll"><div className="lead-preview-section"><div className="lead-section-heading"><h3>Submission timeline</h3></div><div className="lead-timeline">{data.timeline.length ? data.timeline.map((event) => <div key={event.id} className="lead-timeline-item"><span className="lead-timeline-dot" /><div><strong>{event.label}</strong><p>{event.detail ?? event.actor}</p><time>{when(event.at)}</time></div></div>) : <p className="text-sm text-muted-foreground">No timeline events yet.</p>}</div></div></div>}<div className="lead-preview-footer"><Link href={`/app/leads/${lead.id}`} className="lead-full-link">Open full lead workspace <ExternalLink className="size-4" /></Link></div></aside>;
}

const VIEW_LABEL = { stages: "Stages", board: "Board", table: "Table", list: "List" } as const;

const barButton = "inline-flex h-10 items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-card px-3.5 text-sm font-semibold leading-[1.43] tracking-[-0.01em] text-foreground";

export function LeadWorkspace() {
  const [data, setData] = useState<PageData | null>(null); const [error, setError] = useState(""); const [search, setSearch] = useState(""); const [query, setQuery] = useState(""); const [view, setView] = useState<"stages" | "board" | "table" | "list">("board"); const [selected, setSelected] = useState<Lead | null>(null); const [moreFilters, setMoreFilters] = useState(false); const [product, setProduct] = useState(""); const [stageFilter, setStageFilter] = useState(""); const [submitter, setSubmitter] = useState(""); const [outcome, setOutcome] = useState(""); const [fromDate, setFromDate] = useState(""); const [toDate, setToDate] = useState("");
  const [pipelineId, setPipelineId] = useState(""); const [managingStages, setManagingStages] = useState(false); const [creatingPipeline, setCreatingPipeline] = useState(false); const [libraryOpen, setLibraryOpen] = useState(false); const [adding, setAdding] = useState(false);
  // Ages and "today" are measured against the moment the data arrived, read in the browser.
  const [now, setNow] = useState(0);
  // Stage rules, the dispositions that land on each stage, unmapped outcomes: the pipeline views'
  // context, read alongside the leads.
  const [context, setContext] = useState<ViewContext | null>(null);
  // The disposition picker: which leads are moving, and to which stage when a drop named one.
  const [picker, setPicker] = useState<{ leads: Lead[]; stageId: string | null; source: "board" | "table" | "list" } | null>(null);
  const [moving, setMoving] = useState(false);
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
  // `all` is a view, not a pipeline. Every pipeline has its own stage vocabulary — five here with
  // 12, 0, 2, 7 and 5 stages — so there is no honest single set of columns across them. Rather than
  // invent one, All shows the combined list in the table and stacks a section per pipeline on the
  // board. Everything downstream branches on `isAll` rather than on a fake pipeline object.
  const isAll = pipelineId === ALL;
  const activePipeline = useMemo(() => (isAll ? undefined : pipelines.find((item) => item.id === pipelineId) ?? pipelines.find((item) => item.partner_type === "marketing") ?? pipelines[0]), [pipelines, pipelineId, isAll]);
  const allStages = useMemo(() => activePipeline?.stages ?? [], [activePipeline]);
  // A lead is filed into exactly one pipeline, so the new-lead form needs one even in the All view,
  // where no single pipeline is on screen. It falls back to the same default the board picks.
  const formPipeline = useMemo(() => activePipeline ?? pipelines.find((item) => item.partner_type === "marketing") ?? pipelines[0], [activePipeline, pipelines]);
  const formStages = useMemo(() => { const stages = formPipeline?.stages ?? []; const live = stages.filter((stage) => !stage.is_archived); return live.length ? live : stages; }, [formPipeline]);
  const leadsInPipeline = useMemo(() => (data?.leads ?? []).filter((lead) => isAll || !activePipeline || lead.pipeline_id === activePipeline.id), [data, activePipeline, isAll]);
  const countFor = useCallback((id: string) => (data?.leads ?? []).filter((lead) => lead.pipeline_id === id).length, [data]);
  // One lookup across every pipeline, so the table and stage filter can resolve a
  // stage id without knowing which board it came from.
  const stageIndex = useMemo(() => { const map = new Map<string, { stage: PipelineStage; pipelineName: string }>(); for (const pipeline of pipelines) for (const stage of pipeline.stages) map.set(stage.id, { stage, pipelineName: pipeline.name }); return map; }, [pipelines]);
  // Every stage by name and pipeline, and where leads sit now: for the stage manager's counts, its
  // "past the time allowed" preview, and naming the stage a disposition would be moved from.
  const stageList = useMemo(() => [...stageIndex.values()].map((entry) => ({ id: entry.stage.id, name: entry.stage.name, pipelineName: entry.pipelineName })), [stageIndex]);
  const stageLeads = useMemo(() => {
    const counts: Record<string, number> = {}; const entries: Record<string, Array<string | null>> = {};
    for (const lead of data?.leads ?? []) { counts[lead.stage_id] = (counts[lead.stage_id] ?? 0) + 1; (entries[lead.stage_id] ??= []).push(lead.stage_entered_at ?? null); }
    return { counts, entries };
  }, [data]);
  const filterStages = useMemo(() => (isAll ? [...stageIndex.values()].filter((entry) => !entry.stage.is_archived) : allStages.filter((stage) => !stage.is_archived).map((stage) => ({ stage, pipelineName: "" }))), [isAll, stageIndex, allStages]);
  const isOwner = data?.role === "owner";
  // Scoped to the pipeline on screen, so the filter menus never offer a value that would return
  // nothing here.
  const submitters = useMemo(() => [...new Set(leadsInPipeline.map((lead) => lead.submitter_name ?? "Workspace"))].sort(), [leadsInPipeline]); const products = useMemo(() => [...new Set(leadsInPipeline.map(productOf))].sort(), [leadsInPipeline]);
  const visibleLeads = useMemo(() => leadsInPipeline.filter((lead) => (!product || productOf(lead) === product) && (!stageFilter || lead.stage_id === stageFilter) && (!submitter || (lead.submitter_name ?? "Workspace") === submitter) && (!outcome || String(lead.screening_outcome ?? "Pending") === outcome) && (!fromDate || lead.created_at.slice(0, 10) >= fromDate) && (!toDate || lead.created_at.slice(0, 10) <= toDate)), [leadsInPipeline, product, stageFilter, submitter, outcome, fromDate, toDate]);
  const activeFilters = [product, stageFilter, submitter, outcome, fromDate, toDate].filter(Boolean).length;
  function applySearch(event: React.FormEvent) { event.preventDefault(); const params = new URLSearchParams(); if (search.trim()) params.set("q", search.trim()); const next = params.toString(); setQuery(next); void load(next); }
  function resetFilters() { setSearch(""); setQuery(""); setProduct(""); setStageFilter(""); setSubmitter(""); setOutcome(""); setFromDate(""); setToDate(""); void load(""); }
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
  if (error) return <Card><CardContent className="p-6"><p className="text-sm text-destructive">{error}</p><Button className="mt-4" variant="outline" onClick={() => void load(query)}>Try again</Button></CardContent></Card>;
  if (!data || !template) return <p className="text-sm text-muted-foreground">Loading your lead workspace…</p>;
  const exportParams = query ? `?${query}` : "";
  const toggle = (lead: Lead) => setSelected((current) => (current?.id === lead.id ? null : lead));
  const selectedStages = selected ? pipelines.find((item) => item.id === selected.pipeline_id)?.stages ?? [] : [];

  return (
    <div className={cn("m-stagger lead-workspace-page flex flex-col gap-6", selected && "has-preview")}>
      <PageHeader
        eyebrow={sectionForPath("/app/leads") ?? undefined}
        title="Lead workspace"
        description="Board for moving stages, table for scanning and export. One page, one filter set."
        actions={
          <>
            {data.template.latest && <Button variant="outline" className="h-11 border-[var(--border-strong)] px-4" onClick={async () => { const response = await fetch("/api/app/templates/assignment", { method: "POST" }); if (!response.ok) notify.block("Could not update the template"); else { notify.done("Template updated"); void load(query); } }}>Update template</Button>}
            <Button asChild variant="outline" className="h-11 border-[var(--border-strong)] px-4"><a href={`/api/app/leads/export${exportParams}`}>Export CSV</a></Button>
            <Button type="button" className="h-11 px-4" disabled={data.readOnly || formStages.length === 0} onClick={() => setAdding(true)}>Add lead</Button>
          </>
        }
      />

      <div className="flex flex-col gap-2.5">
        <form onSubmit={applySearch} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-[0_1px_2px_rgba(16,20,26,.05)]">
          {pipelines.length > 0 && (
            <span className="relative inline-flex items-center">
              <select
                aria-label="Pipeline"
                value={isAll ? ALL : activePipeline?.id ?? ""}
                onChange={(event) => { if (event.target.value === NEW_PIPELINE) { setCreatingPipeline(true); return; } selectPipeline(event.target.value); }}
                className={cn(barButton, "appearance-none pr-9")}
              >
                <option value={ALL}>All pipelines ({data.leads.length})</option>
                {pipelines.map((item) => <option key={item.id} value={item.id}>{item.name} ({countFor(item.id)})</option>)}
                {isOwner && <option value={NEW_PIPELINE}>New pipeline…</option>}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 size-4 text-muted-foreground" aria-hidden="true" />
            </span>
          )}
          <span className="relative flex h-10 w-full items-center sm:w-[248px]">
            <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" aria-hidden="true" />
            <input type="search" aria-label="Search name, phone, policy" placeholder="Search name, phone, policy" value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 w-full rounded-lg border border-[var(--border-strong)] bg-card pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground" />
          </span>
          <button type="button" aria-expanded={moreFilters} onClick={() => setMoreFilters((value) => !value)} className={barButton}>
            <SlidersHorizontal className="size-4" aria-hidden="true" />Filters
            {activeFilters > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--surface-alt)] px-1.5 text-xs font-semibold tabular-nums">{activeFilters}</span>}
          </button>
          <span className="hidden flex-grow sm:block" />
          <span role="group" aria-label="View" className="inline-flex gap-[3px] rounded-lg bg-[var(--surface-alt)] p-[3px]">
            {/* Four views of the same leads and the same filters. */}
            {(["stages", "board", "table", "list"] as const).map((option) => (
              <button key={option} type="button" aria-pressed={view === option} onClick={() => { setView(option); if (option === "stages" || option === "list") setSelected(null); }} className={cn("inline-flex h-8 items-center rounded-lg border px-[13px] text-sm font-semibold leading-[1.43] tracking-[-0.01em]", view === option ? "border-border bg-card text-foreground" : "border-transparent text-muted-foreground")}>{VIEW_LABEL[option]}</button>
            ))}
          </span>
          <button type="button" onClick={resetFilters} className={cn(barButton, "px-4")}>Reset</button>
          {/* Enter searches; the button is for the mouse and for screen readers that announce the form. */}
          <button type="submit" className="sr-only">Search</button>
        </form>

        {moreFilters && <div className="lead-more-filters rounded-lg border border-border bg-card p-4"><div><Label>Product</Label><select value={product} onChange={(event) => setProduct(event.target.value)}><option value="">All products</option>{products.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><div><Label>Stage</Label><select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}><option value="">All stages</option>{filterStages.map((entry) => <option key={entry.stage.id} value={entry.stage.id}>{entry.pipelineName ? `${entry.pipelineName} · ${entry.stage.name}` : entry.stage.name}</option>)}</select></div><div><Label>Submitted by</Label><select value={submitter} onChange={(event) => setSubmitter(event.target.value)}><option value="">Everyone</option>{submitters.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><div><Label>Outcome</Label><select value={outcome} onChange={(event) => setOutcome(event.target.value)}><option value="">Any outcome</option><option value="clear">Clear</option><option value="blocked">Blocked</option></select></div><div><Label>From</Label><Input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></div><div><Label>To</Label><Input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></div></div>}
      </div>

      {view === "stages" && (
        <StagesView
          pipelines={isAll ? pipelines : activePipeline ? [activePipeline] : []}
          leads={visibleLeads}
          context={context}
          isOwner={isOwner}
          now={now}
          onEditStages={isOwner ? (id) => { selectPipeline(id); setManagingStages(true); } : null}
          onOpenLibrary={isOwner ? () => setLibraryOpen(true) : null}
          onNewPipeline={isOwner ? () => setCreatingPipeline(true) : null}
        />
      )}
      {view === "list" && (
        <ListView
          pipelines={isAll ? pipelines : activePipeline ? [activePipeline] : []}
          leads={visibleLeads}
          context={context}
          now={now}
          readOnly={data.readOnly}
          onMove={(lead, key) => moveLeads([lead.id], key, "list")}
        />
      )}
      <div className={cn("lead-workspace-grid", (view === "stages" || view === "list") && "hidden")}>
        {view === "board" ? (
          isAll ? (
            <div className="flex flex-col gap-6">
              {pipelines.filter((item) => visibleLeads.some((lead) => lead.pipeline_id === item.id)).map((item) => {
                const owned = visibleLeads.filter((lead) => lead.pipeline_id === item.id);
                return (
                  <section key={item.id} className="flex flex-col gap-2">
                    <header className="flex items-baseline gap-2"><h2 className="text-sm font-semibold">{item.name}</h2><span className="text-xs text-muted-foreground">{owned.length} {owned.length === 1 ? "lead" : "leads"}</span></header>
                    <PipelineBoard stages={item.stages} leads={owned} selectedId={selected?.id ?? null} readOnly={data.readOnly} now={now} money={money} context={context} onSelect={toggle} onStageChange={updateStage} onManageStages={isOwner ? () => { selectPipeline(item.id); setManagingStages(true); } : null} />
                  </section>
                );
              })}
              {visibleLeads.length === 0 && <div className="lead-column-empty">No leads match these filters.</div>}
            </div>
          ) : (
            <PipelineBoard stages={allStages} leads={visibleLeads} selectedId={selected?.id ?? null} readOnly={data.readOnly} now={now} money={money} context={context} onSelect={toggle} onStageChange={updateStage} onManageStages={isOwner && activePipeline ? () => setManagingStages(true) : null} />
          )
        ) : view === "table" ? (
          <TableView
            leads={visibleLeads}
            // Resolved through the cross-pipeline stage index: in the All view there is no active
            // board, and a lead's stage belongs to whichever pipeline it is in.
            stageName={(stageId) => { const entry = stageIndex.get(stageId); return { name: entry && !entry.stage.is_archived ? entry.stage.name : "Unmapped", color: entry?.stage.color ?? "var(--muted-foreground)", pipeline: entry?.pipelineName ?? "" }; }}
            context={context}
            now={now}
            money={money}
            currentUserId={data.currentUserId ?? null}
            readOnly={data.readOnly}
            onOpen={(lead) => setSelected(lead as Lead)}
            onBulkMove={(leadIds) => setPicker({ leads: visibleLeads.filter((lead) => leadIds.includes(lead.id)), stageId: null, source: "table" })}
          />
        ) : null}
        {selected && (view === "board" || view === "table") && <LeadPreviewPanel lead={selected} stages={selectedStages} readOnly={data.readOnly} onMove={() => setPicker({ leads: [selected], stageId: null, source: "board" })} onClose={() => setSelected(null)} />}
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
            description={picker.stageId ? `Which disposition sends ${picker.leads.length === 1 ? "this lead" : "them"} to ${target?.name ?? "that stage"}?` : "Pick the outcome. Each lead goes to the stage that outcome belongs to."}
            groups={groups}
            busy={moving}
            emptyText={picker.stageId ? undefined : "No disposition is mapped to any stage of this pipeline yet, so its leads cannot be moved from here. An owner maps them under Settings › Pipelines."}
            onPick={async (key) => { const ok = await moveLeads(picker.leads.map((lead) => lead.id), key, picker.source); if (ok) setPicker(null); }}
          />
        );
      })()}

      <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-4 py-3.5 text-sm leading-normal tracking-[-0.02em]">
        <p className="font-semibold text-[var(--info-ink)]">An unknown stage never disappears</p>
        <p className="mt-1.5 text-[var(--body)]">If the pipeline template changes, leads on a retired stage collect in a visible <strong>unmapped</strong> column rather than being silently reassigned. A half-typed new lead survives a reload through the draft autosave.</p>
      </div>

      <LeadFormDialog open={adding} onOpenChange={setAdding} template={template} stages={formStages} readOnly={data.readOnly} onCreated={() => void load(query)} />
      {isOwner && activePipeline && <PipelineStageManager open={managingStages} onOpenChange={setManagingStages} pipelineId={activePipeline.id} pipelineName={activePipeline.name} stages={allStages} leadCounts={stageLeads.counts} stageEntries={stageLeads.entries} context={context} allStages={stageList} onChanged={() => { void load(query); void loadContext(); }} />}
      {isOwner && <PipelineCreateDialog open={creatingPipeline} onOpenChange={setCreatingPipeline} pipelines={pipelines} context={context} onCreated={(id) => { if (id) selectPipeline(id); void load(query); void loadContext(); }} />}
      {isOwner && <DispositionLibrary open={libraryOpen} onOpenChange={setLibraryOpen} pipelines={pipelines} context={context} onChanged={() => void loadContext()} />}
    </div>
  );
}
