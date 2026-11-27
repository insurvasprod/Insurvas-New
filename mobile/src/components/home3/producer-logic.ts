import type { CalendarAppointment } from "@/components/calendar/month";
import type { PendingRequirement, RequirementKind } from "@/components/cases/model";
import type { CallbackView } from "@/lib/types";

import { dayKey, dollars, monthLong } from "./logic";

/**
 * Board B1 · Home for a producer, worked out from the server's answers. Pure, so the tests read the same rules the
 * screen uses. Weeks start on Monday; "this week" is Monday to today, compared with the same days of last week (the
 * web's rule for a period so far). Days are the phone's own calendar days, except issue dates, which are dates.
 */

/** GET /api/app/scorecard (lib/setters/service.ts ScorecardRow): one row per person per day. */
export type ScoreDay = { userId: string; day: string; dials: number };
/** GET /api/app/applications, the fields read here. */
export type ProducerApp = { applicationId: string; status: string; outcome: string | null; submittedAt?: string | null };
/** GET /api/app/home/producer (app/api/app/home/producer/route.ts). */
export type ProducerBookAnswer = {
  today: string;
  money: boolean;
  available: boolean;
  issued: { since: string; days: { day: string; count: number; cents: number | null }[] };
  paymentMissed: { count: number; saveBy: string | null };
};
/** GET /api/app/goals?kind=premium&for=me. */
export type PremiumGoalAnswer = { goal: { state: "set"; target: number } | { state: "none" } | { state: "missing" } };

const pad = (n: number) => String(n).padStart(2, "0");
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parse(day: string): Date {
  return new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
}
function plus(day: string, n: number): string {
  const d = parse(day);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** This week (Monday to today) and the same days of last week. */
export function weekSpan(today: string): { from: string; to: string; lastFrom: string; lastTo: string } {
  const back = (parse(today).getDay() + 6) % 7;
  const from = plus(today, -back);
  return { from, to: today, lastFrom: plus(from, -7), lastTo: plus(today, -7) };
}

const within = (day: string, from: string, to: string) => day >= from && day <= to;

export type Versus = { now: number; before: number };

/** The reader's own dials this week against the same days of last week (the scorecard's days). */
export function dialsWeek(rows: readonly ScoreDay[], userId: string, today: string): Versus {
  const w = weekSpan(today);
  let now = 0;
  let before = 0;
  for (const r of rows) {
    if (r.userId !== userId) continue;
    const day = r.day.slice(0, 10);
    if (within(day, w.from, w.to)) now += Number(r.dials) || 0;
    else if (within(day, w.lastFrom, w.lastTo)) before += Number(r.dials) || 0;
  }
  return { now, before };
}

/** Applications sent to the carrier this week, and those ready to submit now. */
export function appsWeek(apps: readonly ProducerApp[], today: string): { submitted: number; ready: number } {
  const w = weekSpan(today);
  return {
    submitted: apps.filter((a) => a.submittedAt && within(dayKey(a.submittedAt), w.from, w.to)).length,
    ready: apps.filter((a) => a.status === "ready").length,
  };
}

/** Annual premium issued this week against the same days of last week (by issue date). Null without money. */
export function issuedWeek(answer: ProducerBookAnswer, today: string): Versus | null {
  if (!answer.money) return null;
  const w = weekSpan(today);
  let now = 0;
  let before = 0;
  for (const d of answer.issued.days) {
    if (within(d.day, w.from, w.to)) now += d.cents ?? 0;
    else if (within(d.day, w.lastFrom, w.lastTo)) before += d.cents ?? 0;
  }
  return { now, before };
}

/** What was issued in a month ("2026-11"), up to today: policies and their annual premium. */
export function issuedMonth(answer: ProducerBookAnswer, month: string, today: string): { count: number; cents: number } {
  let count = 0;
  let cents = 0;
  for (const d of answer.issued.days) {
    if (d.day.slice(0, 7) !== month || d.day > today) continue;
    count += d.count;
    cents += d.cents ?? 0;
  }
  return { count, cents };
}

/** "↑ 9%" / "↓ 4%" against a week before; null when last week had nothing to compare with. */
export function pctDelta(v: Versus): { strong: string; good: boolean } | null {
  if (!v.before) return null;
  const pct = Math.round(((v.now - v.before) / v.before) * 100) || 0;
  return { strong: `${pct >= 0 ? "↑" : "↓"} ${Math.abs(pct)}%`, good: pct > 0 };
}

/** "↑ $640" / "↓ $120" against a week before; null when both weeks had nothing. */
export function moneyDelta(v: Versus): { strong: string; good: boolean } | null {
  if (!v.now && !v.before) return null;
  const diff = v.now - v.before;
  return { strong: `${diff >= 0 ? "↑" : "↓"} ${dollars(Math.abs(diff))}`, good: diff > 0 };
}

/** Working days (Monday to Friday) from today to the month's end, today included. */
export function workingDaysLeft(today: string): number {
  const d = parse(today);
  const month = d.getMonth();
  let n = 0;
  while (d.getMonth() === month) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) n += 1;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

export type GoalCard = { title: string; line: string; pct: number; label: string };

/**
 * The month's goal ring (the web's goal ring for a producer: issued annual premium by issue date against the stored
 * goal; without one, against last month, as the web's ring falls back). Null with nothing to measure either way.
 */
export function goalCard(answer: ProducerBookAnswer, goal: PremiumGoalAnswer | null, today: string): GoalCard | null {
  const month = today.slice(0, 7);
  const prev = (() => { const d = parse(`${month}-01`); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; })();
  const now = issuedMonth(answer, month, today);
  const days = workingDaysLeft(today);
  const left = `${days} working ${days === 1 ? "day" : "days"} left`;
  const title = `${monthLong(month)} goal`;
  const figure = (cents: number, count: number) => (answer.money ? dollars(cents) : `${count.toLocaleString("en-US")} ${count === 1 ? "policy" : "policies"}`);
  const value = answer.money ? now.cents : now.count;
  const ring = (target: number) => {
    const pct = Math.max(0, Math.min(100, Math.round((value / target) * 100)));
    return { pct, label: `${pct}%` };
  };
  const target = goal?.goal.state === "set" && answer.money ? goal.goal.target : null;
  if (target) return { title, line: `${dollars(now.cents)} of ${dollars(target)} issued annual premium · ${left}`, ...ring(target) };
  const last = issuedMonth(answer, prev, today);
  const lastValue = answer.money ? last.cents : last.count;
  if (!lastValue) return { title, line: `${figure(now.cents, now.count)} issued${answer.money ? " annual premium" : ""} · no goal set · ${left}`, pct: 0, label: "—" };
  return { title, line: `${figure(now.cents, now.count)} of ${figure(last.cents, last.count)} issued last month · no goal set · ${left}`, ...ring(lastValue) };
}

/** "2 Dec". */
export function shortDay(day: string): string {
  return `${Number(day.slice(8, 10))} ${SHORT[Number(day.slice(5, 7)) - 1] ?? ""}`.trim();
}

// ─── Needs you · Case needs a doc ────────────────────────────────────────────────────────────────

/** The requirements a page answers (cases/model.ts takesDocument), in the tile's short words. */
const DOC_WORD: Partial<Record<RequirementKind, string>> = { aps: "APS", missing_info: "Missing info", amendment: "Amendment", other: "Carrier request" };

/** Open requirements on the reader's cases that need a document from the client or the agent, oldest first. */
export function docsNeeded(reqs: readonly PendingRequirement[]): { count: number; detail: string | null } {
  const open = reqs
    .filter((r) => (r.status === "open" || r.status === "in_progress") && r.waitingOn !== "carrier" && r.kind in DOC_WORD)
    .sort((a, b) => b.daysOpen - a.daysOpen);
  const first = open[0];
  if (!first) return { count: 0, detail: null };
  const what = first.kind === "other" && first.description.trim() ? first.description.trim() : DOC_WORD[first.kind] ?? null;
  return { count: open.length, detail: [first.carrierName, what].filter(Boolean).join(" · ") || null };
}

// ─── Schedule ────────────────────────────────────────────────────────────────────────────────────

export type ScheduleItem = { kind: "callback"; at: number; callback: CallbackView } | { kind: "appointment"; at: number; appointment: CalendarAppointment };

/**
 * Today's schedule: the reader's callbacks still open (overdue ones too) and the appointments on their own calendar
 * today that are still booked, soonest first (overdue callbacks come first by their time).
 */
export function scheduleToday(callbacks: readonly CallbackView[], appointments: readonly CalendarAppointment[], viewerId: string | null, today: string): ScheduleItem[] {
  const out: ScheduleItem[] = [];
  for (const cb of callbacks) {
    if (cb.status === "completed" || cb.status === "cancelled") continue;
    if (!(cb.isDueToday || cb.isOverdue || cb.status === "missed")) continue;
    out.push({ kind: "callback", at: Date.parse(cb.scheduledAtUtc), callback: cb });
  }
  for (const a of appointments) {
    if (a.status !== "booked" && a.status !== "confirmed") continue;
    if (viewerId && a.agentUserId !== viewerId) continue;
    if (dayKey(a.startsAtUtc) !== today) continue;
    out.push({ kind: "appointment", at: Date.parse(a.startsAtUtc), appointment: a });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The phone's day as an ISO range for /api/app/calendar (from midnight to the next). */
export function dayRange(today: string): { from: string; to: string } {
  return { from: parse(today).toISOString(), to: parse(plus(today, 1)).toISOString() };
}
