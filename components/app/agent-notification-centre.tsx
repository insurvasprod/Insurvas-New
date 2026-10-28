"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlarmClockOff, AtSign, Bell, Check, CheckCheck, Clock, MessageSquare, PhoneCall, PhoneForwarded, Settings2, TriangleAlert, Wrench, type LucideIcon } from "lucide-react";

import type { AgentAlert } from "@/lib/agentAlerts/useAgentAlertFeed";
import {
  SNOOZE_OPTIONS, activeSnoozes, bellEmptyTitle, bellFilterChips, bellGroupSummary, bellKindOf, chunkIds, filterBellItems,
  groupBellItems, idsReadByOpening, nextSnoozeExpiry, parseSnoozeMap, snoozeIds, snoozeStorageKey, snoozeUntil,
  unsnoozeIds, type BellFilter, type BellItem, type BellKind, type SnoozeMap, type SnoozeOption,
} from "@/lib/agentAlerts/bell";
import { KBD_ITEM_ATTRIBUTE, KBD_LIST_ATTRIBUTE } from "@/lib/keyboard/listNavigation";
import { notify } from "@/lib/notify";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { Segmented } from "@/components/ui/view-tabs";
import { cn } from "@/lib/utils";

/**
 * The agent bell as a notification centre (2026-10-09): grouped, filterable, snoozable, and every
 * row opens the thing it is about. The rules live in lib/agentAlerts/bell.ts (tested); this is the
 * state and the drawing. The poller stays the one in useAgentAlertFeed — this only reads its list.
 *
 * Snooze is kept in this browser only (localStorage, keyed by the user id); a cross-device snooze
 * needs a table — the proposed SQL is at the top of lib/agentAlerts/bell.ts.
 */

const READ_HERE_LIMIT = 50;

function readSnoozes(userId: string): SnoozeMap {
  try { return parseSnoozeMap(window.localStorage.getItem(snoozeStorageKey(userId))); } catch { return {}; }
}
function writeSnoozes(userId: string, map: SnoozeMap) {
  try { window.localStorage.setItem(snoozeStorageKey(userId), JSON.stringify(map)); } catch { /* snooze is a nicety; the bell works without it */ }
}

function whenLabel(iso: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  return new Date(iso).toLocaleDateString();
}

function untilLabel(iso: string) {
  const at = new Date(iso);
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return at.toDateString() === new Date().toDateString() ? time : `${at.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

export type BellCentre = ReturnType<typeof useBellCentre>;

/**
 * The bell's state: the feed's unread notifications plus the ones read from the bell on this page
 * (so "All" and "Unread" differ), and this browser's snoozes.
 */
export function useBellCentre(personal: AgentAlert[], userId: string | undefined, markRead: (ids: string[]) => Promise<void>) {
  const [readHere, setReadHere] = useState<BellItem[]>([]);
  const [snoozes, setSnoozes] = useState<SnoozeMap>({});
  const [now, setNow] = useState(0);

  // Read once the page is in the browser (storage is not there on the server, and reading it during
  // the first render would draw a different badge from the server's).
  useEffect(() => {
    const load = window.setTimeout(() => {
      setNow(Date.now());
      if (userId) setSnoozes(activeSnoozes(readSnoozes(userId), Date.now()));
    }, 0);
    return () => window.clearTimeout(load);
  }, [userId]);

  // Redraw when the next snooze ends, so the notification comes back on time.
  useEffect(() => {
    const next = nextSnoozeExpiry(snoozes, now);
    if (next === null) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(2_147_000_000, next - now + 250));
    return () => window.clearTimeout(timer);
  }, [snoozes, now]);

  const active = useMemo(() => activeSnoozes(snoozes, now), [snoozes, now]);
  const snoozedIds = useMemo(() => new Set(Object.keys(active)), [active]);

  const items = useMemo<BellItem[]>(() => {
    const unreadIds = new Set(personal.map((alert) => alert.id));
    const unread = personal.map((alert) => ({ id: alert.id, title: alert.title, body: alert.body, link: alert.link, event_type: alert.event_type, created_at: alert.created_at, read: false }));
    return [...unread, ...readHere.filter((item) => !unreadIds.has(item.id))];
  }, [personal, readHere]);

  const updateSnoozes = useCallback((change: (current: SnoozeMap, at: number) => SnoozeMap) => {
    const at = Date.now();
    setNow(at);
    setSnoozes((current) => {
      const next = activeSnoozes(change(current, at), at);
      if (userId) writeSnoozes(userId, next);
      return next;
    });
  }, [userId]);

  /** Marks these read on the server (the existing by-id route, in chunks it accepts) and keeps them here. */
  const read = useCallback((toRead: BellItem[]) => {
    const fresh = toRead.filter((item) => !item.read);
    if (!fresh.length) return;
    const ids = fresh.map((item) => item.id);
    const reading = new Set(ids);
    setReadHere((current) => [...fresh.map((item) => ({ ...item, read: true })), ...current.filter((item) => !reading.has(item.id))].slice(0, READ_HERE_LIMIT));
    if (ids.some((id) => snoozedIds.has(id))) updateSnoozes((current) => unsnoozeIds(current, ids));
    for (const chunk of chunkIds(ids)) void markRead(chunk);
  }, [markRead, snoozedIds, updateSnoozes]);

  const snooze = useCallback((ids: string[], option: SnoozeOption) => {
    const until = snoozeUntil(option, new Date());
    updateSnoozes((current) => snoozeIds(current, ids, until));
    notify.done(`Snoozed until ${untilLabel(until.toISOString())}`);
  }, [updateSnoozes]);

  const unsnooze = useCallback((ids: string[]) => updateSnoozes((current) => unsnoozeIds(current, ids)), [updateSnoozes]);

  /** The badge: unread and awake. */
  const badgeIds = useMemo(() => new Set(items.filter((item) => !item.read && !snoozedIds.has(item.id)).map((item) => item.id)), [items, snoozedIds]);

  return { items, snoozedIds, snoozes: active, now, badgeIds, read, snooze, unsnooze };
}

/** Each kind of notification's icon and colour, so a row says what it is before it is read. */
const KIND_LOOK: Record<BellKind, { icon: LucideIcon; tone: string }> = {
  action_needed: { icon: TriangleAlert, tone: "var(--warning)" },
  handoff: { icon: PhoneForwarded, tone: "var(--success)" },
  mention: { icon: AtSign, tone: "var(--info)" },
  partner_message: { icon: MessageSquare, tone: "var(--info)" },
  callback: { icon: PhoneCall, tone: "var(--warning)" },
  servicing: { icon: Wrench, tone: "var(--warning)" },
  other: { icon: Bell, tone: "var(--muted)" },
};

/** Today, Yesterday or Earlier, on this browser's calendar. */
function dayOf(iso: string): "Today" | "Yesterday" | "Earlier" {
  const at = new Date(iso);
  const today = new Date();
  if (at.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  return at.toDateString() === yesterday.toDateString() ? "Yesterday" : "Earlier";
}

const iconButton = "inline-grid size-7 place-items-center rounded-md text-[var(--muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_8%,transparent)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring-color)]";

/**
 * The bell's panel (redrawn 2026-10-28, owner: "I don't like how it is presented"). One control row
 * (All / Unread, and the kind as a menu) instead of a header plus a scrolling chip strip; the list in
 * Today / Yesterday / Earlier; each row an icon for its kind, the title and two lines of text, and
 * its actions (mark read, snooze) as quiet icons on the right. Grouping, filters and snoozes are the
 * same rules as before (lib/agentAlerts/bell.ts).
 */
export function NotificationCentrePanel({
  centre,
  close,
  openPreferences,
  readStateUnavailable,
}: {
  centre: BellCentre;
  close: () => void;
  /** Null when the shell has no preferences to open. */
  openPreferences: (() => void) | null;
  readStateUnavailable?: string | null;
}) {
  const [filter, setFilter] = useState<BellFilter>("all");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [snoozing, setSnoozing] = useState<string | null>(null);

  const chips = useMemo(() => bellFilterChips(centre.items, centre.snoozedIds, filter), [centre.items, centre.snoozedIds, filter]);
  const shown = useMemo(() => filterBellItems(centre.items, filter, centre.snoozedIds), [centre.items, filter, centre.snoozedIds]);
  const groups = useMemo(() => groupBellItems(shown), [shown]);
  const sections = useMemo(() => {
    const order = ["Today", "Yesterday", "Earlier"] as const;
    return order.map((day) => ({ day, groups: groups.filter((group) => dayOf(group.newest.created_at) === day) })).filter((section) => section.groups.length);
  }, [groups]);
  const unreadShown = shown.filter((item) => !item.read);

  // All and Unread are the two everyday views; a kind (and Snoozed) is chosen from the menu beside them.
  const everyday = chips.filter((chip) => chip.key === "all" || chip.key === "unread");
  const kinds = chips.filter((chip) => chip.key !== "all" && chip.key !== "unread");
  const choose = (key: BellFilter) => { setFilter(key); setSnoozing(null); };

  /** A row's primary action: the link navigates, and the members it opens are marked read. */
  function open(members: BellItem[], link: string) {
    const ids = new Set(idsReadByOpening({ members }, link));
    centre.read(members.filter((member) => ids.has(member.id)));
    close();
  }

  function toggleExpanded(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-3.5 py-2.5">
        <Segmented
          label="Show notifications"
          options={everyday}
          value={filter === "all" || filter === "unread" ? filter : ("" as BellFilter)}
          onChange={choose}
        />
        {kinds.length > 0 && (
          <select
            aria-label="Type of notification"
            className={cn(toolbarControl, "h-8 max-w-[11rem] text-xs")}
            value={filter === "all" || filter === "unread" ? "" : filter}
            onChange={(event) => choose((event.target.value || "all") as BellFilter)}
          >
            <option value="">Every type</option>
            {kinds.map((chip) => <option key={chip.key} value={chip.key}>{chip.label}{chip.count ? ` (${chip.count})` : ""}</option>)}
          </select>
        )}
      </div>

      <div className="portal-top-panel-scroll" {...{ [KBD_LIST_ATTRIBUTE]: "" }}>
        {sections.map((section) => (
          <section key={section.day} aria-label={section.day}>
            <h3 className="sticky top-0 z-[1] m-0 bg-[var(--color-card)] px-3.5 pt-2.5 pb-1 text-xs font-semibold text-[var(--muted)]">{section.day}</h3>
            {section.groups.map((group) => {
              const isOpen = expanded.has(group.key);
              const unread = group.unreadCount > 0;
              const memberIds = group.members.map((member) => member.id);
              const snoozedUntil = filter === "snoozed" ? centre.snoozes[group.newest.id] : undefined;
              const look = KIND_LOOK[bellKindOf(group.newest.event_type)] ?? KIND_LOOK.other;
              const Icon = look.icon;
              return (
                <div
                  key={group.key}
                  className={cn(
                    "group/notif relative flex gap-3 px-3.5 py-3 transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_4%,transparent)]",
                    unread && "bg-[color-mix(in_srgb,var(--primary)_5%,transparent)]",
                  )}
                >
                  <span aria-hidden="true" className="relative grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: `color-mix(in srgb, ${look.tone} 16%, transparent)`, color: look.tone }}>
                    <Icon className="size-4" />
                    {unread && <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[var(--color-card)] bg-[var(--primary)]" />}
                  </span>

                  <div className="min-w-0 flex-1">
                    <Link
                      href={group.link}
                      {...{ [KBD_ITEM_ATTRIBUTE]: "" }}
                      onClick={() => open(group.members, group.link)}
                      className="block rounded-sm pr-14 no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className={cn("line-clamp-2 text-sm leading-[1.4] tracking-[-0.01em]", unread ? "font-semibold text-[var(--ink)]" : "font-medium text-[var(--body)]")}>
                        {group.newest.title}
                      </span>
                      <span className="mt-0.5 line-clamp-2 text-xs leading-[1.5] text-[var(--muted)]">{group.newest.body}</span>
                    </Link>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
                      <time dateTime={group.newest.created_at} className="tabular-nums">{whenLabel(group.newest.created_at)}</time>
                      {group.count > 1 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <button type="button" aria-expanded={isOpen} onClick={() => toggleExpanded(group.key)} className="font-semibold text-[var(--accent-ink)] hover:underline">
                            {isOpen ? "Hide the others" : bellGroupSummary(group)}
                          </button>
                        </>
                      )}
                      {snoozedUntil && <StatusChip tone="warning">Until {untilLabel(snoozedUntil)}</StatusChip>}
                    </div>

                    {snoozing === group.key && (
                      <div role="group" aria-label="Snooze for" className="mt-2 flex flex-wrap items-center gap-1.5">
                        {SNOOZE_OPTIONS.map((option) => (
                          <ToggleChip key={option.key} onClick={() => { centre.snooze(memberIds, option.key); setSnoozing(null); }}>{option.label}</ToggleChip>
                        ))}
                        <button type="button" onClick={() => setSnoozing(null)} className="ml-1 text-xs text-[var(--muted)] hover:underline">Cancel</button>
                      </div>
                    )}

                    {isOpen && group.count > 1 && (
                      <ul className="mt-2 space-y-2 border-l-2 border-[var(--border)] pl-3" aria-label={bellGroupSummary(group)}>
                        {group.members.map((member) => (
                          <li key={member.id}>
                            <Link
                              href={member.link}
                              {...{ [KBD_ITEM_ATTRIBUTE]: "" }}
                              onClick={() => open([member], member.link)}
                              className="block rounded-sm no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span className="flex items-baseline justify-between gap-2 text-xs leading-[1.5]">
                                <span className={cn("truncate font-semibold", member.read ? "text-[var(--muted)]" : "text-[var(--ink)]")}>{member.title}</span>
                                <time dateTime={member.created_at} className="shrink-0 text-[var(--muted)] tabular-nums">{whenLabel(member.created_at)}</time>
                              </span>
                              <span className="block truncate text-xs leading-[1.5] text-[var(--muted)]">{member.body}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Quiet until the row is hovered or focused; a keyboard user tabs straight to them. */}
                  <div className="absolute top-2.5 right-2.5 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/notif:opacity-100 focus-within:opacity-100">
                    {filter === "snoozed" ? (
                      <button type="button" onClick={() => centre.unsnooze(memberIds)} className={iconButton} aria-label="Wake it now" title="Wake it now"><AlarmClockOff className="size-4" aria-hidden /></button>
                    ) : unread && (
                      <>
                        <button type="button" onClick={() => centre.read(group.members)} className={iconButton} aria-label="Mark as read" title="Mark as read"><Check className="size-4" aria-hidden /></button>
                        <button type="button" onClick={() => setSnoozing(snoozing === group.key ? null : group.key)} className={iconButton} aria-label="Snooze" title="Snooze: it comes back unread at the time you pick, in this browser"><Clock className="size-4" aria-hidden /></button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        ))}
        {!groups.length && (
          <EmptyState
            title={bellEmptyTitle(filter)}
            hint={
              filter === "all" ? "Handoffs, mentions, partner messages and callbacks due land here."
                : filter === "unread" ? "You are all caught up."
                : filter === "snoozed" ? "Snoozed notifications wait here until their time."
                : "Nothing of this kind right now."
            }
            action={
              filter !== "all"
                ? <button type="button" onClick={() => choose("all")} className="portal-top-foot-action text-sm">Show all</button>
                : openPreferences
                  ? <button type="button" onClick={openPreferences} className="portal-top-foot-action text-sm">Notification preferences</button>
                  : undefined
            }
          />
        )}
      </div>

      <div className="portal-top-panel-foot">
        {readStateUnavailable
          ? <span>{readStateUnavailable}</span>
          : (
            <button type="button" onClick={() => centre.read(unreadShown)} disabled={!unreadShown.length} className="portal-top-foot-action inline-flex items-center gap-1.5">
              <CheckCheck className="size-4" aria-hidden />Mark all as read
            </button>
          )}
        {openPreferences && (
          <button type="button" onClick={openPreferences} className="portal-top-foot-link inline-flex items-center gap-1.5">
            <Settings2 className="size-4" aria-hidden />Preferences
          </button>
        )}
      </div>
    </>
  );
}
