"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { notify } from "@/lib/notify";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Callout,
  control,
  DraftActions,
  Field,
  Pill,
  PlusIcon,
  SettingsCard,
  SettingsGrid,
  SettingsSectionHeader,
  SettingsStack,
  SettingsTableCard,
  ToggleRow,
  btn,
  st,
} from "@/components/app/settings/primitives";
import { cn } from "@/lib/utils";
import { defaultStageColor } from "@/lib/design/tokenColor";
import type {
  DispositionCatalogEntry,
  DispositionMapping,
  PartnerPipelineType,
  Pipeline,
  PipelineCounts,
  PipelineStage,
  UnmappedOutcomes,
} from "@/lib/pipelines/types";

const typeLabel: Record<PartnerPipelineType, string> = { publisher: "Publisher / transfer", marketing: "Marketing", affiliate: "Affiliate" };
/** "" in a form means no partner type; the API takes it as null. */
type PartnerTypeChoice = PartnerPipelineType | "";
const DISPOSITION_KEY = /^[a-z][a-z0-9_]{1,79}$/;
const fmt = (n: number | undefined) => (n ?? 0).toLocaleString();

/** A won or lost stage closes the lead, and says so where a disposition points at it. */
const stageLabel = (stage: Pick<PipelineStage, "name" | "stage_type">) => (stage.stage_type === "open" ? stage.name : `${stage.name} · closes`);

/** The line beside a stage: its description, and "closes the lead" on a won or lost stage. */
const stageLine = (stage: Pick<PipelineStage, "description" | "stage_type">) => {
  const closes = stage.stage_type !== "open";
  if (stage.description) return closes ? `${stage.description} — closes the lead` : stage.description;
  return closes ? "Closes the lead" : "";
};

const smallControl =
  "box-border h-8 w-full min-w-0 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-[14px] tracking-[-0.02em] text-[var(--ink)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-60";

async function request(url: string, method: string, payload: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? "Could not save pipeline settings");
  return body;
}

type StageDraft = { name: string; stage_type: PipelineStage["stage_type"]; color: string; description: string };

export function PipelineSettings() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [counts, setCounts] = useState<PipelineCounts>({ pipelines: {}, stages: {} });
  const [mappings, setMappings] = useState<DispositionMapping[]>([]);
  const [catalog, setCatalog] = useState<DispositionCatalogEntry[]>([]);
  const [unmapped, setUnmapped] = useState<UnmappedOutcomes | null>(null);
  // False until stage descriptions can be stored (20260924130000): the field is disabled, not sent.
  const [descriptionsReady, setDescriptionsReady] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The disposition → stage map is the section's draft: edits are held here and written by Save.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [freeKey, setFreeKey] = useState({ disposition_key: "", stage_id: "" });

  const [creating, setCreating] = useState(false);
  const [newPipeline, setNewPipeline] = useState<{ name: string; partner_type: PartnerTypeChoice }>({ name: "", partner_type: "marketing" });
  const [editingPipeline, setEditingPipeline] = useState<Pipeline | null>(null);
  const [pipelineForm, setPipelineForm] = useState<{ name: string; partner_type: PartnerTypeChoice; is_default: boolean }>({ name: "", partner_type: "marketing", is_default: false });
  const [dialogError, setDialogError] = useState<string | null>(null);

  const [openStageId, setOpenStageId] = useState<string | null>(null);
  const [stageDraft, setStageDraft] = useState<StageDraft | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);
  const [addingStage, setAddingStage] = useState(false);
  // The colour is read from the palette when the form opens (a stored colour must be hex).
  const [newStage, setNewStage] = useState<StageDraft>({ name: "", stage_type: "open", color: "", description: "" });
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const savedMap = useMemo(() => Object.fromEntries(mappings.map((mapping) => [mapping.disposition_key, mapping.stage_id])), [mappings]);

  // A promise chain so every setState lands in a callback, not synchronously inside the effect.
  const load = useCallback(
    () =>
      Promise.all([fetch("/api/app/pipelines", { cache: "no-store" }), fetch("/api/app/pipelines/dispositions", { cache: "no-store" })])
        .then(async ([pipelineResponse, mappingResponse]) => {
          const pipelineBody = await pipelineResponse.json().catch(() => null);
          const mappingBody = await mappingResponse.json().catch(() => null);
          if (!pipelineResponse.ok) throw new Error(pipelineBody?.error ?? "Could not load pipelines");
          if (!mappingResponse.ok) throw new Error(mappingBody?.error ?? "Could not load disposition mappings");
          return { pipelineBody, mappingBody };
        })
        .then(({ pipelineBody, mappingBody }) => {
          const list: Pipeline[] = pipelineBody.pipelines ?? [];
          const maps: DispositionMapping[] = mappingBody.mappings ?? [];
          setPipelines(list);
          setCounts(pipelineBody.counts ?? { pipelines: {}, stages: {} });
          setMappings(maps);
          setCatalog(mappingBody.dispositions ?? []);
          setUnmapped(mappingBody.unmapped ?? null);
          setDescriptionsReady(pipelineBody.descriptionsReady !== false);
          setDraft(Object.fromEntries(maps.map((mapping) => [mapping.disposition_key, mapping.stage_id])));
          setSelectedId((current) => (list.some((pipeline) => pipeline.id === current) ? current : list.find((pipeline) => pipeline.is_default)?.id ?? list[0]?.id ?? ""));
          setLoadError(null);
        })
        .catch((cause: unknown) => setLoadError(cause instanceof Error ? cause.message : "Could not load pipelines"))
        .finally(() => setLoading(false)),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const selected = pipelines.find((pipeline) => pipeline.id === selectedId) ?? null;
  const liveStages = selected ? selected.stages.filter((stage) => !stage.is_archived) : [];
  const allStages = useMemo(
    () => pipelines.flatMap((pipeline) => pipeline.stages.filter((stage) => !stage.is_archived).map((stage) => ({ ...stage, pipelineName: pipeline.name }))),
    [pipelines],
  );
  const stageById = useMemo(() => new Map(pipelines.flatMap((pipeline) => pipeline.stages.map((stage) => [stage.id, { ...stage, pipelineName: pipeline.name }] as const))), [pipelines]);

  // Every active disposition, every key that is mapped, and every key added in this draft. A
  // disposition is never hidden for having no stage: that is the row that needs seeing.
  const rows = useMemo(() => {
    const labels = new Map(catalog.map((entry) => [entry.key, entry]));
    const keys: string[] = [];
    const add = (key: string) => { if (!keys.includes(key)) keys.push(key); };
    catalog.filter((entry) => entry.isActive).forEach((entry) => add(entry.key));
    Object.keys(savedMap).forEach(add);
    Object.keys(draft).forEach(add);
    return keys.map((key) => ({ key, entry: labels.get(key) ?? null }));
  }, [catalog, savedMap, draft]);

  const unmappedCount = rows.filter((row) => (row.entry ? row.entry.isActive : true) && !draft[row.key]).length;
  const changedKeys = rows.map((row) => row.key).filter((key) => (draft[key] ?? "") !== (savedMap[key] ?? ""));
  const dirty = changedKeys.length > 0;

  function replaceStage(stage: PipelineStage) {
    setPipelines((items) => items.map((pipeline) => (pipeline.id === stage.pipeline_id ? { ...pipeline, stages: pipeline.stages.map((item) => (item.id === stage.id ? stage : item)) } : pipeline)));
  }

  /* ── the mapping draft ──────────────────────────────────────────────── */

  function discardMappings() {
    setDraft(savedMap);
    setMappingError(null);
  }

  async function saveMappings() {
    // Every active outcome lands somewhere: taking the stage away from one is refused here, as the
    // server refuses it. Point it at another stage, or archive the outcome in Dispositions.
    const orphaned = changedKeys.filter((key) => !draft[key] && savedMap[key] && catalog.some((entry) => entry.key === key && entry.isActive));
    if (orphaned.length > 0) {
      const names = orphaned.map((key) => catalog.find((entry) => entry.key === key)?.label ?? key);
      setMappingError(`Every active outcome must land on a stage. Choose a stage for ${names.join(", ")}, or archive ${orphaned.length === 1 ? "it" : "them"} in Dispositions first.`);
      return;
    }
    setSaving(true);
    setMappingError(null);
    try {
      for (const key of changedKeys) {
        const stageId = draft[key] ?? "";
        if (stageId) await request("/api/app/pipelines/dispositions", "POST", { stage_id: stageId, disposition_key: key });
        else {
          const mapping = mappings.find((item) => item.disposition_key === key);
          if (mapping) await request("/api/app/pipelines/dispositions", "DELETE", { id: mapping.id });
        }
      }
      notify.done(changedKeys.length === 1 ? "Mapping saved" : `${changedKeys.length} mappings saved`);
      await load();
    } catch (cause) {
      // Some rows may have saved before the failure; reloading shows exactly which.
      setMappingError(cause instanceof Error ? cause.message : "Could not save the mappings");
      await load();
    } finally {
      setSaving(false);
    }
  }

  function addFreeKey(event: React.FormEvent) {
    event.preventDefault();
    const key = freeKey.disposition_key.trim().toLowerCase();
    if (!DISPOSITION_KEY.test(key)) {
      setMappingError("A disposition key uses lowercase letters, numbers and underscores, starting with a letter.");
      return;
    }
    setMappingError(null);
    setDraft((current) => ({ ...current, [key]: freeKey.stage_id }));
    setFreeKey({ disposition_key: "", stage_id: "" });
  }

  /* ── pipelines ──────────────────────────────────────────────────────── */

  async function createPipeline(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setDialogError(null);
    try {
      const body = await request("/api/app/pipelines", "POST", { ...newPipeline, partner_type: newPipeline.partner_type || null });
      setPipelines((items) => [...items, { ...body.pipeline, stages: [] }]);
      setSelectedId(body.pipeline.id);
      setNewPipeline({ name: "", partner_type: "marketing" });
      setCreating(false);
      notify.done("Pipeline created");
    } catch (cause) {
      setDialogError(cause instanceof Error ? cause.message : "Could not create pipeline");
    } finally {
      setBusy(false);
    }
  }

  function openPipeline(pipeline: Pipeline) {
    setSelectedId(pipeline.id);
    setEditingPipeline(pipeline);
    setPipelineForm({ name: pipeline.name, partner_type: pipeline.partner_type ?? "", is_default: pipeline.is_default });
    setDialogError(null);
  }

  async function savePipeline(event: React.FormEvent) {
    event.preventDefault();
    if (!editingPipeline) return;
    setBusy(true);
    setDialogError(null);
    try {
      const patch: Record<string, unknown> = {};
      if (pipelineForm.name !== editingPipeline.name) patch.name = pipelineForm.name;
      if ((pipelineForm.partner_type || null) !== editingPipeline.partner_type) patch.partner_type = pipelineForm.partner_type || null;
      if (pipelineForm.is_default !== editingPipeline.is_default) patch.is_default = pipelineForm.is_default;
      if (Object.keys(patch).length > 0) await request(`/api/app/pipelines/${editingPipeline.id}`, "PATCH", patch);
      setEditingPipeline(null);
      notify.done("Pipeline saved");
      await load();
    } catch (cause) {
      setDialogError(cause instanceof Error ? cause.message : "Could not save pipeline");
    } finally {
      setBusy(false);
    }
  }

  async function deletePipeline() {
    if (!editingPipeline) return;
    if (!window.confirm(`Delete ${editingPipeline.name}? This cannot be undone. A pipeline with leads, disposition history or the default flag cannot be deleted.`)) return;
    setBusy(true);
    setDialogError(null);
    try {
      await request(`/api/app/pipelines/${editingPipeline.id}`, "DELETE", {});
      setEditingPipeline(null);
      notify.done("Pipeline deleted");
      await load();
    } catch (cause) {
      setDialogError(cause instanceof Error ? cause.message : "Could not delete pipeline");
    } finally {
      setBusy(false);
    }
  }

  /* ── stages ─────────────────────────────────────────────────────────── */

  function toggleStage(stage: PipelineStage) {
    if (openStageId === stage.id) {
      setOpenStageId(null);
      return;
    }
    setOpenStageId(stage.id);
    setStageDraft({ name: stage.name, stage_type: stage.stage_type, color: stage.color, description: stage.description ?? "" });
    setStageError(null);
  }

  async function saveStage(stage: PipelineStage) {
    if (!stageDraft) return;
    const patch: Record<string, unknown> = {};
    if (stageDraft.name !== stage.name) patch.name = stageDraft.name;
    if (stageDraft.stage_type !== stage.stage_type) patch.stage_type = stageDraft.stage_type;
    if (stageDraft.color.toLowerCase() !== stage.color.toLowerCase()) patch.color = stageDraft.color;
    if (descriptionsReady && stageDraft.description.trim() !== (stage.description ?? "")) patch.description = stageDraft.description.trim();
    if (Object.keys(patch).length === 0) {
      setOpenStageId(null);
      return;
    }
    setBusy(true);
    setStageError(null);
    try {
      const body = await request(`/api/app/pipelines/${stage.pipeline_id}/stages/${stage.id}`, "PATCH", patch);
      replaceStage({ ...body.stage, description: body.stage.description ?? null });
      setOpenStageId(null);
      notify.done("Stage saved");
    } catch (cause) {
      setStageError(cause instanceof Error ? cause.message : "Could not save stage");
    } finally {
      setBusy(false);
    }
  }

  async function archive(stage: PipelineStage) {
    if (!window.confirm(`Archive ${stage.name}? Existing leads will remain readable, but the stage will leave future pickers.`)) return;
    setBusy(true);
    try {
      const body = await request(`/api/app/pipelines/${stage.pipeline_id}/stages/${stage.id}`, "PATCH", { is_archived: true });
      replaceStage(body.stage);
      setOpenStageId(null);
      notify.done("Stage archived");
    } catch (cause) {
      setStageError(cause instanceof Error ? cause.message : "Could not archive stage");
    } finally {
      setBusy(false);
    }
  }

  async function reorder(ids: string[]) {
    if (!selected) return;
    try {
      const body = await request(`/api/app/pipelines/${selected.id}/stages/reorder`, "POST", { stage_ids: ids });
      setPipelines((items) => items.map((pipeline) => (pipeline.id === selected.id ? { ...pipeline, stages: body.stages } : pipeline)));
      notify.done("Stage order saved");
    } catch (cause) {
      notify.fail(cause instanceof Error ? cause.message : "Could not reorder stages");
    }
  }

  async function dropStage(target: PipelineStage) {
    if (!draggedId || draggedId === target.id) return setDraggedId(null);
    const stages = [...liveStages];
    const from = stages.findIndex((stage) => stage.id === draggedId);
    const to = stages.findIndex((stage) => stage.id === target.id);
    setDraggedId(null);
    if (from < 0 || to < 0) return;
    const [moved] = stages.splice(from, 1);
    stages.splice(to, 0, moved);
    await reorder(stages.map((stage) => stage.id));
  }

  /** The keyboard route to the same reorder the drag does. */
  async function move(stage: PipelineStage, by: -1 | 1) {
    const ids = liveStages.map((item) => item.id);
    const from = ids.indexOf(stage.id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    await reorder(ids);
  }

  async function createStage(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setStageError(null);
    try {
      const color = newStage.color || defaultStageColor() || "";
      const body = await request(`/api/app/pipelines/${selected.id}/stages`, "POST", { ...newStage, color, description: descriptionsReady ? newStage.description.trim() || undefined : undefined });
      setPipelines((items) => items.map((pipeline) => (pipeline.id === selected.id ? { ...pipeline, stages: [...pipeline.stages, body.stage] } : pipeline)));
      setNewStage({ name: "", stage_type: "open", color: "", description: "" });
      setAddingStage(false);
      notify.done("Stage added");
    } catch (cause) {
      setStageError(cause instanceof Error ? cause.message : "Could not add stage");
    } finally {
      setBusy(false);
    }
  }

  /* ── render ─────────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        <p className="text-[14px] text-[var(--muted)]">Loading pipeline settings…</p>
      </SettingsStack>
    );
  }
  if (loadError) {
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        <Callout tone="error" title="Could not load pipelines">{loadError}</Callout>
      </SettingsStack>
    );
  }

  const stageOptions = (current: string) => (
    <>
      <option value="">Not mapped &mdash; stays where it is</option>
      {pipelines.map((pipeline) => {
        const live = allStages.filter((stage) => stage.pipeline_id === pipeline.id);
        if (live.length === 0) return null;
        return (
          <optgroup key={pipeline.id} label={pipeline.name}>
            {live.map((stage) => <option key={stage.id} value={stage.id}>{stageLabel(stage)}</option>)}
          </optgroup>
        );
      })}
      {current && !allStages.some((stage) => stage.id === current) && (
        <option value={current}>{stageById.get(current) ? `${stageById.get(current)?.name} (archived)` : "Archived stage"}</option>
      )}
    </>
  );

  const outcomes = unmapped?.outcomes ?? 0;

  return (
    <SettingsStack>
      <SettingsSectionHeader actions={<DraftActions dirty={dirty} saving={saving} onDiscard={discardMappings} onSave={() => void saveMappings()} />} />

      <Callout tone="error" title="A disposition with no stage is where leads disappear">
        {fmt(outcomes)} {outcomes === 1 ? "outcome was" : "outcomes were"} recorded against leads that never moved, because the outcome had no stage mapped to it.
        Every row in the mapping below must land somewhere; the unmapped count is shown and it is not allowed to be hidden.
      </Callout>

      <SettingsTableCard
        title="Pipelines"
        actions={
          <button type="button" className={btn("secondary")} onClick={() => { setCreating(true); setDialogError(null); }}>
            <PlusIcon /> Create a pipeline
          </button>
        }
      >
        {pipelines.length === 0 ? (
          <p className="m-0 px-4 py-6 text-[14px] text-[var(--muted)]">No pipelines yet. Create one to give leads stages to move through.</p>
        ) : (
          <table className={st.table}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={st.th}>Pipeline</th>
                <th scope="col" className={cn(st.th, "w-[200px]")}>Partner type</th>
                <th scope="col" className={cn(st.th, "w-[120px]")}>Stages</th>
                <th scope="col" className={cn(st.th, "w-[150px]")}>Leads in it</th>
                <th scope="col" className={cn(st.th, "w-[130px]")}>Default</th>
                <th scope="col" className={cn(st.th, "w-[110px]")}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {pipelines.map((pipeline) => (
                <tr key={pipeline.id} className={cn(pipeline.id === selectedId && "bg-[var(--surface-alt)]")}>
                  <td className={st.td}>
                    <button
                      type="button"
                      className="cursor-pointer text-left font-semibold text-[var(--ink)] hover:underline"
                      aria-pressed={pipeline.id === selectedId}
                      aria-label={`Show ${pipeline.name}'s stages`}
                      onClick={() => { setSelectedId(pipeline.id); setOpenStageId(null); setAddingStage(false); }}
                    >
                      {pipeline.name}
                    </button>
                  </td>
                  <td className={st.td}>{pipeline.partner_type ? typeLabel[pipeline.partner_type] : "—"}</td>
                  <td className={cn(st.td, "tabular-nums")}>{pipeline.stages.filter((stage) => !stage.is_archived).length}</td>
                  <td className={cn(st.td, "tabular-nums")}>{fmt(counts.pipelines[pipeline.id])}</td>
                  <td className={st.td}>{pipeline.is_default ? <Pill tone="brand">Default</Pill> : "—"}</td>
                  <td className={cn(st.td, "text-right")}>
                    <button type="button" className={btn("row")} onClick={() => openPipeline(pipeline)} aria-label={`Edit ${pipeline.name}`}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SettingsTableCard>

      <SettingsGrid>
        <SettingsCard
          title={selected ? <>Stages &middot; {selected.name}</> : "Stages"}
          sub="Drag to reorder. The order is what the board columns use."
        >
          {!selected ? (
            <p className="m-0 text-[14px] text-[var(--muted)]">Create a pipeline to add stages to it.</p>
          ) : (
            <div>
              {stageError && <Callout tone="error" title="The stage was not saved" className="mb-3">{stageError}</Callout>}
              {liveStages.length === 0 && <p className="m-0 border-t border-[var(--border)] py-3 text-[14px] text-[var(--muted)]">No stages yet.</p>}
              {liveStages.map((stage, index) => {
                const open = openStageId === stage.id && stageDraft;
                return (
                  <div
                    key={stage.id}
                    draggable={!open}
                    onDragStart={() => setDraggedId(stage.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => void dropStage(stage)}
                    className={cn("border-t border-[var(--border)]", draggedId === stage.id && "opacity-50")}
                  >
                    <div className={cn("flex items-center gap-3 py-[11px]", !open && "cursor-grab")}>
                      <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: stage.color }} />
                      <span className="w-[170px] shrink-0 truncate text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{stage.name}</span>
                      <span className="min-w-0 flex-1 truncate text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
                        {stageLine(stage)}
                      </span>
                      <span className="text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)] tabular-nums">{fmt(counts.stages[stage.id])}</span>
                      <button type="button" className={btn("row", "px-2")} aria-expanded={Boolean(open)} aria-label={`Edit stage ${stage.name}`} onClick={() => toggleStage(stage)}>
                        Edit
                      </button>
                    </div>
                    {open && (
                      <form
                        className="mb-3 grid gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface-alt)] p-3 sm:grid-cols-2"
                        onSubmit={(event) => { event.preventDefault(); void saveStage(stage); }}
                      >
                        <Field label="Name" htmlFor={`stage-name-${stage.id}`}>
                          <input id={`stage-name-${stage.id}`} className={control} maxLength={120} required value={stageDraft.name} onChange={(event) => setStageDraft({ ...stageDraft, name: event.target.value })} />
                        </Field>
                        <div className="grid grid-cols-[1fr_88px] gap-3">
                          <Field label="Type" htmlFor={`stage-type-${stage.id}`}>
                            <select id={`stage-type-${stage.id}`} className={control} value={stageDraft.stage_type} onChange={(event) => setStageDraft({ ...stageDraft, stage_type: event.target.value as PipelineStage["stage_type"] })}>
                              <option value="open">Open</option>
                              <option value="won">Won</option>
                              <option value="lost">Lost</option>
                            </select>
                          </Field>
                          <Field label="Colour" htmlFor={`stage-color-${stage.id}`}>
                            <input id={`stage-color-${stage.id}`} type="color" className={cn(control, "px-1")} value={stageDraft.color} onChange={(event) => setStageDraft({ ...stageDraft, color: event.target.value })} />
                          </Field>
                        </div>
                        <Field label="Description" htmlFor={`stage-description-${stage.id}`} hint={descriptionsReady ? "One line on what the stage means." : "Descriptions need a database update that has not been applied yet; the rest of the stage saves."} className="sm:col-span-2">
                          <input id={`stage-description-${stage.id}`} className={control} maxLength={200} placeholder="A human answered" value={stageDraft.description} disabled={!descriptionsReady} onChange={(event) => setStageDraft({ ...stageDraft, description: event.target.value })} />
                        </Field>
                        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
                          <button type="submit" className={btn("primary-sm")} disabled={busy}>Save stage</button>
                          <button type="button" className={btn("row")} onClick={() => setOpenStageId(null)}>Cancel</button>
                          <button type="button" className={btn("row")} disabled={busy || index === 0} onClick={() => void move(stage, -1)}>Move up</button>
                          <button type="button" className={btn("row")} disabled={busy || index === liveStages.length - 1} onClick={() => void move(stage, 1)}>Move down</button>
                          <button type="button" className={btn("danger-row", "ml-auto")} disabled={busy} onClick={() => void archive(stage)}>Archive</button>
                        </div>
                      </form>
                    )}
                  </div>
                );
              })}
              <div className="border-t border-[var(--border)] pt-3">
                {addingStage ? (
                  <form onSubmit={createStage} className="grid gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface-alt)] p-3 sm:grid-cols-2">
                    <Field label="New stage" htmlFor="new-stage-name" required>
                      <input id="new-stage-name" className={control} maxLength={120} required placeholder="Needs review" value={newStage.name} onChange={(event) => setNewStage({ ...newStage, name: event.target.value })} />
                    </Field>
                    <div className="grid grid-cols-[1fr_88px] gap-3">
                      <Field label="Type" htmlFor="new-stage-type">
                        <select id="new-stage-type" className={control} value={newStage.stage_type} onChange={(event) => setNewStage({ ...newStage, stage_type: event.target.value as PipelineStage["stage_type"] })}>
                          <option value="open">Open</option>
                          <option value="won">Won</option>
                          <option value="lost">Lost</option>
                        </select>
                      </Field>
                      <Field label="Colour" htmlFor="new-stage-color">
                        <input id="new-stage-color" type="color" className={cn(control, "px-1")} value={newStage.color} onChange={(event) => setNewStage({ ...newStage, color: event.target.value })} />
                      </Field>
                    </div>
                    <Field label="Description" htmlFor="new-stage-description" className="sm:col-span-2" hint={descriptionsReady ? undefined : "Descriptions need a database update that has not been applied yet."}>
                      <input id="new-stage-description" className={control} maxLength={200} placeholder="Optional" value={newStage.description} disabled={!descriptionsReady} onChange={(event) => setNewStage({ ...newStage, description: event.target.value })} />
                    </Field>
                    <div className="flex gap-2 sm:col-span-2">
                      <button type="submit" className={btn("primary-sm")} disabled={busy}>Add stage</button>
                      <button type="button" className={btn("row")} onClick={() => setAddingStage(false)}>Cancel</button>
                    </div>
                  </form>
                ) : (
                  <button type="button" className={btn("secondary")} onClick={() => { setNewStage((current) => ({ ...current, color: current.color || defaultStageColor() || "" })); setAddingStage(true); setStageError(null); }}>
                    <PlusIcon /> Add a stage
                  </button>
                )}
              </div>
            </div>
          )}
        </SettingsCard>

        <SettingsCard title="Disposition → stage" sub="Every outcome lands somewhere, or it is listed as unmapped.">
          {mappingError && <Callout tone="error" title="Not every mapping saved" className="mb-3">{mappingError}</Callout>}
          {rows.length === 0 ? (
            <p className="m-0 text-[14px] text-[var(--muted)]">No dispositions are set up yet. Add them under Dispositions, or map a key below.</p>
          ) : (
            <table className={st.table}>
              <thead>
                <tr className={st.headRow}>
                  <th scope="col" className={st.th}>Disposition</th>
                  <th scope="col" className={cn(st.th, "w-[220px]")}>Moves to</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ key, entry }) => {
                  const value = draft[key] ?? "";
                  const id = `mapping-${key}`;
                  return (
                    <tr key={key}>
                      <td className={st.td}>
                        <label htmlFor={id} className="text-[var(--body)]">{entry?.label ?? key}</label>
                        <span className={st.sub}>
                          <code className="font-mono text-[12px]">{key}</code>
                          {entry && !entry.isActive ? " · inactive" : ""}
                          {!entry ? " · not in your dispositions" : ""}
                        </span>
                      </td>
                      <td className={st.td}>
                        <select
                          id={id}
                          className={cn(smallControl, !value && "text-[var(--warning-ink)]")}
                          value={value}
                          onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                        >
                          {stageOptions(value)}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="mt-3.5">
            <Pill tone={unmappedCount === 0 ? "success" : "warning"} dot>
              {unmappedCount} unmapped {unmappedCount === 1 ? "disposition" : "dispositions"}
            </Pill>
          </div>

          <form onSubmit={addFreeKey} className="mt-4 grid gap-3 border-t border-[var(--border)] pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Another disposition key" htmlFor="mapping-key">
              <input id="mapping-key" className={control} maxLength={80} pattern="[a-z][a-z0-9_]{1,79}" placeholder="needs_callback" value={freeKey.disposition_key} onChange={(event) => setFreeKey({ ...freeKey, disposition_key: event.target.value })} required />
            </Field>
            <Field label="Stage" htmlFor="mapping-stage">
              <select id="mapping-stage" className={control} value={freeKey.stage_id} onChange={(event) => setFreeKey({ ...freeKey, stage_id: event.target.value })} required>
                <option value="">Choose a stage</option>
                {allStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.pipelineName} · {stageLabel(stage)}</option>)}
              </select>
            </Field>
            <button type="submit" className={btn("secondary", "mb-0.5")}>Add</button>
          </form>

          <p className="mt-4 mb-0 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
            Each disposition routes the lead to one stage, <strong>in any pipeline</strong> &mdash; point it at the entry
            stage of a pipeline reserved for that outcome and recording it moves the lead there. The lead, its queue item
            and its deal-flow record move together; a disposition with no mapping leaves the lead where it is. On the
            dialer only outcomes that finish the lead&rsquo;s calling move it; a retry or a scheduled callback stays put
            until then. Nothing here changes until you save.
          </p>
        </SettingsCard>
      </SettingsGrid>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a pipeline</DialogTitle>
            <DialogDescription>A pipeline has its own ordered stages. Give it a partner type to make it eligible as that type&rsquo;s default, or none for outbound and inbound work. Changes apply to this workspace only.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createPipeline} className="flex flex-col gap-4">
            <Field label="Pipeline name" htmlFor="new-pipeline-name" required>
              <input id="new-pipeline-name" className={control} maxLength={120} required placeholder="Qualified referrals" value={newPipeline.name} onChange={(event) => setNewPipeline({ ...newPipeline, name: event.target.value })} />
            </Field>
            <Field label="Partner type" htmlFor="new-pipeline-type">
              <select id="new-pipeline-type" className={control} value={newPipeline.partner_type} onChange={(event) => setNewPipeline({ ...newPipeline, partner_type: event.target.value as PartnerTypeChoice })}>
                <option value="">No partner type</option>
                <option value="publisher">Publisher / transfer</option>
                <option value="marketing">Marketing</option>
                <option value="affiliate">Affiliate</option>
              </select>
            </Field>
            {dialogError && <span role="alert" className="text-[12px] text-[var(--error-ink)]">{dialogError}</span>}
            <DialogFooter>
              <button type="button" className={btn("ghost")} onClick={() => setCreating(false)}>Cancel</button>
              <button type="submit" className={btn("primary")} disabled={busy}>{busy ? "Creating…" : "Create pipeline"}</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editingPipeline !== null} onOpenChange={(next) => !next && setEditingPipeline(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editingPipeline?.name}</DialogTitle>
            <DialogDescription>
              {fmt(editingPipeline ? counts.pipelines[editingPipeline.id] : 0)} leads are in this pipeline. A pipeline with leads cannot change partner type.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={savePipeline} className="flex flex-col gap-4">
            <Field label="Pipeline name" htmlFor="edit-pipeline-name" required>
              <input id="edit-pipeline-name" className={control} maxLength={120} required value={pipelineForm.name} onChange={(event) => setPipelineForm({ ...pipelineForm, name: event.target.value })} />
            </Field>
            <Field label="Partner type" htmlFor="edit-pipeline-type">
              <select id="edit-pipeline-type" className={control} value={pipelineForm.partner_type} onChange={(event) => setPipelineForm({ ...pipelineForm, partner_type: event.target.value as PartnerTypeChoice })}>
                <option value="">No partner type</option>
                <option value="publisher">Publisher / transfer</option>
                <option value="marketing">Marketing</option>
                <option value="affiliate">Affiliate</option>
              </select>
            </Field>
            <ToggleRow
              id="edit-pipeline-default"
              title={pipelineForm.partner_type ? "Default for this partner type" : "Default for leads with no partner"}
              help={
                pipelineForm.partner_type
                  ? "New leads of this partner type start in the default pipeline. There is one default per partner type."
                  : "Leads with no partner enter this pipeline: list imports offer its stages, and vendor posts land in its first open stage. There is one such default."
              }
              checked={pipelineForm.is_default}
              onChange={(next) => setPipelineForm({ ...pipelineForm, is_default: next })}
            />
            {dialogError && <span role="alert" className="text-[12px] text-[var(--error-ink)]">{dialogError}</span>}
            <DialogFooter className="sm:justify-between">
              <button type="button" className={btn("danger-row")} disabled={busy} onClick={() => void deletePipeline()}>Delete pipeline</button>
              <span className="flex gap-2">
                <button type="button" className={btn("ghost")} onClick={() => setEditingPipeline(null)}>Cancel</button>
                <button type="submit" className={btn("primary")} disabled={busy}>{busy ? "Saving…" : "Save pipeline"}</button>
              </span>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsStack>
  );
}
