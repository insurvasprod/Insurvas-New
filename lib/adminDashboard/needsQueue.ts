// Admin dashboard › Needs you (admin round 1, docs/design/admin-r1/dashboard-combined.html §2): the
// daily checks (lib/adminDashboard/dailyChecks.ts) as a work queue. Plain module — no database, no
// `server-only` — so the grouping, the To do · FYI · Clear switch, the selection in the address and
// each check's plain explanation are testable on their own.
//
// The queue reads the checks the role already gets (dailyChecksFor), never a list of its own: a check
// the role cannot act on is not in its queue.

import type { DailyCheck, DailyCheckArea, DailyCheckStatus } from "./dailyChecks.ts";

export type NeedsView = "todo" | "fyi" | "clear";
export const NEEDS_VIEWS: readonly NeedsView[] = ["todo", "fyi", "clear"];
export const NEEDS_VIEW_LABELS: Record<NeedsView, string> = { todo: "To do", fyi: "FYI", clear: "Clear" };

/** The board's area order: money first, then customers, security, the platform. */
export const AREA_ORDER: readonly DailyCheckArea[] = ["Money", "Customers", "Security", "Platform"];

export type CheckChipTone = "danger" | "warning" | "neutral" | "good";

/** One chip a check: what its status means (UI-CONSISTENCY §12). "FYI" is grey: neither good nor bad. */
export const CHECK_CHIP: Record<DailyCheckStatus, { label: string; tone: CheckChipTone }> = {
  failing: { label: "Failing", tone: "danger" },
  look: { label: "Look", tone: "warning" },
  unknown: { label: "Couldn't check", tone: "neutral" },
  info: { label: "FYI", tone: "neutral" },
  clear: { label: "Clear", tone: "good" },
};

/** Which part of the switch a status sits in: anything not known to be fine is to do. */
export function viewOf(status: DailyCheckStatus): NeedsView {
  if (status === "info") return "fyi";
  if (status === "clear") return "clear";
  return "todo";
}

export function parseNeedsView(raw: string | null | undefined): NeedsView | null {
  return raw && (NEEDS_VIEWS as readonly string[]).includes(raw) ? (raw as NeedsView) : null;
}

export type NeedsCounts = Record<NeedsView, number> & { failing: number; look: number; unknown: number };

export function needsCounts(checks: readonly DailyCheck[]): NeedsCounts {
  const counts: NeedsCounts = { todo: 0, fyi: 0, clear: 0, failing: 0, look: 0, unknown: 0 };
  for (const check of checks) {
    counts[viewOf(check.status)] += 1;
    if (check.status === "failing" || check.status === "look" || check.status === "unknown") counts[check.status] += 1;
  }
  return counts;
}

/** The view a bare address opens on: the first part of the switch with something in it. */
export function defaultView(checks: readonly DailyCheck[]): NeedsView {
  const counts = needsCounts(checks);
  return NEEDS_VIEWS.find((view) => counts[view] > 0) ?? "todo";
}

export type NeedsGroup = { area: DailyCheckArea; checks: DailyCheck[] };

/** The view's checks grouped by area in the board's order; within an area the checks keep their order (worst first). */
export function groupForView(checks: readonly DailyCheck[], view: NeedsView): NeedsGroup[] {
  return AREA_ORDER.map((area) => ({ area, checks: checks.filter((check) => check.area === area && viewOf(check.status) === view) })).filter(
    (group) => group.checks.length > 0,
  );
}

/**
 * The view and the check the address asks for. A check named without a view opens in its own view; a check
 * that is not in the asked view (or not the role's) falls back to the view's first check.
 */
export function resolveSelection(
  checks: readonly DailyCheck[],
  rawView: string | null | undefined,
  rawCheck: string | null | undefined,
): { view: NeedsView; check: DailyCheck | null } {
  const asked = rawCheck ? checks.find((check) => check.key === rawCheck) ?? null : null;
  const view = parseNeedsView(rawView) ?? (asked ? viewOf(asked.status) : defaultView(checks));
  if (asked && viewOf(asked.status) === view) return { view, check: asked };
  return { view, check: groupForView(checks, view)[0]?.checks[0] ?? null };
}

/** The address of one check in the queue. */
export function needsHref(view: NeedsView, key?: string | null): string {
  return `/admin?tab=needs&view=${view}${key ? `&check=${encodeURIComponent(key)}` : ""}`;
}

/** The queue's short names (the board's list), beside the checks' full titles. */
export const CHECK_SHORT_TITLE: Record<string, string> = {
  webhooks: "Payment events",
  "billing-run": "Billing run",
  "past-due": "Failed payments",
  overdue: "Overdue invoices",
  mismatched: "Invoices that don't match",
  trials: "Trials ending",
  signups: "New sign-ups",
  cancellations: "Cancellations",
  seats: "At their seat limit",
  suspended: "Suspended customers",
  invitations: "Invitations not accepted",
  signins: "Failed sign-ins",
  "staff-changes": "Staff changes today",
  compliance: "Compliance sources",
  metrics: "Nightly metrics",
  maintenance: "Maintenance mode",
  features: "Features switched off",
};

export function shortTitle(check: Pick<DailyCheck, "key" | "title">): string {
  return CHECK_SHORT_TITLE[check.key] ?? check.title;
}

/**
 * What each check is about, in plain words: what it counts, why it matters, where it is fixed. Said once
 * here so the pane never guesses. Only what the platform actually does: no promise of a step it does not take.
 */
export const CHECK_EXPLAIN: Record<string, string> = {
  webhooks:
    "The payment provider sends an event for every payment, renewal and cancellation. Until an event is processed, the customer's subscription and invoices do not change. One waiting more than 10 minutes means processing has stopped.",
  "billing-run":
    "Once a day the billing run raises each subscription's invoice for the period that ended: add-ons, overage and changes of plan. When it stops, those periods go unbilled.",
  "past-due":
    "A customer is past due when the provider could not take a renewal payment, usually a declined or expired card. The provider retries the card; the subscription page shows each one.",
  overdue: "Invoices whose due date has passed without a payment. The invoices page lists them, newest first.",
  mismatched:
    "Invoices whose total differs from what the payment provider charged. Until someone checks them, revenue and the customer's balance may be wrong.",
  trials:
    "Trials that end within two days. A trial with no card on file cannot become a paying subscription by itself, so these are the ones worth a word before they end.",
  signups: "Workspaces created in the last 24 hours. Nothing to fix: who arrived, so you can look at how they are getting on.",
  cancellations: "Subscriptions cancelled in the last 24 hours. Each subscription shows the reason the customer gave.",
  seats: "These customers hold every seat their plan allows, so they cannot add a user until they free a seat or move to a larger plan.",
  suspended: "Suspended customers cannot sign in to their workspace until they are reinstated.",
  invitations: "People invited to a workspace a while ago who never accepted. The users page can resend the invitation or remove them.",
  signins:
    "Failed sign-ins across the platform today. More than 25 in a day can mean someone is guessing passwords, or that a way of signing in is broken.",
  "staff-changes": "What staff changed today, from the audit log.",
  compliance: "Do-not-call and consent checks call outside services. A source that stops answering can block dialing for every agency that uses it.",
  metrics:
    "Every night the platform works out the revenue and customer figures: MRR, collected, customers, trials. When it stops, the graphs and Revenue show the last night it worked.",
  maintenance: "Maintenance mode shows customers a banner, or limits what they can do while work is under way. Turn it off when the work is done.",
  features: "A feature switched off is off for every customer until someone switches it back on.",
};
