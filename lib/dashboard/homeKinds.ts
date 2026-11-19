import type { HomeRole } from "./homeView.ts";
import type { GoalFor, GoalKind } from "./goalRules.ts";

/**
 * The compact Home per role (roles r1, owner 2026-11-18, board docs/design/roles-r1/dashboards-and-partners.html
 * screens 1–8): one shared layout — Needs you · My numbers · big chart + side card · two lower cards · right column
 * hero + Today — with each role's cards. Pure: which home a reader gets, the goal its ring reads, the daily pages it
 * links, and the month and week arithmetic the figures use. Tested in homeKinds.test.mjs; drawn by
 * components/app/home/views/home-view.tsx.
 */
export type HomeKind = "owner" | "solo" | "manager" | "producer" | "setter" | "assistant" | "bookkeeper" | "retention";

/** Which home: the role as held (an admin reads as the owner, a manager as a manager), and an owner alone is solo. */
export function homeKind(role: HomeRole, solo: boolean): HomeKind {
  if (role === "owner") return solo ? "solo" : "owner";
  return role;
}

/** The ring's goal: what it counts and whose it is. Null: this home has no goal ring. */
export const HOME_GOAL: Record<HomeKind, { kind: GoalKind; whose: GoalFor } | null> = {
  owner: { kind: "premium", whose: "agency" },
  solo: { kind: "premium", whose: "me" },
  manager: { kind: "policies", whose: "me" },
  producer: { kind: "premium", whose: "me" },
  setter: { kind: "booked", whose: "me" },
  retention: { kind: "saves", whose: "me" },
  assistant: null,
  bookkeeper: null,
};

/** Homes that draw money (dollar figures). The page still checks the money permission (lib/dashboard/access). */
export const HOME_MONEY: Record<HomeKind, boolean> = { owner: true, solo: true, producer: true, bookkeeper: true, manager: false, setter: false, assistant: false, retention: false };

/**
 * Each role's daily pages, linked from its Home (the audit: "never surfaced"). Menu keys in order of preference; a
 * page the reader cannot open is left out (firstOpenable with the menu's gate).
 */
export const HOME_PAGES = {
  myPay: ["commissions.my_pay", "accounting.my_balance"],
  statements: ["book.statements"],
  payIssues: ["book.discrepancies"],
  payouts: ["team.payouts", "partners.payouts"],
  scorecard: ["retention.scorecard"],
  producers: ["team.producers", "team.hierarchy"],
  inbound: ["leads.inbound"],
  floor: ["leads.floor"],
  policies: ["book.policies"],
  setup: ["settings.root"],
} as const;
export type HomePageKey = keyof typeof HOME_PAGES;

/** The "today" reads each home asks for on top of its role layout's own. */
export const HOME_READS: Record<HomeKind, { setterWeek?: boolean; closeOut?: boolean; inboundToday?: boolean; dialing?: boolean }> = {
  owner: {},
  solo: { dialing: true },
  manager: { dialing: true },
  producer: { closeOut: true, dialing: true },
  setter: { setterWeek: true, dialing: true },
  assistant: { inboundToday: true },
  bookkeeper: {},
  retention: {},
};

/* ── Arithmetic ─────────────────────────────────────────────────────────────────────────────────── */

const monthKey = (total: number) => `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
const monthIndex = (key: string) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1;

/** The last `count` month keys ending with today's month, oldest first. */
export function lastMonths(today: string, count: number): string[] {
  const end = monthIndex(today.slice(0, 7));
  return Array.from({ length: count }, (_, index) => monthKey(end - (count - 1) + index));
}

/** Policies issued and their annual premium per month, oldest first (a sparkline's points). Future issue dates are left out. */
export function issuedByMonths(rows: ReadonlyArray<{ issueDate: string | null; annualCents: number | null }>, today: string, count = 7): Array<{ key: string; count: number; cents: number }> {
  const months = lastMonths(today, count);
  const at = new Map(months.map((key) => [key, { key, count: 0, cents: 0 }]));
  for (const row of rows) {
    if (!row.issueDate || row.issueDate > today) continue;
    const month = at.get(row.issueDate.slice(0, 7));
    if (!month) continue;
    month.count += 1;
    month.cents += row.annualCents ?? 0;
  }
  return months.map((key) => at.get(key)!);
}

/** Policies issued per week (Monday starts), the last `count` weeks ending with this one, oldest first. */
export function issuedByWeeks(rows: ReadonlyArray<{ issueDate: string | null }>, today: string, count = 10): Array<{ key: string; label: string; count: number }> {
  const day = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const now = day(today);
  const weekday = (new Date(now).getUTCDay() + 6) % 7;
  const thisMonday = now - weekday * 86_400_000;
  const weeks = Array.from({ length: count }, (_, index) => {
    const start = thisMonday - (count - 1 - index) * 7 * 86_400_000;
    const iso = new Date(start).toISOString().slice(0, 10);
    return { key: iso, start, label: new Date(start).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }), count: 0 };
  });
  for (const row of rows) {
    if (!row.issueDate || row.issueDate > today) continue;
    const at = day(row.issueDate);
    const week = weeks.find((each) => at >= each.start && at < each.start + 7 * 86_400_000);
    if (week) week.count += 1;
  }
  return weeks.map(({ key, label, count: issued }) => ({ key, label, count: issued }));
}

/** The figure against its goal as the ring draws it: the share (0–100, capped), the centre, what is left. */
export function ringOf(value: number, target: number): { pct: number; reached: boolean; left: number } {
  if (target <= 0) return { pct: value > 0 ? 100 : 0, reached: value > 0, left: 0 };
  const pct = Math.round((value / target) * 100);
  return { pct: Math.min(100, pct), reached: value >= target, left: Math.max(0, target - value) };
}
