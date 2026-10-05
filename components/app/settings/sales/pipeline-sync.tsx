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
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { notify } from "@/lib/notify";

import { Callout, SettingsStack, control, st } from "@/components/app/settings/primitives";
import { EmptyState } from "@/components/ui/page-states";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { TableCard } from "@/components/ui/table-card";
import { PIPELINE_SYNC_KEYS, SAMPLE_STAGES, type PipelineSyncKey } from "@/lib/applications/settingsFixtures";
import type { PipelineOption, StageMapView } from "@/lib/salesSettings/stageMap";
import { cn } from "@/lib/utils";

import { CardFact, DiscardSave, ReadOnlyNotice, SalesLoadError, SalesLoading, SalesPanelTop, SalesSetupPending, useSalesSample } from "./shared";

type Mapping = Record<PipelineSyncKey, string | null>;
const UNMAPPED = "Doesn't move the card";
const EMPTY = Object.fromEntries(PIPELINE_SYNC_KEYS.map((k) => [k.key, null])) as Mapping;

const SAMPLE: StageMapView = {
  pipelines: [{ id: "pl-sample", name: "Outbound", isDefault: true, stages: SAMPLE_STAGES.map((name, i) => ({ id: `st-${i}`, name, stageType: name === "Issued" ? "won" : name === "Lost" ? "lost" : "open" })) }],
  map: EMPTY, stored: 0, canEdit: true,
};

/** §6's seeding rule: the default stage names, matched case-insensitively on the default pipeline. */
function suggested(pipelines: PipelineOption[]): Mapping {
  const pipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];
  const out = { ...EMPTY };
  if (!pipeline) return out;
  for (const k of PIPELINE_SYNC_KEYS) out[k.key] = pipeline.stages.find((s) => s.name.trim().toLowerCase() === k.defaultStage.toLowerCase())?.id ?? null;
  return out;
}

export function SalesPipelineSync() {
  const sample = useSalesSample();
  const [view, setView] = useState<StageMapView | null>(sample ? SAMPLE : null);
  const [draft, setDraft] = useState<Mapping | null>(sample ? suggested(SAMPLE.pipelines) : null);
  const [loading, setLoading] = useState(!sample);
  const [error, setError] = useState<{ text: string; pending: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const accept = useCallback((next: StageMapView) => {
    setView(next);
    setDraft(next.stored === 0 && next.canEdit ? suggested(next.pipelines) : { ...EMPTY, ...next.map });
  }, []);

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

  const saved = useMemo(() => ({ ...EMPTY, ...(view?.map ?? {}) }), [view]);
  const dirty = Boolean(draft && JSON.stringify(draft) !== JSON.stringify(saved));
  const suggestedOnly = Boolean(view && view.stored === 0 && dirty);
  const stageName = (id: string | null) => (id ? view?.pipelines.flatMap((p) => p.stages.map((s) => ({ ...s, pipeline: p.name }))).find((s) => s.id === id) : null);

  async function save() {
    if (!draft) return;
    if (sample) {
      setView((v) => (v ? { ...v, map: draft, stored: 1 } : v));
      notify.done("Sample data — not saved");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/app/settings/sales/stage-map", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ map: draft }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "That didn't save. Try again.");
      accept(data as StageMapView);
      notify.done("Pipeline sync saved");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "That didn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const noStages = view ? view.pipelines.every((p) => p.stages.length === 0) : false;
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
            description="When the application reaches a state, the lead's card moves to this stage once. A card moved by hand stays where it was put."
            action={<CardFact>{view.stored === 0 ? "Nothing is mapped yet — no card moves" : `${mappedCount} of ${PIPELINE_SYNC_KEYS.length} states move a card`}</CardFact>}
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
                            {view.pipelines.filter((p) => p.stages.length).map((p) => (
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

          <SettingsSaveBar visible={view.canEdit && dirty} note={suggestedOnly ? "Filled in from your stage names — nothing moves until you save." : "Unsaved changes to pipeline sync"}>
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
