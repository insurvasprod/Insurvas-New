/**
 * The staff bar's feed (p-nav-admin), from state the platform already keeps.
 *
 *   ALERTS are wrong with the platform right now and clear when fixed: payment-provider webhooks
 *   not being processed, a compliance source failing, maintenance switched on, the period billing
 *   run unhealthy, subscriptions past due, a customer at its seat limit. Each is computed on read
 *   from the table that holds the state — nothing is stored, so nothing can go stale.
 *
 *   NOTIFICATIONS are events addressed to billing staff and clear when read: a trial about to end
 *   with no card on file, a plan change, a cancellation, an early conversion. They come from the
 *   trials view and the audit log; only the read marks are stored (admin_notification_reads).
 *
 * Every item is gated by the page its action opens, so nobody is shown an alert they cannot act on.
 * Pure, so the rules are tested; `service.ts` reads the rows.
 */

export type StaffRole = "super_admin" | "support_agent" | "billing_admin" | "platform_config";

export type StaffAlert = { id: string; title: string; body: string; link: string; actionLabel: string; severity: "critical" | "warning" };
export type StaffNotification = { id: string; title: string; body: string; link: string; created_at: string; tone: "accent" | "success" | "warning" | "muted" };

export const BILLING_ROLES: readonly StaffRole[] = ["super_admin", "billing_admin"];
export const PAYMENTS_ROLES: readonly StaffRole[] = ["super_admin"];
export const PLATFORM_ROLES: readonly StaffRole[] = ["super_admin", "platform_config"];

/** A webhook still unprocessed this long after it arrived is failing, not queued. */
export const WEBHOOK_STUCK_MINUTES = 10;
/** A trial this close to its end with no card on file is worth somebody's attention. */
export const TRIAL_ENDING_WINDOW_DAYS = 14;
export const STAFF_NOTIFICATION_WINDOW_DAYS = 7;
/** More than this many tenants at their limit becomes one summary alert rather than a list. */
export const SEAT_ALERT_MAX_ROWS = 3;

const DAY_MS = 86_400_000;

function minutesSince(iso: string, now: number) {
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
}

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

export type StaffAlertInput = {
  role: StaffRole;
  now: number;
  /** Webhook rows received but not processed. */
  stuckWebhooks: { count: number; oldestReceivedAt: string | null; lastError: string | null } | null;
  failingSources: Array<{ name: string; failures24h: number; lastSuccessAt: string | null }> | null;
  maintenance: { level: "off" | "banner_only" | "read_only" | "locked"; message: string | null } | null;
  billingRun: { healthy: boolean; description: string } | null;
  pastDueCount: number | null;
  seatLimited: Array<{ tenantId: string; tenantName: string; used: number; max: number; pendingInvites: number }> | null;
};

/** Most severe first; within a severity, in the order the checks are listed above. */
export function buildStaffAlerts(input: StaffAlertInput): StaffAlert[] {
  const { role, now } = input;
  const can = (roles: readonly StaffRole[]) => roles.includes(role);
  const alerts: StaffAlert[] = [];

  const webhooks = input.stuckWebhooks;
  if (can(PAYMENTS_ROLES) && webhooks && webhooks.count > 0 && webhooks.oldestReceivedAt && minutesSince(webhooks.oldestReceivedAt, now) >= WEBHOOK_STUCK_MINUTES) {
    alerts.push({
      id: "webhooks-stuck",
      title: "Webhook failing",
      body: `Payment-provider events have not been processed for ${minutesSince(webhooks.oldestReceivedAt, now)} minutes. ${plural(webhooks.count, "event is", "events are")} waiting.${webhooks.lastError ? ` Last error: ${webhooks.lastError.slice(0, 140)}` : ""}`,
      link: "/admin/payments",
      actionLabel: "Open payments",
      severity: "critical",
    });
  }

  if (can(PLATFORM_ROLES)) {
    for (const source of input.failingSources ?? []) {
      const since = source.lastSuccessAt ? `Last success ${minutesSince(source.lastSuccessAt, now)} minutes ago.` : "It has never succeeded.";
      alerts.push({
        id: `source-${source.name}`,
        title: "Scrub failing",
        body: `${source.name} has failed ${plural(source.failures24h, "time")} in the last 24 hours. ${since}`,
        link: "/admin/compliance-sources",
        actionLabel: "Open compliance sources",
        severity: "critical",
      });
    }
  }

  if (can(BILLING_ROLES) && input.billingRun && !input.billingRun.healthy) {
    alerts.push({ id: "billing-run", title: "Billing run unhealthy", body: input.billingRun.description, link: "/admin/invoices", actionLabel: "Open invoices", severity: "critical" });
  }

  const maintenance = input.maintenance;
  if (can(PLATFORM_ROLES) && maintenance && maintenance.level !== "off") {
    const label = { banner_only: "A maintenance banner is showing", read_only: "Every workspace is read-only", locked: "Every workspace is locked" }[maintenance.level];
    alerts.push({
      id: `maintenance-${maintenance.level}`,
      title: "Maintenance is on",
      body: `${label}.${maintenance.message ? ` “${maintenance.message.slice(0, 140)}”` : ""}`,
      link: "/admin/system",
      actionLabel: "Open system",
      severity: maintenance.level === "banner_only" ? "warning" : "critical",
    });
  }

  if (can(BILLING_ROLES) && input.pastDueCount && input.pastDueCount > 0) {
    alerts.push({
      id: "past-due",
      title: "Payments failing",
      body: `${plural(input.pastDueCount, "subscription is", "subscriptions are")} past due after a failed payment.`,
      link: "/admin/subscriptions?status=past_due",
      actionLabel: "Open subscriptions",
      severity: "warning",
    });
  }

  const seats = input.seatLimited ?? [];
  if (seats.length > SEAT_ALERT_MAX_ROWS) {
    alerts.push({ id: "seats-many", title: "Seat limits reached", body: `${seats.length} customers are at or over their plan's seat limit.`, link: "/admin/tenants", actionLabel: "Open tenants", severity: "warning" });
  } else {
    for (const tenant of seats) {
      const invites = tenant.pendingInvites ? ` and has ${plural(tenant.pendingInvites, "pending invite")}` : "";
      alerts.push({
        id: `seats-${tenant.tenantId}`,
        title: "Seat limit reached",
        body: `${tenant.tenantName} is at ${tenant.used} of ${tenant.max} seats${invites}.`,
        link: `/admin/tenants/${tenant.tenantId}`,
        actionLabel: "Open tenant",
        severity: "warning",
      });
    }
  }

  return alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
}

export type StaffEventInput = {
  role: StaffRole;
  now: number;
  trials: Array<{ subscriptionId: string; tenantId: string; tenantName: string; trialEndsAt: string; startedAt: string; daysRemaining: number; hasPaymentMethod: boolean }>;
  audit: Array<{ id: string; action: string; ts: string; tenantId: string | null; tenantName: string | null; fromPlan?: string | null; toPlan?: string | null; appliedNow?: boolean | null; reason?: string | null }>;
  readKeys: ReadonlySet<string>;
};

/** Newest first. Every id is a stable source key, so a read mark survives the next poll. */
export function buildStaffNotifications(input: StaffEventInput): StaffNotification[] {
  if (!BILLING_ROLES.includes(input.role)) return [];
  const since = input.now - STAFF_NOTIFICATION_WINDOW_DAYS * DAY_MS;
  const out: StaffNotification[] = [];

  for (const trial of input.trials) {
    if (trial.hasPaymentMethod || trial.daysRemaining < 0 || trial.daysRemaining > TRIAL_ENDING_WINDOW_DAYS) continue;
    // When it entered the window: that is the event, and it is the same on every read.
    const entered = Math.max(new Date(trial.trialEndsAt).getTime() - TRIAL_ENDING_WINDOW_DAYS * DAY_MS, new Date(trial.startedAt).getTime());
    out.push({
      id: `trial-ending:${trial.subscriptionId}:${trial.trialEndsAt}`,
      title: "Trial ending",
      body: `${trial.tenantName}’s trial ends ${trial.daysRemaining === 0 ? "today" : `in ${plural(trial.daysRemaining, "day")}`} with no card on file.`,
      link: `/admin/tenants/${trial.tenantId}`,
      created_at: new Date(Math.min(entered, input.now)).toISOString(),
      tone: "accent",
    });
  }

  for (const row of input.audit) {
    if (new Date(row.ts).getTime() < since) continue;
    const who = row.tenantName ?? "A customer";
    const link = row.tenantId ? `/admin/tenants/${row.tenantId}` : "/admin/subscriptions";
    if (row.action === "subscription.plan_changed") {
      const change = row.fromPlan && row.toPlan ? ` ${row.fromPlan} → ${row.toPlan}` : "";
      out.push({ id: `audit:${row.id}`, title: "Plan change", body: `${who} moved${change}.${row.appliedNow === false ? " It takes effect at the end of the period." : ""}`, link, created_at: row.ts, tone: "muted" });
    } else if (row.action === "subscription.cancelled") {
      out.push({ id: `audit:${row.id}`, title: "Subscription cancelled", body: `${who} was cancelled.${row.reason ? ` Reason: ${row.reason.slice(0, 120)}` : ""}`, link, created_at: row.ts, tone: "warning" });
    } else if (row.action === "trial.converted_early") {
      out.push({ id: `audit:${row.id}`, title: "Trial converted", body: `${who} converted to a paid plan before the trial ended.`, link, created_at: row.ts, tone: "success" });
    }
  }

  return out
    .filter((item) => !input.readKeys.has(item.id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** The audit actions the notifications read. */
export const STAFF_NOTIFICATION_ACTIONS = ["subscription.plan_changed", "subscription.cancelled", "trial.converted_early"] as const;
