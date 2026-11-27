import { displayName } from "@/lib/format";

import type { AppRow, Complaint, FloorMember, HealthAlert, MissingFile, ProducerScore, SetupStep, ScoreCampaign, TodoItem } from "./types";

/**
 * The owner, bookkeeper and manager homes, Get set up and the vendor card, worked out from the web's own answers.
 * Pure, so the tests read the same rules the screens use. The rules are the web's (lib/dashboard/views/agency.ts):
 * submitted premium is the annualised premium of the applications submitted (monthly × 12), placement is the share
 * of a month's submitted applications issued, a month so far is compared with the same days of the month before.
 * Days are the phone's own calendar days.
 */

const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-11-25" for a moment, on this phone's calendar. */
export function dayKey(at: Date | number | string): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The month before "2026-11" → "2026-10". */
export function prevMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

export function daysIn(month: string): number {
  return new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
}

export const monthLong = (month: string) => LONG[Number(month.slice(5, 7)) - 1] ?? month;
export const monthShort = (month: string) => SHORT[Number(month.slice(5, 7)) - 1] ?? month;

/** "9 Dec". */
export function dayMonth(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${SHORT[Number(iso.slice(5, 7)) - 1] ?? ""}`.trim();
}

/** Whole-percent change, as the web's pctChange: null with nothing to compare against. */
export function pctChange(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / before) * 100) || 0;
}

/** "$86,420": whole dollars (the board's figures); "−$2,140" for money going out. */
export function dollars(cents: number): string {
  const whole = Math.round(Math.abs(cents) / 100);
  return `${cents < 0 ? "−" : ""}$${whole.toLocaleString("en-US")}`;
}

/** "$28.00": a price per lead keeps its cents, as the web's cost per record does. */
export function unitPrice(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "AK" from "Ava Kim". */
export function initials(name: string | null | undefined): string {
  const words = (displayName(name ?? "") ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return ((words[0][0] ?? "") + (words.length > 1 ? words[words.length - 1][0] ?? "" : "")).toUpperCase();
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

// ─── B2 · the month's money ─────────────────────────────────────────────────────────────────────

const annual = (app: AppRow) => (app.monthlyPremiumCents ?? 0) * 12;

export type PremiumMonth = {
  month: string;
  previous: string;
  /** Submitted premium so far this month, day by day (cumulative cents), from the 1st to today. */
  series: number[];
  /** The month before over the same days. */
  before: number[];
  totalCents: number;
  /** % against the same days of the month before; null when that was nothing. */
  change: number | null;
  issued: { count: number; cents: number };
  placement: { pct: number; issued: number; submitted: number } | null;
};

/**
 * The owner's month: submitted premium as a running total per day with last month's same days beside it, the
 * applications issued this month (by the day they closed) and the month's placement.
 */
export function premiumMonth(apps: readonly AppRow[], today: string): PremiumMonth {
  const month = today.slice(0, 7);
  const previous = prevMonth(month);
  const upto = Number(today.slice(8, 10));
  const prevLen = daysIn(previous);
  const perDay = new Map<string, number>();
  for (const app of apps) {
    if (!app.submittedAt) continue;
    const day = dayKey(app.submittedAt);
    perDay.set(day, (perDay.get(day) ?? 0) + annual(app));
  }
  const running = (key: string, through: number) => {
    const out: number[] = [];
    let sum = 0;
    for (let d = 1; d <= through; d += 1) {
      sum += perDay.get(`${key}-${pad(d)}`) ?? 0;
      out.push(sum);
    }
    return out;
  };
  const series = running(month, upto);
  const prevRun = running(previous, Math.min(upto, prevLen));
  // A month longer than the one before: the dashed line holds its last value for the extra days.
  const before = series.map((_, i) => prevRun[Math.min(i, prevRun.length - 1)] ?? 0);
  const totalCents = series[series.length - 1] ?? 0;

  let issuedCount = 0;
  let issuedCents = 0;
  for (const app of apps) {
    if (app.outcome !== "issued") continue;
    const closed = app.closedAt ?? app.updatedAt;
    if (!closed || dayKey(closed).slice(0, 7) !== month) continue;
    issuedCount += 1;
    issuedCents += annual(app);
  }
  const sent = apps.filter((app) => app.submittedAt && dayKey(app.submittedAt).slice(0, 7) === month);
  const placedIssued = sent.filter((app) => app.outcome === "issued").length;
  return {
    month, previous, series, before, totalCents,
    change: pctChange(totalCents, before[before.length - 1] ?? 0),
    issued: { count: issuedCount, cents: issuedCents },
    placement: sent.length ? { pct: Math.round((placedIssued / sent.length) * 100), issued: placedIssued, submitted: sent.length } : null,
  };
}

/** The chart's scale in $ thousands, rounded up to a ten as the board's (kit.js `lines`). */
export function chartMax(series: readonly number[], before: readonly number[]): number {
  const top = Math.max(0, ...series, ...before) / 100_000;
  return Math.max(10, Math.ceil(top / 10) * 10);
}

/** The day numbers under the chart: the 1st, the middle and today. */
export function chartLabels(days: number): string[] {
  const mid = Math.floor((days - 1) / 2);
  return Array.from({ length: days }, (_, i) => (i === 0 || i === days - 1 || (i === mid && days > 2) ? String(i + 1) : ""));
}

/** What was clawed back this month: the producers' chargebacks (negative cents), and how many producers it hit. */
export function chargebacks(rows: readonly ProducerScore[]): { cents: number; producers: number } {
  return { cents: Math.abs(rows.reduce((sum, r) => sum + (r.chargebackCents ?? 0), 0)), producers: rows.filter((r) => r.chargebackCents).length };
}

export type LeaderRow = { userId: string; rank: number; name: string; issued: number; submitted: number; share: number };

/** Producers by policies issued this month (then submitted), each bar against the leader's. */
export function leaders(rows: readonly ProducerScore[], top = 4): LeaderRow[] {
  const sorted = [...rows].sort((a, b) => b.issued - a.issued || b.submitted - a.submitted || a.name.localeCompare(b.name));
  const best = sorted[0]?.issued ?? 0;
  return sorted.slice(0, top).map((r, i) => ({ userId: r.producerUserId, rank: i + 1, name: displayName(r.name) ?? r.name, issued: r.issued, submitted: r.submitted, share: best ? Math.round((r.issued / best) * 100) : 0 }));
}

/** Licences expiring inside 60 days (the dashboard's health alerts): how many, and the soonest as "TX · 9 Dec". */
export function licencesExpiring(alerts: readonly HealthAlert[]): { count: number; soonest: string | null } {
  const lic = alerts.filter((a) => a.item === "Licence").sort((a, b) => a.daysLeft - b.daysLeft);
  const first = lic[0];
  const state = first ? first.detail.split("·").pop()?.trim() ?? "" : "";
  return { count: lic.length, soonest: first ? [state, dayMonth(first.expiresOn)].filter(Boolean).join(" · ") : null };
}

/** Complaints still waiting on a response with a regulator's deadline: how many, how many are late, the nearest. */
export function complaintsDue(rows: readonly Complaint[]): { count: number; overdue: number; nearest: number | null } {
  const open = rows.filter((c) => !c.respondedAt && !c.resolvedAt && c.countdown.daysLeft !== null);
  const days = open.map((c) => c.countdown.daysLeft as number);
  const ahead = days.filter((d) => d >= 0);
  return { count: open.length, overdue: days.filter((d) => d < 0).length, nearest: ahead.length ? Math.min(...ahead) : null };
}

/** The complaints tile's chip: the late ones first, else the nearest deadline inside a week. */
export function complaintsChip(due: { overdue: number; nearest: number | null }): string | null {
  if (due.overdue) return `${due.overdue} overdue`;
  if (due.nearest === null || due.nearest > 7) return null;
  return due.nearest === 0 ? "1 due today" : `1 in ${plural(due.nearest, "day", "days")}`;
}

// ─── B6 · the books ─────────────────────────────────────────────────────────────────────────────

/** What waits on this person (not a disputed bill waiting on the vendor), and the money it holds. */
export function toApprove(items: readonly TodoItem[]): { count: number; cents: number } {
  const mine = items.filter((i) => i.yours);
  return { count: mine.length, cents: mine.reduce((s, i) => s + Math.abs(i.amountCents ?? 0), 0) };
}

/** Carrier money that is wrong or missing (the To do's red bank rows): how many, and how much short. */
export function depositsShort(items: readonly TodoItem[]): { count: number; cents: number } {
  const bad = items.filter((i) => i.group === "bank" && i.tone === "bad");
  return { count: bad.length, cents: bad.reduce((s, i) => s + Math.abs(i.amountCents ?? 0), 0) };
}

/** "Corebridge, Royal Neighbors": the carriers whose files are late, latest first, at most two named. */
export function lateCarriers(missing: readonly MissingFile[]): string {
  const names = [...new Set(missing.map((m) => m.carrierName))];
  return names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
}

export const TODO_ICON = { bank: "landmark", bills: "receipt", expenses: "creditCard", payouts: "wallet", tax: "file" } as const;

// ─── B8 · the floor ─────────────────────────────────────────────────────────────────────────────

/** "6:12" from seconds; "1:02:05" past an hour. */
export function clockSpan(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** "11:20" on this phone's clock. */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours() % 12 || 12;
  return `${h}:${pad(d.getMinutes())}`;
}

const LONG_CALL_SECONDS = 4 * 3600;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "11:20" today, else "20 Nov". */
export function startedLabel(iso: string, now: number): string {
  const d = new Date(iso);
  const today = new Date(now);
  return d.toDateString() === today.toDateString() ? clockTime(iso) : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export type FloorRow ={ id: string; name: string; meta: string; chip: { tone: "info" | "ok" | "neutral"; label: string }; order: number };

/** Each person on the manager's floor, on a call first, then ready, then everyone not taking calls. */
export function floorRows(members: readonly FloorMember[], selfId: string | null | undefined, now: number): FloorRow[] {
  const since = (iso: string | null) => (iso ? Math.max(0, (now - Date.parse(iso)) / 1000) : null);
  return members
    .filter((m) => m.id !== selfId)
    .map((m): FloorRow => {
      const name = displayName(m.name) ?? m.name;
      if (m.availability === "on_call" && m.call) {
        const held = since(m.call.startedAt);
        // Past four hours the clock is a call the server never closed, not a live one: say when it began instead.
        const span = held === null ? null : held > LONG_CALL_SECONDS ? `since ${startedLabel(m.call.startedAt, now)}` : clockSpan(held);
        return { id: m.id, name, order: 0, chip: { tone: "info", label: "On a call" }, meta: ["On a call", span, displayName(m.call.customer)].filter(Boolean).join(" · ") };
      }
      if (m.availability === "ready") {
        const waited = since(m.statusChangedAt);
        return { id: m.id, name, order: 1, chip: { tone: "ok", label: "Ready" }, meta: waited !== null ? `Waiting for a transfer · ${Math.floor(waited / 60)} min` : "Waiting for a transfer" };
      }
      const from = m.statusChangedAt ?? m.lastSeenAt;
      const label = m.availability === "on_break" ? "On a break" : "Not taking calls";
      return { id: m.id, name, order: 2, chip: { tone: "neutral", label: "Away" }, meta: from ? `${label} since ${clockTime(from)}` : label };
    })
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/** The floor's counts: on a call now, of those taking calls (on a call or ready). */
export function floorCounts(members: readonly FloorMember[], selfId: string | null | undefined): { onCall: number; taking: number; people: number } {
  const team = members.filter((m) => m.id !== selfId);
  const onCall = team.filter((m) => m.availability === "on_call").length;
  return { onCall, taking: onCall + team.filter((m) => m.availability === "ready").length, people: team.length };
}

/** Applications submitted today and on the same weekday last week ("↑ 3 vs last Tue"). */
export function appsToday(apps: readonly AppRow[], today: string): { today: number; lastWeek: number; weekday: string } {
  const d = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  const week = new Date(d.getTime());
  week.setDate(d.getDate() - 7);
  const last = dayKey(week);
  let now = 0;
  let before = 0;
  for (const app of apps) {
    if (!app.submittedAt) continue;
    const day = dayKey(app.submittedAt);
    if (day === today) now += 1;
    else if (day === last) before += 1;
  }
  return { today: now, lastWeek: before, weekday: WEEKDAY[d.getDay()] };
}

// ─── B9 · Get set up ────────────────────────────────────────────────────────────────────────────

export function setupGroups(steps: readonly SetupStep[]) {
  const required = steps.filter((s) => !s.optional);
  return {
    required: required.length,
    done: required.filter((s) => s.complete).length,
    doneSteps: steps.filter((s) => s.complete),
    next: required.filter((s) => !s.complete),
    later: steps.filter((s) => s.optional && !s.complete),
  };
}

// ─── D10 · a vendor ─────────────────────────────────────────────────────────────────────────────

/** "9.9 per 100": policies sold per hundred leads. */
export function perHundred(sold: number, leads: number): string | null {
  if (!leads) return null;
  return `${(Math.round((sold / leads) * 1000) / 10).toLocaleString("en-US")} per 100`;
}

/**
 * The campaigns that brought leads this month, and the one the report ranks costliest per sale (only when at least
 * two are ranked: one campaign alone is not "costly" against anything).
 */
export function vendorCampaigns(rows: readonly ScoreCampaign[]): { rows: ScoreCampaign[]; costliest: string | null } {
  const live = rows.filter((r) => r.leads_received > 0).sort((a, b) => b.leads_received - a.leads_received);
  const ranked = live.filter((r) => r.cost_rank !== null);
  const worst = ranked.length >= 2 ? ranked.reduce((a, b) => ((b.cost_rank ?? 0) > (a.cost_rank ?? 0) ? b : a)) : null;
  return { rows: live, costliest: worst?.campaign_id ?? null };
}

/** The first and last day of a month, and of this month so far. */
export function monthRange(month: string, today?: string): { from: string; to: string } {
  return { from: `${month}-01`, to: today && today.slice(0, 7) === month ? today : `${month}-${pad(daysIn(month))}` };
}
