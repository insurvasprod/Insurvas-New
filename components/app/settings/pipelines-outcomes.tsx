"use client";

/**
 * Settings › Pipelines & outcomes (owner pick "V2, round 2", 2026-10-27). One page replaces Settings ›
 * Pipelines and Settings › Dispositions: the call outcomes on the left, the pipeline's stages on the
 * right, a line from each outcome to the stage it sends a lead to.
 *
 * - Works out of the box: an outcome goes to the stage in the lead's pipeline with its own name, and an
 *   outcome with no such stage keeps the lead where it is (resolve_disposition_stage, 20261027100000).
 * - Drag an outcome onto a stage (or click it, then the stage). Grab a stage to reorder it: it follows the
 *   pointer, the list scrolls at its edges, and the stages slide into their new places (FLIP).
 * - The outcome editor and the stage editor share one panel of one size, shown only once something is
 *   clicked, and scrolled to; "+" opens it for a new one.
 * - Nothing is written until Save (top right); Save runs the same per-row endpoints the two old screens used (see
 *   lib/pipelines/outcomesBoard.ts), and the lead workspace and the dialer read them from then on.
 * - Kept from the old screens: pipeline name, partner type, default and delete; stage name, kind, colour,
 *   description, time allowed, counts as worked and archive; outcome name, next action and its time,
 *   worked, closes as, archive and restore; each stage's agent questions (AgentQuestionsDialog).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Ban, CalendarClock, Check, CircleCheck, CircleX, Clock, DollarSign, FileCheck, GripVertical, Hash, MessageSquare,
  Moon, PhoneCall, PhoneOff, Plus, Repeat, Settings2, Square, ThumbsDown, Voicemail, type LucideIcon,
} from "lucide-react";

import { Callout, SettingsStack, control } from "@/components/app/settings/primitives";
import { AgentQuestionsDialog } from "@/components/app/settings/agent-questions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HoverHint } from "@/components/ui/hover-hint";
import { SectionLoading } from "@/components/ui/page-states";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { allowedNextActions, type NextActionKind } from "@/lib/dispositions/nextAction";
import type { DispositionSettingsRow } from "@/lib/dispositions/types";
import type { Pipeline } from "@/lib/pipelines/types";
import type { PipelineViewContext } from "@/lib/pipelines/views";
import {
  draftProblems, destinations, iconFor, isTemp, keyFor, liveStages, NEW_PREFIX, NEW_STAGE_COLOR, planSave, reachedSomeone,
  REST_PRESETS, RETRY_PRESETS, shortDuration, STAGE_SWATCHES, TIME_ALLOWED_PRESETS, WHY_CLOSES, WHY_KIND, WHY_NEXT, WHY_WORKED,
  type BoardDoc, type BoardOutcome, type BoardPipeline, type BoardStage, type Destination, type OutcomeIcon, type SaveOp, type StageType,
} from "@/lib/pipelines/outcomesBoard";

type Loaded = { doc: BoardDoc; agency: Record<string, string>; rowIds: Record<string, string>; leadCounts: Record<string, number>; rulesReady: boolean; nextActionReady: boolean; pipelineOutcomesReady: boolean };
type Picked = { kind: "outcome"; key: string } | { kind: "stage"; id: string } | { kind: "pipeline" } | null;

const DRAG_TYPE = "application/x-insurvas-board";
const ROW_O = 52; // outcome row (46px) + gap
const ROW_S = 58; // stage row (52px) + gap
const KIND_COLOR: Record<StageType, string> = { open: "var(--info)", won: "var(--primary)", lost: "var(--error)" };
const STAY_COLOR = "var(--muted)";
const OUTCOME_ICON: Record<OutcomeIcon, LucideIcon> = {
  noAnswer: PhoneOff, voicemail: Voicemail, busy: PhoneCall, wrong: Hash, callback: CalendarClock, quote: DollarSign,
  application: FileCheck, sold: CircleCheck, notInterested: ThumbsDown, notQualified: CircleX, doNotCall: Ban, other: MessageSquare,
};
/** Each next action has its own colour, as on the board (pd_boards NI). */
const NEXT_META: Record<NextActionKind, { label: string; icon: LucideIcon; color: string }> = {
  cadence: { label: "Cadence", icon: Repeat, color: "var(--info)" }, retry: { label: "Retry", icon: Clock, color: "var(--info)" }, rest: { label: "Rest", icon: Moon, color: "var(--cat-2)" },
  close: { label: "Stop", icon: Square, color: "var(--muted)" }, callback: { label: "Callback", icon: CalendarClock, color: "var(--primary)" }, suppress: { label: "Do not call", icon: Ban, color: "var(--error)" },
};
const tint = (color: string, percent = 16) => ({ background: `color-mix(in srgb, ${color} ${percent}%, transparent)`, color });
const PARTNER_TYPES: Array<{ value: string | null; label: string }> = [
  { value: null, label: "No partner type" }, { value: "publisher", label: "Publisher / transfer" }, { value: "marketing", label: "Marketing" }, { value: "affiliate", label: "Affiliate" },
];
const SCROLL = "overflow-y-auto overscroll-contain [scrollbar-width:thin] [scrollbar-color:color-mix(in_srgb,var(--primary)_45%,transparent)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[color-mix(in_srgb,var(--primary)_45%,transparent)]";
const CARD = "rounded-[12px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--color-card)_55%,transparent)] backdrop-blur-[20px] backdrop-saturate-150";
const KICKER = "inline-flex items-center gap-1 text-xs leading-[1.33] font-semibold tracking-[0.04em] uppercase text-[var(--muted)]";
const CHIP = (on: boolean) => cn("inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-semibold tracking-[-0.01em] transition-colors disabled:cursor-not-allowed disabled:opacity-50", on ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "border-[var(--border-strong)] bg-transparent text-[var(--body)] hover:border-[var(--accent-ink)]");
const BIG = (on: boolean) => cn("relative flex w-[84px] flex-col items-center gap-1 rounded-[12px] border-[1.5px] px-1 py-2 text-xs font-bold transition-colors", on ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "border-[var(--border-strong)] bg-transparent text-[var(--body)] hover:border-[var(--accent-ink)]");

async function call(url: string, method: string, body?: unknown) {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error((data as { error?: string } | null)?.error ?? "That could not be saved");
  return data as Record<string, unknown> | null;
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

async function loadAll(): Promise<Loaded> {
  const [pipelinesRes, configRes, mappingsRes, contextRes] = await Promise.all([
    fetch("/api/app/pipelines", { cache: "no-store" }),
    fetch("/api/app/dispositions/config", { cache: "no-store" }),
    fetch("/api/app/pipelines/dispositions", { cache: "no-store" }),
    fetch("/api/app/leads/pipeline-context", { cache: "no-store" }),
  ]);
  const pipelinesBody = await pipelinesRes.json().catch(() => null);
  const configBody = await configRes.json().catch(() => null);
  const mappingsBody = await mappingsRes.json().catch(() => null);
  const context = contextRes.ok ? ((await contextRes.json().catch(() => null)) as PipelineViewContext | null) : null;
  if (!pipelinesRes.ok) throw new Error(pipelinesBody?.error ?? "Could not load your pipelines");
  if (!configRes.ok) throw new Error(configBody?.error ?? "Could not load your call outcomes");
  if (!mappingsRes.ok) throw new Error(mappingsBody?.error ?? "Could not load where outcomes send leads");
  const rules = context?.stageRules ?? {};
  // The all-in-one default (no partner type) leads the row: it is the one every agent works in (20261027300000).
  const allInOne = (pipeline: Pipeline) => (pipeline.partner_type === null && pipeline.is_default ? 0 : 1);
  const pipelines: BoardPipeline[] = [...(pipelinesBody.pipelines as Pipeline[])].sort((a, b) => allInOne(a) - allInOne(b)).map((pipeline) => ({
    id: pipeline.id, name: pipeline.name, partner_type: pipeline.partner_type, is_default: pipeline.is_default,
    stages: [...pipeline.stages].sort((a, b) => a.position - b.position).map((stage): BoardStage => ({
      id: stage.id, name: stage.name, stage_type: stage.stage_type, color: stage.color, description: stage.description ?? "",
      timeAllowedMinutes: rules[stage.id]?.timeAllowedMinutes ?? null, countsAsWorked: rules[stage.id]?.countsAsWorked ?? null, archived: stage.is_archived, isNew: false,
    })),
  }));
  const outcomes: BoardOutcome[] = (configBody.dispositions as DispositionSettingsRow[]).map((row) => ({
    id: row.id, key: row.disposition_key, label: row.label, worked: row.counts_as_work_completed, closesAs: row.closes_as, active: row.is_active,
    next: row.next ? { kind: row.next.kind, minutes: row.next.minutes } : null, isNew: false,
  }));
  const agency: Record<string, string> = {};
  for (const mapping of (mappingsBody.mappings ?? []) as Array<{ stage_id: string; disposition_key: string }>) agency[mapping.disposition_key] = mapping.stage_id;
  const own: BoardDoc["own"] = {};
  const rowIds: Record<string, string> = {};
  for (const row of (mappingsBody.pipelineOutcomes?.rows ?? []) as Array<{ id: string; pipeline_id: string; stage_id: string | null; disposition_key: string }>) {
    (own[row.pipeline_id] ??= {})[row.disposition_key] = row.stage_id;
    rowIds[`${row.pipeline_id}:${row.disposition_key}`] = row.id;
  }
  return {
    doc: { pipelines, outcomes, own }, agency, rowIds, leadCounts: (pipelinesBody.counts?.stages ?? {}) as Record<string, number>,
    rulesReady: context?.schemaReady === true, nextActionReady: configBody.next_action_available !== false, pipelineOutcomesReady: mappingsBody.pipelineOutcomes?.ready !== false,
  };
}

/** A new outcome is created with its permanent key, made from its name when the draft is saved. */
function finalizeKeys(draft: BoardDoc): BoardDoc {
  const doc = clone(draft);
  const taken = new Set(doc.outcomes.filter((outcome) => !outcome.isNew).map((outcome) => outcome.key));
  for (const outcome of doc.outcomes) {
    if (!outcome.isNew) continue;
    const key = keyFor(outcome.label, taken);
    taken.add(key);
    for (const rows of Object.values(doc.own)) if (outcome.key in rows) { rows[key] = rows[outcome.key]; delete rows[outcome.key]; }
    outcome.key = key;
  }
  return doc;
}

function Hint({ id, text, label }: { id: string; text: string; label: string }) {
  return <HoverHint id={id} label={label}>{text}</HoverHint>;
}

export function PipelinesOutcomesSettings() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<BoardDoc | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const [creating, setCreating] = useState(false);
  const [questionsFor, setQuestionsFor] = useState<{ id: string; name: string } | null>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; dx: number; dy: number; width: number; over: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const slots = useRef(new Map<string, { top: number; left: number }>());
  const dropFrom = useRef<{ id: string; top: number; left: number } | null>(null);
  const swallowClick = useRef(false);

  // FLIP: a stage whose slot moved since the last render slides from where it was (or, just dropped, from
  // where the pointer let go of it) to where it is now. Slots are measured inside the list, so scrolling
  // never reads as a move.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) { slots.current.clear(); return; }
    const next = new Map<string, { top: number; left: number }>();
    for (const row of list.querySelectorAll<HTMLElement>("[data-flip-id]")) {
      const id = row.dataset.flipId as string;
      const slot = { top: row.offsetTop, left: row.offsetLeft };
      next.set(id, slot);
      const was = dropFrom.current?.id === id ? dropFrom.current : slots.current.get(id);
      if (was && (Math.abs(was.top - slot.top) > 1 || Math.abs(was.left - slot.left) > 1)) {
        row.animate([{ transform: `translate(${was.left - slot.left}px, ${was.top - slot.top}px)` }, { transform: "none" }], { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    }
    dropFrom.current = null;
    slots.current = next;
  });

  // The map fills what is left of the window below it (owner, 2026-10-27), like Settings › Carriers;
  // the outcome and stage lists scroll inside it. Measured from the list's own top, so the editor
  // opening below it never changes the height.
  const [mapHeight, setMapHeight] = useState<number | null>(null);
  const fitMap = useCallback(() => {
    const element = scrollRef.current;
    if (!element || window.innerWidth < 1024) { setMapHeight(null); return; }
    // Less the card's bottom padding and border (15px) and the page's 32px bottom padding.
    const top = element.getBoundingClientRect().top + window.scrollY;
    setMapHeight(Math.max(420, Math.round(window.innerHeight - top - 47)));
  }, []);
  const ready = loaded !== null;
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(fitMap, 0);
    const observer = new ResizeObserver(() => fitMap());
    observer.observe(document.body);
    window.addEventListener("resize", fitMap);
    return () => { window.clearTimeout(timer); observer.disconnect(); window.removeEventListener("resize", fitMap); };
  }, [fitMap, ready]);

  const pickedKey = picked ? (picked.kind === "outcome" ? `o:${picked.key}` : picked.kind === "stage" ? `s:${picked.id}` : "pipeline") : null;
  useEffect(() => {
    if (!pickedKey) return;
    const frame = requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    return () => cancelAnimationFrame(frame);
  }, [pickedKey]);

  const reload = useCallback(async (keepPipeline?: string | null) => {
    try {
      const next = await loadAll();
      setLoaded(next);
      setDraft(clone(next.doc));
      setLoadError(null);
      setPipelineId((current) => keepPipeline ?? current ?? next.doc.pipelines.find((p) => p.is_default)?.id ?? next.doc.pipelines[0]?.id ?? null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Could not load this page");
    }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the section's external data, loaded once
  useEffect(() => { void reload(); }, [reload]);

  const ops = useMemo(() => (loaded && draft ? planSave(loaded.doc, finalizeKeys(draft), loaded.rowIds, { rules: loaded.rulesReady, nextAction: loaded.nextActionReady }) : []), [loaded, draft]);
  const problems = useMemo(() => (draft ? draftProblems(draft) : []), [draft]);

  if (!loaded || !draft) {
    return (
      <SettingsStack>
        {loadError ? <Callout tone="error" title={loadError} /> : <div className={CARD}><SectionLoading label="Loading pipelines and outcomes" /></div>}
      </SettingsStack>
    );
  }

  const pipeline = draft.pipelines.find((item) => item.id === pipelineId) ?? draft.pipelines[0];
  if (!pipeline) return <SettingsStack><Callout tone="info" title="No pipelines yet." /></SettingsStack>;
  const stages = liveStages(pipeline);
  const dest = destinations(draft, pipeline.id, loaded.agency);
  const outcomes = draft.outcomes.filter((outcome) => outcome.active || showArchived);
  const archivedCount = draft.outcomes.filter((outcome) => !outcome.active).length;
  const elsewhereKeys = outcomes.filter((outcome) => dest.get(outcome.key)?.dest.kind === "elsewhere").map((outcome) => outcome.key);
  const dirty = ops.length > 0;

  const edit = (fn: (doc: BoardDoc) => void) => { setDraft((current) => { if (!current) return current; const doc = clone(current); fn(doc); return doc; }); setSavedNote(false); };
  const editPipeline = (fn: (p: BoardPipeline) => void) => edit((doc) => { const p = doc.pipelines.find((item) => item.id === pipeline.id); if (p) fn(p); });
  const editStage = (id: string, fn: (s: BoardStage) => void) => editPipeline((p) => { const s = p.stages.find((item) => item.id === id); if (s) fn(s); });
  const editOutcome = (key: string, fn: (o: BoardOutcome) => void) => edit((doc) => { const o = doc.outcomes.find((item) => item.key === key); if (o) fn(o); });
  const route = (key: string, stageId: string | null) => edit((doc) => { (doc.own[pipeline.id] ??= {})[key] = stageId; });
  const resetRoute = (key: string) => edit((doc) => { if (doc.own[pipeline.id]) delete doc.own[pipeline.id][key]; });

  function addOutcome() {
    const key = `${NEW_PREFIX.replace(":", "_")}${Date.now().toString(36)}`;
    edit((doc) => { doc.outcomes.push({ id: `${NEW_PREFIX}${key}`, key, label: "", worked: true, closesAs: "completed", active: true, next: { kind: "cadence", minutes: null }, isNew: true }); });
    setPicked({ kind: "outcome", key });
  }
  function addStage() {
    const id = `${NEW_PREFIX}${Date.now().toString(36)}`;
    editPipeline((p) => { p.stages.push({ id, name: "", stage_type: "open", color: NEW_STAGE_COLOR.open, description: "", timeAllowedMinutes: null, countsAsWorked: null, archived: false, isNew: true }); });
    setPicked({ kind: "stage", id });
  }
  function moveStageTo(id: string, to: number) {
    editPipeline((p) => {
      const live = p.stages.filter((s) => !s.archived);
      const from = live.findIndex((s) => s.id === id);
      if (from < 0 || from === to) return;
      const [moved] = live.splice(from, 1);
      live.splice(to, 0, moved);
      p.stages = [...live, ...p.stages.filter((s) => s.archived)];
    });
  }
  function onDrop(target: string | null) {
    return (event: DragEvent) => {
      event.preventDefault();
      const [kind, id] = event.dataTransfer.getData(DRAG_TYPE).split("|");
      if (kind === "outcome" && id) route(id, target);
    };
  }
  const startDrag = (kind: "outcome", id: string) => (event: DragEvent) => { event.dataTransfer.setData(DRAG_TYPE, `${kind}|${id}`); event.dataTransfer.effectAllowed = "move"; };

  /**
   * Grab a stage: past a few pixels it lifts off and follows the pointer, the stages part to show where it
   * will land, and the list scrolls when the pointer nears its top or bottom edge (or the wheel scrolls it).
   * Letting go slides it into its slot. A press that never moves stays a click. Touch grabs by the handle
   * only, so a finger can still scroll the list.
   */
  function grabStage(event: ReactPointerEvent<HTMLDivElement>, stageId: string) {
    if (event.button !== 0 || (event.pointerType === "touch" && !(event.target as HTMLElement).closest("[data-grip]"))) return;
    const list = listRef.current;
    const scroller = scrollRef.current;
    if (!list || !scroller) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY };
    const dx = event.clientX - rect.left;
    const dy = event.clientY - rect.top;
    const count = stages.length;
    let pointer = start;
    let lifted = false;
    let over = stages.findIndex((s) => s.id === stageId);
    let frame = 0;
    const paint = () => {
      over = Math.max(0, Math.min(count - 1, Math.round((pointer.y - dy - list.getBoundingClientRect().top) / ROW_S)));
      setDrag({ id: stageId, x: pointer.x, y: pointer.y, dx, dy, width: rect.width, over });
    };
    const edgeScroll = () => {
      const box = scroller.getBoundingClientRect();
      const edge = 56;
      const speed = pointer.y < box.top + edge ? -Math.ceil((box.top + edge - pointer.y) / 5) : pointer.y > box.bottom - edge ? Math.ceil((pointer.y - box.bottom + edge) / 5) : 0;
      if (speed) scroller.scrollTop += speed;
      frame = requestAnimationFrame(edgeScroll);
    };
    const move = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
      if (!lifted) {
        if (Math.hypot(pointer.x - start.x, pointer.y - start.y) < 5) return;
        lifted = true;
        document.body.style.cursor = "grabbing";
        frame = requestAnimationFrame(edgeScroll);
      }
      e.preventDefault();
      paint();
    };
    const scrolled = () => { if (lifted) paint(); };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      scroller.removeEventListener("scroll", scrolled);
      cancelAnimationFrame(frame);
      if (!lifted) return;
      document.body.style.cursor = "";
      swallowClick.current = true;
      setTimeout(() => { swallowClick.current = false; }, 0);
      const box = list.getBoundingClientRect();
      dropFrom.current = { id: stageId, top: pointer.y - dy - box.top, left: pointer.x - dx - box.left };
      setDrag(null);
      moveStageTo(stageId, over);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    scroller.addEventListener("scroll", scrolled, { passive: true });
  }

  async function save() {
    if (!loaded || !draft || problems.length) return;
    setSaving(true);
    setSaveError(null);
    const finalDoc = finalizeKeys(draft);
    const plan = planSave(loaded.doc, finalDoc, loaded.rowIds, { rules: loaded.rulesReady, nextAction: loaded.nextActionReady });
    const realId = new Map<string, string>();
    const real = (id: string | null) => (id && isTemp(id) ? realId.get(id) ?? id : id);
    try {
      for (const op of plan as SaveOp[]) {
        if (op.op === "patchPipeline") await call(`/api/app/pipelines/${op.pipelineId}`, "PATCH", op.body);
        else if (op.op === "archiveStage") await call(`/api/app/pipelines/${op.pipelineId}/stages/${op.stageId}`, "PATCH", { is_archived: true });
        else if (op.op === "createStage") { const body = await call(`/api/app/pipelines/${op.pipelineId}/stages`, "POST", op.body); realId.set(op.tempId, (body?.stage as { id: string }).id); }
        else if (op.op === "patchStage") await call(`/api/app/pipelines/${op.pipelineId}/stages/${op.stageId}`, "PATCH", op.body);
        else if (op.op === "stageRules") await call("/api/app/leads/pipeline-rules", "PATCH", { kind: "stage", stage_id: real(op.stageId), time_allowed_minutes: op.time_allowed_minutes, counts_as_worked: op.counts_as_worked });
        else if (op.op === "reorder") await call(`/api/app/pipelines/${op.pipelineId}/stages/reorder`, "POST", { stage_ids: op.stageIds.map((id) => real(id)) });
        else if (op.op === "createOutcome") await call("/api/app/dispositions/config", "POST", op.body);
        else if (op.op === "patchOutcome") await call("/api/app/dispositions/config", "PATCH", op.body);
        else if (op.op === "setRow") await call("/api/app/pipelines/dispositions", "POST", { pipeline_id: op.pipelineId, stage_id: real(op.stageId), disposition_key: op.key });
        else if (op.op === "removeRow") await call("/api/app/pipelines/dispositions", "DELETE", { id: op.rowId, scope: "pipeline" });
      }
      setPicked(null);
      await reload(pipeline.id);
      setSavedNote(true);
      notify.done("Saved. The lead workspace and the dialer use these now.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save";
      setSaveError(`${message} Changes before this one were saved; the rest were not.`);
      notify.block(message);
      await reload(pipeline.id);
    } finally {
      setSaving(false);
    }
  }

  // While a stage is held, the list shows it at the slot it would drop into.
  const order = (() => {
    const held = drag && stages.find((s) => s.id === drag.id);
    if (!drag || !held) return stages;
    const rest = stages.filter((s) => s.id !== drag.id);
    rest.splice(drag.over, 0, held);
    return rest;
  })();
  const heldStage = drag ? stages.find((s) => s.id === drag.id) ?? null : null;
  const svgHeight = Math.max((outcomes.length + 1) * ROW_O, (stages.length + 2 + (elsewhereKeys.length ? 1 : 0)) * ROW_S);
  const stageRow = (key: string) => {
    const d = dest.get(key)?.dest;
    if (!d || d.kind === "stays") return stages.length + 1 + (elsewhereKeys.length ? 1 : 0);
    if (d.kind === "elsewhere") return stages.length + 1;
    return order.findIndex((s) => s.id === d.stageId);
  };
  const lineColor = (key: string) => {
    const d = dest.get(key)?.dest;
    if (!d || d.kind === "stays") return STAY_COLOR;
    if (d.kind === "elsewhere") return "var(--warning)";
    return KIND_COLOR[stages.find((s) => s.id === d.stageId)?.stage_type ?? "open"];
  };
  const pickedOutcome = picked?.kind === "outcome" ? draft.outcomes.find((o) => o.key === picked.key) ?? null : null;
  const pickedStage = picked?.kind === "stage" ? stages.find((s) => s.id === picked.id) ?? null : null;

  return (
    <SettingsStack>
      {/* No section title or purpose line (owner, 2026-10-27): the pipelines are the first line. */}
      <div className="flex flex-wrap items-center gap-2">
        {draft.pipelines.map((item) => (
          <button key={item.id} type="button" onClick={() => { setPipelineId(item.id); setPicked(null); }} aria-pressed={item.id === pipeline.id} className={cn(CHIP(item.id === pipeline.id), "h-9 px-4 text-sm")}>
            {item.name || "Unnamed pipeline"}<span className="opacity-60">{liveStages(item).length} stages</span>
          </button>
        ))}
        <button type="button" onClick={() => setPicked({ kind: "pipeline" })} aria-label="Pipeline settings" title="This pipeline's name, partner type and default" className={cn(CHIP(picked?.kind === "pipeline"), "h-9")}><Settings2 className="size-4" aria-hidden="true" />Pipeline</button>
        <button type="button" onClick={() => setCreating(true)} disabled={dirty} title={dirty ? "Save or discard your changes first" : "A new pipeline, from one you have or blank"} className={cn(CHIP(false), "h-9")}><Plus className="size-4" aria-hidden="true" />New pipeline</button>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <span role="status" className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold", dirty ? "bg-[var(--warning-surface)] text-[var(--warning-ink)]" : "bg-[var(--primary-soft)] text-[var(--accent-ink)]")}>
            {dirty ? <span className="size-2 rounded-full bg-[var(--warning)]" aria-hidden="true" /> : <span className="grid size-4 place-items-center rounded-full bg-[var(--primary)] text-[var(--on-primary)]"><Check className="size-3" aria-hidden="true" /></span>}
            {dirty ? `${ops.length} unsaved change${ops.length === 1 ? "" : "s"}` : savedNote ? "Saved" : "All saved"}
          </span>
          <Button type="button" variant="outline" onClick={() => { setDraft(clone(loaded.doc)); setPicked(null); setSaveError(null); }} disabled={!dirty || saving}>Discard</Button>
          <Button type="button" onClick={() => void save()} disabled={!dirty || saving || problems.length > 0} title={dirty ? "Saving updates the lead workspace and the dialer right away" : "Changes wait here until you save them"}>{saving ? "Saving…" : "Save changes"}</Button>
        </span>
      </div>

      {problems.length > 0 && dirty && <Callout tone="warning" title={problems[0]} />}
      {saveError && <Callout tone="error" title={saveError} />}

      <div className={cn(CARD, "px-4 pt-3 pb-3.5")}>
        <div className="mb-2.5 grid grid-cols-[minmax(0,300px)_1fr_minmax(0,300px)] items-center border-b border-[var(--border)] pb-2">
          <span data-guide="pipeline-outcomes" className={KICKER}>Outcomes · {draft.outcomes.filter((o) => o.active).length}<Hint id="hint-outcomes" label="About outcomes" text="What an agent can pick after a call." /></span>
          {/* The map's title sits in the middle, between the two columns it joins (owner, 2026-10-27). */}
          <span className="flex min-w-0 flex-wrap items-center justify-center gap-x-4 gap-y-1 px-3">
            <span className="inline-flex items-center gap-1.5">
              <h3 className="m-0 text-sm font-semibold tracking-[-0.02em] text-[var(--ink)]">When a call ends, where the lead goes</h3>
              <Hint id="hint-flow" label="About this map" text="Each line joins an outcome to the stage it moves the lead to. Drag an outcome onto a stage, or click an outcome and then a stage. Hold a stage and drag it to reorder." />
            </span>
            <span className="flex flex-wrap gap-3 text-xs text-[var(--muted)]">
              {([["Open", KIND_COLOR.open], ["Won", KIND_COLOR.won], ["Lost", KIND_COLOR.lost], ["Stays put", STAY_COLOR]] as const).map(([label, color]) => (
                <span key={label} className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: color }} aria-hidden="true" />{label}</span>
              ))}
            </span>
          </span>
          <span className={KICKER}>Stages · {stages.length}<Hint id="hint-stages" label="About stages" text="Where a lead sits in this pipeline, in order. Drag ⋮⋮ to reorder." /></span>
        </div>
        <div ref={scrollRef} className={cn(SCROLL, "pr-1.5", mapHeight === null && "max-h-[420px]")} style={mapHeight === null ? undefined : { height: mapHeight }}>
          <div className="grid grid-cols-[minmax(0,300px)_1fr_minmax(0,300px)] items-start">
            <div className="flex flex-col gap-1.5">
              {outcomes.map((outcome) => {
                const Icon = OUTCOME_ICON[iconFor(outcome.label, outcome.key)];
                const on = picked?.kind === "outcome" && picked.key === outcome.key;
                const meta = outcome.next ? NEXT_META[outcome.next.kind] : null;
                const NextIcon = meta?.icon;
                const changed = ops.some((op) => (op.op === "patchOutcome" && op.id === outcome.id) || (op.op === "setRow" && op.key === outcome.key && op.pipelineId === pipeline.id)) || outcome.isNew;
                return (
                  <button
                    key={outcome.key}
                    type="button"
                    onClick={() => setPicked(on ? null : { kind: "outcome", key: outcome.key })}
                    draggable
                    onDragStart={startDrag("outcome", outcome.key)}
                    aria-pressed={on}
                    className={cn("flex h-[46px] cursor-grab items-center gap-2.5 rounded-[12px] border-[1.5px] px-2.5 text-left text-sm font-semibold text-[var(--ink)]", on ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)] bg-[color-mix(in_srgb,var(--color-card)_40%,transparent)] hover:border-[var(--border-strong)]", !outcome.active && "opacity-50")}
                  >
                    <span className={cn("grid size-[30px] shrink-0 place-items-center rounded-[9px]", on && "bg-[var(--primary)] text-[var(--on-primary)]")} style={on ? undefined : tint(lineColor(outcome.key), reachedSomeone(outcome.next) ? 20 : 12)} title={on ? undefined : "Coloured by where it sends the lead"}><Icon className="size-4" aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1 truncate">{outcome.label || "New outcome"}</span>
                    {changed && <span className="size-[7px] shrink-0 rounded-full bg-[var(--warning)]" title="Not saved yet" />}
                    {NextIcon && <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-xs font-bold" style={tint(meta.color, 14)} title={meta.label}><NextIcon className="size-3" aria-hidden="true" />{outcome.next?.kind === "retry" || outcome.next?.kind === "rest" ? shortDuration(outcome.next.minutes) : ""}</span>}
                  </button>
                );
              })}
              <button type="button" onClick={addOutcome} className="flex h-[46px] items-center justify-center gap-2 rounded-[12px] border-[1.5px] border-dashed border-[var(--border-strong)] text-sm font-semibold text-[var(--muted)] hover:text-[var(--ink)]"><Plus className="size-4" aria-hidden="true" />Add an outcome</button>
              {archivedCount > 0 && <button type="button" onClick={() => setShowArchived(!showArchived)} className="self-start px-1 py-1 text-xs font-semibold text-[var(--accent-ink)] hover:underline">{showArchived ? "Hide archived" : `Show archived (${archivedCount})`}</button>}
            </div>

            <svg width="100%" height={svgHeight} viewBox={`0 0 400 ${svgHeight}`} preserveAspectRatio="none" aria-hidden="true" className="block">
              {outcomes.map((outcome, index) => {
                const y1 = index * ROW_O + (ROW_O - 6) / 2;
                const y2 = stageRow(outcome.key) * ROW_S + (ROW_S - 6) / 2;
                const on = picked?.kind === "outcome" && picked.key === outcome.key;
                const isDefault = dest.get(outcome.key)?.isDefault;
                return <path key={outcome.key} d={`M0 ${y1} C 200 ${y1}, 200 ${y2}, 400 ${y2}`} fill="none" strokeLinecap="round" strokeDasharray={isDefault && !on ? "5 5" : undefined} style={{ stroke: on ? "var(--primary)" : lineColor(outcome.key), strokeWidth: on ? 3 : 1.6, opacity: picked?.kind === "outcome" && !on ? 0.25 : 0.85, transition: "d 240ms cubic-bezier(.2,.8,.2,1)" }} />;
              })}
            </svg>

            <div ref={listRef} className="relative flex flex-col gap-1.5">
              {order.map((stage) => {
                const count = outcomes.filter((o) => { const d = dest.get(o.key)?.dest; return d?.kind === "stage" && d.stageId === stage.id; }).length;
                const target = pickedOutcome && (() => { const d = dest.get(pickedOutcome.key)?.dest; return d?.kind === "stage" && d.stageId === stage.id; })();
                const on = picked?.kind === "stage" && picked.id === stage.id;
                if (drag?.id === stage.id) {
                  return <div key={stage.id} data-flip-id={stage.id} aria-hidden="true" className="box-border h-[52px] rounded-[12px] border-[1.5px] border-dashed border-[var(--primary)] bg-[var(--primary-soft)]" />;
                }
                return (
                  <div
                    key={stage.id}
                    data-flip-id={stage.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${stage.name || "New stage"}: click to edit, hold and drag to reorder`}
                    onPointerDown={(event) => grabStage(event, stage.id)}
                    onClick={() => { if (swallowClick.current) return; if (pickedOutcome) route(pickedOutcome.key, stage.id); else setPicked(on ? null : { kind: "stage", id: stage.id }); }}
                    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (pickedOutcome) route(pickedOutcome.key, stage.id); else setPicked({ kind: "stage", id: stage.id }); } }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={onDrop(stage.id)}
                    className={cn("box-border flex h-[52px] cursor-grab touch-pan-y items-center gap-2 rounded-[12px] border-[1.5px] border-l-4 py-0 pr-2.5 pl-1.5 select-none active:cursor-grabbing", on || target ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)] bg-[color-mix(in_srgb,var(--color-card)_40%,transparent)] hover:border-[var(--border-strong)]")}
                    style={{ borderLeftColor: KIND_COLOR[stage.stage_type] }}
                  >
                    <StageFace stage={stage} count={count} />
                  </div>
                );
              })}
              <button type="button" onClick={addStage} className="flex h-[52px] items-center justify-center gap-2 rounded-[12px] border-[1.5px] border-dashed border-[var(--border-strong)] text-sm font-semibold text-[var(--muted)] hover:text-[var(--ink)]"><Plus className="size-4" aria-hidden="true" />Add a stage</button>
              {elsewhereKeys.length > 0 && (
                <div className="box-border flex h-[52px] items-center gap-2 rounded-[12px] border-[1.5px] border-l-4 border-[var(--border)] px-3" style={{ borderLeftColor: "var(--warning)" }} title={WHY_KIND.elsewhere}>
                  <span className="min-w-0 flex-1"><strong className="block text-sm font-semibold text-[var(--ink)]">Another pipeline</strong><span className="text-xs text-[var(--muted)]">its agency-wide stage</span></span>
                  <span className="text-xs font-bold text-[var(--muted)]">{elsewhereKeys.length}</span>
                </div>
              )}
              <div
                role="button"
                tabIndex={0}
                onClick={() => { if (pickedOutcome) route(pickedOutcome.key, null); }}
                onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && pickedOutcome) { event.preventDefault(); route(pickedOutcome.key, null); } }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={onDrop(null)}
                className={cn("box-border flex h-[52px] cursor-pointer items-center gap-2 rounded-[12px] border-[1.5px] border-l-4 px-3", pickedOutcome && dest.get(pickedOutcome.key)?.dest.kind === "stays" ? "border-[var(--primary)] bg-[var(--primary-soft)]" : "border-[var(--border)] bg-[color-mix(in_srgb,var(--color-card)_40%,transparent)]")}
                style={{ borderLeftColor: STAY_COLOR }}
              >
                <span className="min-w-0 flex-1"><strong className="block text-sm font-semibold text-[var(--ink)]">Stays where it is</strong><span className="text-xs text-[var(--muted)]">the lead does not move</span></span>
                {(() => { const n = outcomes.filter((o) => dest.get(o.key)?.dest.kind === "stays").length; return n ? <span className="text-xs font-bold text-[var(--muted)]">{n} outcome{n === 1 ? "" : "s"}</span> : null; })()}
              </div>
            </div>
          </div>
        </div>
      </div>

      {(pickedOutcome || pickedStage || picked?.kind === "pipeline") && (
      <div ref={editorRef} className={cn(CARD, "flex min-h-[300px] scroll-mt-4 scroll-mb-4 flex-col gap-3 border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] px-4 py-4")}>
        {pickedOutcome ? (
          <OutcomeEditor
            key={pickedOutcome.key}
            outcome={pickedOutcome}
            pipeline={pipeline}
            destination={dest.get(pickedOutcome.key) ?? null}
            nextActionReady={loaded.nextActionReady}
            pipelineRowsReady={loaded.pipelineOutcomesReady}
            onEdit={(fn) => editOutcome(pickedOutcome.key, fn)}
            onRoute={(stageId) => route(pickedOutcome.key, stageId)}
            onReset={() => resetRoute(pickedOutcome.key)}
            onDone={() => setPicked(null)}
          />
        ) : pickedStage ? (
          <StageEditor
            key={pickedStage.id}
            stage={pickedStage}
            isLast={stages.length === 1}
            leadCount={loaded.leadCounts[pickedStage.id] ?? 0}
            rulesReady={loaded.rulesReady}
            landing={outcomes.filter((o) => { const d = dest.get(o.key)?.dest; return d?.kind === "stage" && d.stageId === pickedStage.id; })}
            sameNameOutcome={draft.outcomes.find((o) => o.label.trim() && o.label.trim().toLowerCase() === pickedStage.name.trim().toLowerCase()) ?? null}
            onEdit={(fn) => editStage(pickedStage.id, fn)}
            onRemove={() => { if (pickedStage.isNew) editPipeline((p) => { p.stages = p.stages.filter((s) => s.id !== pickedStage.id); }); else editStage(pickedStage.id, (s) => { s.archived = true; }); setPicked(null); }}
            onOpenOutcome={(key) => setPicked({ kind: "outcome", key })}
            onQuestions={pickedStage.isNew ? null : () => setQuestionsFor({ id: pickedStage.id, name: pickedStage.name })}
            onDone={() => setPicked(null)}
          />
        ) : (
          <PipelineEditor pipeline={pipeline} canDelete={!pipeline.is_default && !dirty} onEdit={editPipeline} onDone={() => setPicked(null)} onDeleted={async () => { setPicked(null); setPipelineId(null); await reload(null); }} />
        )}
      </div>
      )}

      {drag && heldStage && createPortal(
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[1000] box-border flex h-[52px] rotate-[1.5deg] items-center gap-2 rounded-[12px] border-[1.5px] border-l-4 border-[var(--primary)] bg-[var(--color-card)] py-0 pr-2.5 pl-1.5 shadow-[0_18px_40px_-12px_rgb(0_0_0/0.55)]"
          style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.width, borderLeftColor: KIND_COLOR[heldStage.stage_type], cursor: "grabbing" }}
        >
          <StageFace stage={heldStage} count={outcomes.filter((o) => { const d = dest.get(o.key)?.dest; return d?.kind === "stage" && d.stageId === heldStage.id; }).length} />
        </div>,
        document.body,
      )}


      {creating && <NewPipelineDialog pipelines={draft.pipelines} rulesReady={loaded.rulesReady} onClose={() => setCreating(false)} onCreated={async (id) => { setCreating(false); await reload(id); }} />}
      {questionsFor && <AgentQuestionsDialog stageId={questionsFor.id} stageName={questionsFor.name} onClose={() => setQuestionsFor(null)} />}
    </SettingsStack>
  );
}

/** A stage row's contents, shared by the row in the list and the copy that follows the pointer. */
function StageFace({ stage, count }: { stage: BoardStage; count: number }) {
  return (
    <>
      <span data-grip title="Hold and drag to reorder" className="touch-none text-[var(--muted)]"><GripVertical className="size-4" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <strong className="block truncate text-sm font-semibold text-[var(--ink)]">{stage.name || "New stage"}</strong>
        <span className="text-xs text-[var(--muted)]">{stage.stage_type === "open" ? (stage.timeAllowedMinutes ? `⏱ ${shortDuration(stage.timeAllowedMinutes)}` : "open · no time limit") : stage.stage_type}</span>
      </span>
      {count > 0 && <span className="text-xs font-bold text-[var(--muted)]">{count} outcome{count === 1 ? "" : "s"}</span>}
    </>
  );
}

/* ── the shared editor panel ───────────────────────────────────────────────────────────────────── */

function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span className={cn(KICKER, "w-[86px] shrink-0")}>{label}{hint}</span>
      {children}
    </div>
  );
}

function Head({ kicker, children, actions }: { kicker: string; children: ReactNode; actions: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span className={cn(KICKER, "w-[86px] shrink-0")}>{kicker}</span>
      {children}
      <span className="ml-auto flex flex-wrap gap-1.5">{actions}</span>
    </div>
  );
}

function MinutesInput({ value, onChange, label }: { value: number | null; onChange: (minutes: number | null) => void; label: string }) {
  const [text, setText] = useState(value ? String(value) : "");
  return (
    <label className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)]">
      <input className={cn(control, "mt-0 w-[86px]")} inputMode="numeric" aria-label={label} placeholder="minutes" value={text} onChange={(event) => { setText(event.target.value.replace(/\D/g, "")); const n = Number(event.target.value.replace(/\D/g, "")); onChange(n > 0 ? Math.min(n, 525600) : null); }} />
      min
    </label>
  );
}

function OutcomeEditor({ outcome, pipeline, destination, nextActionReady, pipelineRowsReady, onEdit, onRoute, onReset, onDone }: {
  outcome: BoardOutcome;
  pipeline: BoardPipeline;
  destination: { dest: Destination; isDefault: boolean } | null;
  nextActionReady: boolean;
  pipelineRowsReady: boolean;
  onEdit: (fn: (o: BoardOutcome) => void) => void;
  onRoute: (stageId: string | null) => void;
  onReset: () => void;
  onDone: () => void;
}) {
  const Icon = OUTCOME_ICON[iconFor(outcome.label, outcome.key)];
  const allowed = outcome.isNew ? (["cadence", "retry", "rest", "close"] as NextActionKind[]) : allowedNextActions(outcome.key);
  const kind = outcome.next?.kind ?? null;
  const presets = kind === "retry" ? RETRY_PRESETS : kind === "rest" ? REST_PRESETS : [];
  const stages = liveStages(pipeline);
  const d = destination?.dest;
  const onStage = (id: string) => d?.kind === "stage" && d.stageId === id;
  const closes = kind === "close" || kind === "rest" || kind === "suppress" || kind === "callback";
  return (
    <>
      <Head kicker={outcome.isNew ? "New outcome" : "Outcome"} actions={<>
        {!destination?.isDefault && <button type="button" onClick={onReset} className={CHIP(false)} title="Back to the default: the stage with this outcome's name, or stays">↺ Default</button>}
        {!outcome.isNew && <button type="button" onClick={() => onEdit((o) => { o.active = !o.active; })} className={cn(CHIP(false), outcome.active && "text-[var(--error-ink)]")}>{outcome.active ? "Archive" : "Restore"}</button>}
        <button type="button" onClick={onDone} className={CHIP(false)}><Check className="size-3.5" aria-hidden="true" />Done</button>
      </>}>
        <span className="grid size-9 place-items-center rounded-[10px] bg-[var(--primary-soft)] text-[var(--accent-ink)]"><Icon className="size-4" aria-hidden="true" /></span>
        <input className={cn(control, "mt-0 w-[260px] font-semibold")} aria-label="Outcome name" placeholder="Name it: e.g. Quoted" maxLength={120} value={outcome.label} onChange={(event) => { const value = event.target.value; onEdit((o) => { o.label = value; }); }} autoFocus={outcome.isNew} />
        {outcome.isNew && <span className="text-xs text-[var(--muted)]">Its icon follows its name.</span>}
      </Head>

      {nextActionReady ? (
        <Row label="Then">
          {allowed.map((option) => {
            const meta = NEXT_META[option];
            return (
              <span key={option} className="relative">
                <button type="button" onClick={() => onEdit((o) => { o.next = { kind: option, minutes: option === "retry" ? (o.next?.kind === "retry" ? o.next.minutes : 120) : option === "rest" ? (o.next?.kind === "rest" ? o.next.minutes : 43200) : null }; })} aria-pressed={kind === option} className={BIG(kind === option)}>
                  <meta.icon className="size-[18px]" style={{ color: meta.color }} aria-hidden="true" />{meta.label}
                </button>
                <span className="absolute -top-1 -right-1"><Hint id={`why-next-${option}`} label={`When to pick ${meta.label}`} text={WHY_NEXT[option]} /></span>
              </span>
            );
          })}
          {presets.length > 0 && (
            <span className="flex flex-wrap items-center gap-1.5 border-l border-[var(--border)] pl-2.5">
              {presets.map((minutes) => <button key={minutes} type="button" onClick={() => onEdit((o) => { if (o.next) o.next.minutes = minutes; })} aria-pressed={outcome.next?.minutes === minutes} className={CHIP(outcome.next?.minutes === minutes)}>{shortDuration(minutes)}</button>)}
              <MinutesInput key={`${kind}-custom`} label="Custom time in minutes" value={presets.includes(outcome.next?.minutes ?? -1) ? null : outcome.next?.minutes ?? null} onChange={(minutes) => { if (minutes) onEdit((o) => { if (o.next) o.next.minutes = minutes; }); }} />
            </span>
          )}
        </Row>
      ) : (
        <Row label="Then"><span className="text-sm text-[var(--muted)]">What happens next can be set once the database update for next actions is applied.</span></Row>
      )}

      <Row label="Lead">
        {(["open", "won", "lost"] as const).map((group) => {
          const items = stages.filter((stage) => stage.stage_type === group);
          if (!items.length) return null;
          return (
            <span key={group} className="inline-flex flex-wrap items-center gap-1 rounded-full bg-[var(--surface-alt)] py-1 pr-1 pl-2">
              <span className="size-2 rounded-full" style={{ background: KIND_COLOR[group] }} aria-hidden="true" />
              <Hint id={`why-kind-${group}`} label={`About ${group} stages`} text={WHY_KIND[group]} />
              {items.map((stage) => <button key={stage.id} type="button" onClick={() => onRoute(stage.id)} aria-pressed={onStage(stage.id)} className={CHIP(onStage(stage.id))}>{stage.name || "New stage"}</button>)}
            </span>
          );
        })}
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-alt)] py-1 pr-1 pl-2">
          <span className="size-2 rounded-full" style={{ background: STAY_COLOR }} aria-hidden="true" />
          <Hint id="why-kind-stay" label="About keeping the lead in place" text={WHY_KIND.stay} />
          <button type="button" onClick={() => onRoute(null)} aria-pressed={d?.kind === "stays"} disabled={!pipelineRowsReady} title={pipelineRowsReady ? undefined : "Needs a database update"} className={CHIP(d?.kind === "stays")}>⟲ Stays</button>
        </span>
        {d?.kind === "elsewhere" && <span className="text-xs text-[var(--warning-ink)]">Moves to another pipeline now. Pick a stage here to keep the lead in {pipeline.name}.</span>}
        {destination?.isDefault && d?.kind !== "elsewhere" && (
          <span className="text-xs text-[var(--accent-ink)]">
            {d?.kind !== "stage" ? "Default: no stage with its name, so the lead stays." : stages.find((s) => s.id === d.stageId && s.name.trim().toLowerCase() === outcome.label.trim().toLowerCase()) ? "Default: the stage with its name." : "Default: the agency-wide stage."}
          </span>
        )}
      </Row>

      <Row label="Counts" hint={<Hint id="why-worked" label="About worked" text={WHY_WORKED} />}>
        <span className="inline-flex overflow-hidden rounded-full border-[1.5px] border-[var(--border-strong)]">
          {[true, false].map((value) => (
            <button key={String(value)} type="button" onClick={() => onEdit((o) => { o.worked = value; })} aria-pressed={outcome.worked === value} className={cn("h-8 px-3 text-xs font-bold", outcome.worked === value ? "bg-[var(--primary-soft)] text-[var(--accent-ink)]" : "text-[var(--muted)]")}>{value ? "Worked" : "Not worked"}</button>
          ))}
        </span>
        {closes && (
          <span className="ml-3 inline-flex items-center gap-1.5">
            <span className={KICKER}>Closes as<Hint id="why-closes" label="About closes as" text={WHY_CLOSES} /></span>
            {(["completed", "dropped"] as const).map((value) => <button key={value} type="button" onClick={() => onEdit((o) => { o.closesAs = value; })} aria-pressed={outcome.closesAs === value} className={CHIP(outcome.closesAs === value)}>{value === "completed" ? "Completed" : "Dropped"}</button>)}
          </span>
        )}
      </Row>
    </>
  );
}

function StageEditor({ stage, isLast, leadCount, rulesReady, landing, sameNameOutcome, onEdit, onRemove, onOpenOutcome, onQuestions, onDone }: {
  stage: BoardStage;
  isLast: boolean;
  leadCount: number;
  rulesReady: boolean;
  landing: BoardOutcome[];
  sameNameOutcome: BoardOutcome | null;
  onEdit: (fn: (s: BoardStage) => void) => void;
  onRemove: () => void;
  onOpenOutcome: (key: string) => void;
  onQuestions: (() => void) | null;
  onDone: () => void;
}) {
  const blocked = !stage.isNew && (leadCount > 0 || isLast);
  return (
    <>
      <Head kicker={stage.isNew ? "New stage" : "Stage"} actions={<>
        {onQuestions && <button type="button" onClick={onQuestions} className={CHIP(false)} title="The questions an agent answers on a lead in this stage">Agent questions</button>}
        <button type="button" onClick={onRemove} disabled={blocked} title={blocked ? (isLast ? "A pipeline keeps at least one stage" : `${leadCount} lead${leadCount === 1 ? " is" : "s are"} here: move them first`) : undefined} className={cn(CHIP(false), "text-[var(--error-ink)]")}>{stage.isNew ? "Remove" : "Archive"}</button>
        <button type="button" onClick={onDone} className={CHIP(false)}><Check className="size-3.5" aria-hidden="true" />Done</button>
      </>}>
        <input className={cn(control, "mt-0 w-[260px] font-semibold")} aria-label="Stage name" placeholder="Name it: e.g. Quoted" maxLength={120} value={stage.name} onChange={(event) => { const value = event.target.value; onEdit((s) => { s.name = value; }); }} autoFocus={stage.isNew} />
        {sameNameOutcome && <span className="text-xs text-[var(--accent-ink)]">✓ “{sameNameOutcome.label}” sends leads here by default</span>}
      </Head>

      <Row label="Means">
        {(["open", "won", "lost"] as const).map((kind) => (
          <span key={kind} className="relative">
            <button type="button" onClick={() => onEdit((s) => { s.stage_type = kind; if (kind !== "open") s.timeAllowedMinutes = null; if (s.isNew) s.color = NEW_STAGE_COLOR[kind]; })} aria-pressed={stage.stage_type === kind} className={BIG(stage.stage_type === kind)}>
              <span className="size-3.5 rounded-full" style={{ background: KIND_COLOR[kind] }} aria-hidden="true" />{kind === "open" ? "Open" : kind === "won" ? "Won" : "Lost"}
            </button>
            <span className="absolute -top-1 -right-1"><Hint id={`why-means-${kind}`} label={`About ${kind}`} text={WHY_KIND[kind]} /></span>
          </span>
        ))}
        <span className="ml-3 flex items-center gap-1" role="radiogroup" aria-label="Stage colour">
          {STAGE_SWATCHES.map((color) => <button key={color} type="button" role="radio" aria-checked={stage.color === color} aria-label={`Colour ${color}`} onClick={() => onEdit((s) => { s.color = color; })} className={cn("size-6 rounded-full border-2", stage.color === color ? "border-[var(--ink)]" : "border-transparent")} style={{ background: color }} />)}
        </span>
      </Row>

      <Row label="Time" hint={<Hint id="why-time" label="About time allowed" text="How long a lead may sit in this stage before it shows as overdue on the lead workspace. Won and lost stages have no limit." />}>
        {rulesReady ? (
          <>
            {[null, ...TIME_ALLOWED_PRESETS].map((minutes) => <button key={String(minutes)} type="button" disabled={stage.stage_type !== "open"} onClick={() => onEdit((s) => { s.timeAllowedMinutes = minutes; })} aria-pressed={stage.timeAllowedMinutes === minutes} className={CHIP(stage.timeAllowedMinutes === minutes)}>{minutes ? shortDuration(minutes) : "No limit"}</button>)}
            <span className="ml-3 inline-flex items-center gap-1.5">
              <span className={KICKER}>Worked<Hint id="why-stage-worked" label="About worked" text="A lead that reaches this stage counts as worked on the lead workspace, whatever outcome brought it here." /></span>
              {[true, false].map((value) => <button key={String(value)} type="button" onClick={() => onEdit((s) => { s.countsAsWorked = value; })} aria-pressed={(stage.countsAsWorked ?? false) === value} className={CHIP((stage.countsAsWorked ?? false) === value)}>{value ? "Counts" : "Does not count"}</button>)}
            </span>
          </>
        ) : <span className="text-sm text-[var(--muted)]">Time allowed can be set once its database update is applied.</span>}
      </Row>

      <Row label="Note" hint={<Hint id="why-note" label="About the note" text="A short line agents see on the stage, at most 200 characters." />}>
        <input className={cn(control, "mt-0 min-w-0 flex-1")} aria-label="Stage description" placeholder="Optional: what this stage means for your team" maxLength={200} value={stage.description} onChange={(event) => { const value = event.target.value; onEdit((s) => { s.description = value; }); }} />
      </Row>

      <Row label="From" hint={<Hint id="why-from" label="About from" text="The outcomes that move a lead into this stage. Click one to edit it." />}>
        {landing.length === 0 && <span className="text-xs text-[var(--muted)]">No outcome sends leads here yet: drag one onto the stage.</span>}
        {landing.map((outcome) => { const Icon = OUTCOME_ICON[iconFor(outcome.label, outcome.key)]; return <button key={outcome.key} type="button" onClick={() => onOpenOutcome(outcome.key)} className={CHIP(false)}><Icon className="size-3.5" aria-hidden="true" />{outcome.label}</button>; })}
      </Row>
    </>
  );
}

function PipelineEditor({ pipeline, canDelete, onEdit, onDone, onDeleted }: { pipeline: BoardPipeline; canDelete: boolean; onEdit: (fn: (p: BoardPipeline) => void) => void; onDone: () => void; onDeleted: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try { await call(`/api/app/pipelines/${pipeline.id}`, "DELETE", {}); notify.done(`${pipeline.name} deleted`); await onDeleted(); }
    catch (error) { notify.block(error instanceof Error ? error.message : "Could not delete the pipeline"); }
    finally { setBusy(false); setConfirming(false); }
  }
  return (
    <>
      <Head kicker="Pipeline" actions={<>
        <button type="button" onClick={() => setConfirming(true)} disabled={!canDelete} title={canDelete ? undefined : pipeline.is_default ? "A default pipeline cannot be deleted" : "Save or discard your changes first"} className={cn(CHIP(false), "text-[var(--error-ink)]")}>Delete</button>
        <button type="button" onClick={onDone} className={CHIP(false)}><Check className="size-3.5" aria-hidden="true" />Done</button>
      </>}>
        <input className={cn(control, "mt-0 w-[260px] font-semibold")} aria-label="Pipeline name" maxLength={120} value={pipeline.name} onChange={(event) => { const value = event.target.value; onEdit((p) => { p.name = value; }); }} />
      </Head>
      <Row label="For" hint={<Hint id="why-partner" label="About partner type" text="Leads from this kind of partner land in this pipeline. With no partner type it is the all-in-one pipeline: agents' own leads, imports, vendor posts, and any partner with no pipeline of its own." />}>
        {PARTNER_TYPES.map((option) => <button key={String(option.value)} type="button" onClick={() => onEdit((p) => { p.partner_type = option.value; })} aria-pressed={pipeline.partner_type === option.value} className={CHIP(pipeline.partner_type === option.value)}>{option.label}</button>)}
      </Row>
      <Row label="Default" hint={<Hint id="why-default" label="About default" text="The pipeline new leads of this partner type land in. One per partner type, and one all-in-one default with no partner type." />}>
        {[true, false].map((value) => <button key={String(value)} type="button" onClick={() => onEdit((p) => { p.is_default = value; })} aria-pressed={pipeline.is_default === value} className={CHIP(pipeline.is_default === value)}>{value ? "Default" : "Not default"}</button>)}
      </Row>
      {confirming && (
        <Callout tone="warning" title={`Delete ${pipeline.name}? A pipeline with leads or past outcomes cannot be deleted.`}>
          <span className="mt-2 flex gap-2"><Button type="button" variant="outline" onClick={() => setConfirming(false)}>Keep it</Button><Button type="button" onClick={() => void remove()} disabled={busy}>{busy ? "Deleting…" : "Delete pipeline"}</Button></span>
        </Callout>
      )}
    </>
  );
}

/* ── a new pipeline, from one you already have or from scratch ──────────────────────────────────── */

function NewPipelineDialog({ pipelines, rulesReady, onClose, onCreated }: { pipelines: BoardPipeline[]; rulesReady: boolean; onClose: () => void; onCreated: (id: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [partner, setPartner] = useState<string | null>(null);
  const [from, setFrom] = useState<string>(pipelines[0]?.id ?? "blank");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const template = from === "blank" ? null : pipelines.find((p) => p.id === from) ?? null;
  const stages: Array<{ name: string; stage_type: StageType; color: string }> = template
    ? liveStages(template).map((s) => ({ name: s.name, stage_type: s.stage_type, color: s.color }))
    : [{ name: "New", stage_type: "open", color: NEW_STAGE_COLOR.open }, { name: "Sold", stage_type: "won", color: NEW_STAGE_COLOR.won }, { name: "Not interested", stage_type: "lost", color: NEW_STAGE_COLOR.lost }];
  async function create() {
    setBusy(true);
    setError(null);
    try {
      const body = await call("/api/app/pipelines", "POST", { name: name.trim(), partner_type: partner, is_default: false });
      const id = (body?.pipeline as { id: string }).id;
      for (const stage of stages) await call(`/api/app/pipelines/${id}/stages`, "POST", stage);
      if (rulesReady) await call("/api/app/leads/pipeline-rules", "PATCH", { kind: "pipeline_status", pipeline_id: id, status: "live" });
      notify.done(`${name.trim()} created. Outcomes with a stage of the same name already send leads there.`);
      await onCreated(id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not create the pipeline");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="border-[var(--border)] bg-[var(--surface)] sm:max-w-2xl">
        <DialogHeader><DialogTitle className="text-[var(--ink)]">New pipeline</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-3.5">
          <span className={KICKER}>Start from<Hint id="why-template" label="About starting points" text="A copy of the stages of a pipeline you have, or three plain stages. Outcomes with a stage of the same name send leads there right away; change anything after." /></span>
          <div className="flex flex-wrap gap-2">
            {pipelines.map((p) => <button key={p.id} type="button" onClick={() => setFrom(p.id)} aria-pressed={from === p.id} className={CHIP(from === p.id)}>{p.name}</button>)}
            <button type="button" onClick={() => setFrom("blank")} aria-pressed={from === "blank"} className={CHIP(from === "blank")}>Blank</button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">Stages:{stages.map((s, i) => <span key={`${s.name}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-alt)] px-2 py-0.5 font-semibold text-[var(--ink)]"><span className="size-2 rounded-full" style={{ background: KIND_COLOR[s.stage_type] }} aria-hidden="true" />{s.name}</span>)}</div>
          <label className="flex flex-col gap-1 text-sm font-semibold text-[var(--body)]">Name<input className={control} value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="e.g. Spanish marketing leads" autoFocus /></label>
          <span className={KICKER}>Who it is for</span>
          <div className="flex flex-wrap gap-2">{PARTNER_TYPES.map((option) => <button key={String(option.value)} type="button" onClick={() => setPartner(option.value)} aria-pressed={partner === option.value} className={CHIP(partner === option.value)}>{option.label}</button>)}</div>
          {error && <Callout tone="error" title={error} />}
          <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="button" onClick={() => void create()} disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create pipeline"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
