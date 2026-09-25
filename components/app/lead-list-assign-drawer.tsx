"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";
import { Callout, btn, control } from "@/components/app/settings/primitives";
import { LICENCE_WARNING_DAYS, LIST_CHANGED_MESSAGE, daysUntil, lapseDay, ownerWhy, shortDate, type LeadListAssignMode, type LeadListAssignmentPreview, type LicenceExpiry } from "@/lib/assignment/constants";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

/**
 * "Assign N leads" — the board's p-ov-assign-drawer. Opens from a lead list's page and moves every
 * unowned pool lead in the list in ONE transaction (assign_lead_list, 20260924342000): all the
 * routable ones, or none. What the table shows is not an estimate: it is the real router run over
 * every one of those leads and rolled back (assign_lead_list_preview), and the commit refuses if the
 * number it would move is not the number shown here.
 *
 * Built on the Radix Dialog primitive directly (focus trap, Escape, focus back to the trigger)
 * because the shared DialogContent is centred and this is a right-hand drawer.
 */

type Member = { id: string; name: string; role: string; status: string; capacity: number; currentOpen: number; licenceExpiring?: LicenceExpiry[] };

const MODE_LABEL: Record<LeadListAssignMode, string> = {
  chain: "The published rule chain",
  owner: "One owner",
  // The board says "across a team"; there are no teams, so the choice is of members.
  round_robin: "Round robin across members",
};

const count = (value: number) => value.toLocaleString("en-US");
const leads = (value: number) => `${count(value)} ${value === 1 ? "lead" : "leads"}`;
const REASON_MAX = 500;

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; preview: LeadListAssignmentPreview }
  | { status: "error"; message: string; pending: boolean };

export function LeadListAssignDrawer({ campaignId, listName, assignable }: { campaignId: string; listName: string; assignable: number }) {
  const router = useRouter();
  const ids = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<LeadListAssignMode>("chain");
  const [owner, setOwner] = useState("");
  const [rotation, setRotation] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [reasonTouched, setReasonTouched] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [membersError, setMembersError] = useState("");
  const [state, setState] = useState<PreviewState>({ status: "idle" });
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [commitError, setCommitError] = useState("");
  const request = useRef(0);

  const userIds = useMemo(() => (mode === "owner" ? (owner ? [owner] : []) : mode === "round_robin" ? rotation : []), [mode, owner, rotation]);
  const needsPeople = mode !== "chain" && userIds.length === 0;

  const loadPreview = useCallback(async () => {
    const ticket = ++request.current;
    if (needsPeople) { setState({ status: "idle" }); return; }
    setState({ status: "loading" });
    const params = new URLSearchParams({ view: "list_preview", campaign_id: campaignId, mode });
    if (userIds.length) params.set("user_ids", userIds.join(","));
    try {
      const response = await fetch(`/api/app/assignments?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (ticket !== request.current) return;
      if (!response.ok) {
        setState({ status: "error", message: body?.error ?? "Could not work out who would get these leads.", pending: response.status === 503 });
        return;
      }
      setState({ status: "ready", preview: body.preview as LeadListAssignmentPreview });
    } catch {
      if (ticket === request.current) setState({ status: "error", message: "Could not reach the server to preview this assignment.", pending: false });
    }
  }, [campaignId, mode, needsPeople, userIds]);

  // The roster, with how full each person is, from the same read the Lead assignment page uses.
  useEffect(() => {
    if (!open || members) return;
    let live = true;
    fetch("/api/app/assignments", { cache: "no-store" })
      .then(async (response) => ({ ok: response.ok, body: await response.json().catch(() => null) }))
      .then(({ ok, body }) => {
        if (!live) return;
        if (!ok) { setMembersError(body?.error ?? "Could not load the members who can take leads."); return; }
        setMembers(((body?.members ?? []) as Member[]).filter((member) => member.status === "active"));
      })
      .catch(() => { if (live) setMembersError("Could not load the members who can take leads."); });
    return () => { live = false; };
  }, [open, members]);

  useEffect(() => {
    if (!open) return;
    // Asynchronous: the state it sets lands after the fetch, not during this effect.
    const timer = window.setTimeout(() => { void loadPreview(); }, 0);
    return () => window.clearTimeout(timer);
  }, [open, loadPreview]);

  function reset() {
    request.current += 1;
    setState({ status: "idle" });
    setChanged(false);
    setCommitError("");
    setReasonTouched(false);
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
  const trimmedReason = reason.trim();
  const reasonMissing = mode !== "chain" && trimmedReason.length === 0;
  const capacitySkips = preview?.per_owner.some((row) => row.capacity_skips > 0) ?? false;
  // Owners who would get leads in a state where their own licence lapses within the warning window:
  // those leads go back to the pool on the day it lapses (20260925702200).
  const lapsing = (preview?.per_owner ?? []).flatMap((row) => {
    if (row.gets === 0) return [];
    const member = (members ?? []).find((item) => item.id === row.user_id);
    return (member?.licenceExpiring ?? [])
      .filter((entry) => row.states.includes(entry.state) && daysUntil(entry.expiresOn) >= 0 && daysUntil(entry.expiresOn) <= LICENCE_WARNING_DAYS)
      .map((entry) => ({ name: row.name, entry }));
  });

  const blockedBy =
    busy ? "Assigning…"
      : needsPeople ? (mode === "owner" ? "Choose the owner first." : "Choose at least one member first.")
        : state.status === "loading" || state.status === "idle" ? "Waiting for the preview."
          : state.status === "error" ? "The preview did not run, so there is nothing to confirm."
            : routable === 0 ? "None of these leads can be assigned right now."
              : reasonMissing ? "Give a reason for overriding the rule chain."
                : null;

  async function commit() {
    if (blockedBy || !preview) return;
    setBusy(true);
    setCommitError("");
    try {
      const response = await fetch("/api/app/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign_list", campaignId, mode, userIds, reason: mode === "chain" ? null : trimmedReason, expected: preview.routable }),
      });
      const body = await response.json().catch(() => null);
      if (response.status === 409 && body?.code === "list_changed") {
        setBusy(false);
        setChanged(true);
        await loadPreview();
        return;
      }
      if (!response.ok) {
        setBusy(false);
        setCommitError(body?.error ?? "Could not assign the list.");
        return;
      }
      const moved = typeof body?.routable === "number" ? body.routable : preview.routable;
      const left = typeof body?.nobody_count === "number" ? body.nobody_count : 0;
      notify.done(`${leads(moved)} assigned`, left ? { detail: `${leads(left)} stay unassigned in the pool.` } : undefined);
      setBusy(false);
      setOpen(false);
      reset();
      setReason("");
      router.refresh();
    } catch {
      setBusy(false);
      setCommitError("Could not reach the server. Nothing was assigned.");
    }
  }

  function nobodySummary(p: LeadListAssignmentPreview) {
    const groups = p.nobody;
    const listed = groups.slice(0, 3).map((group) => `${group.reason} (${count(group.count)})`).join("; ");
    const more = groups.length > 3 ? `; and ${groups.length - 3} more reasons` : "";
    const detail = groups.find((group) => group.detail)?.detail;
    return `${listed}${more}.${detail ? ` ${detail}` : ""}`;
  }

  const modeId = `${ids}-mode`;
  const ownerId = `${ids}-owner`;
  const reasonId = `${ids}-reason`;
  const whyId = `${ids}-why`;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Trigger asChild>
        <Button type="button" className="h-11 px-4">Assign the {count(assignable)}</Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgba(10,12,16,0.55)] transition-opacity duration-200 starting:opacity-0" />
        <DialogPrimitive.Content
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col overflow-hidden border-l border-[var(--border-strong)] bg-[var(--surface)] shadow-[-24px_0_64px_rgba(0,0,0,0.24)] outline-none sm:w-[600px]",
            // Slides in from the right. @starting-style, so no keyframes are needed; the global
            // reduced-motion rule cuts the transition to nothing.
            "transition-transform duration-[260ms] ease-[cubic-bezier(.16,1,.3,1)] starting:translate-x-full motion-reduce:transition-none",
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border)] px-[22px] py-[18px]">
            <div className="min-w-0">
              <DialogPrimitive.Title className="m-0 text-[18px] leading-[1.28] font-semibold tracking-[-0.015em] text-[var(--ink)]">
                Assign {leads(total)}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-[5px] text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">
                {listName} · the usable remainder
              </DialogPrimitive.Description>
            </div>
            <div className="flex items-center gap-3.5">
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
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto p-[22px]">
            <div className="block">
              <label htmlFor={modeId} className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Assign by</label>
              <select id={modeId} className={control} value={mode} disabled={busy} onChange={(event) => { setMode(event.target.value as LeadListAssignMode); setChanged(false); setCommitError(""); }}>
                {(Object.keys(MODE_LABEL) as LeadListAssignMode[]).map((value) => <option key={value} value={value}>{MODE_LABEL[value]}</option>)}
              </select>
              {/* The board said "what the dialer already follows"; the dialer serves what is assigned
                  and follows no rules. Assign next is what walks the chain. */}
              <span className="mt-1.5 block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">The chain is what Assign next follows. Overriding it here is a one-off.</span>
            </div>

            {mode !== "chain" && (
              <>
                {membersError ? (
                  <Callout tone="error" title="Could not load the members">{membersError}</Callout>
                ) : mode === "owner" ? (
                  <div className="block">
                    <label htmlFor={ownerId} className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Owner</label>
                    <select id={ownerId} className={control} value={owner} disabled={busy || !members} onChange={(event) => { setOwner(event.target.value); setChanged(false); }}>
                      <option value="">{members ? "Choose a member…" : "Loading members…"}</option>
                      {(members ?? []).map((member) => (
                        <option key={member.id} value={member.id}>{member.name} · {count(member.currentOpen)} of {count(member.capacity)} open</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <fieldset className="m-0 min-w-0 border-0 p-0">
                    <legend className="p-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Members, in turn</legend>
                    {!members ? (
                      <p className="mt-1.5 text-[14px] leading-[1.5] text-[var(--muted)]">Loading members…</p>
                    ) : members.length === 0 ? (
                      <p className="mt-1.5 text-[14px] leading-[1.5] text-[var(--muted)]">Nobody in this workspace can be given leads yet.</p>
                    ) : (
                      <div className="mt-1.5 max-h-[220px] overflow-y-auto rounded-[8px] border border-[var(--border-strong)]">
                        {members.map((member, index) => {
                          const id = `${ids}-rr-${member.id}`;
                          const checked = rotation.includes(member.id);
                          return (
                            <label key={member.id} htmlFor={id} className={cn("flex cursor-pointer items-center gap-3 px-3 py-2.5 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)] hover:bg-[var(--surface-alt)]", index > 0 && "border-t border-[var(--border)]")}>
                              <input
                                id={id}
                                type="checkbox"
                                className="size-4 shrink-0 accent-[var(--primary)]"
                                checked={checked}
                                disabled={busy}
                                onChange={(event) => { setRotation((current) => event.target.checked ? [...current, member.id] : current.filter((value) => value !== member.id)); setChanged(false); }}
                              />
                              <span className="min-w-0 flex-1 truncate font-semibold text-[var(--ink)]">{member.name}</span>
                              <span className="shrink-0 text-[12px] tabular-nums text-[var(--muted)]">{count(member.currentOpen)} of {count(member.capacity)} open</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                    <span className="mt-1.5 block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">Each lead goes to the next member in this order who may take it.</span>
                  </fieldset>
                )}
                <div className="block">
                  <label htmlFor={reasonId} className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">
                    Reason<span className="text-[var(--error-ink)]"> *</span>
                  </label>
                  <textarea
                    id={reasonId}
                    required
                    maxLength={REASON_MAX}
                    rows={3}
                    value={reason}
                    disabled={busy}
                    aria-invalid={reasonTouched && reasonMissing}
                    onBlur={() => setReasonTouched(true)}
                    onChange={(event) => setReason(event.target.value)}
                    className={cn(control, "h-auto min-h-[88px] resize-y py-2.5")}
                  />
                  {reasonTouched && reasonMissing ? (
                    <span role="alert" className="mt-1.5 block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--error-ink)]">Give a reason for overriding the rule chain.</span>
                  ) : (
                    <span className="mt-1.5 block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">Recorded on every move and in the audit log. It also lets a move go through inside a household&apos;s rest days.</span>
                  )}
                </div>
              </>
            )}

            {changed && <Callout tone="warning" title={LIST_CHANGED_MESSAGE}>Nothing was assigned. The numbers below are from a fresh run.</Callout>}

            <div>
              <div className="mb-2 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">
                {mode === "chain" ? "What the chain would do" : "What this would do"}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[440px] border-collapse" aria-busy={state.status === "loading"}>
                  <thead>
                    <tr className="bg-[var(--surface-alt)]">
                      <th scope="col" className="px-3 py-2 text-left text-[12px] leading-[1.33] font-semibold tracking-[0.02em] text-[var(--muted)] uppercase">Owner</th>
                      <th scope="col" className="w-[110px] px-3 py-2 text-right text-[12px] leading-[1.33] font-semibold tracking-[0.02em] text-[var(--muted)] uppercase">Gets</th>
                      <th scope="col" className="w-[210px] px-3 py-2 text-left text-[12px] leading-[1.33] font-semibold tracking-[0.02em] text-[var(--muted)] uppercase">Why</th>
                    </tr>
                  </thead>
                  <tbody className="m-seq">
                    {preview ? (
                      preview.total === 0 ? (
                        <PlainRow>Nothing in this list is waiting in the pool: every lead is owned or closed.</PlainRow>
                      ) : (
                        <>
                          {preview.per_owner.map((row) => (
                            <tr key={row.user_id} className="m-row">
                              <Cell>{row.name}</Cell>
                              <Cell className="text-right tabular-nums">{count(row.gets)}</Cell>
                              <Cell>{ownerWhy(row)}</Cell>
                            </tr>
                          ))}
                          {preview.nobody.map((group) => (
                            <tr key={`${group.state ?? ""}|${group.reason}`} className="m-row">
                              <Cell>Nobody</Cell>
                              <Cell className="text-right tabular-nums">{count(group.count)}</Cell>
                              <Cell>{group.reason}</Cell>
                            </tr>
                          ))}
                        </>
                      )
                    ) : state.status === "loading" ? (
                      [0, 1, 2].map((index) => (
                        <tr key={index}>
                          <Cell><span className="m-skel block h-[14px] w-32 rounded" aria-hidden="true" /></Cell>
                          <Cell><span className="m-skel ml-auto block h-[14px] w-10 rounded" aria-hidden="true" /></Cell>
                          <Cell><span className="m-skel block h-[14px] w-36 rounded" aria-hidden="true" />{index === 0 && <span className="sr-only">Running the router over the list…</span>}</Cell>
                        </tr>
                      ))
                    ) : state.status === "error" ? (
                      <PlainRow>
                        <span className={state.pending ? "text-[var(--warning-ink)]" : "text-[var(--error-ink)]"} role="alert">{state.message}</span>
                        {!state.pending && <button type="button" className={cn(btn("secondary"), "ml-3 align-middle")} onClick={() => void loadPreview()}>Try again</button>}
                      </PlainRow>
                    ) : (
                      <PlainRow>{mode === "owner" ? "Choose an owner to see what this would do." : mode === "round_robin" ? "Choose the members to rotate between to see what this would do." : "Working out who gets what…"}</PlainRow>
                    )}
                  </tbody>
                </table>
              </div>
              {capacitySkips && (
                // User decision: capacity is respected, with no override from here.
                <p className="mt-2 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--warning-ink)]">
                  Agents at capacity get no more. <Link href="/app/assignments" className="font-semibold text-inherit underline underline-offset-2">Raise capacity on Lead assignment</Link> to assign more.
                </p>
              )}
              {lapsing.length > 0 && (
                <p className="mt-2 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--warning-ink)]">
                  {lapsing.slice(0, 3).map(({ name, entry }) => `${name}'s own ${entry.state} licence is valid through ${shortDate(entry.expiresOn)}; the ${entry.state} leads they get here return to the pool on ${lapseDay(entry)}.`).join(" ")}
                  {lapsing.length > 3 ? ` And ${lapsing.length - 3} more.` : ""}
                </p>
              )}
            </div>

            {preview && nobody > 0 && (
              <Callout tone="error" title={`${leads(nobody)} would land on nobody`} className="m-deny">
                They stay in the pool, where nobody licensed can be served them. {nobodySummary(preview)}
              </Callout>
            )}

            {/* Nothing routable: "all 0 move, or none do" says nothing, and the nobody callout and
                the disabled button already explain why. */}
            {preview && preview.total > 0 && routable > 0 && (
              <Callout tone="info" title="This runs as one transaction">
                All {count(routable)} routable {routable === 1 ? "lead moves" : "leads move"}, or none do.{nobody > 0 ? ` The other ${count(nobody)} stay unassigned.` : ""} A half-assigned list is the state that produces two agents calling the same person.
              </Callout>
            )}

            {commitError && <Callout tone="error" title="Nothing was assigned">{commitError}</Callout>}

            {/* The per-lead picker (lead-list-workspace's hash view) stays one click away. */}
            <p className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
              Rather choose the leads yourself? <Link href={`/app/lead-lists#${campaignId}`} className="font-semibold text-[var(--accent-ink)] underline-offset-2 hover:underline">Pick leads one by one</Link>
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] bg-[var(--canvas)] px-[22px] py-3.5">
            <span className="max-w-[380px] text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
              {/* The board said "with the rule version"; rules have no version number, so the entry
                  carries each published rule's id, priority and last change instead. */}
              Written to the audit log as one entry, with the rules as published.
              {blockedBy && !busy && <span id={whyId} className="mt-0.5 block text-[var(--body)]">{blockedBy}</span>}
            </span>
            <span className="ml-auto flex gap-2.5">
              <DialogPrimitive.Close asChild>
                <button type="button" className={btn("secondary", "h-10")} disabled={busy}>Cancel</button>
              </DialogPrimitive.Close>
              <button
                type="button"
                className={btn("primary")}
                disabled={Boolean(blockedBy)}
                aria-describedby={blockedBy && !busy ? whyId : undefined}
                onClick={() => void commit()}
              >
                {busy ? "Assigning…" : `Assign ${count(routable)}`}
              </button>
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Cell({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cn("border-t border-[var(--border)] px-3 py-2 text-left text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]", className)}>{children}</td>;
}

function PlainRow({ children }: { children: ReactNode }) {
  return (
    <tr>
      <td colSpan={3} className="border-t border-[var(--border)] px-3 py-3 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">{children}</td>
    </tr>
  );
}
