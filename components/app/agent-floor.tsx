"use client";

import { StatusChip } from "@/components/ui/status-chip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ClearFiltersButton, DataToolbar, FilterButton, FilterPanel, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { DetailPanel } from "@/components/ui/detail-panel";
import { PageHeader } from "@/components/ui/page-header";
import { TeamViews } from "@/components/app/inbound/transfers-views";
import { callHref, secondsSince, shortDuration, useFloor, type Call, type Callback, type FloorData, type Handoff, type Lead, type Member } from "@/components/app/inbound/use-floor";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Callout, st, type PillTone, pillTone } from "@/components/app/settings/primitives";
import { ActionButton, CardActions, CardList, cardItem, COMPACT_TOOLBAR, TABLET_QUERY, useMediaQuery, WIDE_QUERY, type RowAction } from "@/components/app/responsive-list";
import { productLineLabel } from "@/lib/format/productLine";
import { languageKey, languageName } from "@/lib/transferInbox/constants";
import { cn } from "@/lib/utils";
import { clockTime as zonedClock, dayMonth, dayMonthYear, viewerTimeZone, zonedParts } from "@/lib/format/dates";
import { ViewTabs } from "@/components/ui/view-tabs";

/** Rows per page in the queue panel; the floor's tables fit the window (useFloorPageSize). */
const FLOOR_PAGE = 10;
/** The floor's tab tables: as many rows as the window holds below the totals and the tabs, at most 10. */
const useFloorPageSize = () => useFittingPageSize(560, 49);
type FloorPages = { calls: number; roster: number; queue: number; callbacks: number };
type FloorTab = "calls" | "roster" | "callbacks";

/** The viewer's calendar day of an instant, as the date input writes it ("2026-10-05"). */
function localDay(value: string) {
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleDateString("en-CA");
}
const FIRST_PAGES: FloorPages = { calls: 1, roster: 1, queue: 1, callbacks: 1 };

/* ── time ──────────────────────────────────────────────────────────────── */

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
  if (item.preflight?.matches?.[0]?.partnerName) return `Previous lead from ${item.preflight.matches[0].partnerName}.`;
  if (item.preflightStatus !== "new_household") return "We have spoken to this person before.";
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
  eligible: { tone: "success", label: "Clear to take" },
  review: { tone: "warning", label: "Check first" },
  blocked: { tone: "error", label: "Same person found" },
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
  available: { tone: "success", label: "Taking calls" },
  on_call: { tone: "brand", label: "On a call" },
  away: { tone: "error", label: "Away" },
  wrap_up: { tone: "warning", label: "On break" },
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
    return from ? `Free ${shortDuration(Math.max(0, Math.floor((now - from) / 1000)))}` : "Free";
  }
  if (state === "wrap_up") {
    if (since) return `On break ${shortDuration(Math.max(0, Math.floor((now - since) / 1000)))}`;
    return member.lastCall ? `After ${member.lastCall.customer}` : "On break";
  }
  // Offline. Present on the page but set to offline says when they went; otherwise when last seen.
  if (!isStale(member.lastSeenAt, now) && member.statusChangedAt) return `Offline since ${clockTime(member.statusChangedAt, now)}`;
  return member.lastSeenAt ? `Last seen ${clockTime(member.lastSeenAt, now)}` : "Not seen yet";
}

/* ── pieces ────────────────────────────────────────────────────────────── */

function PendingHandoffs({ items, readOnly, saving, now, compact, onAccept }: { items: Handoff[]; readOnly: boolean; saving: string | null; now: number; compact: boolean; onAccept: (id: string, workItemId: string) => void }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="handoffs-heading" className="rounded-[12px] border border-[var(--border)] border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] px-4 py-3">
      <h2 id="handoffs-heading" className="m-0 text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--info-ink)]">
        {items.length === 1 ? "A call was passed to you" : `${items.length} calls were passed to you`}
      </h2>
      <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
        {items.map((handoff) => (
          <li key={handoff.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
            <span className="min-w-0">
              <span className="block text-sm leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--ink)]">{handoff.customer}</span>
              <span className={st.sub}>
                From {handoff.bufferName} · {productLineLabel(handoff.productLine)} · {handoff.progressPercentage}% checked
                {handoff.fieldsLeft != null ? (handoff.fieldsLeft === 0 ? " · every required detail confirmed" : ` · ${handoff.fieldsLeft} required ${handoff.fieldsLeft === 1 ? "detail" : "details"} left`) : ""}
                {handoff.expiresAt && new Date(handoff.expiresAt).getTime() > now ? ` · goes back to ${handoff.bufferName} at ${clockTime(handoff.expiresAt, now)}` : ""}
              </span>
            </span>
            <Button type="button" size={compact ? "default" : "sm"} disabled={readOnly || saving === `handoff:${handoff.id}`} onClick={() => onAccept(handoff.id, handoff.workItemId)}>
              {saving === `handoff:${handoff.id}` ? "Taking over…" : "Take over the call"}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Calls taken this long ago with no outcome are almost always forgotten, not long. */
const FORGOTTEN_AFTER_S = 4 * 3600;

/**
 * Team · Needs you (2026-10-27): what an owner or manager should fix first. Callers who have waited
 * past the "too long" limit, and calls taken hours ago that nobody finished. Each row has the act
 * that fixes it. Nothing here is new data: it is the floor read, sorted by what needs a person.
 */
function NeedsYou({ floor, now, currentUserId, isOwner, readOnly, saving, onNudge, onClaim, onRelease }: { floor: FloorData; now: number; currentUserId: string; isOwner: boolean; readOnly: boolean; saving: string | null; onNudge: (workItemId: string) => void; onClaim: (workItemId: string) => void; onRelease: (call: Call) => void }) {
  const limit = floor.waitThresholds.redSeconds;
  const late = floor.waiting.filter((item) => secondsSince(item.queuedAt, now) >= limit).sort((a, b) => new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime());
  const forgotten = floor.onCalls.filter((call) => secondsSince(call.startedAt, now) >= FORGOTTEN_AFTER_S).sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  const count = late.length + forgotten.length;
  const row = "flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3";
  return (
    <TableCard title="Needs you" description={count ? "Fix these first." : undefined} action={count > 0 ? <StatusChip tone="danger" dot={false}>{count}</StatusChip> : undefined}>
      {count === 0 && <p className="m-0 px-4 py-3 text-sm text-[var(--muted)]">Nothing needs you right now. Nobody has waited too long and every call taken is moving.</p>}
      {late.map((item) => (
        <div key={item.id} className={row}>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-[var(--ink)]">{item.customer} waiting {waitLabel(secondsSince(item.queuedAt, now))}</span>
            <span className={st.sub}>{[item.state, productLineLabel(item.productLine), item.partnerName].filter(Boolean).join(" · ")} · too long at {thresholdLabel(limit)}{item.escalatedAt ? "; everyone taking calls was asked" : ""}</span>
          </span>
          <span className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={readOnly || saving === `nudge:${item.id}`} onClick={() => onNudge(item.id)}>{saving === `nudge:${item.id}` ? "Asking…" : "Ask the team"}</Button>
            <Button type="button" size="sm" disabled={readOnly || saving === item.id} onClick={() => onClaim(item.id)}>{saving === item.id ? "Taking…" : "Take call"}</Button>
          </span>
        </div>
      ))}
      {forgotten.map((call) => {
        const mine = call.agentId === currentUserId;
        return (
          <div key={call.id} className={row}>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[var(--ink)]">{call.customer} · taken by {mine ? "you" : call.agentName}</span>
              <span className={st.sub}>Taken {callClock(secondsSince(call.startedAt, now))} ago, no outcome. The call was probably never finished.</span>
            </span>
            <span className="flex flex-wrap gap-2">
              {mine && <Button asChild size="sm"><Link href={callHref(call.id, "finish")}>Finish it</Link></Button>}
              {(mine || isOwner) && <Button type="button" variant="outline" size="sm" disabled={readOnly || saving === `unassign:${call.id}`} onClick={() => onRelease(call)}>{saving === `unassign:${call.id}` ? "Putting back…" : "Put back in line"}</Button>}
              {!mine && <Button asChild variant="outline" size="sm"><Link href={`/app/leads/${call.leadId}`}>Open lead</Link></Button>}
            </span>
          </div>
        );
      })}
    </TableCard>
  );
}

/** A roster row, read once for the table and the card alike. */
function rosterRow({ member, state }: { member: Member; state: RosterState }, ctx: { currentUserId: string; isOwner: boolean; canAsk: boolean; readOnly: boolean; saving: string | null; onAsk: (member: Member) => void }) {
  const pill = STATE_PILL[state];
  const onCall = state === "on_call" || state === "away";
  const askable = ctx.isOwner && ctx.canAsk && member.id !== ctx.currentUserId && (state === "available" || state === "wrap_up");
  const detail = (member.role === "assistant" || member.languages?.length)
    ? [member.role === "assistant" ? "Screener" : null, member.languages?.length ? member.languages.map(languageName).join(", ") : null].filter(Boolean).join(" · ")
    : null;
  const action: RowAction | null = onCall && member.call
    ? { key: "open", label: "Open lead", href: `/app/leads/${member.call.leadId}` }
    : askable
      ? { key: "ask", label: ctx.saving === `ask:${member.id}` ? "Asking…" : "Ask to take one", disabled: ctx.readOnly || ctx.saving === `ask:${member.id}`, onSelect: () => ctx.onAsk(member) }
      : null;
  return { pill, onCall, detail, action };
}

function Roster({ members, searching, now, currentUserId, isOwner, canAsk, readOnly, saving, compact, page, onPage, onAsk, onClear, toolbar }: { members: Member[]; searching: boolean; now: number; currentUserId: string; isOwner: boolean; canAsk: boolean; readOnly: boolean; saving: string | null; compact: boolean; page: number; onPage: (page: number) => void; onAsk: (member: Member) => void; onClear: () => void; toolbar: React.ReactNode }) {
  const sorted = members
    .map((member) => ({ member, state: rosterState(member, now) }))
    .sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || a.member.name.localeCompare(b.member.name));
  const pageSize = useFloorPageSize();
  const { current, rows } = paginate(sorted, page, pageSize);
  const ctx = { currentUserId, isOwner, canAsk, readOnly, saving, onAsk };
  return (
    <TableCard toolbar={toolbar} footer={sorted.length ? <Pager page={current} total={sorted.length} pageSize={pageSize} noun="agents" onPage={onPage} /> : undefined}>
      {rows.length === 0 ? (
        searching
          ? <NoMatches noun="agents" onClear={onClear} />
          : <EmptyState title="Nobody in the team yet" hint="Owners, agents and screeners appear here." />
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
  if (mine) actions.push({ key: "verify", primary: true, label: percent != null && percent >= 100 ? "Finish the call" : "Verification", href: percent != null && percent >= 100 ? callHref(call.id, "finish") : callHref(call.id, "verify") });
  // Two different acts (LA-1.14-9): the buffer leaving a call the agent keeps, and the agent giving the transfer back.
  if (call.buffer && (ctx.isOwner || call.buffer.userId === ctx.currentUserId || mine)) {
    actions.push({ key: "end_buffer", label: ctx.saving === `end_buffer:${call.id}` ? "Removing…" : "Remove the screener", disabled: ctx.readOnly || ctx.saving === `end_buffer:${call.id}`, onSelect: () => ctx.onRelease(call, "end_buffer") });
  }
  if (ctx.isOwner || mine) {
    actions.push({ key: "unassign", label: ctx.saving === `unassign:${call.id}` ? "Putting back…" : "Put back in line", disabled: ctx.readOnly || ctx.saving === `unassign:${call.id}`, onSelect: () => ctx.onRelease(call, "unassign") });
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
  const pageSize = useFloorPageSize();
  const { current, rows } = paginate(sorted, page, pageSize);
  const ctx = { currentUserId, isOwner, readOnly, saving, onRelease };
  return (
    <TableCard toolbar={toolbar} footer={sorted.length ? <Pager page={current} total={sorted.length} pageSize={pageSize} noun="calls" suffix="longest first" onPage={onPage} /> : undefined}>
      {rows.length === 0 ? (
        filtered
          ? <NoMatches noun="calls" onClear={onClear} />
          : <EmptyState title="Nobody is on a call" hint="Calls show here once someone takes a caller." action={<Button type="button" variant="outline" onClick={onOpenQueue}>See who is in line</Button>} />
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
      title={`In line · ${totalWaiting}`}
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
                      {item.escalatedAt && <StatusChip tone="danger" dot>Waiting too long</StatusChip>}
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
                    {saving === item.id ? "Taking…" : "Take call"}
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
                        {saving === `nudge:${item.id}` ? "Asking…" : "Ask the team"}
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
  const pageSize = useFloorPageSize();
  const { current, rows } = paginate(items, page, pageSize);
  const viewAll = <Link href="/app/callbacks" className="font-semibold text-[var(--accent-ink)] hover:underline">Open Callbacks</Link>;
  return (
    <TableCard
      toolbar={toolbar}
      footer={<Pager page={current} total={items.length} pageSize={pageSize} noun="callbacks" onPage={onPage} suffix={viewAll} />}
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

/**
 * Team (/app/inbound/team, was the Agent Floor at /app/floor; Inbound A, 2026-10-27): for owners and
 * managers, what needs them first, then everyone's status, the calls under way and the callbacks
 * due. Agents set their own status and take callers on Inbound (/app/inbound). The line of waiting
 * callers is kept here too, behind "In line", so a manager can take or push one.
 */
export function AgentFloor({ currentUserId, readOnly, role }: { currentUserId: string; readOnly: boolean; role: string }) {
  // Team keeps you present with your saved status (the heartbeat) but never changes it.
  const { floor, loading, error, now, saving, realtimeStatus, liveLabel, updated, refreshing, load, refresh, claim, sendNudge, accept, release } = useFloor({ readOnly });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Layout (2026-10-09 mobile): from lg the page is drawn wide. Below lg the lists are cards and the
  // filters sit behind a Filters button; below md (a phone) the line moves to a bar fixed to the bottom.
  const wide = useMediaQuery(WIDE_QUERY);
  const phone = !useMediaQuery(TABLET_QUERY);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // One list on screen at a time, picked with the tabs under the title. Search, the date and the
  // tab's own filter narrow that list; the transfer queue has its own search in its side panel.
  const [tab, setTab] = useState<FloorTab>("roster");
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

  const own = floor?.ownStatus ?? "off";
  const ownLabel = own === "ready" ? "You are taking calls" : own === "on_break" ? "You are on a break" : "You are not taking calls";
  const header = (
    <div className="flex flex-col gap-2">
      <PageHeader title="Team" breadcrumbs={[{ label: "Today" }, { label: "Inbound", href: "/app/inbound" }, { label: "Team" }]} actions={<><Link href="/app/inbound" className="text-sm font-semibold text-muted-foreground hover:text-foreground">{ownLabel} ›</Link>{role === "owner" && <Button asChild variant="outline"><Link href="/app/settings#queue-sla">Inbound settings</Link></Button>}</>} />
    </div>
  );

  if (!floor) {
    if (!(error && !loading)) return <PageLoading />;
    return (
      <div className="flex w-full min-w-0 flex-col gap-6">
        {header}
        <div role="alert">
          <Callout tone="error" title={<span className="flex flex-wrap items-center gap-3">We couldn’t open Team: {error}<Button type="button" variant="outline" onClick={() => void load({ initial: true })}>Try again</Button></span>} />
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
    { key: "roster", label: "People", count: floor.members.length },
    { key: "calls", label: "On a call", count: floor.onCalls.length },
    { key: "callbacks", label: "Callbacks due", count: floor.callbacks.length },
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
      <FilterPanel id="floor-filters" open={filtersOpen} className="w-full border-b-0 px-0 py-0">{dateFilter}{listFilter}</FilterPanel>
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
        aria-label={`Open the line, ${waitingCount} waiting`}
        className={cn("max-w-full", phone && "w-full", waitingCount && "border-[var(--primary)]")}
      >
        <Inbox className="text-[var(--accent-ink)]" aria-hidden="true" />
        <span className="min-w-0 truncate">{arrival ?? "In line"}</span>
        <span className={cn("inline-flex min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums", waitingCount ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "bg-[var(--surface-alt)] text-muted-foreground")}>{waitingCount}</span>
      </Button>
      <span role="status" className="sr-only">{arrival ?? ""}</span>
    </>
  );

  return (
    // On a phone the page keeps room at its foot for the bottom bar, so the bar never covers a card.
    <div className={cn("m-stagger flex w-full min-w-0 flex-col gap-6", phone && "pb-[calc(6rem+env(safe-area-inset-bottom))]")}>
      {header}
      <TeamViews current="now" />

      <StatStrip label="Floor totals">
        <StatTile label="In line" value={waitingCount} valueTone={k.longest >= thresholds.redSeconds ? "danger" : k.longest >= thresholds.amberSeconds ? "warning" : undefined} footnote={waitingCount ? `longest ${waitLabel(k.longest)} · too long at ${thresholdLabel(thresholds.redSeconds)}` : "nobody waiting"} />
        <StatTile label="Taking calls" value={`${k.available} of ${k.onFloor}`} footnote="free now, of everyone present" />
        <StatTile label="On a call" value={floor.onCalls.length} valueTone={k.staleCalls ? "warning" : undefined} footnote={k.staleCalls ? `${k.staleCalls} taken over 4 h ago` : "calls taken and not finished"} />
        <StatTile label="Callbacks due today" value={k.dueToday} valueTone={k.overdue ? "danger" : undefined} footnote={k.overdue ? `${k.overdue} overdue` : "none overdue"} />
      </StatStrip>

      <NeedsYou floor={floor} now={now} currentUserId={currentUserId} isOwner={role === "owner"} readOnly={readOnly} saving={saving} onNudge={(id) => void sendNudge(id, null)} onClaim={(id) => void claim(id)} onRelease={(call) => void release(call, "unassign")} />

      {readOnly && <Callout tone="warning" title="Your agency’s account is paused: you can look, but not take callers or change calls." />}
      {floor.truncated && <Callout tone="warning" title="Showing the 500 callers who have waited longest." />}
      {error && <Callout tone="error" title={<span className="flex flex-wrap items-center gap-3">Refresh to see the latest. {error}<Button type="button" variant="outline" onClick={() => void refresh()}>Refresh</Button></span>} />}

      <PendingHandoffs items={floor.pendingHandoffs} readOnly={readOnly} saving={saving} now={now} compact={!wide} onAccept={(id, workItemId) => void accept(id, workItemId)} />

      {/* Which list to look at, right above it; below lg the tabs scroll sideways instead of wrapping. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewTabs label="Floor lists" tabs={tabs} value={tab} onChange={(key) => { setTab(key); setPages(FIRST_PAGES); }} idPrefix="floor-tab" controls="floor-tabpanel" />
        {!wide && !phone && queueButton}
      </div>

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
            <span className="block text-xs font-normal text-muted-foreground">Open the line to take it</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => { setQueueOpen(true); setArrival(null); }}
          aria-label={`Open the line, ${waitingCount} waiting`}
          className={cn("flex flex-col items-center gap-2 rounded-l-lg border border-r-0 border-border bg-card px-2 py-3 shadow-[0_4px_16px_rgba(0,0,0,.14)] hover:bg-[var(--surface-alt)]", waitingCount && "border-[var(--primary)]")}
        >
          <Inbox className="size-4 text-[var(--accent-ink)]" aria-hidden="true" />
          <span className="text-xs font-semibold text-foreground [writing-mode:vertical-rl]">In line</span>
          <span className={cn("inline-flex min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums", waitingCount ? "bg-[var(--primary)] text-[var(--primary-foreground)]" : "bg-[var(--surface-alt)] text-muted-foreground")}>{waitingCount}</span>
        </button>
      </div>}
      {/* A phone's bottom bar: the queue, and your status under the thumb. Fixed to the screen's foot,
          above the home indicator (safe-area inset); the queue's sheet and the menu drawer cover it. */}
      {phone && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex flex-col gap-2 border-t border-border bg-card px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-overlay)]">
          {queueButton}
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
          toolbar={<ToolbarSearch value={queueSearch} onChange={(value) => { setQueueSearch(value); setPages((current) => ({ ...current, queue: 1 })); }} placeholder="Search the line" className="sm:w-full" />}
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
