"use client";

import { useState } from "react";
import { Check, CheckCircle2, ChevronRight, PhoneCall, PhoneForwarded, PhoneOff, UserPlus, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { cardTitle, type PartnerMessage } from "@/lib/partnerChat/cards";
import { LEAD_STATE_LABEL, LEAD_STEPS, leadLanes, type LeadState, type LeadStep } from "@/lib/partnerChat/leadLanes";
import { cn } from "@/lib/utils";

/**
 * An automatic lead update in the thread (owner, 2026-10-28): a card of its own with room around it,
 * saying what happened and to whom. A click opens the lead — where it is now, the four steps, the
 * facts (product, state, agent, outcome, how fast it was picked up) and every update about it.
 */

const clock = (value: string) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
const text = (value: unknown) => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null);
const titleOf = (message: PartnerMessage) => (message.cardType === "call_dropped" || (message.cardType === "call_outcome" && message.cardPayload.closes_as === "dropped") ? "Call dropped" : cardTitle(message));

function look(message: PartnerMessage) {
  const payload = message.cardPayload;
  if (message.cardType === "call_dropped" || payload.closes_as === "dropped") return { Icon: PhoneOff, tile: "bg-[var(--error-surface)] text-[var(--error-ink)]" };
  if (message.cardType === "call_outcome") return payload.counts_as_work_completed === true ? { Icon: CheckCircle2, tile: "bg-[var(--success-surface)] text-[var(--success-ink)]" } : { Icon: Check, tile: "bg-[var(--surface-alt)] text-[var(--body)]" };
  if (message.cardType === "new_lead") return { Icon: UserPlus, tile: "bg-[var(--info-surface)] text-[var(--info-ink)]" };
  if (message.cardType === "connected") return { Icon: PhoneCall, tile: "bg-[var(--primary-soft)] text-[var(--accent-ink)]" };
  if (message.cardType === "transferred") return { Icon: PhoneForwarded, tile: "bg-[var(--primary-soft)] text-[var(--accent-ink)]" };
  return { Icon: Zap, tile: "bg-[var(--surface-alt)] text-[var(--body)]" };
}

const STATE_TONE: Record<LeadState, StatusTone> = { waiting: "info", live: "action", won: "good", dropped: "danger", closed: "neutral" };
const STEP_LABEL: Record<LeadStep, string> = { new_lead: "Sent", connected: "Connected", transferred: "Transferred", outcome: "Outcome" };

/** One update in the thread. `thread` is the conversation's messages, so the lead can be rebuilt on click. */
export function LeadUpdate({ message, thread }: { message: PartnerMessage; thread: PartnerMessage[] }) {
  const [open, setOpen] = useState(false);
  const { Icon, tile } = look(message);
  const payload = message.cardPayload;
  const customer = text(payload.customer);
  const facts = [text(payload.product), text(payload.state), message.cardType === "call_outcome" ? text(payload.disposition) : null, text(payload.agent) && message.cardType !== "new_lead" ? `by ${text(payload.agent)}` : null].filter(Boolean).join(" · ");
  const clickable = Boolean(message.workItemId);
  const body = (
    <>
      <span aria-hidden="true" className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-lg", tile)}><Icon className="size-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-foreground">{titleOf(message)}{customer ? <span className="font-medium text-[var(--body)]"> · {customer}</span> : null}</span>
        </span>
        {facts && <span className="block truncate text-xs text-muted-foreground">{facts}</span>}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{clock(message.createdAt)}</span>
      {clickable && <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover/update:translate-x-0.5" aria-hidden="true" />}
    </>
  );
  return (
    <article aria-label="Automatic update" className="my-2 max-w-[820px]">
      {clickable ? (
        <button type="button" onClick={() => setOpen(true)} className="group/update flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left shadow-[var(--shadow-rest)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-alt)]" title="Open this lead">
          {body}
        </button>
      ) : (
        <div className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5">{body}</div>
      )}
      {open && <LeadDialog message={message} thread={thread} onClose={() => setOpen(false)} />}
    </article>
  );
}

function LeadDialog({ message, thread, onClose }: { message: PartnerMessage; thread: PartnerMessage[]; onClose: () => void }) {
  const lane = leadLanes(thread.filter((item) => item.workItemId === message.workItemId))[0];
  const steps = lane?.steps ?? [message];
  // The newest value each fact has had across the lead's updates.
  const fact = (key: string) => [...steps].reverse().map((step) => text(step.cardPayload[key])).find(Boolean) ?? null;
  const outcome = [...steps].reverse().find((step) => step.cardType === "call_outcome" || step.cardType === "call_dropped");
  const pickedUp = steps.find((step) => typeof step.cardPayload.minutes_after_submission === "number")?.cardPayload.minutes_after_submission as number | undefined;
  const rows: Array<[string, string | null]> = [
    ["Product", fact("product")],
    ["State", fact("state")],
    ["Agent", steps.some((step) => step.cardType !== "new_lead") ? fact("agent") : null],
    ["Outcome", outcome ? (outcome.cardType === "call_dropped" ? "Call dropped" : fact("disposition")) : null],
    ["Picked up", pickedUp === undefined ? null : pickedUp === 0 ? "Under a minute after it was sent" : `${pickedUp} ${pickedUp === 1 ? "minute" : "minutes"} after it was sent`],
    ["Counts as completed", typeof outcome?.cardPayload.counts_as_work_completed === "boolean" ? (outcome.cardPayload.counts_as_work_completed ? "Yes" : "No") : null],
  ];
  const state = lane?.state ?? "waiting";
  // A lead that moved on was sent, even when its "new lead" card names no work item (it is posted
  // before one exists); when it was sent is then read back from how long the pickup took.
  const reachedStep = (step: LeadStep) => (step === "new_lead" ? steps.length > 0 : lane?.reached[step] ?? false);
  const connected = steps.find((step) => step.cardType === "connected");
  const sentAt = lane?.reached.new_lead ? lane.firstAt : connected && pickedUp !== undefined ? new Date(new Date(connected.createdAt).getTime() - pickedUp * 60_000).toISOString() : null;
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="gap-5">
        <DialogHeader className="gap-1.5 pr-8 text-left">
          <DialogTitle>{lane?.customer ?? text(message.cardPayload.customer) ?? "Lead"}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <StatusChip tone={STATE_TONE[state]}>{LEAD_STATE_LABEL[state]}</StatusChip>
            {sentAt && <span>Sent {new Date(sentAt).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false })}</span>}
          </DialogDescription>
        </DialogHeader>

        {/* Where it is: the four steps, the failed outcome in red. */}
        <ol className="m-0 grid list-none grid-cols-4 gap-2 p-0" aria-label="Progress">
          {LEAD_STEPS.map((step) => {
            const reached = reachedStep(step);
            const failed = step === "outcome" && state === "dropped";
            return (
              <li key={step} className="flex flex-col gap-1.5">
                <span className={cn("h-1.5 rounded-full", !reached ? "bg-[var(--surface-alt)]" : failed ? "bg-[var(--error)]" : "bg-[var(--primary)]")} aria-hidden="true" />
                <span className={cn("text-xs", reached ? "font-semibold text-foreground" : "text-muted-foreground")}>{STEP_LABEL[step]}{reached ? "" : " · not yet"}</span>
              </li>
            );
          })}
        </ol>

        <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 rounded-xl bg-[var(--surface-alt)] p-4 sm:grid-cols-2">
          {rows.filter(([, value]) => value).map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="m-0 text-sm font-semibold text-foreground">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-col gap-2">
          <h3 className="m-0 text-label text-[var(--body)]">Updates · {steps.length}</h3>
          <ol className="m-0 flex list-none flex-col p-0">
            {steps.map((step, index) => {
              const { Icon, tile } = look(step);
              return (
                <li key={step.id} className="relative flex gap-3 pb-3 last:pb-0">
                  {index < steps.length - 1 && <span className="absolute top-8 bottom-0 left-[15px] w-px bg-border" aria-hidden="true" />}
                  <span aria-hidden="true" className={cn("relative inline-flex size-8 shrink-0 items-center justify-center rounded-lg", tile)}><Icon className="size-4" /></span>
                  <span className="min-w-0 flex-1 pt-0.5">
                    <span className="flex items-baseline justify-between gap-3"><strong className="text-sm font-semibold text-foreground">{titleOf(step)}</strong><span className="shrink-0 text-xs tabular-nums text-muted-foreground">{clock(step.createdAt)}</span></span>
                    <span className="block text-sm leading-relaxed text-[var(--body)]">{step.message}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </DialogContent>
    </Dialog>
  );
}
