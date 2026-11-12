"use client";

/**
 * Settings › Application forms, round 8 option A, "Three-pane builder" (owner pick 2026-11-12,
 * docs/design/settings-r8/application-forms.html).
 *
 *   Forms list   every form, one per product today (several once 20261112200000 is applied), with
 *                its version, what it did in 30 days and its status; New form opens a sheet
 *   Build        field library left (drag in), the form's pages centre (drag handles), the picked
 *                question's Field / Logic / Validation right
 *   Settings     who can apply, pages & topics, where leads go, the form's webhook, agents-only
 *                questions, versions & Insurvas updates
 *   Results      starts, sends and where people stop
 *   Versions     every published version, what changed, Restore; Publish asks once, from the title line
 *
 * The whole form is one draft until Publish makes it the next immutable version. The draft is kept on
 * this computer as it changes, and saved to Insurvas when the migration is live, so closing the tab
 * loses nothing. Partner drafts already in progress stay pinned to the version they started on.
 * Stages are edited in Pipelines & outcomes only (owner, 2026-10-27); the draft sends them unchanged.
 *
 * This file owns loading, the draft and publishing; the parts it draws live in components/app/form-templates.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Eye, FlaskConical, Share2 } from "lucide-react";

import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { Segmented, ViewTabs } from "@/components/ui/view-tabs";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { ResetToDefault } from "@/components/app/settings/defaults";
import { SettingsSectionHeader, SettingsStack } from "@/components/app/settings/primitives";
import { PartnerLeadForm, type PartnerFormPreviewSource } from "@/components/partner/partner-portal-workspace";
import type { TemplateField, TemplateFieldType, TemplateFormDefinition, TemplateFormField, TemplateLogic, TemplateRow, TemplateValidation } from "@/lib/templates/constants";
import { moveSection } from "@/lib/templates/formMoves";
import { applyRequiredChoice, type RequiredChoice } from "@/lib/templates/plainLabels";
import { eligibilityFieldKey, type TemplateDraft } from "@/lib/agentTemplates/draftChanges";
import { formChanges } from "@/lib/templates/formChanges";
import { withLogic } from "@/lib/templates/logic";
import { matchedCount } from "@/lib/templates/applicationMatch";
import { parseSettingsHash } from "@/lib/settings/registry";
import { NO_CAPABILITIES, draftFrom, readLocalDraft, uniqueKey, writeLocalDraft, type Available, type Capabilities, type Current, type DraftState, type Preview, type Published } from "@/components/app/form-templates/draft";
import { FormCanvas, type Picked } from "@/components/app/form-templates/form-canvas";
import { FieldLibrary, type LibraryItem } from "@/components/app/form-templates/add-question";
import { FormPreview } from "@/components/app/form-templates/form-preview";
import { QuestionPanel } from "@/components/app/form-templates/question-panel";
import { FormSettingsCard } from "@/components/app/form-templates/form-settings";
import { FormsList, type FormListRow, type ListTab } from "@/components/app/form-templates/forms-list";
import { NewFormSheet } from "@/components/app/form-templates/new-form-sheet";
import { ShareSheet } from "@/components/app/form-templates/share-sheet";
import { TestSheet } from "@/components/app/form-templates/test-sheet";
import { VersionsTab } from "@/components/app/form-templates/versions-tab";
import { ResultsTab } from "@/components/app/form-templates/results-tab";
import { FormStatusLine, NeedsUpdate, PublishDialog, SETTINGS_TABS, type SettingsTab } from "@/components/app/form-templates/status-line";
import { publishBlockers } from "@/lib/templates/publishBlockers";

const PREVIEW_MARKET = { carrier_id: "", carrier_name: "", state: "" };
/** Undo toasts sit at the foot, clear of the title line's buttons. */
const UNDO_AT = "bottom-center" as const;
type FormTab = "build" | "settings" | "results" | "versions";
type View = { kind: "list" } | { kind: "form"; product: string | null; variantId: string | null };
type Variant = { id: string; tenant_template_id: string; name: string; status: "draft" | "live" | "off"; audience: string[]; version: number; form_definition: TemplateFormDefinition };
type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; where: "insurvas" | "here"; at: number } | { kind: "failed" };

const withSections = (d: TemplateDraft, fn: (sections: TemplateFormDefinition["sections"]) => TemplateFormDefinition["sections"]): TemplateDraft => ({ ...d, form: { ...d.form, sections: fn(d.form.sections) } });
const placementsOf = (form: TemplateFormDefinition, fieldKey: string) => form.sections.flatMap((section) => section.fields.map((field, index) => ({ section: section.section_key, index, field })).filter((item) => item.field.field_key === fieldKey));
const when = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export function TemplateSettings() {
  /* ── the list ───────────────────────────────────────────────────────── */
  const [view, setView] = useState<View>({ kind: "list" });
  const [listTab, setListTab] = useState<ListTab>("forms");
  const [rows, setRows] = useState<FormListRow[] | null>(null);
  const [products, setProducts] = useState<Array<{ code: string; name: string }>>([]);
  const [caps, setCaps] = useState<Capabilities>(NO_CAPABILITIES);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [noProducts, setNoProducts] = useState(false);
  const [newOpen, setNewOpen] = useState(false);

  /* ── the open form ──────────────────────────────────────────────────── */
  const [current, setCurrent] = useState<Current | null>(null);
  const [variant, setVariant] = useState<Variant | null>(null);
  const [available, setAvailable] = useState<Available[]>([]);
  const [agencyName, setAgencyName] = useState<string | null>(null);
  const [state, setState] = useState<DraftState | null>(null);
  const [selected, setSelected] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Picked>(null);
  const [published, setPublished] = useState<Published | null>(null);
  const [tab, setTab] = useState<FormTab>("build");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("who");
  const [page, setPage] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [testing, setTesting] = useState<Record<string, unknown> | null>(null);
  const [sharing, setSharing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [partnerForm, setPartnerForm] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [insurvas, setInsurvas] = useState<TemplateField[] | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [draftsOnLive, setDraftsOnLive] = useState<number | null>(null);
  const [days, setDays] = useState<7 | 30 | 90>(30);
  /** The capabilities as last read, for loaders that run outside a render. */
  const capsRef = useRef<Capabilities>(NO_CAPABILITIES);
  useEffect(() => { capsRef.current = caps; }, [caps]);

  const loadList = useCallback(async () => {
    setListLoading(true);
    const response = await fetch("/api/app/templates/forms", { cache: "no-store" }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setListLoading(false);
    if (!response?.ok) { setListError(body?.error ?? "Your forms didn’t load."); return; }
    setListError("");
    setRows(body.forms ?? []);
    setProducts(body.products ?? []);
    setCaps({ ...NO_CAPABILITIES, ...(body.capabilities ?? {}) });
    setNoProducts(Boolean(body.noProducts) && !(body.forms ?? []).length);
  }, []);

  const openForm = useCallback(async (product: string | null, variantId: string | null = null, nextTab: FormTab = "build") => {
    setView({ kind: "form", product, variantId });
    setTab(nextTab);
    setLoading(true);
    setError("");
    setPicked(null);
    setPreviewing(false);
    setInsurvas(null);
    setSaveState({ kind: "idle" });
    const url = product ? `/api/app/templates?product=${encodeURIComponent(product)}` : "/api/app/templates";
    const response = await fetch(url, { cache: "no-store" }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    if (!response?.ok) { setLoading(false); setNoProducts(body?.code === "no_products"); setError(body?.error ?? "This form didn’t load."); return; }
    let loadedVariant: Variant | null = null;
    if (variantId) {
      const variantResponse = await fetch(`/api/app/templates/variants/${variantId}`, { cache: "no-store" }).catch(() => null);
      const variantBody = variantResponse ? await variantResponse.json().catch(() => null) : null;
      if (!variantResponse?.ok) { setLoading(false); setError(variantBody?.error ?? "This form didn’t load."); return; }
      loadedVariant = variantBody.variant as Variant;
    }
    const loaded = body.current as Current;
    setCurrent(loaded);
    setVariant(loadedVariant);
    setAvailable(body.templates ?? []);
    setAgencyName(typeof body.agencyName === "string" ? body.agencyName : null);
    setPublished(body.published && typeof body.published.at === "string" ? body.published : null);
    setSelected("");
    setPreview(null);
    const base = savedDraftOf(loaded, loadedVariant);
    const live = loadedVariant ? loadedVariant.version : loaded.assignment.definition_version;
    const key = loadedVariant ? `variant-${loadedVariant.id}` : loaded.tenant_template_id;
    // The draft picks up where it was left: Insurvas first (when that is live), then this computer.
    let restored: TemplateDraft | null = null;
    if (!loadedVariant && capsRef.current.drafts) {
      const server = await fetch(`/api/app/templates/${loaded.tenant_template_id}/draft`, { cache: "no-store" }).then(async (res) => (res.ok ? (await res.json()).draft : null)).catch(() => null);
      if (server && server.base_revision === live && server.draft && Array.isArray(server.draft.fields)) restored = server.draft as TemplateDraft;
    }
    const local = readLocalDraft(key);
    if (!restored && local && local.base === live) restored = local.draft;
    setState({ draft: restored ?? base, seen: {} });
    setPage(base.form.sections[0]?.section_key ?? "");
    if (restored) setSaveState({ kind: "saved", where: "here", at: Date.now() });
    setLoading(false);
    // The library's Insurvas questions; a failed read leaves the library with the field types only.
    fetch(`/api/app/templates/default?product=${encodeURIComponent(loaded.assignment.product_code)}`, { cache: "no-store" })
      .then(async (res) => (res.ok ? (await res.json()).fields as TemplateField[] : []))
      .then((fields) => setInsurvas(fields), () => setInsurvas([]));
  }, []);

  // External server state hydrates the editor.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadList(); }, [loadList]);

  // "#form-templates/form-lead-steps" (the settings search) opens a form's Settings at that setting.
  useEffect(() => {
    const fromHash = () => {
      const { tab: hashTab, anchor } = parseSettingsHash(window.location.hash);
      const hit = hashTab === "form-templates" ? SETTINGS_TABS.find((item) => item.anchor === anchor) : null;
      if (hit) { setSettingsTab(hit.key); void openForm(null, null, "settings"); }
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [openForm]);

  const saved = useMemo(() => (current ? savedDraftOf(current, variant) : null), [current, variant]);
  const draft = state?.draft ?? null;
  const changes = useMemo(() => (saved && draft ? formChanges(saved, draft) : []), [saved, draft]);
  const dirty = changes.length > 0;
  const liveVersion = variant ? variant.version : current?.assignment.definition_version ?? 0;
  const draftKey = variant ? `variant-${variant.id}` : current?.tenant_template_id ?? "";
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

  // The draft is kept as it changes: on this computer at once, and in Insurvas when that is live.
  const saveTimer = useRef<number | undefined>(undefined);
  const hadDraft = useRef(false);
  const persist = useCallback(async (next: TemplateDraft | null) => {
    if (!current || !draftKey) return;
    if (!next) {
      writeLocalDraft(draftKey, null);
      if (hadDraft.current && !variant && caps.drafts) await fetch(`/api/app/templates/${current.tenant_template_id}/draft`, { method: "DELETE" }).catch(() => null);
      hadDraft.current = false;
      setSaveState({ kind: "idle" });
      return;
    }
    hadDraft.current = true;
    writeLocalDraft(draftKey, { base: liveVersion, draft: next, at: Date.now() });
    if (variant || !caps.drafts) { setSaveState({ kind: "saved", where: "here", at: Date.now() }); return; }
    setSaveState({ kind: "saving" });
    const response = await fetch(`/api/app/templates/${current.tenant_template_id}/draft`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base_revision: liveVersion, draft: next }) }).catch(() => null);
    setSaveState(response?.ok ? { kind: "saved", where: "insurvas", at: Date.now() } : { kind: "failed" });
  }, [current, draftKey, variant, caps.drafts, liveVersion]);
  useEffect(() => {
    if (!draft || !current) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void persist(dirty ? draft : null), 900);
    return () => window.clearTimeout(saveTimer.current);
  }, [draft, dirty, current, persist]);

  // The partner portal's own form, fed this draft (LA-1.4-5), behind "Open in the partner form".
  const previewSource = useMemo<PartnerFormPreviewSource | null>(() => {
    if (!current || !draft) return null;
    const template: TemplateRow = {
      id: current.assignment.template_id, name: draft.name, product_code: current.assignment.product_code, product_name: current.template.product_name,
      version: current.template.version, definition_version: current.template.definition_version, description: current.template.description,
      is_active: true, created_by: null, created_at: "", updated_at: "", fields: draft.fields, stages: draft.stages, form_definition: draft.form,
    };
    return { tenant_template_id: current.tenant_template_id, assignment: { definition_version: current.assignment.definition_version }, template };
  }, [current, draft]);

  /** Every edit goes through here, so the change list learns when each line first appeared. */
  function update(fn: (draft: TemplateDraft) => TemplateDraft) {
    setState((prev) => {
      if (!prev || !saved) return prev;
      const next = fn(prev.draft);
      const now = Date.now();
      const seen: Record<string, number> = {};
      for (const change of formChanges(saved, next)) seen[change.id] = prev.seen[change.id] ?? now;
      return { draft: next, seen };
    });
  }
  function discard() { if (saved) setState({ draft: JSON.parse(JSON.stringify(saved)) as TemplateDraft, seen: {} }); setPicked(null); }

  async function publish(note = ""): Promise<boolean> {
    if (!current || !draft) return false;
    setSaving(true);
    const form = { ...draft.form, sections: draft.form.sections.map((section, index) => ({ ...section, sort_order: index })) };
    const response = variant
      ? await fetch(`/api/app/templates/variants/${variant.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: draft.name, form_definition: form, note }) }).catch(() => null)
      : await fetch(`/api/app/templates/${current.tenant_template_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          description: current.template.description,
          note,
          fields: draft.fields.map((field, index) => ({ ...field, sort_order: index, validation: field.validation ?? {}, help_text: field.help_text || null })),
          stages: draft.stages.map((stage, index) => ({ ...stage, sort_order: index })),
          form_definition: form,
        }),
      }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setSaving(false);
    if (!response?.ok) { notify.block(`Nothing was published: ${body?.error ?? "the form couldn’t be published"}`); return false; }
    writeLocalDraft(draftKey, null);
    hadDraft.current = false;
    notify.done(`Version ${liveVersion + 1} is live`, { detail: "Anyone who already started a form finishes it the old way." });
    setPublishing(false);
    void openForm(current.assignment.product_code, variant?.id ?? null, tab);
    void loadList();
    return true;
  }

  /** Reset to default: the Insurvas form's questions and pages into the draft; the owner publishes it. */
  async function resetToDefault(): Promise<boolean> {
    if (!current) return false;
    const response = await fetch(`/api/app/templates/default?product=${encodeURIComponent(current.assignment.product_code)}`, { cache: "no-store" }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    if (!response?.ok || !body) { notify.block(body?.error ?? "Couldn’t read the Insurvas form"); return false; }
    const fields = (body.fields as TemplateField[]).map((field) => ({ ...field, options: [...(field.options ?? [])], validation: { ...(field.validation ?? {}) } }));
    update((d) => ({ ...d, fields, form: body.form_definition as TemplateFormDefinition }));
    setPicked(null);
    notify.done("The Insurvas form is in your draft", { detail: "Review it, then publish to use it." });
    return true;
  }

  const chosen = available.find((template) => `${template.id}:${template.version}` === selected);
  async function showPreview() {
    if (!chosen) return;
    const response = await fetch("/api/app/templates/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ template_id: chosen.id, template_version: chosen.version }) });
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
    await openForm(current.assignment.product_code, null, "settings");
  }

  /* ── header: the list ───────────────────────────────────────────────── */
  if (view.kind === "list") {
    const webhookCount = (rows ?? []).filter((row) => row.has_webhook).length;
    return (
      <SettingsStack className="min-h-0 flex-1 gap-3">
        <SettingsSectionHeader
          tabs={<ViewTabs label="Application forms" value={listTab} onChange={setListTab} tabs={[{ key: "forms", label: "Forms", count: rows?.length ?? null }, { key: "results", label: "Results" }, { key: "webhooks", label: "Webhooks", count: caps.webhooks ? webhookCount : null }]} />}
          actions={<Button type="button" onClick={() => setNewOpen(true)} disabled={!rows?.length}>New form</Button>}
        />
        {noProducts ? (
          <EmptyState title="No products switched on yet" hint="Each product you sell starts with the Insurvas form for it. Switch one on first." action={<Button asChild variant="outline"><Link href="/app/settings#products">Open Products</Link></Button>} />
        ) : (
          <FormsList
            tab={listTab}
            rows={rows}
            products={products}
            loading={listLoading}
            error={listError}
            onRetry={() => void loadList()}
            onOpen={(row) => void openForm(row.product_code, row.kind === "variant" ? row.id : null)}
            onNew={() => setNewOpen(true)}
            onWebhook={(row) => { setSettingsTab("hook"); void openForm(row.product_code, null, "settings"); }}
          />
        )}
        {listTab === "webhooks" && !caps.webhooks && <FormStatusLine tone="warning" action={<NeedsUpdate />}>A webhook per form saves once Insurvas applies its database update.</FormStatusLine>}
        {newOpen && rows && <NewFormSheet forms={rows} available={caps.variants} onClose={() => setNewOpen(false)} onCreated={(made) => { setNewOpen(false); void loadList(); void openForm(made.product_code, made.id); }} />}
      </SettingsStack>
    );
  }

  const backToList = () => { setView({ kind: "list" }); setPicked(null); setPreviewing(false); void loadList(); };

  if (!current || !draft || !saved || loading) {
    return (
      <SettingsStack className="min-h-0 flex-1 gap-3">
        {/* Loading keeps the title and its tabs; only the card shows bars (settings foundation board). */}
        <SettingsSectionHeader tabs={<ViewTabs label="Form" value={tab} onChange={setTab} tabs={[{ key: "build", label: "Build" }, { key: "settings", label: "Settings" }, { key: "results", label: "Results" }, { key: "versions", label: "Versions" }]} />} />
        <button type="button" onClick={backToList} className="self-start text-sm font-semibold text-[var(--accent-ink)] underline-offset-4 hover:underline">Application forms</button>
        {error ? (
          <div className="m-glass rounded-[12px] border border-[var(--border)] p-6">
            <EmptyState title="This form didn’t load" hint={error} action={<Button type="button" variant="outline" onClick={() => void openForm(view.product, view.variantId, tab)}>Try again</Button>} />
          </div>
        ) : (
          <div className="m-glass rounded-[12px] border border-[var(--border)] p-4"><SectionLoading rows={5} columns={3} label="Reading the form" /></div>
        )}
      </SettingsStack>
    );
  }

  /* ── the open form ──────────────────────────────────────────────────── */
  const locked = Boolean(variant);
  const productCode = current.assignment.product_code;
  const fieldMap = new Map(draft.fields.map((field) => [field.field_key, field]));
  const eligibilityKey = eligibilityFieldKey(draft.fields);
  const eligibility = eligibilityKey ? fieldMap.get(eligibilityKey) ?? null : null;
  const blockers = publishBlockers(draft.form, draft.fields);
  const placed = new Set(draft.form.sections.flatMap((section) => section.fields.map((field) => field.field_key)));
  const agentsOnly = draft.fields.filter((field) => !placed.has(field.field_key));
  const openPage = draft.form.sections.find((section) => section.section_key === page) ?? draft.form.sections[0];
  const formTitle = `${agencyName ? `${agencyName} · ` : ""}${current.template.product_name}`;

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
  const setLogic = (sectionKey: string, fieldKey: string, logic: TemplateLogic | null) =>
    update((d) => withSections(d, (sections) => sections.map((section) => (section.section_key === sectionKey ? { ...section, fields: section.fields.map((field) => (field.field_key === fieldKey ? withLogic(field, logic) : field)) } : section))));
  const setPageSkip = (sectionKey: string, logic: TemplateLogic | null) =>
    update((d) => withSections(d, (sections) => sections.map((section) => {
      if (section.section_key !== sectionKey) return section;
      const next = { ...section };
      if (logic && logic.rules.length) next.skip_when = logic; else delete next.skip_when;
      return next;
    })));

  function newField(type: TemplateFieldType, from?: TemplateField): TemplateField {
    const key = uniqueKey(from ? `${from.field_key}_copy` : "custom_field", new Set(draft!.fields.map((field) => field.field_key)));
    if (from) return { ...from, field_key: key, label: `${from.label} (copy)`.slice(0, 120), options: [...from.options], validation: { ...(from.validation ?? {}) }, sort_order: draft!.fields.length };
    return { field_key: key, label: "New question", type, is_required: false, options: ["single_select", "multi_select"].includes(type) ? ["First choice", "Second choice"] : [], sort_order: draft!.fields.length, help_text: null, validation: {} };
  }
  const insertAt = (sections: TemplateFormDefinition["sections"], sectionKey: string, index: number, item: TemplateFormField) =>
    sections.map((section) => (section.section_key === sectionKey ? { ...section, fields: [...section.fields.slice(0, index), item, ...section.fields.slice(index)] } : section));
  function addField(field: TemplateField, sectionKey: string, index: number) {
    update((d) => withSections({ ...d, fields: [...d.fields, field] }, (sections) => insertAt(sections, sectionKey, index, { field_key: field.field_key, is_required: false, show_when: null })));
    setPicked({ fieldKey: field.field_key, sectionKey });
  }
  function placeExisting(fieldKey: string, sectionKey: string, index: number) {
    update((d) => withSections(d, (sections) => insertAt(sections, sectionKey, index, { field_key: fieldKey, is_required: false, show_when: null })));
    setPicked({ fieldKey, sectionKey });
  }
  function addSection(after?: number) {
    const key = uniqueKey("section", new Set(draft!.form.sections.map((section) => section.section_key)));
    update((d) => withSections(d, (sections) => {
      const at = after === undefined ? sections.length : after + 1;
      return [...sections.slice(0, at), { section_key: key, label: `Page ${sections.length + 1}`, fields: [], sort_order: at }, ...sections.slice(at)];
    }));
    setPage(key);
    setPicked(null);
  }
  function addFromLibrary(item: LibraryItem, sectionKey = openPage?.section_key ?? "", index = openPage?.fields.length ?? 0) {
    if (item.kind === "page") { addSection(draft!.form.sections.findIndex((section) => section.section_key === sectionKey)); return; }
    if (!sectionKey) return;
    if (item.kind === "type") { if (!locked) addField(newField(item.type), sectionKey, index); return; }
    if (placed.has(item.key)) { notify.block("That question is already on this form"); return; }
    if (fieldMap.has(item.key)) { placeExisting(item.key, sectionKey, index); return; }
    if (locked) { notify.block("An extra form uses its product’s questions. Add it to the product’s main form first."); return; }
    const source = insurvas?.find((field) => field.field_key === item.key);
    if (source) addField({ ...source, options: [...source.options], validation: { ...(source.validation ?? {}) }, sort_order: draft!.fields.length }, sectionKey, index);
  }
  function moveField(fieldKey: string, from: string | null, to: string | null, index?: number) {
    update((d) => withSections(d, (sections) => {
      const source = from ? sections.find((section) => section.section_key === from) : null;
      const kept = source?.fields.find((field) => field.field_key === fieldKey) ?? { field_key: fieldKey, is_required: false, show_when: null };
      const fromIndex = source ? source.fields.findIndex((field) => field.field_key === fieldKey) : -1;
      const removed = sections.map((section) => (section.section_key === from ? { ...section, fields: section.fields.filter((field) => field.field_key !== fieldKey) } : section));
      if (!to) return removed;
      const target = removed.find((section) => section.section_key === to);
      if (!target) return sections;
      let at = index ?? target.fields.length;
      if (from === to && fromIndex >= 0 && fromIndex < at) at -= 1;
      return insertAt(removed, to, Math.max(0, Math.min(at, target.fields.length)), kept);
    }));
    setPicked({ fieldKey, sectionKey: to });
    if (to) setPage(to);
  }
  function setRequired(fieldKey: string, sectionKey: string | null, choice: RequiredChoice) {
    const flags = applyRequiredChoice(choice, Boolean(sectionKey));
    update((d) => {
      const next = locked ? d : { ...d, fields: d.fields.map((field) => (field.field_key === fieldKey ? { ...field, is_required: flags.field } : field)) };
      return sectionKey && flags.placement !== null
        ? withSections(next, (sections) => sections.map((section) => (section.section_key === sectionKey ? { ...section, fields: section.fields.map((field) => (field.field_key === fieldKey ? { ...field, is_required: flags.placement! } : field)) } : section)))
        : next;
    });
  }
  /** "Put back": the question's own settings and, on this page, its required, width and logic. */
  function resetQuestion(fieldKey: string, sectionKey: string | null) {
    const was = saved!.fields.find((field) => field.field_key === fieldKey);
    if (!was) return;
    const wasPlacement = sectionKey ? saved!.form.sections.find((section) => section.section_key === sectionKey)?.fields.find((field) => field.field_key === fieldKey) : null;
    update((d) => {
      const next = { ...d, fields: d.fields.map((field) => (field.field_key === fieldKey ? { ...was, options: [...was.options], validation: { ...(was.validation ?? {}) } } : field)) };
      return wasPlacement && sectionKey ? withSections(next, (sections) => sections.map((section) => (section.section_key === sectionKey ? { ...section, fields: section.fields.map((field) => (field.field_key === fieldKey ? JSON.parse(JSON.stringify(wasPlacement)) as TemplateFormField : field)) } : section))) : next;
    });
  }
  /** Undo, not confirm: the draft before the removal is kept for the toast's Undo. */
  function removeField(fieldKey: string, sectionKey: string | null) {
    const before = draft!;
    const label = fieldMap.get(fieldKey)?.label || "the question";
    if (locked && sectionKey) update((d) => withSections(d, (sections) => sections.map((section) => (section.section_key === sectionKey ? { ...section, fields: section.fields.filter((field) => field.field_key !== fieldKey) } : section))));
    else update((d) => withSections({ ...d, fields: d.fields.filter((field) => field.field_key !== fieldKey) }, (sections) => sections.map((section) => ({ ...section, fields: section.fields.filter((field) => field.field_key !== fieldKey) }))));
    setPicked(null);
    notify.done(`Removed “${label}”`, { action: { label: "Undo", onClick: () => update(() => before) }, durationMs: 6000, position: UNDO_AT });
  }
  function duplicateField(fieldKey: string, sectionKey: string) {
    const from = fieldMap.get(fieldKey);
    const section = draft!.form.sections.find((item) => item.section_key === sectionKey);
    if (!from || !section || locked) return;
    addField(newField(from.type, from), sectionKey, section.fields.findIndex((field) => field.field_key === fieldKey) + 1);
  }
  function removeSection(sectionKey: string) {
    const before = draft!;
    const label = draft!.form.sections.find((section) => section.section_key === sectionKey)?.label || "the page";
    update((d) => withSections(d, (sections) => sections.filter((section) => section.section_key !== sectionKey)));
    if (picked?.sectionKey === sectionKey) setPicked(null);
    setRemoving(null);
    setPage(draft!.form.sections.find((section) => section.section_key !== sectionKey)?.section_key ?? "");
    notify.done(`Removed “${label}”`, { action: { label: "Undo", onClick: () => update(() => before) }, durationMs: 6000, position: UNDO_AT });
  }
  const askRemoveSection = (sectionKey: string) => (draft.form.sections.find((item) => item.section_key === sectionKey)?.fields.length ? setRemoving(sectionKey) : removeSection(sectionKey));

  const pickedField = picked ? fieldMap.get(picked.fieldKey) ?? null : null;
  const pickedSectionIndex = picked?.sectionKey ? draft.form.sections.findIndex((section) => section.section_key === picked.sectionKey) : -1;
  const pickedPlacement = pickedSectionIndex >= 0 ? draft.form.sections[pickedSectionIndex].fields.find((field) => field.field_key === picked!.fieldKey) ?? null : null;
  const position = pickedSectionIndex >= 0 ? `Page ${pickedSectionIndex + 1} · question ${draft.form.sections[pickedSectionIndex].fields.findIndex((field) => field.field_key === picked!.fieldKey) + 1}` : "For your agents only";
  const removingSection = removing ? draft.form.sections.find((section) => section.section_key === removing) ?? null : null;

  /** The picked question's inspector (board A2–A4). */
  const questionEditor = picked && pickedField ? (
    <QuestionPanel
      key={`${picked.sectionKey}:${pickedField.field_key}`}
      field={pickedField}
      fields={draft.fields}
      form={draft.form}
      sectionKey={picked.sectionKey}
      placement={pickedPlacement}
      position={position}
      changed={changed.has(pickedField.field_key)}
      locked={locked}
      setField={setField}
      setValidation={setValidation}
      setPlacement={setPlacement}
      setLogic={setLogic}
      setPageSkip={setPageSkip}
      onRequired={(choice) => setRequired(pickedField.field_key, picked.sectionKey, choice)}
      onAgentsOnly={(on) => (on ? moveField(pickedField.field_key, picked.sectionKey, null) : moveField(pickedField.field_key, null, openPage?.section_key ?? null))}
      onReset={saved.fields.some((field) => field.field_key === pickedField.field_key) && changed.has(pickedField.field_key) ? () => resetQuestion(pickedField.field_key, picked.sectionKey) : null}
      onDelete={() => removeField(pickedField.field_key, picked.sectionKey)}
      onDuplicate={picked.sectionKey && !locked ? () => duplicateField(pickedField.field_key, picked.sectionKey!) : null}
      onClose={() => setPicked(null)}
      onPickLogic={(fieldKey, sectionKey) => { setPage(sectionKey); if (fieldKey) setPicked({ fieldKey, sectionKey }); }}
    />
  ) : null;

  /* the status line under the title */
  const ago = (at: number) => `at ${clock.format(at)}`;
  const statusLine = dirty ? (
    saveState.kind === "failed" ? (
      <FormStatusLine tone="danger" action={<Button type="button" variant="ghost" size="sm" onClick={() => void persist(draft)}>Try again now</Button>}>Your last change did not save to Insurvas. It is kept on this computer. Nothing was published.</FormStatusLine>
    ) : (
      <FormStatusLine tone="warning" action={!caps.drafts && !variant ? <NeedsUpdate /> : undefined}>
        {changes.length} {changes.length === 1 ? "change" : "changes"} not published · {saveState.kind === "saving" ? "saving the draft" : saveState.kind === "saved" ? (saveState.where === "insurvas" ? `draft saved to Insurvas ${ago(saveState.at)}, so it follows you to any computer` : `draft kept on this computer ${ago(saveState.at)}`) : "draft kept on this computer"}
      </FormStatusLine>
    )
  ) : variant ? (
    <FormStatusLine tone={variant.status === "live" ? "good" : "neutral"}>{variant.status === "draft" ? "Not published yet · arranges the product’s own questions" : `Version ${variant.version} · ${variant.status === "live" ? "live" : "off"} · the partner portal serves the product’s main form until it can offer a choice`}</FormStatusLine>
  ) : (
    <FormStatusLine tone="good">Live · version {liveVersion}{published ? ` · published ${published.by ? `by ${published.by} ` : ""}on ${when.format(new Date(published.at))}` : ""}</FormStatusLine>
  );

  const tabs = [
    { key: "build" as const, label: "Build" },
    { key: "settings" as const, label: "Settings" },
    ...(variant ? [] : [{ key: "results" as const, label: "Results" }, { key: "versions" as const, label: "Versions", count: liveVersion }]),
  ];
  const actions = (
    <>
      {tab === "results" && !variant && <Segmented label="Results window" value={String(days) as "7" | "30" | "90"} onChange={(value) => setDays(Number(value) as 7 | 30 | 90)} options={[{ key: "7", label: "7 days" }, { key: "30", label: "30 days" }, { key: "90", label: "90 days" }]} />}
      {tab === "build" && <Button type="button" variant="outline" onClick={() => setPreviewing((on) => !on)}><Eye aria-hidden="true" />{previewing ? "Back to building" : "Preview"}</Button>}
      {tab === "build" && <Button type="button" variant="outline" onClick={() => setTesting({})}><FlaskConical aria-hidden="true" />Test submission</Button>}
      {!variant && <Button type="button" variant="highlight" onClick={() => setSharing(true)}><Share2 aria-hidden="true" />Share</Button>}
      <Button type="button" disabled={!(dirty || variant?.status === "draft") || saving} title={blockers[0]} onClick={() => setPublishing(true)}>{`Publish v${liveVersion + 1}`}</Button>
    </>
  );

  return (
    <SettingsStack className="min-h-0 flex-1 gap-3">
      <SettingsSectionHeader tabs={<ViewTabs label="Form" value={tab} onChange={(next) => { setTab(next); setPreviewing(false); }} tabs={tabs} />} actions={actions} />
      <LeaveGuard dirty={dirty && saveState.kind === "failed"} onDiscard={discard} onSave={() => publish()} what="the form draft" />

      <div className="flex shrink-0 flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button type="button" onClick={backToList} className="text-sm font-semibold text-[var(--accent-ink)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--ring-color)]">Application forms</button>
          <span aria-hidden="true" className="text-sm text-[var(--muted)]">›</span>
          <h3 className="m-0 min-w-0 truncate text-base font-semibold text-[var(--ink)]">{draft.name}</h3>
          <StatusChip>{current.template.product_name}</StatusChip>
          {variant ? <StatusChip tone={variant.status === "live" ? "good" : "info"}>{variant.status === "draft" ? "Draft" : `v${variant.version} ${variant.status}`}</StatusChip> : <StatusChip tone="good">v{liveVersion} live</StatusChip>}
        </div>
        {statusLine}
      </div>

      {tab === "build" && (previewing ? (
        <FormPreview fields={draft.fields} form={draft.form} title={formTitle} link={null} onBack={() => setPreviewing(false)} onTest={(values) => setTesting(values)} onPartnerForm={() => setPartnerForm(true)} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
          <aside aria-label="Add a field" className="m-glass flex min-h-0 shrink-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border)] lg:w-[236px]">
            <div className="m-glass-head border-b border-[var(--border)] px-4 py-3"><h3 className="m-0 text-card-title text-[var(--ink)]">Add a field</h3></div>
            <div className="max-h-[320px] min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 lg:max-h-none">
              <FieldLibrary insurvas={locked ? agentsOnly : insurvas} used={placed} onAdd={(item) => addFromLibrary(item)} typesAllowed={!locked} />
            </div>
          </aside>
          <FormCanvas
            form={draft.form}
            fields={draft.fields}
            page={openPage?.section_key ?? ""}
            onPage={(key) => { setPage(key); setPicked(null); }}
            picked={picked}
            changed={changed}
            onPick={(fieldKey, sectionKey) => setPicked({ fieldKey, sectionKey })}
            onDropItem={(item, sectionKey, index) => addFromLibrary(item, sectionKey, index)}
            onMove={(fieldKey, from, to, index) => moveField(fieldKey, from, to, index)}
            onDuplicate={locked ? null : duplicateField}
            onRemoveField={removeField}
            onAddPage={() => addSection()}
            onRenamePage={(sectionKey, label) => update((d) => withSections(d, (sections) => sections.map((section) => (section.section_key === sectionKey ? { ...section, label } : section))))}
            onMovePage={(sectionKey, by) => update((d) => ({ ...d, form: moveSection(d.form, sectionKey, by) }))}
            onRemovePage={askRemoveSection}
            onAddType={locked ? null : (type) => openPage && addField(newField(type), openPage.section_key, openPage.fields.length)}
            matched={{ matched: matchedCount([...placed]), total: placed.size }}
          />
          <div className="flex min-h-0 shrink-0 lg:w-[300px] 2xl:w-[400px]">
            {picked?.sectionKey !== null && questionEditor ? questionEditor : (
              <div className="m-glass flex w-full flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-[var(--border-strong)] p-6 text-center">
                <strong className="text-sm font-semibold text-[var(--ink)]">Pick a question to change it</strong>
                <p className="m-0 max-w-[32ch] text-sm text-[var(--muted)]">Its words, when it shows, and the rules its answer must meet open here.</p>
              </div>
            )}
          </div>
        </div>
      ))}

      {tab === "settings" && (
        <FormSettingsCard
          tab={settingsTab}
          onTab={setSettingsTab}
          name={draft.name}
          onName={(name) => update((d) => ({ ...d, name }))}
          eligibility={eligibility}
          onAges={(patch) => { if (eligibility && !locked) setValidation(eligibility.field_key, patch); }}
          form={draft.form}
          fields={draft.fields}
          onGroup={(group, on) => update((d) => ({ ...d, form: { ...d.form, section_availability: { ...(d.form.section_availability ?? {}), [group]: on } } }))}
          copyId={current.tenant_template_id}
          webhooksAvailable={caps.webhooks}
          hookCount={rows?.find((row) => row.kind === "product" && row.tenant_template_id === current.tenant_template_id)?.has_webhook ? 1 : null}
          versions={variant ? null : {
            current, published, templates: available.filter((template) => template.product_code === productCode), selected, chosen, preview, applying, dirty,
            onSelect: (value) => { setSelected(value); setPreview(null); },
            onPreview: () => void showPreview(),
            onApply: () => void apply(),
            reset: <ResetToDefault what={`the ${current.template.product_name || "product"} form`} kept="Your lead steps stay. Nothing changes for partners until you publish." onReset={resetToDefault} disabled={saving} />,
          }}
          agents={{ fields: agentsOnly, picked: picked?.sectionKey === null ? picked.fieldKey : null, changed, onPick: (fieldKey) => setPicked({ fieldKey, sectionKey: null }), onAdd: () => { if (locked) return; const field = newField("text"); update((d) => ({ ...d, fields: [...d.fields, field] })); setPicked({ fieldKey: field.field_key, sectionKey: null }); } }}
          agentEditor={picked?.sectionKey === null ? questionEditor : null}
        />
      )}

      {tab === "results" && !variant && <ResultsTab copyId={current.tenant_template_id} version={liveVersion} days={days} />}

      {tab === "versions" && !variant && (
        <VersionsTab
          copyId={current.tenant_template_id}
          live={liveVersion}
          changes={changes}
          saved={saved}
          stages={draft.stages}
          latest={current.latest}
          onUndoAll={discard}
          onRestore={(restored, revision) => { update(() => restored); setPicked(null); notify.done(`Version ${revision} is in your draft`, { detail: "Publish it to make it live again." }); }}
          onReviewUpdate={() => { setSettingsTab("versions"); setTab("settings"); }}
          onDraftsOnLive={setDraftsOnLive}
        />
      )}

      <PublishDialog key={publishing ? "open" : "closed"} open={publishing} onOpenChange={setPublishing} nextVersion={liveVersion + 1} changes={changes} blockers={blockers} draftsOnLive={draftsOnLive} saving={saving} onPublish={(note) => void publish(note)} />
      {sharing && !variant && <ShareSheet copyId={current.tenant_template_id} formName={draft.name} liveVersion={liveVersion} available={caps.share} onClose={() => setSharing(false)} />}
      {testing && <TestSheet copyId={current.tenant_template_id} fields={draft.fields} form={draft.form} title={formTitle} initial={testing} testLeads={caps.testLeads} hasWebhook={caps.webhooks ? Boolean(rows?.find((row) => row.kind === "product" && row.tenant_template_id === current.tenant_template_id)?.has_webhook) : null} onClose={() => setTesting(null)} />}

      {/* "Open in the partner form": the partner's own form component, fed this draft (LA-1.4-5). */}
      <Dialog open={partnerForm} onOpenChange={setPartnerForm}>
        <DialogContent className="max-h-[88vh] overflow-y-auto border-[var(--border)] bg-[var(--surface)] text-[var(--body)] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-title-sm text-[var(--ink)]">The partner form</DialogTitle>
            <DialogDescription className="text-sm leading-[1.5] text-[var(--body)]">Fill it in as a partner would. Nothing is saved or sent.</DialogDescription>
          </DialogHeader>
          {previewSource && <div className="portal-partner-submit-page"><PartnerLeadForm productCode={productCode} productName={current.template.product_name} partnerStatus="active" market={PREVIEW_MARKET} preview={previewSource} agencyName={agencyName} /></div>}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(removingSection)} onOpenChange={(open) => { if (!open) setRemoving(null); }}>
        <DialogContent className="border-[var(--border)] bg-[var(--surface)] text-[var(--body)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-title-sm text-[var(--ink)]">Remove “{removingSection?.label}”?</DialogTitle>
            <DialogDescription className="text-sm leading-[1.5] text-[var(--body)]">Partners stop seeing its {removingSection?.fields.length} {removingSection?.fields.length === 1 ? "question" : "questions"}. They stay saved on leads, under For your agents only.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button onClick={() => setRemoving(null)} type="button" variant="ghost">Keep it</Button>
            <Button onClick={() => { if (removing) removeSection(removing); }} type="button" variant="destructive">Remove the page</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsStack>
  );
}

/** What is live: the product's form, or an extra form's arrangement of the product's questions. */
function savedDraftOf(current: Current, variant: { name: string; form_definition: TemplateFormDefinition } | null): TemplateDraft {
  const base = draftFrom(current);
  if (!variant) return base;
  return { ...base, name: variant.name, form: JSON.parse(JSON.stringify(variant.form_definition)) as TemplateFormDefinition };
}
