/**
 * The dashboard's analysis panels, from one bounded read of the last seven days of call attempts:
 * the outcome mix, the best hour to call, and the team's standings. Pure, so each is tested without
 * a database; the server reads the rows and hands them here.
 *
 * Hours and days are the AGENCY's (its workspace timezone), the same clock as the "Today" figures.
 */
import { wallClock } from "../appointments/calendarMath.ts";
import { NOT_A_CONTACT } from "./todayMath.ts";

export type AttemptRow = { attempted_at: string; disposition: string | null; agent_id: string | null };

const NOT_CONTACT = new Set<string>(NOT_A_CONTACT);
export const isContact = (disposition: string | null) => disposition !== null && !NOT_CONTACT.has(disposition);

/** "No answer" from "no_answer", for a disposition the tenant has no label for. */
export function humanise(key: string) {
  const text = key.replace(/_/g, " ").trim();
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : key;
}

export type Outcome = { key: string; label: string; count: number; contact: boolean };

/**
 * Attempts grouped by disposition, largest first. Attempts with no disposition yet are one
 * "Not recorded" group, so the parts always add up to the dials. Beyond `keep` groups, the tail is
 * folded into "Other" — a donut of twelve slivers says nothing.
 */
export function outcomeMix(rows: AttemptRow[], labels: Record<string, string>, keep = 5): Outcome[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.disposition ?? "__none";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const all = [...counts.entries()]
    .map(([key, count]) => ({ key, count, contact: key !== "__none" && isContact(key), label: key === "__none" ? "Not recorded" : labels[key] ?? humanise(key) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (all.length <= keep + 1) return all;
  const head = all.slice(0, keep);
  const tail = all.slice(keep);
  return [...head, { key: "__other", label: `Other (${tail.length})`, count: tail.reduce((sum, item) => sum + item.count, 0), contact: false }];
}

export type HeatCell = { dials: number; contacts: number };
export type Heatmap = {
  /** The agency-local hours shown, e.g. 8…20; widened to take any hour that had a dial. */
  hours: number[];
  /** One row per day, oldest first, keyed like `lastDays`. */
  days: Array<{ key: string; weekday: string; label: string; cells: HeatCell[] }>;
  /** The hour with the best contact rate among hours with at least `minDials` dials. */
  best: { hour: number; rate: number; dials: number } | null;
  maxDials: number;
};

/**
 * Dials per agency-local day × hour, with how many reached someone. `days` are the windows to lay
 * out (normally the last seven from `lastDays`); rows outside them are ignored.
 */
export function hourHeatmap(rows: AttemptRow[], zone: string, days: Array<{ key: string; weekday: string; label: string }>, minDials = 3): Heatmap {
  const at = rows.map((row) => {
    const clock = wallClock(row.attempted_at, zone);
    return { key: `${clock.year}-${String(clock.month).padStart(2, "0")}-${String(clock.day).padStart(2, "0")}`, hour: Math.floor(clock.minutes / 60), contact: isContact(row.disposition) };
  });
  const wanted = new Set(days.map((day) => day.key));
  const seen = at.filter((item) => wanted.has(item.key)).map((item) => item.hour);
  const first = Math.min(8, ...seen);
  const last = Math.max(20, ...seen);
  const hours = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  const grid = new Map(days.map((day) => [day.key, hours.map(() => ({ dials: 0, contacts: 0 }))]));
  const byHour = new Map<number, HeatCell>();
  for (const item of at) {
    const row = grid.get(item.key);
    if (!row) continue;
    const cell = row[item.hour - first];
    cell.dials += 1;
    if (item.contact) cell.contacts += 1;
    const total = byHour.get(item.hour) ?? { dials: 0, contacts: 0 };
    total.dials += 1;
    if (item.contact) total.contacts += 1;
    byHour.set(item.hour, total);
  }
  let best: Heatmap["best"] = null;
  for (const [hour, cell] of byHour) {
    if (cell.dials < minDials) continue;
    const rate = (cell.contacts / cell.dials) * 100;
    if (!best || rate > best.rate || (rate === best.rate && cell.dials > best.dials)) best = { hour, rate, dials: cell.dials };
  }
  const maxDials = Math.max(0, ...[...grid.values()].flat().map((cell) => cell.dials));
  return { hours, days: days.map((day) => ({ ...day, cells: grid.get(day.key) ?? [] })), best, maxDials };
}

/** "2 PM", "9 AM" */
export function hourLabel(hour: number) {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
}

export type Leader = { userId: string; name: string; dials: number; contacts: number };

/** Dials and contacts per agent, most dials first; attempts with no agent are left out. */
export function leaderboard(rows: AttemptRow[], names: Record<string, string>, limit = 5): Leader[] {
  const by = new Map<string, Leader>();
  for (const row of rows) {
    if (!row.agent_id) continue;
    const leader = by.get(row.agent_id) ?? { userId: row.agent_id, name: names[row.agent_id] ?? "Former member", dials: 0, contacts: 0 };
    leader.dials += 1;
    if (isContact(row.disposition)) leader.contacts += 1;
    by.set(row.agent_id, leader);
  }
  return [...by.values()].sort((a, b) => b.dials - a.dials || b.contacts - a.contacts || a.name.localeCompare(b.name)).slice(0, limit);
}

/** This week's total against last week's, as a signed percentage; null when last week had none. */
export function periodChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
}
