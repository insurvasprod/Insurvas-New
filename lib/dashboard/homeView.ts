/**
 * The Home dashboard's view model (redesign 2026-10-28, tasks/home-dashboard-plan.md).
 *
 * Home reads what it always read (lib/dashboard/today, money, roleHome). This file only decides how
 * those numbers are shown: which alerts go in the "Needs you" row, which four stat cards a role
 * gets, the bars of the activity chart and the rows of today's schedule. Pure functions, no React
 * and no database, so every rule is tested (homeView.test.mjs) and `/design/home` can draw the
 * same components from sample data.
 *
 * A figure that was not read (null) is left out, never shown as 0 (00-FOUNDATION §6.3).
 */
import type { DashboardToday, TodayAppointment } from "./today.ts";
import type { HomeFigureKey } from "./roleHome.ts";

/** The person the home is for: the tenant role, with a manager told apart (no money). */
export type HomeRole = "owner" | "manager" | "producer" | "setter" | "assistant" | "bookkeeper" | "retention";

/**
 * Whose home this is: an agency admin reads as the owner, a manager as a manager (a producer's home
 * without the money), everyone else as their tenant role.
 */
export function homeRole(role: HomeRole, memberRole: string | null | undefined): HomeRole {
  if (memberRole === "manager") return "manager";
  if (memberRole === "admin") return "owner";
  return role;
}

/** The parts of `DashboardToday` Home draws. Sample data and tests build this shape directly. */
export type HomeToday = Pick<
  DashboardToday,
  | "dialsToday" | "dialsYesterday" | "contactsToday" | "appointmentsToday" | "appointmentsTodayList" | "appointmentsWeek"
  | "queueReady" | "series" | "needs" | "insights" | "policies30" | "setterWeek" | "closeOut" | "zone"
>;

const n = (value: number) => value.toLocaleString("en-US");
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const sum = (values: Array<number | null>) => values.reduce<number>((total, value) => total + (value ?? 0), 0);
const round1 = (value: number) => Math.round(value * 10) / 10;

/** Percentage change, rounded to one decimal, or null when there is nothing to compare with. */
export function percentChange(current: number, previous: number | null): number | null {
  if (previous === null || previous <= 0) return null;
  return round1(((current - previous) / previous) * 100);
}

/* ── Needs you ──────────────────────────────────────────────────────────────────────────────── */

export type AttentionTone = "danger" | "warning" | "info";
export type AttentionItem = {
  key: string;
  count: number;
  /** Short, lower case after the count: "transfers waiting". */
  label: string;
  /** One more fact, when it changes what to do: "2 past SLA". */
  detail?: string;
  tone: AttentionTone;
  href: string;
};

export type AttentionLinks = { transfers?: string | null; callbacks?: string | null; lapse?: string | null; licences?: string | null };

/**
 * What needs a person now, most urgent first: only counts above zero, each linking to its rows.
 * Pending cases and close-outs load in the browser and join this row there.
 */
export function attentionItems(today: Pick<HomeToday, "needs"> | null, links: AttentionLinks): AttentionItem[] {
  if (!today) return [];
  const needs = today.needs;
  const items: AttentionItem[] = [];
  if (links.transfers && needs.transfersWaiting) {
    const breaching = needs.slaBreaching ?? 0;
    items.push({
      key: "transfers",
      count: needs.transfersWaiting,
      label: needs.transfersWaiting === 1 ? "transfer waiting" : "transfers waiting",
      detail: breaching ? `${n(breaching)} past SLA` : undefined,
      tone: breaching ? "danger" : "warning",
      href: links.transfers,
    });
  }
  if (links.callbacks && needs.callbacksOverdue) {
    items.push({ key: "callbacks", count: needs.callbacksOverdue, label: needs.callbacksOverdue === 1 ? "callback overdue" : "callbacks overdue", tone: "warning", href: links.callbacks });
  }
  if (links.licences && needs.licences && needs.licences.expired + needs.licences.expiring > 0) {
    const { expired, expiring } = needs.licences;
    items.push({
      key: "licences",
      count: expired + expiring,
      label: expired + expiring === 1 ? "licence to renew" : "licences to renew",
      detail: expired ? `${n(expired)} expired` : undefined,
      tone: expired ? "danger" : "warning",
      href: links.licences,
    });
  }
  if (links.lapse && needs.lapsing) {
    items.push({ key: "lapse", count: needs.lapsing, label: "at lapse risk", tone: "warning", href: links.lapse });
  }
  const rank: Record<AttentionTone, number> = { danger: 0, warning: 1, info: 2 };
  return items.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

/* ── Stat cards ─────────────────────────────────────────────────────────────────────────────── */

export type KpiKey = "premium" | "appointments" | "rate" | "dials" | "queue" | "closeOut" | "booked" | "showRate";
export type KpiIcon = "dollar" | "calendar" | "phone" | "dial" | "queue" | "check" | "booked" | "show";

export type KpiCard = {
  key: KpiKey;
  icon: KpiIcon;
  label: string;
  period?: string;
  /** A number counts up; a string keeps its formatting ("$12,480"). */
  value: number | string;
  unit?: string;
  delta?: { value: number; unit?: string; goodWhen: "up" | "down" | "neither" };
  meter?: { value: number; max: number; tone: "good" | "warning"; label: string };
  fact?: { label: string; value?: string };
  action?: { label: string; href: string };
  tone?: "default" | "warn";
  href: string;
};

/** Which figure keys from the role home feed each card (its link is the first one present). */
const KPI_SOURCES: Record<KpiKey, readonly HomeFigureKey[]> = {
  premium: ["premium"],
  appointments: ["appointments"],
  rate: ["rate", "reached"],
  dials: ["dials", "reached", "dials7"],
  queue: ["queue"],
  closeOut: ["closeOut"],
  booked: ["booked", "shown"],
  showRate: ["showRate", "shown"],
};

/** The four cards each role sees first, in order; a card without data gives its place to the next. */
export const KPI_ORDER: Record<HomeRole, readonly KpiKey[]> = {
  owner: ["premium", "appointments", "rate", "dials", "closeOut", "queue"],
  manager: ["appointments", "rate", "dials", "queue", "closeOut"],
  producer: ["appointments", "queue", "premium", "closeOut", "rate", "dials"],
  setter: ["booked", "showRate", "appointments", "queue", "dials"],
  assistant: [],
  bookkeeper: [],
  retention: [],
};

export const MAX_KPIS = 4;

/** Seven-day dials, reached and contact rate, and the seven days before (series is fourteen days). */
export function weekTotals(series: HomeToday["series"]) {
  const recent = series.slice(-7);
  const prior = series.slice(-14, -7);
  const dials = sum(recent.map((day) => day.dials));
  const reached = sum(recent.map((day) => day.contacts));
  const priorDials = sum(prior.map((day) => day.dials));
  const priorReached = sum(prior.map((day) => day.contacts));
  const read = recent.some((day) => day.dials !== null);
  return {
    read,
    dials,
    reached,
    rate: dials > 0 ? (Math.min(reached, dials) / dials) * 100 : null,
    priorDials,
    priorRate: priorDials > 0 ? (Math.min(priorReached, priorDials) / priorDials) * 100 : null,
  };
}

function buildKpi(key: KpiKey, today: HomeToday, href: string): KpiCard | null {
  switch (key) {
    case "premium": {
      const policies = today.policies30;
      if (!policies) return null;
      return { key, icon: "dollar", label: "Premium written", period: "30 days", value: usd(policies.premiumCents), fact: { label: "Policies written", value: n(policies.count) }, href };
    }
    case "appointments": {
      if (today.appointmentsToday === null) return null;
      return {
        key, icon: "calendar", label: "Appointments", period: "today", value: today.appointmentsToday,
        fact: today.appointmentsWeek !== null ? { label: "Booked this week", value: n(today.appointmentsWeek) } : undefined,
        href,
      };
    }
    case "rate": {
      const week = weekTotals(today.series);
      if (!week.read || week.rate === null) return null;
      const change = week.priorRate === null ? null : round1(week.rate - week.priorRate);
      // The change names its comparison in the footer: the prior week's rate itself.
      return {
        key, icon: "phone", label: "Contact rate", period: "7 days",
        value: String(Math.round(week.rate)), unit: "%",
        delta: change === null ? undefined : { value: change, unit: " pts", goodWhen: "up" },
        fact: week.priorRate === null ? { label: "Reached", value: `${n(week.reached)} of ${n(week.dials)}` } : { label: "Prior 7 days", value: `${Math.round(week.priorRate)}%` },
        href,
      };
    }
    case "dials": {
      if (today.dialsToday === null) return null;
      const change = percentChange(today.dialsToday, today.dialsYesterday);
      return {
        key, icon: "dial", label: "Dials", period: change === null ? "today" : "today vs. yesterday", value: today.dialsToday,
        delta: change === null ? undefined : { value: change, goodWhen: "up" },
        fact: today.contactsToday !== null ? { label: "Reached today", value: n(today.contactsToday) } : undefined,
        href,
      };
    }
    case "queue": {
      if (today.queueReady === null) return null;
      return { key, icon: "queue", label: "Ready to dial", period: "queue", value: today.queueReady, action: today.queueReady ? { label: "Start calling", href } : undefined, fact: today.queueReady ? undefined : { label: "Queue is empty" }, href };
    }
    case "closeOut": {
      const closeOut = today.closeOut;
      if (!closeOut) return null;
      const total = closeOut.showed + closeOut.noShow + closeOut.awaiting;
      if (total === 0) return null;
      const done = closeOut.showed + closeOut.noShow;
      return {
        key, icon: "check", label: "Close-out", period: "30 days", value: String(Math.round((done / total) * 100)), unit: "%",
        meter: { value: done, max: total, tone: closeOut.awaiting ? "warning" : "good", label: `${n(done)} of ${n(total)} appointments closed out` },
        fact: { label: "Need an outcome", value: n(closeOut.awaiting) },
        tone: closeOut.awaiting ? "warn" : "default",
        href,
      };
    }
    case "booked": {
      const week = today.setterWeek;
      if (!week) return null;
      return { key, icon: "booked", label: "Booked", period: "7 days", value: week.booked, fact: { label: "Showed", value: n(week.showed) }, href };
    }
    case "showRate": {
      const week = today.setterWeek;
      if (!week || week.booked === 0) return null;
      // A show rate never travels without its coverage (Sixteen #12).
      return {
        key, icon: "show", label: "Show rate", period: "7 days", value: String(Math.round((week.showed / week.booked) * 100)), unit: "%",
        fact: { label: "Closed out", value: `${n(week.closedOut)} of ${n(week.closeable)}` },
        tone: week.closedOut < week.closeable ? "warn" : "default",
        href,
      };
    }
  }
}

/**
 * Up to four stat cards for this role, in its order, each only when its figure is in the role's home
 * (that is the gate) and was read. At most one amber card: the first that needs action keeps it.
 */
export function kpiCards(today: HomeToday | null, figures: ReadonlyArray<{ key: HomeFigureKey; href: string }>, role: HomeRole): KpiCard[] {
  if (!today) return [];
  const cards: KpiCard[] = [];
  for (const key of KPI_ORDER[role]) {
    if (cards.length === MAX_KPIS) break;
    // A manager sees no money (owner, 2026-10-25), whatever the underlying role's figures list.
    if (key === "premium" && role === "manager") continue;
    const source = figures.find((figure) => KPI_SOURCES[key].includes(figure.key));
    if (!source) continue;
    const card = buildKpi(key, today, source.href);
    if (card) cards.push(card);
  }
  let warned = false;
  return cards.map((card) => {
    if (card.tone !== "warn") return card;
    if (warned) return { ...card, tone: "default" };
    warned = true;
    return card;
  });
}

/* ── Activity chart ─────────────────────────────────────────────────────────────────────────── */

export type ActivityBar = { key: string; label: string; weekday: string; dials: number; reached: number; isToday: boolean };
export type ActivityView = {
  bars: ActivityBar[];
  max: number;
  weekDials: number;
  weekReached: number;
  /** Change in seven-day dials against the seven before, or null. */
  change: number | null;
  rate: number | null;
  bestHour: { hour: number; rate: number } | null;
  topOutcome: { label: string; share: number } | null;
};

/** Fourteen days of dials with the reached share, or null when dialling was not read. */
export function activityView(today: Pick<HomeToday, "series" | "insights"> | null): ActivityView | null {
  if (!today || !today.series.some((day) => day.dials !== null)) return null;
  const week = weekTotals(today.series);
  const bars = today.series.map((day) => ({ key: day.key, label: day.label, weekday: day.weekday, dials: day.dials ?? 0, reached: Math.min(day.contacts ?? 0, day.dials ?? 0), isToday: day.isToday }));
  const outcomes = today.insights?.outcomes ?? [];
  const total = outcomes.reduce((all, outcome) => all + outcome.count, 0);
  const top = outcomes[0];
  const best = today.insights?.heat.best ?? null;
  return {
    bars,
    max: Math.max(1, ...bars.map((bar) => bar.dials)),
    weekDials: week.dials,
    weekReached: week.reached,
    change: percentChange(week.dials, week.priorDials),
    rate: week.rate,
    bestHour: best ? { hour: best.hour, rate: best.rate } : null,
    topOutcome: top && total ? { label: top.label, share: Math.round((top.count / total) * 100) } : null,
  };
}

/** The chart's top gridline: the smallest readable round number at or above the busiest day. */
export function niceMax(value: number): number {
  if (value <= 5) return 5;
  // Half the order of magnitude as the step (50 for hundreds, 5 for tens): the tallest bar fills
  // most of the chart, and the halfway gridline still lands on a round number.
  const step = 10 ** Math.floor(Math.log10(value)) / 2;
  return Math.ceil(value / step) * step;
}

/* ── Today's schedule ───────────────────────────────────────────────────────────────────────── */

export type DueCallback = { id?: string; customerName: string; scheduledAtUtc: string; customerTimezone: string; isOverdue: boolean };
export type ScheduleItem = {
  id: string;
  kind: "appointment" | "callback";
  atUtc: string;
  name: string;
  /** The agent, for an appointment on an agency view. */
  who?: string;
  late: boolean;
  /** The customer's own clock, when it differs from the agency's. */
  theirZone?: string;
  href: string;
};

/**
 * Today's appointments and due callbacks as one list: late callbacks first, then by time. `limit`
 * keeps it a nudge; the calendar is the list.
 */
export function scheduleItems(
  appointments: readonly TodayAppointment[] | null,
  callbacks: readonly DueCallback[] | null,
  links: { appointments?: string | null; callbacks?: string | null },
  limit = 6,
): { items: ScheduleItem[]; total: number } {
  const items: ScheduleItem[] = [];
  if (links.appointments) {
    for (const item of appointments ?? []) {
      items.push({ id: `a-${item.id}`, kind: "appointment", atUtc: item.startsAtUtc, name: item.customerName, who: item.agentName, late: false, theirZone: item.customerTimezone, href: links.appointments });
    }
  }
  if (links.callbacks) {
    (callbacks ?? []).forEach((item, index) => {
      items.push({ id: `c-${item.id ?? index}`, kind: "callback", atUtc: item.scheduledAtUtc, name: item.customerName, late: item.isOverdue, theirZone: item.customerTimezone, href: links.callbacks as string });
    });
  }
  items.sort((a, b) => (a.late === b.late ? Date.parse(a.atUtc) - Date.parse(b.atUtc) : a.late ? -1 : 1));
  return { items: items.slice(0, limit), total: items.length };
}

/* ── Formatting shared by the components ────────────────────────────────────────────────────── */

/** "9:30 AM" in the given zone. */
export function clock(utc: string, zone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(utc));
}

/** "2 PM" for an hour of the day. */
export function hourText(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "AM" : "PM"}`;
}

export { n as formatCount, usd as formatUsd };
