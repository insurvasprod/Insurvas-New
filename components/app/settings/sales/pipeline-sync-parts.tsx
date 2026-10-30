"use client";

/**
 * Settings › Application stages's parts (redesign 2026-10-30, canvas board PsA): the pipeline list, the board
 * preview, the stage picker, the Fill in menu and the Copy dialog. The screen and its draft live in
 * pipeline-sync.tsx; the checks and the name matching in lib/salesSettings/stageMapChecks.ts.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronRight, ChevronUp, Plus, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StatusChip } from "@/components/ui/status-chip";
import { control } from "@/components/app/settings/primitives";
import { PIPELINE_SYNC_KEYS, type PipelineSyncKey } from "@/lib/applications/settingsFixtures";
import { copyByName, statesByStage, type StateMap } from "@/lib/salesSettings/stageMapChecks";
import type { PipelineOption } from "@/lib/salesSettings/stageMap";
import { cn } from "@/lib/utils";

import { DialogActions, SalesDialog } from "./shared";

export type Mapping = Record<PipelineSyncKey, string | null>;
export const UNMAPPED = "Doesn't move the card";
export const PIPELINES_HREF = "/app/settings#pipelines";
const BOARD_KEY = "insurvas.pipelineSync.board";

const LABEL = Object.fromEntries(PIPELINE_SYNC_KEYS.map((k) => [k.key, k.label])) as Record<PipelineSyncKey, string>;
export const stateLabel = (key: PipelineSyncKey) => LABEL[key];

/** The board's own reading of a stage type: green won, red lost, grey open (as on Pipelines & outcomes). */
const TYPE_DOT: Record<PipelineOption["stages"][number]["stageType"], string> = { won: "bg-[var(--success)]", lost: "bg-[var(--error)]", open: "bg-[var(--muted)]" };
const TYPE_WORD: Record<PipelineOption["stages"][number]["stageType"], string> = { won: "Won", lost: "Lost", open: "Open" };

export function TypeDot({ type }: { type: PipelineOption["stages"][number]["stageType"] }) {
  return <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", TYPE_DOT[type])} />;
}

export const mappedCount = (map: StateMap) => Object.values(map).filter(Boolean).length;

/* ── the pipeline list ─────────────────────────────────────────────────── */

export type PipelineRow = { id: string; name: string; mapped: number; checks: number; dirty: boolean; noStages: boolean };

export function PipelineList({ rows, value, onPick }: { rows: PipelineRow[]; value: string | null; onPick: (id: string) => void }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-2" aria-label="Pipelines">
      {rows.map((row) => {
        const on = row.id === value;
        return (
          <li key={row.id}>
            <button
              type="button"
              aria-current={on ? "true" : undefined}
              onClick={() => onPick(row.id)}
              className={cn(
                "flex min-h-[44px] w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--ink)] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
                on ? "bg-[var(--primary-soft)]" : "hover:bg-[var(--surface-alt)]",
              )}
            >
              {/* The name on its own line, the facts under it: a long pipeline name is never cut. */}
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className={cn("break-words", on && "font-semibold")}>{row.name}</span>
                <span className="flex flex-wrap gap-1.5">
                  {row.noStages ? <StatusChip>No stages</StatusChip> : row.mapped ? <StatusChip tone="good">{row.mapped} of {PIPELINE_SYNC_KEYS.length} states</StatusChip> : <StatusChip>Moves nothing</StatusChip>}
                  {row.checks > 0 && <StatusChip tone="warning">{row.checks} to check</StatusChip>}
                  {row.dirty && <StatusChip tone="info">Unsaved</StatusChip>}
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[var(--muted)] md:hidden" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ── the board preview ─────────────────────────────────────────────────── */

/** The pipeline's stages in board order, each carrying the states that land on it. */
export function BoardPreview({ pipeline, map, flagged }: { pipeline: PipelineOption; map: Mapping; flagged: ReadonlySet<PipelineSyncKey> }) {
  const placed = useMemo(() => statesByStage(map), [map]);
  const strip = useRef<HTMLOListElement>(null);
  const firstPlaced = pipeline.stages.find((s) => placed.has(s.id))?.id ?? null;
  // Open by default (owner 2026-10-30); a collapse is this browser's choice and is remembered.
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => {
      try { if (window.localStorage.getItem(BOARD_KEY) === "closed") setOpen(false); } catch { /* storage blocked: stay open */ }
    }, 0);
    return () => window.clearTimeout(t);
  }, []);
  // A long board opens at its first stage a state lands on, not at stages nothing moves to.
  useEffect(() => {
    const list = strip.current;
    const item = firstPlaced ? list?.querySelector<HTMLElement>(`[data-stage="${firstPlaced}"]`) : null;
    if (list && item) list.scrollTo({ left: Math.max(0, item.offsetLeft - list.offsetLeft - 8), behavior: "smooth" });
  }, [firstPlaced, pipeline.id, open]);
  const toggle = () => setOpen((was) => {
    try { window.localStorage.setItem(BOARD_KEY, was ? "closed" : "open"); } catch { /* storage blocked: this visit only */ }
    return !was;
  });
  const placedCount = pipeline.stages.filter((s) => placed.has(s.id)).length;
  return (
    <div className={cn("px-4", open ? "pb-3" : "pb-2")}>
      <div className="mb-1.5 flex items-center gap-2">
        <p className="m-0 text-xs font-semibold text-[var(--body)]">On the board · {pipeline.stages.length} stages{!open && placedCount ? ` · states land on ${placedCount}` : ""}</p>
        <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 px-2 text-xs" aria-expanded={open} aria-controls={`ps-board-${pipeline.id}`} onClick={toggle}>
          {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}{open ? "Collapse" : "Show board"}
        </Button>
      </div>
      <ol id={`ps-board-${pipeline.id}`} ref={strip} hidden={!open} className="m-in m-0 flex list-none gap-2 overflow-x-auto p-0.5 pb-2" aria-label={`${pipeline.name} stages, in board order`}>
        {pipeline.stages.map((stage) => {
          const keys = placed.get(stage.id) ?? [];
          return (
            <li key={stage.id} data-stage={stage.id} className={cn("m-glass-inset flex min-h-[76px] w-[116px] shrink-0 flex-col gap-1.5 rounded-lg border p-2", keys.length ? "border-[var(--border-strong)]" : "border-[var(--border)]")}>
              <span className="flex items-start gap-1.5 text-xs font-semibold leading-[1.3] text-[var(--ink)]" title={`${stage.name} · ${TYPE_WORD[stage.stageType]} stage`}>
                <span className="mt-1"><TypeDot type={stage.stageType} /></span>
                <span className="line-clamp-2">{stage.name}</span>
              </span>
              {keys.map((key) => (
                <span key={key} className={cn("m-in rounded-md px-1.5 py-1 text-xs font-semibold leading-tight", flagged.has(key) ? "bg-[var(--warning-surface)] text-[var(--warning-ink)]" : "bg-[var(--primary-soft)] text-[var(--accent-ink)]")}>
                  {stateLabel(key)}
                </span>
              ))}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ── the stage picker ──────────────────────────────────────────────────── */

export function StagePicker({ id, stateKey, pipeline, map, disabled, onChange }: {
  id: string;
  stateKey: PipelineSyncKey;
  pipeline: PipelineOption;
  map: Mapping;
  disabled: boolean;
  onChange: (stageId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const value = map[stateKey];
  const index = value ? pipeline.stages.findIndex((s) => s.id === value) : -1;
  const stage = index >= 0 ? pipeline.stages[index] : null;
  const archived = Boolean(value && !stage);
  const others = useMemo(() => statesByStage(map), [map]);
  const pick = (next: string | null) => { onChange(next); setOpen(false); };

  const face = stage ? (
    <><TypeDot type={stage.stageType} /><span className="min-w-0 flex-1 truncate">{stage.name}</span><span className="shrink-0 text-xs text-[var(--body)]">{TYPE_WORD[stage.stageType]} · {index + 1} of {pipeline.stages.length}</span></>
  ) : archived ? (
    <span className="min-w-0 flex-1 truncate text-[var(--warning-ink)]">A stage that was archived</span>
  ) : (
    <span className="min-w-0 flex-1 truncate text-[var(--body)]">{UNMAPPED}</span>
  );

  if (disabled) return <div id={id} className={cn(control, "mt-0 flex items-center gap-2")}>{face}</div>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button id={id} type="button" className={cn(control, "mt-0 flex items-center gap-2 text-left", !value && "border-dashed", archived && "border-[var(--warning)]")} aria-label={`${stateLabel(stateKey)}: ${stage?.name ?? (archived ? "a stage that was archived" : UNMAPPED)}. Change`}>
          {face}
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-[var(--muted)]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(340px,calc(100vw-32px))] p-1.5">
        <p className="m-0 px-2.5 pb-1 pt-1.5 text-xs font-semibold text-[var(--body)]">{pipeline.name} · board order</p>
        <div role="listbox" aria-label={`Stage for ${stateLabel(stateKey)}`} className="flex flex-col">
          <Option selected={!value} onPick={() => pick(null)}>
            <span className="w-6 shrink-0" />
            <span className="flex-1 text-[var(--body)]">{UNMAPPED}</span>
          </Option>
          {pipeline.stages.map((s, i) => {
            const shared = (others.get(s.id) ?? []).filter((k) => k !== stateKey);
            return (
              <Option key={s.id} selected={s.id === value} onPick={() => pick(s.id)}>
                <span className="w-6 shrink-0 text-xs tabular-nums text-[var(--body)]">{i + 1}</span>
                <TypeDot type={s.stageType} />
                <span className="min-w-0 flex-1 truncate">{s.name}</span>
                {/* The states already landing here, drawn like the board preview's chips. */}
                {shared.map((k) => <span key={k} className="shrink-0 rounded-md bg-[var(--primary-soft)] px-1.5 py-0.5 text-xs font-semibold text-[var(--accent-ink)]">{stateLabel(k)}</span>)}
              </Option>
            );
          })}
        </div>
        <div className="mt-1 border-t border-[var(--border)] pt-1">
          <Link href={PIPELINES_HREF} className="flex min-h-9 items-center gap-2 rounded-md px-2.5 text-sm font-semibold text-[var(--accent-ink)] hover:bg-[var(--surface-alt)]">
            <Plus aria-hidden="true" className="size-4" />Add a stage in Pipelines &amp; outcomes
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Option({ selected, onPick, children }: { selected: boolean; onPick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="option" aria-selected={selected} onClick={onPick} className={cn("flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm text-[var(--ink)] outline-none hover:bg-[var(--surface-alt)] focus-visible:bg-[var(--surface-alt)]", selected && "bg-[var(--primary-soft)] font-semibold")}>
      {children}
      {selected && <Check aria-hidden="true" className="size-4 shrink-0 text-[var(--accent-ink)]" />}
    </button>
  );
}

/* ── Fill in ───────────────────────────────────────────────────────────── */

export function FillMenu({ matches, canCopy, canClear, canReset, onMatch, onCopy, onClear, onReset }: {
  matches: number;
  canCopy: boolean;
  canClear: boolean;
  /** This pipeline has unsaved changes: offer to put just this one back as saved. */
  canReset: boolean;
  onMatch: () => void;
  onCopy: () => void;
  onClear: () => void;
  onReset: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline"><Wand2 aria-hidden="true" />Fill in<ChevronDown aria-hidden="true" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        <DropdownMenuItem disabled={!matches} onSelect={onMatch} title={matches ? undefined : "No stage here carries a state's name"}>
          <span className="flex-1">Match stage names</span><span className="text-xs text-[var(--body)]">{matches ? `${matches} found` : "none found"}</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!canCopy} onSelect={onCopy} title={canCopy ? undefined : "No other pipeline has a map yet"}>Copy from another pipeline…</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!canReset} onSelect={onReset} title={canReset ? undefined : "Nothing here has changed since it was saved"}>Undo this pipeline&apos;s changes</DropdownMenuItem>
        <DropdownMenuItem variant="destructive" disabled={!canClear} onSelect={onClear}>Clear this pipeline</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ── Copy from another pipeline ────────────────────────────────────────── */

export function CopyDialog({ open, onOpenChange, target, sources, current, onCopy }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: PipelineOption;
  /** The other pipelines and the map each would give (its draft, else what is saved). */
  sources: { pipeline: PipelineOption; map: Mapping }[];
  current: Mapping;
  onCopy: (map: Mapping) => void;
}) {
  const [from, setFrom] = useState<string>("");
  const source = sources.find((s) => s.pipeline.id === from) ?? sources[0];
  const result = source ? copyByName(source.pipeline, source.map, target, current) : null;
  const stageName = (key: PipelineSyncKey) => target.stages.find((s) => s.id === result?.map[key])?.name;

  return (
    <SalesDialog open={open} onOpenChange={onOpenChange} title={`Copy a map into ${target.name}`} description="Stages are matched by name. A state with no stage of the same name here stays as it is.">
      {source && result ? (
        <div className="flex flex-col gap-4">
          <label className="block text-sm font-medium text-[var(--ink)]">
            Copy from
            <select className={cn(control, "w-full")} value={source.pipeline.id} onChange={(e) => setFrom(e.target.value)}>
              {sources.map((s) => <option key={s.pipeline.id} value={s.pipeline.id}>{s.pipeline.name} · {mappedCount(s.map)} of {PIPELINE_SYNC_KEYS.length}</option>)}
            </select>
          </label>
          <ul className="m-glass-inset m-0 flex list-none flex-col gap-1.5 rounded-lg border border-[var(--border)] p-3 text-sm text-[var(--ink)]">
            {result.found.map((key) => <li key={key} className="flex items-center gap-2"><Check aria-hidden="true" className="size-4 text-[var(--success)]" />{stateLabel(key)} → <b>{stageName(key)}</b></li>)}
            {result.missing.map((key) => <li key={key} className="text-[var(--body)]">{stateLabel(key)}: no stage named “{source.pipeline.stages.find((s) => s.id === source.map[key])?.name}” here</li>)}
            {!result.found.length && !result.missing.length && <li className="text-[var(--body)]">{source.pipeline.name} moves nothing yet.</li>}
          </ul>
        </div>
      ) : (
        <p className="m-0 text-sm text-[var(--body)]">No other pipeline has a map yet.</p>
      )}
      <DialogActions>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button type="button" disabled={!result?.found.length} onClick={() => { if (result) onCopy(result.map); onOpenChange(false); }}>
          {result?.found.length ? `Copy ${result.found.length} ${result.found.length === 1 ? "state" : "states"}` : "Nothing to copy"}
        </Button>
      </DialogActions>
    </SalesDialog>
  );
}
