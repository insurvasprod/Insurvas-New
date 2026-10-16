"use client";

import { StatusChip } from "@/components/ui/status-chip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Inbox } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, FilterButton, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { DetailPanel } from "@/components/ui/detail-panel";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { Callout, st, type PillTone, pillTone } from "@/components/app/settings/primitives";
import { ActionButton, CardActions, CardList, cardItem, COMPACT_TOOLBAR, TABLET_QUERY, useMediaQuery, WIDE_QUERY, type RowAction } from "@/components/app/responsive-list";
import { productLineLabel } from "@/lib/format/productLine";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { languageKey, languageName, releaseConfirmation } from "@/lib/transferInbox/constants";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { clockTime as zonedClock, dayMonth, dayMonthYear, viewerTimeZone, zonedParts } from "@/lib/format/dates";

type Availability = "ready" | "on_break" | "off";

/** Rows per page on every floor list: short enough that the queue and the roster both fit on screen. */
const FLOOR_PAGE = 10;
type FloorPages = { calls: number; roster: number; queue: number; callbacks: number };
type FloorTab = "calls" | "roster" | "callbacks";

/** The viewer's calendar day of an instant, as the date input writes it ("2026-10-05"). */
function localDay(value: string) {
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleDateString("en-CA");
}
const FIRST_PAGES: FloorPages = { calls: 1, roster: 1, queue: 1, callbacks: 1 };

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
  /** When it is due, in UTC; the date filter compares it with the chosen day. */
  scheduledAtUtc?: string;
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
  /** The floor read reached its 500-row cap; the 500 longest-waiting open transfers are shown. */
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

// languageKey / languageName are the one reading the claim uses (lib/transferInbox/constants.ts,
// public.language_key): "es", "es-MX" and "Spanish" are the same language here and in the database.
/** English needs no pairing; any other recorded language asks who on the floor speaks it. */
function needsPairing(language: string | null | undefined) {
  const key = languageKey(language);
  return Boolean(key && key !== "english");
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

/** Your own status. The one you are in is the filled button, with a check. */
function StatusButton({ pressed, disabled, onClick, children, className }: { pressed: boolean; disabled: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <Button type="button" variant={pressed ? "default" : "outline"} aria-pressed={pressed} disabled={disabled} onClick={onClick} className={className}>
      {pressed && <Check aria-hidden="true" />}
      {children}
    </Button>
  );
}

function PendingHandoffs({ items, readOnly, saving, now, compact, onAccept }: { items: Handoff[]; readOnly: boolean; saving: string | null; now: number; compact: boolean; onAccept: (id: string, workItemId: string) => void }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="handoffs-heading" className="rounded-[12px] border border-[var(--border)] border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-4 py-3">
      <h2 id="handoffs-heading" className="m-0 text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--info-ink)]">
        {items.length === 1 ? "A handoff is waiting for you" : `${items.length} handoffs are waiting for you`}
      </h2>
      <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
        {items.map((handoff) => (
          <li key={handoff.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
            <span className="min-w-0">
              <span className="block text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{handoff.customer}</span>
              <span className={st.sub}>
                From {handoff.bufferName} · {productLineLabel(handoff.productLine)} · {handoff.progressPercentage}% verified
                {handoff.fieldsLeft != null ? (handoff.fieldsLeft === 0 ? " · every required field confirmed" : ` · ${handoff.fieldsLeft} required ${handoff.fieldsLeft === 1 ? "field" : "fields"} left`) : ""}
                {handoff.expiresAt && new Date(handoff.expiresAt).getTime() > now ? ` · offer ends ${clockTime(handoff.expiresAt, now)}` : ""}
              </span>
            </span>
            <Button type="button" size={compact ? "default" : "sm"} disabled={readOnly || saving === `handoff:${handoff.id}`} onClick={() => onAccept(handoff.id, handoff.workItemId)}>
              {saving === `handoff:${handoff.id}` ? "Accepting…" : "Accept handoff"}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A roster row, read once for the table and the card alike. */
function rosterRow({ member, state }: { member: Member; state: RosterState }, ctx: { currentUserId: string; isOwner: boolean; canAsk: boolean; readOnly: boolean; saving: string | null; onAsk: (member: Member) => void }) {
  const pill = STATE_PILL[state];
  const onCall = state === "on_call" || state === "away";
  const askable = ctx.isOwner && ctx.canAsk && member.id !== ctx.currentUserId && (state === "available" || state === "wrap_up");
  const detail = (member.role === "assistant" || member.languages?.length)
    ? [member.role === "assistant" ? "Buffer" : null, member.languages?.length ? member.languages.map(languageName).join(", ") : null].filter(Boolean).join(" · ")
    : null;
  const action: RowAction | null = onCall && member.call
    ? { key: "open", label: "Open lead", href: `/app/leads/${member.call.leadId}` }
    : askable
      ? { key: "ask", label: ctx.saving === `ask:${member.id}` ? "Asking…" : "Ask to pick up", disabled: ctx.readOnly || ctx.saving === `ask:${member.id}`, onSelect: () => ctx.onAsk(member) }
      : null;
  return { pill, onCall, detail, action };
}

function Roster({ members, searching, now, currentUserId, isOwner, canAsk, readOnly, saving, compact, page, onPage, onAsk, onClear, toolbar }: { members: Member[]; searching: boolean; now: number; currentUserId: string; isOwner: boolean; canAsk: boolean; readOnly: boolean; saving: string | null; compact: boolean; page: number; onPage: (page: number) => void; onAsk: (member: Member) => void; onClear: () => void; toolbar: React.ReactNode }) {
  const sorted = members
    .map((member) => ({ member, state: rosterState(member, now) }))
    .sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || a.member.name.localeCompare(b.member.name));
  const { current, rows } = paginate(sorted, page, FLOOR_PAGE);
  const ctx = { currentUserId, isOwner, canAsk, readOnly, saving, onAsk };
  return (
    <TableCard toolbar={toolbar} footer={sorted.length ? <Pager page={current} total={sorted.length} pageSize={FLOOR_PAGE} noun="agents" onPage={onPage} /> : undefined}>
      {rows.length === 0 ? (
        searching
          ? <NoMatches noun="agents" onClear={onClear} />
          : <EmptyState title="Nobody on the floor yet" hint="Owners, producers and buffers appear here." />
      ) : compact ? (
        // Phones and tablets (2026-10-09 mobile): one card per agent — name, state, what they are doing.
        <CardList label="Roster" className="m-seq">
          {rows.map((row) => {
            const { member, state } = row;
            const { pill, onCall, detail, action } = rosterRow(row, ctx);
            return (
              <li key={member.id} className={cn(cardItem, state === "on_call" && "bg-[var(--brand-50)]")}>
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">
                      {member.name}
                      {member.id === currentUserId && <span className="text-xs font-normal text-[var(--muted)]"> · you</span>}
                    </span>
                    {detail && <span className={st.sub}>{detail}</span>}
                  </span>
                  <StatusChip tone={pillTone(pill.tone)} dot>{pill.label}</StatusChip>
                </div>
                <p className="m-0 flex items-baseline justify-between gap-3 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
                  <span className="min-w-0">{doingLabel(member, state, now)}</span>
                  {onCall && member.call && <span className="shrink-0 tabular-nums">{callClock(secondsSince(member.call.startedAt, now))}</span>}
                </p>
                {action && <CardActions actions={[action]} label={member.name} />}
              </li>
            );
          })}
        </CardList>
      ) : (
        <table className={st.table}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Agent</th>
              <th scope="col" className={cn(st.th, "w-[112px]")}>Status</th>
              <th scope="col" className={cn(st.th, "w-[280px]")}>Doing</th>
              <th scope="col" className={cn(st.th, "w-[100px]")}>On call</th>
              <th scope="col" className={cn(st.th, "w-[132px] text-right")}><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {rows.map((row) => {
              const { member, state } = row;
              const { pill, onCall, detail, action } = rosterRow(row, ctx);
              return (
                <tr key={member.id} className={cn("m-row", state === "on_call" && "bg-[var(--brand-50)]")}>
                  <td className={st.td}>
                    {member.name}
                    {member.id === currentUserId && <span className="text-xs text-[var(--muted)]"> · you</span>}
                    {detail ? (
                      <span className="block text-xs leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
                        {detail}
                      </span>
                    ) : null}
                  </td>
                  <td className={st.td}><StatusChip tone={pillTone(pill.tone)} dot>{pill.label}</StatusChip></td>
                  <td className={st.td}>{doingLabel(member, state, now)}</td>
                  <td className={cn(st.td, "whitespace-nowrap tabular-nums")}>{onCall && member.call ? callClock(secondsSince(member.call.startedAt, now)) : "—"}</td>
                  <td className={cn(st.td, "text-right")}>
                    {action ? <ActionButton action={action} size="sm" /> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

/** A call, read once for the table and the card alike: how long, whose, and what may be done to it. */
function callRow(call: Call, now: number, ctx: { currentUserId: string; isOwner: boolean; readOnly: boolean; saving: string | null; onRelease: (call: Call, action: "unassign" | "end_buffer") => void }) {
  const seconds = secondsSince(call.startedAt, now);
  // A record open past four hours is one nobody closed, and the row says so.
  const stale = seconds > 4 * 3600;
  const mine = call.agentId === ctx.currentUserId;
  const percent = call.verificationPercent;
  const actions: RowAction[] = [];
  if (mine) actions.push({ key: "verify", primary: true, label: percent != null && percent >= 100 ? "Record outcome" : "Verify", href: `/app/inbound/${call.id}/verification` });
  // Two different acts (LA-1.14-9): the buffer leaving a call the agent keeps, and the agent giving the transfer back.
  if (call.buffer && (ctx.isOwner || call.buffer.userId === ctx.currentUserId || mine)) {
    actions.push({ key: "end_buffer", label: ctx.saving === `end_buffer:${call.id}` ? "Ending…" : "End buffer", disabled: ctx.readOnly || ctx.saving === `end_buffer:${call.id}`, onSelect: () => ctx.onRelease(call, "end_buffer") });
  }
  if (ctx.isOwner || mine) {
    actions.push({ key: "unassign", label: ctx.saving === `unassign:${call.id}` ? "Unassigning…" : "Unassign", disabled: ctx.readOnly || ctx.saving === `unassign:${call.id}`, onSelect: () => ctx.onRelease(call, "unassign") });
  }
  actions.push({ key: "open", label: "Open lead", href: `/app/leads/${call.leadId}` });
  const where = [call.state, call.language ? languageName(call.language) : null].filter((part) => part && part !== "—").join(" · ");
  return { seconds, stale, mine, percent, actions, where };
}

function Verification({ percent }: { percent: number | null | undefined }) {
  if (percent == null) return <span className="text-[var(--muted)]">Not started</span>;
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className="block h-1.5 w-16 overflow-hidden rounded-full bg-[var(--surface-alt)]"><span className={cn("block h-full rounded-full", percent >= 100 ? "bg-[var(--success)]" : "bg-[var(--info)]")} style={{ width: `${Math.min(100, percent)}%` }} /></span>
      <span className="tabular-nums">{percent}%</span>
    </span>
  );
}

/**
 * Who is talking: one row per OPEN call record, which is a different fact from "claimed a while
 * ago". A record open past four hours is one nobody closed, and the row says so.
 */
function OnCalls({ calls, filtered, now, currentUserId, isOwner, readOnly, saving, compact, page, onPage, onRelease, onClear, onOpenQueue, toolbar }: { calls: Call[]; filtered: boolean; now: number; currentUserId: string; isOwner: boolean; readOnly: boolean; saving: string | null; compact: boolean; page: number; onPage: (page: number) => void; onRelease: (call: Call, action: "unassign" | "end_buffer") => void; onClear: () => void; onOpenQueue: () => void; toolbar: React.ReactNode }) {
  const sorted = [...calls].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  const { current, rows } = paginate(sorted, page, FLOOR_PAGE);
  const ctx = { currentUserId, isOwner, readOnly, saving, onRelease };
  return (
    <TableCard toolbar={toolbar} footer={sorted.length ? <Pager page={current} total={sorted.length} pageSize={FLOOR_PAGE} noun="calls" suffix="longest first" onPage={onPage} /> : undefined}>
      {rows.length === 0 ? (
        filtered
          ? <NoMatches noun="calls" onClear={onClear} />
          : <EmptyState title="Nobody is on a call" hint="Calls show here once a transfer is picked up." action={<Button type="button" variant="outline" onClick={onOpenQueue}>Open transfer queue</Button>} />
      ) : compact ? (
        // Phones and tablets (2026-10-09 mobile): customer, agent and the call's length up front;
        // Verify (or Open lead) as the wide button, End buffer and Unassign under "More".
        <CardList label="Calls">
          {rows.map((call) => {
            const { seconds, stale, mine, percent, actions, where } = callRow(call, now, ctx);
            return (
              <li key={call.activeCallId} className={cardItem}>
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <Link className="block text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)] hover:underline" href={`/app/leads/${call.leadId}`}>{call.customer}</Link>
                    <span className={st.sub}>
                      {call.agentName}{mine ? " · you" : ""}{where ? ` · ${where}` : ""}
                    </span>
                  </span>
                  <span className={cn("shrink-0 text-right text-sm leading-[1.5] tracking-[-0.02em] tabular-nums font-semibold", stale ? "text-[var(--warning-ink)]" : "text-[var(--success-ink)]")}>
                    {callClock(seconds)}
                    {stale && <span className="block text-xs font-normal">never closed</span>}
                  </span>
                </div>
                {call.buffer && <span className={st.sub}>Buffer {call.buffer.name} still on the call</span>}
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
                  <span className="min-w-0">{[call.partnerName, productLineLabel(call.productLine)].filter((part) => part && part !== "—").join(" · ")}</span>
                  <Verification percent={percent} />
                </div>
                <CardActions actions={actions} label={call.customer} />
              </li>
            );
          })}
        </CardList>
      ) : (
        <table className={st.table}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Agent</th>
              <th scope="col" className={st.th}>Customer</th>
              <th scope="col" className={st.th}>Source</th>
              <th scope="col" className={cn(st.th, "w-[150px]")}>Verification</th>
              <th scope="col" className={cn(st.th, "w-[110px] text-right")}>On call</th>
              <th scope="col" className={cn(st.th, "text-right")}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((call) => {
              const { seconds, stale, mine, percent, actions, where } = callRow(call, now, ctx);
              return (
                <tr key={call.activeCallId} className="m-row">
                  <td className={st.td}>
                    <span className="font-semibold text-[var(--ink)]">{call.agentName}</span>
                    {mine && <span className="text-xs text-[var(--muted)]"> · you</span>}
                    {call.buffer && <span className={st.sub}>Buffer {call.buffer.name} still on the call</span>}
                  </td>
                  <td className={st.td}>
                    <Link className="font-semibold text-[var(--ink)] hover:underline" href={`/app/leads/${call.leadId}`}>{call.customer}</Link>
                    <span className={st.sub}>{where}</span>
                  </td>
                  <td className={st.td}>
                    {call.partnerName}
                    <span className={st.sub}>{productLineLabel(call.productLine)}</span>
                  </td>
                  <td className={st.td}>
                    <Verification percent={percent} />
                  </td>
                  <td className={cn(st.td, "text-right tabular-nums font-semibold", stale ? "text-[var(--warning-ink)]" : "text-[var(--success-ink)]")}>
                    {callClock(seconds)}
                    {stale && <span className="block text-xs font-normal">never closed</span>}
                  </td>
                  <td className={cn(st.td, "whitespace-nowrap text-right")}>
                    <span className="inline-flex flex-nowrap justify-end gap-2">
                      {actions.map((action) => <ActionButton key={action.key} action={action} size="sm" />)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">{label}</dt>
      <dd className="m-0 mt-0.5 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--ink)] break-words">{value}</dd>
    </div>
  );
}

function TransferQueue({ items, totalWaiting, now, thresholds, expandedId, readOnly, saving, members, toolbar, liveStatus, compact, page, onPage, onClearSearch, onToggle, onClaim, onNudge, onClose }: { items: Lead[]; totalWaiting: number; now: number; thresholds: FloorData["waitThresholds"]; expandedId: string | null; readOnly: boolean; saving: string | null; members: Member[]; toolbar: React.ReactNode; liveStatus: React.ReactNode; compact: boolean; page: number; onPage: (page: number) => void; onClearSearch: () => void; onToggle: (id: string) => void; onClaim: (id: string) => void; onNudge: (id: string) => void; onClose: () => void }) {
  // Who could take a non-English lead right now: free (available) members whose recorded languages include it.
  const freeSpeakers = (language: string) => members.filter((member) => rosterState(member, now) === "available" && (member.languages ?? []).some((spoken) => languageKey(spoken) === languageKey(language)));
  const { current, rows } = paginate(items, page, FLOOR_PAGE);
  const offset = (current - 1) * FLOOR_PAGE;
  // Below lg the queue is a full-width sheet, worked by thumb: its buttons are the 36px standard.
  const buttonSize = compact ? "default" : "sm";
  return (
    // An overlay on the right edge (DetailPanel): the floor's tables keep their full width under it.
    <DetailPanel
      mode="overlay"
      title={`Transfer queue · ${totalWaiting}`}
      onClose={onClose}
      bodyClassName="flex flex-col"
      footer={<div className="flex w-full flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground"><Pager page={current} total={items.length} pageSize={FLOOR_PAGE} noun="waiting transfers" onPage={onPage} suffix={liveStatus} /></div>}
    >
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-border bg-[var(--surface-alt)] px-4 py-3">{toolbar}</div>
      {items.length === 0 ? (
        totalWaiting
          ? <NoMatches noun="waiting transfers" onClear={onClearSearch} />
          : <EmptyState title="Nobody is waiting" hint="New transfers appear here as partners send them." />
      ) : (
        <ol className="m-0 list-none p-0">
          {rows.map((item, rowIndex) => {
            const index = offset + rowIndex;
            const wait = secondsSince(item.queuedAt, now);
            const expanded = item.id === expandedId;
            const eligibility = eligibilityFor(item);
            const priority = PRIORITY[priorityFor(item, now, thresholds)];
            const meta = [productLineLabel(item.productLine), item.language ? languageName(item.language) : null, item.partnerName].filter((part) => part && part !== "—").join(" · ");
            return (
              <li key={item.id} className={cn("border-t border-[var(--border)] first:border-t-0", expanded && "bg-[var(--canvas)]")}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <span aria-hidden className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-xs leading-[1.5] font-semibold tracking-[-0.01em]">{index + 1}</span>
                  <button type="button" aria-expanded={expanded} aria-controls={`transfer-${item.id}`} onClick={() => onToggle(item.id)} className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent p-0 text-left">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{item.customer}</span>
                      {eligibility !== "eligible" && <StatusChip dot={false} tone={pillTone(ELIGIBILITY[eligibility].tone)}>{ELIGIBILITY[eligibility].label}</StatusChip>}
                      {item.escalatedAt && <StatusChip tone="danger" dot>Escalated</StatusChip>}
                    </span>
                    <span className="block text-xs leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">{meta}</span>
                    {/* The wait against the escalation target, as a bar: full and red once it is past. */}
                    <span aria-hidden className="mt-1.5 block h-[5px] w-[120px] overflow-hidden rounded-full bg-[var(--surface-alt)]">
                      <span className={cn("block h-full rounded-full", wait >= thresholds.redSeconds ? "bg-[var(--error)]" : wait >= thresholds.amberSeconds ? "bg-[var(--warning)]" : "bg-[var(--success)]")} style={{ width: `${Math.min(100, thresholds.redSeconds > 0 ? (wait / thresholds.redSeconds) * 100 : 100)}%` }} />
                    </span>
                    {needsPairing(item.language) && (() => {
                      const speakers = freeSpeakers(item.language!);
                      return (
                        <span className={cn("mt-1 block text-xs leading-[1.5] tracking-[-0.01em]", speakers.length ? "text-[var(--body)]" : "text-[var(--warning-ink)]")}>
                          {speakers.length ? `${languageName(item.language!)}: ${speakers.map((member) => member.name.split(/\s+/)[0]).join(", ")} ${speakers.length === 1 ? "is" : "are"} free and ${speakers.length === 1 ? "speaks" : "speak"} it` : `No free agent lists ${languageName(item.language!)}`}
                        </span>
                      );
                    })()}
                  </button>
                  <span className={cn("shrink-0 text-sm leading-[1.5] font-semibold tracking-[-0.02em] tabular-nums", waitTone(wait, thresholds))}>{waitLabel(wait)}</span>
                  <Button type="button" size={buttonSize} disabled={readOnly || saving === item.id} onClick={() => onClaim(item.id)}>
                    {saving === item.id ? "Picking up…" : "Pick up"}
                  </Button>
                </div>
                {expanded && (
                  <div id={`transfer-${item.id}`} className="px-4 pb-4 pl-[52px]">
                    <div className="flex flex-wrap gap-2">
                      <StatusChip tone={pillTone(priority.tone)} dot>{priority.label}</StatusChip>
                      <StatusChip tone={pillTone(ELIGIBILITY[eligibility].tone)} dot>{ELIGIBILITY[eligibility].label}</StatusChip>
                    </div>
                    <dl className="m-0 mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
                      <Fact label="State" value={item.state} />
                      <Fact label="Age" value={item.age} />
                      <Fact label="Phone" value={item.phone ?? "Not recorded"} />
                      <Fact label="Language" value={item.language ? languageName(item.language) : "Not recorded"} />
                      <Fact label="Source partner" value={item.partnerName} />
                      <Fact label="Owner" value={item.ownerName || "Unassigned"} />
                    </dl>
                    <p className="m-0 mt-3 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--body)]">{screeningNote(item)}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button type="button" size={buttonSize} variant="outline" disabled={readOnly || saving === `nudge:${item.id}`} onClick={() => onNudge(item.id)}>
                        {saving === `nudge:${item.id}` ? "Sending…" : "Nudge team"}
                      </Button>
                      <Button asChild size={buttonSize} variant="outline"><Link href={`/app/leads/${item.leadId}`}>Open lead</Link></Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </DetailPanel>
  );
}

/** listCallbacks falls back to "Lead" and "Assigned agent" when it has nothing; those are not values. */
function callbackFacts(callback: Callback) {
  const product = callback.productName && callback.productName !== "Lead" ? productLineLabel(callback.productName) : "—";
  const owner = callback.assigneeName && callback.assigneeName !== "Assigned agent" ? callback.assigneeName : "—";
  return { product, owner };
}

function CallbacksTable({ items, searching, compact, page, onPage, onClear, toolbar }: { items: Callback[]; searching: boolean; compact: boolean; page: number; onPage: (page: number) => void; onClear: () => void; toolbar: React.ReactNode }) {
  const { current, rows } = paginate(items, page, FLOOR_PAGE);
  const viewAll = <Link href="/app/callbacks" className="font-semibold text-[var(--accent-ink)] hover:underline">Open Callbacks</Link>;
  return (
    <TableCard
      toolbar={toolbar}
      footer={<Pager page={current} total={items.length} pageSize={FLOOR_PAGE} noun="callbacks" onPage={onPage} suffix={viewAll} />}
    >
      {items.length === 0 ? (
        searching
          ? <NoMatches noun="callbacks" onClear={onClear} />
          : <EmptyState title="No callbacks due today" hint="Booked callbacks show here on their day." action={<Button asChild variant="outline"><Link href="/app/callbacks">Open Callbacks</Link></Button>} />
      ) : compact ? (
        // Phones and tablets (2026-10-09 mobile): their time and timezone stay on the card, with the note.
        <CardList label="Upcoming callbacks">
          {rows.map((callback) => {
            const { product, owner } = callbackFacts(callback);
            return (
              <li key={callback.id} className={cardItem}>
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <Link className="block text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)] hover:underline" href={`/app/leads/${callback.leadId}`}>{callback.customerName}</Link>
                    <span className="block text-sm leading-[1.5] tracking-[-0.02em] text-[var(--ink)] tabular-nums">{callback.customerTime} · {callback.customerTimezone}</span>
                  </span>
                  {callback.isOverdue && <StatusChip dot={false} tone="danger">Overdue</StatusChip>}
                </div>
                <span className={st.sub}>{[product, owner].filter((part) => part !== "—").join(" · ") || "—"}</span>
                <span className="line-clamp-2 text-sm leading-[1.5] tracking-[-0.02em] text-[var(--body)]">{callback.note || "No callback note."}</span>
                <CardActions actions={[{ key: "open", label: "Open", href: `/app/leads/${callback.leadId}` }]} label={callback.customerName} />
              </li>
            );
          })}
        </CardList>
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
              <th scope="col" className={cn(st.th, "text-right")}><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((callback) => {
              const { product, owner } = callbackFacts(callback);
              return (
                <tr key={callback.id} className="m-row">
                  <td className={cn(st.td, "tabular-nums whitespace-nowrap")}>
                    {callback.customerTime}
                    {callback.isOverdue && <span className="ml-2"><StatusChip dot={false} tone="danger">Overdue</StatusChip></span>}
                  </td>
                  <td className={cn(st.td, "whitespace-nowrap")}><Link className="font-semibold text-[var(--ink)] hover:underline" href={`/app/leads/${callback.leadId}`}>{callback.customerName}</Link></td>
                  <td className={st.td}>{product}</td>
                  <td className={cn(st.td, "whitespace-nowrap")}>{owner}</td>
                  <td className={cn(st.td, "whitespace-nowrap")}>{callback.customerTimezone}</td>
                  <td className={st.td}><span className="line-clamp-2 max-w-[420px]" title={callback.note ?? undefined}>{callback.note || "No callback note."}</span></td>
                  <td className={cn(st.td, "text-right")}><Button asChild size="sm" variant="outline"><Link href={`/app/leads/${callback.leadId}`}>Open</Link></Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
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
  const [refreshing, setRefreshing] = useState(false);
  // Layout (2026-10-09 mobile): from lg the floor is drawn as it always was. Below lg the lists are
  // cards and the filters sit behind a Filters button; below md (a phone) your status and the
  // transfer queue move to a bar fixed to the bottom of the screen, under the thumb.
  const wide = useMediaQuery(WIDE_QUERY);
  const phone = !useMediaQuery(TABLET_QUERY);
  const [filtersOpen, setFiltersOpen] = useState(false);

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
  async function refresh() { setRefreshing(true); try { await load(); } finally { setRefreshing(false); } }

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
    // A burst of changes (a claim touches several tables) is read once: broadcasts arriving within
    // a second share one reload instead of each refetching the whole floor (LA-1 audit).
    const BROADCAST_COALESCE_MS = 1000;
    let pending: number | null = null;
    const reloadSoon = () => {
      if (pending !== null) return;
      pending = window.setTimeout(() => { pending = null; void load(); }, BROADCAST_COALESCE_MS);
    };
    const channel = supabase.channel(floor.realtimeTopic)
      .on("broadcast", { event: "floor_changed" }, reloadSoon)
      .subscribe((status) => {
        setRealtimeStatus(status.toLowerCase());
        // Anything that changed while the socket was connecting is read once it is up.
        if (status === "SUBSCRIBED") void load();
      });
    return () => { if (pending !== null) window.clearTimeout(pending); void supabase.removeChannel(channel); };
  }, [floor?.realtimeTopic, load]);

  useEffect(() => {
    // The heartbeat re-sends your saved status, so it keeps you on the floor without changing it.
    if (readOnly || availability === null) return;
    const sendHeartbeat = () => fetch("/api/app/agent-floor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "presence", status: availability }) }).catch(() => undefined);
    void sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, 20_000);
    return () => window.clearInterval(timer);
  }, [availability, readOnly]);

  // One list on screen at a time, picked with the tabs under the title. Search, the date and the
  // tab's own filter narrow that list; the transfer queue has its own search in its side panel.
  const [tab, setTab] = useState<FloorTab>("calls");
  const [day, setDay] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [rosterFilter, setRosterFilter] = useState<RosterState | "">("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [queueSearch, setQueueSearch] = useState("");
  const [queueOpen, setQueueOpen] = useState(false);
  const normalizedSearch = search.trim().toLowerCase();
  const matches = useCallback((value: string | null | undefined) => !normalizedSearch || String(value ?? "").toLowerCase().includes(normalizedSearch), [normalizedSearch]);
  const onDay = useCallback((value: string | null | undefined) => !day || (value ? localDay(value) === day : false), [day]);
  const members = useMemo(() => (floor?.members ?? []).filter((member) => [member.name, member.call?.customer, member.call?.partnerName].some(matches) && (!rosterFilter || rosterState(member, now) === rosterFilter) && onDay(member.call?.startedAt ?? member.statusChangedAt ?? member.lastSeenAt)), [floor?.members, matches, rosterFilter, now, onDay]);
  const queueNeedle = queueSearch.trim().toLowerCase();
  const waiting = useMemo(() => (floor?.waiting ?? []).filter((item) => !queueNeedle || [item.customer, item.productLine, productLineLabel(item.productLine), item.state, item.partnerName, item.ownerName, item.language].some((value) => String(value ?? "").toLowerCase().includes(queueNeedle))), [floor?.waiting, queueNeedle]);
  const callbacks = useMemo(() => (floor?.callbacks ?? []).filter((item) => [item.customerName, item.customerTime, item.customerTimezone, item.note, item.productName, item.assigneeName].some(matches) && (!ownerFilter || item.assigneeName === ownerFilter) && (!day || onDay(item.scheduledAtUtc))), [floor?.callbacks, matches, ownerFilter, day, onDay]);
  const onCalls = useMemo(() => (floor?.onCalls ?? []).filter((call) => [call.agentName, call.customer, call.partnerName, call.buffer?.name, productLineLabel(call.productLine)].some(matches) && (!agentFilter || call.agentName === agentFilter) && onDay(call.startedAt)), [floor?.onCalls, matches, agentFilter, onDay]);
  const callAgents = useMemo(() => [...new Set((floor?.onCalls ?? []).map((call) => call.agentName))].sort(), [floor?.onCalls]);
  const callbackOwners = useMemo(() => [...new Set((floor?.callbacks ?? []).map((item) => item.assigneeName).filter((name): name is string => Boolean(name) && name !== "Assigned agent"))].sort(), [floor?.callbacks]);
  // One page per list. Any new search or filter starts every list again at its first page.
  const [pages, setPages] = useState<FloorPages>(FIRST_PAGES);
  const pageTo = (list: keyof FloorPages) => (page: number) => setPages((current) => ({ ...current, [list]: page }));
  const changeSearch = (value: string) => { setSearch(value); setPages(FIRST_PAGES); };
  const refilter = <T,>(set: (value: T) => void) => (value: T) => { set(value); setPages(FIRST_PAGES); };
  const filtersOn = Boolean(normalizedSearch || day || (tab === "calls" && agentFilter) || (tab === "roster" && rosterFilter) || (tab === "callbacks" && ownerFilter));
  const clearFilters = () => { setSearch(""); setDay(""); setAgentFilter(""); setRosterFilter(""); setOwnerFilter(""); setPages(FIRST_PAGES); };

  // A new transfer while the panel is shut: the bookmark shows a short note beside it.
  const [arrival, setArrival] = useState<string | null>(null);
  const seenWaiting = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set((floor?.waiting ?? []).map((item) => item.id));
    const seen = seenWaiting.current;
    seenWaiting.current = ids;
    if (!seen || queueOpen) return;
    const fresh = (floor?.waiting ?? []).filter((item) => !seen.has(item.id));
    if (!fresh.length) return;
    setArrival(fresh.length === 1 ? `New transfer: ${fresh[0].customer}` : `${fresh.length} new transfers waiting`);
    const timer = window.setTimeout(() => setArrival(null), 8000);
    return () => window.clearTimeout(timer);
  }, [floor?.waiting, queueOpen]);
  // Esc closes the queue: DetailPanel's own handler (2026-10-09 detail panel).
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
    const staleCalls = floor.onCalls.filter((call) => secondsSince(call.startedAt, now) > 4 * 3600).length;
    const dueToday = floor.callbacks.filter((item) => item.isDueToday && !item.isOverdue).length;
    const overdue = floor.callbacks.filter((item) => item.isOverdue).length;
    return { onFloor, available, average, longest, closed, delta, staleCalls, dueToday, overdue };
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
    // Both acts ask first (LA-1.14-9); the language cover prompt below is a second, separate question.
    if (!acknowledgeLanguage && !window.confirm(releaseConfirmation(action, { customer: call.customer, bufferName: call.buffer?.name, agentName: call.agentName }))) return;
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

  const liveLabel = realtimeStatus === "subscribed" ? "Live" : realtimeStatus === "unconfigured" ? "Live unavailable, refreshing every 10 seconds" : "Connecting";
  const updated = lastUpdated ? `${shortDuration(secondsSince(lastUpdated, now))} ago` : "just now";
  const statusDisabled = readOnly || availability === null;

  const header = <PageHeader title="Agent Floor" />;
  // On a phone the three buttons share the bottom bar's width equally.
  const statusButtonClass = phone ? "w-full min-w-0 px-2 has-[>svg]:px-2" : undefined;
  const statusButtons = (
    <div role="group" aria-label="Your status" className={phone ? "grid grid-cols-3 gap-2" : "flex flex-wrap items-center gap-2"}>
      <StatusButton pressed={availability === "off"} disabled={statusDisabled} onClick={() => setAvailability("off")} className={statusButtonClass}>Go offline</StatusButton>
      <StatusButton pressed={availability === "on_break"} disabled={statusDisabled} onClick={() => setAvailability("on_break")} className={statusButtonClass}>Wrap-up</StatusButton>
      <StatusButton pressed={availability === "ready"} disabled={statusDisabled} onClick={() => setAvailability("ready")} className={statusButtonClass}>Available</StatusButton>
    </div>
  );

  if (!floor) {
    if (!(error && !loading)) return <PageLoading />;
    return (
      <div className="flex w-full min-w-0 flex-col gap-6">
        {header}
        <div role="alert">
          <Callout tone="error" title={<span className="flex flex-wrap items-center gap-3">We couldn’t open your Agent Floor: {error}<Button type="button" variant="outline" onClick={() => void load({ initial: true })}>Try again</Button></span>} />
        </div>
      </div>
    );
  }

  const thresholds = floor.waitThresholds;
  const k = kpis!;
  const waitingCount = floor.waiting.length;
  const liveStatus = (
    <span className="inline-flex items-center gap-1.5" role="status">
      <span aria-hidden className={cn("size-1.5 rounded-full", realtimeStatus === "subscribed" ? "bg-[var(--success)]" : "bg-[var(--muted)]")} />
      <span className="font-semibold text-[var(--body)]">{liveLabel}</span> · updated {updated}
    </span>
  );
  const tabs: Array<{ key: FloorTab; label: string; count: number }> = [
    { key: "calls", label: "On a call now", count: floor.onCalls.length },
    { key: "roster", label: "Roster", count: floor.members.length },
    { key: "callbacks", label: "Upcoming callbacks", count: floor.callbacks.length },
  ];
  // The toolbar is the same on every tab — search, date, the tab's own filter, Refresh — so the
  // controls never move when the agent switches lists.
  // Below lg (2026-10-09 mobile) the search takes the first row; the date and the tab's filter are
  // the same controls behind a Filters button, opening in the toolbar band; Clear and Refresh stay.
  const control = wide ? toolbarControl : cn(toolbarControl, "w-full");
  const tabFilter = (tab === "calls" && agentFilter) || (tab === "roster" && rosterFilter) || (tab === "callbacks" && ownerFilter);
  const dateFilter = <input type="date" aria-label={tab === "callbacks" ? "Due on" : tab === "calls" ? "Call started on" : "Active on"} className={control} value={day} onChange={(event) => refilter(setDay)(event.target.value)} />;
  const listFilter = (
    <>
      {tab === "calls" && (
        <select aria-label="Filter calls by agent" className={control} value={agentFilter} onChange={(event) => refilter(setAgentFilter)(event.target.value)}>
          <option value="">All agents</option>
          {callAgents.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      )}
      {tab === "roster" && (
        <select aria-label="Filter the roster by status" className={control} value={rosterFilter} onChange={(event) => refilter(setRosterFilter)(event.target.value as RosterState | "")}>
          <option value="">All statuses</option>
          {STATE_ORDER.map((state) => <option key={state} value={state}>{STATE_PILL[state].label}</option>)}
        </select>
      )}
      {tab === "callbacks" && (
        <select aria-label="Filter callbacks by owner" className={control} value={ownerFilter} onChange={(event) => refilter(setOwnerFilter)(event.target.value)}>
          <option value="">All owners</option>
          {callbackOwners.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      )}
    </>
  );
  const searchBox = <ToolbarSearch value={search} onChange={changeSearch} placeholder={tab === "calls" ? "Search agent, customer, partner" : tab === "roster" ? "Search agent or customer" : "Search customer, note, owner"} />;
  const toolbar = wide ? (
    <DataToolbar
      actions={<>
        {filtersOn && <ClearFiltersButton onClick={clearFilters} />}
        <RefreshButton onClick={() => void refresh()} refreshing={refreshing} />
      </>}
    >
      {searchBox}
      {dateFilter}
      {listFilter}
    </DataToolbar>
  ) : (
    <>
      <DataToolbar
        className={COMPACT_TOOLBAR}
        actions={<>
          <FilterButton open={filtersOpen} onClick={() => setFiltersOpen((open) => !open)} count={(day ? 1 : 0) + (tabFilter ? 1 : 0)} aria-controls="floor-filters" />
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {filtersOn && <ClearFiltersButton onClick={clearFilters} />}
            <RefreshButton onClick={() => void refresh()} refreshing={refreshing} />
          </span>
        </>}
      >
        {searchBox}
      </DataToolbar>
      {filtersOpen && <div id="floor-filters" role="group" aria-label="Filters" className="grid w-full gap-2 sm:grid-cols-2">{dateFilter}{listFilter}</div>}
    </>
  );

  const openQueue = () => { setQueueOpen(true); setArrival(null); };
  // Below lg the bookmark would sit on the cards' buttons: the queue is a button instead — in the
  // header on a tablet, in the bottom bar on a phone. A new arrival shows on it in place of its name.
  const queueButton = (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={openQueue}
        aria-label={`Open the transfer queue, ${waitingCount} waiting`}
        className={cn("max-w-full", phone && "w-full", waitingCount && "border-[var(--primary)]")}
      >
        <Inbox className="text-[var(--accent-ink)]" aria-hidden="true" />
        <span className="min-w-0 truncate">{arrival ?? "Transfer queue"}</span>
        <span className={cn("inline-flex min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums", waitingCount ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "bg-[var(--surface-alt)] text-muted-foreground")}>{waitingCount}</span>
      </Button>
      <span role="status" className="sr-only">{arrival ?? ""}</span>
    </>
  );

  return (
    // On a phone the page keeps room at its foot for the bottom bar, so the bar never covers a card.
    <div className={cn("m-stagger flex w-full min-w-0 flex-col gap-6", phone && "pb-[calc(6rem+env(safe-area-inset-bottom))]")}>
      {wide || phone ? header : <PageHeader title="Agent Floor" actions={queueButton} />}

      {/* Under the title: which list to look at on the left, your own status on the right. Below lg
          the tabs scroll sideways instead of wrapping. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Floor lists" className={cn("inline-flex h-9 gap-0.5 rounded-md bg-[var(--canvas)] p-0.5", !wide && "max-w-full overflow-x-auto")}>
          {tabs.map((item) => (
            <button
              key={item.key}
              id={`floor-tab-${item.key}`}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              aria-controls="floor-tabpanel"
              onClick={() => { setTab(item.key); setPages(FIRST_PAGES); }}
              className={cn("inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm font-semibold tracking-[-0.01em]", !wide && "shrink-0 whitespace-nowrap", tab === item.key ? "border-border bg-card text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {item.label}
              <span className="rounded-full bg-[var(--surface-alt)] px-1.5 text-xs tabular-nums text-muted-foreground">{item.count}</span>
            </button>
          ))}
        </div>
        {!phone && statusButtons}
      </div>

      <StatStrip label="Floor totals">
        <StatTile label="Agents available" value={`${k.available} of ${k.onFloor}`} footnote="on the floor now" />
        <StatTile label="On a call" value={floor.onCalls.length} valueTone={k.staleCalls ? "warning" : undefined} footnote={k.staleCalls ? `${k.staleCalls} open over 4 hours` : "open call records"} />
        <StatTile label="Waiting transfers" value={waitingCount} valueTone={k.longest >= thresholds.redSeconds ? "danger" : k.longest >= thresholds.amberSeconds ? "warning" : undefined} footnote={waitingCount ? `longest ${waitLabel(k.longest)} · escalates at ${thresholdLabel(thresholds.redSeconds)}` : "nobody waiting"} />
        <StatTile label="Callbacks due today" value={k.dueToday} valueTone={k.overdue ? "danger" : undefined} footnote={k.overdue ? `${k.overdue} overdue` : "none overdue"} />
      </StatStrip>

      {readOnly && <Callout tone="warning" title="Account suspended — the floor is read-only." />}
      {floor.truncated && <Callout tone="warning" title="Showing the 500 longest-waiting open transfers." />}
      {error && <Callout tone="error" title={<span className="flex flex-wrap items-center gap-3">Refresh to see the latest floor. {error}<Button type="button" variant="outline" onClick={() => void refresh()}>Refresh</Button></span>} />}

      <PendingHandoffs items={floor.pendingHandoffs} readOnly={readOnly} saving={saving} now={now} compact={!wide} onAccept={(id, workItemId) => void accept(id, workItemId)} />

      <div key={tab} id="floor-tabpanel" role="tabpanel" aria-labelledby={`floor-tab-${tab}`}>
        {tab === "calls" && <OnCalls calls={onCalls} filtered={filtersOn} now={now} currentUserId={currentUserId} isOwner={role === "owner"} readOnly={readOnly} saving={saving} compact={!wide} page={pages.calls} onPage={pageTo("calls")} onRelease={(call, action) => void release(call, action)} onClear={clearFilters} onOpenQueue={openQueue} toolbar={toolbar} />}
        {tab === "roster" && <Roster members={members} searching={filtersOn} now={now} currentUserId={currentUserId} isOwner={role === "owner"} canAsk={Boolean(headOfQueue)} readOnly={readOnly} saving={saving} compact={!wide} page={pages.roster} onPage={pageTo("roster")} onAsk={(member) => headOfQueue && void sendNudge(headOfQueue.id, member)} onClear={clearFilters} toolbar={toolbar} />}
        {tab === "callbacks" && <CallbacksTable items={callbacks} searching={filtersOn} compact={!wide} page={pages.callbacks} onPage={pageTo("callbacks")} onClear={clearFilters} toolbar={toolbar} />}
      </div>

      {/* The transfer queue hangs off the right edge like a bookmark, with the waiting count on it,
          and opens as a side panel over the page. A transfer that arrives while it is shut shows a
          short note beside the bookmark. The bookmark stays mounted (hidden) while the queue is open,
          so closing the queue hands focus back to it. From lg only (2026-10-09 mobile); below lg it
          is the queue button above. */}
      {wide && <div className={cn("fixed right-0 top-1/2 z-40 flex -translate-y-1/2 items-center gap-2", queueOpen && "hidden")}>
        {arrival && (
          <button type="button" onClick={() => { setQueueOpen(true); setArrival(null); }} className="m-row max-w-[260px] rounded-lg border border-border bg-card px-3 py-2 text-left text-sm font-semibold text-foreground shadow-[0_8px_24px_rgba(0,0,0,.18)]" role="status">
            {arrival}
            <span className="block text-xs font-normal text-muted-foreground">Open the queue to pick it up</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => { setQueueOpen(true); setArrival(null); }}
          aria-label={`Open the transfer queue, ${waitingCount} waiting`}
          className={cn("flex flex-col items-center gap-2 rounded-l-lg border border-r-0 border-border bg-card px-2 py-3 shadow-[0_4px_16px_rgba(0,0,0,.14)] hover:bg-[var(--surface-alt)]", waitingCount && "border-[var(--primary)]")}
        >
          <Inbox className="size-4 text-[var(--accent-ink)]" aria-hidden="true" />
          <span className="text-xs font-semibold text-foreground [writing-mode:vertical-rl]">Transfer queue</span>
          <span className={cn("inline-flex min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums", waitingCount ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "bg-[var(--surface-alt)] text-muted-foreground")}>{waitingCount}</span>
        </button>
      </div>}
      {/* A phone's bottom bar: the queue, and your status under the thumb. Fixed to the screen's foot,
          above the home indicator (safe-area inset); the queue's sheet and the menu drawer cover it. */}
      {phone && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex flex-col gap-2 border-t border-border bg-card px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-overlay)]">
          {queueButton}
          {statusButtons}
        </div>
      )}
      {queueOpen && (
        <TransferQueue
          items={waiting}
          totalWaiting={waitingCount}
          now={now}
          thresholds={thresholds}
          expandedId={expandedId}
          readOnly={readOnly}
          saving={saving}
          members={floor.members}
          toolbar={<ToolbarSearch value={queueSearch} onChange={(value) => { setQueueSearch(value); setPages((current) => ({ ...current, queue: 1 })); }} placeholder="Search the queue" className="sm:w-full" />}
          liveStatus={liveStatus}
          compact={!wide}
          page={pages.queue}
          onPage={pageTo("queue")}
          onClearSearch={() => setQueueSearch("")}
          onToggle={(id) => setExpandedId((current) => (current === id ? null : id))}
          onClaim={(id) => void claim(id)}
          onNudge={(id) => void sendNudge(id, null)}
          onClose={() => setQueueOpen(false)}
        />
      )}
    </div>
  );
}
