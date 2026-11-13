/**
 * Retention › Results, what the ladder saved (round 7, owner pick 6·A, 2026-11-10; docs/la4/mockups-r7/retention.html).
 * From the agency's own `retention_case` rows: per step the case was on, and per carrier, how many cases were
 * opened in the period, how many were saved (a later carrier file proved it), lost, or closed without a save, the
 * save rate (saved ÷ saved + lost, never a percentage under 20 decided cases) and the monthly premium kept; and how
 * many days a save took, opened to proven. Cases still open are counted apart, with the premium at stake. Pure.
 */
import { STEPS, STEP_LABELS, type Step } from "./ladder.ts";

/** Under this many decided cases (saved + lost) a cell shows the counts, never a percentage (LA-5.9's floor). */
export const MIN_RESULTS_DECIDED = 20;

/** The page's periods, the radar check's own (`?period=`), so one control serves every tab. */
export const RESULTS_PERIODS = { quarter: 90, half: 182, year: 365, all: null } as const;
export type ResultsPeriod = keyof typeof RESULTS_PERIODS;
export const RESULTS_PERIOD_LABELS: Record<ResultsPeriod, string> = { quarter: "The last quarter", half: "The last six months", year: "The last year", all: "All time" };
export const resultsPeriodOf = (raw: string | null | undefined): ResultsPeriod => (raw && raw in RESULTS_PERIODS ? (raw as ResultsPeriod) : "quarter");

export type ResultCase = { step: Step; status: string; carrierId: string; carrierName: string; openedAt: string; resolvedAt: string | null; monthlyCents: number };
export type ResultLine = {
  key: string; label: string;
  /** Opened in the period. */
  opened: number;
  /** Open now, whenever it opened, and the monthly premium on them. */
  open: number; openCents: number;
  /** Closed in the period, by how. */
  saved: number; lost: number; closedNoSave: number;
  keptCents: number;
  rate: number | null;
};
export type SaveTime = { key: string; label: string; saves: number; medianDays: number | null; fastestDays: number | null; slowestDays: number | null };
/** Saves by how long they took (Time to save's chart, Reports round 7 10·3): same day, a week, two, a month, longer. */
export type SaveDaysBucket = { key: string; label: string; saves: number };
export type Results = { byStep: ResultLine[]; byCarrier: ResultLine[]; total: ResultLine; times: SaveTime[]; totalTime: SaveTime; saveDays: SaveDaysBucket[] };

/** The days-to-save buckets, each `[key, label, last day it holds]` (the last has no end). */
export const SAVE_DAY_BUCKETS = [["same", "Same day", 0], ["week", "1–7 days", 7], ["fortnight", "8–14", 14], ["month", "15–30", 30], ["later", "Over 30", Infinity]] as const;

/** How many saves fell in each bucket, in order. */
export function saveDayBuckets(days: readonly number[]): SaveDaysBucket[] {
  const out = SAVE_DAY_BUCKETS.map(([key, label]) => ({ key, label, saves: 0 }));
  for (const d of days) out[SAVE_DAY_BUCKETS.findIndex(([, , last]) => d <= last)].saves++;
  return out;
}

const OPEN = new Set(["open", "working", "waiting_on_carrier"]);
const line = (key: string, label: string): ResultLine => ({ key, label, opened: 0, open: 0, openCents: 0, saved: 0, lost: 0, closedNoSave: 0, keptCents: 0, rate: null });
const finish = (l: ResultLine): ResultLine => ({ ...l, rate: l.saved + l.lost >= MIN_RESULTS_DECIDED ? l.saved / (l.saved + l.lost) : null });

/** Whole days from opened to proven saved (never negative). */
export const daysToSave = (openedAt: string, resolvedAt: string): number => Math.max(0, Math.round((Date.parse(resolvedAt) - Date.parse(openedAt)) / 86_400_000));

/** The middle value (the mean of the middle two, rounded), null for none. */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

const time = (key: string, label: string, days: number[]): SaveTime => ({
  key, label, saves: days.length, medianDays: median(days), fastestDays: days.length ? Math.min(...days) : null, slowestDays: days.length ? Math.max(...days) : null,
});

/**
 * The Results tables. `since` is the period's first day (ISO date), null for all time. A case counts as opened when
 * it opened on or after it, as saved / lost / closed when it closed on or after it; open cases count whenever they opened.
 */
export function caseResults(cases: ResultCase[], since: string | null): Results {
  const from = since ? `${since}T00:00:00Z` : "";
  const steps = new Map<Step, ResultLine>(STEPS.map((s) => [s, line(s, STEP_LABELS[s])]));
  const carriers = new Map<string, ResultLine>();
  const total = line("all", "All");
  const days = new Map<Step, number[]>(STEPS.map((s) => [s, []]));
  for (const c of cases) {
    if (!carriers.has(c.carrierId)) carriers.set(c.carrierId, line(c.carrierId, c.carrierName));
    const lines = [steps.get(c.step), carriers.get(c.carrierId), total].filter(Boolean) as ResultLine[];
    const openedIn = c.openedAt >= from;
    const closedIn = !!c.resolvedAt && c.resolvedAt >= from;
    for (const l of lines) {
      if (openedIn) l.opened++;
      if (OPEN.has(c.status)) { l.open++; l.openCents += c.monthlyCents; }
      else if (closedIn && c.status === "saved") { l.saved++; l.keptCents += c.monthlyCents; }
      else if (closedIn && c.status === "lost") l.lost++;
      else if (closedIn && c.status === "closed_no_save") l.closedNoSave++;
    }
    if (closedIn && c.status === "saved" && c.resolvedAt) days.get(c.step)?.push(daysToSave(c.openedAt, c.resolvedAt));
  }
  const all = [...days.values()].flat();
  return {
    byStep: [...steps.values()].map(finish),
    byCarrier: [...carriers.values()].map(finish).sort((a, b) => b.opened - a.opened || b.saved - a.saved || a.label.localeCompare(b.label)),
    total: finish(total),
    times: STEPS.map((s) => time(s, STEP_LABELS[s], days.get(s) ?? [])),
    totalTime: time("all", "All steps", all),
    saveDays: saveDayBuckets(all),
  };
}

/** A line has something to show (an empty carrier or step row is left out of the table, never the total). */
export const hasFigures = (l: ResultLine): boolean => l.opened + l.open + l.saved + l.lost + l.closedNoSave > 0;

/** The rate as words: a percentage from 20 decided cases, else "3 of 5 saved"; "—" with none decided. */
export const resultRateText = (l: ResultLine): string => (l.saved + l.lost === 0 ? "—" : l.rate === null ? `${l.saved} of ${l.saved + l.lost} saved` : `${Math.round(l.rate * 100)}%`);

/** The period's first day, from today (ISO date), or null for all time. */
export function resultsSince(period: ResultsPeriod, today: string): string | null {
  const days = RESULTS_PERIODS[period];
  return days === null ? null : new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}
