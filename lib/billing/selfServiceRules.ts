// Client-safe. LA-8.5 (Notion sprint, Module 8 — Settings) · the rules the Plan & billing screen
// draws by. Pure, and tested in selfService.test.mjs.
//
// What is NOT here, by the spec: prices, proration and entitlements. Those are SA-2/SA-3's
// (lib/billing/planChange.ts previews and settles a change, lib/subscriptions/proration.ts does the
// arithmetic, refresh_tenant_entitlement decides access). This file only says how to show them.

import type { SubscriptionStatus } from "@/lib/subscriptions/access";

/** The second warning tier. The first is the platform's usage.warn_percent (80 unless staff change it). */
export const USAGE_CRITICAL_FRACTION = 0.95;

export type UsageTier = "ok" | "warning" | "critical" | "full" | "over";

/**
 * Where a limit stands. `full` is exactly at it (a hard-capped meter has stopped, nothing exceeded),
 * `over` past it. Unlimited is never warned about.
 */
export function usageTier(used: number, limit: number | null, warnFraction: number): UsageTier {
  if (limit === null) return "ok";
  if (used > limit) return "over";
  if (limit > 0 && used === limit) return "full";
  if (limit <= 0) return used > 0 ? "over" : "ok";
  if (used >= limit * USAGE_CRITICAL_FRACTION) return "critical";
  if (used >= limit * warnFraction) return "warning";
  return "ok";
}

/** A tier the screen warns about — each of these shows the upgrade next to it. */
export function tierWarns(tier: UsageTier): boolean {
  return tier !== "ok";
}

/**
 * Whop retries a failed card for five days and then cancels the membership, which our webhook turns
 * into `suspended` (read-only). Whop's docs: "If the payment still fails after five days, Whop
 * automatically cancels the subscription." A past-due agency is told the date that happens.
 */
export const PROVIDER_RETRY_DAYS = 5;

/**
 * The retry schedule, as Whop reports it. Each `payment.failed` since the last success is one
 * attempt (the first is the failure itself, the rest are retries already made), and its payment
 * carries `next_payment_attempt` — when Whop will charge again. Whop publishes no fixed ladder (only
 * "over a five-day period"), so the dates come from its events, never from a formula here.
 */
export type ProviderFailure = { at: string; nextAttemptAt: string | null };

export type RetrySchedule = { failedAt: string | null; triedAgainOn: string[]; nextRetryAt: string | null };

export function retrySchedule(failures: readonly ProviderFailure[], now: number = Date.now()): RetrySchedule {
  const ordered = [...failures].filter((f) => !Number.isNaN(Date.parse(f.at))).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (!ordered.length) return { failedAt: null, triedAgainOn: [], nextRetryAt: null };
  // The newest event's own answer wins: an older one may name a retry Whop has since made.
  const latestNext = ordered[ordered.length - 1].nextAttemptAt;
  const next = latestNext && !Number.isNaN(Date.parse(latestNext)) && Date.parse(latestNext) > now ? new Date(Date.parse(latestNext)).toISOString() : null;
  return { failedAt: ordered[0].at, triedAgainOn: ordered.slice(1).map((f) => f.at), nextRetryAt: next };
}

/** `next_payment_attempt` (payments API) or `next_payment_attempt_at` (newer payloads) from a webhook payload's data. */
export function nextAttemptFromPayload(payload: unknown): string | null {
  const data = payload && typeof payload === "object" ? (payload as { data?: unknown }).data : null;
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  for (const key of ["next_payment_attempt", "next_payment_attempt_at"]) {
    const value = record[key];
    if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return value;
    if (typeof value === "number" && Number.isFinite(value)) return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  return null;
}

export type DunningView =
  | { state: "retrying"; failedAt: string | null; triedAgainOn: string[]; nextRetryAt: string | null; accessChangesAt: string | null }
  | { state: "read_only"; since: string | null }
  | null;

/**
 * "Payment failed 3 Oct. Tried again 5 Oct. We will retry on 6 Oct. Access to dialling and
 * applications pauses on 8 Oct." The date access changes is Whop's cancellation, five days after
 * the first failure.
 */
export function dunningView(status: SubscriptionStatus, schedule: RetrySchedule | null, suspendedSince: string | null): DunningView {
  if (status === "past_due") {
    const failedAt = schedule?.failedAt ?? null;
    const changes = failedAt ? new Date(Date.parse(failedAt) + PROVIDER_RETRY_DAYS * 86_400_000).toISOString() : null;
    // A retry Whop names after the cut-off will not happen: the membership is cancelled first.
    const next = schedule?.nextRetryAt && (!changes || Date.parse(schedule.nextRetryAt) < Date.parse(changes)) ? schedule.nextRetryAt : null;
    return { state: "retrying", failedAt, triedAgainOn: schedule?.triedAgainOn ?? [], nextRetryAt: next, accessChangesAt: changes };
  }
  if (status === "suspended") return { state: "read_only", since: suspendedSince };
  return null;
}

/** The last day a cancelled agency can read its records: the cancellation's date plus the window. */
export function retentionEndsAt(cancelEffectiveAt: string, retentionDays: number): string {
  return new Date(Date.parse(cancelEffectiveAt) + retentionDays * 86_400_000).toISOString();
}

export type SelfServeActions = {
  canChangePlan: boolean;
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
  /** Cancelling must first offer a pause — once per subscription, and only where a pause is possible. */
  offerPauseFirst: boolean;
};

/**
 * What the owner can do from each state. Mirrors SA-2's guards (admin_set_subscription_pause_state,
 * admin_cancel_subscription), which still refuse anything outside them — this only keeps the screen
 * from offering it.
 */
export function selfServeActions(status: SubscriptionStatus, pauseOfferedAt: string | null): SelfServeActions {
  const live = status === "trialing" || status === "active" || status === "past_due";
  const canPause = status === "active" || status === "trialing";
  return {
    canChangePlan: live,
    canPause,
    canResume: status === "paused",
    canCancel: live || status === "paused" || status === "suspended",
    offerPauseFirst: canPause && !pauseOfferedAt,
  };
}

/** The words for each state on the screen and the shell's banner. */
export const BILLING_STATE_COPY: Record<SubscriptionStatus, string> = {
  trialing: "On a free trial",
  active: "Active",
  past_due: "Payment failed — retrying",
  suspended: "Read-only: payment stopped",
  paused: "Paused — read-only",
  cancelling: "Cancels at the end of this period",
  cancelled: "Cancelled — read-only",
};
