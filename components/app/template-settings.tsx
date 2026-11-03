"use client";

/**
 * Settings › Form templates, layout A (owner pick 2026-10-30; canvas page settings-form-templates):
 * the form partners fill in, with one side panel beside it that shows the form's settings until a
 * question is picked, then that question. The title's line says Live, or N changes with Review,
 * Undo all and Publish version N — the page's only green button.
 *
 * The whole form is one draft. Every edit — a question, a part, an age limit, the name — is held in
 * this browser until it is published as one new immutable form version. Partner drafts already in
 * progress stay pinned to the version they started on (the RPC's contract, unchanged). Stages are
 * edited in Pipelines & outcomes only (owner, 2026-10-27); the draft still sends the template's own
 * stages unchanged.
 *
 * This file owns loading, the draft and publishing; the parts it draws live in components/app/form-templates.
 */

import { useEffect, useMemo, useState } from "react";

import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionLoading } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import { Callout, SettingsSectionHeader, SettingsStack } from "@/components/app/settings/primitives";
import { ProductChips } from "@/components/app/form-templates/product-chips";
import { PartnerLeadForm, type PartnerFormPreviewSource } from "@/components/partner/partner-portal-workspace";
import type { TemplateField, TemplateFieldType, TemplateFormDefinition, TemplateFormField, TemplateRow, TemplateValidation } from "@/lib/templates/constants";
import { moveFieldWithinSection, moveSection } from "@/lib/templates/formMoves";
import { applyRequiredChoice, type RequiredChoice } from "@/lib/templates/plainLabels";
import { sectionAvailability, sectionAvailabilityError, sectionsByGroup } from "@/lib/templates/sectionAvailability";
import { diffTemplateDraft, eligibilityFieldKey, type TemplateDraft } from "@/lib/agentTemplates/draftChanges";
import { parseSettingsHash } from "@/lib/settings/registry";
import { draftFrom, uniqueKey, type Available, type Current, type DraftState, type Preview, type Product, type Published } from "@/components/app/form-templates/draft";
import { FormCanvas, type Picked } from "@/components/app/form-templates/form-canvas";
import { QuestionPanel } from "@/components/app/form-templates/question-panel";
import { FormSettingsPanel } from "@/components/app/form-templates/form-settings";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { PublishBar, PublishControls, SETTINGS_TABS, type SettingsTab } from "@/components/app/form-templates/status-line";
import { publishBlockers } from "@/lib/templates/publishBlockers";
import { SIDE_BY_SIDE, SidePanelHost } from "@/components/app/form-templates/side-panel-host";

const PREVIEW_MARKET = { carrier_id: "", carrier_name: "", state: "" };
/** Undo toasts sit at the foot, clear of the Publish controls at the end of the title's line (board FtE07). */
const UNDO_AT = "bottom-center" as const;


/** Every place a question sits, so "changed" can tell a moved or re-required question from an untouched one. */
function placementsOf(form: TemplateFormDefinition, fieldKey: string) {
  return form.sections.flatMap((section) => section.fields.map((field, index) => ({ section: section.section_key, index, field })).filter((item) => item.field.field_key === fieldKey));
}
const withSections = (d: TemplateDraft, fn: (sections: TemplateFormDefinition["sections"]) => TemplateFormDefinition["sections"]): TemplateDraft => ({ ...d, form: { ...d.form, sections: fn(d.form.sections) } });

/* ── the section ───────────────────────────────────────────────────────── */

export function TemplateSettings() {
  const [current, setCurrent] = useState<Current | null>(null);
  const [available, setAvailable] = useState<Available[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  // The partner form shows the agency by name; the preview shows the same name (LA-1.4-5).
  const [agencyName, setAgencyName] = useState<string | null>(null);
  const [state, setState] = useState<DraftState | null>(null);
  const [selected, setSelected] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [picked, setPicked] = useState<Picked>(null);
  /** The live version's publisher and time; null when unknown. */
  const [published, setPublished] = useState<Published | null>(null);
  /** Each product's live form version, for its chip. */
  const [liveVersions, setLiveVersions] = useState<Record<string, number>>({});
  /** The "This form" panel: open beside the form on wide screens, a sheet opened on demand below. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Which of its rows is open. */
  const [settingsRow, setSettingsRow] = useState<SettingsTab | null>(null);
  const [trying, setTrying] = useState(false);
  /** A product switch waiting on Publish / Discard / Stay. */
  const [switchTo, setSwitchTo] = useState<string | null>(null);
  /** A part with questions in it, waiting on its remove confirmation. */
  const [removing, setRemoving] = useState<string | null>(null);

  // The side panel starts open where it sits beside the form; on smaller screens it waits for the button.
  // It follows the width: narrowing to a sheet closes it, so it never covers the form unasked.
  useEffect(() => {
    const query = window.matchMedia(SIDE_BY_SIDE);
    const sync = () => setSettingsOpen(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  async function load(product?: string) {
    setLoading(true);
    const url = product ? `/api/app/templates?product=${encodeURIComponent(product)}` : "/api/app/templates";
    const response = await fetch(url, { cache: "no-store" }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setLoading(false);
    if (!response?.ok) { setError(body?.error ?? "Your form templates didn’t load."); return; }
    setError("");
    setCurrent(body.current);
    setAvailable(body.templates ?? []);
    setProducts(body.products ?? []);
    setAgencyName(typeof body.agencyName === "string" ? body.agencyName : null);
    setPublished(body.published && typeof body.published.at === "string" ? body.published : null);
    setLiveVersions(body.liveVersions && typeof body.liveVersions === "object" ? body.liveVersions : {});
    setState(body.current ? { draft: draftFrom(body.current), seen: {} } : null);
    setSaveError("");
    setSelected("");
    setPreview(null);
    setPicked(null);
  }
  // Initial data is external server state; this effect hydrates the interactive editor.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);

  // "#form-templates/form-lead-steps" (the settings search) opens the side panel on that row.
  useEffect(() => {
    const fromHash = () => {
      const { tab, anchor } = parseSettingsHash(window.location.hash);
      const hit = tab === "form-templates" ? SETTINGS_TABS.find((item) => item.anchor === anchor) : null;
      if (hit) { setPicked(null); setSettingsOpen(true); setSettingsRow(hit.key); }
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const saved = useMemo(() => (current ? draftFrom(current) : null), [current]);
  const draft = state?.draft ?? null;
  const changes = useMemo(() => (saved && draft ? diffTemplateDraft(saved, draft) : []), [saved, draft]);
  const dirty = changes.length > 0;
  const changed = useMemo(() => {
    const keys = new Set<string>();
    if (!saved || !draft) return keys;
    const before = new Map(saved.fields.map((field) => [field.field_key, field]));
    for (const field of draft.fields) {
      const was = before.get(field.field_key);
      if (!was || JSON.stringify(was) !== JSON.stringify(field) || JSON.stringify(placementsOf(saved.form, field.field_key)) !== JSON.stringify(placementsOf(draft.form, field.field_key))) keys.add(field.field_key);
    }
    return keys;
  }, [saved, draft]);
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
  function discard() { if (current) setState({ draft: draftFrom(current), seen: {} }); setSaveError(""); setPicked(null); }

  async function publish(): Promise<boolean> {
    if (!current || !draft) return false;
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
    }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setSaving(false);
    if (!response?.ok) { const message = body?.error ?? "The form couldn’t be published"; setSaveError(message); notify.block(message); return false; }
    notify.done("Published. Partners get the new form now", { detail: "Anyone who already started a form finishes it the old way." });
    return true;
  }

  const chosen = available.find((template) => `${template.id}:${template.version}` === selected);
  async function showPreview(template: Available | null = chosen ?? null) {
    if (!template) return;
    const response = await fetch("/api/app/templates/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template_id: template.id, template_version: template.version }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) { notify.block(body?.error ?? "Couldn’t read that template"); return; }
    setPreview(body.preview);
  }
  async function apply() {
    if (!chosen || !current) return;
    setApplying(true);
    const response = await fetch("/api/app/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template_id: chosen.id, template_version: chosen.version }) });
    const body = await response.json().catch(() => null);
    setApplying(false);
    if (!response.ok) { notify.block(body?.error ?? "Couldn’t add that template"); return; }
    notify.done("Template added; new forms use the new version");
    await load(current.assignment.product_code);
  }

  if (!current || !draft || !saved) {
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        {error ? (
          <Callout tone="error" title={error}>
            <Button onClick={() => void load()} type="button" variant="outline" className="mt-2">Try again</Button>
          </Callout>
        ) : loading ? (
          <TableCard><SectionLoading label="Reading your form templates" /></TableCard>
        ) : (
          <Callout tone="info" title="No form is set up yet.">Every product needs a form before partners can send leads for it. Ask Insurvas support to add one.</Callout>
        )}
      </SettingsStack>
    );
  }

  const productCode = current.assignment.product_code;
  const fieldMap = new Map(draft.fields.map((field) => [field.field_key, field]));
  const eligibilityKey = eligibilityFieldKey(draft.fields);
  const eligibility = eligibilityKey ? fieldMap.get(eligibilityKey) ?? null : null;
  const productOptions = products.some((product) => product.code === productCode) ? products : [{ code: productCode, name: current.template.product_name }, ...products];
  const word = changes.length === 1 ? "change" : "changes";
  const blockers = publishBlockers(draft.form, draft.fields);

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
  const setPlacement = (sectionKey: string, fieldKey: string, patch: Partial<TemplateFormField>) =>
    update((d) => withSections(d, (sections) => sections.map((section) => (section.section_key === sectionKey ? { ...section, fields: section.fields.map((field) => (field.field_key === fieldKey ? { ...field, ...patch } : field)) } : section))));

  function newField(type: TemplateFieldType): TemplateField {
    const key = uniqueKey("custom_field", new Set(draft!.fields.map((field) => field.field_key)));
    return { field_key: key, label: "New question", type, is_required: false, options: ["single_select", "multi_select"].includes(type) ? ["First choice", "Second choice"] : [], sort_order: draft!.fields.length, help_text: null, validation: {} };
  }
  function addQuestion(sectionKey: string, type: TemplateFieldType) {
    const field = newField(type);
    update((d) => withSections({ ...d, fields: [...d.fields, field] }, (sections) => sections.map((section) => (section.section_key === sectionKey ? { ...section, fields: [...section.fields, { field_key: field.field_key, is_required: false, show_when: null }] } : section))));
    setPicked({ fieldKey: field.field_key, sectionKey });
  }
  function addAgentField() {
    const field = newField("text");
    update((d) => ({ ...d, fields: [...d.fields, field] }));
    setPicked({ fieldKey: field.field_key, sectionKey: null });
  }
  function reuse(sectionKey: string, fieldKey: string) {
    const field = fieldMap.get(fieldKey);
    if (!field) return;
    update((d) => withSections(d, (sections) => sections.map((section) => (section.section_key === sectionKey ? { ...section, fields: [...section.fields, { field_key: fieldKey, is_required: field.is_required, show_when: null }] } : section))));
    setPicked({ fieldKey, sectionKey });
  }
  function moveTo(fieldKey: string, from: string | null, to: string | null) {
    if (from === to) return;
    update((d) => withSections(d, (sections) => {
      const kept = from ? sections.find((section) => section.section_key === from)?.fields.find((field) => field.field_key === fieldKey) : null;
      return sections.map((section) => {
        if (section.section_key === from) return { ...section, fields: section.fields.filter((field) => field.field_key !== fieldKey) };
        if (section.section_key === to && !section.fields.some((field) => field.field_key === fieldKey)) return { ...section, fields: [...section.fields, kept ?? { field_key: fieldKey, is_required: false, show_when: null }] };
        return section;
      });
    }));
    setPicked({ fieldKey, sectionKey: to });
  }
  function setRequired(fieldKey: string, sectionKey: string | null, choice: RequiredChoice) {
    const flags = applyRequiredChoice(choice, Boolean(sectionKey));
    update((d) => {
      const next = { ...d, fields: d.fields.map((field) => (field.field_key === fieldKey ? { ...field, is_required: flags.field } : field)) };
      return sectionKey && flags.placement !== null
        ? withSections(next, (sections) => sections.map((section) => (section.section_key === sectionKey ? { ...section, fields: section.fields.map((field) => (field.field_key === fieldKey ? { ...field, is_required: flags.placement! } : field)) } : section)))
        : next;
    });
  }
  /** "Put back how it was": the question's own settings and, in this part, its required and show-when. */
  function resetQuestion(fieldKey: string, sectionKey: string | null) {
    const was = saved!.fields.find((field) => field.field_key === fieldKey);
    if (!was) return;
    const wasPlacement = sectionKey ? saved!.form.sections.find((section) => section.section_key === sectionKey)?.fields.find((field) => field.field_key === fieldKey) : null;
    update((d) => {
      const next = { ...d, fields: d.fields.map((field) => (field.field_key === fieldKey ? { ...was, options: [...was.options], validation: { ...(was.validation ?? {}) } } : field)) };
      return wasPlacement && sectionKey ? withSections(next, (sections) => sections.map((section) => (section.section_key === sectionKey ? { ...section, fields: section.fields.map((field) => (field.field_key === fieldKey ? { ...wasPlacement } : field)) } : section))) : next;
    });
  }
  /** Undo, not confirm: the draft before the delete is kept for the toast's Undo. */
  function deleteField(fieldKey: string) {
    const before = draft!;
    const label = fieldMap.get(fieldKey)?.label || "the question";
    update((d) => withSections({ ...d, fields: d.fields.filter((field) => field.field_key !== fieldKey) }, (sections) => sections.map((section) => ({ ...section, fields: section.fields.filter((field) => field.field_key !== fieldKey) }))));
    setPicked(null);
    notify.done(`Deleted “${label}”`, { action: { label: "Undo", onClick: () => update(() => before) }, durationMs: 6000, position: UNDO_AT });
  }
  function addSection() {
    const key = uniqueKey("section", new Set(draft!.form.sections.map((section) => section.section_key)));
    update((d) => withSections(d, (sections) => [...sections, { section_key: key, label: `Part ${sections.length + 1}`, fields: [], sort_order: sections.length }]));
    // The new part's name is ready to type over.
    requestAnimationFrame(() => document.getElementById(`part-name-${key}`)?.focus());
  }
  function removeSection(sectionKey: string) {
    const before = draft!;
    const label = draft!.form.sections.find((section) => section.section_key === sectionKey)?.label || "the part";
    update((d) => withSections(d, (sections) => sections.filter((section) => section.section_key !== sectionKey)));
    if (picked?.sectionKey === sectionKey) setPicked(null);
    setRemoving(null);
    notify.done(`Removed “${label}”`, { action: { label: "Undo", onClick: () => update(() => before) }, durationMs: 6000, position: UNDO_AT });
  }
  function askRemoveSection(sectionKey: string) {
    const section = draft!.form.sections.find((item) => item.section_key === sectionKey);
    if (section?.fields.length) setRemoving(sectionKey);
    else removeSection(sectionKey);
  }
  function switchProduct(code: string) {
    if (code === productCode || loading) return;
    if (dirty) setSwitchTo(code);
    else void load(code);
  }

  const pickedField = picked ? fieldMap.get(picked.fieldKey) ?? null : null;
  const pickedPlacement = picked?.sectionKey ? draft.form.sections.find((section) => section.section_key === picked.sectionKey)?.fields.find((field) => field.field_key === picked.fieldKey) ?? null : null;
  const groups = sectionAvailability(draft.form);
  const governed = sectionsByGroup(draft.form);
  const topics = (Object.keys(governed) as Array<keyof typeof governed>).filter((group) => governed[group].length > 0);
  const topicsOn = topics.filter((group) => groups[group]).length;
  const ages = eligibility ? [eligibility.validation?.age_min, eligibility.validation?.age_max] : null;
  const placed = new Set(draft.form.sections.flatMap((section) => section.fields.map((field) => field.field_key)));
  const agentsOnly = draft.fields.filter((field) => !placed.has(field.field_key));
  const settingValues: Record<SettingsTab, { text: string; tone?: "warn" | "info" }> = {
    who: { text: !ages ? "Anyone" : ages[0] != null && ages[1] != null ? `Ages ${ages[0]}–${ages[1]}` : ages[0] != null ? `Ages ${ages[0]}+` : ages[1] != null ? `Up to age ${ages[1]}` : "Any age" },
    parts: { text: topics.length ? `${topicsOn} of ${topics.length} on` : "None on this form", tone: sectionAvailabilityError(draft.form, draft.fields) ? "warn" : undefined },
    steps: { text: "Set in Pipelines & outcomes" },
    versions: current.latest ? { text: `Insurvas version ${current.latest.version} is out`, tone: "info" } : { text: `Version ${current.assignment.definition_version} live` },
    agents: { text: `${agentsOnly.length} ${agentsOnly.length === 1 ? "question" : "questions"}` },
  };
  const removingSection = removing ? draft.form.sections.find((section) => section.section_key === removing) ?? null : null;
  const switchName = switchTo ? productOptions.find((product) => product.code === switchTo)?.name ?? "the other product" : "";
  const publishAndReload = () => void publish().then((ok) => { if (ok) void load(productCode); });

  return (
    <SettingsStack>
      <SettingsSectionHeader
        actions={
          <PublishControls
            changes={changes}
            seen={state?.seen ?? {}}
            liveVersion={current.assignment.definition_version}
            blockers={blockers}
            saving={saving}
            onUndoAll={discard}
            onPublish={publishAndReload}
          />
        }
      />
      <LeaveGuard dirty={dirty} onDiscard={discard} onSave={publish} what="the form draft" />

      {saveError && (
        <Callout tone="error" title={`Nothing was published: ${saveError}`}>
          <Button onClick={publishAndReload} type="button" variant="outline" className="mt-2" disabled={saving}>Try again</Button>
        </Callout>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <ProductChips products={productOptions} value={productCode} changes={changes.length} liveVersions={liveVersions} onChange={switchProduct} />
        {!settingsOpen && !picked && <Button onClick={() => setSettingsOpen(true)} type="button" variant="outline" className="ml-auto">Form settings</Button>}
      </div>

      <div className="flex min-w-0 flex-col gap-5 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          <FormCanvas
            form={draft.form}
            fields={draft.fields}
            productName={current.template.product_name}
            picked={picked}
            changed={changed}
            onPick={(fieldKey, sectionKey) => setPicked({ fieldKey, sectionKey })}
            onMoveField={(sectionKey, fieldKey, by) => update((d) => ({ ...d, form: moveFieldWithinSection(d.form, sectionKey, fieldKey, by) }))}
            onWidth={(sectionKey, fieldKey, width) => setPlacement(sectionKey, fieldKey, { width })}
            onDeleteField={deleteField}
            onRenameSection={(sectionKey, label) => update((d) => withSections(d, (sections) => sections.map((section) => (section.section_key === sectionKey ? { ...section, label } : section))))}
            onMoveSection={(sectionKey, by) => update((d) => ({ ...d, form: moveSection(d.form, sectionKey, by) }))}
            onRemoveSection={askRemoveSection}
            onAddQuestion={addQuestion}
            onReuse={reuse}
            onAddSection={addSection}
            onTry={() => setTrying(true)}
          />
        </div>
        {/* One side panel: the picked question, else the form's own settings. */}
        <SidePanelHost>
        {picked && pickedField ? (
          <QuestionPanel
            field={pickedField}
            fields={draft.fields}
            form={draft.form}
            sectionKey={picked.sectionKey}
            placement={pickedPlacement}
            changed={changed.has(pickedField.field_key)}
            setField={setField}
            setValidation={setValidation}
            setPlacement={setPlacement}
            onRequired={(choice) => setRequired(pickedField.field_key, picked.sectionKey, choice)}
            onMoveTo={(to) => moveTo(pickedField.field_key, picked.sectionKey, to)}
            onReset={saved.fields.some((field) => field.field_key === pickedField.field_key) && changed.has(pickedField.field_key) ? () => resetQuestion(pickedField.field_key, picked.sectionKey) : null}
            onDelete={() => deleteField(pickedField.field_key)}
            onBack={() => { setPicked(null); setSettingsOpen(true); }}
            onClose={() => setPicked(null)}
          />
        ) : settingsOpen && (
          <FormSettingsPanel
            open={settingsRow}
            onOpen={setSettingsRow}
            onClose={() => setSettingsOpen(false)}
            values={settingValues}
            eligibility={eligibility}
            onAges={(patch) => { if (eligibility) setValidation(eligibility.field_key, patch); }}
            form={draft.form}
            fields={draft.fields}
            onGroup={(group, on) => update((d) => ({ ...d, form: { ...d.form, section_availability: { ...(d.form.section_availability ?? {}), [group]: on } } }))}
            versions={{
              current,
              published,
              name: draft.name,
              onName: (name) => update((d) => ({ ...d, name })),
              templates: available.filter((template) => template.product_code === productCode),
              selected,
              chosen,
              preview,
              applying,
              dirty,
              onSelect: (value) => { setSelected(value); setPreview(null); },
              onPreview: () => void showPreview(),
              onApply: () => void apply(),
            }}
            agents={{
              fields: agentsOnly,
              picked: picked?.sectionKey === null ? picked.fieldKey : null,
              changed,
              onPick: (fieldKey) => setPicked({ fieldKey, sectionKey: null }),
              onAdd: addAgentField,
            }}
          />
        )}
        </SidePanelHost>
      </div>

      <PublishBar
        changes={changes}
        seen={state?.seen ?? {}}
        liveVersion={current.assignment.definition_version}
        blockers={blockers}
        saving={saving}
        onUndoAll={discard}
        onPublish={publishAndReload}
      />

      {/* "Try the form": the partner's own form component, fed this draft, so show-when runs for real (LA-1.4-5). */}
      <Dialog open={trying} onOpenChange={setTrying}>
        <DialogContent className="max-h-[88vh] overflow-y-auto border-[var(--border)] bg-[var(--surface)] text-[var(--body)] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-title-sm text-[var(--ink)]">Try the form</DialogTitle>
            <DialogDescription className="text-sm leading-[1.5] text-[var(--body)]">Fill it in as a partner would. Nothing is saved or sent.</DialogDescription>
          </DialogHeader>
          {previewSource && (
            <div className="portal-partner-submit-page">
              <PartnerLeadForm productCode={productCode} productName={current.template.product_name} partnerStatus="active" market={PREVIEW_MARKET} preview={previewSource} agencyName={agencyName} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(switchTo)} onOpenChange={(open) => { if (!open) setSwitchTo(null); }}>
        <DialogContent className="border-[var(--border)] bg-[var(--surface)] text-[var(--body)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-title-sm text-[var(--ink)]">Publish your {changes.length} {word} first?</DialogTitle>
            <DialogDescription className="text-sm leading-[1.5] text-[var(--body)]">They are on the {current.template.product_name} form and not live yet. Opening {switchName} drops them unless you publish.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button onClick={() => setSwitchTo(null)} type="button" variant="ghost">Stay here</Button>
            <Button onClick={() => { const next = switchTo; setSwitchTo(null); if (next) void load(next); }} type="button" variant="outline">Drop them</Button>
            <Button onClick={() => { const next = switchTo; setSwitchTo(null); void publish().then((ok) => { if (ok && next) void load(next); }); }} type="button" disabled={saving}>Publish, then open</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(removingSection)} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
        <DialogContent className="border-[var(--border)] bg-[var(--surface)] text-[var(--body)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-title-sm text-[var(--ink)]">Remove “{removingSection?.label}”?</DialogTitle>
            <DialogDescription className="text-sm leading-[1.5] text-[var(--body)]">
              Partners stop seeing its {removingSection?.fields.length} {removingSection?.fields.length === 1 ? "question" : "questions"}. They stay saved on leads, under For your agents only.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button onClick={() => setRemoving(null)} type="button" variant="ghost">Keep it</Button>
            <Button onClick={() => { if (removing) removeSection(removing); }} type="button" variant="destructive">Remove the part</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsStack>
  );
}
