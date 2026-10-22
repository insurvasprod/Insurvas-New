"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import type { AgentAlert } from "@/lib/agentAlerts/useAgentAlertFeed";
import {
  SNOOZE_OPTIONS, activeSnoozes, bellEmptyTitle, bellToneOf, bellFilterChips, bellGroupSummary, chunkIds, filterBellItems,
  groupBellItems, idsReadByOpening, nextSnoozeExpiry, parseSnoozeMap, snoozeIds, snoozeStorageKey, snoozeUntil,
  unsnoozeIds, type BellFilter, type BellItem, type SnoozeMap, type SnoozeOption,
} from "@/lib/agentAlerts/bell";
import { KBD_ITEM_ATTRIBUTE, KBD_LIST_ATTRIBUTE } from "@/lib/keyboard/listNavigation";
import { notify } from "@/lib/notify";
import { EmptyState } from "@/components/ui/page-states";
import { InfoTip } from "@/components/ui/info-tip";
import { StatusChip } from "@/components/ui/status-chip";
import { Segmented } from "@/components/ui/view-tabs";

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
  const unreadShown = shown.filter((item) => !item.read);

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

  const unread = centre.badgeIds.size;

  return (
    <>
      <header className="portal-top-panel-head">
        <span className="inline-flex items-center gap-1">
          Notifications
          <InfoTip label="About notifications" side="bottom">
            Addressed to you. Opening one marks it read. Snoozed ones come back unread at the time you pick, in this browser only.
          </InfoTip>
        </span>
        <span>{unread ? `${unread} unread` : "Nothing unread"}</span>
      </header>
      <div className="shrink-0 border-b border-[var(--border)] px-3.5 py-2">
        <Segmented label="Show notifications" options={chips} value={filter} onChange={(key) => { setFilter(key); setSnoozing(null); }} />
      </div>
      <div className="portal-top-panel-scroll" {...{ [KBD_LIST_ATTRIBUTE]: "" }}>
        {groups.map((group) => {
          const isOpen = expanded.has(group.key);
          const allRead = group.unreadCount === 0;
          const memberIds = group.members.map((member) => member.id);
          const snoozedUntil = filter === "snoozed" ? centre.snoozes[group.newest.id] : undefined;
          return (
            <div key={group.key} className="portal-top-notif m-row">
              <span className={`portal-top-notif-dot${allRead ? " invisible" : ""}`} data-tone={bellToneOf(group.newest.event_type)} aria-hidden="true" />
              <div className="portal-top-notif-text">
                <Link
                  href={group.link}
                  {...{ [KBD_ITEM_ATTRIBUTE]: "" }}
                  onClick={() => open(group.members, group.link)}
                  className="block rounded-sm no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="portal-top-notif-head">
                    <span className="portal-top-notif-title">{group.newest.title}</span>
                    <time dateTime={group.newest.created_at}>{whenLabel(group.newest.created_at)}</time>
                  </span>
                  <span className="portal-top-notif-body">{group.newest.body}</span>
                </Link>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs leading-[1.5] font-semibold">
                  {group.count > 1 && <StatusChip tone="info" dot={false}>{bellGroupSummary(group)}</StatusChip>}
                  {allRead && <StatusChip>Read</StatusChip>}
                  {snoozedUntil && <StatusChip tone="warning">Until {untilLabel(snoozedUntil)}</StatusChip>}
                  {snoozing === group.key ? (
                    <span role="group" aria-label="Snooze for" className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                      {SNOOZE_OPTIONS.map((option) => (
                        <button key={option.key} type="button" onClick={() => { centre.snooze(memberIds, option.key); setSnoozing(null); }} className="text-[var(--accent-ink)] hover:underline">
                          {option.label}
                        </button>
                      ))}
                      <button type="button" onClick={() => setSnoozing(null)} className="text-[var(--muted)] hover:underline">Cancel</button>
                    </span>
                  ) : (
                    <>
                      {group.count > 1 && (
                        <button type="button" aria-expanded={isOpen} onClick={() => toggleExpanded(group.key)} className="text-[var(--accent-ink)] hover:underline">
                          {isOpen ? "Hide" : `Show ${group.count}`}
                        </button>
                      )}
                      {filter === "snoozed" ? (
                        <button type="button" onClick={() => centre.unsnooze(memberIds)} className="text-[var(--accent-ink)] hover:underline">Unsnooze</button>
                      ) : !allRead && (
                        <button type="button" onClick={() => setSnoozing(group.key)} className="text-[var(--muted)] hover:text-[var(--ink)] hover:underline">Snooze</button>
                      )}
                    </>
                  )}
                </div>
                {isOpen && group.count > 1 && (
                  <ul className="mt-2 space-y-1.5 border-l border-[var(--border)] pl-3" aria-label={bellGroupSummary(group)}>
                    {group.members.map((member) => (
                      <li key={member.id}>
                        <Link
                          href={member.link}
                          {...{ [KBD_ITEM_ATTRIBUTE]: "" }}
                          onClick={() => open([member], member.link)}
                          className="block rounded-sm no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="flex items-baseline justify-between gap-2 text-xs leading-[1.5]">
                            <span className={`truncate font-semibold ${member.read ? "text-[var(--muted)]" : "text-[var(--ink)]"}`}>{member.title}</span>
                            <time dateTime={member.created_at} className="shrink-0 text-[var(--muted)] tabular-nums">{whenLabel(member.created_at)}</time>
                          </span>
                          <span className="block truncate text-xs leading-[1.5] text-[var(--body)]">{member.body}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          );
        })}
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
                ? <button type="button" onClick={() => setFilter("all")} className="portal-top-foot-action text-sm">Show all</button>
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
            <button type="button" onClick={() => centre.read(unreadShown)} disabled={!unreadShown.length} className="portal-top-foot-action">
              Mark all as read
            </button>
          )}
        {openPreferences && (
          <button type="button" onClick={openPreferences} className="portal-top-foot-link">
            Notification preferences
          </button>
        )}
      </div>
    </>
  );
}
