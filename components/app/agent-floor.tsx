"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Callout, Pill, SettingsTableCard, btn, st, type PillTone } from "@/components/app/settings/primitives";
import { productLineLabel } from "@/lib/format/productLine";
import { sectionForPath } from "@/lib/menu/definition";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { clockTime as zonedClock, dayMonth, dayMonthYear, viewerTimeZone, zonedParts } from "@/lib/format/dates";

type Availability = "ready" | "on_break" | "off";

type Lead = {
  id: string;
  leadId: string;
  customer: string;
  age: string;
  state: string;
  partnerName: string;
  productLine: string;
  screeningOutcome: string;
  screeningWarning: string | null;
  duplicateWarning: boolean;
  preflightStatus: string;
  preflight: { matches?: Array<{ partnerName: string | null }> } | null;
  queuedAt: string;
  ownerName: string | null;
  language?: string | null;
  phone?: string | null;
  /** Escalated by the unclaimed-SLA ladder; still unclaimed. */
  escalatedAt?: string | null;
  status?: string;
};

type Call = Lead & {
  activeCallId: string;
  agentId: string;
  agentName: string;
  agentRole: string;
  startedAt: string;
  verificationPercent?: number | null;
  /** The buffer who handed this call over and is still on it. */
  buffer?: { userId: string; name: string } | null;
};

type Member = {
  id: string;
  name: string;
  role: string;
  availability: "ready" | "on_break" | "off" | "offline" | "on_call";
  away?: boolean;
  lastSeenAt: string | null;
  statusChangedAt?: string | null;
  call?: { workItemId: string; leadId: string; customer: string; partnerName: string | null; startedAt: string } | null;
  lastCall?: { customer: string; endedAt: string } | null;
  languages?: string[];
  /** A buffer still on a call they handed over. */
  supporting?: boolean;
};

type Handoff = {
  id: string;
  workItemId: string;
  bufferName: string;
  customer: string;
  productLine: string;
  progressPercentage: number;
  expiresAt: string;
  /** Required fields the buffer left outstanding; null when unknown. */
  fieldsLeft?: number | null;
};

type Callback = {
  id: string;
  leadId: string;
  customerName: string;
  customerTime: string;
  customerTimezone: string;
  note: string | null;
  isOverdue: boolean;
  isDueToday: boolean;
  productName?: string;
  assigneeName?: string;
};

export type FloorData = {
  waiting: Lead[];
  onCalls: Call[];
  available: Member[];
  members: Member[];
  pendingHandoffs: Handoff[];
  callbacks: Callback[];
  realtimeTopic: string;
  generatedAt: string;
  waitThresholds: { amberSeconds: number; redSeconds: number };
  /** Your saved status; the floor starts from it and never assumes "ready". */
  ownStatus?: Availability;
  closedTransfers?: { thisHour: number | null; previousHour: number | null };
  /** The floor read reached its 500-row cap; the newest 500 open transfers are shown. */
  truncated?: boolean;
};

/** The safety re-read behind realtime (LA-1.15-2): slow while Live, a little faster while the socket is down. */
const SAFETY_RESYNC_LIVE_MS = 30_000;
const SAFETY_RESYNC_OFFLINE_MS = 10_000;

/* ── time ──────────────────────────────────────────────────────────────── */

function secondsSince(value: string, now: number) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, Math.floor((now - timestamp) / 1000)) : 0;
}

/** "4m 12s", the queue's wait. */
function waitLabel(seconds: number) {
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/**
 * "6:12", a call's running length. Past a day it reads "6d 22h": a call record open that long is
 * one nobody closed, and a stopwatch reading "166:16:24" hides that instead of saying it.
 */
function callClock(seconds: number) {
  if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)}d ${Math.floor((seconds % 86_400) / 3600)}h`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** "45s", "2m", "1h 5m" — how long someone has been idle or in wrap-up. */
function shortDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** A threshold in settings seconds: 120 → "2m", 90 → "1m 30s", 45 → "45s". */
function thresholdLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (!minutes) return `${rest}s`;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

/** "14:02" today, "Sep 23, 14:02" before. */
function clockTime(value: string, now: number) {
  const zone = viewerTimeZone(); // the floor loads in an effect, so this runs after mount
  if (!zonedParts(value, zone)) return "";
  const time = zonedClock(value, zone);
  return dayMonthYear(now, zone) === dayMonthYear(value, zone) ? time : `${dayMonth(value, zone)}, ${time}`;
}

/* ── languages: a lead's and an agent's are both free text ("Spanish", "es") ── */

const LANGUAGE_CODES: Record<string, string> = { es: "spanish", en: "english", fr: "french", pt: "portuguese", zh: "chinese", vi: "vietnamese", ko: "korean", tl: "tagalog", ar: "arabic", ru: "russian", ht: "haitian creole" };
function languageKey(value: string) {
  const lower = value.trim().toLowerCase();
  return LANGUAGE_CODES[lower] ?? lower;
}
function languageName(value: string) {
  const key = languageKey(value);
  return key ? key[0].toUpperCase() + key.slice(1) : value;
}
/** English needs no pairing; any other recorded language asks who on the floor speaks it. */
function needsPairing(language: string | null | undefined) {
  return Boolean(language && language.trim() && languageKey(language) !== "english");
}

/* ── the queue's judgement calls (unchanged rules) ─────────────────────── */

function priorityFor(item: Lead, now: number, thresholds: FloorData["waitThresholds"]) {
  const wait = secondsSince(item.queuedAt, now);
  if (wait >= thresholds.redSeconds || item.duplicateWarning || item.preflightStatus === "already_customer") return "high" as const;
  if (wait >= thresholds.amberSeconds || item.screeningWarning || item.preflightStatus === "spoken_before") return "medium" as const;
  return "low" as const;
}

function eligibilityFor(item: Lead) {
  if (item.preflightStatus === "already_customer" || item.duplicateWarning) return "blocked" as const;
  if (item.screeningWarning || item.preflightStatus === "spoken_before") return "review" as const;
  return "eligible" as const;
}

function screeningNote(item: Lead) {
  if (item.screeningWarning) return item.screeningWarning;
  if (item.preflight?.matches?.[0]?.partnerName) return `Previous lead from ${item.preflight.matches[0].partnerName}. Policy matching is not included yet.`;
  if (item.preflightStatus !== "new_household") return "Prior contact found. Policy matching is not included yet.";
  return "Interested in a new policy and ready for a licensed handoff.";
}

function waitTone(seconds: number, thresholds: FloorData["waitThresholds"]) {
  if (seconds >= thresholds.redSeconds) return "text-[var(--error-ink)]";
  if (seconds >= thresholds.amberSeconds) return "text-[var(--warning-ink)]";
  return "text-[var(--ink)]";
}

const PRIORITY: Record<ReturnType<typeof priorityFor>, { tone: PillTone; label: string }> = {
  high: { tone: "error", label: "High priority" },
  medium: { tone: "warning", label: "Medium priority" },
  low: { tone: "neutral", label: "Low priority" },
};
const ELIGIBILITY: Record<ReturnType<typeof eligibilityFor>, { tone: PillTone; label: string }> = {
  eligible: { tone: "success", label: "Eligible" },
  review: { tone: "warning", label: "Review" },
  blocked: { tone: "error", label: "Blocked" },
};

/* ── the roster's reading of a member ──────────────────────────────────── */

type RosterState = "available" | "on_call" | "away" | "wrap_up" | "offline";

function isStale(lastSeenAt: string | null, now: number) {
  return !lastSeenAt || now - new Date(lastSeenAt).getTime() > 60_000;
}

function rosterState(member: Member, now: number): RosterState {
  if (member.availability === "on_call") return member.away || isStale(member.lastSeenAt, now) ? "away" : "on_call";
  if (isStale(member.lastSeenAt, now)) return "offline";
  if (member.availability === "ready") return "available";
  if (member.availability === "on_break") return "wrap_up";
  return "offline";
}

const STATE_PILL: Record<RosterState, { tone: PillTone; label: string }> = {
  available: { tone: "success", label: "Available" },
  on_call: { tone: "brand", label: "On a call" },
  away: { tone: "error", label: "Away" },
  wrap_up: { tone: "warning", label: "Wrap-up" },
  offline: { tone: "neutral", label: "Offline" },
};
const STATE_ORDER: RosterState[] = ["available", "on_call", "away", "wrap_up", "offline"];

function doingLabel(member: Member, state: RosterState, now: number) {
  const since = member.statusChangedAt ? new Date(member.statusChangedAt).getTime() : null;
  if (state === "on_call" && member.supporting && member.call) return `Supporting ${member.call.customer}`;
  if (state === "on_call") return member.call ? [member.call.customer, member.call.partnerName].filter(Boolean).join(" · ") : "On a call";
  if (state === "away") return member.call ? `Holding ${member.call.customer}` : "Holding a call";
  if (state === "available") {
    // Idle since the later of becoming available and finishing a call.
    const ended = member.lastCall ? new Date(member.lastCall.endedAt).getTime() : null;
    const from = Math.max(since ?? 0, ended ?? 0);
    return from ? `Idle ${shortDuration(Math.max(0, Math.floor((now - from) / 1000)))}` : "Idle";
  }
  if (state === "wrap_up") {
    if (since) return `Wrap-up ${shortDuration(Math.max(0, Math.floor((now - since) / 1000)))}`;
    return member.lastCall ? `After ${member.lastCall.customer}` : "Wrap-up";
  }
  // Offline. Present on the page but set to offline says when they went; otherwise when last seen.
  if (!isStale(member.lastSeenAt, now) && member.statusChangedAt) return `Offline since ${clockTime(member.statusChangedAt, now)}`;
  return member.lastSeenAt ? `Last seen ${clockTime(member.lastSeenAt, now)}` : "Not seen on the floor";
}

/* ── pieces ────────────────────────────────────────────────────────────── */

/** The board's KPI tile: radius 12, 16/18 padding, no shadow, 32px value. */
function Kpi({ label, value, foot, valueClassName }: { label: string; value: React.ReactNode; foot: React.ReactNode; valueClassName?: string }) {
  return (
    <div className="min-w-0 rounded-[12px] border border-[var(--border)] bg-[var(--surface)] px-[18px] py-4">
      <div className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">{label}</div>
      <div className={cn("text-[32px] leading-[1.13] font-semibold tracking-[-0.025em] tabular-nums text-[var(--ink)]", valueClassName)}>{value}</div>
      <div className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{foot}</div>
    </div>
  );
}

function StatusButton({ pressed, kind, disabled, onClick, children }: { pressed: boolean; kind: "primary" | "outline" | "ghost"; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  const look = {
    primary: "border-transparent bg-[var(--primary)] text-[var(--on-primary)] hover:bg-[var(--accent-hover)]",
    outline: "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-alt)]",
    ghost: cn("bg-transparent text-[var(--ink)] hover:bg-[var(--surface-alt)]", pressed ? "border-[var(--border-strong)]" : "border-transparent"),
  }[kind];
  return (
    <button type="button" aria-pressed={pressed} disabled={disabled} onClick={onClick} className={cn("inline-flex h-11 items-center justify-center gap-2 rounded-[8px] border px-4 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50", look)}>
      {pressed && <Check className="size-4" aria-hidden="true" />}
      {children}
    </button>
  );
}

function PendingHandoffs({ items, readOnly, saving, now, onAccept }: { items: Handoff[]; readOnly: boolean; saving: string | null; now: number; onAccept: (id: string, workItemId: string) => void }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="handoffs-heading" className="rounded-[12px] border border-[var(--border)] border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-4 py-3.5">
      <h2 id="handoffs-heading" className="m-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--info-ink)]">
        {items.length === 1 ? "A handoff is waiting for you" : `${items.length} handoffs are waiting for you`}
      </h2>
      <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
        {items.map((handoff) => (
          <li key={handoff.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
            <span className="min-w-0">
              <span className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{handoff.customer}</span>
              <span className={st.sub}>
                From {handoff.bufferName} · {productLineLabel(handoff.productLine)} · {handoff.progressPercentage}% verified
                {handoff.fieldsLeft != null ? (handoff.fieldsLeft === 0 ? " · every required field confirmed" : ` · ${handoff.fieldsLeft} required ${handoff.fieldsLeft === 1 ? "field" : "fields"} left`) : ""}
                {handoff.expiresAt && new Date(handoff.expiresAt).getTime() > now ? ` · offer ends ${clockTime(handoff.expiresAt, now)}` : ""}
              </span>
            </span>
            <button type="button" className={btn("primary-sm")} disabled={readOnly || saving === `handoff:${handoff.id}`} onClick={() => onAccept(handoff.id, handoff.workItemId)}>
              {saving === `handoff:${handoff.id}` ? "Accepting…" : "Accept handoff"}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Roster({ members, now, currentUserId, isOwner, canAsk, readOnly, saving, onAsk }: { members: Member[]; now: number; currentUserId: string; isOwner: boolean; canAsk: boolean; readOnly: boolean; saving: string | null; onAsk: (member: Member) => void }) {
  const rows = members
    .map((member) => ({ member, state: rosterState(member, now) }))
    .sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || a.member.name.localeCompare(b.member.name));
  return (
    <SettingsTableCard className="flex-1" title="Roster" actions={<Pill>A held lead with nobody at the desk shows as Away</Pill>}>
      {rows.length === 0 ? (
        <p className="m-0 px-4 py-6 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">Nobody else here can take transfers yet. Owners, producers and buffer assistants appear on the floor.</p>
      ) : (
        <table className={st.table}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Agent</th>
              <th scope="col" className={cn(st.th, "w-[112px]")}>Status</th>
              <th scope="col" className={cn(st.th, "w-[160px]")}>Doing</th>
              <th scope="col" className={cn(st.th, "w-[76px]")}>On call</th>
              <th scope="col" className={cn(st.th, "w-[124px]")}><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {rows.map(({ member, state }) => {
              const pill = STATE_PILL[state];
              const onCall = state === "on_call" || state === "away";
              const askable = isOwner && canAsk && member.id !== currentUserId && (state === "available" || state === "wrap_up");
              return (
                <tr key={member.id} className={cn("m-row", state === "on_call" && "bg-[var(--brand-50)]")}>
                  <td className={st.td}>
                    {member.name}
                    {member.id === currentUserId && <span className="text-[12px] text-[var(--muted)]"> · you</span>}
                    {(member.role === "assistant" || member.languages?.length) ? (
                      <span className="block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
                        {[member.role === "assistant" ? "Buffer" : null, member.languages?.length ? member.languages.map(languageName).join(", ") : null].filter(Boolean).join(" · ")}
                      </span>
                    ) : null}
                  </td>
                  <td className={st.td}><Pill tone={pill.tone} dot>{pill.label}</Pill></td>
                  <td className={st.td}>{doingLabel(member, state, now)}</td>
                  <td className={cn(st.td, "tabular-nums")}>{onCall && member.call ? callClock(secondsSince(member.call.startedAt, now)) : "—"}</td>
                  <td className={st.td}>
                    {onCall && member.call ? (
                      <Link href={`/app/leads/${member.call.leadId}`} className={btn("secondary", "px-3")}>Open lead</Link>
                    ) : askable ? (
                      <button type="button" className={btn("secondary", "px-3")} disabled={readOnly || saving === `ask:${member.id}`} onClick={() => onAsk(member)}>
                        {saving === `ask:${member.id}` ? "Asking…" : "Ask to pick up"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </SettingsTableCard>
  );
}

/**
 * Who is talking: one row per OPEN call record, which is a different fact from "claimed a while
 * ago". A record open past four hours is one nobody closed, and the row says so.
 */
function OnCalls({ calls, now, currentUserId, isOwner, readOnly, saving, onRelease }: { calls: Call[]; now: number; currentUserId: string; isOwner: boolean; readOnly: boolean; saving: string | null; onRelease: (call: Call, action: "unassign" | "end_buffer") => void }) {
  if (!calls.length) return null;
  const sorted = [...calls].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  return (
    <SettingsTableCard title="On a call now" actions={<span className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{calls.length} open call {calls.length === 1 ? "record" : "records"}</span>}>
      <ul className="m-0 list-none p-0">
        {sorted.map((call) => {
          const seconds = secondsSince(call.startedAt, now);
          const stale = seconds > 4 * 3600;
          return (
            <li key={call.activeCallId} className="flex items-center gap-3 border-t border-[var(--border)] px-4 py-3 first:border-t-0">
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{call.agentName} <span className="font-normal text-[var(--muted)]">→</span> {call.customer}</span>
                <span className={st.sub}>
                  {[call.partnerName, productLineLabel(call.productLine), call.verificationPercent != null ? `verification ${call.verificationPercent}%` : "no verification open"].filter(Boolean).join(" · ")}
                </span>
                {call.buffer && <span className={st.sub}>Buffer {call.buffer.name} is still on the call</span>}
              </span>
              <span className={cn("shrink-0 text-right text-[14px] leading-[1.5] font-semibold tabular-nums", stale ? "text-[var(--warning-ink)]" : "text-[var(--success-ink)]")}>
                {callClock(seconds)}
                {stale && <span className="block text-[12px] font-normal">never closed</span>}
              </span>
              {/* Two different acts (LA-1.14-9): the buffer leaving a call the agent keeps, and the agent giving the transfer back. */}
              {call.buffer && (isOwner || call.buffer.userId === currentUserId || call.agentId === currentUserId) && (
                <button type="button" className={btn("secondary", "px-3")} disabled={readOnly || saving === `end_buffer:${call.id}`} onClick={() => onRelease(call, "end_buffer")}>
                  {saving === `end_buffer:${call.id}` ? "Ending…" : "End buffer involvement"}
                </button>
              )}
              {(isOwner || call.agentId === currentUserId) && (
                <button type="button" className={btn("secondary", "px-3")} disabled={readOnly || saving === `unassign:${call.id}`} onClick={() => onRelease(call, "unassign")}>
                  {saving === `unassign:${call.id}` ? "Unassigning…" : "Unassign"}
                </button>
              )}
              <Link href={`/app/leads/${call.leadId}`} className={btn("secondary", "px-3")}>Open lead</Link>
            </li>
          );
        })}
      </ul>
    </SettingsTableCard>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">{label}</dt>
      <dd className="m-0 mt-0.5 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--ink)] break-words">{value}</dd>
    </div>
  );
}

function TransferQueue({ items, totalWaiting, now, thresholds, expandedId, readOnly, saving, members, onToggle, onClaim, onNudge }: { items: Lead[]; totalWaiting: number; now: number; thresholds: FloorData["waitThresholds"]; expandedId: string | null; readOnly: boolean; saving: string | null; members: Member[]; onToggle: (id: string) => void; onClaim: (id: string) => void; onNudge: (id: string) => void }) {
  // Who could take a non-English lead right now: free (available) members whose recorded languages include it.
  const freeSpeakers = (language: string) => members.filter((member) => rosterState(member, now) === "available" && (member.languages ?? []).some((spoken) => languageKey(spoken) === languageKey(language)));
  return (
    <SettingsTableCard className="flex-1" title="Transfer queue" actions={<span className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">longest first</span>}>
      {items.length === 0 ? (
        <p className="m-0 px-4 py-6 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">
          {totalWaiting ? "No waiting transfer matches this search." : "Nobody is waiting. A new inbound transfer appears here the moment a partner sends it."}
        </p>
      ) : (
        <ol className="m-0 list-none p-0">
          {items.map((item, index) => {
            const wait = secondsSince(item.queuedAt, now);
            const expanded = item.id === expandedId;
            const eligibility = eligibilityFor(item);
            const priority = PRIORITY[priorityFor(item, now, thresholds)];
            const meta = [productLineLabel(item.productLine), item.language ? languageName(item.language) : null, item.partnerName].filter((part) => part && part !== "—").join(" · ");
            return (
              <li key={item.id} className={cn("border-t border-[var(--border)] first:border-t-0", expanded && "bg-[var(--canvas)]")}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-[12px] leading-[1.5] font-semibold tracking-[-0.01em]">{index + 1}</span>
                  <button type="button" aria-expanded={expanded} aria-controls={`transfer-${item.id}`} onClick={() => onToggle(item.id)} className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{item.customer}</span>
                      {eligibility !== "eligible" && <Pill tone={ELIGIBILITY[eligibility].tone}>{ELIGIBILITY[eligibility].label}</Pill>}
                      {item.escalatedAt && <Pill tone="error" dot>Escalated</Pill>}
                    </span>
                    <span className="block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{meta}</span>
                    {/* The wait against the escalation target, as a bar: full and red once it is past. */}
                    <span aria-hidden className="mt-1.5 block h-[5px] w-[120px] overflow-hidden rounded-full bg-[var(--surface-alt)]">
                      <span className={cn("block h-full rounded-full", wait >= thresholds.redSeconds ? "bg-[var(--error)]" : wait >= thresholds.amberSeconds ? "bg-[var(--warning)]" : "bg-[var(--success)]")} style={{ width: `${Math.min(100, thresholds.redSeconds > 0 ? (wait / thresholds.redSeconds) * 100 : 100)}%` }} />
                    </span>
                    {needsPairing(item.language) && (() => {
                      const speakers = freeSpeakers(item.language!);
                      return (
                        <span className={cn("mt-1 block text-[12px] leading-[1.5] tracking-[-0.01em]", speakers.length ? "text-[var(--body)]" : "text-[var(--warning-ink)]")}>
                          {speakers.length ? `${languageName(item.language!)}: ${speakers.map((member) => member.name.split(/\s+/)[0]).join(", ")} ${speakers.length === 1 ? "is" : "are"} free and ${speakers.length === 1 ? "speaks" : "speak"} it` : `No free agent lists ${languageName(item.language!)}`}
                        </span>
                      );
                    })()}
                  </button>
                  <span className={cn("shrink-0 text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] tabular-nums", waitTone(wait, thresholds))}>{waitLabel(wait)}</span>
                  <button type="button" className={btn("primary-sm")} disabled={readOnly || saving === item.id} onClick={() => onClaim(item.id)}>
                    {saving === item.id ? "Picking up…" : "Pick up"}
                  </button>
                </div>
                {expanded && (
                  <div id={`transfer-${item.id}`} className="px-4 pb-4 pl-[52px]">
                    <div className="flex flex-wrap gap-2">
                      <Pill tone={priority.tone} dot>{priority.label}</Pill>
                      <Pill tone={ELIGIBILITY[eligibility].tone} dot>{ELIGIBILITY[eligibility].label}</Pill>
                    </div>
                    <dl className="m-0 mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
                      <Fact label="State" value={item.state} />
                      <Fact label="Age" value={item.age} />
                      <Fact label="Phone" value={item.phone ?? "Not recorded"} />
                      <Fact label="Language" value={item.language ? languageName(item.language) : "Not recorded"} />
                      <Fact label="Source partner" value={item.partnerName} />
                      <Fact label="Owner" value={item.ownerName || "Unassigned"} />
                    </dl>
                    <p className="m-0 mt-3 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">{screeningNote(item)}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button type="button" className={btn("secondary")} disabled={readOnly || saving === `nudge:${item.id}`} onClick={() => onNudge(item.id)}>
                        {saving === `nudge:${item.id}` ? "Sending…" : "Nudge team"}
                      </button>
                      <Link href={`/app/leads/${item.leadId}`} className={btn("secondary")}>Open lead</Link>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <div className="border-t border-[var(--border)] bg-[var(--canvas)] px-4 py-3 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--body)]">
        A claim is settled by the server. The second presser is told who won — never shown a dead button.
      </div>
    </SettingsTableCard>
  );
}

function CallbacksTable({ items }: { items: Callback[] }) {
  return (
    <SettingsTableCard title="Upcoming callbacks" actions={<Link href="/app/callbacks" className="text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--accent-ink)]">View all</Link>}>
      {items.length === 0 ? (
        <p className="m-0 px-4 py-6 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">No callbacks are due today.</p>
      ) : (
        <table className={st.table}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Time</th>
              <th scope="col" className={st.th}>Customer</th>
              <th scope="col" className={st.th}>Product</th>
              <th scope="col" className={st.th}>Owner</th>
              <th scope="col" className={st.th}>Timezone</th>
              <th scope="col" className={st.th}>Notes</th>
              <th scope="col" className={st.th}><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((callback) => {
              // listCallbacks falls back to "Lead" and "Assigned agent" when it has nothing; those are not values.
              const product = callback.productName && callback.productName !== "Lead" ? productLineLabel(callback.productName) : "—";
              const owner = callback.assigneeName && callback.assigneeName !== "Assigned agent" ? callback.assigneeName : "—";
              return (
                <tr key={callback.id} className="m-row">
                  <td className={cn(st.td, "tabular-nums whitespace-nowrap")}>
                    {callback.customerTime}
                    {callback.isOverdue && <span className="ml-2"><Pill tone="error">Overdue</Pill></span>}
                  </td>
                  <td className={st.td}><Link className="font-semibold text-[var(--ink)] hover:underline" href={`/app/leads/${callback.leadId}`}>{callback.customerName}</Link></td>
                  <td className={st.td}>{product}</td>
                  <td className={st.td}>{owner}</td>
                  <td className={st.td}>{callback.customerTimezone}</td>
                  <td className={st.td}>{callback.note || "No callback note."}</td>
                  <td className={st.td}><Link className={btn("secondary", "px-3")} href={`/app/leads/${callback.leadId}`}>Open</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </SettingsTableCard>
  );
}

/* ── the page ──────────────────────────────────────────────────────────── */

export function AgentFloor({ currentUserId, readOnly, role }: { currentUserId: string; readOnly: boolean; role: string }) {
  const router = useRouter();
  const [floor, setFloor] = useState<FloorData | null>(null);
  const floorRef = useRef<FloorData | null>(null);
  const refreshInFlightRef = useRef(false);
  const refreshPendingRef = useRef(false);
  const loadRef = useRef<(() => Promise<void>) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  // Null until the first read says what you saved. Nothing is sent before that, so opening or
  // reloading the floor never turns you "ready" (and never posts partner "agent ready" cards).
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState("connecting");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async ({ initial = false }: { initial?: boolean } = {}): Promise<void> => {
    // A change that arrives while a read is out is not dropped: the read runs once more when it lands.
    if (refreshInFlightRef.current) { refreshPendingRef.current = true; return; }
    refreshInFlightRef.current = true;
    refreshPendingRef.current = false;
    if (initial || !floorRef.current) setLoading(true);
    try {
      const response = await fetch("/api/app/agent-floor", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "Could not load the Agent Floor.");
      const next = body as FloorData;
      floorRef.current = next;
      setFloor(next);
      setAvailability((current) => current ?? next.ownStatus ?? "off");
      setLastUpdated(next.generatedAt);
      setError("");
      setLoading(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the Agent Floor.");
      setLoading(false);
    } finally {
      refreshInFlightRef.current = false;
      if (refreshPendingRef.current) { refreshPendingRef.current = false; void loadRef.current?.(); }
    }
  }, []);
  useEffect(() => { loadRef.current = load; }, [load]);

  useEffect(() => {
    // The initial server-backed snapshot intentionally synchronizes React state from the API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load({ initial: true });
  }, [load]);

  useEffect(() => {
    // LA-1.15-2: no polling. Every change to the queue, a call, a handoff, presence or a nudge
    // broadcasts floor_changed (the table triggers of 20260903130000) and the floor re-reads on it,
    // on every open floor at once. The only timer left is a slow safety re-read in case a broadcast
    // is missed: every 30 seconds while Live, every 10 while the socket is down, never while the
    // tab is hidden. Coming back to the tab re-reads at once.
    const live = realtimeStatus === "subscribed";
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, live ? SAFETY_RESYNC_LIVE_MS : SAFETY_RESYNC_OFFLINE_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load, realtimeStatus]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!floor?.realtimeTopic) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { queueMicrotask(() => setRealtimeStatus("unconfigured")); return; }
    const channel = supabase.channel(floor.realtimeTopic)
      .on("broadcast", { event: "floor_changed" }, () => { void load(); })
      .subscribe((status) => {
        setRealtimeStatus(status.toLowerCase());
        // Anything that changed while the socket was connecting is read once it is up.
        if (status === "SUBSCRIBED") void load();
      });
    return () => { void supabase.removeChannel(channel); };
  }, [floor?.realtimeTopic, load]);

  useEffect(() => {
    // The heartbeat re-sends your saved status, so it keeps you on the floor without changing it.
    if (readOnly || availability === null) return;
    const sendHeartbeat = () => fetch("/api/app/agent-floor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "presence", status: availability }) }).catch(() => undefined);
    void sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, 20_000);
    return () => window.clearInterval(timer);
  }, [availability, readOnly]);

  const normalizedSearch = search.trim().toLowerCase();
  const matches = useCallback((value: string | null | undefined) => !normalizedSearch || String(value ?? "").toLowerCase().includes(normalizedSearch), [normalizedSearch]);
  const members = useMemo(() => (floor?.members ?? []).filter((member) => [member.name, member.call?.customer, member.call?.partnerName].some(matches)), [floor?.members, matches]);
  const waiting = useMemo(() => (floor?.waiting ?? []).filter((item) => [item.customer, item.productLine, productLineLabel(item.productLine), item.state, item.partnerName, item.ownerName, item.language].some(matches)), [floor?.waiting, matches]);
  const callbacks = useMemo(() => (floor?.callbacks ?? []).filter((item) => [item.customerName, item.customerTime, item.customerTimezone, item.note, item.productName, item.assigneeName].some(matches)), [floor?.callbacks, matches]);
  // "Ask to pick up" is always about the head of the queue — the longest wait — whatever the search shows.
  const headOfQueue = useMemo(() => [...(floor?.waiting ?? [])].sort((a, b) => new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime())[0] ?? null, [floor?.waiting]);

  const kpis = useMemo(() => {
    if (!floor) return null;
    const states = floor.members.map((member) => rosterState(member, now));
    const onFloor = states.filter((state) => state === "available" || state === "on_call" || state === "wrap_up").length;
    const available = states.filter((state) => state === "available").length;
    const waits = floor.waiting.map((item) => secondsSince(item.queuedAt, now));
    const average = waits.length ? Math.round(waits.reduce((sum, value) => sum + value, 0) / waits.length) : 0;
    const longest = waits.length ? Math.max(...waits) : 0;
    const closed = floor.closedTransfers ?? { thisHour: null, previousHour: null };
    const delta = closed.thisHour !== null && closed.previousHour !== null ? closed.thisHour - closed.previousHour : null;
    return { onFloor, available, average, longest, closed, delta };
  }, [floor, now]);

  async function claim(workItemId: string) {
    setSaving(workItemId);
    const response = await fetch("/api/app/inbound/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ work_item_id: workItemId }) });
    const body = await response.json().catch(() => null);
    setSaving(null);
    if (!response.ok) { notify.block(body?.error ?? "Could not claim this transfer."); void load(); return; }
    notify.arrive(body?.chatPosted === false ? "Transfer claimed; partner update could not be posted" : "Transfer claimed and verification is ready");
    router.push(`/app/inbound/${workItemId}/verification`);
  }

  async function sendNudge(workItemId: string, target: Member | null) {
    const key = target ? `ask:${target.id}` : `nudge:${workItemId}`;
    setSaving(key);
    const response = await fetch("/api/app/agent-floor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "nudge", work_item_id: workItemId, target_user_id: target?.id ?? null, idempotency_key: crypto.randomUUID() }) });
    const body = await response.json().catch(() => null);
    setSaving(null);
    if (!response.ok) { notify.block(body?.error ?? (target ? "Could not ask them to pick up." : "Could not send the nudge.")); return; }
    const nudge = body?.nudge ?? {};
    if (nudge.alreadySent) { notify.done("That request was already sent"); return; }
    if (!nudge.delivered) {
      notify.warn(nudge.recipients === 0 && !target ? "Nobody else here can take transfers" : "Recorded, but the alert could not be delivered", { detail: "Nobody was notified. Try again in a moment." });
      return;
    }
    const customer = floor?.waiting.find((item) => item.id === workItemId)?.customer ?? "the waiting caller";
    notify.done(target ? `Asked ${target.name} to pick up ${customer}` : `Alert sent to ${nudge.recipients} ${nudge.recipients === 1 ? "teammate" : "teammates"}`, { detail: "It shows in their notifications for ten minutes, unless they have turned handoff alerts off." });
  }

  async function accept(handoffId: string, workItemId: string) {
    setSaving(`handoff:${handoffId}`);
    const response = await fetch("/api/app/inbound/handoff", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "accept", handoff_id: handoffId }) });
    const body = await response.json().catch(() => null);
    setSaving(null);
    if (!response.ok) { notify.block(body?.error ?? "Could not accept this handoff."); return; }
    notify.arrive("Handoff accepted; verification is ready to resume");
    router.push(`/app/inbound/${body?.handoff?.work_item_id ?? workItemId}/verification`);
  }

  async function release(call: Call, action: "unassign" | "end_buffer", acknowledgeLanguage = false) {
    if (action === "unassign" && !window.confirm(`Give ${call.customer} back to the queue? Nobody will own the transfer until someone claims it. The verification so far is kept for them.`)) return;
    setSaving(`${action}:${call.id}`);
    const response = await fetch("/api/app/inbound/release", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, work_item_id: call.id, ...(acknowledgeLanguage ? { acknowledge_language: true } : {}) }) });
    const body = await response.json().catch(() => null);
    setSaving(null);
    if (response.status === 409 && body?.code === "language_cover_required" && !acknowledgeLanguage) {
      if (window.confirm(body.error)) void release(call, action, true);
      return;
    }
    if (!response.ok) { notify.block(body?.error ?? "Could not update this transfer."); return; }
    notify.done(action === "unassign" ? `${call.customer} is back in the queue` : `${call.buffer?.name ?? "The buffer"} has left the call; ${call.agentName} keeps it`);
    void load();
  }

  const liveLabel = realtimeStatus === "subscribed" ? "Live" : realtimeStatus === "unconfigured" ? "Live unavailable" : "Connecting";
  const updated = lastUpdated ? `${shortDuration(secondsSince(lastUpdated, now))} ago` : "just now";
  const statusDisabled = readOnly || availability === null;

  const header = (
    <PageHeader
      eyebrow={sectionForPath("/app/floor") ?? undefined}
      title="Agent Floor"
      description="Who is waiting, who is on a call, who is free."
      actions={
        <>
          <span className="relative inline-flex w-[200px] max-w-full">
            <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="pointer-events-none absolute top-[14px] left-3 text-[var(--muted)]">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.2-3.2" />
            </svg>
            <input type="search" aria-label="Search the floor" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search the floor" className="box-border h-11 w-full rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] pr-3 pl-9 text-[14px] tracking-[-0.02em] text-[var(--ink)] outline-none placeholder:text-[var(--muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]" />
          </span>
          <span className="inline-flex items-center gap-1.5 px-1 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
            <span aria-hidden className={cn("size-1.5 rounded-full", realtimeStatus === "subscribed" ? "bg-[var(--success)]" : "bg-[var(--muted)]")} />
            <span className="font-semibold text-[var(--body)]">{liveLabel}</span> · {updated}
          </span>
          <StatusButton kind="ghost" pressed={availability === "off"} disabled={statusDisabled} onClick={() => setAvailability("off")}>Go offline</StatusButton>
          <StatusButton kind="outline" pressed={availability === "on_break"} disabled={statusDisabled} onClick={() => setAvailability("on_break")}>Wrap-up</StatusButton>
          <StatusButton kind="primary" pressed={availability === "ready"} disabled={statusDisabled} onClick={() => setAvailability("ready")}>Available</StatusButton>
        </>
      }
    />
  );

  if (!floor) {
    return (
      <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
        {header}
        {error && !loading ? (
          <div role="alert">
            <Callout tone="error" title="We couldn’t open your Agent Floor">
              <p className="m-0">{error}</p>
              <button type="button" className={btn("secondary", "mt-3")} onClick={() => void load({ initial: true })}>Try again</button>
            </Callout>
          </div>
        ) : (
          <p role="status" className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">Loading the floor…</p>
        )}
      </div>
    );
  }

  const thresholds = floor.waitThresholds;
  const k = kpis!;

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6">
      {header}
      {readOnly && <Callout tone="warning" title="This account is suspended and read-only">You can watch the floor, but picking up, nudging, accepting handoffs and changing your status are turned off.</Callout>}
      {realtimeStatus === "unconfigured" && <Callout tone="info" title="Live updates are unavailable in this browser">The floor still refreshes every 10 seconds while this tab is open.</Callout>}
      {floor.truncated && <Callout tone="warning" title="More than 500 transfers are open">The newest 500 are shown; older ones are hidden until the queue is worked down.</Callout>}
      {error && <Callout tone="error" title="The floor could not refresh">{error} What you see may be out of date.</Callout>}

      <PendingHandoffs items={floor.pendingHandoffs} readOnly={readOnly} saving={saving} now={now} onAccept={(id, workItemId) => void accept(id, workItemId)} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Agents available" value={`${k.available} of ${k.onFloor}`} foot="on the floor now" />
        <Kpi label="In queue" value={floor.waiting.length} foot={`avg wait ${waitLabel(k.average)}`} />
        <Kpi label="Longest wait" value={waitLabel(k.longest)} valueClassName={waitTone(k.longest, thresholds)} foot={`Escalates at ${thresholdLabel(thresholds.redSeconds)}`} />
        <Kpi
          label="Transfers closed this hour"
          value={k.closed.thisHour ?? "—"}
          valueClassName={k.closed.thisHour ? "text-[var(--success-ink)]" : undefined}
          foot={k.closed.thisHour === null ? "Could not be counted" : k.delta === null ? "No comparison yet" : k.delta === 0 ? "Same as last hour" : `${k.delta > 0 ? "+" : "−"}${Math.abs(k.delta)} vs last hour`}
        />
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <OnCalls calls={floor.onCalls} now={now} currentUserId={currentUserId} isOwner={role === "owner"} readOnly={readOnly} saving={saving} onRelease={(call, action) => void release(call, action)} />
          <Roster members={members} now={now} currentUserId={currentUserId} isOwner={role === "owner"} canAsk={Boolean(headOfQueue)} readOnly={readOnly} saving={saving} onAsk={(member) => headOfQueue && void sendNudge(headOfQueue.id, member)} />
        </div>
        <div className="flex min-w-0 flex-col gap-6 lg:w-[460px] lg:shrink-0">
          <TransferQueue items={waiting} totalWaiting={floor.waiting.length} now={now} thresholds={thresholds} expandedId={expandedId} readOnly={readOnly} saving={saving} members={members} onToggle={(id) => setExpandedId((current) => (current === id ? null : id))} onClaim={(id) => void claim(id)} onNudge={(id) => void sendNudge(id, null)} />
        </div>
      </div>

      <CallbacksTable items={callbacks} />
    </div>
  );
}
