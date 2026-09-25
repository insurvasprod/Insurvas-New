"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Check, Loader2 } from "lucide-react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { PipelineStage } from "@/lib/pipelines/types";
import type { PipelineViewContext } from "@/lib/pipelines/views";
import { cn } from "@/lib/utils";

/**
 * Editing a pipeline's stages from the board they describe — the board's stage manager overlay
 * (p-ov-stage-manager): one row per stage with what it means, how many dispositions land on it and
 * how many leads sit in it, and behind each row the stage editor (StageEditor).
 *
 * It writes through the same owner-only routes Settings uses (`/api/app/pipelines/…`), plus
 * `/api/app/leads/pipeline-rules` for the two rules migration 20260925100000 adds (time allowed,
 * counts as worked). Nothing new is permitted, only nearer.
 *
 * Reorder is up/down buttons, not drag: reachable from a keyboard and a touch screen. The whole
 * ordered set is sent, so two people editing at once cannot leave a gap (LA-1.9 criterion 3).
 *
 * A stage is never deleted — it is archived, and archiving is refused here while leads sit on it:
 * move them first, by disposition, so their history says where they went and why.
 */

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string;
  pipelineName: string;
  stages: PipelineStage[];
  /** Called after any successful write so the board reloads with the new shape. */
  onChanged: () => void;
  /** Leads sitting on each stage, by stage id. */
  leadCounts?: Record<string, number>;
  /** When each lead on a stage entered it (null before it was stamped), by stage id. */
  stageEntries?: Record<string, Array<string | null>>;
  context?: PipelineViewContext | null;
  /** Every pipeline's stages, so a disposition's current stage can be named when it is moved here. */
  allStages?: Array<{ id: string; name: string; pipelineName: string }>;
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const SWATCHES = ["#e04e00", "#4457c7", "#2f7d31", "#0091a8", "#b02a9b", "#59606b", "#c62828", "#b35c00"];
const UNITS = [{ value: 1, label: "minutes" }, { value: 60, label: "hours" }, { value: 1440, label: "days" }] as const;

async function request(url: string, method: string, payload: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => null);
    return response.ok ? { ok: true } : { ok: false, error: body?.error ?? "That change could not be saved." };
  } catch {
    return { ok: false, error: "That change could not be saved. Check your connection and try again." };
  }
}

function splitMinutes(minutes: number | null | undefined) {
  if (!minutes) return { amount: "", unit: 1 as number };
  if (minutes % 1440 === 0) return { amount: String(minutes / 1440), unit: 1440 };
  if (minutes % 60 === 0) return { amount: String(minutes / 60), unit: 60 };
  return { amount: String(minutes), unit: 1 };
}

// ── the editor behind a row ─────────────────────────────────────────────────────────────────

function StageEditor({ pipelineId, pipelineName, stage, ordered, leadCount, entries, context, allStages, onDone, onChanged }: {
  pipelineId: string; pipelineName: string; stage: PipelineStage; ordered: PipelineStage[]; leadCount: number; entries: Array<string | null>;
  context: PipelineViewContext | null; allStages: Array<{ id: string; name: string; pipelineName: string }>;
  onDone: () => void; onChanged: () => void;
}) {
  const rule = context?.stageRules[stage.id];
  const initialTime = splitMinutes(rule?.timeAllowedMinutes);
  const [name, setName] = useState(stage.name);
  const [description, setDescription] = useState(stage.description ?? "");
  const [position, setPosition] = useState(ordered.findIndex((item) => item.id === stage.id));
  const [color, setColor] = useState(HEX.test(stage.color) ? stage.color : "#59606b");
  const [stageType, setStageType] = useState<PipelineStage["stage_type"]>(stage.stage_type);
  const [countsAsWorked, setCountsAsWorked] = useState<boolean>(rule?.countsAsWorked ?? true);
  const [timeAmount, setTimeAmount] = useState(initialTime.amount);
  const [timeUnit, setTimeUnit] = useState<number>(initialTime.unit);
  const [adding, setAdding] = useState("");
  const [saving, setSaving] = useState(false);
  const mapped = context?.dispositionsByStage[stage.id] ?? [];
  // Every active outcome not already here: the unmapped first, then those that would move from another stage.
  const library = [
    ...(context?.unmapped ?? []).map((entry) => ({ key: entry.key, label: entry.label, from: null as string | null })),
    ...Object.entries(context?.dispositionsByStage ?? {}).filter(([stageId]) => stageId !== stage.id).flatMap(([stageId, options]) => options.map((option) => ({ key: option.key, label: option.label, from: stageId }))),
  ];
  const addingFrom = library.find((entry) => entry.key === adding)?.from;
  const addingFromName = addingFrom ? allStages.find((item) => item.id === addingFrom) : null;
  const minutes = timeAmount.trim() ? Math.round(Number(timeAmount) * timeUnit) : null;
  const timeInvalid = minutes !== null && (!Number.isFinite(minutes) || minutes < 1 || minutes > 525600);
  const nameTaken = ordered.some((item) => item.id !== stage.id && item.name.trim().toLowerCase() === name.trim().toLowerCase());
  // Measured against the time being typed, so the owner sees the effect before saving. A lead with no
  // entry time yet (before 20260925100000 stamped it) is never counted past it — it is counted apart.
  const [now] = useState(() => Date.now());
  const pastNow = minutes && !timeInvalid ? entries.filter((at) => at && now - Date.parse(at) > minutes * 60_000).length : 0;
  const unstamped = entries.filter((at) => !at).length;

  async function save() {
    if (!name.trim() || nameTaken || timeInvalid) return;
    setSaving(true);
    const failures: string[] = [];
    const patch: Record<string, unknown> = {};
    if (name.trim() !== stage.name) patch.name = name.trim();
    if (color !== stage.color) patch.color = color;
    if (stageType !== stage.stage_type) patch.stage_type = stageType;
    if ((description.trim() || null) !== (stage.description ?? null)) patch.description = description.trim();
    if (Object.keys(patch).length) { const result = await request(`/api/app/pipelines/${pipelineId}/stages/${stage.id}`, "PATCH", patch); if (!result.ok) failures.push(result.error!); }
    if (context?.schemaReady && (minutes !== (rule?.timeAllowedMinutes ?? null) || countsAsWorked !== (rule?.countsAsWorked ?? true))) {
      const result = await request("/api/app/leads/pipeline-rules", "PATCH", { kind: "stage", stage_id: stage.id, time_allowed_minutes: minutes, counts_as_worked: countsAsWorked });
      if (!result.ok) failures.push(result.error!);
    }
    const currentIndex = ordered.findIndex((item) => item.id === stage.id);
    if (position !== currentIndex) {
      const next = ordered.filter((item) => item.id !== stage.id);
      next.splice(position, 0, stage);
      const result = await request(`/api/app/pipelines/${pipelineId}/stages/reorder`, "POST", { stage_ids: next.map((item) => item.id) });
      if (!result.ok) failures.push(result.error!);
    }
    setSaving(false);
    if (failures.length) notify.block(failures[0]); else { notify.done(`${name.trim()} saved`); onDone(); }
    onChanged();
  }

  async function addDisposition() {
    if (!adding) return;
    setSaving(true);
    const result = await request("/api/app/pipelines/dispositions", "POST", { stage_id: stage.id, disposition_key: adding });
    setSaving(false);
    if (!result.ok) { notify.block(result.error!); return; }
    notify.done("Disposition mapped to this stage");
    setAdding("");
    onChanged();
  }

  async function archive() {
    setSaving(true);
    const result = await request(`/api/app/pipelines/${pipelineId}/stages/${stage.id}`, "PATCH", { is_archived: true });
    setSaving(false);
    if (!result.ok) { notify.block(result.error!); return; }
    notify.done(`${stage.name} archived`);
    onDone();
    onChanged();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">{pipelineName} · stage {ordered.findIndex((item) => item.id === stage.id) + 1} of {ordered.length}</p>
          <h3 className="mt-1 text-lg font-semibold">{stage.name}</h3>
          <p className="text-sm text-muted-foreground">What this stage means, how long a lead may sit in it, and which dispositions belong to it.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="h-9 border-[var(--border-strong)] px-4" onClick={onDone} disabled={saving}>Cancel</Button>
          <Button type="button" className="h-9 px-4" onClick={() => void save()} disabled={saving || !name.trim() || nameTaken || timeInvalid}>{saving ? <Loader2 className="size-4 animate-spin" /> : null}Save stage</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <section className="rounded-lg border border-border p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">Identity</p>
            <div className="mt-3 flex gap-3">
              <label className="flex-grow text-sm font-semibold">Stage name<Input className="mt-1" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
              <label className="w-24 text-sm font-semibold">Position
                <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal" value={position} onChange={(event) => setPosition(Number(event.target.value))}>
                  {ordered.map((_, index) => <option key={index} value={index}>{index + 1} of {ordered.length}</option>)}
                </select>
              </label>
            </div>
            {nameTaken && <p className="mt-1 text-xs font-semibold text-[var(--error-ink)]">Another stage in this pipeline already has that name.</p>}
            <p className="mt-1 text-xs text-muted-foreground">Scoped to {pipelineName}; a stage with the same name in another pipeline is untouched.</p>
            <label className="mt-3 block text-sm font-semibold">What it means<Input className="mt-1" value={description} maxLength={200} placeholder="A human answered" onChange={(event) => setDescription(event.target.value)} /></label>
            <p className="mt-3 text-sm font-semibold">Colour on the board</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {SWATCHES.map((swatch) => <button key={swatch} type="button" aria-label={`Colour ${swatch}`} aria-pressed={color.toLowerCase() === swatch} onClick={() => setColor(swatch)} className={cn("size-7 rounded-md border", color.toLowerCase() === swatch ? "border-2 border-foreground" : "border-border")} style={{ background: swatch }} />)}
            </div>
          </section>

          <section className="rounded-lg border border-border p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">Meaning</p>
            <label className="mt-3 flex items-start justify-between gap-3 text-sm">
              <span><span className="block font-semibold">Counts as worked</span><span className="block text-xs text-muted-foreground">Feeds the agent scorecard and the partner&rsquo;s worked rate.</span></span>
              <input type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" checked={countsAsWorked} disabled={!context?.schemaReady} onChange={(event) => setCountsAsWorked(event.target.checked)} />
            </label>
            <label className="mt-3 block border-t border-border pt-3 text-sm font-semibold">Terminal stage
              <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal" value={stageType} onChange={(event) => setStageType(event.target.value as PipelineStage["stage_type"])}>
                <option value="open">No — work continues</option>
                <option value="won">Yes — a sale</option>
                <option value="lost">Yes — closed, no sale</option>
              </select>
            </label>
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-sm font-semibold">Time allowed in this stage</p>
              <div className="mt-1 flex items-center gap-2">
                <Input type="number" min={1} className="w-20" value={timeAmount} placeholder="—" disabled={!context?.schemaReady} onChange={(event) => setTimeAmount(event.target.value)} aria-label="Time allowed amount" />
                <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={timeUnit} disabled={!context?.schemaReady} onChange={(event) => setTimeUnit(Number(event.target.value))} aria-label="Time allowed unit">
                  {UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                </select>
              </div>
              {timeInvalid && <p className="mt-1 text-xs font-semibold text-[var(--error-ink)]">Between 1 minute and 365 days.</p>}
              <p className="mt-1 text-xs text-muted-foreground">Past this, the lead turns red on the board, the table and the list. It never moves on its own. Leave empty for no limit.</p>
              {!context?.schemaReady && <p className="mt-1 text-xs font-semibold text-[var(--warning-ink)]">Needs the database update 20260925100000.</p>}
            </div>
          </section>

          <section className="rounded-lg border border-border border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-4 text-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.02em] text-[var(--error-ink)]">Archiving this stage</p>
            {leadCount > 0 ? (
              <p className="mt-2 text-[var(--body)]"><strong className="text-[var(--error-ink)]">Refused while {leadCount} {leadCount === 1 ? "lead sits" : "leads sit"} here.</strong> Move them first — Table view, select them, Change stage — so each one&rsquo;s history says where it went and why.</p>
            ) : (
              <p className="mt-2 text-[var(--body)]">No lead sits here. Archiving takes the stage off the board and every picker; leads that passed through keep it in their history.</p>
            )}
            <Button type="button" variant="outline" className="mt-3 h-9 w-full border-[var(--border-strong)]" disabled={saving || leadCount > 0 || ordered.length === 1} title={ordered.length === 1 ? "A pipeline needs at least one stage" : undefined} onClick={() => void archive()}>
              {leadCount > 0 ? "Archive — move its leads first" : "Archive stage"}
            </Button>
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <section className="overflow-hidden rounded-lg border border-border">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-[var(--surface-alt)] px-4 py-2.5">
              <span className="text-sm font-semibold">Dispositions that send a lead to {stage.name}</span>
              <span className="flex items-center gap-2">
                <select aria-label="Disposition to map here" className="h-8 max-w-[220px] rounded-md border border-input bg-background px-2 text-sm" value={adding} onChange={(event) => setAdding(event.target.value)}>
                  <option value="">Add from library…</option>
                  {library.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}{entry.from ? " (moves it here)" : ""}</option>)}
                </select>
                <Button type="button" size="sm" className="h-8 px-3" disabled={!adding || saving} onClick={() => void addDisposition()}>Map</Button>
              </span>
            </div>
            {addingFromName && <p className="border-b border-border bg-[var(--warning-surface)] px-4 py-2 text-xs text-[var(--warning-ink)]">This disposition currently sends leads to {addingFromName.name} ({addingFromName.pipelineName}). Each outcome has one stage, so mapping it here moves it from there — for every future use.</p>}
            {mapped.length ? mapped.map((option) => (
              <div key={option.key} className="flex items-center gap-3 border-t border-border px-4 py-2.5 first-of-type:border-t-0">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-alt)] px-2.5 py-[3px] text-xs font-semibold"><span className="size-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />{option.label}</span>
                <span className="flex-grow text-xs text-[var(--body)]">{option.nextAction === "retry" ? `Retries after ${option.nextActionMinutes ?? "?"} min` : option.nextAction === "callback" ? "Books a callback" : option.nextAction === "suppress" ? "Adds the number to do-not-call" : option.nextAction === "close" ? "Ends dialing" : option.nextAction === "rest" ? "Rests the lead" : "Follows the cadence"}</span>
                <span className="text-xs font-semibold text-muted-foreground">→ {stage.name}</span>
              </div>
            )) : <p className="px-4 py-4 text-sm text-muted-foreground">No disposition sends a lead here yet, so this stage cannot be entered from the board, table or list.</p>}
            <p className="border-t border-border bg-[var(--canvas)] px-4 py-2.5 text-xs text-[var(--body)]">To stop a disposition sending leads here, map it to another stage — or retire it in Settings › Dispositions. A retired outcome keeps its history.</p>
          </section>

          <section className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.02em] text-[var(--warning-ink)]">What changes when you save</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <span>
                <span className={cn("block text-lg font-semibold tabular-nums", pastNow ? "text-[var(--error-ink)]" : "")}>{minutes ? pastNow : leadCount}</span>
                <span className="block text-xs text-[var(--body)]">{minutes ? `of ${leadCount} ${leadCount === 1 ? "lead" : "leads"} here would be past ${timeAmount} ${UNITS.find((unit) => unit.value === timeUnit)?.label} now — they turn red, none moves${unstamped ? `; ${unstamped} with no entry time yet are not counted` : ""}` : `${leadCount === 1 ? "lead sits" : "leads sit"} here; with no time allowed, none turns red`}</span>
              </span>
              <span><span className="block text-lg font-semibold tabular-nums">{mapped.length}</span><span className="block text-xs text-[var(--body)]">{mapped.length === 1 ? "disposition keeps" : "dispositions keep"} sending leads here</span></span>
              <span><span className="block text-lg font-semibold tabular-nums">0</span><span className="block text-xs text-[var(--body)]">recorded outcomes rewritten — history keeps the stage each move was recorded with</span></span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ── the overlay ─────────────────────────────────────────────────────────────────────────────

export function PipelineStageManager({ open, onOpenChange, pipelineId, pipelineName, stages, onChanged, leadCounts = {}, stageEntries = {}, context = null, allStages = [] }: Props) {
  const [working, setWorking] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const ordered = useMemo(() => [...stages].filter((stage) => !stage.is_archived).sort((a, b) => a.position - b.position), [stages]);
  const editingStage = ordered.find((stage) => stage.id === editing) ?? null;

  async function move(index: number, delta: -1 | 1) {
    const next = [...ordered];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setWorking("reorder");
    const result = await request(`/api/app/pipelines/${pipelineId}/stages/reorder`, "POST", { stage_ids: next.map((stage) => stage.id) });
    setWorking(null);
    if (!result.ok) notify.block(result.error!); else { notify.done("Stage order saved"); onChanged(); }
  }

  async function addStage(event: React.FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (ordered.some((stage) => stage.name.trim().toLowerCase() === name.toLowerCase())) { notify.block("Two stages in one pipeline cannot share a name."); return; }
    setWorking("create");
    const result = await request(`/api/app/pipelines/${pipelineId}/stages`, "POST", { name, stage_type: "open", color: "#59606b" });
    setWorking(null);
    if (!result.ok) { notify.block(result.error!); return; }
    notify.done(`${name} added to ${pipelineName}`);
    setNewName("");
    onChanged();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) setEditing(null); onOpenChange(next); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{editingStage ? "Edit a stage" : `Stages · ${pipelineName}`}</DialogTitle>
          <DialogDescription>{editingStage ? "Changes apply to this pipeline only." : "What each stage means, the dispositions that send a lead to it, and how many leads sit in it now."}</DialogDescription>
        </DialogHeader>

        {editingStage ? (
          <StageEditor
            pipelineId={pipelineId}
            pipelineName={pipelineName}
            stage={editingStage}
            ordered={ordered}
            leadCount={leadCounts[editingStage.id] ?? 0}
            entries={stageEntries[editingStage.id] ?? []}
            context={context}
            allStages={allStages}
            onDone={() => setEditing(null)}
            onChanged={onChanged}
          />
        ) : (
          <>
            {/* relative: the sr-only header labels are absolutely positioned, and would otherwise escape the
                clipping and widen the dialog on a phone. */}
            <section className="relative min-w-0 overflow-hidden rounded-lg border border-border">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-[var(--surface-alt)] px-4 py-3">
                <span className="text-sm font-semibold">Stages · {pipelineName}</span>
                <form onSubmit={addStage} className="flex items-center gap-2">
                  <Input aria-label="New stage name" className="h-8 w-44" value={newName} maxLength={120} placeholder="New stage" onChange={(event) => setNewName(event.target.value)} />
                  <Button type="submit" variant="outline" size="sm" className="h-8 border-[var(--border-strong)] px-3" disabled={working !== null || !newName.trim()}>{working === "create" ? <Loader2 className="size-4 animate-spin" /> : null}Add a stage</Button>
                </form>
              </div>
              <div className="overflow-x-auto">
                <table className="portal-lead-table w-full min-w-[640px]! text-left text-sm">
                  <thead>
                    <tr>
                      <th className="w-[72px]"><span className="sr-only">Order</span></th>
                      <th className="w-[220px]">Stage</th>
                      <th>Means</th>
                      <th className="w-[120px] text-right">Dispositions</th>
                      <th className="w-[90px] text-right">Leads</th>
                      <th className="w-[80px]"><span className="sr-only">Edit</span></th>
                    </tr>
                  </thead>
                  <tbody className="m-seq">
                    {ordered.map((stage, index) => (
                      <tr key={stage.id} className="m-row">
                        <td>
                          <span className="flex gap-0.5">
                            <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={`Move ${stage.name} earlier`} disabled={index === 0 || working !== null} onClick={() => void move(index, -1)}><ArrowUp className="size-3.5" aria-hidden="true" /></Button>
                            <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={`Move ${stage.name} later`} disabled={index === ordered.length - 1 || working !== null} onClick={() => void move(index, 1)}><ArrowDown className="size-3.5" aria-hidden="true" /></Button>
                          </span>
                        </td>
                        <td><span className="inline-flex items-center gap-2 font-semibold"><span className="size-2 rounded-full" style={{ background: stage.color }} aria-hidden="true" />{stage.name}</span></td>
                        <td className="text-[var(--body)]">{stage.description || (stage.stage_type === "won" ? "A sale — closes the lead" : stage.stage_type === "lost" ? "Closed without a sale" : index === 0 ? "Where new leads arrive" : "—")}</td>
                        <td className={cn("text-right tabular-nums", index > 0 && !(context?.dispositionsByStage[stage.id]?.length) && context ? "font-semibold text-[var(--warning-ink)]" : "")}>{context ? context.dispositionsByStage[stage.id]?.length ?? 0 : "—"}</td>
                        <td className="text-right tabular-nums">{(leadCounts[stage.id] ?? 0).toLocaleString()}</td>
                        <td className="text-right"><Button type="button" variant="outline" size="sm" className="h-8 border-[var(--border-strong)] px-3" onClick={() => setEditing(stage.id)}>Edit</Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-border bg-[var(--canvas)] px-4 py-2.5 text-xs text-[var(--body)]">Use the arrows to reorder; positions are renumbered together, so two people editing at once cannot leave a gap. A stage no disposition lands on cannot be entered from the board.</p>
            </section>
            <div className="flex justify-end">
              <Button type="button" className="h-9 px-4" onClick={() => onOpenChange(false)}><Check className="size-4" />Done</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── New pipeline ────────────────────────────────────────────────────────────────────────────

type DraftStage = { key: string; name: string; stage_type: PipelineStage["stage_type"]; color: string; description: string };
const PARTNER_OPTIONS = [
  { value: "", label: "No partner type — imports and vendor posts" },
  { value: "publisher", label: "Publishers — live transfers" },
  { value: "marketing", label: "Marketing partners — campaigns" },
  { value: "affiliate", label: "Affiliates — tracked links" },
] as const;
const STEPS = ["Source", "Stages", "Dispositions", "Routing", "Review"] as const;
let draftKey = 0;
const nextKey = () => `stage-${++draftKey}`;

/**
 * The new-pipeline wizard (NewPipeline): source, stages, dispositions, routing, review — then it
 * goes live. With migration 20260925100000 it is created as a draft first, so agents never see a
 * half-built pipeline and no lead is routed into it until the last step; before that update it is
 * created live but never a default, which routes nothing into it either.
 */
export function PipelineCreateDialog({
  open, onOpenChange, onCreated, pipelines = [], context = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (pipelineId: string) => void;
  pipelines?: Array<{ id: string; name: string; stages: PipelineStage[] }>;
  context?: PipelineViewContext | null;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [partnerType, setPartnerType] = useState("");
  const [copyFrom, setCopyFrom] = useState<string>("empty");
  const [stages, setStages] = useState<DraftStage[]>([
    { key: nextKey(), name: "New", stage_type: "open", color: "#59606b", description: "" },
    { key: nextKey(), name: "Won", stage_type: "won", color: "#2f7d31", description: "" },
  ]);
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [makeDefault, setMakeDefault] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const lowerNames = stages.map((stage) => stage.name.trim().toLowerCase());
  const duplicate = lowerNames.find((value, index) => value && lowerNames.indexOf(value) !== index);
  const blank = stages.some((stage) => !stage.name.trim());
  const terminal = stages.some((stage) => stage.stage_type !== "open");
  const stageProblems = [blank && "give every stage a name", duplicate && `rename one of the two “${stages.find((stage) => stage.name.trim().toLowerCase() === duplicate)?.name}” stages`, !terminal && "mark at least one stage terminal"].filter(Boolean) as string[];
  const library = [
    ...(context?.unmapped ?? []).map((entry) => ({ key: entry.key, label: entry.label, from: null as string | null })),
    ...Object.entries(context?.dispositionsByStage ?? {}).flatMap(([stageId, options]) => options.map((option) => ({ key: option.key, label: option.label, from: stageId }))),
  ];
  const stageNameById = new Map(pipelines.flatMap((pipeline) => pipeline.stages.map((stage) => [stage.id, `${stage.name} (${pipeline.name})`] as const)));
  const assignedKeys = new Set(Object.values(assignments).flat());
  const unentered = stages.slice(1).filter((stage) => !(assignments[stage.key]?.length));

  function reset() { setStep(0); setName(""); setPartnerType(""); setCopyFrom("empty"); setAssignments({}); setMakeDefault(false); }
  function applyCopy(source: string) {
    setCopyFrom(source);
    const pipeline = pipelines.find((item) => item.id === source);
    if (!pipeline) return;
    setStages(pipeline.stages.filter((stage) => !stage.is_archived).sort((a, b) => a.position - b.position).map((stage) => ({ key: nextKey(), name: stage.name, stage_type: stage.stage_type, color: HEX.test(stage.color) ? stage.color : "#59606b", description: stage.description ?? "" })));
    setAssignments({});
  }
  function update(key: string, change: Partial<DraftStage>) { setStages((items) => items.map((item) => (item.key === key ? { ...item, ...change } : item))); }
  function moveStage(index: number, delta: -1 | 1) { setStages((items) => { const next = [...items]; const target = index + delta; if (target < 0 || target >= next.length) return items; [next[index], next[target]] = [next[target], next[index]]; return next; }); }

  async function create(goLive: boolean) {
    setSaving(goLive ? "live" : "draft");
    const fail = (message: string) => { notify.block(message); setSaving(null); };
    const created = await fetch("/api/app/pipelines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), partner_type: partnerType || null, is_default: false }) }).then(async (response) => ({ ok: response.ok, body: await response.json().catch(() => null) })).catch(() => ({ ok: false, body: null }));
    if (!created.ok) return fail(created.body?.error ?? "The pipeline could not be created.");
    const pipelineId: string = created.body?.pipeline?.id;
    // Draft first where the database supports it, so nothing half-built is ever live.
    let draft = false;
    if (context?.schemaReady) draft = (await request("/api/app/leads/pipeline-rules", "PATCH", { kind: "pipeline_status", pipeline_id: pipelineId, status: "draft" })).ok;
    const stageIds = new Map<string, string>();
    for (const stage of stages) {
      const response = await fetch(`/api/app/pipelines/${pipelineId}/stages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: stage.name.trim(), stage_type: stage.stage_type, color: stage.color, ...(stage.description.trim() ? { description: stage.description.trim() } : {}) }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) return fail(`${name.trim()} was created${draft ? " as a draft" : ""}, but the stage “${stage.name}” was refused: ${body?.error ?? "unknown error"}. Finish it from the board's stage manager.`);
      stageIds.set(stage.key, body?.stage?.id);
    }
    for (const [key, dispositionKeys] of Object.entries(assignments)) {
      for (const dispositionKey of dispositionKeys) {
        const result = await request("/api/app/pipelines/dispositions", "POST", { stage_id: stageIds.get(key), disposition_key: dispositionKey });
        if (!result.ok) return fail(`Stages were created, but mapping ${dispositionKey} was refused: ${result.error}`);
      }
    }
    if (goLive) {
      if (draft) { const live = await request("/api/app/leads/pipeline-rules", "PATCH", { kind: "pipeline_status", pipeline_id: pipelineId, status: "live" }); if (!live.ok) return fail(live.error!); }
      if (makeDefault) { const result = await request(`/api/app/pipelines/${pipelineId}`, "PATCH", { is_default: true }); if (!result.ok) return fail(`${name.trim()} is live, but could not be made the default: ${result.error}`); }
    }
    notify.done(goLive ? `${name.trim()} is live` : `${name.trim()} saved as a draft — agents do not see it`);
    setSaving(null);
    reset();
    onOpenChange(false);
    onCreated(pipelineId);
  }

  const canNext = step === 0 ? Boolean(name.trim()) : step === 1 ? stageProblems.length === 0 : true;
  const nextBlock = step === 0 && !name.trim() ? "name the pipeline" : step === 1 && stageProblems.length ? stageProblems.join(", and ") : "";

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) reset(); onOpenChange(next); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>New pipeline</DialogTitle>
          <DialogDescription>Build it step by step; nothing is live until the last one.</DialogDescription>
        </DialogHeader>

        <ol className="flex flex-wrap items-center gap-y-2 rounded-lg border border-border px-4 py-3" aria-label="Steps">
          {STEPS.map((label, index) => (
            <li key={label} className="flex flex-grow items-center" aria-current={index === step ? "step" : undefined}>
              {index > 0 && <span className={cn("mx-2 hidden h-0.5 flex-grow sm:block", index <= step ? "bg-[var(--success)]" : "bg-border")} aria-hidden="true" />}
              <span className="flex items-center gap-2">
                <span className={cn("inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold", index < step ? "bg-[var(--success)] text-white" : index === step ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "bg-[var(--surface-alt)] text-[var(--body)]")}>{index < step ? <Check className="size-3.5" /> : index + 1}</span>
                <span className={cn("text-sm font-semibold", index === step ? "text-foreground" : "text-muted-foreground")}>{label}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <section className="flex min-h-[340px] flex-col gap-4 rounded-lg border border-border p-4">
            {step === 0 && (
              <>
                <div><h3 className="text-base font-semibold">Name it, and say where its leads come from</h3><p className="text-sm text-muted-foreground">The source decides which leads can be routed here once it is live.</p></div>
                <label className="text-sm font-semibold">Name<Input className="mt-1" value={name} maxLength={120} placeholder="Aged / recycled" onChange={(event) => setName(event.target.value)} /></label>
                <label className="text-sm font-semibold">Leads from
                  <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal" value={partnerType} onChange={(event) => setPartnerType(event.target.value)}>
                    {PARTNER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </>
            )}
            {step === 1 && (
              <>
                <div><h3 className="text-base font-semibold">The stages a lead moves through</h3><p className="text-sm text-muted-foreground">Start from a pipeline you already run, or build it empty. Nothing here touches the pipeline you copy from.</p></div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {pipelines.map((pipeline) => (
                    <button key={pipeline.id} type="button" onClick={() => applyCopy(pipeline.id)} className={cn("rounded-lg border px-3 py-2.5 text-left", copyFrom === pipeline.id ? "border-2 border-[var(--primary)] bg-[var(--soft-orange-surface)]" : "border-border bg-card")}>
                      <span className="block text-sm font-semibold">Copy {pipeline.name}</span>
                      <span className="block text-xs text-muted-foreground">{pipeline.stages.filter((stage) => !stage.is_archived).length} stages</span>
                    </button>
                  ))}
                  <button type="button" onClick={() => { setCopyFrom("empty"); setStages([{ key: nextKey(), name: "", stage_type: "open", color: "#59606b", description: "" }]); setAssignments({}); }} className={cn("rounded-lg border px-3 py-2.5 text-left", copyFrom === "empty" ? "border-2 border-[var(--primary)] bg-[var(--soft-orange-surface)]" : "border-border bg-card")}>
                    <span className="block text-sm font-semibold">Start empty</span><span className="block text-xs text-muted-foreground">You add every stage</span>
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {stages.map((stage, index) => {
                    const clash = stage.name.trim() && stage.name.trim().toLowerCase() === duplicate;
                    return (
                      <div key={stage.key} className={cn("flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2", clash ? "border-[var(--error)] bg-[var(--error-surface)]" : "border-border")}>
                        <span className="flex flex-col"><button type="button" aria-label={`Move stage ${index + 1} earlier`} disabled={index === 0} onClick={() => moveStage(index, -1)} className="disabled:opacity-30"><ArrowUp className="size-3.5" /></button><button type="button" aria-label={`Move stage ${index + 1} later`} disabled={index === stages.length - 1} onClick={() => moveStage(index, 1)} className="disabled:opacity-30"><ArrowDown className="size-3.5" /></button></span>
                        <span className="inline-flex size-5 items-center justify-center rounded-full bg-[var(--surface-alt)] text-xs font-semibold">{index + 1}</span>
                        <Input aria-label={`Stage ${index + 1} name`} className="h-8 w-48" value={stage.name} maxLength={120} onChange={(event) => update(stage.key, { name: event.target.value })} />
                        <select aria-label={`Stage ${index + 1} type`} className="h-8 rounded-md border border-input bg-background px-2 text-sm" value={stage.stage_type} onChange={(event) => update(stage.key, { stage_type: event.target.value as PipelineStage["stage_type"] })}>
                          <option value="open">Work continues</option><option value="won">Terminal · a sale</option><option value="lost">Terminal · closed</option>
                        </select>
                        <span className="flex-grow" />
                        {clash && <span className="text-xs font-semibold text-[var(--error-ink)]">Two stages cannot share a name</span>}
                        <button type="button" className="text-xs font-semibold text-muted-foreground hover:text-foreground disabled:opacity-40" disabled={stages.length === 1} onClick={() => setStages((items) => items.filter((item) => item.key !== stage.key))}>Remove</button>
                      </div>
                    );
                  })}
                  <button type="button" onClick={() => setStages((items) => [...items, { key: nextKey(), name: "", stage_type: "open", color: "#59606b", description: "" }])} className="h-9 rounded-lg border border-dashed border-[var(--border-strong)] text-sm font-semibold text-muted-foreground">+ Add a stage</button>
                </div>
              </>
            )}
            {step === 2 && (
              <>
                <div><h3 className="text-base font-semibold">Which dispositions send a lead to each stage</h3><p className="text-sm text-muted-foreground">A stage no disposition lands on cannot be entered. The first stage is where leads arrive, so it needs none. Each outcome has one stage across the agency: one already used elsewhere moves here.</p></div>
                {stages.slice(1).map((stage) => (
                  <div key={stage.key} className="rounded-lg border border-border p-3">
                    <p className="text-sm font-semibold">{stage.name || "Unnamed stage"}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(assignments[stage.key] ?? []).map((key) => (
                        <button key={key} type="button" onClick={() => setAssignments((state) => ({ ...state, [stage.key]: (state[stage.key] ?? []).filter((item) => item !== key) }))} className="inline-flex items-center gap-1 rounded-full bg-[var(--surface-alt)] px-2.5 py-[3px] text-xs font-semibold">{library.find((entry) => entry.key === key)?.label ?? key} ×</button>
                      ))}
                      <select aria-label={`Add a disposition to ${stage.name}`} className="h-7 rounded-md border border-input bg-background px-2 text-xs" value="" onChange={(event) => { const key = event.target.value; if (key) setAssignments((state) => ({ ...state, [stage.key]: [...(state[stage.key] ?? []), key] })); }}>
                        <option value="">Add…</option>
                        {library.filter((entry) => !assignedKeys.has(entry.key)).map((entry) => <option key={entry.key} value={entry.key}>{entry.label}{entry.from ? ` — moves from ${stageNameById.get(entry.from) ?? "another stage"}` : ""}</option>)}
                      </select>
                    </div>
                  </div>
                ))}
                {stages.length < 2 && <p className="text-sm text-muted-foreground">A one-stage pipeline has nothing to move a lead into.</p>}
                {unentered.length > 0 && <p className="text-xs font-semibold text-[var(--warning-ink)]">{unentered.length} {unentered.length === 1 ? "stage has" : "stages have"} no disposition yet — {unentered.map((stage) => stage.name || "unnamed").join(", ")}. They can be mapped later from the stage manager.</p>}
              </>
            )}
            {step === 3 && (
              <>
                <div><h3 className="text-base font-semibold">Which leads land here</h3><p className="text-sm text-muted-foreground">A pipeline receives new leads only as the default for its source. Until then it exists and stays empty.</p></div>
                <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
                  <input type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} />
                  <span><span className="block font-semibold">{partnerType ? `Make it the default for ${PARTNER_OPTIONS.find((option) => option.value === partnerType)?.label.split(" —")[0].toLowerCase()}` : "Make it the general default — imports and vendor posts"}</span><span className="block text-xs text-muted-foreground">New leads from that source arrive on its first stage once it goes live. The current default stops receiving them; leads already there stay.</span></span>
                </label>
              </>
            )}
            {step === 4 && (
              <>
                <div><h3 className="text-base font-semibold">Review</h3><p className="text-sm text-muted-foreground">This is the funnel that will be created.</p></div>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">Name</dt><dd className="font-semibold">{name}</dd></div>
                  <div><dt className="text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">Leads from</dt><dd className="font-semibold">{PARTNER_OPTIONS.find((option) => option.value === partnerType)?.label}</dd></div>
                </dl>
                <ol className="flex flex-col gap-1.5">
                  {stages.map((stage, index) => <li key={stage.key} className="flex flex-wrap items-center gap-2 text-sm"><span className="inline-flex size-5 items-center justify-center rounded-full bg-[var(--surface-alt)] text-xs font-semibold">{index + 1}</span><span className="font-semibold">{stage.name}</span>{stage.stage_type !== "open" && <span className="text-xs text-muted-foreground">terminal</span>}<span className="text-xs text-muted-foreground">{index === 0 ? "where leads arrive" : (assignments[stage.key]?.length ?? 0) === 1 ? "1 disposition" : `${assignments[stage.key]?.length ?? 0} dispositions`}</span></li>)}
                </ol>
                <p className="text-xs text-muted-foreground">{makeDefault ? "Going live makes it the default, so new leads start arriving on its first stage." : "Not a default: it will exist and stay empty until a source points at it."}</p>
              </>
            )}

            <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <span className="text-sm text-[var(--body)]">{nextBlock ? <><strong className="text-[var(--error-ink)]">Before the next step:</strong> {nextBlock}.</> : null}</span>
              <span className="flex gap-2">
                {step > 0 && <Button type="button" variant="outline" className="h-9 border-[var(--border-strong)] px-4" disabled={saving !== null} onClick={() => setStep(step - 1)}>Back</Button>}
                {step < STEPS.length - 1 ? (
                  <Button type="button" className="h-9 px-4" disabled={!canNext} onClick={() => setStep(step + 1)}>Next</Button>
                ) : (
                  <Button type="button" className="h-9 px-4" disabled={saving !== null} onClick={() => void create(true)}>{saving === "live" ? <Loader2 className="size-4 animate-spin" /> : null}Create and go live</Button>
                )}
              </span>
            </div>
          </section>

          <aside className="flex flex-col gap-3">
            <div className="rounded-lg border border-border p-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">Still to come</p>
              <ul className="mt-2 flex flex-col gap-1.5 text-xs text-[var(--body)]">
                <li>Every stage after the first needs a disposition, or it cannot be entered.</li>
                <li>Until a source routes here, the pipeline exists and stays empty.</li>
                <li>Review shows the finished funnel before anything is created.</li>
              </ul>
            </div>
            <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] p-3 text-sm">
              <p className="font-semibold text-[var(--info-ink)]">Nothing is live yet</p>
              <p className="mt-1 text-xs text-[var(--body)]">{context?.schemaReady ? "Save it as a draft at any step: a draft never appears to agents and no lead can enter it." : "Drafts arrive with a database update (20260925100000). Until then the pipeline is created when you finish, as a non-default, so nothing routes into it."}</p>
              {context?.schemaReady && <Button type="button" variant="outline" className="mt-2 h-8 w-full border-[var(--border-strong)]" disabled={saving !== null || !name.trim() || stageProblems.length > 0} onClick={() => void create(false)}>{saving === "draft" ? <Loader2 className="size-4 animate-spin" /> : null}Save draft and close</Button>}
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Disposition library ─────────────────────────────────────────────────────────────────────

type LibraryRow = { key: string; label: string; retired: boolean; nextAction: string | null; nextActionMinutes: number | null; stageId: string | null; carrying: number; recent: number };
type LibraryFilter = "all" | "nowhere" | "advancing" | "terminal" | "retired";

function behaviourOf(row: LibraryRow, stage: { stage: PipelineStage; first: boolean } | undefined) {
  if (row.retired) return "Retired";
  if (!stage) return "Lands nowhere";
  if (stage.stage.stage_type !== "open") return "Terminal";
  if (row.nextAction === "retry") return "Retry";
  if (row.nextAction === "callback") return "Holds";
  return stage.first ? "Stays" : "Advances";
}

function minutesText(minutes: number) {
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440} ${minutes === 1440 ? "day" : "days"}`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} ${minutes === 60 ? "hour" : "hours"}`;
  return `${minutes} min`;
}

function actionSentence(row: LibraryRow) {
  switch (row.nextAction) {
    case "retry": return row.nextActionMinutes ? `Retries after ${minutesText(row.nextActionMinutes)}` : "Retries on the cadence";
    case "callback": return "Books a callback, recorded from the lead or the dialer";
    case "suppress": return "Adds the number to do-not-call, recorded from the lead or the dialer";
    case "close": return "Ends dialing";
    case "rest": return "Rests the lead";
    default: return "Follows the cadence";
  }
}

const LIBRARY_FILTERS: Array<[LibraryFilter, string]> = [["all", "All"], ["nowhere", "Lands nowhere"], ["advancing", "Advancing"], ["terminal", "Terminal"], ["retired", "Retired"]];

/**
 * The disposition library (DispositionLibrary): every outcome an agent can record, written once,
 * with what it does, the stage it sends a lead to and how often it is used; and, for the one
 * selected, where it lands, changeable in place.
 *
 * The board maps an outcome separately in each pipeline. This agency keeps one stage per outcome
 * (stage_dispositions is unique per disposition), so "where it lands" is one stage, and changing it
 * moves it for every pipeline. Creating and retiring outcomes stays in Settings › Dispositions,
 * where their cadence is edited; this screen links there rather than duplicating the form.
 */
export function DispositionLibrary({ open, onOpenChange, pipelines, context, onChanged }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelines: Array<{ id: string; name: string; stages: PipelineStage[] }>;
  context: PipelineViewContext | null;
  onChanged: () => void;
}) {
  const [rows, setRows] = useState<LibraryRow[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [saving, setSaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);

  const stageById = useMemo(() => {
    const map = new Map<string, { stage: PipelineStage; pipelineName: string; first: boolean }>();
    for (const pipeline of pipelines) {
      const live = pipeline.stages.filter((stage) => !stage.is_archived).sort((a, b) => a.position - b.position);
      live.forEach((stage, index) => map.set(stage.id, { stage, pipelineName: pipeline.name, first: index === 0 }));
    }
    return map;
  }, [pipelines]);

  async function load() {
    setError("");
    try {
      const response = await fetch("/api/app/leads/pipeline-context?library=1", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.error ?? "Could not load the disposition library."); return; }
      setRows(body.library ?? []);
    } catch { setError("Could not load the disposition library. Check your connection and try again."); }
  }
  // Read fresh each time it opens: another owner may have mapped or retired something meanwhile.
  if (open !== wasOpen) { setWasOpen(open); if (open) void load(); }

  const counted = (rows ?? []).map((row) => ({ row, stage: row.stageId ? stageById.get(row.stageId) : undefined }));
  const behaviourCount = (name: string) => counted.filter(({ row, stage }) => behaviourOf(row, stage) === name).length;
  const counts: Record<LibraryFilter, number> = {
    all: counted.filter(({ row }) => !row.retired).length,
    nowhere: behaviourCount("Lands nowhere"),
    advancing: behaviourCount("Advances"),
    terminal: behaviourCount("Terminal"),
    retired: behaviourCount("Retired"),
  };
  const needle = search.trim().toLowerCase();
  const shown = counted
    .filter(({ row, stage }) => {
      const behaviour = behaviourOf(row, stage);
      if (filter === "all" && row.retired) return false;
      if (filter === "nowhere" && behaviour !== "Lands nowhere") return false;
      if (filter === "advancing" && behaviour !== "Advances") return false;
      if (filter === "terminal" && behaviour !== "Terminal") return false;
      if (filter === "retired" && !row.retired) return false;
      return !needle || row.label.toLowerCase().includes(needle) || row.key.includes(needle);
    })
    // The ones with nowhere to land first: they are the ones leaving leads where they were.
    .sort((a, b) => Number(Boolean(a.stage) || a.row.retired) - Number(Boolean(b.stage) || b.row.retired));
  const selected = shown.find(({ row }) => row.key === selectedKey) ?? shown[0] ?? null;
  const retiredCarrying = counted.filter(({ row }) => row.retired).reduce((sum, { row }) => sum + row.carrying, 0);
  const callPathOnly = selected ? selected.row.nextAction === "callback" || selected.row.nextAction === "suppress" : false;

  async function mapTo() {
    if (!selected || !target) return;
    setSaving(true);
    const result = await request("/api/app/pipelines/dispositions", "POST", { stage_id: target, disposition_key: selected.row.key });
    setSaving(false);
    if (!result.ok) { notify.block(result.error!); return; }
    notify.done(`${selected.row.label} now sends leads to ${stageById.get(target)?.stage.name ?? "that stage"}`);
    setTarget("");
    await load();
    onChanged();
  }

  function pick(key: string) { setSelectedKey(key); setTarget(""); }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Disposition library</DialogTitle>
          <DialogDescription>Every outcome an agent can record, written once, and the stage each one sends a lead to.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          {LIBRARY_FILTERS.map(([value, label]) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold", filter === value ? "border-foreground bg-foreground text-background" : "border-border bg-card text-[var(--body)]")}>
              {label}<span className={cn("tabular-nums", filter === value ? "" : value === "nowhere" && counts.nowhere ? "text-[var(--warning-ink)]" : "text-muted-foreground")}>{rows ? counts[value] : "…"}</span>
            </button>
          ))}
          <span className="flex-grow" />
          <Input type="search" aria-label="Search dispositions" placeholder="Search dispositions" className="h-9 w-full sm:w-56" value={search} onChange={(event) => setSearch(event.target.value)} />
          <Button asChild className="h-9 px-4"><Link href="/app/settings#dispositions">New disposition</Link></Button>
        </div>

        {error ? (
          <p className="rounded-lg border border-border p-4 text-sm text-[var(--error-ink)]">{error} <button type="button" className="font-semibold underline" onClick={() => void load()}>Try again</button></p>
        ) : !rows ? (
          <p className="p-4 text-sm text-muted-foreground">Loading the library…</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section className="overflow-hidden rounded-lg border border-border">
              <div className="overflow-x-auto">
                <table className="portal-lead-table w-full min-w-[620px]! text-left text-sm">
                  <thead><tr><th>Disposition</th><th className="w-[130px]">Behaviour</th><th>Lands on</th><th className="w-[120px] text-right">Leads carrying</th></tr></thead>
                  <tbody>
                    {shown.map(({ row, stage }) => {
                      const behaviour = behaviourOf(row, stage);
                      const isSelected = selected?.row.key === row.key;
                      return (
                        <tr key={row.key} className={cn("cursor-pointer", isSelected && "bg-[var(--soft-orange-surface)]", row.retired && "opacity-70")} onClick={() => pick(row.key)}>
                          <td><button type="button" aria-pressed={isSelected} className="text-left font-semibold text-[var(--body)]!" onClick={(event) => { event.stopPropagation(); pick(row.key); }}>{row.label}</button></td>
                          <td><span className={cn("inline-flex rounded-full px-2 py-[2px] text-xs font-semibold", behaviour === "Lands nowhere" ? "bg-[var(--warning-surface)] text-[var(--warning-ink)]" : behaviour === "Terminal" ? "bg-[var(--success-surface)] text-[var(--success-ink)]" : behaviour === "Retired" ? "bg-[var(--surface-alt)] text-muted-foreground" : "bg-[var(--surface-alt)] text-[var(--body)]")}>{behaviour}</span></td>
                          <td className={cn("text-xs", !stage && !row.retired ? "font-semibold text-[var(--warning-ink)]" : "text-[var(--body)]")}>
                            {row.retired ? "Kept for history only, cannot be picked" : stage ? <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full" style={{ background: stage.stage.color }} aria-hidden="true" />{stage.stage.name} · {stage.pipelineName}</span> : "No stage: the lead stays where it is"}
                          </td>
                          <td className="text-right tabular-nums">{row.carrying.toLocaleString()}</td>
                        </tr>
                      );
                    })}
                    {shown.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-sm text-muted-foreground">{needle ? `No disposition matches “${search.trim()}”.` : filter === "nowhere" ? "Every active disposition lands on a stage." : "Nothing here."}</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="border-t border-border bg-[var(--canvas)] px-4 py-2.5 text-xs text-[var(--body)]">A disposition is never deleted, only retired. Retiring takes it off every picker and leaves the {retiredCarrying.toLocaleString()} {retiredCarrying === 1 ? "lead" : "leads"} already carrying a retired one reading correctly.</p>
            </section>

            {selected && (
              <aside className="flex flex-col gap-3">
                <section className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">Selected</p>
                  <h3 className="mt-1 text-base font-semibold">{selected.row.label}</h3>
                  <p className="mt-1 text-sm text-[var(--body)]">{actionSentence(selected.row)}.</p>
                  <p className="mt-1 text-xs text-muted-foreground">One outcome, one stage, for every pipeline: changing where it lands changes it everywhere.</p>
                </section>
                <section className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">Where it lands</p>
                  {selected.row.retired ? (
                    <p className="mt-2 text-sm text-[var(--body)]">Retired: it cannot be recorded, so it sends no lead anywhere. Restore it in Settings › Dispositions.</p>
                  ) : (
                    <>
                      <p className="mt-2 text-sm font-semibold">
                        {selected.stage ? <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: selected.stage.stage.color }} aria-hidden="true" />{selected.stage.stage.name} <span className="font-normal text-muted-foreground">· {selected.stage.pipelineName}</span></span> : <span className="text-[var(--warning-ink)]">Nowhere: a lead given it stays where it is</span>}
                      </p>
                      <label className="mt-3 block text-sm font-semibold">{selected.stage ? "Change to" : "Map it to"}
                        <select className="mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm font-normal" value={target} onChange={(event) => setTarget(event.target.value)}>
                          <option value="">Choose a stage…</option>
                          {pipelines.filter((pipeline) => !context?.draftPipelineIds.includes(pipeline.id)).map((pipeline) => (
                            <optgroup key={pipeline.id} label={pipeline.name}>
                              {pipeline.stages.filter((stage) => !stage.is_archived && stage.id !== selected.row.stageId).sort((a, b) => a.position - b.position).map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
                            </optgroup>
                          ))}
                        </select>
                      </label>
                      <Button type="button" className="mt-2 h-9 w-full" disabled={!target || saving} onClick={() => void mapTo()}>{saving ? <Loader2 className="size-4 animate-spin" /> : null}{selected.stage ? "Move it there" : "Map it"}</Button>
                      {callPathOnly && <p className="mt-2 text-xs text-muted-foreground">Recorded only from the lead or the dialer, where its callback time or suppression is written. The board, table and list show it disabled.</p>}
                    </>
                  )}
                </section>
                <section className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">Use</p>
                  <p className="mt-2 text-sm text-[var(--body)]"><strong className="tabular-nums text-foreground">{selected.row.carrying.toLocaleString()}</strong> {selected.row.carrying === 1 ? "lead carries" : "leads carry"} it as their latest outcome; <strong className="tabular-nums text-foreground">{selected.row.recent.toLocaleString()}</strong> of those were recorded in the last 30 days.</p>
                </section>
              </aside>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
