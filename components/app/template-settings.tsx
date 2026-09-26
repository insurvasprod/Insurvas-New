"use client";

/**
 * Settings → Form templates, drawn from p-set-form-templates.
 *
 * The whole form is one draft. Every edit — a field, a section, an age limit, a stage, the name — is
 * held in this browser and listed under "Changes before commit"; the header's Save changes and the
 * card's Commit both write it as one new immutable form version. Partner drafts already in
 * progress stay pinned to the version they started on (the RPC's contract, unchanged).
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Callout,
  DraftActions,
  Field,
  Pill,
  PlusIcon,
  SettingsCard,
  SettingsGrid,
  SettingsSectionHeader,
  SettingsStack,
  SettingsTableCard,
  Timeline,
  ToggleRow,
  btn,
  control,
  st,
} from "@/components/app/settings/primitives";
import {
  TEMPLATE_FIELD_TYPES,
  TEMPLATE_FIELD_TYPE_LABELS,
  TEMPLATE_FIELD_TYPE_TABLE_LABELS,
  TEMPLATE_SECTION_GROUPS,
  TEMPLATE_STAGE_TYPES,
  TEMPLATE_STAGE_TYPE_LABELS,
  type TemplateField,
  type TemplateFormDefinition,
  type TemplateFormField,
  type TemplateRow,
  type TemplateSectionGroup,
  type TemplateStage,
  type TemplateStageType,
  type TemplateValidation,
} from "@/lib/templates/constants";
import { TEMPLATE_SECTION_GROUP_LABELS, sectionAvailability, sectionAvailabilityError, sectionsByGroup } from "@/lib/templates/sectionAvailability";
import { BANK_ACCOUNT_MAX_DIGITS, BANK_ACCOUNT_MIN_DIGITS } from "@/lib/templates/formats";
import { PartnerLeadForm, type PartnerFormPreviewSource } from "@/components/partner/partner-portal-workspace";
import { countWord, diffTemplateDraft, eligibilityFieldKey, type TemplateDraft } from "@/lib/agentTemplates/draftChanges";
import { defaultStageColor } from "@/lib/design/tokenColor";

type Current = { tenant_template_id: string; assignment: { template_id: string; template_version: number; definition_version: number; product_code: string }; template: { name: string; description: string | null; product_name: string; version: number; definition_version: number; fields: TemplateField[]; stages: TemplateStage[]; form_definition: TemplateFormDefinition }; latest: { id: string; version: number; name: string } | null };
type Available = { id: string; name: string; product_code: string; product_name: string; version: number; description: string | null };
type Product = { code: string; name: string };
type Preview = { fieldsToAdd: string[]; stagesToAdd: string[]; sectionsToAdd: string[]; alreadyApplied: boolean };
type DraftState = { draft: TemplateDraft; seen: Record<string, number> };
type Editing = { kind: "field"; fieldKey: string; sectionKey: string | null } | { kind: "section"; sectionKey: string } | null;

function cloneForm(form: TemplateFormDefinition): TemplateFormDefinition { return { sections: form.sections.map((section) => ({ ...section, fields: section.fields.map((field) => ({ ...field, show_when: field.show_when ? { ...field.show_when } : null, conditional_on: field.conditional_on ? { ...field.conditional_on } : undefined })) })), ...(form.section_availability ? { section_availability: { ...form.section_availability } } : {}) }; }

function draftFrom(current: Current): TemplateDraft {
  return {
    name: current.template.name,
    fields: current.template.fields.map((field) => ({ ...field, options: [...field.options], validation: { ...(field.validation ?? {}) } })),
    stages: current.template.stages.map((stage) => ({ ...stage })),
    form: cloneForm(current.template.form_definition),
  };
}

const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const small = "mt-1.5 box-border h-10 w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[14px] text-[var(--ink)]";

function numberOrUndefined(value: string) { return value === "" ? undefined : Number(value); }

function uniqueKey(base: string, used: Set<string>) {
  let index = used.size + 1;
  while (used.has(`${base}_${index}`)) index += 1;
  return `${base}_${index}`;
}

/* ── partner preview: the partner's own form component, fed this draft (LA-1.4-5) ── */

const PREVIEW_MARKET = { carrier_id: "", carrier_name: "", state: "" };

function PartnerViewPreview({ source, productCode, productName }: { source: PartnerFormPreviewSource; productCode: string; productName: string }) {
  return (
    <SettingsCard title="Partner view preview" sub="The partner submit form, drawn by the same component partners use, from this draft. Phone screening is simulated as clear, and nothing is saved or submitted.">
      <div className="portal-partner-submit-page">
        <PartnerLeadForm productCode={productCode} productName={productName} partnerStatus="active" market={PREVIEW_MARKET} preview={source} />
      </div>
    </SettingsCard>
  );
}

/* ── LA-1.4-3: which section groups this product's form offers ─────────── */

function SectionAvailabilityCard({ form, fields, onChange }: { form: TemplateFormDefinition; fields: TemplateField[]; onChange: (group: TemplateSectionGroup, on: boolean) => void }) {
  const availability = sectionAvailability(form);
  const governed = sectionsByGroup(form);
  const problem = sectionAvailabilityError(form, fields);
  return (
    <SettingsCard title="Form sections" sub="Switch a whole group of sections off for this product. A section belongs to a group by its name; one that matches no group always shows.">
      <div className="flex flex-col gap-3.5">
        {TEMPLATE_SECTION_GROUPS.map((group) => {
          const sections = governed[group];
          return (
            <ToggleRow
              key={group}
              id={`section-group-${group}`}
              title={TEMPLATE_SECTION_GROUP_LABELS[group]}
              help={sections.length ? `On this form: ${sections.map((section) => section.label).join(", ")}` : "No section on this form belongs to this group."}
              checked={availability[group]}
              onChange={(on) => onChange(group, on)}
            />
          );
        })}
        {problem && <Callout tone="error" title="This cannot be committed">{problem}</Callout>}
      </div>
    </SettingsCard>
  );
}

function SettingsDialog({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto border-[var(--border)] bg-[var(--surface)] text-[var(--body)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-[18px] text-[var(--ink)]">{title}</DialogTitle>
          {description && <DialogDescription className="text-[14px] leading-[1.5] text-[var(--muted)]">{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/* ── the section ───────────────────────────────────────────────────────── */

export function TemplateSettings() {
  const [current, setCurrent] = useState<Current | null>(null);
  const [available, setAvailable] = useState<Available[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [state, setState] = useState<DraftState | null>(null);
  const [selected, setSelected] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [editing, setEditing] = useState<Editing>(null);

  async function load(product?: string) {
    setLoading(true);
    const url = product ? `/api/app/templates?product=${encodeURIComponent(product)}` : "/api/app/templates";
    const response = await fetch(url, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    setLoading(false);
    if (!response.ok) { setError(body?.error ?? "Could not load template settings"); return; }
    setError("");
    setCurrent(body.current);
    setAvailable(body.templates ?? []);
    setProducts(body.products ?? []);
    setState({ draft: draftFrom(body.current), seen: {} });
    setSaveError("");
    setSelected("");
    setPreview(null);
  }
  // Initial data is external server state; this effect hydrates the interactive editor.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);

  const saved = useMemo(() => (current ? draftFrom(current) : null), [current]);
  const draft = state?.draft ?? null;
  const changes = useMemo(() => (saved && draft ? diffTemplateDraft(saved, draft) : []), [saved, draft]);
  const dirty = changes.length > 0;
  // The partner form renders this draft as a partner would receive it (LA-1.4-5).
  const previewSource = useMemo<PartnerFormPreviewSource | null>(() => {
    if (!current || !draft) return null;
    const template: TemplateRow = {
      id: current.assignment.template_id,
      name: draft.name,
      product_code: current.assignment.product_code,
      product_name: current.template.product_name,
      version: current.template.version,
      definition_version: current.template.definition_version,
      description: current.template.description,
      is_active: true,
      created_by: null,
      created_at: "",
      updated_at: "",
      fields: draft.fields,
      stages: draft.stages,
      form_definition: draft.form,
    };
    return { tenant_template_id: current.tenant_template_id, assignment: { definition_version: current.assignment.definition_version }, template };
  }, [current, draft]);

  /** Every edit goes through here, so the change list learns when each line first appeared. */
  function update(fn: (draft: TemplateDraft) => TemplateDraft) {
    setSaveError("");
    setState((prev) => {
      if (!prev || !saved) return prev;
      const next = fn(prev.draft);
      const now = Date.now();
      const seen: Record<string, number> = {};
      for (const change of diffTemplateDraft(saved, next)) seen[change.id] = prev.seen[change.id] ?? now;
      return { draft: next, seen };
    });
  }
  function discard() { if (current) setState({ draft: draftFrom(current), seen: {} }); setSaveError(""); setEditing(null); }

  async function commit() {
    if (!current || !draft) return;
    setSaving(true);
    setSaveError("");
    const response = await fetch(`/api/app/templates/${current.tenant_template_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name,
        description: current.template.description,
        fields: draft.fields.map((field, index) => ({ ...field, sort_order: index, validation: field.validation ?? {}, help_text: field.help_text || null })),
        stages: draft.stages.map((stage, index) => ({ ...stage, sort_order: index })),
        form_definition: { sections: draft.form.sections.map((section, index) => ({ ...section, sort_order: index })), ...(draft.form.section_availability ? { section_availability: draft.form.section_availability } : {}) },
      }),
    });
    const body = await response.json().catch(() => null);
    setSaving(false);
    if (!response.ok) { const message = body?.error ?? "Could not save template copy"; setSaveError(message); notify.block(message); return; }
    notify.done("Committed as a new form version; forms already in progress stay on theirs");
    await load(current.assignment.product_code);
  }

  const chosen = available.find((template) => `${template.id}:${template.version}` === selected);
  async function showPreview(template: Available | null = chosen ?? null) {
    if (!template) return;
    const response = await fetch("/api/app/templates/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template_id: template.id, template_version: template.version }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) { notify.block(body?.error ?? "Could not preview template"); return; }
    setPreview(body.preview);
  }
  async function apply() {
    if (!chosen || !current) return;
    setApplying(true);
    const response = await fetch("/api/app/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template_id: chosen.id, template_version: chosen.version }) });
    const body = await response.json().catch(() => null);
    setApplying(false);
    if (!response.ok) { notify.block(body?.error ?? "Could not apply template"); return; }
    notify.done("Template applied; new drafts use the new version");
    await load(current.assignment.product_code);
  }

  if (!current || !draft || !saved) {
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        {error ? (
          <Callout tone="error" title="Form templates could not be loaded">
            {error}
            <div className="mt-3"><button type="button" className={btn("secondary")} onClick={() => void load()}>Try again</button></div>
          </Callout>
        ) : (
          <SettingsCard><p className="m-0 text-[14px] text-[var(--muted)]">{loading ? "Loading form templates…" : "No form is configured."}</p></SettingsCard>
        )}
      </SettingsStack>
    );
  }

  const fieldMap = new Map(draft.fields.map((field) => [field.field_key, field]));
  const placed = new Set(draft.form.sections.flatMap((section) => section.fields.map((field) => field.field_key)));
  const unplaced = draft.fields.filter((field) => !placed.has(field.field_key));
  const eligibilityKey = eligibilityFieldKey(draft.fields);
  const eligibility = eligibilityKey ? fieldMap.get(eligibilityKey) ?? null : null;
  const productTemplates = available.filter((template) => template.product_code === current.assignment.product_code);
  const productOptions = products.some((product) => product.code === current.assignment.product_code)
    ? products
    : [{ code: current.assignment.product_code, name: current.template.product_name }, ...products];

  /* draft mutators */
  const setField = (fieldKey: string, patch: Partial<TemplateField>) => update((d) => ({ ...d, fields: d.fields.map((field) => (field.field_key === fieldKey ? { ...field, ...patch } : field)) }));
  const setValidation = (fieldKey: string, patch: Partial<TemplateValidation>) =>
    update((d) => ({
      ...d,
      fields: d.fields.map((field) => {
        if (field.field_key !== fieldKey) return field;
        const validation = { ...(field.validation ?? {}), ...patch } as Record<string, unknown>;
        for (const key of Object.keys(validation)) if (validation[key] === undefined) delete validation[key];
        return { ...field, validation: validation as TemplateValidation };
      }),
    }));
  const setSection = (sectionKey: string, patch: Partial<TemplateFormDefinition["sections"][number]>) => update((d) => ({ ...d, form: { sections: d.form.sections.map((section) => (section.section_key === sectionKey ? { ...section, ...patch } : section)) } }));
  const setPlacement = (sectionKey: string, fieldKey: string, patch: Partial<TemplateFormField>) =>
    update((d) => ({ ...d, form: { sections: d.form.sections.map((section) => (section.section_key === sectionKey ? { ...section, fields: section.fields.map((field) => (field.field_key === fieldKey ? { ...field, ...patch } : field)) } : section)) } }));
  function addSection() {
    const key = uniqueKey("section", new Set(draft!.form.sections.map((section) => section.section_key)));
    update((d) => ({ ...d, form: { sections: [...d.form.sections, { section_key: key, label: `Section ${d.form.sections.length + 1}`, fields: [], sort_order: d.form.sections.length }] } }));
    setEditing({ kind: "section", sectionKey: key });
  }
  function addNewField(sectionKey: string | null) {
    const key = uniqueKey("custom_field", new Set(draft!.fields.map((field) => field.field_key)));
    update((d) => ({
      ...d,
      fields: [...d.fields, { field_key: key, label: "New field", type: "text", is_required: false, options: [], sort_order: d.fields.length, help_text: null, validation: {} }],
      form: sectionKey ? { sections: d.form.sections.map((section) => (section.section_key === sectionKey ? { ...section, fields: [...section.fields, { field_key: key, is_required: false, show_when: null }] } : section)) } : d.form,
    }));
    setEditing({ kind: "field", fieldKey: key, sectionKey });
  }
  function placeField(sectionKey: string, fieldKey: string) {
    const field = fieldMap.get(fieldKey);
    if (!field) return;
    update((d) => ({ ...d, form: { sections: d.form.sections.map((section) => (section.section_key === sectionKey ? { ...section, fields: [...section.fields, { field_key: fieldKey, is_required: field.is_required, show_when: null }] } : section)) } }));
  }
  function unplaceField(sectionKey: string, fieldKey: string) {
    update((d) => ({ ...d, form: { sections: d.form.sections.map((section) => (section.section_key === sectionKey ? { ...section, fields: section.fields.filter((field) => field.field_key !== fieldKey) } : section)) } }));
  }
  function moveField(sectionKey: string, fieldKey: string, by: -1 | 1) {
    update((d) => ({
      ...d,
      form: {
        sections: d.form.sections.map((section) => {
          if (section.section_key !== sectionKey) return section;
          const index = section.fields.findIndex((field) => field.field_key === fieldKey);
          const target = index + by;
          if (index < 0 || target < 0 || target >= section.fields.length) return section;
          const fields = [...section.fields];
          [fields[index], fields[target]] = [fields[target], fields[index]];
          return { ...section, fields };
        }),
      },
    }));
  }
  function deleteField(fieldKey: string) {
    update((d) => ({ ...d, fields: d.fields.filter((field) => field.field_key !== fieldKey), form: { sections: d.form.sections.map((section) => ({ ...section, fields: section.fields.filter((field) => field.field_key !== fieldKey) })) } }));
    setEditing(null);
  }
  function removeSection(sectionKey: string) {
    update((d) => ({ ...d, form: { sections: d.form.sections.filter((section) => section.section_key !== sectionKey) } }));
    setEditing(null);
  }

  const editingField = editing?.kind === "field" ? fieldMap.get(editing.fieldKey) ?? null : null;
  const editingPlacementSection = editing?.kind === "field" && editing.sectionKey ? draft.form.sections.find((section) => section.section_key === editing.sectionKey) ?? null : null;
  const editingPlacement = editingPlacementSection && editing?.kind === "field" ? editingPlacementSection.fields.find((field) => field.field_key === editing.fieldKey) ?? null : null;
  const editingSection = editing?.kind === "section" ? draft.form.sections.find((section) => section.section_key === editing.sectionKey) ?? null : null;
  const commitLabel = changes.length === 1 ? "Commit the change" : `Commit all ${countWord(changes.length)}`;

  const fieldRow = (field: TemplateField | undefined, fieldKey: string, required: boolean, onEdit: () => void) => (
    <tr key={fieldKey}>
      <td className={st.td}>{field ? field.label : <span className="text-[var(--muted)]">{fieldKey} (no such field)</span>}</td>
      <td className={st.td}>{field ? TEMPLATE_FIELD_TYPE_TABLE_LABELS[field.type] ?? field.type : "—"}</td>
      <td className={st.td}>{required ? <Pill tone="success">Yes</Pill> : <Pill tone="neutral">No</Pill>}</td>
      <td className={st.td}>{field?.help_text ? field.help_text : <span className="text-[var(--muted)]">—</span>}</td>
      <td className={st.td}><button type="button" className={btn("row")} onClick={onEdit} aria-label={`Edit ${field?.label ?? fieldKey}`}>Edit</button></td>
    </tr>
  );
  const sectionRow = (key: string, label: ReactNode, onEdit?: () => void) => (
    <tr key={`section-${key}`}>
      <td className={st.td}><strong className="font-semibold text-[var(--muted)]">{label}</strong></td>
      <td className={cn(st.td, "text-[var(--muted)]")}>—</td>
      <td className={cn(st.td, "text-[var(--muted)]")}>—</td>
      <td className={cn(st.td, "text-[var(--muted)]")}>—</td>
      <td className={st.td}>{onEdit ? <button type="button" className={btn("row")} onClick={onEdit} aria-label={`Edit section ${typeof label === "string" ? label : ""}`}>Edit</button> : <span className="text-[var(--muted)]">—</span>}</td>
    </tr>
  );

  return (
    <SettingsStack>
      <SettingsSectionHeader actions={<DraftActions dirty={dirty} saving={saving} onDiscard={discard} onSave={() => void commit()} />} />

      <SettingsGrid>
        <Callout tone="info" title="A template is a contract with whoever fills it">
          Adding a required field changes what every partner must send from the moment it is committed; forms already in progress keep the version they started on. Draft changes are held in this browser until you commit them, and the count of pending changes is shown so a half-edited form is never live.
        </Callout>
        <SettingsCard pad={18}>
          <Field label="Template" htmlFor="template-product" hint={dirty ? "Commit or discard the pending changes to switch product." : "Each product has its own. A field added here is not added to the others."}>
            <select id="template-product" className={control} value={current.assignment.product_code} disabled={dirty || loading} onChange={(event) => void load(event.target.value)}>
              {productOptions.map((product) => <option key={product.code} value={product.code}>{product.name}</option>)}
            </select>
          </Field>
        </SettingsCard>
      </SettingsGrid>

      <SettingsTableCard
        title="Sections and fields"
        actions={
          <>
            {dirty && <Pill tone="warning" dot>{changes.length} {changes.length === 1 ? "change" : "changes"} before commit</Pill>}
            <button type="button" className={btn("secondary")} onClick={addSection}>Add a section</button>
          </>
        }
      >
        <table className={st.table}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Field</th>
              <th scope="col" className={cn(st.th, "w-[150px]")}>Type</th>
              <th scope="col" className={cn(st.th, "w-[120px]")}>Required</th>
              <th scope="col" className={cn(st.th, "w-[280px]")}>Help text</th>
              <th scope="col" className={cn(st.th, "w-[100px]")}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {draft.form.sections.map((section) => [
              sectionRow(section.section_key, section.label, () => setEditing({ kind: "section", sectionKey: section.section_key })),
              ...section.fields.map((formField) => {
                const field = fieldMap.get(formField.field_key);
                return fieldRow(field, `${section.section_key}:${formField.field_key}`, Boolean(field?.is_required || formField.is_required), () => setEditing({ kind: "field", fieldKey: formField.field_key, sectionKey: section.section_key }));
              }),
              section.fields.length === 0 ? (
                <tr key={`${section.section_key}-empty`}><td colSpan={5} className={cn(st.td, "text-[var(--muted)]")}>No fields in this section yet. Edit the section to add one.</td></tr>
              ) : null,
            ])}
            {unplaced.length > 0 && [
              sectionRow("unplaced", "Lead fields not on the partner form"),
              ...unplaced.map((field) => fieldRow(field, `unplaced:${field.field_key}`, field.is_required, () => setEditing({ kind: "field", fieldKey: field.field_key, sectionKey: null }))),
            ]}
          </tbody>
        </table>
        <div className="border-t border-[var(--border)] px-4 py-3">
          <button type="button" className={btn("row", "-ml-3")} onClick={() => addNewField(null)}><PlusIcon />Add a lead field</button>
        </div>
      </SettingsTableCard>

      <SettingsGrid>
        <SettingsCard title="Eligibility limits" sub="Enforced when a lead is submitted, and again when leads are imported.">
          {eligibility ? (
            <div className="flex flex-col gap-3.5">
              <Field label="Minimum age" htmlFor="eligibility-min" hint={`Read from ${eligibility.label}.`}>
                <input id="eligibility-min" className={control} type="number" min={0} max={130} value={eligibility.validation?.age_min ?? ""} onChange={(event) => setValidation(eligibility.field_key, { age_min: numberOrUndefined(event.target.value) })} />
              </Field>
              <Field label="Maximum age" htmlFor="eligibility-max">
                <input id="eligibility-max" className={control} type="number" min={0} max={130} value={eligibility.validation?.age_max ?? ""} onChange={(event) => setValidation(eligibility.field_key, { age_max: numberOrUndefined(event.target.value) })} />
              </Field>
            </div>
          ) : (
            <p className="m-0 text-[14px] leading-[1.5] text-[var(--muted)]">This form has no date-of-birth field, so it sets no age limits. Add a Date field for the date of birth to set them.</p>
          )}
        </SettingsCard>

        <SettingsCard title="Changes before commit" sub={dirty ? "Held in this browser, by you, this session. Nothing here is live yet." : undefined}>
          {dirty ? (
            <div className="flex flex-col gap-4">
              <Timeline
                items={changes.map((change) => {
                  const at = state?.seen[change.id];
                  const by = at ? `by you, ${clock.format(at)}` : "by you";
                  return { title: change.title, sub: change.sub ? `${change.sub} · ${by}` : `${by.charAt(0).toUpperCase()}${by.slice(1)}`, tone: "warning" as const };
                })}
              />
              {saveError && <Callout tone="error" title="Nothing was committed">{saveError}</Callout>}
              <div className="flex flex-wrap gap-2.5">
                <button type="button" className={btn("primary")} onClick={() => void commit()} disabled={saving}>{saving ? "Committing…" : commitLabel}</button>
                <button type="button" className={cn(btn("ghost"), "border-[var(--border-strong)] bg-[var(--surface)]")} onClick={discard} disabled={saving}>Discard</button>
              </div>
            </div>
          ) : (
            <p className="m-0 text-[14px] leading-[1.5] text-[var(--muted)]">No pending changes. This is the live form, version {current.assignment.definition_version}.</p>
          )}
        </SettingsCard>
      </SettingsGrid>

      {/* Not on the board, and relied on: the live form's name and version, platform template
          updates, the product's pipeline stages, and the partner preview. Kept below the board's
          content in the same two-column rhythm. */}
      <SettingsGrid>
        <SettingsCard
          title="Your active product form"
          action={current.latest ? (
            <button type="button" className={btn("secondary")} onClick={() => { const latest = available.find((template) => template.id === current.latest?.id && template.version === current.latest?.version) ?? null; setSelected(`${current.latest!.id}:${current.latest!.version}`); void showPreview(latest); }}>Review platform update</button>
          ) : undefined}
        >
          <div className="flex flex-col gap-4">
            <p className="m-0 text-[14px] leading-[1.5] text-[var(--body)]">
              <strong className={st.strong}>{current.template.name}</strong>
              <span className={st.sub}>{current.template.product_name} · {current.template.fields.length} fields · form version {current.assignment.definition_version}</span>
            </p>
            <Field label="Template name" htmlFor="copy-name">
              <input id="copy-name" className={control} maxLength={120} value={draft.name} onChange={(event) => { const name = event.target.value; update((d) => ({ ...d, name })); }} />
            </Field>
            <p className="m-0 flex flex-wrap items-center gap-2 text-[12px] leading-[1.5] text-[var(--muted)]">
              <Pill tone="neutral">Tenant-owned copy</Pill>
              Partner preview and submission read the same saved definition.
            </p>
          </div>
        </SettingsCard>

        <SettingsCard title="Platform templates" sub="Only products included in your subscription are shown. Applying adds what is missing; your customised fields, stages and form versions stay.">
          <div className="flex flex-col gap-3">
            <Field label="Template" htmlFor="platform-template">
              <select id="platform-template" className={control} value={selected} onChange={(event) => { setSelected(event.target.value); setPreview(null); }}>
                <option value="">Choose a template…</option>
                {productTemplates.map((template) => <option key={`${template.id}-${template.version}`} value={`${template.id}:${template.version}`}>{template.name} · v{template.version}</option>)}
              </select>
            </Field>
            <div className="flex flex-wrap gap-2.5">
              <button type="button" className={btn("secondary")} disabled={!chosen} onClick={() => void showPreview()}>Preview</button>
              <button type="button" className={btn("primary-sm")} disabled={!chosen || !preview || applying || dirty} onClick={() => void apply()}>{applying ? "Applying…" : "Apply"}</button>
            </div>
            {dirty && chosen && <p className="m-0 text-[12px] text-[var(--muted)]">Commit or discard the pending changes before applying a platform template.</p>}
            {chosen && preview && (
              <div className="rounded-[12px] border border-[var(--border)] bg-[var(--surface-alt)] px-4 py-3 text-[14px] leading-[1.5] text-[var(--body)]">
                <p className="m-0 font-semibold text-[var(--ink)]">{preview.alreadyApplied ? "Already applied" : "What applying adds"}</p>
                <p className="m-0 mt-1.5">Fields: {preview.fieldsToAdd.length ? preview.fieldsToAdd.join(", ") : "none"}</p>
                <p className="m-0">Form sections: {preview.sectionsToAdd.length ? preview.sectionsToAdd.join(", ") : "none"}</p>
                <p className="m-0">Stages: {preview.stagesToAdd.length ? preview.stagesToAdd.join(", ") : "none"}</p>
              </div>
            )}
          </div>
        </SettingsCard>
      </SettingsGrid>

      <SettingsGrid>
      <SettingsCard
        title="Pipeline stages"
        sub="The stages this product's leads move through. Part of the same draft."
        action={<button type="button" className={btn("secondary")} onClick={() => update((d) => ({ ...d, stages: [...d.stages, { stage_key: uniqueKey("custom_stage", new Set(d.stages.map((stage) => stage.stage_key))), label: "New stage", stage_type: "open", color: defaultStageColor() ?? d.stages[d.stages.length - 1]?.color ?? "", sort_order: d.stages.length }] }))}><PlusIcon />Add a stage</button>}
      >
        <div className="flex flex-col gap-4">
          {draft.stages.map((stage) => (
            <div key={stage.stage_key} className="flex flex-col gap-1">
            <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_120px_104px_auto]">
              <Field label="Label" htmlFor={`stage-label-${stage.stage_key}`}><input id={`stage-label-${stage.stage_key}`} className={small} maxLength={120} value={stage.label} onChange={(event) => { const label = event.target.value; update((d) => ({ ...d, stages: d.stages.map((item) => (item.stage_key === stage.stage_key ? { ...item, label } : item)) })); }} /></Field>
              <Field label="Closes as" htmlFor={`stage-type-${stage.stage_key}`}>
                <select id={`stage-type-${stage.stage_key}`} className={small} value={stage.stage_type} onChange={(event) => { const stage_type = event.target.value as TemplateStageType; update((d) => ({ ...d, stages: d.stages.map((item) => (item.stage_key === stage.stage_key ? { ...item, stage_type } : item)) })); }}>
                  {TEMPLATE_STAGE_TYPES.map((type) => <option key={type} value={type}>{TEMPLATE_STAGE_TYPE_LABELS[type]}</option>)}
                </select>
              </Field>
              <Field label="Colour" htmlFor={`stage-color-${stage.stage_key}`}><input id={`stage-color-${stage.stage_key}`} className={cn(small, "font-mono")} maxLength={7} value={stage.color} onChange={(event) => { const color = event.target.value; update((d) => ({ ...d, stages: d.stages.map((item) => (item.stage_key === stage.stage_key ? { ...item, color } : item)) })); }} /></Field>
              <button type="button" className={btn("danger-row", "mb-1.5")} onClick={() => update((d) => ({ ...d, stages: d.stages.filter((item) => item.stage_key !== stage.stage_key) }))} aria-label={`Remove stage ${stage.label}`}>Remove</button>
            </div>
            {/* The key was a read-only input; it reads as what it is, a fact about the stage. */}
            <span className="text-[12px] leading-[1.5] text-[var(--muted)]">Key <code className="font-mono text-[12px]">{stage.stage_key}</code></span>
            </div>
          ))}
        </div>
      </SettingsCard>

      <SectionAvailabilityCard
        form={draft.form}
        fields={draft.fields}
        onChange={(group, on) => update((d) => ({ ...d, form: { ...d.form, section_availability: { ...(d.form.section_availability ?? {}), [group]: on } } }))}
      />
      </SettingsGrid>

      {previewSource && <PartnerViewPreview source={previewSource} productCode={current.assignment.product_code} productName={current.template.product_name} />}

      <SettingsDialog open={Boolean(editingField)} onOpenChange={(open) => { if (!open) setEditing(null); }} title={editingField ? `Edit “${editingField.label}”` : "Edit field"} description="Edits join the draft as you make them. Commit to make them live.">
        {editingField && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Key" htmlFor="field-edit-key" hint="Stored with every lead, so it does not change.">
                <input id="field-edit-key" className={cn(control, "font-mono")} value={editingField.field_key} readOnly />
              </Field>
              <Field label="Type" htmlFor="field-edit-type">
                <select id="field-edit-type" className={control} value={editingField.type} onChange={(event) => { const type = event.target.value as TemplateField["type"]; setField(editingField.field_key, { type, options: ["single_select", "multi_select"].includes(type) ? editingField.options : [] }); }}>
                  {TEMPLATE_FIELD_TYPES.map((type) => <option key={type} value={type}>{TEMPLATE_FIELD_TYPE_LABELS[type]}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Label" htmlFor="field-edit-label" required>
              <input id="field-edit-label" className={control} maxLength={120} value={editingField.label} onChange={(event) => setField(editingField.field_key, { label: event.target.value })} />
            </Field>
            <Field label="Help text" htmlFor="field-edit-help" hint="Shown to partners under the field.">
              <input id="field-edit-help" className={control} maxLength={500} value={editingField.help_text ?? ""} onChange={(event) => setField(editingField.field_key, { help_text: event.target.value })} />
            </Field>
            <ToggleRow id="field-edit-required" title="Required on every form" help="A lead cannot be saved without it, from any source." checked={editingField.is_required} onChange={(is_required) => setField(editingField.field_key, { is_required })} />
            {["single_select", "multi_select"].includes(editingField.type) && (
              <Field label="Options" htmlFor="field-edit-options" hint="Separate options with commas.">
                <input id="field-edit-options" className={control} value={editingField.options.join(", ")} onChange={(event) => setField(editingField.field_key, { options: event.target.value.split(",").map((option) => option.trim()).filter(Boolean) })} placeholder="Yes, No" />
              </Field>
            )}
            <fieldset className="m-0 flex flex-col gap-3 rounded-[12px] border border-[var(--border)] p-4">
              <legend className="px-1 text-[14px] font-semibold text-[var(--ink)]">Validation rules</legend>
              {["number", "currency"].includes(editingField.type) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Minimum" htmlFor="field-edit-min"><input id="field-edit-min" className={small} type="number" value={editingField.validation?.min ?? ""} onChange={(event) => setValidation(editingField.field_key, { min: numberOrUndefined(event.target.value) })} /></Field>
                  <Field label="Maximum" htmlFor="field-edit-max"><input id="field-edit-max" className={small} type="number" value={editingField.validation?.max ?? ""} onChange={(event) => setValidation(editingField.field_key, { max: numberOrUndefined(event.target.value) })} /></Field>
                </div>
              )}
              {editingField.type === "date" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Minimum age" htmlFor="field-edit-age-min"><input id="field-edit-age-min" className={small} type="number" value={editingField.validation?.age_min ?? ""} onChange={(event) => setValidation(editingField.field_key, { age_min: numberOrUndefined(event.target.value) })} /></Field>
                  <Field label="Maximum age" htmlFor="field-edit-age-max"><input id="field-edit-age-max" className={small} type="number" value={editingField.validation?.age_max ?? ""} onChange={(event) => setValidation(editingField.field_key, { age_max: numberOrUndefined(event.target.value) })} /></Field>
                </div>
              )}
              {["text", "long_text", "phone", "email", "ssn"].includes(editingField.type) && (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Minimum length" htmlFor="field-edit-min-length"><input id="field-edit-min-length" className={small} type="number" value={editingField.validation?.min_length ?? ""} onChange={(event) => setValidation(editingField.field_key, { min_length: numberOrUndefined(event.target.value) })} /></Field>
                    <Field label="Maximum length" htmlFor="field-edit-max-length"><input id="field-edit-max-length" className={small} type="number" value={editingField.validation?.max_length ?? ""} onChange={(event) => setValidation(editingField.field_key, { max_length: numberOrUndefined(event.target.value) })} /></Field>
                  </div>
                  <Field label="Pattern" htmlFor="field-edit-pattern" hint="Optional regular expression, e.g. ^[A-Z]">
                    <input id="field-edit-pattern" className={small} maxLength={200} value={editingField.validation?.pattern ?? ""} onChange={(event) => setValidation(editingField.field_key, { pattern: event.target.value || undefined })} />
                  </Field>
                </>
              )}
              {["boolean", "single_select", "multi_select"].includes(editingField.type) && <p className="m-0 text-[14px] text-[var(--muted)]">This type has no validation rules; its options are the rule.</p>}
              {editingField.type === "bank_routing" && <p className="m-0 text-[14px] text-[var(--muted)]">Always nine digits that pass the bank routing checksum. Stored as the digits alone.</p>}
              {editingField.type === "bank_account" && <p className="m-0 text-[14px] text-[var(--muted)]">Always {BANK_ACCOUNT_MIN_DIGITS} to {BANK_ACCOUNT_MAX_DIGITS} digits. Stored as the digits alone.</p>}
            </fieldset>

            {editingPlacementSection && editingPlacement && (
              <fieldset className="m-0 flex flex-col gap-3 rounded-[12px] border border-[var(--border)] p-4">
                <legend className="px-1 text-[14px] font-semibold text-[var(--ink)]">On the partner form, in “{editingPlacementSection.label}”</legend>
                <ToggleRow id="field-edit-form-required" title="Required on this form" help="Partners must answer it here even when the lead field itself is optional." checked={editingPlacement.is_required} onChange={(is_required) => setPlacement(editingPlacementSection.section_key, editingField.field_key, { is_required })} />
                <ToggleRow
                  id="field-edit-conditional"
                  title="Show only when another field matches"
                  checked={Boolean(editingPlacement.show_when ?? editingPlacement.conditional_on)}
                  onChange={(on) => setPlacement(editingPlacementSection.section_key, editingField.field_key, { show_when: on ? { field_key: draft.fields.find((field) => field.field_key !== editingField.field_key)?.field_key ?? editingField.field_key, equals: "" } : null, conditional_on: null })}
                />
                {(editingPlacement.show_when ?? editingPlacement.conditional_on) && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="When" htmlFor="field-edit-when">
                      <select id="field-edit-when" className={small} value={(editingPlacement.show_when ?? editingPlacement.conditional_on)?.field_key} onChange={(event) => setPlacement(editingPlacementSection.section_key, editingField.field_key, { show_when: { field_key: event.target.value, equals: (editingPlacement.show_when ?? editingPlacement.conditional_on)?.equals ?? "" }, conditional_on: null })}>
                        {draft.fields.map((field) => <option key={field.field_key} value={field.field_key}>{field.label}</option>)}
                      </select>
                    </Field>
                    <Field label="Equals" htmlFor="field-edit-equals">
                      <input id="field-edit-equals" className={small} value={(editingPlacement.show_when ?? editingPlacement.conditional_on)?.equals ?? ""} onChange={(event) => setPlacement(editingPlacementSection.section_key, editingField.field_key, { show_when: { field_key: (editingPlacement.show_when ?? editingPlacement.conditional_on)?.field_key ?? editingField.field_key, equals: event.target.value }, conditional_on: null })} />
                    </Field>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btn("secondary")} onClick={() => moveField(editingPlacementSection.section_key, editingField.field_key, -1)}>Move up</button>
                  <button type="button" className={btn("secondary")} onClick={() => moveField(editingPlacementSection.section_key, editingField.field_key, 1)}>Move down</button>
                  <button type="button" className={btn("danger-row")} onClick={() => { unplaceField(editingPlacementSection.section_key, editingField.field_key); setEditing({ kind: "field", fieldKey: editingField.field_key, sectionKey: null }); }}>Remove from this section</button>
                </div>
              </fieldset>
            )}

            <div className="flex flex-wrap justify-between gap-2.5">
              <button type="button" className={btn("danger-row")} onClick={() => deleteField(editingField.field_key)}>Delete the field</button>
              <button type="button" className={btn("primary")} onClick={() => setEditing(null)}>Done</button>
            </div>
          </div>
        )}
      </SettingsDialog>

      <SettingsDialog open={Boolean(editingSection)} onOpenChange={(open) => { if (!open) setEditing(null); }} title={editingSection ? `Edit section “${editingSection.label}”` : "Edit section"} description="Edits join the draft as you make them. Commit to make them live.">
        {editingSection && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Key" htmlFor="section-edit-key"><input id="section-edit-key" className={cn(control, "font-mono")} value={editingSection.section_key} readOnly /></Field>
              <Field label="Label" htmlFor="section-edit-label" required><input id="section-edit-label" className={control} maxLength={120} value={editingSection.label} onChange={(event) => setSection(editingSection.section_key, { label: event.target.value })} /></Field>
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">Fields in this section</span>
              {editingSection.fields.length === 0 && <p className="m-0 text-[14px] text-[var(--muted)]">None yet.</p>}
              {editingSection.fields.map((formField) => (
                <div key={formField.field_key} className="flex items-center justify-between gap-3 rounded-[8px] bg-[var(--surface-alt)] px-3 py-2 text-[14px]">
                  <span>{fieldMap.get(formField.field_key)?.label ?? formField.field_key}</span>
                  <button type="button" className={btn("row")} onClick={() => setEditing({ kind: "field", fieldKey: formField.field_key, sectionKey: editingSection.section_key })}>Edit</button>
                </div>
              ))}
            </div>
            <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
              <Field label="Add an existing field" htmlFor="section-edit-existing">
                <select id="section-edit-existing" className={small} defaultValue="" onChange={(event) => { if (event.target.value) { placeField(editingSection.section_key, event.target.value); event.target.value = ""; } }}>
                  <option value="">Choose a field…</option>
                  {draft.fields.filter((field) => !editingSection.fields.some((item) => item.field_key === field.field_key)).map((field) => <option key={field.field_key} value={field.field_key}>{field.label}</option>)}
                </select>
              </Field>
              <button type="button" className={btn("secondary", "mb-1")} onClick={() => addNewField(editingSection.section_key)}><PlusIcon />New field</button>
            </div>
            <div className="flex flex-wrap justify-between gap-2.5">
              <button type="button" className={btn("danger-row")} onClick={() => removeSection(editingSection.section_key)} disabled={draft.form.sections.length <= 1}>Remove the section</button>
              <button type="button" className={btn("primary")} onClick={() => setEditing(null)}>Done</button>
            </div>
          </div>
        )}
      </SettingsDialog>
    </SettingsStack>
  );
}
