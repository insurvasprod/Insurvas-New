"use client";

/**
 * Settings › Sales process › Stage moves (was Application stages, LA-3.23, STATUS-MODEL §6; called "Pipeline
 * sync" until 2026-10-30). Reads and saves GET/PUT /api/app/settings/sales/stage-map; recent moves read
 * …/stage-map/activity; `?preview=sample` reads the sample stages.
 *
 * Which of the agency's own pipeline stages a lead's card moves to when its application reaches each state. An
 * unmapped state moves nothing ("Doesn't move the card"). A card moved by hand stays where it was put, and a card
 * never moves backwards (except to quoting after a decline): the sync's own rules, always on.
 *
 * Settings round 8 (owner pick A, sales-process board "6 · Stage moves", 2026-11-12): the map of application events
 * to stages for one pipeline at a time (a switch picks it), with the recent moves beside it instead of a Map /
 * Activity tab pair. An event opens in a right sheet with one stage per pipeline; Save there stores it. Fill in
 * (match stage names, copy another pipeline, clear) changes the map and the Save on the title line stores it.
 *
 * A pipeline with nothing saved is pre-filled from its own stage names when it is opened (the §6 seeding rule);
 * nothing that does not match is guessed, and nothing is stored until it is saved.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { notify } from "@/lib/notify";

import { resetConfirmOptions } from "@/components/app/settings/defaults";
import { SettingsSectionHeader, control } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { EmptyState, SectionLoading } from "@/components/ui/page-states";
import { Sheet } from "@/components/ui/sheet";
import { PIPELINE_SYNC_KEYS, SAMPLE_PIPELINES, SAMPLE_STAGES, type PipelineSyncKey } from "@/lib/applications/settingsFixtures";
import { mapChecks, matchByName, matchCount, type MapCheck } from "@/lib/salesSettings/stageMapChecks";
import type { PipelineOption, StageMapView } from "@/lib/salesSettings/stageMap";
import { cn } from "@/lib/utils";

import { Pane, SheetSection, StatusLine, TabBody, TabFrame, ThreeWay } from "../sales-process/parts";
import { SalesPanelTop, useSalesSample } from "./shared";
import { CopyDialog, FillMenu, mappedCount, PIPELINES_HREF, StagePicker, UNMAPPED, type Mapping } from "./pipeline-sync-parts";
import { PipelineSyncActivity } from "./pipeline-sync-activity";

const EMPTY = Object.fromEntries(PIPELINE_SYNC_KEYS.map((k) => [k.key, null])) as Mapping;
/** Before 20261029100000 the agency has one map over every pipeline's stages: drawn as one "pipeline". */
const AGENCY = "__agency";

const RULES = "Forward only: a card never moves back, except to quoting after a decline opens a new attempt. A person's move wins: a card moved by hand stays where it was put. With two attempts open, the card follows the one further on. One direction: moving a card never changes an application.";

const sampleStages = (prefix: string) => SAMPLE_STAGES.map((name, i) => ({ id: `${prefix}-${i}`, name, stageType: (name === "Issued" ? "won" : name === "Lost" ? "lost" : "open") as "won" | "lost" | "open" }));
const SAMPLE: StageMapView = {
  pipelines: SAMPLE_PIPELINES.map((p, i) => ({ id: p.id, name: p.name, isDefault: i === 0, stages: sampleStages(p.id) })),
  map: EMPTY, maps: Object.fromEntries(SAMPLE_PIPELINES.map((p) => [p.id, EMPTY])), perPipeline: true, stored: 0, canEdit: true,
};

const same = (a: Mapping, b: Mapping) => PIPELINE_SYNC_KEYS.every((k) => (a[k.key] ?? null) === (b[k.key] ?? null));

export function SalesPipelineSync() {
  /** The application event open in the sheet, with each pipeline's map as it opened. */
  const [editing, setEditing] = useState<{ key: PipelineSyncKey; before: Record<string, Mapping> } | null>(null);
  const sample = useSalesSample();
  const [view, setView] = useState<StageMapView | null>(sample ? SAMPLE : null);
  const [loading, setLoading] = useState(!sample);
  const [error, setError] = useState<{ text: string; pending: boolean } | null>(null);
  // Drafts per pipeline: several can change before one Save. A pipeline with no draft shows what is saved.
  const [drafts, setDrafts] = useState<Record<string, Mapping>>({});
  // Pipelines whose draft is only the stage-name pre-fill (the save bar says so).
  const [prefilled, setPrefilled] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [focus, setFocus] = useState<PipelineSyncKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Before the per-pipeline migration: one map, over every pipeline's stages.
  const pipelines: PipelineOption[] = useMemo(() => {
    if (!view) return [];
    if (view.perPipeline) return view.pipelines;
    return [{ id: AGENCY, name: "All pipelines", isDefault: true, stages: view.pipelines.flatMap((p) => p.stages.map((s) => ({ ...s, name: `${p.name} · ${s.name}` }))) }];
  }, [view]);
  const savedFor = useCallback((id: string): Mapping => ({ ...EMPTY, ...(view ? (id === AGENCY ? view.map : view.maps[id] ?? {}) : {}) }), [view]);
  const draftFor = useCallback((id: string): Mapping => drafts[id] ?? savedFor(id), [drafts, savedFor]);

  /** Open a pipeline; one with nothing saved starts from its own stage names (§6), unsaved. */
  const open = useCallback((id: string, v: StageMapView | null = view, list: PipelineOption[] = pipelines) => {
    setSelected(id);
    setSaveError(null);
    const p = list.find((x) => x.id === id);
    if (!v?.canEdit || !p || id === AGENCY) return;
    const stored = { ...EMPTY, ...(v.maps[id] ?? {}) };
    if (mappedCount(stored) > 0 || matchCount(p) === 0) return;
    setDrafts((d) => (d[id] ? d : { ...d, [id]: matchByName(p) }));
    setPrefilled((s) => new Set(s).add(id));
  }, [view, pipelines]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/app/settings/sales/stage-map", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) setError({ text: data?.error ?? "Application stages could not be loaded.", pending: Boolean(data?.schemaPending) });
      else {
        const next = data as StageMapView;
        setView(next);
        setError(null);
        const list = next.perPipeline ? next.pipelines : [{ id: AGENCY, name: "All pipelines", isDefault: true, stages: [] }];
        const first = (list.find((p) => p.isDefault) ?? list[0])?.id ?? null;
        if (first) open(first, next, list as PipelineOption[]);
      }
    } catch {
      setError({ text: "Couldn't reach Insurvas. Check your connection and try again.", pending: false });
    } finally {
      setLoading(false);
    }
  }, [open]);

  useEffect(() => {
    if (sample) {
      const t = window.setTimeout(() => open(SAMPLE.pipelines[0].id, SAMPLE, SAMPLE.pipelines), 0);
      return () => window.clearTimeout(t);
    }
    const t = window.setTimeout(load, 0);
    return () => window.clearTimeout(t);
    // Once, on mount: `open` and `load` change with every draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample]);

  // "Map Quoted" from Activity: bring the row into view and light it briefly.
  useEffect(() => {
    if (!focus) return;
    document.getElementById(`ps-row-${focus}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = window.setTimeout(() => setFocus(null), 1600);
    return () => window.clearTimeout(t);
  }, [focus]);

  const checksFor = useCallback((p: PipelineOption): MapCheck[] => (p.id === AGENCY ? [] : mapChecks(p, draftFor(p.id))), [draftFor]);
  const dirtyIds = pipelines.filter((p) => drafts[p.id] && !same(drafts[p.id], savedFor(p.id))).map((p) => p.id);
  const dirty = dirtyIds.length > 0;
  const ro = !view?.canEdit;


  function setDraft(id: string, next: Mapping) {
    setDrafts((d) => ({ ...d, [id]: next }));
    setPrefilled((s) => { if (!s.has(id)) return s; const n = new Set(s); n.delete(id); return n; });
    setSaveError(null);
  }
  function discard() {
    setDrafts({});
    setPrefilled(new Set());
    setSaveError(null);
  }

  async function save() {
    if (!view || !dirty) return;
    const names = dirtyIds.map((id) => pipelines.find((p) => p.id === id)?.name ?? "");
    if (sample) {
      setView({ ...view, maps: { ...view.maps, ...Object.fromEntries(dirtyIds.map((id) => [id, drafts[id]])) }, stored: 1 });
      discard();
      notify.done("Sample data — not saved");
      return;
    }
    setSaving(true);
    setSaveError(null);
    let latest = view;
    const done: string[] = [];
    try {
      // One pipeline per request (the route's contract); stop at the first refusal and keep the rest.
      for (const id of dirtyIds) {
        const body = id === AGENCY ? { map: drafts[id] } : { pipeline_id: id, map: drafts[id] };
        const res = await fetch("/api/app/settings/sales/stage-map", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(`${pipelines.find((p) => p.id === id)?.name ?? "Pipeline"}: ${data?.error ?? "That didn't save. Try again."}`);
        latest = data as StageMapView;
        done.push(id);
      }
      // A saved map moves cards from the next application change on; the toast says how to catch up the rest.
      notify.done(done.length > 1 ? `Application stages saved · ${names.join(", ")}` : "Application stages saved", {
        detail: "Cards follow from each application's next change. Cards already waiting can move from Activity.",
      });
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "That didn't save. Try again.");
    } finally {
      setView(latest);
      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([id]) => !done.includes(id))));
      setPrefilled((s) => new Set([...s].filter((id) => !done.includes(id))));
      setSaving(false);
    }
  }

  async function clearPipeline(p: PipelineOption) {
    // With nothing saved, the sync follows the Insurvas default: each state goes to the stage with its
    // name (lib/applications/stageSyncService.ts). So clearing the map is the way back to it.
    const ok = await confirmAction(resetConfirmOptions(
      `${p.name}'s application stages`,
      "Once you save, each state moves the card to the stage with its name (Quoted, Submitted, Issued…), when the board has one. Cards stay where they are now.",
    ));
    if (ok) setDraft(p.id, { ...EMPTY });
  }

  const pick = (id: string) => open(id);

  const pipeline = pipelines.find((p) => p.id === selected) ?? null;
  const checks = pipeline ? checksFor(pipeline) : [];
  const map = pipeline ? draftFor(pipeline.id) : null;
  const byName = pipeline && pipeline.id !== AGENCY ? matchByName(pipeline) : null;
  const matches = byName && map ? PIPELINE_SYNC_KEYS.filter((k) => byName[k.key] && byName[k.key] !== map[k.key]).length : 0;
  const dirtyNames = dirtyIds.map((id) => pipelines.find((p) => p.id === id)?.name).filter(Boolean).join(", ");
  const prefillOnly = dirty && dirtyIds.every((id) => prefilled.has(id));
  const allChecks = pipelines.reduce((n, p) => n + checksFor(p).length, 0);
  const mappedMost = pipelines.length ? Math.max(...pipelines.map((p) => mappedCount(savedFor(p.id)))) : 0;
  const stageName = (p: PipelineOption, m: Mapping, key: PipelineSyncKey) => {
    const id = m[key];
    if (!id) return null;
    return p.stages.find((s) => s.id === id)?.name ?? "A stage that was archived";
  };

  const openEvent = (key: PipelineSyncKey) => setEditing({ key, before: Object.fromEntries(pipelines.map((p) => [p.id, draftFor(p.id)])) });
  /** Cancel puts every pipeline's map back as it was when the sheet opened. */
  const cancelEvent = () => {
    if (editing) setDrafts((d) => {
      const nextDrafts = { ...d };
      for (const [id, m] of Object.entries(editing.before)) {
        if (same(m, savedFor(id))) delete nextDrafts[id];
        else nextDrafts[id] = m;
      }
      return nextDrafts;
    });
    setEditing(null);
  };
  const event = editing ? PIPELINE_SYNC_KEYS.find((k) => k.key === editing.key) ?? null : null;

  return (
    <TabFrame>
      <SettingsSectionHeader
        actions={
          <>
            <Button asChild variant="outline"><Link href={PIPELINES_HREF}>Open Pipelines &amp; outcomes</Link></Button>
            {view?.canEdit && dirty && <Button type="button" variant="ghost" disabled={saving} onClick={discard}>Discard</Button>}
            {view?.canEdit && dirty && <Button type="button" disabled={saving} onClick={() => { void save(); }}>{saving ? "Saving…" : dirtyIds.length > 1 ? `Save ${dirtyIds.length} pipelines` : "Save"}</Button>}
          </>
        }
      />
      <SalesPanelTop sample={sample} />
      {loading ? <StatusLine tone="muted">Reading your stage moves</StatusLine> : error ? (
        error.pending
          ? <StatusLine tone="warn">Stage moves need a database update. Ask your Insurvas admin to apply the latest migrations.</StatusLine>
          : <StatusLine tone="bad" action={<Button type="button" variant="outline" size="sm" onClick={load}>Try again</Button>}>{error.text}</StatusLine>
      ) : saveError ? (
        <StatusLine tone="bad">Couldn&apos;t save: {saveError} Your changes are still here.</StatusLine>
      ) : dirty ? (
        <StatusLine tone="warn">{prefillOnly ? `Filled in from the stage names of ${dirtyNames} — nothing moves until you save` : `Unsaved changes · ${dirtyNames}`}</StatusLine>
      ) : view && (
        <StatusLine tone={allChecks ? "warn" : "ok"}>
          {mappedMost} of {PIPELINE_SYNC_KEYS.length} events mapped in {pipelines.length} {pipelines.length === 1 ? "pipeline" : "pipelines"}{allChecks ? ` · ${allChecks} to check` : ""}{ro ? " · read only: only an owner changes stage moves" : ""}
        </StatusLine>
      )}

      {view && pipelines.length === 0 ? (
        <EmptyState title="No pipelines yet" hint="Add a pipeline and its stages in Pipelines & outcomes, then choose here where its cards go." action={<Button asChild variant="outline"><Link href={PIPELINES_HREF}>Open Pipelines &amp; outcomes</Link></Button>} />
      ) : (
        <TabBody>
          <Pane
            className="lg:flex-1"
            title="When the application…"
            actions={pipeline && map ? (
              <>
                {pipelines.length > 1 && pipelines.length <= 3 ? (
                  <ThreeWay label="Pipeline" value={pipeline.id} onChange={pick} options={pipelines.map((p) => ({ key: p.id, label: p.name }))} />
                ) : pipelines.length > 3 ? (
                  <select aria-label="Pipeline" className={cn(control, "mt-0 w-auto")} value={pipeline.id} onChange={(e) => pick(e.target.value)}>
                    {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                ) : null}
                {!ro && pipeline.stages.length > 0 && (
                  <FillMenu
                    matches={matches}
                    canCopy={pipelines.some((p) => p.id !== pipeline.id && mappedCount(draftFor(p.id)) > 0) && pipeline.id !== AGENCY}
                    canClear={mappedCount(map) > 0}
                    canReset={dirtyIds.includes(pipeline.id)}
                    onMatch={() => setDraft(pipeline.id, { ...map, ...Object.fromEntries(Object.entries(matchByName(pipeline)).filter(([, v]) => v)) })}
                    onCopy={() => setCopyOpen(true)}
                    onClear={() => void clearPipeline(pipeline)}
                    onReset={() => {
                      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([id]) => id !== pipeline.id)));
                      setPrefilled((s) => new Set([...s].filter((id) => id !== pipeline.id)));
                      notify.done(`${pipeline.name} is back as saved`);
                    }}
                  />
                )}
              </>
            ) : undefined}
          >
            {loading || !view ? <SectionLoading rows={7} columns={3} label="Loading stage moves" /> : !pipeline || !map ? null : pipeline.stages.length === 0 ? (
              <EmptyState title={`${pipeline.name} has no stages to move to`} hint="Add its stages first, then choose here where its cards go." action={<Button asChild variant="outline"><Link href={PIPELINES_HREF}>Open Pipelines &amp; outcomes</Link></Button>} />
            ) : (
              <ul className="m-seq m-0 list-none p-0" aria-label={`Where the cards of ${pipeline.name} go`}>
                {PIPELINE_SYNC_KEYS.map((k) => {
                  const warning = checks.find((c) => c.key === k.key)?.text;
                  const to = stageName(pipeline, map, k.key);
                  return (
                    <li key={k.key} id={`ps-row-${k.key}`} className={cn("border-b border-[var(--border)] last:border-b-0", focus === k.key && "bg-[var(--primary-soft)]")}>
                      <button type="button" onClick={() => openEvent(k.key)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--surface-alt)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring-color)]">
                        <span aria-hidden="true" className="inline-grid size-7 shrink-0 place-items-center rounded-[8px] bg-[var(--primary-soft)] text-xs font-semibold text-[var(--accent-ink)]">{k.label.charAt(0)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-[var(--ink)]">{k.label}</span>
                          <span className="block truncate text-xs text-[var(--muted)]">{k.when}{k.key === "requoting" ? " · the one move back" : ""}</span>
                        </span>
                        <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-[var(--muted)]" />
                        <span className="min-w-0 flex-1">
                          <span className={cn("block truncate text-sm font-semibold", to ? "text-[var(--ink)]" : "text-[var(--muted)]")}>{to ?? UNMAPPED}</span>
                          <span className={cn("block truncate text-xs", warning ? "text-[var(--warning-ink)]" : "text-[var(--muted)]")}>{warning ? <><AlertTriangle aria-hidden="true" className="mr-1 inline size-3" />{warning}</> : pipeline.name}</span>
                        </span>
                        <span className="shrink-0 text-xs text-[var(--muted)]">{ro ? "View" : "Edit"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Pane>

          <Pane className="lg:w-[360px] lg:shrink-0" title="Recent moves" sub={pipeline?.name}>
            {pipeline && pipeline.id !== AGENCY && !ro ? (
              <div className="p-3"><PipelineSyncActivity key={pipeline.id} pipelineId={pipeline.id} pipelineName={pipeline.name} sample={sample} dirty={dirtyIds.includes(pipeline.id)} onMapState={(key) => { setFocus(key); openEvent(key); }} /></div>
            ) : <p className="m-0 px-4 py-6 text-sm text-[var(--muted)]">{ro ? "Only an owner sees the moves." : "Moves show per pipeline once each pipeline has its own map."}</p>}
          </Pane>
        </TabBody>
      )}

      {copyOpen && pipeline && (
        <CopyDialog
          open={copyOpen}
          onOpenChange={setCopyOpen}
          target={pipeline}
          current={draftFor(pipeline.id)}
          sources={pipelines.filter((p) => p.id !== pipeline.id && mappedCount(draftFor(p.id)) > 0).map((p) => ({ pipeline: p, map: draftFor(p.id) }))}
          onCopy={(next) => setDraft(pipeline.id, next)}
        />
      )}

      {editing && event && (
        <Sheet
          title={`When the application ${event.when.charAt(0).toLowerCase()}${event.when.slice(1)}`}
          subtitle={event.label}
          onClose={cancelEvent}
          footer={ro ? <Button type="button" variant="outline" className="ml-auto" onClick={() => setEditing(null)}>Close</Button> : (
            <span className="ml-auto flex gap-2">
              <Button type="button" variant="outline" onClick={cancelEvent}>Cancel</Button>
              <Button type="button" disabled={saving} onClick={() => { void save().then(() => setEditing(null)); }}>{saving ? "Saving…" : dirty ? "Save" : "Done"}</Button>
            </span>
          )}
        >
          <SheetSection title="Move the lead card to" sub="One stage per pipeline. Leave it on “Doesn't move the card” to leave the card where it is.">
            {pipelines.map((p) => (
              <div key={p.id} className="flex flex-col gap-1.5">
                <label htmlFor={`ps-${p.id}-${event.key}`} className="text-label text-[var(--body)]">{p.name}</label>
                {p.stages.length === 0 ? <span className="text-sm text-[var(--muted)]">No stages yet.</span> : (
                  <StagePicker id={`ps-${p.id}-${event.key}`} stateKey={event.key} pipeline={p} map={draftFor(p.id)} disabled={ro} onChange={(stageId) => setDraft(p.id, { ...draftFor(p.id), [event.key]: stageId })} />
                )}
              </div>
            ))}
          </SheetSection>
          <SheetSection title="If the card is already further along" sub={RULES}>
            <p className="m-0 text-sm text-[var(--body)]">Never moves a card backwards · always on</p>
          </SheetSection>
        </Sheet>
      )}

      {view && <LeaveGuard dirty={view.canEdit && dirty} onDiscard={discard} what="the stage moves" />}
    </TabFrame>
  );
}
