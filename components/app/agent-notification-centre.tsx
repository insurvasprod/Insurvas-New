"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { AgentAlert } from "@/lib/agentAlerts/useAgentAlertFeed";
import {
  activeSnoozes, chunkIds, nextSnoozeExpiry, parseSnoozeMap, snoozeIds, snoozeStorageKey, snoozeUntil, unsnoozeIds,
  type BellItem, type SnoozeMap, type SnoozeOption,
} from "@/lib/agentAlerts/bell";
import { notify } from "@/lib/notify";
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

export function untilLabel(iso: string) {
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
