import { buildWidgetSnapshot, WIDGET_SNAPSHOT_KEY, type WidgetSnapshot } from "@/components/native/widget-snapshot";
import { dayKey, premiumMonth } from "@/components/home3/logic";
import { goalCard, type PremiumGoalAnswer, type ProducerBookAnswer } from "@/components/home3/producer-logic";
import type { ApplicationsAnswer } from "@/components/home3/types";
import { setterWeek, type GoalAnswer, type ScoreRow } from "@/lib/setter-week";
import { readSecret, writeSecret } from "@/lib/secure";
import { callsPartsFor, tabsFor, type TabOptions } from "@/lib/roles";
import type { CallbacksAnswer } from "@/lib/types";

/**
 * Board L1's data on Android: the app reads what its own Home screens read (GET /api/app/callbacks; the goal as the
 * Home's ring reads it — GET /api/app/goals with /api/app/home/producer for a producer or owner, with
 * /api/app/scorecard for a setter; for an owner or admin GET /api/app/applications, the source of the owner Home's
 * submitted premium), builds the versioned snapshot and keeps it in the phone's secure storage, where the widget's
 * background task draws it from. The widget never holds a token and never calls the server.
 */
const CALLBACK_ROLES = ["owner", "producer", "assistant"];
const AGENCY_ROLES = ["owner", "admin"];

type Api = <T>(path: string) => Promise<T>;

/**
 * The person's own goal as a whole percent, the way their Home's ring measures it, or null when they have none set
 * (the widget's "Goal" is a goal, never the Home's last-month fallback). Producers and owners: the month's issued
 * annual premium against their premium goal (the route answers premium only to who sees money). Setters: this week's
 * booked appointments against their weekly target. Other roles' Homes have no goal of their own on the widget.
 */
export async function collectGoalPct(api: Api, role: string, memberRole?: string | null): Promise<number | null> {
  const held = memberRole ?? role;
  try {
    if (held === "setter") {
      const [score, goal] = await Promise.all([api<{ rows: ScoreRow[] }>("/api/app/scorecard?days=30"), api<GoalAnswer>("/api/app/goals?kind=booked&for=me")]);
      const week = setterWeek(score.rows, goal);
      return week.target ? Math.max(0, Math.min(100, Math.round((week.booked / week.target) * 100))) : null;
    }
    if ((role === "owner" || role === "producer") && held !== "manager") {
      const [book, goal] = await Promise.all([api<ProducerBookAnswer>("/api/app/home/producer"), api<PremiumGoalAnswer>("/api/app/goals?kind=premium&for=me")]);
      if (goal.goal.state !== "set" || !book.money) return null;
      return goalCard(book, goal, book.today)?.pct ?? null;
    }
  } catch {
    // A goal the server refuses (not in the plan, not this role) is simply not drawn.
  }
  return null;
}

export async function collectSnapshot(api: Api, me: { userId: string; role: string; memberRole?: string | null }, now = new Date(), options: TabOptions = {}): Promise<WidgetSnapshot> {
  const role = me.role;
  const agencyRole = AGENCY_ROLES.includes(me.memberRole ?? role) && me.memberRole !== "manager";
  const [callbacks, apps, goalPct] = await Promise.all([
    CALLBACK_ROLES.includes(role) && callsPartsFor(role, options.features).includes("callbacks") ? api<CallbacksAnswer>("/api/app/callbacks").then((a) => a.callbacks).catch(() => []) : Promise.resolve([]),
    agencyRole ? api<ApplicationsAnswer>("/api/app/applications").then((a) => a.applications).catch(() => null) : Promise.resolve(null),
    collectGoalPct(api, role, me.memberRole),
  ]);
  const today = dayKey(now);
  const month = apps ? premiumMonth(apps, today) : null;
  const snapshot = buildWidgetSnapshot({
    userId: me.userId,
    role: agencyRole ? "owner" : role,
    viewerZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    now,
    callbacks,
    goalPct,
    agencyMonth: month ? { month: today.slice(0, 7), submittedCents: month.totalCents, previousCents: month.before[month.before.length - 1] ?? null } : null,
  });
  // A widget never points at a tab this phone hides (an owner on Team · Money has no Calls tab): no Start calling, and
  // the callbacks button opens the Calendar, which lists them for everyone who has callbacks.
  const tabs = tabsFor(me.memberRole ?? role, options);
  if (!tabs.includes("calls")) {
    snapshot.today.canDial = false;
    snapshot.today.links.callbacks = "insurvas://calendar";
  }
  return snapshot;
}

export async function saveSnapshot(snapshot: WidgetSnapshot | null): Promise<void> {
  await writeSecret(WIDGET_SNAPSHOT_KEY, snapshot ? JSON.stringify(snapshot) : null);
}

export async function readSnapshot(): Promise<WidgetSnapshot | null> {
  try {
    const raw = await readSecret(WIDGET_SNAPSHOT_KEY);
    const parsed = raw ? (JSON.parse(raw) as WidgetSnapshot) : null;
    return parsed?.v === 1 ? parsed : null;
  } catch {
    return null;
  }
}

/** "$86.4k", "$1.2M", "$940". */
export function compactDollars(cents: number): string {
  const d = cents / 100;
  if (Math.abs(d) >= 1_000_000) return `$${(d / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(d) >= 1_000) return `$${(d / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `$${Math.round(d)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov" from "2026-11"; the month before with `back`. */
export function shortMonth(ym: string, back = 0): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 - back, 1);
  return MONTHS[d.getMonth()];
}

/**
 * Board L1's line under the next callback, "10:30 his time (CT)": the customer's own clock with its zone, always,
 * as every callback shows both times. No gender is stored for a contact, so it says "their".
 */
export function theirTimeLine(next: { theirs: string | null; zone: string | null }): string | null {
  return next.theirs && next.zone ? `${next.theirs} their time (${next.zone})` : null;
}

/** "9:40" on this phone's clock. */
export function updatedLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}`;
}
