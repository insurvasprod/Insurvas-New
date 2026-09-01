"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TemplateField, TemplateFormField, TemplateRow, TemplateStage } from "@/lib/templates/constants";

type Lead = { id: string; stage_key: string; values: Record<string, unknown>; screening_outcome?: string | null; screening_warning?: string | null; screening_checked_at?: string | null; created_at: string; updated_at: string };
type PageData = { template: { assignment: { template_version: number }; template: TemplateRow; latest: { version: number; name: string } | null }; leads: Lead[]; readOnly: boolean };

function visible(field: TemplateFormField, values: Record<string, unknown>) {
  const condition = field.show_when ?? field.conditional_on;
  if (!condition) return true;
  const value = values[condition.field_key];
  return Array.isArray(value) ? value.includes(condition.equals) : String(value ?? "") === condition.equals;
}

function FieldInput({ field, value, onChange }: { field: TemplateField; value: unknown; onChange: (value: unknown) => void }) {
  if (field.type === "boolean") return <select aria-label={field.label} className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={value === undefined ? "" : String(value)} onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value === "true")}><option value="">Choose…</option><option value="true">Yes</option><option value="false">No</option></select>;
  if (field.type === "single_select") return <select aria-label={field.label} className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={String(value ?? "")} onChange={(event) => onChange(event.target.value || undefined)}><option value="">Choose…</option>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
  if (field.type === "multi_select") return <div className="flex flex-wrap gap-2">{field.options.map((option) => { const selected = Array.isArray(value) && value.includes(option); return <label key={option} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={selected} onChange={(event) => onChange([...(Array.isArray(value) ? value : []).filter((item) => item !== option), ...(event.target.checked ? [option] : [])])} />{option}</label>; })}</div>;
  if (field.type === "long_text") return <textarea aria-label={field.label} className="min-h-24 w-full rounded-md border bg-transparent px-3 py-2 text-sm" value={String(value ?? "")} onChange={(event) => onChange(event.target.value || undefined)} />;
  const inputType = field.type === "number" || field.type === "currency" ? "number" : field.type === "date" ? "date" : field.type === "phone" ? "tel" : field.type === "email" ? "email" : "text";
  return <Input aria-label={field.label} type={inputType} step={field.type === "currency" ? 1 : field.type === "number" ? "any" : undefined} value={value === undefined ? "" : String(value)} onChange={(event) => { const raw = event.target.value; onChange(raw === "" ? undefined : ["number", "currency"].includes(field.type) ? Number(raw) : raw); }} />;
}

function LeadForm({ template, readOnly, onCreated }: { template: TemplateRow; readOnly: boolean; onCreated: () => void }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [stage, setStage] = useState(template.stages[0]?.stage_key ?? "");
  const [saving, setSaving] = useState(false);
  const [draftStatus, setDraftStatus] = useState("Draft autosaves every 30 seconds");
  const fields = useMemo(() => new Map(template.fields.map((field) => [field.field_key, field])), [template.fields]);
  useEffect(() => { let cancelled = false; void fetch("/api/app/leads/draft", { cache: "no-store" }).then(async (response) => ({ response, body: await response.json().catch(() => null) })).then(({ response, body }) => { if (!cancelled || !response.ok) { if (response.ok && body?.draft?.payload) { setValues(body.draft.payload); setDraftStatus("Draft resumed"); } } }).catch(() => undefined); return () => { cancelled = true; }; }, [template.definition_version]);
  useEffect(() => { const timer = window.setInterval(() => { setDraftStatus("Saving draft…"); void fetch("/api/app/leads/draft", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload: values }) }).then((response) => { if (response.ok) setDraftStatus("Draft saved"); }).catch(() => setDraftStatus("Draft could not be saved; your typed data is still here")); }, 30000); return () => window.clearInterval(timer); }, [values]);
  function updateValue(fieldKey: string, value: unknown) { setValues((current) => { const next = { ...current, [fieldKey]: value }; for (const section of template.form_definition.sections) for (const formField of section.fields) { const condition = formField.show_when ?? formField.conditional_on; if (condition && !visible(formField, next)) delete next[formField.field_key]; } return next; }); }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const response = await fetch("/api/app/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values, stage_key: stage }) });
    const body = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) { toast.error(body?.error ?? "Could not create lead"); return; }
    setValues({});
    toast.success("Lead added to your template pipeline");
    onCreated();
  }
  return <Card><CardHeader><CardTitle className="text-base">New {template.product_name} lead</CardTitle><p className="text-sm text-muted-foreground">Form version {template.definition_version}. Currency values are stored as integer cents. {draftStatus}</p></CardHeader><CardContent><form onSubmit={submit} className="space-y-5">
    {template.form_definition.sections.map((section) => <fieldset key={section.section_key} className="space-y-3 rounded-md border p-3"><legend className="px-1 text-sm font-semibold">{section.label}</legend>{section.fields.map((formField) => { const field = fields.get(formField.field_key); if (!field || !visible(formField, values)) return null; return <div key={formField.field_key} className="space-y-1.5"><Label>{field.label}{(formField.is_required || field.is_required) && <span className="text-destructive"> *</span>}</Label>{field.help_text && <p className="text-xs text-muted-foreground">{field.help_text}</p>}<FieldInput field={field} value={values[field.field_key]} onChange={(value) => updateValue(field.field_key, value)} /></div>; })}</fieldset>)}
    <div className="space-y-1.5"><Label htmlFor="lead-stage">Starting stage</Label><select id="lead-stage" className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={stage} onChange={(event) => setStage(event.target.value)}>{template.stages.map((item) => <option key={item.stage_key} value={item.stage_key}>{item.label}</option>)}</select></div>
    <Button type="submit" disabled={readOnly || saving}>{readOnly ? "Read-only account" : saving ? "Adding…" : "Add lead"}</Button>
  </form></CardContent></Card>;
}

function PipelineBoard({ stages, leads, readOnly, onStageChange }: { stages: TemplateStage[]; leads: Lead[]; readOnly: boolean; onStageChange: (lead: Lead, stage: string) => void }) {
  return <div className="grid gap-3 xl:grid-cols-4">{stages.map((stage) => <Card key={stage.stage_key} className="min-w-0"><CardHeader className="border-t-4 pb-3" style={{ borderTopColor: stage.color }}><CardTitle className="text-sm">{stage.label}<span className="ml-2 text-xs font-normal text-muted-foreground">{leads.filter((lead) => lead.stage_key === stage.stage_key).length}</span></CardTitle></CardHeader><CardContent className="space-y-2">{leads.filter((lead) => lead.stage_key === stage.stage_key).map((lead) => <div key={lead.id} className="rounded-md border p-3"><p className="truncate text-sm font-medium">{String(lead.values.full_name ?? lead.values.name ?? "Unnamed lead")}</p><p className="mt-1 truncate text-xs text-muted-foreground">{Object.values(lead.values).filter(Boolean).slice(1, 3).map(String).join(" · ")}</p>{lead.screening_warning && <p role="status" className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-800">⚠ {lead.screening_warning}</p>}<select aria-label={`Move lead to stage`} disabled={readOnly} className="border-input bg-background mt-2 h-8 w-full rounded-md border px-2 text-xs" value={lead.stage_key} onChange={(event) => onStageChange(lead, event.target.value)}>{stages.map((item) => <option key={item.stage_key} value={item.stage_key}>{item.label}</option>)}</select></div>)}{!leads.some((lead) => lead.stage_key === stage.stage_key) && <p className="text-xs text-muted-foreground">No leads here yet.</p>}</CardContent></Card>)}</div>;
}

export function LeadWorkspace() {
  const [data, setData] = useState<PageData | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filterField, setFilterField] = useState("");
  const [filterValue, setFilterValue] = useState("");
  const [sortField, setSortField] = useState("");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [query, setQuery] = useState("");

  const load = useCallback(async (nextQuery: string) => {
    const response = await fetch(`/api/app/leads${nextQuery ? `?${nextQuery}` : ""}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error ?? "Could not load leads"); return; }
    setError(""); setData(body);
  }, []);
  // Initial data is external server state; the effect intentionally hydrates this client view.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(""); }, [load]);
  const template = data?.template.template;
  function applyFilters(event: React.FormEvent) { event.preventDefault(); const params = new URLSearchParams(); if (search) params.set("q", search); if (filterField && filterValue) { params.set("filter_field", filterField); params.set("filter_value", filterValue); } if (sortField) { params.set("sort", sortField); params.set("direction", direction); } const next = params.toString(); setQuery(next); void load(next); }
  async function updateStage(lead: Lead, stage: string) { const response = await fetch(`/api/app/leads/${lead.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ values: lead.values, stage_key: stage }) }); if (!response.ok) { const body = await response.json().catch(() => null); toast.error(body?.error ?? "Could not move lead"); return; } toast.success("Lead moved"); void load(query); }
  async function updateTemplate() { const response = await fetch("/api/app/templates/assignment", { method: "POST" }); if (!response.ok) { toast.error("Could not update the template"); return; } toast.success("Template updated; new leads now use the latest version"); void load(query); }
  if (error) return <Card><CardContent className="p-6"><p className="text-sm text-destructive">{error}</p><Button className="mt-4" variant="outline" onClick={() => void load(query)}>Try again</Button></CardContent></Card>;
  if (!data || !template) return <p className="text-sm text-muted-foreground">Loading your template…</p>;
  const exportParams = query ? `?${query}` : "";
  return <div className="mx-auto max-w-7xl space-y-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-extrabold tracking-tight">Lead workspace</h1><p className="mt-1 text-sm font-medium text-muted-foreground">{template.name} · {template.product_name} · pinned version {data.template.assignment.template_version}</p></div><div className="flex gap-2">{data.template.latest && <Button variant="outline" onClick={() => void updateTemplate()}>Update to v{data.template.latest.version}</Button>}<Button asChild variant="outline"><a href={`/api/app/leads/export${exportParams}`}>Export CSV</a></Button></div></div>
    <Card><CardContent className="p-4"><form onSubmit={applyFilters} className="grid gap-3 md:grid-cols-[1fr_180px_1fr_180px_auto] md:items-end"><div className="space-y-1"><Label htmlFor="lead-search">Search all fields</Label><Input id="lead-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search leads" /></div><div className="space-y-1"><Label htmlFor="filter-field">Filter field</Label><select id="filter-field" className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={filterField} onChange={(event) => setFilterField(event.target.value)}><option value="">Any field</option>{template.fields.map((field) => <option key={field.field_key} value={field.field_key}>{field.label}</option>)}</select></div><div className="space-y-1"><Label htmlFor="filter-value">Filter contains</Label><Input id="filter-value" value={filterValue} onChange={(event) => setFilterValue(event.target.value)} placeholder="Value" /></div><div className="space-y-1"><Label htmlFor="sort-field">Sort by</Label><select id="sort-field" className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={sortField} onChange={(event) => setSortField(event.target.value)}><option value="">Created date</option>{template.fields.map((field) => <option key={field.field_key} value={field.field_key}>{field.label}</option>)}</select></div><Button type="submit">Apply</Button></form>{sortField && <button type="button" className="mt-2 text-xs text-primary underline" onClick={() => setDirection((current) => current === "asc" ? "desc" : "asc")}>Direction: {direction === "asc" ? "A–Z / low–high" : "Z–A / high–low"}</button>}</CardContent></Card>
    <div className="grid gap-6 lg:grid-cols-[minmax(280px,360px)_1fr]"><LeadForm template={template} readOnly={data.readOnly} onCreated={() => void load(query)} /><div className="space-y-3"><div className="flex items-center justify-between"><h2 className="text-lg font-bold">Pipeline</h2><Badge variant="outline">{data.leads.length} leads</Badge></div><PipelineBoard stages={template.stages} leads={data.leads} readOnly={data.readOnly} onStageChange={updateStage} /></div></div>
  </div>;
}
