"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ScrollText, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Meter, type MeterTone } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Segmented } from "@/components/ui/view-tabs";
import { Callout, control } from "@/components/app/settings/primitives";
import { LICENCE_WARNING_DAYS, LIST_CHANGED_MESSAGE, daysUntil, lapseDay, shortDate, type LeadListAssignmentPreview, type LeadListOwnerRow, type LicenceExpiry } from "@/lib/assignment/constants";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

/**
 * "Assign N leads" — the board's p-ov-assign-drawer. Opens from a lead list and moves every unowned
 * pool lead in the list in ONE transaction (assign_lead_list, 20260924342000): all the routable
 * ones, or none. What it shows is not an estimate: it is the real router run over every one of those
 * leads and rolled back (assign_lead_list_preview), and the commit refuses if the number it would
 * move is not the number shown here.
 *
 * Owner 2026-10-29: two ways in — "By the rules" (the published chain) or "Pick leads myself" (the
 * one-by-one picker, shown here in place) — and the preview as people, each with what they get, why,
 * and how full they are, with an at-capacity agent's ceiling raised right here (the Route step's own
 * PATCH /api/app/assignments, same owner/producer gate).
 *
 * Speed (same day): the preview runs about 10 ms per lead in the database, but the drawer used to ask
 * for it only once the list's panel had loaded AND the drawer had opened, then read the whole routing
 * workspace again for the roster. The preview is now cached per list for a short while and started
 * by the panel as soon as it opens on an assignment (prefetchListPreview); the roster comes in from
 * the Lists step, which already holds it.
 *
 * Built on the Radix Dialog primitive directly (focus trap, Escape, focus back to the trigger)
 * because the shared DialogContent is centred and this is a right-hand drawer.
 */

export type AssignDrawerMember = { id: string; name: string; role: string; status?: string; capacity: number; currentOpen: number; licenceExpiring?: LicenceExpiry[] };

type Way = "rules" | "pick";

const count = (value: number) => value.toLocaleString("en-US");
const leads = (value: number) => `${count(value)} ${value === 1 ? "lead" : "leads"}`;

// ── the preview, cached per list ──────────────────────────────────────────────────────────────────

type PreviewResult =
  | { ok: true; preview: LeadListAssignmentPreview }
  | { ok: false; message: string; pending: boolean; tooSlow: boolean };

/** A preview this young is shown as is; the commit still refuses a count that moved (409 list_changed). */
const PREVIEW_TTL_MS = 30_000;
const previews = new Map<string, { at: number; promise: Promise<PreviewResult> }>();

async function readPreview(campaignId: string): Promise<PreviewResult> {
  const params = new URLSearchParams({ view: "list_preview", campaign_id: campaignId, mode: "chain" });
  try {
    const response = await fetch(`/api/app/assignments?${params}`, { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        message: body?.error ?? "Could not work out who would get these leads.",
        pending: response.status === 503,
        tooSlow: body?.code === "list_too_slow",
      };
    }
    return { ok: true, preview: body.preview as LeadListAssignmentPreview };
  } catch {
    return { ok: false, message: "Could not reach the server to preview this assignment.", pending: false, tooSlow: false };
  }
}

/**
 * Starts (or reuses) the rule-chain preview for a list. The Lists panel calls it the moment it opens
 * on an assignment, in parallel with its own read, so the drawer usually opens on a finished answer.
 * A failed preview is not kept.
 */
export function prefetchListPreview(campaignId: string, fresh = false): Promise<PreviewResult> {
  const held = previews.get(campaignId);
  if (!fresh && held && Date.now() - held.at < PREVIEW_TTL_MS) return held.promise;
  const promise = readPreview(campaignId).then((result) => {
    if (!result.ok && previews.get(campaignId)?.promise === promise) previews.delete(campaignId);
    return result;
  });
  previews.set(campaignId, { at: Date.now(), promise });
  return promise;
}

/** After anything that changes who would get what: the next open runs the router again. */
export function forgetListPreview(campaignId: string) {
  previews.delete(campaignId);
}

// ── why a person gets what they get, as short chips ───────────────────────────────────────────────

const RULE_CHIP: Record<string, string> = {
  fallback: "Fallback rule",
  state: "State rule",
  campaign: "List rule",
  language: "Language rule",
  product: "Product rule",
  realtime: "Real-time rule",
  roster: "No rule matched",
  manual: "Chosen",
};

function whyChips(row: LeadListOwnerRow): Array<{ label: string; tone: StatusTone }> {
  const chips: Array<{ label: string; tone: StatusTone }> = [];
  for (const type of row.rule_types ?? []) chips.push({ label: RULE_CHIP[type] ?? "Rule", tone: "info" });
  if (row.capacity_skips > 0) chips.push({ label: row.gets > 0 ? `Full after ${count(row.gets)}` : "At capacity", tone: "warning" });
  if (row.gets === 0 && row.capacity_skips === 0) chips.push({ label: "None they can take", tone: "neutral" });
  return chips;
}

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; preview: LeadListAssignmentPreview }
  | { status: "error"; message: string; pending: boolean; tooSlow: boolean };

export function LeadListAssignDrawer({ campaignId, listName, assignable, defaultOpen = false, onDone, members: givenMembers, picker }: {
  campaignId: string;
  listName: string;
  assignable: number;
  /** Open on mount: a Lists row's "Assign" lands in the list's panel with the drawer already up. */
  defaultOpen?: boolean;
  /** After a commit, instead of refreshing the route (the Lists panel reloads its own data). */
  onDone?: () => void;
  /** The roster with capacities, when the page already holds it (the Lists step); read here otherwise. */
  members?: AssignDrawerMember[] | null;
  /** "Pick leads myself": the one-by-one picker, shown in place. Without it, a link to the Lists step. */
  picker?: ReactNode;
}) {
  const router = useRouter();
  const ids = useId();
  const [open, setOpen] = useState(defaultOpen);
  const [way, setWay] = useState<Way>("rules");
  const [fetchedMembers, setFetchedMembers] = useState<AssignDrawerMember[] | null>(null);
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [commitError, setCommitError] = useState("");
  // Capacities raised here, over what the roster said, until the page reads it again.
  const [raised, setRaised] = useState<Record<string, number>>({});
  const request = useRef(0);

  const members = (givenMembers ?? fetchedMembers)?.filter((member) => !member.status || member.status === "active") ?? null;

  const loadPreview = useCallback(async (fresh = false) => {
    const ticket = ++request.current;
    setState({ status: "loading" });
    const result = await prefetchListPreview(campaignId, fresh);
    if (ticket !== request.current) return;
    setState(result.ok ? { status: "ready", preview: result.preview } : { status: "error", message: result.message, pending: result.pending, tooSlow: result.tooSlow });
  }, [campaignId]);

  // The roster, only when the page did not hand it in (the list's own page).
  useEffect(() => {
    if (!open || givenMembers || fetchedMembers) return;
    let live = true;
    fetch("/api/app/assignments", { cache: "no-store" })
      .then(async (response) => (response.ok ? response.json() : null))
      .then((body) => { if (live && body) setFetchedMembers((body.members ?? []) as AssignDrawerMember[]); })
      .catch(() => undefined);
    return () => { live = false; };
  }, [open, givenMembers, fetchedMembers]);

  useEffect(() => {
    if (!open || way !== "rules") return;
    // Asynchronous: the state it sets lands after the (usually already cached) read, not during this effect.
    const timer = window.setTimeout(() => { void loadPreview(); }, 0);
    return () => window.clearTimeout(timer);
  }, [open, way, loadPreview]);

  function reset() {
    request.current += 1;
    setState({ status: "loading" });
    setChanged(false);
    setCommitError("");
    setWay("rules");
  }

  function onOpenChange(next: boolean) {
    // Closing mid-commit would hide the outcome of a transaction that is still running.
    if (busy) return;
    setOpen(next);
    if (!next) reset();
  }

  const preview = state.status === "ready" ? state.preview : null;
  const total = preview?.total ?? assignable;
  const routable = preview?.routable ?? 0;
  const nobody = preview?.nobody_count ?? 0;
  const memberById = new Map((members ?? []).map((member) => [member.id, member]));
  // Owners who would get leads in a state where their own licence lapses within the warning window:
  // those leads go back to the pool on the day it lapses (20260925702200).
  const lapsing = (preview?.per_owner ?? []).flatMap((row) => {
    if (row.gets === 0) return [];
    return (memberById.get(row.user_id)?.licenceExpiring ?? [])
      .filter((entry) => row.states.includes(entry.state) && daysUntil(entry.expiresOn) >= 0 && daysUntil(entry.expiresOn) <= LICENCE_WARNING_DAYS)
      .map((entry) => ({ name: row.name, entry }));
  });

  const blockedBy =
    busy ? "Assigning…"
      : state.status === "loading" ? "Waiting for the preview."
        : state.status === "error" ? "The preview did not run, so there is nothing to confirm."
          : routable === 0 ? "Nobody can take these leads right now."
            : null;

  async function commit() {
    if (blockedBy || !preview) return;
    setBusy(true);
    setCommitError("");
    try {
      const response = await fetch("/api/app/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign_list", campaignId, mode: "chain", userIds: [], reason: null, expected: preview.routable }),
      });
      const body = await response.json().catch(() => null);
      if (response.status === 409 && body?.code === "list_changed") {
        setBusy(false);
        setChanged(true);
        await loadPreview(true);
        return;
      }
      if (!response.ok) {
        setBusy(false);
        setCommitError(body?.error ?? "Could not assign the list.");
        return;
      }
      forgetListPreview(campaignId);
      const moved = typeof body?.routable === "number" ? body.routable : preview.routable;
      const left = typeof body?.nobody_count === "number" ? body.nobody_count : 0;
      notify.done(`${leads(moved)} assigned`, left ? { detail: `${leads(left)} stay unassigned in the pool.` } : undefined);
      setBusy(false);
      setOpen(false);
      reset();
      if (onDone) onDone(); else router.refresh();
    } catch {
      setBusy(false);
      setCommitError("Could not reach the server. Nothing was assigned.");
    }
  }

  /** A ceiling raised here: the router runs again with it. */
  async function capacityRaised(userId: string, capacity: number) {
    setRaised((current) => ({ ...current, [userId]: capacity }));
    setChanged(false);
    await loadPreview(true);
  }

  function nobodySummary(p: LeadListAssignmentPreview) {
    const groups = p.nobody;
    const listed = groups.slice(0, 3).map((group) => `${group.reason} (${count(group.count)})`).join("; ");
    const more = groups.length > 3 ? `; and ${groups.length - 3} more reasons` : "";
    const detail = groups.find((group) => group.detail)?.detail;
    return `${listed}${more}.${detail ? ` ${detail}` : ""}`;
  }

  const whyId = `${ids}-why`;
  const pickHere = way === "pick" && Boolean(picker);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Trigger asChild>
        <Button type="button" onPointerEnter={() => void prefetchListPreview(campaignId)} onFocus={() => void prefetchListPreview(campaignId)}>Assign the {count(assignable)}</Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(10,12,16,0.55)] transition-opacity duration-200 starting:opacity-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col overflow-hidden border-l border-[var(--border-strong)] bg-[var(--surface)] shadow-[-24px_0_64px_rgba(0,0,0,0.24)] outline-none",
            pickHere ? "sm:w-[min(980px,94vw)]" : "sm:w-[600px]",
            // Slides in from the right. @starting-style, so no keyframes are needed; the global
            // reduced-motion rule cuts the transition to nothing.
            "transition-[transform,width] duration-[260ms] ease-[cubic-bezier(.16,1,.3,1)] starting:translate-x-full motion-reduce:transition-none",
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border)] px-[22px] py-[18px]">
            <div className="min-w-0">
              <DialogPrimitive.Title className="m-0 text-base leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">
                Assign {leads(total)}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-[5px] text-sm leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">
                {listName} · the usable remainder
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Close"
                disabled={busy}
                className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-0 text-[var(--muted)] hover:bg-[var(--surface-alt)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X className="size-[13px]" strokeWidth={2.4} aria-hidden="true" />
              </button>
            </DialogPrimitive.Close>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-[22px]">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                label="How to assign"
                options={[{ key: "rules", label: "By the rules" }, { key: "pick", label: "Pick leads myself" }]}
                value={way}
                onChange={(next: Way) => { if (!busy) { setWay(next); setCommitError(""); } }}
              />
              {way === "rules" && <InfoTip label="About the rules" side="right">The published rule chain on Lead routing, exactly as Assign next follows it, over every lead in the pool.</InfoTip>}
            </div>

            {way === "pick" ? (
              picker ?? (
                <p className="text-sm text-[var(--body)]">
                  <Link href={`/app/lead-lists#${campaignId}`} className="font-semibold text-[var(--accent-ink)] underline-offset-2 hover:underline">Open the picker</Link> on Lead sources › Lists.
                </p>
              )
            ) : (
              <>
                {changed && <Callout tone="warning" title={LIST_CHANGED_MESSAGE}>Nothing was assigned. The numbers below are from a fresh run.</Callout>}

                <section aria-label="Who gets what" aria-busy={state.status === "loading"} className="flex flex-col gap-2">
                  {state.status === "loading" ? (
                    <>
                      {[0, 1, 2].map((index) => (
                        <div key={index} className="flex items-center gap-3 rounded-[10px] border border-[var(--border)] px-3 py-2.5" aria-hidden="true">
                          <span className="m-skel block size-8 shrink-0 rounded-full" />
                          <span className="flex flex-1 flex-col gap-1.5"><span className="m-skel block h-[14px] w-32 rounded" /><span className="m-skel block h-[5px] w-full rounded" /></span>
                          <span className="m-skel block h-[14px] w-12 rounded" />
                        </div>
                      ))}
                      <span className="text-xs text-[var(--muted)]">
                        Running the rules over {leads(assignable)}{assignable > 150 ? ` · about ${Math.max(2, Math.round(assignable / 100))} s` : ""}
                      </span>
                    </>
                  ) : state.status === "error" ? (
                    <Callout tone={state.pending ? "warning" : "error"} title={state.message}>
                      <span className="mt-1 flex flex-wrap gap-2">
                        {state.tooSlow ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => setWay("pick")}>Pick leads myself</Button>
                        ) : !state.pending ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => void loadPreview(true)}>Try again</Button>
                        ) : null}
                      </span>
                    </Callout>
                  ) : preview && preview.total === 0 ? (
                    <p className="rounded-[10px] border border-[var(--border)] px-3 py-3 text-sm text-[var(--muted)]">Nothing in this list is waiting in the pool: every lead is owned or closed.</p>
                  ) : preview ? (
                    <>
                      {preview.per_owner.map((row) => (
                        <PersonRow
                          key={row.user_id}
                          row={row}
                          member={memberById.get(row.user_id) ?? null}
                          raisedTo={raised[row.user_id]}
                          busy={busy}
                          onRaised={(capacity) => capacityRaised(row.user_id, capacity)}
                        />
                      ))}
                      {preview.nobody.map((group) => (
                        <div key={`${group.state ?? ""}|${group.reason}`} className="flex items-center gap-3 rounded-[10px] border border-[var(--border)] px-3 py-2.5">
                          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--error-surface)] text-sm font-semibold text-[var(--error-ink)]">?</span>
                          <span className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="text-sm font-semibold text-[var(--ink)]">Nobody</span>
                            <span className="flex flex-wrap gap-1"><StatusChip tone="danger">{group.reason}</StatusChip></span>
                          </span>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--error-ink)]">{count(group.count)}</span>
                        </div>
                      ))}
                    </>
                  ) : null}
                </section>

                {lapsing.length > 0 && (
                  <p className="text-xs leading-[1.5] tracking-[-0.01em] text-[var(--warning-ink)]">
                    {lapsing.slice(0, 3).map(({ name, entry }) => `${name}'s own ${entry.state} licence is valid through ${shortDate(entry.expiresOn)}; the ${entry.state} leads they get here return to the pool on ${lapseDay(entry)}.`).join(" ")}
                    {lapsing.length > 3 ? ` And ${lapsing.length - 3} more.` : ""}
                  </p>
                )}

                {preview && nobody > 0 && (
                  <Callout tone="error" title={`${leads(nobody)} would land on nobody`} className="m-deny">
                    They stay in the pool, where nobody licensed can be served them. {nobodySummary(preview)}
                  </Callout>
                )}

                {commitError && <Callout tone="error" title="Nothing was assigned">{commitError}</Callout>}
              </>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--canvas)] px-[22px] py-3.5">
            <span className="inline-flex min-w-0 items-center gap-1 text-xs text-[var(--muted)]">
              {way === "rules" && (
                <>
                  <ScrollText className="size-3.5 shrink-0" aria-hidden="true" />
                  {/* The board said "with the rule version"; rules have no version number, so the entry
                      carries each published rule's id, priority and last change instead. */}
                  <InfoTip label="About the audit entry">Written to the audit log as one entry, with the rules as published.</InfoTip>
                  {blockedBy && !busy && <span id={whyId} className="text-[var(--body)]">{blockedBy}</span>}
                </>
              )}
            </span>
            <span className="ml-auto flex gap-2.5">
              <DialogPrimitive.Close asChild>
                <Button type="button" variant="outline" disabled={busy}>{way === "pick" ? "Close" : "Cancel"}</Button>
              </DialogPrimitive.Close>
              {way === "rules" && (
                <Button
                  type="button"
                  disabled={Boolean(blockedBy)}
                  aria-describedby={blockedBy && !busy ? whyId : undefined}
                  onClick={() => void commit()}
                >
                  {busy ? "Assigning…" : `Assign ${count(routable)}`}
                </Button>
              )}
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** One person in the preview: who, what they get and why, and how full that leaves them. */
function PersonRow({ row, member, raisedTo, busy, onRaised }: {
  row: LeadListOwnerRow;
  member: AssignDrawerMember | null;
  raisedTo: number | undefined;
  busy: boolean;
  onRaised: (capacity: number) => Promise<void>;
}) {
  const capacity = raisedTo ?? member?.capacity ?? null;
  const open = member?.currentOpen ?? null;
  const after = open == null ? null : open + row.gets;
  // Zero is no ceiling, as on the Leads picker.
  const ceiling = capacity != null && capacity > 0 ? capacity : null;
  const tone: MeterTone = ceiling == null || after == null ? "neutral" : after >= ceiling ? "warning" : after / ceiling >= 0.8 ? "info" : "good";
  const initial = (row.name.trim()[0] ?? "?").toUpperCase();
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-[var(--border)] px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--primary-soft)] text-sm font-semibold text-[var(--accent-ink)]">{initial}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-[var(--ink)]">{row.name}</span>
            {row.states.length > 0 && <span className="shrink-0 text-xs text-[var(--muted)]">{row.states.slice(0, 4).join(" · ")}{row.states.length > 4 ? ` +${row.states.length - 4}` : ""}</span>}
          </span>
          <span className="flex flex-wrap gap-1">
            {whyChips(row).map((chip) => <StatusChip key={chip.label} tone={chip.tone}>{chip.label}</StatusChip>)}
          </span>
        </span>
        <span className={cn("shrink-0 text-sm font-semibold tabular-nums", row.gets > 0 ? "text-[var(--ink)]" : "text-[var(--muted)]")}>gets {count(row.gets)}</span>
      </div>
      {after != null && (
        <div className="flex items-center gap-3 pl-11">
          <Meter value={after} max={ceiling ?? Math.max(after, 1)} tone={tone} label={`${row.name}: ${after} open of ${ceiling ?? "no ceiling"}`} className="flex-1" />
          <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">{count(after)}{ceiling != null ? ` of ${count(ceiling)}` : ""} open</span>
          {row.capacity_skips > 0 && member && <RaiseCapacity userId={member.id} name={row.name} capacity={capacity ?? 0} disabled={busy} onRaised={onRaised} />}
        </div>
      )}
    </div>
  );
}

/**
 * "Raise capacity" for one agent, in place: the Route step's own write (PATCH /api/app/assignments
 * { userId, maxOpenLeads }), behind the same owner/producer gate the preview already passed.
 */
function RaiseCapacity({ userId, name, capacity, disabled, onRaised }: {
  userId: string; name: string; capacity: number; disabled: boolean; onRaised: (capacity: number) => Promise<void>;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(capacity + 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const next = Number(value);
  const valid = Number.isInteger(next) && next > capacity && next <= 100000;

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/app/assignments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, maxOpenLeads: next }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.error ?? "Could not raise the capacity."); return; }
      notify.done(`${name} can hold ${count(next)} open leads`);
      setEditing(false);
      await onRaised(next);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => { setValue(String(capacity + 10)); setEditing(true); }}>Raise capacity</Button>;
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <label htmlFor={id} className="sr-only">New capacity for {name}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={capacity + 1}
        max={100000}
        value={value}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void save(); } if (event.key === "Escape") { event.stopPropagation(); setEditing(false); } }}
        aria-invalid={!valid}
        className={cn(control, "mt-0 h-8 w-20 tabular-nums")}
      />
      <Button type="button" size="sm" disabled={!valid || saving} onClick={() => void save()}>{saving ? "Saving…" : "Save"}</Button>
      <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => setEditing(false)}>Cancel</Button>
      {error && <span role="alert" className="w-full text-xs text-[var(--error-ink)]">{error}</span>}
    </span>
  );
}
