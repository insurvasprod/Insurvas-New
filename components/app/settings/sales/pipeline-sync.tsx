"use client";

/**
 * Settings › Sales › Application stages (LA-3.23, STATUS-MODEL §6; called "Pipeline sync" until 2026-10-30 —
 * the id stays sales-pipeline-sync so links, search and the settings history keep working). Reads and saves
 * GET/PUT /api/app/settings/sales/stage-map; Activity reads …/stage-map/activity; `?preview=sample`
 * reads the sample stages.
 *
 * Which of the agency's own pipeline stages a lead's card moves to when its application reaches
 * each state. An unmapped state moves nothing ("Doesn't move the card"). A card moved by hand stays
 * where it was put — the sync never overrides a person.
 *
 * Per pipeline (owner 2026-10-29, 20261029100000): each pipeline maps its own stages; a lead's card
 * moves only within the pipeline it is on. Before that migration there is one map, as before.
 *
 * Redesign 2026-10-30 (ui-taste round, canvas page settings-pipeline-sync, direction A): the pipelines
 * are the page's spine, each with how many states move a card and what to check; the map shows the
 * board it moves cards on; several pipelines can change before one Save; Fill in matches stage names,
 * copies another pipeline's map or clears; Activity shows the sync's moves and checks open cases. On a
 * phone the list comes first, then the map.
 *
 * A pipeline with nothing saved is pre-filled from its own stage names when it is opened (the §6
 * seeding rule, case-insensitive); nothing that does not match is guessed, and nothing is stored until
 * Save.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, ChevronLeft, Hand, Layers, Lock } from "lucide-react";
import { notify } from "@/lib/notify";

import { Callout, SettingsStack } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { titleCaseNode } from "@/components/ui/title-case";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { LeaveGuard } from "@/components/ui/leave-guard";
import { EmptyState } from "@/components/ui/page-states";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { ViewTabs } from "@/components/ui/view-tabs";
import { PIPELINE_SYNC_KEYS, SAMPLE_PIPELINES, SAMPLE_STAGES, type PipelineSyncKey } from "@/lib/applications/settingsFixtures";
import { mapChecks, matchByName, matchCount, type MapCheck } from "@/lib/salesSettings/stageMapChecks";
import type { PipelineOption, StageMapView } from "@/lib/salesSettings/stageMap";
import { cn } from "@/lib/utils";

import { CardFact, DiscardSave, ReadOnlyNotice, SalesLoadError, SalesLoading, SalesPanelTop, SalesSetupPending, useSalesSample } from "./shared";
import { BoardPreview, CopyDialog, FillMenu, mappedCount, PIPELINES_HREF, PipelineList, StagePicker, type Mapping, type PipelineRow } from "./pipeline-sync-parts";
import { PipelineSyncActivity } from "./pipeline-sync-activity";

const EMPTY = Object.fromEntries(PIPELINE_SYNC_KEYS.map((k) => [k.key, null])) as Mapping;
const STATES = PIPELINE_SYNC_KEYS.length;
/** Before 20261029100000 the agency has one map over every pipeline's stages: drawn as one "pipeline". */
const AGENCY = "__agency";

const RULES = "Forward only: a card never moves back, except to quoting after a decline opens a new attempt. A person's move wins: a card moved by hand stays where it was put. With two attempts open, the card follows the one further on. One direction: moving a card never changes an application.";

const sampleStages = (prefix: string) => SAMPLE_STAGES.map((name, i) => ({ id: `${prefix}-${i}`, name, stageType: (name === "Issued" ? "won" : name === "Lost" ? "lost" : "open") as "won" | "lost" | "open" }));
const SAMPLE: StageMapView = {
  pipelines: SAMPLE_PIPELINES.map((p, i) => ({ id: p.id, name: p.name, isDefault: i === 0, stages: sampleStages(p.id) })),
  map: EMPTY, maps: Object.fromEntries(SAMPLE_PIPELINES.map((p) => [p.id, EMPTY])), perPipeline: true, stored: 0, canEdit: true,
};

const same = (a: Mapping, b: Mapping) => PIPELINE_SYNC_KEYS.every((k) => (a[k.key] ?? null) === (b[k.key] ?? null));
type Tab = "map" | "activity";

export function SalesPipelineSync() {
  const sample = useSalesSample();
  const [view, setView] = useState<StageMapView | null>(sample ? SAMPLE : null);
  const [loading, setLoading] = useState(!sample);
  const [error, setError] = useState<{ text: string; pending: boolean } | null>(null);
  // Drafts per pipeline: several can change before one Save. A pipeline with no draft shows what is saved.
  const [drafts, setDrafts] = useState<Record<string, Mapping>>({});
  // Pipelines whose draft is only the stage-name pre-fill (the save bar says so).
  const [prefilled, setPrefilled] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("map");
  // Phone: the list first, then the map of the pipeline picked.
  const [phoneMap, setPhoneMap] = useState(false);
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
  const pipeline = pipelines.find((p) => p.id === selected) ?? null;

  const rowsForList: PipelineRow[] = pipelines.map((p) => ({ id: p.id, name: p.name, mapped: mappedCount(draftFor(p.id)), checks: checksFor(p).length, dirty: dirtyIds.includes(p.id), noStages: p.stages.length === 0 }));
  const following = pipelines.filter((p) => mappedCount(savedFor(p.id)) > 0).length;

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
        ...(view.canEdit && selected !== AGENCY ? { action: { label: "Check cards", onClick: () => setTab("activity") } } : {}),
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
    const ok = await confirmAction({
      title: `Clear ${p.name}?`,
      description: "Once you save, its cards stop following their applications. Cards stay where they are now.",
      confirmLabel: "Clear the map",
      cancelLabel: "Keep the map",
    });
    if (ok) setDraft(p.id, { ...EMPTY });
  }

  const pick = (id: string) => {
    open(id);
    setTab((t) => (t === "activity" && (ro || id === AGENCY) ? "map" : t));
    setPhoneMap(true);
  };

  const prefillOnly = dirty && dirtyIds.every((id) => prefilled.has(id));
  const dirtyNames = dirtyIds.map((id) => pipelines.find((p) => p.id === id)?.name).filter(Boolean).join(", ");

  return (
    <SettingsStack>
      <SalesPanelTop sample={sample} />
      {loading ? <SalesLoading label="Loading application stages" rows={7} columns={2} /> : error ? (
        error.pending
          ? <SalesSetupPending what="Application stages" />
          : <SalesLoadError message={error.text} onRetry={load} />
      ) : view && (
        <>
          {saveError && <Callout tone="error" title={saveError} />}
          {ro && <ReadOnlyNotice what="application stages" />}

          {pipelines.length === 0 ? (
            <EmptyState title="No pipelines yet" hint="Add a pipeline and its stages in Pipelines & outcomes, then choose here where its cards go." action={<Button asChild variant="outline"><Link href={PIPELINES_HREF}>Open Pipelines &amp; outcomes</Link></Button>} />
          ) : (
            <div className="grid items-start gap-4 md:grid-cols-[minmax(240px,280px)_minmax(0,1fr)]">
              <TableCard
                title="Pipelines"
                info="Each pipeline has its own map. A lead's card moves only inside the pipeline it is on, so a pipeline that moves nothing keeps its cards where people put them."
                action={<CardFact>{following} of {pipelines.length} follow their applications</CardFact>}
                className={cn(phoneMap && "max-md:hidden")}
              >
                <PipelineList rows={rowsForList} value={selected} onPick={pick} />
              </TableCard>

              {pipeline && (
                <div className={cn("flex min-w-0 flex-col gap-2", !phoneMap && "max-md:hidden")}>
                  <Button type="button" variant="ghost" className="w-fit md:hidden" onClick={() => setPhoneMap(false)}><ChevronLeft aria-hidden="true" />Pipelines</Button>
                  <PipelineCard
                    key={pipeline.id}
                    pipeline={pipeline}
                    map={draftFor(pipeline.id)}
                    saved={savedFor(pipeline.id)}
                    checks={checksFor(pipeline)}
                    ro={ro}
                    legacy={pipeline.id === AGENCY}
                    dirty={dirtyIds.includes(pipeline.id)}
                    tab={ro || pipeline.id === AGENCY ? "map" : tab}
                    onTab={setTab}
                    focus={focus}
                    sample={sample}
                    canCopy={pipelines.some((p) => p.id !== pipeline.id && mappedCount(draftFor(p.id)) > 0)}
                    onChange={(next) => setDraft(pipeline.id, next)}
                    onMatch={() => setDraft(pipeline.id, { ...draftFor(pipeline.id), ...Object.fromEntries(Object.entries(matchByName(pipeline)).filter(([, v]) => v)) })}
                    onCopy={() => setCopyOpen(true)}
                    onClear={() => void clearPipeline(pipeline)}
                    onReset={() => {
                      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([id]) => id !== pipeline.id)));
                      setPrefilled((s) => new Set([...s].filter((id) => id !== pipeline.id)));
                      notify.done(`${pipeline.name} is back as saved`);
                    }}
                    onMapState={(key) => { setTab("map"); setFocus(key); }}
                  />
                  {copyOpen && (
                    <CopyDialog
                      open={copyOpen}
                      onOpenChange={setCopyOpen}
                      target={pipeline}
                      current={draftFor(pipeline.id)}
                      sources={pipelines.filter((p) => p.id !== pipeline.id && mappedCount(draftFor(p.id)) > 0).map((p) => ({ pipeline: p, map: draftFor(p.id) }))}
                      onCopy={(next) => setDraft(pipeline.id, next)}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          <LeaveGuard dirty={view.canEdit && dirty} onDiscard={discard} what="the application stages" />
          <SettingsSaveBar
            visible={view.canEdit && dirty}
            note={prefillOnly ? `Filled in from ${dirtyNames}'s stage names — nothing moves until you save.` : `Unsaved changes · ${dirtyNames}`}
          >
            <DiscardSave saving={saving} onDiscard={discard} onSave={() => { void save(); }} saveLabel={dirtyIds.length > 1 ? `Save ${dirtyIds.length} pipelines` : "Save changes"} />
          </SettingsSaveBar>
        </>
      )}
    </SettingsStack>
  );
}

/* ── one pipeline: its board, its map, its activity ───────────────────── */

function PipelineCard({ pipeline, map, saved, checks, ro, legacy, dirty, tab, onTab, focus, sample, canCopy, onChange, onMatch, onCopy, onClear, onReset, onMapState }: {
  pipeline: PipelineOption;
  map: Mapping;
  saved: Mapping;
  checks: MapCheck[];
  ro: boolean;
  legacy: boolean;
  dirty: boolean;
  tab: Tab;
  onTab: (tab: Tab) => void;
  focus: PipelineSyncKey | null;
  sample: boolean;
  canCopy: boolean;
  onChange: (next: Mapping) => void;
  onMatch: () => void;
  onCopy: () => void;
  onClear: () => void;
  onReset: () => void;
  onMapState: (key: PipelineSyncKey) => void;
}) {
  const count = mappedCount(map);
  const flagged = useMemo(() => new Set(checks.map((c) => c.key)), [checks]);
  const checkFor = (key: PipelineSyncKey) => checks.find((c) => c.key === key)?.text;
  const noStages = pipeline.stages.length === 0;
  const byName = useMemo(() => matchByName(pipeline), [pipeline]);
  // What Match stage names would still change: a state whose same-named stage it is not on yet.
  const matches = legacy ? 0 : PIPELINE_SYNC_KEYS.filter((k) => byName[k.key] && byName[k.key] !== map[k.key]).length;

  // Owner 2026-10-30: the card scrolls inside itself. Its title row (with the tabs and Fill in) and the
  // board stay put; only the states below scroll. On a phone the page scrolls as usual.
  const card = useRef<HTMLElement>(null);
  const height = useFitHeight(card, dirty ? 76 : 0);

  return (
    <section ref={card} aria-label={`${pipeline.name} application stages`} className={cn(cardSurface, "flex min-h-0 flex-col")} style={height ? { height } : undefined}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-[var(--border)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-1">
          <h2 className="text-card-title text-[var(--ink)]">{titleCaseNode(pipeline.name)}</h2>
          <InfoTip label="How cards move">{RULES}</InfoTip>
        </div>
        <ViewTabs<Tab>
          label={`${pipeline.name} application stages`}
          tabs={ro || legacy ? [{ key: "map", label: "Map" }] : [{ key: "map", label: "Map" }, { key: "activity", label: "Activity" }]}
          value={tab}
          onChange={onTab}
        />
        {!ro && tab === "map" && !noStages && <FillMenu matches={matches} canCopy={canCopy && !legacy} canClear={count > 0} canReset={dirty} onMatch={onMatch} onCopy={onCopy} onClear={onClear} onReset={onReset} />}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {dirty && <StatusChip tone="info">Unsaved{mappedCount(saved) !== count ? ` · ${mappedCount(saved)} → ${count}` : ""}</StatusChip>}
          {checks.length > 0 && <StatusChip tone="warning">{checks.length} to check</StatusChip>}
          {count ? <StatusChip tone="good" title={`${count} of ${STATES} application states move a card`}>{count} of {STATES} states</StatusChip> : <StatusChip>Moves nothing</StatusChip>}
        </span>
      </div>

      {tab === "activity" ? (
        <div className="min-h-0 flex-1 overflow-y-auto pt-4"><PipelineSyncActivity pipelineId={pipeline.id} pipelineName={pipeline.name} sample={sample} dirty={dirty} onMapState={onMapState} /></div>
      ) : noStages ? (
        <EmptyState
          title={`${pipeline.name} has no stages to move to`}
          hint="Add its stages first, then choose here where its cards go."
          action={<Button asChild variant="outline"><Link href={PIPELINES_HREF}>Open Pipelines &amp; outcomes</Link></Button>}
        />
      ) : (
        <>
          {/* Frozen: the board, and the line that says nothing follows yet. */}
          <div className="shrink-0 pt-3">
            {!legacy && <BoardPreview pipeline={pipeline} map={map} flagged={flagged} />}
            {count === 0 && !ro && (
              <p className="m-0 px-4 pb-3 text-sm text-[var(--ink)]">Nothing on {pipeline.name} follows its applications yet. Choose a stage for each state below{matches ? ", or use Fill in › Match stage names" : ""}.</p>
            )}
          </div>
          {/* The one scrolling part: the states, under a header that stays at its top. */}
          <div className="min-h-0 flex-1 overflow-y-auto border-t border-[var(--border)]" data-ps-rows="">
            <div className="sticky top-0 z-[1] hidden grid-cols-[minmax(0,1fr)_minmax(260px,340px)] gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-label text-[var(--body)] md:grid">
              <span>When the application…</span>
              <span>the card moves to</span>
            </div>
            <ul className="m-seq m-0 list-none p-0" aria-label={`Where ${pipeline.name}'s cards go`}>
              {PIPELINE_SYNC_KEYS.map((k) => {
                const warning = checkFor(k.key);
                return (
                  <li
                    key={k.key}
                    id={`ps-row-${k.key}`}
                    className={cn("grid gap-2 border-b border-[var(--border)] px-4 py-3 transition-colors duration-500 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(260px,340px)] md:items-center md:gap-4", focus === k.key && "bg-[var(--primary-soft)]")}
                  >
                    <div className="min-w-0">
                      <label htmlFor={`ps-${k.key}`} className="block text-sm font-semibold text-[var(--ink)]">{k.label}</label>
                      <span className="text-xs text-[var(--body)]">{k.when}{k.key === "requoting" ? " · the one move back" : ""}</span>
                    </div>
                    <StagePicker
                      id={`ps-${k.key}`}
                      stateKey={k.key}
                      pipeline={pipeline}
                      map={map}
                      disabled={ro}
                      onChange={(stageId) => onChange({ ...map, [k.key]: stageId })}
                    />
                    {warning && (
                      <p className="m-in m-0 flex items-start gap-1.5 text-xs text-[var(--warning-ink)] md:col-span-2">
                        <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0" />{warning}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="shrink-0 rounded-b-[15px] border-t border-[var(--border)] bg-[color-mix(in_srgb,var(--canvas)_45%,transparent)] px-4 py-2.5"><RulesLine /></div>
        </>
      )}
    </section>
  );
}

/**
 * The card's height so it ends at the bottom of the window (md and up), measured from where it sits in
 * its scrolling column: the column then has nothing to scroll and the card scrolls inside. `reserve`
 * keeps room for the save bar under it. Undefined on a phone, where the page scrolls as usual.
 */
function useFitHeight(ref: React.RefObject<HTMLElement | null>, reserve: number): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const scroller = (() => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const y = getComputedStyle(p).overflowY;
        if ((y === "auto" || y === "scroll") && p.scrollHeight > p.clientHeight - 1) return p;
      }
      return null;
    })();
    const measure = () => {
      if (window.innerWidth < 768) { setHeight(undefined); return; }
      const rect = el.getBoundingClientRect();
      const box = scroller ? scroller.getBoundingClientRect() : { top: 0, height: window.innerHeight };
      const offset = rect.top - box.top + (scroller?.scrollTop ?? window.scrollY);
      const visible = scroller ? scroller.clientHeight : window.innerHeight;
      setHeight(Math.max(420, Math.floor(visible - offset - 24 - reserve)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [ref, reserve]);
  return height;
}

/** Mockup A's line under the map: how the sync behaves, one short fact each, where the choices are made. */
function RulesLine() {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-1.5 p-0 text-xs text-[var(--ink)]" aria-label="How cards move">
      <li className="flex items-center gap-1.5"><ArrowRight aria-hidden="true" className="size-3.5 text-[var(--accent-ink)]" />Moves forward only (back to quoting is the one step back)</li>
      <li className="flex items-center gap-1.5"><Hand aria-hidden="true" className="size-3.5 text-[var(--accent-ink)]" />A card a person moved stays put</li>
      <li className="flex items-center gap-1.5"><Layers aria-hidden="true" className="size-3.5 text-[var(--accent-ink)]" />Follows the furthest open attempt</li>
      <li className="flex items-center gap-1.5"><Lock aria-hidden="true" className="size-3.5 text-[var(--accent-ink)]" />Never changes the application</li>
    </ul>
  );
}
