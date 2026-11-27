import { useCounts } from "@/lib/counts";
import type { TabKey } from "@/lib/roles";
import { useSession } from "@/lib/session";
import type { AlertsAnswer } from "@/lib/types";
import { useLoad } from "@/lib/use-load";

/**
 * The tab bar's badges, shared by the phone bar (app-tabs.tsx) and the web preview (app-tabs.web.tsx).
 *
 * Two looks, as kit.js `k.tabs` draws them: gold `.badge` for plain new counts, and red `.badge.alert` when the board
 * writes the count with a "!" (board B2 Inbox "!6"): alerts that need attention. The Inbox turns red when one of its
 * unread alerts is one the bell draws as a warning (lib/agentAlerts/presentation.ts PROTECTED_ALERT_EVENTS: missing it
 * causes harm that does not come back), a transfer nobody claimed in time, or a carrier change that failed.
 *
 * To add a tab's badge (a setter's Callbacks tab, say): give its TabKey a line in `BADGE_COUNTS`.
 */
export type BadgeTone = "count" | "alert";
export type TabBadge = { text: string; tone: BadgeTone };

/** kit.css `.badge.alert`: the same red and white in both themes (ui.tsx's danger button uses it too). */
export const ALERT_BADGE = { bg: "#e5484d", fg: "#ffffff" } as const;

export const ATTENTION_EVENTS: readonly string[] = [
  "reinstatement_closing", "doi_deadline", "credential_expiring", "plan_payment_failed",
  "unclaimed_escalation", "servicing_failed",
];

export function needsAttention(eventTypes: readonly string[]): boolean {
  return eventTypes.some((e) => ATTENTION_EVENTS.includes(e));
}

export type BadgeInput = {
  calls: number; inbox: number; money: number;
  /** /api/app/nav/counts `retention.save-queue`: a retention rep's cases that need work (open and working). */
  cases: number;
  inboxAlert: boolean;
};

/** Which count each tab carries. */
const BADGE_COUNTS: Partial<Record<TabKey, (c: BadgeInput) => number>> = {
  calls: (c) => c.calls,
  ladder: (c) => c.cases,
  moneytab: (c) => c.money,
  inbox: (c) => c.inbox,
};

/** The badge per tab, capped at 99 like the kit; no badge at zero. */
export function tabBadges(input: BadgeInput): Partial<Record<TabKey, TabBadge>> {
  const out: Partial<Record<TabKey, TabBadge>> = {};
  for (const [key, count] of Object.entries(BADGE_COUNTS) as [TabKey, (c: BadgeInput) => number][]) {
    const n = count(input);
    if (n > 0) out[key] = { text: String(Math.min(n, 99)), tone: key === "inbox" && input.inboxAlert ? "alert" : "count" };
  }
  return out;
}

/**
 * The native bars paint every badge one colour (Android's bar takes the selected tab's badge colour for all of them;
 * the trigger has no colour of its own), so the bar turns red only when every badge showing is an alert, which is
 * exactly the board's B2 (the Inbox's "!6" alone). Beside a gold count it stays gold.
 */
export function barBadgeTone(badges: Partial<Record<TabKey, TabBadge>>, shown: readonly TabKey[]): BadgeTone {
  const showing = shown.map((k) => badges[k]).filter((b): b is TabBadge => Boolean(b));
  return showing.length > 0 && showing.every((b) => b.tone === "alert") ? "alert" : "count";
}

/** The live badges: the counts the app already polls, and which kinds of alerts sit in the Inbox. */
export function useTabBadges(): Partial<Record<TabKey, TabBadge>> {
  const { api } = useSession();
  const counts = useCounts();
  const nav = (counts.nav?.counts ?? {}) as Record<string, number | undefined>;
  // Which alerts: read again only when the Inbox count moves (CountsProvider polls the count every 20 seconds).
  const kinds = useLoad(
    async () => (counts.inbox > 0 ? api<AlertsAnswer>("/api/app/notifications").then((a) => a.alerts.map((x) => x.event_type), () => [] as string[]) : []),
    [counts.inbox],
  );
  return tabBadges({ calls: counts.calls, inbox: counts.inbox, money: counts.money, cases: nav["retention.save-queue"] ?? 0, inboxAlert: needsAttention(kinds.data ?? []) });
}
