"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ProductRow } from "@/lib/products/constants";
import {
  TEMPLATE_FIELD_TYPES,
  TEMPLATE_FIELD_TYPE_LABELS,
  TEMPLATE_STAGE_TYPES,
  TEMPLATE_STAGE_TYPE_LABELS,
  type TemplateField,
  type TemplateFormDefinition,
  type TemplateFormField,
  type TemplateFormSection,
  type TemplateRow,
  type TemplateStage,
} from "@/lib/templates/constants";

type Draft = {
  name: string;
  product_code: string;
  description: string;
  fields: TemplateField[];
  stages: TemplateStage[];
  form_definition: TemplateFormDefinition;
};

function draftFrom(template: TemplateRow | null | undefined, products: ProductRow[]): Draft {
  return {
    name: template?.name ?? "",
    product_code: template?.product_code ?? products.find((product) => product.is_active)?.code ?? "",
    description: template?.description ?? "",
    fields: template?.fields.map((field) => ({ ...field, options: [...field.options] })) ?? [],
    stages: template?.stages.map((stage) => ({ ...stage })) ?? [],
    form_definition: template?.form_definition
      ? { sections: template.form_definition.sections.map((section) => ({ ...section, fields: section.fields.map((field) => ({ ...field, show_when: field.show_when ? { ...field.show_when } : null })) })) }
      : { sections: [{ section_key: "application", label: "Application", fields: [], sort_order: 0 }] },
  };
}

function slug(value: string, fallback: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function previewField(field: TemplateField, showWhen: TemplateFormField["show_when"] = null) {
  return <div key={field.field_key} className="rounded-md border bg-background p-2"><p className="text-xs font-medium">{field.label}{field.is_required && <span className="text-destructive"> *</span>}</p><p className="mt-1 text-xs text-muted-foreground">{TEMPLATE_FIELD_TYPE_LABELS[field.type]}{showWhen ? ` · shown when ${showWhen.field_key} = ${showWhen.equals || "…"}` : ""}</p></div>;
}

export function TemplateEditorDialog({
  mode,
  open,
  template,
  products,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  open: boolean;
  template?: TemplateRow | null;
  products: ProductRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(template, products));
  const [saving, setSaving] = useState(false);
  const isEdit = mode === "edit";

  function updateDraft(patch: Partial<Draft>) { setDraft((current) => ({ ...current, ...patch })); }
  function updateField(index: number, patch: Partial<TemplateField>) { setDraft((current) => ({ ...current, fields: current.fields.map((field, i) => i === index ? { ...field, ...patch } : field) })); }
  function updateStage(index: number, patch: Partial<TemplateStage>) { setDraft((current) => ({ ...current, stages: current.stages.map((stage, i) => i === index ? { ...stage, ...patch } : stage) })); }
  function updateSection(index: number, patch: Partial<TemplateFormSection>) { setDraft((current) => ({ ...current, form_definition: { sections: current.form_definition.sections.map((section, i) => i === index ? { ...section, ...patch } : section) } })); }

  function addField() {
    const next = draft.fields.length + 1;
    updateDraft({ fields: [...draft.fields, { field_key: `field_${next}`, label: `Field ${next}`, type: "text", is_required: false, options: [], sort_order: next * 10 }] });
  }
  function removeField(index: number) { updateDraft({ fields: draft.fields.filter((_, i) => i !== index) }); }
  function addStage() {
    const next = draft.stages.length + 1;
    updateDraft({ stages: [...draft.stages, { stage_key: `stage_${next}`, label: `Stage ${next}`, stage_type: "open", color: "#2563eb", sort_order: next * 10 }] });
  }
  function removeStage(index: number) { updateDraft({ stages: draft.stages.filter((_, i) => i !== index) }); }
  function addSection() {
    const next = draft.form_definition.sections.length + 1;
    updateDraft({ form_definition: { sections: [...draft.form_definition.sections, { section_key: `section_${next}`, label: `Section ${next}`, fields: [], sort_order: next * 10 }] } });
  }
  function removeSection(index: number) { updateDraft({ form_definition: { sections: draft.form_definition.sections.filter((_, i) => i !== index) } }); }
  function addFormField(sectionIndex: number) {
    const fieldKey = draft.fields.find((field) => !draft.form_definition.sections.some((section) => section.fields.some((item) => item.field_key === field.field_key)))?.field_key ?? draft.fields[0]?.field_key;
    if (!fieldKey) return;
    const item: TemplateFormField = { field_key: fieldKey, is_required: false, show_when: null };
    updateSection(sectionIndex, { fields: [...draft.form_definition.sections[sectionIndex].fields, item] });
  }
  function updateFormField(sectionIndex: number, fieldIndex: number, patch: Partial<TemplateFormField>) {
    const section = draft.form_definition.sections[sectionIndex];
    updateSection(sectionIndex, { fields: section.fields.map((field, index) => index === fieldIndex ? { ...field, ...patch } : field) });
  }
  function removeFormField(sectionIndex: number, fieldIndex: number) {
    const section = draft.form_definition.sections[sectionIndex];
    updateSection(sectionIndex, { fields: section.fields.filter((_, index) => index !== fieldIndex) });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    const response = await fetch(isEdit ? `/api/admin/templates/${template!.id}` : "/api/admin/templates", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const body = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) { toast.error(body?.error ?? "Could not save the template"); return; }
    toast.success(isEdit ? `${draft.name} saved as a new version` : `${draft.name} created`);
    onSaved();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{isEdit ? `Edit ${template?.name}` : "New product template"}</DialogTitle>
            <DialogDescription>{isEdit ? `Saving creates version ${(template?.version ?? 0) + 1}; agents using an older version keep their existing fields, board and form.` : "Create a reusable lead, pipeline and application starting point. Saving takes effect immediately; no deploy is needed."}</DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            <section className="rounded-lg border p-4"><h3 className="font-semibold">Template details</h3><div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="template-name">Name</Label><Input id="template-name" required value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} placeholder="Term Life — standard" /></div>
              <div className="space-y-1.5"><Label htmlFor="template-product">Product</Label><Select value={draft.product_code} onValueChange={(value) => updateDraft({ product_code: value })}><SelectTrigger id="template-product" className="w-full"><SelectValue placeholder="Choose a product" /></SelectTrigger><SelectContent>{products.filter((product) => product.is_active || product.code === draft.product_code).map((product) => <SelectItem key={product.code} value={product.code}>{product.name} ({product.code})</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="template-description">Description</Label><Input id="template-description" value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} placeholder="Optional description for agents" /></div>
            </div></section>

            <section className="rounded-lg border p-4"><div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">Lead fields</h3><p className="text-xs text-muted-foreground">Schema fields are reusable keys; lead values will be JSONB in the agent workspace.</p></div><Button type="button" variant="outline" size="sm" onClick={addField}>Add field</Button></div><div className="mt-4 space-y-3">{draft.fields.map((field, index) => <div key={`${index}-${field.field_key}`} className="grid gap-2 rounded-md bg-muted/30 p-3 md:grid-cols-[1fr_1fr_180px_auto] md:items-end">
              <div className="space-y-1"><Label htmlFor={`field-key-${index}`}>Key</Label><Input id={`field-key-${index}`} value={field.field_key} onChange={(event) => updateField(index, { field_key: slug(event.target.value, `field_${index + 1}`) })} /></div>
              <div className="space-y-1"><Label htmlFor={`field-label-${index}`}>Label</Label><Input id={`field-label-${index}`} value={field.label} onChange={(event) => updateField(index, { label: event.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor={`field-type-${index}`}>Type</Label><select id={`field-type-${index}`} className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={field.type} onChange={(event) => updateField(index, { type: event.target.value as TemplateField["type"], options: ["single_select", "multi_select"].includes(event.target.value) ? field.options : [] })}>{TEMPLATE_FIELD_TYPES.map((type) => <option key={type} value={type}>{TEMPLATE_FIELD_TYPE_LABELS[type]}</option>)}</select></div>
              <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => removeField(index)}>Remove</Button>
              <label className="flex items-center gap-2 text-xs md:col-span-2"><input type="checkbox" checked={field.is_required} onChange={(event) => updateField(index, { is_required: event.target.checked })} /> Required</label>
              {["single_select", "multi_select"].includes(field.type) && <div className="space-y-1 md:col-span-2"><Label htmlFor={`field-options-${index}`}>Options (comma separated)</Label><Input id={`field-options-${index}`} value={field.options.join(", ")} onChange={(event) => updateField(index, { options: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} placeholder="Yes, No" /></div>}
            </div>)}{draft.fields.length === 0 && <p className="text-sm text-muted-foreground">No lead fields yet. Add the fields agents should capture.</p>}</div></section>

            <section className="rounded-lg border p-4"><div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">Pipeline stages</h3><p className="text-xs text-muted-foreground">Stages are kept in the order shown to agents.</p></div><Button type="button" variant="outline" size="sm" onClick={addStage}>Add stage</Button></div><div className="mt-4 space-y-3">{draft.stages.map((stage, index) => <div key={`${index}-${stage.stage_key}`} className="grid gap-2 rounded-md bg-muted/30 p-3 md:grid-cols-[1fr_1fr_140px_110px_auto] md:items-end">
              <div className="space-y-1"><Label htmlFor={`stage-key-${index}`}>Key</Label><Input id={`stage-key-${index}`} value={stage.stage_key} onChange={(event) => updateStage(index, { stage_key: slug(event.target.value, `stage_${index + 1}`) })} /></div>
              <div className="space-y-1"><Label htmlFor={`stage-label-${index}`}>Name</Label><Input id={`stage-label-${index}`} value={stage.label} onChange={(event) => updateStage(index, { label: event.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor={`stage-type-${index}`}>Type</Label><select id={`stage-type-${index}`} className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={stage.stage_type} onChange={(event) => updateStage(index, { stage_type: event.target.value as TemplateStage["stage_type"] })}>{TEMPLATE_STAGE_TYPES.map((type) => <option key={type} value={type}>{TEMPLATE_STAGE_TYPE_LABELS[type]}</option>)}</select></div>
              <div className="space-y-1"><Label htmlFor={`stage-color-${index}`}>Colour</Label><Input id={`stage-color-${index}`} type="color" value={stage.color} onChange={(event) => updateStage(index, { color: event.target.value })} /></div>
              <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => removeStage(index)}>Remove</Button>
            </div>)}{draft.stages.length === 0 && <p className="text-sm text-muted-foreground">No pipeline stages yet. Add the board stages agents will use.</p>}</div></section>

            <section className="rounded-lg border p-4"><div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold">Application form</h3><p className="text-xs text-muted-foreground">Organize lead fields into sections. Each field can have one optional show/hide condition.</p></div><Button type="button" variant="outline" size="sm" onClick={addSection}>Add section</Button></div><div className="mt-4 space-y-4">{draft.form_definition.sections.map((section, sectionIndex) => <div key={`${sectionIndex}-${section.section_key}`} className="rounded-md bg-muted/30 p-3"><div className="flex flex-wrap items-end gap-2"><div className="min-w-48 flex-1 space-y-1"><Label htmlFor={`section-key-${sectionIndex}`}>Section key</Label><Input id={`section-key-${sectionIndex}`} value={section.section_key} onChange={(event) => updateSection(sectionIndex, { section_key: slug(event.target.value, `section_${sectionIndex + 1}`) })} /></div><div className="min-w-48 flex-1 space-y-1"><Label htmlFor={`section-label-${sectionIndex}`}>Section name</Label><Input id={`section-label-${sectionIndex}`} value={section.label} onChange={(event) => updateSection(sectionIndex, { label: event.target.value })} /></div><Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => removeSection(sectionIndex)}>Remove section</Button></div><div className="mt-3 space-y-2">{section.fields.map((formField, fieldIndex) => <div key={`${fieldIndex}-${formField.field_key}`} className="grid gap-2 rounded border bg-background p-2 md:grid-cols-[1fr_auto_auto] md:items-end"><div className="space-y-1"><Label htmlFor={`form-field-${sectionIndex}-${fieldIndex}`}>Field</Label><select id={`form-field-${sectionIndex}-${fieldIndex}`} className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={formField.field_key} onChange={(event) => updateFormField(sectionIndex, fieldIndex, { field_key: event.target.value })}>{draft.fields.map((field) => <option key={field.field_key} value={field.field_key}>{field.label}</option>)}</select></div><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={formField.is_required} onChange={(event) => updateFormField(sectionIndex, fieldIndex, { is_required: event.target.checked })} /> Required</label><Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => removeFormField(sectionIndex, fieldIndex)}>Remove</Button><div className="md:col-span-3"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={Boolean(formField.show_when)} onChange={(event) => updateFormField(sectionIndex, fieldIndex, { show_when: event.target.checked ? { field_key: draft.fields[0]?.field_key ?? "condition", equals: "" } : null })} /> Show only when another field matches</label>{formField.show_when && <div className="mt-2 grid gap-2 sm:grid-cols-2"><select className="border-input bg-background h-9 w-full rounded-md border px-3 py-1 text-sm" value={formField.show_when.field_key} onChange={(event) => updateFormField(sectionIndex, fieldIndex, { show_when: { ...formField.show_when!, field_key: event.target.value } })}>{draft.fields.map((field) => <option key={field.field_key} value={field.field_key}>{field.label}</option>)}</select><Input value={formField.show_when.equals} onChange={(event) => updateFormField(sectionIndex, fieldIndex, { show_when: { ...formField.show_when!, equals: event.target.value } })} placeholder="Value" /></div>}</div></div>)}<Button type="button" variant="outline" size="sm" onClick={() => addFormField(sectionIndex)} disabled={draft.fields.length === 0}>Add field to section</Button></div></div>)}{draft.form_definition.sections.length === 0 && <p className="text-sm text-muted-foreground">No application sections yet.</p>}</div></section>

            <section className="rounded-lg border p-4"><div className="flex items-center gap-2"><h3 className="font-semibold">Agent preview</h3><Badge variant="outline">Current draft</Badge></div><div className="mt-4 grid gap-4 lg:grid-cols-2"><div><p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Lead form</p>{draft.form_definition.sections.map((section) => <div key={section.section_key} className="mb-3 rounded-md border p-3"><p className="font-medium">{section.label}</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{section.fields.map((formField) => { const field = draft.fields.find((item) => item.field_key === formField.field_key); return field ? previewField({ ...field, is_required: formField.is_required }, formField.show_when) : null; })}</div></div>)}</div><div><p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Pipeline board</p><div className="flex flex-wrap gap-2">{draft.stages.map((stage) => <div key={stage.stage_key} className="min-w-28 rounded-md border-t-4 bg-muted/30 p-3" style={{ borderTopColor: stage.color }}><p className="text-sm font-medium">{stage.label}</p><p className="text-xs text-muted-foreground">{TEMPLATE_STAGE_TYPE_LABELS[stage.stage_type]}</p></div>)}</div></div></div></section>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : isEdit ? "Save new version" : "Create template"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
