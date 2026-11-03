// Is the period billing run actually running? (backlog 24)
//
// "A job that silently never runs still looks identical to a healthy one" is the whole of #24, and
// it is worse here than for most jobs. An unrun billing job does not throw, does not queue, and
// does not leave a trace — it simply means nobody is invoiced. Add-ons go unbilled, overage is
// free, and a mid-period upgrade's difference sits in pending_charges forever. The first signal
// under the old arrangement would have been a customer noticing they were undercharged.
//
// So health is judged two ways, and a run is healthy only if both agree:
//
//   the job ran            an age check on the last recorded run, the same shape the unclaimed-SLA
//                          scheduler uses. Catches a scheduler that has stopped being invoked at
//                          all — a missing CRON_SECRET, a deployment that dropped vercel.json.
//
//   nothing is unbilled    the condition #24 actually names: "no row in the last N days for a
//                          subscription whose period has ended". Catches the worse failure, where
//                          the job runs on schedule and fails on every subscription. The age check
//                          alone would call that healthy, because something did run.
//
// The second is the one worth having. A job that runs and bills nobody is indistinguishable from a
// job that runs and has nobody to bill, unless you look at who was due.
//
// Pure: no database, no clock, no network. Everything here is decided from values the caller read,
// so every branch is unit-tested rather than reasoned about.

export type BillingHeartbeatReason =
  | "ok"
  | "never_run"
  | "stale"
  | "last_run_failed"
  | "subscriptions_unbilled";

export type BillingHeartbeat = {
  healthy: boolean;
  reason: BillingHeartbeatReason;
  lastRunAt: string | null;
  ageSeconds: number | null;
  /** Subscriptions whose period ended long enough ago that a healthy job would have billed them. */
  unbilledCount: number;
  lastReport: unknown;
};

export type BillingRunRow = {
  action: string;
  metadata: unknown;
  created_at: string;
};

export const BILLING_RUN_SUCCEEDED = "system.period_billing_run_succeeded";
export const BILLING_RUN_FAILED = "system.period_billing_run_failed";

/**
 * Decide whether the billing job is healthy.
 *
 * `unbilledCount` is how many subscriptions have an ended period with no ledger row and are past
 * the grace window — computed by the caller, because it is a query, and passed in as a number so
 * the decision itself stays testable.
 *
 * Order of the checks is deliberate. "Never run" and "the last run failed" are reported ahead of
 * unbilled subscriptions because they explain them: telling an operator that 40 subscriptions are
 * unbilled is less useful than telling them the job has never run, which is why.
 */
export function billingHeartbeatState(input: {
  row: BillingRunRow | null;
  nowMs: number;
  maxAgeSeconds: number;
  unbilledCount: number;
}): BillingHeartbeat {
  const { row, nowMs, maxAgeSeconds, unbilledCount } = input;

  if (!row) {
    return {
      healthy: false,
      reason: "never_run",
      lastRunAt: null,
      ageSeconds: null,
      unbilledCount,
      lastReport: null,
    };
  }

  const runMs = Date.parse(row.created_at);
  const ageSeconds = Number.isFinite(runMs)
    ? Math.max(0, Math.floor((nowMs - runMs) / 1000))
    : Number.POSITIVE_INFINITY;

  const base = { lastRunAt: row.created_at, ageSeconds, unbilledCount, lastReport: row.metadata };

  if (row.action === BILLING_RUN_FAILED) {
    return { healthy: false, reason: "last_run_failed", ...base };
  }
  if (ageSeconds > maxAgeSeconds) {
    return { healthy: false, reason: "stale", ...base };
  }
  // Ran, recently, reported success — and still left subscriptions unbilled. This is the state the
  // age check cannot see, and the reason this function takes two inputs instead of one.
  if (unbilledCount > 0) {
    return { healthy: false, reason: "subscriptions_unbilled", ...base };
  }

  return { healthy: true, reason: "ok", ...base };
}

/** How the operator alert describes each way of being unhealthy. */
export function describeBillingHeartbeat(heartbeat: BillingHeartbeat): string {
  switch (heartbeat.reason) {
    case "never_run":
      return "The period billing run has never recorded a run. No customer is being invoiced for add-ons, overage or proration.";
    case "stale":
      return `The period billing run last completed ${heartbeat.lastRunAt}, which is longer ago than the configured window. Invoices are not being raised.`;
    case "last_run_failed":
      return `The period billing run failed on its last attempt (${heartbeat.lastRunAt}). The periods it did not bill remain unbilled and will be retried.`;
    case "subscriptions_unbilled":
      return `The period billing run completed at ${heartbeat.lastRunAt} but ${heartbeat.unbilledCount} subscription(s) whose period has ended still have no billing record. The job is running and not billing.`;
    case "ok":
      return "The period billing run is healthy.";
  }
}
