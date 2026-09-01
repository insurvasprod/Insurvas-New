"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, CircleAlert, Loader2, Save } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TemplateField } from "@/lib/templates/constants";
import type { VerificationState } from "@/lib/verification/progress";

type PanelField = TemplateField & { state: VerificationState; old_value: unknown; new_value: unknown; confirmed_at: string | null };
type PanelSection = { section_key: string; label: string; sort_order: number; fields: PanelField[] };
type Panel = { session: { progress_percentage: number; completed_at: string | null; started_at: string; last_actor_id: string | null }; workItem: { leadId: string; productLine: string }; lead: { values: Record<string, unknown> }; template: { product_name: string; definition_version?: number }; sections: PanelSection[]; requiredCount: number; visibleCount: number };

function displayValue(value: unknown) { return Array.isArray(value) ? value.join(", ") : value === null || value === undefined || value === "" ? "Not provided" : String(value); }
function inputValue(value: unknown, type: TemplateField["type"]) { if (type === "multi_select") return Array.isArray(value) ? value : []; if (type === "boolean") return typeof value === "boolean" ? String(value) : ""; return value === null || value === undefined ? "" : String(value); }

function FieldEditor({ field, value, onChange, disabled }: { field: TemplateField; value: unknown; onChange: (value: unknown) => void; disabled: boolean }) {
  const aria = { "aria-label": field.label };
  if (field.type === "long_text") return <textarea {...aria} className="border-input bg-background min-h-20 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" value={inputValue(value, field.type)} disabled={disabled} onChange={(event) => onChange(event.target.value)} />;
  if (field.type === "single_select" || field.type === "boolean") return <select {...aria} className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" value={inputValue(value, field.type)} disabled={disabled} onChange={(event) => onChange(field.type === "boolean" ? event.target.value === "" ? undefined : event.target.value === "true" : event.target.value)}><option value="">Choose…</option>{field.type === "boolean" ? <><option value="true">Yes</option><option value="false">No</option></> : field.options.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
  if (field.type === "multi_select") return <div className="flex flex-wrap gap-2 rounded-md border p-2" aria-label={field.label}>{field.options.map((option) => <label key={option} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Array.isArray(value) && value.includes(option)} disabled={disabled} onChange={(event) => onChange([...(Array.isArray(value) ? value : []).filter((item) => item !== option), ...(event.target.checked ? [option] : [])])} />{option}</label>)}</div>;
  const htmlType = field.type === "number" || field.type === "currency" ? "number" : field.type === "date" ? "date" : field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text";
  return <Input {...aria} type={htmlType} value={inputValue(value, field.type)} disabled={disabled} onChange={(event) => { const raw = event.target.value; onChange(field.type === "number" ? raw === "" ? undefined : Number(raw) : field.type === "currency" ? raw === "" ? undefined : Math.round(Number(raw) * 100) : raw); }} />;
}

function stateBadge(state: VerificationState) { return state === "confirmed" ? <Badge variant="secondary">Confirmed</Badge> : state === "corrected" ? <Badge variant="outline">Corrected</Badge> : <Badge variant="destructive">Outstanding</Badge>; }

export function VerificationPanel({ workItemId, readOnly }: { workItemId: string; readOnly: boolean }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/app/inbound/verification?work_item_id=${encodeURIComponent(workItemId)}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error ?? "Could not load verification"); setLoading(false); return; }
    setPanel(body); setDrafts(body.lead.values ?? {}); setError(""); setLoading(false);
  }, [workItemId]);
  // This initial load is the server-backed session resume point after a dropped call.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  async function update(fieldKey: string, state: VerificationState) {
    setSaving(fieldKey); setFieldErrors((current) => ({ ...current, [fieldKey]: "" }));
    const response = await fetch("/api/app/inbound/verification", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ work_item_id: workItemId, field_key: fieldKey, state, value: drafts[fieldKey] }) });
    const body = await response.json().catch(() => null);
    setSaving(null);
    if (!response.ok) { setFieldErrors((current) => ({ ...current, [fieldKey]: body?.error ?? "Could not save this field" })); return; }
    setPanel(body.panel); setDrafts(body.panel.lead.values ?? {});
  }

  if (loading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading verification…</div>;
  if (error || !panel) return <Card><CardContent className="space-y-3 p-6"><p className="text-sm text-destructive">{error || "Verification is unavailable"}</p><Button variant="outline" onClick={() => void load()}>Try again</Button></CardContent></Card>;
  const requiredDone = panel.session.progress_percentage === 100;
  return <div className="mx-auto max-w-5xl space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><Link href="/app/inbound" className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><ArrowLeft className="size-4" />Back to transfers</Link><h1 className="mt-3 text-2xl font-extrabold tracking-tight">Verify application</h1><p className="mt-1 text-sm text-muted-foreground">{panel.template.product_name} · Confirm each field with the customer. Corrections are saved with an audit history.</p></div>{readOnly && <Badge variant="outline">Read-only account</Badge>}</div>
    {readOnly && <div role="status" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">Your account is read-only. You can review this application, but field changes are disabled.</div>}
    <Card><CardContent className="space-y-3 p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Verification progress</p><p className="mt-1 text-2xl font-extrabold">{panel.session.progress_percentage}%</p></div><p className="text-sm text-muted-foreground">{requiredDone ? "All required fields confirmed" : `${panel.requiredCount} required field${panel.requiredCount === 1 ? "" : "s"} · ${panel.visibleCount} visible`}</p></div><div className="h-3 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${panel.session.progress_percentage}%` }} /></div>{requiredDone && <p className="flex items-center gap-2 text-sm text-emerald-700"><Check className="size-4" />Ready to continue</p>}</CardContent></Card>
    <div className="space-y-3">{panel.sections.map((section) => { const complete = section.fields.filter((field) => field.is_required).every((field) => ["confirmed", "corrected"].includes(field.state)); return <details key={section.section_key} open={!complete} className="group rounded-lg border bg-card"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"><span>{section.label}</span><span className="flex items-center gap-2">{complete && <Badge variant="secondary">Complete</Badge>}<span className="text-muted-foreground transition-transform group-open:rotate-180">⌄</span></span></summary><div className="space-y-4 border-t p-4">{section.fields.map((field) => <div key={field.field_key} className="space-y-2 rounded-md border bg-muted/20 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><Label htmlFor={`verify-${field.field_key}`}>{field.label}{field.is_required && <span className="text-destructive"> *</span>}</Label>{field.help_text && <p className="mt-1 text-xs text-muted-foreground">{field.help_text}</p>}</div>{stateBadge(field.state)}</div><FieldEditor field={field} value={drafts[field.field_key]} onChange={(value) => setDrafts((current) => ({ ...current, [field.field_key]: value }))} disabled={readOnly || saving === field.field_key} /><p className="text-xs text-muted-foreground">Current value: {displayValue(panel.lead.values[field.field_key])}</p>{fieldErrors[field.field_key] && <p role="alert" className="flex items-center gap-1 text-sm text-destructive"><CircleAlert className="size-4" />{fieldErrors[field.field_key]}</p>}<div className="flex flex-wrap gap-2"><Button size="sm" disabled={readOnly || saving === field.field_key} onClick={() => void update(field.field_key, "confirmed")}>{saving === field.field_key ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}Confirm</Button><Button size="sm" variant="outline" disabled={readOnly || saving === field.field_key} onClick={() => void update(field.field_key, "corrected")}><Save className="size-4" />Save correction</Button><Button size="sm" variant="ghost" disabled={readOnly || saving === field.field_key} onClick={() => void update(field.field_key, "outstanding")}>Mark outstanding</Button></div></div>)}</div></details>; })}</div>
  </div>;
}
