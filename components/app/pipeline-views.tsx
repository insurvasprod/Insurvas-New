"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PipelineStage } from "@/lib/pipelines/types";
import type { MappedDisposition, PipelineViewContext, StageEvent } from "@/lib/pipelines/views";
import { cn } from "@/lib/utils";
import { dateTime, dayMonth, viewerTimeZone } from "@/lib/format/dates";

/**
 * The pipeline views beside the board: Stages (the pipeline's shape and the dispositions that land
 * on each stage), Table (dense, selectable, bulk moves) and List (grouped by stage, with a preview
 * that shows the stage history and offers the outcomes).
 *
 * One rule runs through all of them: a lead changes stage only by a disposition. Every move goes to
 * POST /api/app/leads/move, which applies the outcome, moves the lead and records the change.
 */

export type ViewLead = {
  id: string;
  pipeline_id: string;
  stage_id: string;
  values: Record<string, unknown>;
  created_at: string;
  submitter_name?: string | null;
  owner_user_id?: string | null;
  owner_name?: string | null;
  disposition?: string | null;
  disposition_at?: string | null;
  stage_entered_at?: string | null;
  monthly_premium_cents?: number | null;
};
export type ViewPipeline = { id: string; name: string; stages: PipelineStage[] };
export type ViewContext = PipelineViewContext;

/** Outcomes a board or table cannot apply: they need what only the call path collects. */
const CALL_PATH_KEYS = new Set(["callback_scheduled", "do_not_call"]);
const callPathOnly = (option: MappedDisposition) => CALL_PATH_KEYS.has(option.key) || option.nextAction === "callback" || option.nextAction === "suppress";

export function leadName(lead: ViewLead) {
  const values = lead.values;
  const full = values.full_name ?? values.name ?? [values.first_name, values.last_name].filter(Boolean).join(" ");
  return typeof full === "string" && full ? full : "Unnamed lead";
}
export function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?"; }
export function inStageMs(lead: ViewLead, now: number) { return lead.stage_entered_at && now ? Math.max(0, now - Date.parse(lead.stage_entered_at)) : null; }
export function durationLabel(ms: number | null) {
  if (ms == null) return "—";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${String(hours % 24).padStart(2, "0")}h`;
}
/** "2d 04h in stage", or — before the stage-entered time exists — "7d 06h since arrival". Never a guess dressed as the other. */
export function stageAge(lead: ViewLead, now: number) {
  const ms = inStageMs(lead, now);
  if (ms != null) return `${durationLabel(ms)} in stage`;
  return now ? `${durationLabel(Math.max(0, now - Date.parse(lead.created_at)))} since arrival` : "";
}
export function allowedLabel(minutes: number | null | undefined) {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}
export function isOverdue(lead: ViewLead, context: ViewContext | null, now: number) {
  const allowed = context?.stageRules[lead.stage_id]?.timeAllowedMinutes;
  const ms = inStageMs(lead, now);
  return Boolean(allowed && ms != null && ms > allowed * 60_000);
}
export function dispositionLabel(key: string | null | undefined, context: ViewContext | null) {
  if (!key) return null;
  for (const options of Object.values(context?.dispositionsByStage ?? {})) {
    const found = options.find((option) => option.key === key);
    if (found) return found.label;
  }
  return context?.unmapped.find((entry) => entry.key === key)?.label ?? key.replaceAll("_", " ");
}

/** The outcomes that can move a lead, grouped: those that keep it where it is, then those that move it. */
export function dispositionGroups(pipeline: ViewPipeline | undefined, currentStageId: string | null, context: ViewContext | null) {
  if (!pipeline || !context) return [];
  const live = pipeline.stages.filter((stage) => !stage.is_archived).sort((a, b) => a.position - b.position);
  const groups: Array<{ label: string; stageId: string; options: MappedDisposition[] }> = [];
  const current = live.find((stage) => stage.id === currentStageId);
  if (current && context.dispositionsByStage[current.id]?.length) groups.push({ label: `Stays in ${current.name}`, stageId: current.id, options: context.dispositionsByStage[current.id] });
  for (const stage of live) {
    if (stage.id === currentStageId) continue;
    const options = context.dispositionsByStage[stage.id];
    if (options?.length) groups.push({ label: `Moves to ${stage.name}`, stageId: stage.id, options });
  }
  return groups;
}

// ── the picker ───────────────────────────────────────────────────────────────────────────────

export function DispositionPicker({
  open, onOpenChange, title, description, groups, busy, onPick, emptyText = "No disposition lands on this stage, so a lead cannot be moved into it. An owner maps one under Settings › Dispositions.",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  groups: Array<{ label: string; options: MappedDisposition[] }>;
  busy: boolean;
  onPick: (key: string) => void;
  emptyText?: string;
}) {
  const empty = groups.every((group) => group.options.length === 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {empty ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.filter((group) => group.options.length).map((group) => (
              <div key={group.label}>
                <p className="text-xs font-semibold uppercase leading-[1.33] tracking-[0.02em] text-muted-foreground">{group.label}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {group.options.map((option) => {
                    const blocked = callPathOnly(option);
                    return (
                      <button
                        key={option.key}
                        type="button"
                        disabled={busy || blocked}
                        onClick={() => onPick(option.key)}
                        title={blocked ? "Needs the call path: record it from the lead or the dialer" : undefined}
                        className="rounded-lg border border-[var(--border-strong)] bg-card px-3 py-2 text-left text-sm font-semibold hover:bg-[var(--surface-alt)] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {option.label}
                        {blocked && <span className="block text-xs font-normal text-muted-foreground">from the lead or dialer</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">The lead goes to the stage its disposition belongs to, and the move is written to its history. A stage change with no disposition is not accepted.</p>
      </DialogContent>
    </Dialog>
  );
}

// ── shared bits ──────────────────────────────────────────────────────────────────────────────

function Chip({ className, dot, children }: { className?: string; dot?: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-xs font-semibold leading-normal", className ?? "bg-[var(--surface-alt)] text-[var(--body)]")}>
      {dot && <span className="size-1.5 shrink-0 rounded-full" style={{ background: dot }} aria-hidden="true" />}
      {children}
    </span>
  );
}

function stageMeta(stage: PipelineStage, context: ViewContext | null) {
  const rule = context?.stageRules[stage.id];
  const parts: string[] = [];
  const allowed = allowedLabel(rule?.timeAllowedMinutes);
  if (allowed) parts.push(`time allowed ${allowed}`);
  if (rule?.countsAsWorked === true) parts.push("counts as worked");
  if (rule?.countsAsWorked === false) parts.push("not worked yet");
  if (stage.stage_type === "won") parts.push("terminal · a sale");
  if (stage.stage_type === "lost") parts.push("terminal · closed");
  return parts.join(" · ");
}

// ── Stages ───────────────────────────────────────────────────────────────────────────────────

export function StagesView({ pipelines, leads, context, isOwner, now, onEditStages, onOpenLibrary = null, onNewPipeline = null }: { pipelines: ViewPipeline[]; leads: ViewLead[]; context: ViewContext | null; isOwner: boolean; now: number; onEditStages: ((pipelineId: string) => void) | null; onOpenLibrary?: (() => void) | null; onNewPipeline?: (() => void) | null }) {
  const unmappedUses = (context?.unmapped ?? []).reduce((sum, entry) => sum + entry.uses, 0);
  return (
    <div className="flex flex-col gap-5">
      {(onOpenLibrary || onNewPipeline) && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {onOpenLibrary && <Button type="button" variant="outline" className="h-9 border-[var(--border-strong)] px-4" onClick={onOpenLibrary}>Disposition library</Button>}
          {onNewPipeline && <Button type="button" className="h-9 px-4" onClick={onNewPipeline}>New pipeline</Button>}
        </div>
      )}
      {pipelines.map((pipeline) => {
        const live = pipeline.stages.filter((stage) => !stage.is_archived).sort((a, b) => a.position - b.position);
        return (
          <section key={pipeline.id} className="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgba(16,20,26,.05)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-[var(--surface-alt)] px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">{pipeline.name}{context?.draftPipelineIds.includes(pipeline.id) ? " · draft" : ""}</h2>
                <p className="text-xs text-muted-foreground">Stages in order, and the dispositions that send a lead to each.</p>
              </div>
              {onEditStages && <Button type="button" variant="outline" size="sm" className="h-8 border-[var(--border-strong)] px-3" onClick={() => onEditStages(pipeline.id)}>Add or edit stages</Button>}
            </div>
            {live.map((stage, index) => {
              const count = leads.filter((lead) => lead.stage_id === stage.id).length;
              const overdue = leads.filter((lead) => lead.stage_id === stage.id && isOverdue(lead, context, now)).length;
              const options = context?.dispositionsByStage[stage.id] ?? [];
              const meta = stageMeta(stage, context);
              return (
                <div key={stage.id} className="flex flex-col gap-3 border-t border-border px-4 py-3.5 first-of-type:border-t-0 md:flex-row md:items-start">
                  <div className="flex min-w-0 items-start gap-3 md:w-[320px] md:shrink-0">
                    <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white" style={{ background: stage.color }}>{index + 1}</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{stage.name}</span>
                      <span className="block text-xs text-muted-foreground tabular-nums">{count.toLocaleString()} {count === 1 ? "lead" : "leads"} · {options.length} {options.length === 1 ? "disposition" : "dispositions"}{overdue ? <span className="font-semibold text-[var(--error-ink)]"> · {overdue} past the time allowed</span> : null}</span>
                      {(meta || stage.description) && <span className="mt-0.5 block text-xs text-muted-foreground">{[stage.description, meta].filter(Boolean).join(" — ")}</span>}
                    </span>
                  </div>
                  <div className="flex flex-grow flex-wrap items-center gap-1.5">
                    {options.map((option) => <Chip key={option.key} dot={stage.color}>{option.label}</Chip>)}
                    {options.length === 0 && (index === 0 ? <span className="text-xs text-muted-foreground">Where new leads arrive — no disposition sends a lead back here.</span> : <span className="text-xs font-semibold text-[var(--warning-ink)]">No disposition lands here — a lead cannot be moved into this stage.</span>)}
                    {isOwner && <Link href="/app/settings#dispositions" className="text-xs font-semibold text-foreground underline-offset-4 hover:underline">+ Disposition</Link>}
                  </div>
                </div>
              );
            })}
            {live.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">This pipeline has no stages yet.</p>}
          </section>
        );
      })}

      {(context?.unmapped.length ?? 0) > 0 && (
        <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3.5 text-sm leading-normal">
          <p className="font-semibold text-[var(--warning-ink)]">{context!.unmapped.length} {context!.unmapped.length === 1 ? "disposition an agent can set has" : "dispositions an agent can set have"} no stage</p>
          <div className="mt-2 flex flex-wrap gap-1.5">{context!.unmapped.map((entry) => <Chip key={entry.key} className="bg-card text-[var(--body)]">{entry.label} · {entry.uses.toLocaleString()}</Chip>)}</div>
          <p className="mt-2 text-[var(--body)]">The agent picks one, the lead keeps the stage it already had, and every stage report is short by that many leads. {unmappedUses.toLocaleString()} recorded outcomes fall out of the funnel here.</p>
          {isOwner && <Link href="/app/settings#pipelines" className="mt-2 inline-block text-sm font-semibold text-foreground underline-offset-4 hover:underline">Map them in Settings › Pipelines</Link>}
        </div>
      )}
      {(context?.stageDrift ?? 0) > 0 && (
        <div className="rounded-lg border border-border border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] px-4 py-3.5 text-sm leading-normal">
          <p className="font-semibold text-[var(--error-ink)]">{context!.stageDrift} {context!.stageDrift === 1 ? "lead's stage disagrees" : "leads' stages disagree"} between its two records</p>
          <p className="mt-1.5 text-[var(--body)]">A lead carries a stage on its own row and on its work item. Every move from these screens writes both in one step; these were written some other way. Moving the lead with a disposition sets both again.</p>
        </div>
      )}
      {context && !context.schemaReady && (
        <p className="text-xs text-muted-foreground">Time allowed per stage, counts-as-worked and the stage history arrive with a database update (20260925100000) that has not been applied yet.</p>
      )}
    </div>
  );
}

// ── Table ────────────────────────────────────────────────────────────────────────────────────

type SavedView = "all" | "overdue" | "mine" | "unassigned";

export function TableView({
  leads, stageName, context, now, money, currentUserId, readOnly, onOpen, onBulkMove,
}: {
  leads: ViewLead[];
  stageName: (stageId: string) => { name: string; color: string; pipeline: string };
  context: ViewContext | null;
  now: number;
  money: boolean;
  currentUserId: string | null;
  readOnly: boolean;
  onOpen: (lead: ViewLead) => void;
  onBulkMove: (leadIds: string[]) => void;
}) {
  const [saved, setSaved] = useState<SavedView>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const PAGE = 25;
  const counts = {
    all: leads.length,
    overdue: leads.filter((lead) => isOverdue(lead, context, now)).length,
    mine: leads.filter((lead) => currentUserId && lead.owner_user_id === currentUserId).length,
    unassigned: leads.filter((lead) => !lead.owner_user_id).length,
  };
  const rows = useMemo(() => {
    const filtered = leads.filter((lead) => saved === "all" || (saved === "overdue" && isOverdue(lead, context, now)) || (saved === "mine" && currentUserId && lead.owner_user_id === currentUserId) || (saved === "unassigned" && !lead.owner_user_id));
    // Longest in stage first — the leads most likely to need a hand.
    return [...filtered].sort((a, b) => (inStageMs(b, now) ?? -1) - (inStageMs(a, now) ?? -1));
  }, [leads, saved, context, now, currentUserId]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages);
  const pageRows = rows.slice((current - 1) * PAGE, current * PAGE);
  const allOnPage = pageRows.length > 0 && pageRows.every((lead) => selected.has(lead.id));
  const toggle = (id: string) => setSelected((set) => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const premiumTotal = pageRows.reduce((sum, lead) => sum + (lead.monthly_premium_cents ?? 0) * 12, 0);
  const views: Array<[SavedView, string]> = [["all", "All"], ["overdue", "Overdue in stage"], ["mine", "My leads"], ["unassigned", "Unassigned"]];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Saved views">
        {views.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={saved === key} onClick={() => { setSaved(key); setPage(1); }} disabled={key === "overdue" && !context?.schemaReady} title={key === "overdue" && !context?.schemaReady ? "Needs time allowed per stage (database update 20260925100000)" : undefined} className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold disabled:opacity-50", saved === key ? "border-[var(--primary)] bg-[var(--soft-orange-surface)] text-[var(--accent-ink)]" : "border-border bg-card text-[var(--body)]")}>
            {label}<span className="tabular-nums opacity-70">{counts[key].toLocaleString()}</span>
          </button>
        ))}
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--primary)] bg-[var(--soft-orange-surface)] px-4 py-2.5 text-sm">
          <span className="font-semibold">{selected.size} {selected.size === 1 ? "lead" : "leads"} selected</span>
          <Button type="button" size="sm" className="h-8 px-3" disabled={readOnly} onClick={() => onBulkMove([...selected])}>Change stage</Button>
          <Button type="button" variant="outline" size="sm" className="h-8 border-[var(--border-strong)] px-3" onClick={() => setSelected(new Set())}>Clear</Button>
          <span className="text-xs text-[var(--body)]">A bulk change asks for one disposition, applied to each lead, and writes a separate history entry for each.</span>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgba(16,20,26,.05)]">
        <div className="overflow-x-auto">
          <table className="portal-lead-table w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr>
                <th className="w-10"><input type="checkbox" aria-label="Select every lead on this page" checked={allOnPage} onChange={() => setSelected((set) => { const next = new Set(set); if (allOnPage) pageRows.forEach((lead) => next.delete(lead.id)); else pageRows.forEach((lead) => next.add(lead.id)); return next; })} className="size-4 accent-[var(--primary)]" /></th>
                <th>Lead</th>
                <th>Partner</th>
                <th>Stage</th>
                <th>Disposition</th>
                <th className="text-right">In stage</th>
                <th>Owner</th>
                {money && <th className="text-right">Premium</th>}
              </tr>
            </thead>
            <tbody className="m-seq">
              {pageRows.map((lead) => {
                const stage = stageName(lead.stage_id);
                const late = isOverdue(lead, context, now);
                return (
                  <tr key={lead.id} className={cn("m-row", selected.has(lead.id) && "bg-[var(--soft-orange-surface)]")}>
                    <td><input type="checkbox" aria-label={`Select ${leadName(lead)}`} checked={selected.has(lead.id)} onChange={() => toggle(lead.id)} className="size-4 accent-[var(--primary)]" /></td>
                    <td><button type="button" className="font-semibold text-foreground underline-offset-4 hover:underline" onClick={() => onOpen(lead)}>{leadName(lead)}</button></td>
                    <td className="text-[var(--body)]">{lead.submitter_name ?? "Workspace"}</td>
                    <td><Chip dot={stage.color}>{stage.name}</Chip></td>
                    <td className="text-[var(--body)]">{dispositionLabel(lead.disposition, context) ?? "—"}</td>
                    <td className={cn("text-right tabular-nums", late ? "font-semibold text-[var(--error-ink)]" : "text-[var(--body)]")}>{durationLabel(inStageMs(lead, now))}</td>
                    <td className={lead.owner_name ? "text-[var(--body)]" : "font-semibold text-[var(--error-ink)]"}>{lead.owner_name ?? (lead.owner_user_id ? "Member" : "Unassigned")}</td>
                    {money && <td className="text-right tabular-nums">{lead.monthly_premium_cents != null ? `$${Math.round((lead.monthly_premium_cents * 12) / 100).toLocaleString("en-US")}` : "—"}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No leads in this view.</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-[var(--canvas)] px-4 py-2.5 text-xs text-muted-foreground">
          <span>{rows.length ? `${(current - 1) * PAGE + 1}–${Math.min(current * PAGE, rows.length)} of ${rows.length.toLocaleString()}` : "0"} · longest in stage first{context?.schemaReady ? " · red past the stage's time allowed" : ""}{money && premiumTotal ? ` · $${Math.round(premiumTotal / 100).toLocaleString("en-US")} on this page` : ""}</span>
          <span className="flex gap-2">
            <Button type="button" variant="outline" size="sm" className="border-[var(--border-strong)] px-4" disabled={current <= 1} onClick={() => setPage(current - 1)}>Previous</Button>
            <Button type="button" variant="outline" size="sm" className="border-[var(--border-strong)] px-4" disabled={current >= pages} onClick={() => setPage(current + 1)}>Next</Button>
          </span>
        </div>
      </div>
    </div>
  );
}

// ── List ─────────────────────────────────────────────────────────────────────────────────────

export function ListView({
  pipelines, leads, context, now, readOnly, onMove,
}: {
  pipelines: ViewPipeline[];
  leads: ViewLead[];
  context: ViewContext | null;
  now: number;
  readOnly: boolean;
  onMove: (lead: ViewLead, key: string) => Promise<boolean>;
}) {
  const [groupBy, setGroupBy] = useState<"stage" | "owner">("stage");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [history, setHistory] = useState<{ leadId: string; events: StageEvent[] | null; error: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const stagesById = useMemo(() => new Map(pipelines.flatMap((pipeline) => pipeline.stages.map((stage) => [stage.id, { stage, pipeline }] as const))), [pipelines]);
  const selected = leads.find((lead) => lead.id === selectedId) ?? null;

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    void fetch(`/api/app/leads/${selected.id}/stage-history`, { cache: "no-store" })
      .then(async (response) => ({ response, body: await response.json().catch(() => null) }))
      .then(({ response, body }) => { if (!cancelled) setHistory({ leadId: selected.id, events: response.ok ? body?.events ?? [] : null, error: response.ok ? "" : body?.error ?? "Could not load the history" }); })
      .catch(() => { if (!cancelled) setHistory({ leadId: selected.id, events: null, error: "Could not load the history" }); });
    return () => { cancelled = true; };
  }, [selected]);

  const groups = useMemo(() => {
    if (groupBy === "owner") {
      const byOwner = new Map<string, ViewLead[]>();
      for (const lead of leads) { const key = lead.owner_name ?? (lead.owner_user_id ? "Member" : "Unassigned"); byOwner.set(key, [...(byOwner.get(key) ?? []), lead]); }
      return [...byOwner.entries()].sort(([a], [b]) => (a === "Unassigned" ? -1 : b === "Unassigned" ? 1 : a.localeCompare(b))).map(([name, items]) => ({ id: `owner:${name}`, name, color: name === "Unassigned" ? "var(--error)" : "var(--muted-foreground)", rule: "", terminal: false, items }));
    }
    return pipelines.flatMap((pipeline) =>
      pipeline.stages.filter((stage) => !stage.is_archived).sort((a, b) => a.position - b.position).map((stage) => ({
        id: stage.id,
        name: pipelines.length > 1 ? `${pipeline.name} · ${stage.name}` : stage.name,
        color: stage.color,
        rule: stageMeta(stage, context),
        terminal: stage.stage_type !== "open",
        items: leads.filter((lead) => lead.stage_id === stage.id).sort((a, b) => (inStageMs(b, now) ?? -1) - (inStageMs(a, now) ?? -1)),
      })),
    ).filter((group) => group.items.length > 0);
  }, [groupBy, leads, pipelines, context, now]);
  const lateCount = leads.filter((lead) => isOverdue(lead, context, now)).length;
  const selectedStage = selected ? stagesById.get(selected.stage_id) : undefined;
  const quick = selected ? dispositionGroups(selectedStage?.pipeline, selected.stage_id, context) : [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-card px-3 font-semibold">
          <span className="font-normal text-muted-foreground">Group by</span>
          <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as "stage" | "owner")} className="bg-transparent font-semibold outline-none"><option value="stage">Stage</option><option value="owner">Owner</option></select>
        </label>
        <span className="text-xs text-muted-foreground tabular-nums">{leads.length.toLocaleString()} leads{lateCount ? <> · <strong className="text-[var(--error-ink)]">{lateCount} past their stage&rsquo;s time allowed</strong></> : null}</span>
      </div>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
        <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgba(16,20,26,.05)] xl:w-[60%]">
          {groups.map((group) => {
            const open = expanded[group.id] ?? !group.terminal;
            return (
              <div key={group.id}>
                <button type="button" onClick={() => setExpanded((state) => ({ ...state, [group.id]: !open }))} aria-expanded={open} className="flex w-full items-center justify-between gap-3 border-t border-border bg-[var(--surface-alt)] px-3 py-1.5 text-left first:border-t-0">
                  <span className="flex items-center gap-2"><span className="size-1.5 rounded-full" style={{ background: group.color }} aria-hidden="true" /><span className="text-xs font-semibold">{group.name}</span><span className="text-xs text-muted-foreground tabular-nums">{group.items.length} {group.items.length === 1 ? "lead" : "leads"}</span></span>
                  <span className="text-xs text-muted-foreground">{group.rule}{open ? "" : " · show"}</span>
                </button>
                {open && group.items.map((lead) => {
                  const active = lead.id === selectedId;
                  const late = isOverdue(lead, context, now);
                  return (
                    <button key={lead.id} type="button" onClick={() => setSelectedId(active ? null : lead.id)} aria-pressed={active} className={cn("flex w-full items-center gap-2.5 border-t border-border px-3 py-2 text-left", active ? "bg-[var(--soft-orange-surface)] shadow-[inset_3px_0_0_var(--primary)]" : "bg-card hover:bg-[var(--surface-alt)]")}>
                      <span className={cn("inline-flex size-[26px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold", active ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "bg-[var(--surface-alt)] text-[var(--body)]")}>{initials(leadName(lead))}</span>
                      <span className="min-w-0 flex-grow">
                        <span className="block truncate text-sm font-semibold">{leadName(lead)}</span>
                        <span className="block truncate text-xs text-muted-foreground tabular-nums">{lead.submitter_name ?? "Workspace"} · {stageAge(lead, now)}</span>
                      </span>
                      {lead.disposition && <Chip>{dispositionLabel(lead.disposition, context)}</Chip>}
                      <span className="w-[120px] shrink-0 text-right">
                        <span className={cn("block text-xs font-semibold", late ? "text-[var(--error-ink)]" : "text-[var(--body)]")}>{late ? "Past the time allowed" : lead.disposition_at ? "Last outcome recorded" : "Not yet worked"}</span>
                        <span className={cn("block text-xs", lead.owner_user_id ? "text-muted-foreground" : "font-semibold text-[var(--error-ink)]")}>{lead.owner_name ?? (lead.owner_user_id ? "Member" : "Unassigned")}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
          {groups.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No leads match these filters.</p>}
          <p className="border-t border-border bg-[var(--canvas)] px-3 py-2 text-xs text-[var(--body)]">Groups follow the stage order set on the Stages view. Terminal stages start collapsed — history, not work.</p>
        </section>

        <section className="flex min-w-0 flex-grow flex-col overflow-hidden rounded-lg border border-border bg-card shadow-[0_1px_2px_rgba(16,20,26,.05)]">
          {selected ? (
            <>
              <div className="border-b border-border bg-[var(--soft-orange-surface)] px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold">{leadName(selected)}</p>
                    <p className="text-xs text-[var(--body)]">{selected.submitter_name ?? "Workspace"} · arrived {dayMonth(selected.created_at, viewerTimeZone())}</p>
                  </div>
                  <Button asChild size="sm" className="h-8 shrink-0 px-3"><Link href={`/app/leads/${selected.id}`}>Open workspace</Link></Button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedStage && <Chip className="border border-[var(--primary)] bg-card text-[var(--accent-ink)]" dot={selectedStage.stage.color}>{selectedStage.stage.name}</Chip>}
                  {selected.disposition && <Chip>{dispositionLabel(selected.disposition, context)}</Chip>}
                  <Chip className={isOverdue(selected, context, now) ? "bg-[var(--error-surface)] text-[var(--error-ink)]" : undefined}>{stageAge(selected, now)}</Chip>
                </div>
              </div>
              <div className="border-b border-border px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">Stage history</p>
                {history?.leadId !== selected.id ? <p className="mt-2 text-sm text-muted-foreground">Loading…</p> : history.error ? <p className="mt-2 text-sm text-[var(--error-ink)]">{history.error}</p> : history.events && history.events.length ? (
                  <ol className="mt-2 flex flex-col gap-2">
                    {history.events.map((event) => (
                      <li key={event.id} className="flex gap-2 text-sm">
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full" style={{ background: stagesById.get(event.toStageId)?.stage.color ?? "var(--muted-foreground)" }} aria-hidden="true" />
                        <span>
                          <span className="block font-semibold">{stagesById.get(event.toStageId)?.stage.name ?? "A stage no longer shown"}{event.dispositionKey ? ` — ${dispositionLabel(event.dispositionKey, context)}` : " — corrected by an owner"}</span>
                          <span className="block text-xs text-muted-foreground">{event.actorName ?? "System"} · {dateTime(event.at, viewerTimeZone())}{event.fromStageId && stagesById.get(event.fromStageId) ? ` · from ${stagesById.get(event.fromStageId)!.stage.name}` : ""}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : <p className="mt-2 text-sm text-muted-foreground">{context?.schemaReady ? "No stage change recorded yet." : "The stage history starts with a database update (20260925100000) that has not been applied yet."}</p>}
              </div>
              <div className="px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">Record an outcome</p>
                <p className="mt-1 text-xs text-[var(--body)]">Picking one moves the lead to the stage it belongs to and writes the change to its history.</p>
                {quick.length ? quick.map((group) => (
                  <div key={group.label} className="mt-2.5">
                    <p className="text-xs text-muted-foreground">{group.label}</p>
                    <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
                      {group.options.map((option) => (
                        <button key={option.key} type="button" disabled={busy || readOnly || callPathOnly(option)} title={callPathOnly(option) ? "Record it from the lead or the dialer" : undefined} onClick={async () => { setBusy(true); const ok = await onMove(selected, option.key); setBusy(false); if (ok) setHistory(null); }} className="rounded-md border border-[var(--border-strong)] bg-card px-2.5 py-1.5 text-left text-xs font-semibold hover:bg-[var(--surface-alt)] disabled:opacity-50">
                          {option.label}{group.stageId !== selected.stage_id ? " →" : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                )) : <p className="mt-2 text-sm text-muted-foreground">No disposition is mapped in this pipeline yet.</p>}
              </div>
            </>
          ) : (
            <p className="m-auto px-6 py-16 text-center text-sm text-muted-foreground">Pick a lead to see its stage history and record an outcome without leaving the list.</p>
          )}
        </section>
      </div>
    </div>
  );
}
