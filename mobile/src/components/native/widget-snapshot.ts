import { clock, dayKey, zoneShort } from "@/components/calls/time";
import { callbackOpen, displayName } from "@/lib/format";
import { callsPartsFor } from "@/lib/roles";
import type { CallbackView } from "@/lib/types";
import { intentUrl } from "./intents";

/**
 * Board L1 · Home-screen widgets: the data contract. The app builds this snapshot from answers it
 * already has (GET /api/app/callbacks, the goal ring's figures, the agency month) and hands it to the
 * widget through shared storage: an App Group on iOS, the widget's own render call on Android. The
 * widget never holds a session token and never calls the server itself; it draws the last snapshot
 * and a push (or opening the app) writes a new one. Nothing is computed here that the server didn't
 * send: the goal and the month are passed in as the server gave them.
 *
 * Kept small and versioned: the native side (Swift / Kotlin) reads exactly these keys.
 */
export const WIDGET_SNAPSHOT_KEY = "widget.snapshot.v1";

export type WidgetSnapshot = {
  v: 1;
  /** When the app wrote it: the widget's "updated 9:40". */
  updatedAt: string;
  /** Whose snapshot; a different person signing in replaces it, signing out clears it. */
  userId: string;
  today: {
    next: {
      name: string;
      /** In the viewer's zone ("11:30") and the customer's ("10:30 his time (CT)" is the widget's words). */
      yours: string;
      theirs: string | null;
      zone: string | null;
      link: string;
    } | null;
    /** Open callbacks due today, overdue ones included (the "3 callbacks" button). */
    dueToday: number;
    /** Whole percent of the person's own goal, or null when they have none set. */
    goalPct: number | null;
    /** Start calling shows only for a role with the dialer. */
    canDial: boolean;
    links: { startCalling: string; callbacks: string; goal: string };
  };
  /** The agency's month: owners and admins only, the roles the web shows agency money to. */
  agency: { month: string; submittedCents: number; changePct: number | null; link: string } | null;
};

const AGENCY_MONEY = ["owner", "admin"];

export function buildWidgetSnapshot(input: {
  userId: string;
  role: string;
  viewerZone: string;
  now: Date;
  callbacks: CallbackView[];
  /** The goal ring's figures as the server gave them (done and target in the same unit). */
  goal?: { done: number; target: number } | null;
  /** Or the ring's whole percent, worked out the way the person's Home ring does (wins over `goal`). */
  goalPct?: number | null;
  /** The agency's submitted premium this month and last, in cents, from the server. */
  agencyMonth?: { month: string; submittedCents: number; previousCents: number | null } | null;
}): WidgetSnapshot {
  const { now, viewerZone } = input;
  const today = dayKey(now, viewerZone);
  const open = input.callbacks.filter((cb) => callbackOpen(cb.status));
  const due = open.filter((cb) => cb.isOverdue || cb.status === "missed" || dayKey(new Date(cb.scheduledAtUtc), viewerZone) <= today);
  const upcoming = open
    .filter((cb) => !cb.isOverdue && cb.status !== "missed" && Date.parse(cb.scheduledAtUtc) >= now.getTime())
    .sort((a, b) => Date.parse(a.scheduledAtUtc) - Date.parse(b.scheduledAtUtc));
  const next = upcoming[0] ?? null;
  const at = next ? new Date(next.scheduledAtUtc) : null;
  const goal = input.goalPct != null ? input.goalPct : input.goal && input.goal.target > 0 ? Math.round((input.goal.done / input.goal.target) * 100) : null;
  const month = input.agencyMonth && AGENCY_MONEY.includes(input.role) ? input.agencyMonth : null;

  return {
    v: 1,
    updatedAt: now.toISOString(),
    userId: input.userId,
    today: {
      next: next && at ? {
        name: displayName(next.customerName),
        yours: clock(at, viewerZone, false),
        theirs: next.customerTimezone ? clock(at, next.customerTimezone, false) : null,
        zone: next.customerTimezone ? zoneShort(next.customerTimezone, at) : null,
        link: `insurvas://lead/${next.leadId}`,
      } : null,
      dueToday: due.length,
      goalPct: goal,
      canDial: callsPartsFor(input.role).includes("dialer"),
      links: { startCalling: intentUrl("serve-next"), callbacks: intentUrl("next-callback"), goal: "insurvas://" },
    },
    agency: month ? {
      month: month.month,
      submittedCents: month.submittedCents,
      changePct: month.previousCents ? Math.round(((month.submittedCents - month.previousCents) / month.previousCents) * 100) : null,
      link: "insurvas://",
    } : null,
  };
}
