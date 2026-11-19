// Monitoring › Workspace (admin round 1, docs/design/admin-r1/monitoring.html screen 1): the arithmetic behind
// "what's unusual right now", with no database, so every rule is testable. workspaceQueries.ts reads the rows.

import { REPEATED_FAILURE_MIN, repeatedFailures, type RepeatedFailure } from "../loginEvents/present.ts";
import type { LockoutEntry } from "../loginEvents/lockouts.ts";

export type WorkspaceRange = "today" | "7d" | "30d";

export const WORKSPACE_RANGES: ReadonlyArray<{ key: WorkspaceRange; label: string; phrase: string; versus: string }> = [
  { key: "today", label: "Today", phrase: "today", versus: "vs same time yesterday" },
  { key: "7d", label: "7 days", phrase: "in 7 days", versus: "vs the 7 days before" },
  { key: "30d", label: "30 days", phrase: "in 30 days", versus: "vs the 30 days before" },
];

const DAY_MS = 86_400_000;

export function parseWorkspaceRange(value: string | string[] | undefined | null): WorkspaceRange {
  const text = Array.isArray(value) ? value[0] : value;
  return text === "7d" || text === "30d" ? text : "today";
}

/** The range's window and the same window one period earlier (today: midnight UTC to now, and yesterday to this time). */
export function rangeWindow(range: WorkspaceRange, now: number): { since: number; previousSince: number; previousUntil: number } {
  if (range === "today") {
    const midnight = new Date(now);
    midnight.setUTCHours(0, 0, 0, 0);
    return { since: midnight.getTime(), previousSince: midnight.getTime() - DAY_MS, previousUntil: now - DAY_MS };
  }
  const span = (range === "7d" ? 7 : 30) * DAY_MS;
  return { since: now - span, previousSince: now - 2 * span, previousUntil: now - span };
}

/** Days the sign-in chart covers: two weeks for today and 7 days, the month for 30 days. */
export function chartDays(range: WorkspaceRange): number {
  return range === "30d" ? 30 : 14;
}

/** The Login activity range matching a workspace range, so "Look" lands on the same window. */
export function activityRangeFor(range: WorkspaceRange): "today" | "7d" | "30d" {
  return range;
}

/** "▲ 3 vs same time yesterday", "▼ 2 …", "same as …"; null when there is nothing earlier to compare with. */
export function changeWords(current: number, previous: number | null, versus: string): { text: string; rise: boolean } | null {
  if (previous === null) return null;
  const change = current - previous;
  if (change === 0) return { text: `same ${versus.replace(/^vs /, "as ")}`, rise: false };
  return { text: `${change > 0 ? "▲" : "▼"} ${Math.abs(change).toLocaleString("en-US")} ${versus}`, rise: change > 0 };
}

/** A staff change made between 22:00 and 06:00 UTC: outside office hours. */
export function isNightUtc(iso: string): boolean {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const hour = date.getUTCHours();
  return hour >= 22 || hour < 6;
}

export type WorthItem = {
  key: string;
  tone: "danger" | "warning" | "info";
  title: string;
  detail: string;
  href: string;
  /** "Look" for something to check, "FYI" for something only worth knowing. */
  verb: "Look" | "FYI";
};

export type NightChange = { id: string; ts: string; who: string; what: string; targetId: string | null };

const pad = (value: number) => String(value).padStart(2, "0");
const clock = (iso: string) => {
  const date = new Date(iso);
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
};

/**
 * Worth a look: simple rules over data the role may already see, worst first. Each item opens its page filtered.
 *   - an address that failed REPEATED_FAILURE_MIN times or more (Login activity, its address searched) — only when
 *     the role can open Login activity (`failures` is null otherwise);
 *   - an active lockout (Lockouts) — super admin only (`lockouts` is null otherwise);
 *   - a staff change between 22:00 and 06:00 UTC (the audit log, the change's target) — the audit log's own rule
 *     decides whose changes are in `nightChanges`.
 */
export function worthALook(input: {
  range: WorkspaceRange;
  failures: ReadonlyArray<{ ip: string | null; email: string; success: boolean; ts: string }> | null;
  lockouts: readonly LockoutEntry[] | null;
  nightChanges: readonly NightChange[] | null;
}): WorthItem[] {
  const items: WorthItem[] = [];
  const shown = 3;

  const repeated: RepeatedFailure[] = input.failures ? repeatedFailures(input.failures, REPEATED_FAILURE_MIN) : [];
  for (const entry of repeated.slice(0, shown)) {
    const query = new URLSearchParams({ lens: "repeated", q: entry.ip });
    if (input.range !== "today") query.set("range", activityRangeFor(input.range));
    items.push({
      key: `ip:${entry.ip}`,
      tone: "danger",
      title: "Repeated failures from one address",
      detail: `${entry.ip} · ${entry.attempts.toLocaleString("en-US")} failed attempts on ${entry.accounts.toLocaleString("en-US")} ${entry.accounts === 1 ? "account" : "accounts"}`,
      href: `/admin/activity?${query.toString()}`,
      verb: "Look",
    });
  }

  for (const entry of (input.lockouts ?? []).filter((item) => item.unlocksAt).slice(0, shown)) {
    items.push({
      key: `lock:${entry.scopeKey}`,
      tone: "warning",
      title: "Account locked",
      detail: `${entry.email} · until ${clock(entry.unlocksAt as string)} UTC`,
      href: "/admin/monitoring/lockouts",
      verb: "Look",
    });
  }

  for (const change of (input.nightChanges ?? []).slice(0, shown)) {
    items.push({
      key: `night:${change.id}`,
      tone: "info",
      title: "Staff change outside office hours",
      detail: `${change.who} · ${change.what} at ${clock(change.ts)} UTC`,
      href: change.targetId ? `/admin/audit-log?target=${encodeURIComponent(change.targetId)}` : "/admin/audit-log",
      verb: "FYI",
    });
  }
  return items;
}
