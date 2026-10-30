"use client";

/**
 * Settings › Sales › Pipeline sync (LA-3.23, STATUS-MODEL §6). Reads and saves
 * GET/PUT /api/app/settings/sales/stage-map; `?preview=sample` reads the sample stages.
 *
 * Which of the agency's own pipeline stages a lead's card moves to when its application reaches
 * each state. An unmapped state moves nothing ("Doesn't move the card"). A card moved by hand stays
 * where it was put — the sync never overrides a person.
 *
 * Before anything is saved, the draft is pre-filled by matching stage names on the default pipeline
 * (case-insensitive, the §6 seeding rule); nothing that does not match is guessed, and nothing is
 * stored until Save.
 *
 * Per pipeline (owner 2026-10-29, 20261029100000): pick a pipeline, map its own stages; a lead's card
 * moves only within the pipeline it is on. A pipeline with nothing saved yet is pre-filled the same
 * way from its own stage names. Before that migration there is one map, as before.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { notify } from "@/lib/notify";

import { Callout, SettingsStack, control, st } from "@/components/app/settings/primitives";
import { EmptyState } from "@/components/ui/page-states";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { TableCard } from "@/components/ui/table-card";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { PIPELINE_SYNC_KEYS, SAMPLE_STAGES, type PipelineSyncKey } from "@/lib/applications/settingsFixtures";
import type { PipelineOption, StageMapView } from "@/lib/salesSettings/stageMap";
import { cn } from "@/lib/utils";

import { CardFact, DiscardSave, ReadOnlyNotice, SalesLoadError, SalesLoading, SalesPanelTop, SalesSetupPending, useSalesSample } from "./shared";
import { LeaveGuard } from "@/components/ui/leave-guard";

type Mapping = Record<PipelineSyncKey, string | null>;
const UNMAPPED = "Doesn't move the card";
const EMPTY = Object.fromEntries(PIPELINE_SYNC_KEYS.map((k) => [k.key, null])) as Mapping;

const SAMPLE: StageMapView = {
  pipelines: [{ id: "pl-sample", name: "Outbound", isDefault: true, stages: SAMPLE_STAGES.map((name, i) => ({ id: `st-${i}`, name, stageType: name === "Issued" ? "won" : name === "Lost" ? "lost" : "open" })) }],
  map: EMPTY, maps: { "pl-sample": EMPTY }, perPipeline: true, stored: 0, canEdit: true,
};

/** §6's seeding rule: the default stage names, matched case-insensitively (on the chosen pipeline, else the default one). */
function suggested(pipelines: PipelineOption[], pipelineId?: string | null): Mapping {
  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? pipelines.find((p) => p.isDefault) ?? pipelines[0];
  const out = { ...EMPTY };
  if (!pipeline) return out;
  for (const k of PIPELINE_SYNC_KEYS) out[k.key] = pipeline.stages.find((s) => s.name.trim().toLowerCase() === k.defaultStage.toLowerCase())?.id ?? null;
  return out;
}

export function SalesPipelineSync() {
  const sample = useSalesSample();
  const [view, setView] = useState<StageMapView | null>(sample ? SAMPLE : null);
  const [draft, setDraft] = useState<Mapping | null>(sample ? suggested(SAMPLE.pipelines) : null);
  // The pipeline being mapped (per-pipeline maps); null before the migration (one map).
  const [pipelineId, setPipelineId] = useState<string | null>(sample ? "pl-sample" : null);
  const [loading, setLoading] = useState(!sample);
  const [error, setError] = useState<{ text: string; pending: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /** What is stored for a pipeline (or the one map), and the draft it starts from. */
  const savedFor = useCallback((v: StageMapView, id: string | null): Mapping => ({ ...EMPTY, ...(v.perPipeline && id ? v.maps[id] ?? {} : v.map) }), []);
  const startDraft = useCallback((v: StageMapView, id: string | null): Mapping => {
    const stored = savedFor(v, id);
    const nothing = Object.values(stored).every((x) => !x);
    return nothing && v.canEdit ? suggested(v.pipelines, id) : stored;
  }, [savedFor]);

  const accept = useCallback((next: StageMapView, keep?: string | null) => {
    setView(next);
    const id = next.perPipeline ? (keep && next.pipelines.some((p) => p.id === keep) ? keep : (next.pipelines.find((p) => p.isDefault) ?? next.pipelines[0])?.id ?? null) : null;
    setPipelineId(id);
    setDraft(startDraft(next, id));
  }, [startDraft]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/app/settings/sales/stage-map", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) setError({ text: data?.error ?? "Pipeline sync could not be loaded.", pending: Boolean(data?.schemaPending) });
      else {
        accept(data as StageMapView);
        setError(null);
      }
    } catch {
      setError({ text: "Couldn't reach Insurvas. Check your connection and try again.", pending: false });
    } finally {
      setLoading(false);
    }
  }, [accept]);

  useEffect(() => {
    if (sample) return;
    const t = window.setTimeout(load, 0);
    return () => window.clearTimeout(t);
  }, [load, sample]);

  const saved = useMemo(() => (view ? savedFor(view, pipelineId) : EMPTY), [view, pipelineId, savedFor]);
  const pipeline = view?.pipelines.find((p) => p.id === pipelineId) ?? null;
  const dirty = Boolean(draft && JSON.stringify(draft) !== JSON.stringify(saved));
  const suggestedOnly = Boolean(view && Object.values(saved).every((x) => !x) && dirty);
  const stageName = (id: string | null) => (id ? view?.pipelines.flatMap((p) => p.stages.map((s) => ({ ...s, pipeline: p.name }))).find((s) => s.id === id) : null);

  async function save() {
    if (!draft) return;
    if (sample) {
      setView((v) => (v ? { ...v, map: draft, maps: pipelineId ? { ...v.maps, [pipelineId]: draft } : v.maps, stored: 1 } : v));
      notify.done("Sample data — not saved");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/app/settings/sales/stage-map", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(view?.perPipeline && pipelineId ? { pipeline_id: pipelineId, map: draft } : { map: draft }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "That didn't save. Try again.");
      accept(data as StageMapView, pipelineId);
      notify.done("Pipeline sync saved");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "That didn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const noStages = view ? (view.perPipeline ? !pipeline || pipeline.stages.length === 0 : view.pipelines.every((p) => p.stages.length === 0)) : false;
  // The stages a state may move to: the chosen pipeline's own (per pipeline), else every pipeline's.
  const choices = view ? (view.perPipeline ? (pipeline ? [pipeline] : []) : view.pipelines.filter((p) => p.stages.length)) : [];
  const choosePipeline = (id: string) => { if (!view) return; setPipelineId(id); setDraft(startDraft(view, id)); setSaveError(null); };
  const ro = !view?.canEdit;
  const mappedCount = Object.values(saved).filter(Boolean).length;

  return (
    <SettingsStack>
      <SalesPanelTop sample={sample} />
      {loading ? <SalesLoading label="Loading pipeline sync" rows={7} columns={2} /> : error ? (
        error.pending
          ? <SalesSetupPending what="Pipeline sync" />
          : <SalesLoadError message={error.text} onRetry={load} />
      ) : view && draft && (
        <>
          {saveError && <Callout tone="error" title={saveError} />}
          {ro && <ReadOnlyNotice what="pipeline sync" />}

          <TableCard
            title="Where the card goes"
            info={view.perPipeline ? "Each pipeline has its own map: when the application reaches a state, the lead's card moves to this stage of the pipeline it is on, once. A card moved by hand stays where it was put." : "When the application reaches a state, the lead's card moves to this stage once. A card moved by hand stays where it was put."}
            action={<span className="flex flex-wrap items-center gap-2">
              {view.perPipeline && view.pipelines.length > 0 && (
                <select
                  aria-label="Pipeline"
                  className={cn(toolbarControl, "w-auto min-w-[200px]")}
                  value={pipelineId ?? ""}
                  disabled={dirty}
                  title={dirty ? "Save or discard this pipeline's changes first" : undefined}
                  onChange={(e) => choosePipeline(e.target.value)}
                >
                  {view.pipelines.map((p) => {
                    const count = Object.values(view.maps[p.id] ?? {}).filter(Boolean).length;
                    return <option key={p.id} value={p.id}>{p.name} · {count ? `${count} mapped` : "not mapped"}</option>;
                  })}
                </select>
              )}
              <CardFact>{mappedCount === 0 ? "Nothing is mapped yet — no card moves" : `${mappedCount} of ${PIPELINE_SYNC_KEYS.length} states move a card`}</CardFact>
            </span>}
          >
            {noStages ? (
              <EmptyState title="No pipeline stages yet" hint="Add stages to a pipeline in Settings › Pipelines, then map them here." />
            ) : (
              <table className={cn(st.table, "min-w-[640px]")}>
                <thead>
                  <tr className={st.headRow}>
                    <th scope="col" className={st.th}>When the application</th>
                    <th scope="col" className={cn(st.th, "w-[300px]")}>Move the card to</th>
                  </tr>
                </thead>
                <tbody className="m-seq">
                  {PIPELINE_SYNC_KEYS.map((k) => {
                    const value = draft[k.key];
                    const missing = value && !stageName(value);
                    return (
                      <tr key={k.key} className="m-row">
                        <td className={st.td}>
                          <label htmlFor={`ps-${k.key}`} className={cn(st.strong, "block")}>{k.label}</label>
                          <span className={st.sub}>{k.when}</span>
                        </td>
                        <td className={st.td}>
                          <select
                            id={`ps-${k.key}`}
                            className={cn(control, "mt-0", !value && "text-[var(--muted)]")}
                            value={value ?? ""}
                            disabled={ro}
                            onChange={(e) => setDraft((m) => (m ? { ...m, [k.key]: e.target.value || null } : m))}
                          >
                            <option value="">{UNMAPPED}</option>
                            {missing && <option value={value ?? ""}>A stage that was archived</option>}
                            {choices.map((p) => (
                              <optgroup key={p.id} label={`${p.name} pipeline`}>
                                {p.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                              </optgroup>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </TableCard>

          <LeaveGuard dirty={view.canEdit && dirty} onDiscard={() => { setDraft(saved); setSaveError(null); }} what="the pipeline sync" />
          <SettingsSaveBar visible={view.canEdit && dirty} note={suggestedOnly ? `Filled in from ${pipeline ? `${pipeline.name}'s` : "your"} stage names — nothing moves until you save.` : `Unsaved changes to pipeline sync${pipeline ? ` · ${pipeline.name}` : ""}`}>
            <DiscardSave
              saving={saving}
              problem={noStages ? "Add pipeline stages first." : null}
              onDiscard={() => { setDraft(saved); setSaveError(null); }}
              onSave={() => { void save(); }}
            />
          </SettingsSaveBar>
        </>
      )}
    </SettingsStack>
  );
}
