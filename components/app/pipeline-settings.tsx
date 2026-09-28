"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Plus } from "lucide-react";

import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { DispositionLibrary, PipelineCreateDialog, PipelineStageManager } from "@/components/app/pipeline-stage-manager";
import { Callout, control, Field, Pill, SettingsSectionHeader, SettingsStack, ToggleRow, st } from "@/components/app/settings/primitives";
import { cn } from "@/lib/utils";
import type { PipelineViewContext } from "@/lib/pipelines/views";
import type {
  DispositionCatalogEntry,
  DispositionMapping,
  PartnerPipelineType,
  Pipeline,
  PipelineCounts,
  PipelineStage,
  UnmappedOutcomes,
} from "@/lib/pipelines/types";

/**
 * Settings › Pipelines — the one place pipelines are managed (2026-09-28: stage editing lives here,
 * not in the lead workspace). Owners only, as the settings page is.
 *
 * - Pipelines: create one with the new-pipeline wizard, rename it / change its partner type / make it
 *   the default / delete it, and edit its stages in the stage manager (the same PipelineStageManager,
 *   PipelineCreateDialog and DispositionLibrary the lead workspace used to open, fed the same data).
 * - Disposition → stage: the section's draft. Each disposition routes a lead to one stage, in any
 *   pipeline; the save bar writes every changed row.
 */

const typeLabel: Record<PartnerPipelineType, string> = { publisher: "Publisher / transfer", marketing: "Marketing", affiliate: "Affiliate" };
/** "" in a form means no partner type; the API takes it as null. */
type PartnerTypeChoice = PartnerPipelineType | "";
const DISPOSITION_KEY = /^[a-z][a-z0-9_]{1,79}$/;
const fmt = (n: number | undefined) => (n ?? 0).toLocaleString();

/** A won or lost stage closes the lead, and says so where a disposition points at it. */
const stageLabel = (stage: Pick<PipelineStage, "name" | "stage_type">) => (stage.stage_type === "open" ? stage.name : `${stage.name} · closes`);

const smallControl =
  "box-border h-8 w-full min-w-0 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-[14px] tracking-[-0.02em] text-[var(--ink)] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)] disabled:cursor-not-allowed disabled:opacity-60";

async function request(url: string, method: string, payload: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error ?? "Could not save pipeline settings");
  return body;
}

type MappingFilter = "all" | "unmapped";

export function PipelineSettings() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [counts, setCounts] = useState<PipelineCounts>({ pipelines: {}, stages: {} });
  const [mappings, setMappings] = useState<DispositionMapping[]>([]);
  const [catalog, setCatalog] = useState<DispositionCatalogEntry[]>([]);
  const [unmapped, setUnmapped] = useState<UnmappedOutcomes | null>(null);
  // Stage rules, the dispositions landing on each stage, draft pipelines: what the stage manager,
  // the new-pipeline wizard and the disposition library read. Null until it loads (or if it fails).
  const [context, setContext] = useState<PipelineViewContext | null>(null);
  // False until stage descriptions can be stored (20260924130000).
  const [descriptionsReady, setDescriptionsReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The disposition → stage map is the section's draft: edits are held here and written by Save.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [freeKey, setFreeKey] = useState({ disposition_key: "", stage_id: "" });
  const [pipelineQuery, setPipelineQuery] = useState("");
  const [mappingQuery, setMappingQuery] = useState("");
  const [mappingFilter, setMappingFilter] = useState<MappingFilter>("all");

  const [editingPipeline, setEditingPipeline] = useState<Pipeline | null>(null);
  const [pipelineForm, setPipelineForm] = useState<{ name: string; partner_type: PartnerTypeChoice; is_default: boolean }>({ name: "", partner_type: "marketing", is_default: false });
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The three overlays the lead workspace used to open.
  const [creating, setCreating] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [managingId, setManagingId] = useState<string | null>(null);
  // When each lead on a stage entered it, by stage id: the stage manager's "past the time allowed"
  // preview. Read from the leads when the manager opens.
  const [stageEntries, setStageEntries] = useState<Record<string, Array<string | null>>>({});

  const savedMap = useMemo(() => Object.fromEntries(mappings.map((mapping) => [mapping.disposition_key, mapping.stage_id])), [mappings]);

  // A promise chain so every setState lands in a callback, not synchronously inside the effect.
  const load = useCallback(
    () =>
      Promise.all([
        fetch("/api/app/pipelines", { cache: "no-store" }),
        fetch("/api/app/pipelines/dispositions", { cache: "no-store" }),
        fetch("/api/app/leads/pipeline-context", { cache: "no-store" }).catch(() => null),
      ])
        .then(async ([pipelineResponse, mappingResponse, contextResponse]) => {
          const pipelineBody = await pipelineResponse.json().catch(() => null);
          const mappingBody = await mappingResponse.json().catch(() => null);
          const contextBody = contextResponse?.ok ? await contextResponse.json().catch(() => null) : null;
          if (!pipelineResponse.ok) throw new Error(pipelineBody?.error ?? "Could not load pipelines");
          if (!mappingResponse.ok) throw new Error(mappingBody?.error ?? "Could not load disposition mappings");
          return { pipelineBody, mappingBody, contextBody };
        })
        .then(({ pipelineBody, mappingBody, contextBody }) => {
          const maps: DispositionMapping[] = mappingBody.mappings ?? [];
          setPipelines(pipelineBody.pipelines ?? []);
          setCounts(pipelineBody.counts ?? { pipelines: {}, stages: {} });
          setMappings(maps);
          setCatalog(mappingBody.dispositions ?? []);
          setUnmapped(mappingBody.unmapped ?? null);
          setDescriptionsReady(pipelineBody.descriptionsReady !== false);
          setContext(contextBody as PipelineViewContext | null);
          setDraft(Object.fromEntries(maps.map((mapping) => [mapping.disposition_key, mapping.stage_id])));
          setLoadError(null);
        })
        .catch((cause: unknown) => setLoadError(cause instanceof Error ? cause.message : "Could not load pipelines"))
        .finally(() => setLoading(false)),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }

  const allStages = useMemo(
    () => pipelines.flatMap((pipeline) => pipeline.stages.filter((stage) => !stage.is_archived).map((stage) => ({ ...stage, pipelineName: pipeline.name }))),
    [pipelines],
  );
  const stageById = useMemo(() => new Map(pipelines.flatMap((pipeline) => pipeline.stages.map((stage) => [stage.id, { ...stage, pipelineName: pipeline.name }] as const))), [pipelines]);
  // Every stage by name and pipeline, for the stage manager to name where a disposition moves from.
  const stageList = useMemo(() => [...stageById.values()].map((stage) => ({ id: stage.id, name: stage.name, pipelineName: stage.pipelineName })), [stageById]);
  const managing = pipelines.find((pipeline) => pipeline.id === managingId) ?? null;

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

  const pipelineNeedle = pipelineQuery.trim().toLowerCase();
  const shownPipelines = pipelines.filter((pipeline) => !pipelineNeedle || pipeline.name.toLowerCase().includes(pipelineNeedle) || pipeline.stages.some((stage) => !stage.is_archived && stage.name.toLowerCase().includes(pipelineNeedle)));
  const mappingNeedle = mappingQuery.trim().toLowerCase();
  const shownRows = rows.filter(({ key, entry }) => {
    if (mappingFilter === "unmapped" && draft[key]) return false;
    return !mappingNeedle || key.includes(mappingNeedle) || (entry?.label ?? "").toLowerCase().includes(mappingNeedle);
  });

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
      setMappingError(`Choose a stage for ${names.join(", ")}, or archive ${orphaned.length === 1 ? "it" : "them"} in Dispositions first.`);
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

  function openPipeline(pipeline: Pipeline) {
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

  /** Opens the stage manager, and reads when each lead entered its stage for its time-allowed preview. */
  function manageStages(pipeline: Pipeline) {
    setManagingId(pipeline.id);
    void fetch("/api/app/leads", { cache: "no-store" })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((body: { leads?: Array<{ stage_id: string; stage_entered_at?: string | null }> } | null) => {
        if (!body?.leads) return;
        const entries: Record<string, Array<string | null>> = {};
        for (const lead of body.leads) (entries[lead.stage_id] ??= []).push(lead.stage_entered_at ?? null);
        setStageEntries(entries);
      })
      .catch(() => undefined);
  }

  /* ── render ─────────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        <TableCard><SectionLoading label="Loading pipelines" /></TableCard>
      </SettingsStack>
    );
  }
  if (loadError) {
    return (
      <SettingsStack>
        <SettingsSectionHeader />
        <Callout tone="error" title={loadError} />
        <div><Button type="button" variant="outline" onClick={() => { setLoading(true); void load(); }}>Try again</Button></div>
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
  const leadsInPipelines = Object.values(counts.pipelines).reduce((sum, value) => sum + (value ?? 0), 0);

  return (
    <SettingsStack>
      <SettingsSectionHeader />

      <StatStrip label="Pipeline totals">
        <StatTile label="Pipelines" value={pipelines.length} footnote={`${pipelines.filter((pipeline) => pipeline.is_default).length} default`} />
        <StatTile label="Live stages" value={allStages.length} />
        <StatTile label="Leads" value={fmt(leadsInPipelines)} footnote="across every pipeline" />
        <StatTile
          label="Unmapped dispositions"
          value={unmappedCount}
          valueTone={unmappedCount > 0 ? "warning" : undefined}
          footnote={outcomes > 0 ? `${fmt(outcomes)} ${outcomes === 1 ? "outcome" : "outcomes"} left a lead where it was` : "every outcome moves the lead"}
        />
      </StatStrip>

      {unmappedCount > 0 && (
        <Callout tone="error" title={`${unmappedCount} ${unmappedCount === 1 ? "disposition has" : "dispositions have"} no stage — a disposition with no mapping leaves the lead where it is.`} />
      )}
      {!descriptionsReady && <Callout tone="warning" title="Stage descriptions need a database update; every other stage edit saves." />}

      <TableCard
        title="Pipelines"
        toolbar={
          <DataToolbar
            actions={
              <>
                <Button type="button" onClick={() => setCreating(true)}>
                  <Plus aria-hidden="true" />
                  New pipeline
                </Button>
                <RefreshButton onClick={() => void refresh()} refreshing={refreshing} />
              </>
            }
          >
            <ToolbarSearch value={pipelineQuery} onChange={setPipelineQuery} placeholder="Search pipelines or stages" />
          </DataToolbar>
        }
      >
        {pipelines.length === 0 ? (
          <EmptyState title="No pipelines yet" hint="Create one to give leads stages to move through." action={<Button type="button" onClick={() => setCreating(true)}><Plus aria-hidden="true" />New pipeline</Button>} />
        ) : shownPipelines.length === 0 ? (
          <NoMatches noun="pipelines" onClear={() => setPipelineQuery("")} />
        ) : (
          <table className={cn(st.table, "min-w-[760px]")}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={st.th}>Pipeline</th>
                <th scope="col" className={cn(st.th, "w-[180px]")}>Partner type</th>
                <th scope="col" className={cn(st.th, st.num, "w-[90px]")}>Stages</th>
                <th scope="col" className={cn(st.th, st.num, "w-[110px]")}>Leads</th>
                <th scope="col" className={cn(st.th, "w-[190px]")}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shownPipelines.map((pipeline) => {
                const live = pipeline.stages.filter((stage) => !stage.is_archived).sort((a, b) => a.position - b.position);
                const draftPipeline = context?.draftPipelineIds.includes(pipeline.id) ?? false;
                return (
                  <tr key={pipeline.id}>
                    <td className={st.td}>
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <span className={st.strong}>{pipeline.name}</span>
                        {pipeline.is_default && <Pill tone="brand">Default</Pill>}
                        {draftPipeline && <Pill tone="warning">Draft</Pill>}
                      </span>
                      <span className={cn(st.sub, "flex flex-wrap items-center gap-x-2 gap-y-0.5")}>
                        {live.length === 0
                          ? "No stages yet"
                          : live.map((stage) => (
                              <span key={stage.id} className="inline-flex items-center gap-1">
                                <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: stage.color }} />
                                {stage.name}
                              </span>
                            ))}
                      </span>
                    </td>
                    <td className={st.td}>{pipeline.partner_type ? typeLabel[pipeline.partner_type] : "—"}</td>
                    <td className={cn(st.td, st.num)}>{live.length}</td>
                    <td className={cn(st.td, st.num)}>{fmt(counts.pipelines[pipeline.id])}</td>
                    <td className={cn(st.td, "whitespace-nowrap text-right")}>
                      <span className="inline-flex gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => manageStages(pipeline)} aria-label={`Edit ${pipeline.name}'s stages`}>
                          Edit stages
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => openPipeline(pipeline)} aria-label={`Edit ${pipeline.name}`}>
                          Edit
                        </Button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>

      <TableCard
        title="Disposition → stage"
        toolbar={
          <DataToolbar
            actions={
              <>
                <Button type="button" variant="outline" onClick={() => setLibraryOpen(true)}>
                  <BookOpen aria-hidden="true" />
                  Disposition library
                </Button>
                <RefreshButton onClick={() => void refresh()} refreshing={refreshing} />
              </>
            }
          >
            <ToolbarSearch value={mappingQuery} onChange={setMappingQuery} placeholder="Search dispositions" />
            <select aria-label="Filter dispositions" className={toolbarControl} value={mappingFilter} onChange={(event) => setMappingFilter(event.target.value as MappingFilter)}>
              <option value="all">All dispositions</option>
              <option value="unmapped">Unmapped only ({unmappedCount})</option>
            </select>
          </DataToolbar>
        }
        footer={
          <form onSubmit={addFreeKey} className="flex w-full flex-wrap items-center gap-2">
            <label htmlFor="mapping-key" className="sr-only">Another disposition key</label>
            <input id="mapping-key" className={cn(toolbarControl, "w-48")} maxLength={80} pattern="[a-z][a-z0-9_]{1,79}" placeholder="another_disposition_key" value={freeKey.disposition_key} onChange={(event) => setFreeKey({ ...freeKey, disposition_key: event.target.value })} required />
            <label htmlFor="mapping-stage" className="sr-only">Stage</label>
            <select id="mapping-stage" className={cn(toolbarControl, "min-w-0 max-w-[280px]")} value={freeKey.stage_id} onChange={(event) => setFreeKey({ ...freeKey, stage_id: event.target.value })} required>
              <option value="">Choose a stage</option>
              {allStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.pipelineName} · {stageLabel(stage)}</option>)}
            </select>
            <Button type="submit" variant="outline">Map key</Button>
          </form>
        }
      >
        {mappingError && <p role="alert" className="m-0 border-b border-[var(--border)] bg-[var(--error-surface)] px-4 py-2.5 text-[14px] text-[var(--error-ink)]">{mappingError}</p>}
        {rows.length === 0 ? (
          <EmptyState title="No dispositions yet" hint="Add them under Dispositions, or map a key below." />
        ) : shownRows.length === 0 ? (
          <NoMatches noun="dispositions" onClear={() => { setMappingQuery(""); setMappingFilter("all"); }} />
        ) : (
          <table className={st.table}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={st.th}>Disposition</th>
                <th scope="col" className={cn(st.th, "w-[280px]")}>Moves to a stage in any pipeline</th>
              </tr>
            </thead>
            <tbody>
              {shownRows.map(({ key, entry }) => {
                const value = draft[key] ?? "";
                const id = `mapping-${key}`;
                return (
                  <tr key={key}>
                    <td className={st.td}>
                      <label htmlFor={id} className="text-[var(--body)]">{entry?.label ?? key}</label>
                      {(draft[key] ?? "") !== (savedMap[key] ?? "") && <Pill tone="warning" className="ml-2">Unsaved</Pill>}
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
      </TableCard>

      <SettingsSaveBar visible={dirty} note={`${changedKeys.length} unsaved ${changedKeys.length === 1 ? "mapping" : "mappings"}`}>
        <Button type="button" variant="outline" onClick={discardMappings} disabled={saving}>Discard</Button>
        <Button type="button" onClick={() => void saveMappings()} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
      </SettingsSaveBar>

      {managing && (
        <PipelineStageManager
          open
          onOpenChange={(open) => { if (!open) setManagingId(null); }}
          pipelineId={managing.id}
          pipelineName={managing.name}
          stages={managing.stages}
          leadCounts={counts.stages}
          stageEntries={stageEntries}
          context={context}
          allStages={stageList}
          onChanged={() => void load()}
        />
      )}
      <PipelineCreateDialog open={creating} onOpenChange={setCreating} pipelines={pipelines} context={context} onCreated={() => void load()} />
      <DispositionLibrary open={libraryOpen} onOpenChange={setLibraryOpen} pipelines={pipelines} context={context} onChanged={() => void load()} />

      <Dialog open={editingPipeline !== null} onOpenChange={(next) => !next && setEditingPipeline(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit {editingPipeline?.name}</DialogTitle>
            <DialogDescription>
              {fmt(editingPipeline ? counts.pipelines[editingPipeline.id] : 0)} leads are in this pipeline.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={savePipeline} className="flex flex-col gap-4">
            <Field label="Pipeline name" htmlFor="edit-pipeline-name" required>
              <input id="edit-pipeline-name" className={control} maxLength={120} required value={pipelineForm.name} onChange={(event) => setPipelineForm({ ...pipelineForm, name: event.target.value })} />
            </Field>
            <Field label="Partner type" htmlFor="edit-pipeline-type" hint="A pipeline with leads cannot change partner type.">
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
              help={pipelineForm.partner_type ? "New leads of this partner type start here." : "List imports and vendor posts land in its first open stage."}
              checked={pipelineForm.is_default}
              onChange={(next) => setPipelineForm({ ...pipelineForm, is_default: next })}
            />
            {dialogError && <span role="alert" className="text-[12px] text-[var(--error-ink)]">{dialogError}</span>}
            <DialogFooter className="sm:justify-between">
              <Button type="button" variant="ghost" className="text-[var(--error-ink)]" disabled={busy} onClick={() => void deletePipeline()}>Delete pipeline</Button>
              <span className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditingPipeline(null)}>Cancel</Button>
                <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save pipeline"}</Button>
              </span>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsStack>
  );
}
