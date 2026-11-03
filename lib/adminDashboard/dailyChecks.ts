// The admin home's daily checks (owner, 2026-10-13: "the information he needs to check every single
// day to keep track"). Plain module — no database, no `server-only` — so which check says what, and
// who sees it, is testable on its own. lib/adminDashboard/dailyQueries.ts reads the inputs.
//
// One row per thing a platform admin looks at each morning, each with a verdict, one line of detail
// and the page that deals with it. A role only gets a check whose page it can open (the admin nav's
// own answer, canOpenAdminHref), so the list can never point at a page the rail does not offer.
// A read that failed is "Couldn't check", never "Clear": a failed count must not read as all-good.

import type { AdminRole } from "../adminAuth/roles.ts";
import { canOpenAdminHref } from "./compose.ts";

export type DailyCheckStatus = "failing" | "look" | "unknown" | "info" | "clear";
export type DailyCheckArea = "Money" | "Customers" | "Platform" | "Security";

export type DailyCheck = {
  key: string;
  area: DailyCheckArea;
  title: string;
  status: DailyCheckStatus;
  detail: string;
  href: string;
  actionLabel: string;
};

/** Every input is null when its read failed. */
export type DailyCheckInput = {
  now: number;
  stuckWebhooks: { count: number; oldestReceivedAt: string | null; lastError: string | null } | null;
  billingRun: { healthy: boolean; description: string } | null;
  pastDue: number | null;
  overdueInvoices: number | null;
  mismatchedInvoices: number | null;
  /** Trials ending within TRIAL_CHASE_DAYS. */
  trialsEnding: Array<{ tenantName: string; daysRemaining: number; hasPaymentMethod: boolean }> | null;
  newSignups24h: number | null;
  cancellations24h: number | null;
  seatLimited: Array<{ tenantName: string; used: number; max: number }> | null;
  suspendedTenants: number | null;
  signIns: { today: number; failedToday: number } | null;
  staleInvitations: number | null;
  failingSources: Array<{ name: string }> | null;
  snapshot: { date: string | null; ageDays: number | null } | null;
  maintenance: { level: "off" | "banner_only" | "read_only" | "locked" } | null;
  featuresOff: number | null;
  staffChangesToday: number | null;
};

/** The order a morning read wants: what is broken, then what to look at, then what is fine. */
export const STATUS_ORDER: Record<DailyCheckStatus, number> = { failing: 0, look: 1, unknown: 2, info: 3, clear: 4 };

/** A webhook unprocessed this long is failing, not queued (as the staff alerts, lib/adminAlerts). */
export const WEBHOOK_STUCK_MINUTES = 10;
/** Trials this close to their end are worth a call, more so with no card on file. */
export const TRIAL_CHASE_DAYS = 2;
/** More failed sign-ins than this in a day is worth a look (credential stuffing, a broken SSO). */
export const FAILED_SIGNIN_LOOK = 25;
/** The nightly metrics snapshot is late once it is older than this. */
export const SNAPSHOT_LATE_DAYS = 1;

const n = (value: number) => value.toLocaleString("en-US");
const plural = (count: number, one: string, many = `${one}s`) => `${n(count)} ${count === 1 ? one : many}`;
const names = (rows: Array<{ name?: string; tenantName?: string }>, max = 3) => {
  const list = rows.slice(0, max).map((row) => row.name ?? row.tenantName ?? "").filter(Boolean);
  const more = rows.length - list.length;
  return more > 0 ? `${list.join(", ")} and ${n(more)} more` : list.join(", ");
};
const COULD_NOT = "Couldn't read this just now. Refresh, or open the page.";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Raw ISO timestamps in a detail (the billing heartbeat's description, a webhook error) as
 * "13 Sep 2026, 04:52 UTC". Hand-built month names: Intl's short months differ between this Node and
 * browsers. Exported for the tests.
 */
export function readableTimes(text: string): string {
  return text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, (match) => {
    const date = new Date(match);
    if (Number.isNaN(date.getTime())) return match;
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
  });
}

/** "12 minutes", "5 hours", "29 days": a wait in the unit a reader takes in at a glance. Exported for the tests. */
export function waited(minutes: number): string {
  if (minutes < 90) return plural(minutes, "minute");
  if (minutes < 48 * 60) return plural(Math.round(minutes / 60), "hour");
  return plural(Math.round(minutes / 1440), "day");
}

function minutesSince(iso: string, now: number) {
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
}

/** Every check, before the role filter. Exported for the tests. */
export function allDailyChecks(input: DailyCheckInput): DailyCheck[] {
  const { now } = input;
  const checks: DailyCheck[] = [];
  const push = (check: DailyCheck) => checks.push(check);

  /* ── Money ── */
  const webhooks = input.stuckWebhooks;
  const webhookAge = webhooks?.oldestReceivedAt ? minutesSince(webhooks.oldestReceivedAt, now) : 0;
  push({
    key: "webhooks", area: "Money", title: "Payment events processed", href: "/admin/payments", actionLabel: "Open payments",
    ...(webhooks === null
      ? { status: "unknown", detail: COULD_NOT }
      : webhooks.count === 0
        ? { status: "clear", detail: "Every payment-provider event has been processed." }
        : webhookAge >= WEBHOOK_STUCK_MINUTES
          ? { status: "failing", detail: `${plural(webhooks.count, "event")} waiting, the oldest for ${waited(webhookAge)}.${webhooks.lastError ? ` Last error: ${webhooks.lastError.slice(0, 120)}` : ""}` }
          : { status: "clear", detail: `${plural(webhooks.count, "event")} in the queue, arriving now.` }),
  });
  push({
    key: "billing-run", area: "Money", title: "Billing run", href: "/admin/invoices", actionLabel: "Open invoices",
    ...(input.billingRun === null
      ? { status: "unknown", detail: COULD_NOT }
      : { status: input.billingRun.healthy ? "clear" : "failing", detail: input.billingRun.description }),
  });
  push({
    key: "past-due", area: "Money", title: "Failed payments (past due)", href: "/admin/subscriptions?status=past_due", actionLabel: "Open past due",
    ...(input.pastDue === null
      ? { status: "unknown", detail: COULD_NOT }
      : input.pastDue === 0
        ? { status: "clear", detail: "No customer is behind on a payment." }
        : { status: "look", detail: `${plural(input.pastDue, "customer")} past due — card declined or expired.` }),
  });
  push({
    key: "overdue", area: "Money", title: "Overdue invoices", href: "/admin/invoices", actionLabel: "Open invoices",
    ...(input.overdueInvoices === null
      ? { status: "unknown", detail: COULD_NOT }
      : input.overdueInvoices === 0
        ? { status: "clear", detail: "No invoice is past its due date." }
        : { status: "look", detail: `${plural(input.overdueInvoices, "invoice")} past due date.` }),
  });
  push({
    key: "mismatched", area: "Money", title: "Invoices that don't reconcile", href: "/admin/invoices", actionLabel: "Open invoices",
    ...(input.mismatchedInvoices === null
      ? { status: "unknown", detail: COULD_NOT }
      : input.mismatchedInvoices === 0
        ? { status: "clear", detail: "Every invoice matches what the payment provider charged." }
        : { status: "look", detail: `${plural(input.mismatchedInvoices, "invoice")} differ from the provider's record.` }),
  });
  const trials = input.trialsEnding;
  const noCard = trials?.filter((trial) => !trial.hasPaymentMethod) ?? [];
  push({
    key: "trials", area: "Money", title: `Trials ending within ${TRIAL_CHASE_DAYS} days`, href: "/admin/trials", actionLabel: "Open trials",
    ...(trials === null
      ? { status: "unknown", detail: COULD_NOT }
      : trials.length === 0
        ? { status: "clear", detail: "No trial ends in the next two days." }
        : noCard.length > 0
          ? { status: "look", detail: `${plural(trials.length, "trial")} ending; ${n(noCard.length)} with no card on file: ${names(noCard)}.` }
          : { status: "info", detail: `${plural(trials.length, "trial")} ending, all with a card on file.` }),
  });

  /* ── Customers ── */
  push({
    key: "signups", area: "Customers", title: "New sign-ups (last 24 hours)", href: "/admin/tenants", actionLabel: "Open customers",
    ...(input.newSignups24h === null
      ? { status: "unknown", detail: COULD_NOT }
      : { status: "info", detail: input.newSignups24h === 0 ? "No new workspace in the last 24 hours." : `${plural(input.newSignups24h, "new workspace")} in the last 24 hours.` }),
  });
  push({
    key: "cancellations", area: "Customers", title: "Cancellations (last 24 hours)", href: "/admin/subscriptions", actionLabel: "Open subscriptions",
    ...(input.cancellations24h === null
      ? { status: "unknown", detail: COULD_NOT }
      : input.cancellations24h === 0
        ? { status: "clear", detail: "Nobody cancelled in the last 24 hours." }
        : { status: "look", detail: `${plural(input.cancellations24h, "subscription")} cancelled in the last 24 hours.` }),
  });
  push({
    key: "seats", area: "Customers", title: "Customers at their seat limit", href: "/admin/tenants", actionLabel: "Open customers",
    ...(input.seatLimited === null
      ? { status: "unknown", detail: COULD_NOT }
      : input.seatLimited.length === 0
        ? { status: "clear", detail: "Every customer has room to add a user." }
        : { status: "look", detail: `${plural(input.seatLimited.length, "customer")} can't add a user: ${names(input.seatLimited)}.` }),
  });
  push({
    key: "suspended", area: "Customers", title: "Suspended customers", href: "/admin/tenants", actionLabel: "Open customers",
    ...(input.suspendedTenants === null
      ? { status: "unknown", detail: COULD_NOT }
      : input.suspendedTenants === 0
        ? { status: "clear", detail: "No customer is suspended." }
        : { status: "info", detail: `${plural(input.suspendedTenants, "customer")} suspended.` }),
  });
  push({
    key: "invitations", area: "Customers", title: "Invitations nobody accepted", href: "/admin/users", actionLabel: "Open users",
    ...(input.staleInvitations === null
      ? { status: "unknown", detail: COULD_NOT }
      : input.staleInvitations === 0
        ? { status: "clear", detail: "No invitation has been left waiting." }
        : { status: "look", detail: `${plural(input.staleInvitations, "invited user")} never accepted — resend or remove.` }),
  });

  /* ── Security ── */
  const signIns = input.signIns;
  push({
    key: "signins", area: "Security", title: "Failed sign-ins today", href: "/admin/activity", actionLabel: "Open activity",
    ...(signIns === null
      ? { status: "unknown", detail: COULD_NOT }
      : { status: signIns.failedToday > FAILED_SIGNIN_LOOK ? "look" : "clear", detail: `${n(signIns.failedToday)} failed of ${n(signIns.today + signIns.failedToday)} sign-in attempts today.` }),
  });
  push({
    key: "staff-changes", area: "Security", title: "Staff changes today", href: "/admin/audit-log", actionLabel: "Open audit log",
    ...(input.staffChangesToday === null
      ? { status: "unknown", detail: COULD_NOT }
      : { status: "info", detail: input.staffChangesToday === 0 ? "No change recorded in the audit log today." : `${plural(input.staffChangesToday, "change")} recorded in the audit log today.` }),
  });

  /* ── Platform ── */
  push({
    key: "compliance", area: "Platform", title: "Compliance sources (DNC, consent)", href: "/admin/compliance-sources", actionLabel: "Open sources",
    ...(input.failingSources === null
      ? { status: "unknown", detail: COULD_NOT }
      : input.failingSources.length === 0
        ? { status: "clear", detail: "Every enabled source answered in the last hour." }
        : { status: "failing", detail: `${plural(input.failingSources.length, "source")} not answering — dial checks may block: ${names(input.failingSources)}.` }),
  });
  const snapshot = input.snapshot;
  push({
    key: "metrics", area: "Platform", title: "Nightly metrics", href: "/admin/revenue", actionLabel: "Open revenue",
    ...(snapshot === null
      ? { status: "unknown", detail: COULD_NOT }
      : snapshot.date === null
        ? { status: "failing", detail: "No metrics snapshot has ever been computed." }
        : (snapshot.ageDays ?? 0) > SNAPSHOT_LATE_DAYS
          ? { status: "failing", detail: `Last computed ${snapshot.date} — ${plural(snapshot.ageDays ?? 0, "day")} old. Revenue figures are stale.` }
          : { status: "clear", detail: `Up to date (${snapshot.date}).` }),
  });
  const maintenance = input.maintenance;
  push({
    key: "maintenance", area: "Platform", title: "Maintenance mode", href: "/admin/system", actionLabel: "Open system",
    ...(maintenance === null
      ? { status: "unknown", detail: COULD_NOT }
      : maintenance.level === "off"
        ? { status: "clear", detail: "Off — customers have the full product." }
        : maintenance.level === "banner_only"
          ? { status: "info", detail: "A maintenance banner is showing to customers." }
          : { status: "look", detail: `On (${maintenance.level === "read_only" ? "read only" : "locked"}) — customers can't work normally. Turn it off when you are done.` }),
  });
  push({
    key: "features", area: "Platform", title: "Features switched off", href: "/admin/features", actionLabel: "Open features",
    ...(input.featuresOff === null
      ? { status: "unknown", detail: COULD_NOT }
      : input.featuresOff === 0
        ? { status: "clear", detail: "No feature is switched off." }
        : { status: "info", detail: `${plural(input.featuresOff, "feature")} switched off for everyone.` }),
  });

  return checks.map((check) => ({ ...check, detail: readableTimes(check.detail) }));
}

/** The role's checks, worst first; within a status, in the order above (Money, Customers, Security, Platform). */
export function dailyChecksFor(role: AdminRole, input: DailyCheckInput): DailyCheck[] {
  return allDailyChecks(input)
    .map((check, index) => ({ check, index }))
    .filter(({ check }) => canOpenAdminHref(role, check.href))
    .sort((a, b) => STATUS_ORDER[a.check.status] - STATUS_ORDER[b.check.status] || a.index - b.index)
    .map(({ check }) => check);
}

/** "2 failing · 3 to look at · 11 clear" — the card's one-line summary. */
export function dailySummary(checks: DailyCheck[]): string {
  const count = (status: DailyCheckStatus) => checks.filter((check) => check.status === status).length;
  const parts = [
    count("failing") ? `${n(count("failing"))} failing` : null,
    count("look") ? `${n(count("look"))} to look at` : null,
    count("unknown") ? `${n(count("unknown"))} couldn't be checked` : null,
    `${n(count("clear") + count("info"))} fine`,
  ];
  return parts.filter(Boolean).join(" · ");
}
