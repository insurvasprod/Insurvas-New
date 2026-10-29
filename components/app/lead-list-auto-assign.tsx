"use client";

import { useRef, useState } from "react";
import { RotateCw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Meter, type MeterTone } from "@/components/ui/stat";
import { Sheet } from "@/components/ui/sheet";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { forgetListPreview } from "@/components/app/lead-list-assign-drawer";
import type { LeadListIndexRow } from "@/components/app/lead-list-index";
import type { LeadListAssignmentPreview, LeadListOwnerRow } from "@/lib/assignment/constants";
import { notify } from "@/lib/notify";

/**
 * Auto-assign (owner 2026-10-29): every waiting usable lead on the active, scrubbed lists, handed out
 * by the published routing rules.
 *
 * No new server path and no new algorithm. Each list goes through the Lists panel's own bulk path:
 * the dry run (GET /api/app/assignments?view=list_preview) and then the one-transaction commit
 * (POST /api/app/assignments { action: "assign_list" }), owner / producer only, refused read-only and
 * in a narrowed agency session, audited by assign_lead_list itself. The mode is "chain": the rules as
 * published, so licences, capacity AND household rest days all hold (owner 2026-10-29: "yes, respect
 * them"). The named-people modes would not do: assign_lead_list reads their required reason as a
 * manager's rest-day override. "Most free first" comes from the rules' own fallback strategy
 * (Route › "Everyone else, in turn by" › Fewest open first).
 */

export type AutoAssignMember = {
  id: string; name: string; role: string; status?: string; capacity: number; currentOpen: number;
  /** Null for a setter (any state) or when unknown; an empty list means licensed nowhere. */
  eligibleStates?: string[] | null;
};

const TOO_BIG = "Too many to route at once — use Route › Hand out";

const count = (value: number) => value.toLocaleString("en-US");
const leads = (value: number) => `${count(value)} ${value === 1 ? "lead" : "leads"}`;

/** Unowned leads on a list that may be served: what Auto-assign would offer out. */
export function waitingOn(list: LeadListIndexRow) {
  if (list.status !== "active" || list.scrubStatus !== "scrubbed") return 0;
  return Math.max(0, list.leadsReceived - list.assigned);
}

type Person = { id: string; name: string; capacity: number; open: number; gained: number };
type ListRun = {
  id: string; name: string; waiting: number;
  status: "queued" | "running" | "done" | "skipped" | "error";
  assigned: number; left: number; note: string | null;
};

const LIST_CHIP: Record<ListRun["status"], { label: string; tone: StatusTone }> = {
  queued: { label: "Waiting", tone: "neutral" },
  running: { label: "Assigning", tone: "info" },
  done: { label: "Done", tone: "good" },
  skipped: { label: "Skipped", tone: "warning" },
  error: { label: "Failed", tone: "danger" },
};

/** Who can be named, who cannot and why: the confirm's numbers and the run's starting roster. */
function sortRoster(members: AutoAssignMember[]) {
  const active = members.filter((member) => !member.status || member.status === "active");
  const noLicence = active.filter((member) => member.role !== "setter" && Array.isArray(member.eligibleStates) && member.eligibleStates.length === 0);
  const rest = active.filter((member) => !noLicence.includes(member));
  // A ceiling of 0 is full to the server (open >= max_open_leads), so it is full here too.
  const full = rest.filter((member) => member.capacity - member.currentOpen <= 0);
  const free = rest
    .filter((member) => member.capacity - member.currentOpen > 0)
    .sort((a, b) => (b.capacity - b.currentOpen) - (a.capacity - a.currentOpen) || a.name.localeCompare(b.name));
  return { free, full, noLicence };
}

type Step =
  | { ok: true; result: LeadListAssignmentPreview }
  | { ok: false; skip: boolean; message: string; changed?: boolean };

async function call(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, { cache: "no-store", ...init });
  const body = await response.json().catch(() => null);
  return { response, body };
}

const tooBig = (status: number, body: { code?: string; error?: string } | null) =>
  status === 504 || body?.code === "list_too_slow" || /too (many|large)|statement timeout|canceling statement/i.test(body?.error ?? "");

/** The dry run for this list, by the published rules. */
async function previewList(campaignId: string): Promise<Step> {
  const params = new URLSearchParams({ view: "list_preview", campaign_id: campaignId, mode: "chain" });
  try {
    const { response, body } = await call(`/api/app/assignments?${params}`);
    if (response.ok) return { ok: true, result: body.preview as LeadListAssignmentPreview };
    if (tooBig(response.status, body)) return { ok: false, skip: true, message: TOO_BIG };
    return { ok: false, skip: false, message: body?.error ?? "Could not work out who would get these leads." };
  } catch {
    return { ok: false, skip: false, message: "Could not reach the server." };
  }
}

/** The commit: the drawer's own bulk write, refused if the count moved since the dry run. */
async function commitList(campaignId: string, expected: number): Promise<Step> {
  try {
    const { response, body } = await call("/api/app/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "assign_list", campaignId, mode: "chain", expected }),
    });
    if (response.ok) return { ok: true, result: body as LeadListAssignmentPreview };
    if (response.status === 409 && body?.code === "list_changed") return { ok: false, skip: false, changed: true, message: "The list changed while this ran." };
    if (tooBig(response.status, body)) return { ok: false, skip: true, message: TOO_BIG };
    return { ok: false, skip: false, message: body?.error ?? "Could not assign the list." };
  } catch {
    return { ok: false, skip: false, message: "Could not reach the server. Nothing was assigned on this list." };
  }
}

export function LeadListAutoAssign({ lists, members, onDone }: {
  lists: LeadListIndexRow[];
  /** The roster with capacities (GET /api/app/assignments); null while it did not answer. */
  members: AutoAssignMember[] | null;
  /** Reloads the lists once the run ends. */
  onDone: () => Promise<unknown> | void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [runs, setRuns] = useState<ListRun[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [stopping, setStopping] = useState(false);
  const stopRef = useRef(false);
  const peopleRef = useRef<Person[]>([]);

  const targets = lists.filter((list) => waitingOn(list) > 0).sort((a, b) => waitingOn(b) - waitingOn(a));
  const waiting = targets.reduce((n, list) => n + waitingOn(list), 0);
  const roster = sortRoster(members ?? []);
  const blocked = members === null ? "The team did not load, so nobody can be chosen."
    : targets.length === 0 ? "No active, scrubbed list has leads waiting."
      : roster.free.length === 0 ? "Nobody has free capacity."
        : null;

  function setPerson(next: Person[]) { peopleRef.current = next; setPeople(next); }
  function patchRun(id: string, patch: Partial<ListRun>) { setRuns((current) => current.map((run) => (run.id === id ? { ...run, ...patch } : run))); }

  /** Most free first, from what each person holds now, counting what this run has handed them. */
  function order() {
    return peopleRef.current
      .filter((person) => person.capacity - person.open - person.gained > 0)
      .sort((a, b) => (b.capacity - b.open - b.gained) - (a.capacity - a.open - a.gained) || a.name.localeCompare(b.name))
      .map((person) => person.id);
  }

  function credit(rows: LeadListOwnerRow[]) {
    const gets = new Map(rows.map((row) => [row.user_id, row.gets]));
    setPerson(peopleRef.current.map((person) => ({ ...person, gained: person.gained + (gets.get(person.id) ?? 0) })));
  }

  async function runOne(run: Pick<ListRun, "id" | "name">) {
    if (order().length === 0) { patchRun(run.id, { status: "skipped", note: "Everyone is at capacity" }); return; }
    patchRun(run.id, { status: "running", note: null });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const preview = await previewList(run.id);
      if (!preview.ok) { patchRun(run.id, { status: preview.skip ? "skipped" : "error", note: preview.message }); return; }
      if (preview.result.routable === 0) {
        patchRun(run.id, { status: "skipped", left: preview.result.total, note: preview.result.nobody[0]?.reason ?? "Nobody here can take these" });
        return;
      }
      const done = await commitList(run.id, preview.result.routable);
      if (done.ok) {
        forgetListPreview(run.id);
        credit(done.result.per_owner ?? []);
        patchRun(run.id, { status: "done", assigned: done.result.routable, left: done.result.nobody_count, note: done.result.nobody[0]?.reason ?? null });
        return;
      }
      // A lead moved between the dry run and the commit: run it once more on fresh numbers.
      if (done.changed && attempt === 0) continue;
      patchRun(run.id, { status: done.skip ? "skipped" : "error", note: done.message });
      return;
    }
  }

  async function start() {
    setConfirming(false);
    stopRef.current = false;
    setStopping(false);
    setPerson(roster.free.map((member) => ({ id: member.id, name: member.name, capacity: member.capacity, open: member.currentOpen, gained: 0 })));
    setRuns(targets.map((list) => ({ id: list.campaignId, name: list.campaignName, waiting: waitingOn(list), status: "queued", assigned: 0, left: 0, note: null })));
    setSheetOpen(true);
    setRunning(true);
    for (const list of targets) {
      if (stopRef.current) break;
      await runOne({ id: list.campaignId, name: list.campaignName });
    }
    setRunning(false);
    await onDone();
  }

  async function retry(run: ListRun) {
    if (running) return;
    setRunning(true);
    await runOne(run);
    setRunning(false);
    await onDone();
  }

  function close() {
    if (running) return;
    setSheetOpen(false);
    const assigned = runs.reduce((n, run) => n + run.assigned, 0);
    if (assigned) notify.done(`${leads(assigned)} auto-assigned`);
  }

  const processed = runs.filter((run) => run.status !== "queued" && run.status !== "running").length;
  const assigned = runs.reduce((n, run) => n + run.assigned, 0);
  const skipped = runs.reduce((n, run) => n + (run.status === "done" ? run.left : run.status === "queued" || run.status === "running" ? 0 : run.left || run.waiting), 0);
  const remaining = runs.filter((run) => run.status === "queued" || run.status === "running").reduce((n, run) => n + run.waiting, 0);
  const failed = runs.filter((run) => run.status === "error");
  const stopped = !running && runs.some((run) => run.status === "queued");
  const shownPeople = [...people].sort((a, b) => b.gained - a.gained || a.name.localeCompare(b.name));

  return (
    <>
      <Button type="button" disabled={Boolean(blocked) || running} title={blocked ?? `Assign ${leads(waiting)} by your routing rules`} onClick={() => setConfirming(true)}>
        <Sparkles aria-hidden="true" />Auto-assign
      </Button>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={() => void start()}
        destructive={false}
        title="Are you sure you want to auto-assign?"
        description={`${leads(waiting)} across ${count(targets.length)} ${targets.length === 1 ? "list" : "lists"} go to ${count(roster.free.length)} ${roster.free.length === 1 ? "person" : "people"}, by your routing rules — licences, capacity and household rest days respected.`}
        confirmLabel="Yes, auto-assign"
        cancelLabel="Cancel"
      >
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          <li>Skipped: {count(roster.full.length)} at capacity · {count(roster.noLicence.length)} with no licence</li>
          <li>Leads nobody licensed can take stay in the pool.</li>
        </ul>
      </ConfirmDialog>

      {sheetOpen && (
        <Sheet
          title="Auto-assign"
          subtitle={running ? `List ${Math.min(processed + 1, runs.length)} of ${runs.length}` : stopped ? "Stopped" : "Finished"}
          onClose={close}
          footer={running ? (
            <Button type="button" variant="outline" className="ml-auto" disabled={stopping} onClick={() => { stopRef.current = true; setStopping(true); }}>
              Stop after this list
            </Button>
          ) : (
            <Button type="button" className="ml-auto" onClick={close}>Done</Button>
          )}
        >
          <section aria-label="Progress" aria-busy={running} className="flex flex-col gap-2">
            <Meter value={processed} max={Math.max(1, runs.length)} tone={failed.length ? "warning" : "good"} label={`${processed} of ${runs.length} lists`} />
            <dl className="m-0 grid grid-cols-3 gap-2">
              {([["Assigned", assigned, "text-[var(--success-ink)]"], ["Skipped", skipped, "text-[var(--warning-ink)]"], ["Remaining", remaining, "text-[var(--ink)]"]] as const).map(([label, value, tone]) => (
                <div key={label} className="rounded-md border border-[var(--border)] px-3 py-2">
                  <dt className="text-xs text-[var(--muted)]">{label}</dt>
                  <dd className={`m-0 text-base font-semibold tabular-nums ${tone}`}>{count(value)}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-label="People" className="flex flex-col gap-2">
            <h3 className="m-0 text-sm font-semibold text-[var(--ink)]">People</h3>
            {shownPeople.map((person) => {
              const after = person.open + person.gained;
              const tone: MeterTone = after >= person.capacity ? "warning" : after / person.capacity >= 0.8 ? "info" : "good";
              return (
                <div key={person.id} className="flex items-center gap-3 rounded-md border border-[var(--border)] px-3 py-2">
                  <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--primary-soft)] text-sm font-semibold text-[var(--accent-ink)]">{(person.name.trim()[0] ?? "?").toUpperCase()}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-[var(--ink)]">{person.name}</span>
                      <span className={`shrink-0 text-sm font-semibold tabular-nums ${person.gained > 0 ? "text-[var(--success-ink)]" : "text-[var(--muted)]"}`}>+{count(person.gained)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Meter value={after} max={Math.max(person.capacity, 1)} tone={tone} label={`${person.name}: ${after} open of ${person.capacity}`} className="flex-1" />
                      <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">{count(after)} of {count(person.capacity)}</span>
                    </span>
                  </span>
                </div>
              );
            })}
          </section>

          <section aria-label="Lists" className="flex flex-col gap-2">
            <h3 className="m-0 text-sm font-semibold text-[var(--ink)]">Lists</h3>
            {runs.map((run) => {
              const chip = LIST_CHIP[run.status];
              return (
                <div key={run.id} className="flex flex-col gap-1 rounded-md border border-[var(--border)] px-3 py-2">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-[var(--ink)]" title={run.name}>{run.name}</span>
                    <StatusChip tone={chip.tone} dot>{run.status === "done" ? `+${count(run.assigned)}` : chip.label}</StatusChip>
                  </span>
                  <span className="flex items-center justify-between gap-2 text-xs text-[var(--muted)]">
                    <span className="min-w-0 truncate" title={run.note ?? undefined}>
                      {run.status === "done" ? `${count(run.assigned)} of ${count(run.waiting)} assigned${run.left ? ` · ${count(run.left)} left: ${run.note ?? "nobody can take them"}` : ""}`
                        : run.note ?? `${leads(run.waiting)} waiting`}
                    </span>
                    {run.status === "error" && (
                      <Button type="button" variant="outline" size="sm" disabled={running} onClick={() => void retry(run)}>
                        <RotateCw aria-hidden="true" />Retry
                      </Button>
                    )}
                  </span>
                </div>
              );
            })}
          </section>
        </Sheet>
      )}
    </>
  );
}
