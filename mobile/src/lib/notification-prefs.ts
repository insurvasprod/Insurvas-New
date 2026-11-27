import type { IconName } from "@/components/icon";
import type { IconTone } from "@/components/ui";

/**
 * GET/PUT /api/app/notification-preferences (LA-8.4): per event, in-app / email / push, and quiet
 * hours. The events are the server's — only those this person can receive, in the registry's order;
 * protected ones come back locked on. On the phone the switch is the push channel (what reaches the
 * lock screen); in-app and email are kept as they are.
 */
export type Delivery = { in_app: boolean; email: boolean; push: boolean; digest: "immediate" | "daily" | "weekly" | "off"; protected: boolean };
export type PrefEvent = { key: string; label: string; description: string; group: string; supportsDigest: boolean; protected: boolean; protectedReason: string | null; delivery: Delivery };
export type Quiet = { enabled: boolean; start: string; end: string };
/** `callbackReminderMinutes` (2026-11-27): how long before a callback its reminder comes, the agency's or the platform's. */
export type PrefsAnswer = { available: boolean; timeZone: string | null; quiet: Quiet; events: PrefEvent[]; callbackReminderMinutes?: number | null };

export const PREFS_PATH = "/api/app/notification-preferences";

/** The board's icon for each alert kind (A3); anything new falls back to the bell. */
const ICONS: Record<string, [IconName, IconTone?]> = {
  handoff_offered: ["phoneIn"], new_lead: ["userPlus"], unclaimed_escalation: ["hourglass"], callback_due: ["calCheck"], appointment_due: ["calendar"],
  mentioned: ["msg"], partner_message: ["msgs"], servicing_failed: ["buoy", "warn"], reinstatement_closing: ["buoy", "warn"],
  recurring_expense_due: ["receipt"], return_window_closing: ["clock"], carrier_status_unmapped: ["fileCheck"], doi_deadline: ["gavel"],
  credential_expiring: ["badge"], plan_payment_failed: ["creditCard"], webhook_disabled: ["link"], allowance_near_cap: ["gauge"],
};

export function iconFor(key: string): { icon: IconName; tone?: IconTone } {
  const [icon, tone] = ICONS[key] ?? ["bell"];
  return { icon, tone };
}

/** The server's groups in the order they first appear (it sends events in registry order). */
export function groupEvents(events: PrefEvent[]): { title: string; events: PrefEvent[] }[] {
  const out: { title: string; events: PrefEvent[] }[] = [];
  for (const e of events) {
    const last = out.find((g) => g.title === e.group);
    if (last) last.events.push(e);
    else out.push({ title: e.group, events: [e] });
  }
  return out;
}

/** The push switches the person changed, as the PUT bodies the route takes (one event per call). */
export function pushChanges(events: PrefEvent[], wanted: Record<string, boolean>): { event_key: string; push: boolean }[] {
  return events.filter((e) => !e.protected && e.key in wanted && wanted[e.key] !== e.delivery.push).map((e) => ({ event_key: e.key, push: wanted[e.key] }));
}

/**
 * The board's alert kinds, each bound to the server events that carry it (lib/notifications/events.ts). One board
 * row can stand for more than one event ("A policy is at risk" is a failed payment change or a closing
 * reinstatement window); its switch saves each of them. A board row is drawn only when the server has at least
 * one of its events for this person (the switch must save something real). Board rows with no server event behind
 * them (Case changed at the carrier, Commission statement posted, Team floor) are not drawn, and nothing the board
 * does not draw is added: the web's Settings › Notifications keeps every event.
 *
 * "Transfer waiting" is `new_lead`: the bell row a partner's transfer writes (new_unclaimed_lead, "New lead
 * available", sent when Settings › Inbound's transfer alert is on; lib/agentTemplates/intake.ts). It is the only
 * transfer alert the server has. The board's sub-lines are drawn only where they are true of the events: a
 * new_unclaimed_lead push is not on the ringing channel (lib/push/rules.ts URGENT), and partner messages reach
 * everyone partner chat is open to, so neither carries its line.
 */
type BoardKind = { id: string; keys: string[]; label: string; meta?: string; icon: IconName; tone?: IconTone };
const KIND = {
  transfer: { id: "transfer", keys: ["new_lead"], label: "Transfer waiting", icon: "phoneIn" },
  callback: { id: "callback", keys: ["callback_due"], label: "Callback in 5 minutes", icon: "calCheck" },
  handoff: { id: "handoff", keys: ["handoff_offered"], label: "Someone handed a call to you", icon: "phoneIn" },
  risk: { id: "risk", keys: ["servicing_failed", "reinstatement_closing"], label: "A policy is at risk", icon: "buoy", tone: "warn" },
  partner: { id: "partner", keys: ["partner_message"], label: "Partner chat", icon: "msgs" },
} satisfies Record<string, BoardKind>;

/** Board H4's groups and rows, in its order. */
const BOARD: { title: string; rows: BoardKind[] }[] = [
  { title: "Calls", rows: [KIND.transfer, KIND.callback, KIND.handoff] },
  { title: "Sales and book", rows: [KIND.risk] },
  { title: "Messages", rows: [KIND.partner] },
];

/** Board A3's rows, in its order, with A3's own wording. */
const A3: BoardKind[] = [
  { ...KIND.transfer, label: "A transfer is waiting for you" },
  { ...KIND.callback, label: "Callback in 5 minutes" },
  KIND.risk,
  { ...KIND.partner, label: "Partner messages" },
];

/** One board row: its events (those the server sent), the switch (on when every one is on), locked when all are. */
export type BoardPref = { id: string; events: PrefEvent[]; label: string; meta: string | null; on: boolean; locked: boolean; icon: IconName; tone?: IconTone };

/** "Callback in 5 minutes": the minutes are the agency's reminder lead time; unknown, the server's own label. */
function boardLabel(row: BoardKind, events: PrefEvent[], callbackMinutes: number | null | undefined): string {
  if (row.id !== "callback") return row.label;
  if (callbackMinutes == null || !Number.isFinite(callbackMinutes) || callbackMinutes <= 0) return events[0].label;
  return `Callback in ${callbackMinutes} minute${callbackMinutes === 1 ? "" : "s"}`;
}

function boardPref(row: BoardKind, byKey: Map<string, PrefEvent>, callbackMinutes?: number | null): BoardPref | null {
  const events = row.keys.map((k) => byKey.get(k)).filter((e): e is PrefEvent => Boolean(e));
  if (!events.length) return null;
  const locked = events.every((e) => e.protected);
  const lockedOne = events.find((e) => e.protected);
  return {
    id: row.id, events, label: boardLabel(row, events, callbackMinutes),
    // A locked row says why; otherwise the board's sub-line where it is true, or none.
    meta: (locked && lockedOne ? lockedOne.protectedReason ?? lockedOne.description : row.meta ?? null) || null,
    on: events.every((e) => e.delivery.push), locked, icon: row.icon, tone: row.tone,
  };
}

export function boardGroups(events: PrefEvent[], options: { callbackMinutes?: number | null } = {}): { title: string; rows: BoardPref[] }[] {
  const byKey = new Map(events.map((e) => [e.key, e]));
  return BOARD.map((g) => ({ title: g.title, rows: g.rows.map((r) => boardPref(r, byKey, options.callbackMinutes)).filter((r): r is BoardPref => r !== null) }))
    .filter((g) => g.rows.length);
}

/** Board A3's rows for this person (locked events are left out: they reach the phone whatever is chosen). */
export function alertKinds(events: PrefEvent[], options: { callbackMinutes?: number | null } = {}): BoardPref[] {
  const byKey = new Map(events.filter((e) => !e.protected).map((e) => [e.key, e]));
  return A3.map((r) => boardPref(r, byKey, options.callbackMinutes)).filter((r): r is BoardPref => r !== null);
}

/** The PUT bodies that set a board row's switch: one per event it stands for that is not locked and differs. */
export function rowChanges(row: BoardPref, push: boolean): { event_key: string; push: boolean }[] {
  return row.events.filter((e) => !e.protected && e.delivery.push !== push).map((e) => ({ event_key: e.key, push }));
}

/** Quiet hours are picked in half hours, as "HH:MM" (the route's own format). */
export const QUIET_TIMES: string[] = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`);
