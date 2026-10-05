"use client";

/**
 * Pending requirements (LA-3.18; board l3-ws-after): what the carrier is waiting for, who it is
 * waiting on, how long it has been open (amber at N days, red at 2N — the agency's own N) and when
 * it was last chased. "Log a chase" is one click; "Set a callback" books one that links back.
 * Satisfying every requirement never marks the policy issued.
 */

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { REQUIREMENT_KIND_LABEL } from "@/lib/applications/constants";
import type { RequirementView } from "@/lib/applications/types";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

import { dateTime, ordinal, shortDate } from "@/components/app/applications/parts";
import { attemptUrl, request } from "@/components/app/applications/submit/api";
import { useWorkspace } from "@/components/app/applications/workspace/context";
import { StepCard } from "@/components/app/applications/workspace/step-card";
import { CallbackDialog } from "./callback-dialog";
import { ageingOf, ago, daysOpen, isOpenStatus, waitingLine } from "./model";
import { RequirementDialog } from "./requirement-dialog";

type CallbackLink = { requirementId: string; callbackId: string; scheduledAtUtc: string | null; timezone: string | null; status: string | null };

const CLOSED_LABEL: Record<string, string> = { satisfied: "Satisfied", waived: "Waived", expired: "Expired" };

export function RequirementsCard({ now }: { now: number }) {
  const { attempt, readOnly, sample, actions, updateAttempt } = useWorkspace();
  const [ageing, setAgeing] = useState(5);
  const [callbacks, setCallbacks] = useState<CallbackLink[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RequirementView | null>(null);
  const [calling, setCalling] = useState<RequirementView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (sample) return;
    const r = await request<{ ageingDays: number; callbacks: CallbackLink[] }>(attemptUrl(attempt.id, "/requirements"));
    if (r.ok) { setAgeing(r.data.ageingDays); setCallbacks(r.data.callbacks); }
  }, [attempt.id, sample]);
  useEffect(() => { const t = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(t); }, [load]);

  const open = attempt.requirements.filter((r) => isOpenStatus(r.status)).sort((a, b) => Number(b.waitingOn === "client") - Number(a.waitingOn === "client") || a.raisedAt.localeCompare(b.raisedAt));
  const closed = attempt.requirements.filter((r) => !isOpenStatus(r.status));
  const onClient = open.filter((r) => r.waitingOn === "client").length;
  const canWrite = !readOnly && attempt.status !== "draft" && attempt.status !== "ready";

  async function chase(r: RequirementView) {
    if (sample) {
      updateAttempt({ requirements: attempt.requirements.map((x) => (x.id === r.id ? { ...x, chaseCount: x.chaseCount + 1, lastChasedAt: new Date().toISOString() } : x)) });
      notify.done(`Chase logged · ${ordinal(r.chaseCount + 1)} chase`, { detail: "Sample data — nothing was saved." });
      return;
    }
    setBusy(r.id);
    try {
      const res = await request<{ chaseCount: number }>(attemptUrl(attempt.id, `/requirements/${r.id}/chase`), { method: "POST" });
      if (!res.ok) { notify.block(res.error); return; }
      await actions.refresh();
      notify.done(`Chase logged · ${ordinal(res.data.chaseCount)} chase`);
    } finally {
      setBusy(null);
    }
  }

  async function satisfy(r: RequirementView) {
    if (sample) {
      updateAttempt({ requirements: attempt.requirements.map((x) => (x.id === r.id ? { ...x, status: "satisfied" } : x)) });
      notify.done(`${REQUIREMENT_KIND_LABEL[r.kind]} satisfied`, { detail: "Sample data — nothing was saved." });
      return;
    }
    setBusy(r.id);
    try {
      const res = await request(attemptUrl(attempt.id, `/requirements/${r.id}`), { method: "PATCH", body: { status: "satisfied" } });
      if (!res.ok) { notify.block(res.error); return; }
      await actions.refresh();
      notify.done(`${REQUIREMENT_KIND_LABEL[r.kind]} satisfied`, { detail: open.length === 1 ? "Nothing is left open — record the outcome when the carrier decides." : undefined });
    } finally {
      setBusy(null);
    }
  }

  const callbackFor = (id: string) => callbacks.find((c) => c.requirementId === id && (c.status === "scheduled" || c.status === "due"));

  return (
    <StepCard
      title="Pending requirements"
      chips={onClient > 0 ? <StatusChip tone="warning">{onClient} waiting on the client</StatusChip> : open.length ? <StatusChip tone="neutral">{open.length} open</StatusChip> : <StatusChip tone="good">None open</StatusChip>}
      bodyClassName="gap-0 p-0"
      footerNote={`Amber after ${ageing} days, red after ${ageing * 2}.`}
      actions={canWrite ? <Button type="button" variant="outline" onClick={() => setAdding(true)}><Plus aria-hidden="true" />Add requirement</Button> : undefined}
    >
      {open.length === 0 && closed.length === 0 && (
        <p className="px-[22px] py-4 text-sm text-[var(--muted)]">{readOnly ? "The carrier asked for nothing after submission." : "Nothing yet. Add one when the carrier asks for something — an interview, records, a signature, an exam."}</p>
      )}
      <ul>
        {open.map((r) => {
          const days = daysOpen(r.raisedAt, now);
          const age = ageingOf(days, ageing);
          const cb = callbackFor(r.id);
          const why = busy === r.id ? "Saving…" : undefined;
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-3.5 border-t border-[var(--border)] px-[22px] py-3.5 first:border-t-0">
              <div className="min-w-[200px] flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-semibold text-[var(--ink)]">{REQUIREMENT_KIND_LABEL[r.kind]}</span>
                  <span className="text-xs text-[var(--muted)]">{waitingLine(r.waitingOn)}</span>
                </div>
                {r.description && <div className="text-xs text-[var(--body)]">{r.description}</div>}
                <div className="text-xs text-[var(--muted)]">
                  Last chased {ago(r.lastChasedAt, now)}{r.chaseCount > 1 ? ` · ${r.chaseCount} chases` : ""}{r.dueAt ? ` · due ${shortDate(r.dueAt)}` : ""}
                  {cb?.scheduledAtUtc ? ` · callback ${dateTime(cb.scheduledAtUtc, cb.timezone ?? undefined)}` : ""}
                </div>
                {r.exam && (r.exam.vendor || r.exam.scheduledOn) && (
                  <div className="text-xs text-[var(--muted)]">Exam{r.exam.vendor ? ` · ${r.exam.vendor}` : ""}{r.exam.scheduledOn ? ` · scheduled ${shortDate(r.exam.scheduledOn)}` : ""}{r.exam.completedOn ? ` · done ${shortDate(r.exam.completedOn)}` : ""}</div>
                )}
              </div>
              <StatusChip tone={age === "red" ? "danger" : age === "amber" ? "warning" : "neutral"} dot title={`Raised ${shortDate(r.raisedAt)}`}>{days === 1 ? "1 day" : `${days} days`}</StatusChip>
              {canWrite && (
                <span className="flex flex-wrap gap-1.5">
                  <Button type="button" variant="outline" size="sm" onClick={() => void chase(r)} disabled={Boolean(why)} title={why}>Log a chase</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setCalling(r)} disabled={Boolean(why)} title={why}>Set a callback</Button>
                  {r.kind !== "counteroffer" && <Button type="button" variant="ghost" size="sm" onClick={() => void satisfy(r)} disabled={Boolean(why)} title={why}>Satisfied</Button>}
                  <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(r)} disabled={Boolean(why)} title={why}>Update</Button>
                </span>
              )}
            </li>
          );
        })}
        {closed.map((r) => (
          <li key={r.id} className={cn("flex flex-wrap items-center gap-3.5 border-t border-[var(--border)] px-[22px] py-3 text-[var(--muted)]", open.length === 0 && "first:border-t-0")}>
            <div className="min-w-[200px] flex-1">
              <span className="text-sm font-semibold">{REQUIREMENT_KIND_LABEL[r.kind]}</span>
              {r.description && <span className="block text-xs">{r.description}</span>}
            </div>
            <StatusChip tone={r.status === "satisfied" ? "good" : "neutral"}>{CLOSED_LABEL[r.status] ?? r.status}</StatusChip>
          </li>
        ))}
      </ul>
      <RequirementDialog open={adding || editing !== null} onOpenChange={(o) => { if (!o) { setAdding(false); setEditing(null); } }} editing={editing} />
      <CallbackDialog open={calling !== null} onOpenChange={(o) => { if (!o) setCalling(null); }} requirement={calling} onBooked={() => void load()} />
    </StepCard>
  );
}
