import "server-only";

// The scheduled period billing job (backlog 24).
//
// Bills every subscription whose period has ended, records that it happened, and tells an operator
// when it did not. This is what SA-6.1 was going to schedule and what #24 says has been missing:
// npm run bill:periods did the whole rollover correctly, but only when a human remembered.
//
// Deliberately does NOT advance billing periods.
//
// That is not an omission, it is the ordering rule from gather.ts made structural. Usage is keyed
// by period_start, so billing after the roll would charge every customer for zero overage, every
// time, and look perfectly healthy doing it. scripts/run-period-billing.mjs does both in the right
// order in one process, where the ordering can be guaranteed. A web request that rolled every
// subscription's period is a much larger and less reversible act than "bill what is due", and the
// cron hitting a timeout halfway through it is the way to get the two out of step permanently.
//
// So the cron bills, and the roll stays with the command that can guarantee its own ordering. A
// subscription whose period has ended but not rolled is simply billed once and then found already
// billed — the ledger's primary key makes repetition free.

import { runPeriodBilling } from "./periodRun";
import {
  recordPeriodBillingRun,
  alertBillingOperator,
  getPeriodBillingHeartbeat,
  describeBillingHeartbeat,
} from "./monitor";

export async function runPeriodBillingJob() {
  try {
    const outcomes = await runPeriodBilling();

    const raised = outcomes.filter((outcome) => outcome.invoiceId);
    const failures = outcomes
      .filter((outcome) => outcome.error)
      .map((outcome) => ({ subscriptionId: outcome.subscriptionId, error: outcome.error as string }));

    const report = {
      considered: outcomes.length,
      invoicesRaised: raised.length,
      totalCents: raised.reduce((sum, outcome) => sum + outcome.totalCents, 0),
      creditAppliedCents: outcomes.reduce((sum, outcome) => sum + outcome.creditAppliedCents, 0),
      waivedCents: outcomes.reduce((sum, outcome) => sum + outcome.waivedCents, 0),
      failures,
      // An invoice raised but not sent is money nobody has been asked for. It is not a failed run
      // — the invoice exists and can be settled by transfer — but it must be visible in the
      // record, because the alternative is discovering it at the next reconciliation.
      uncollected: outcomes
        .filter((outcome) => outcome.invoiceId && outcome.collectionWarning)
        .map((outcome) => ({ invoiceNumber: outcome.invoiceNumber, warning: outcome.collectionWarning as string })),
    };

    if (failures.length) {
      await recordPeriodBillingRun({ status: "failed", report });
      const key = failures.map((failure) => failure.subscriptionId).sort().join(":").slice(0, 500)
        || new Date().toISOString().slice(0, 16);
      const operatorAlert = await alertBillingOperator({
        reason: "failed",
        detail: `${failures.length} subscription(s) could not be billed. Their periods remain unbilled and the next run will retry them. First error: ${failures[0].error}`,
        dedupeKey: `run:${key}`,
      });
      return { ok: false as const, status: 503, body: { ...report, operatorAlert } };
    }

    await recordPeriodBillingRun({ status: "succeeded", report });
    return { ok: true as const, status: 200, body: report };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown billing scheduler failure";
    try {
      await recordPeriodBillingRun({ status: "failed", error: message });
    } catch (heartbeatError) {
      console.error("The period billing failure heartbeat could not be recorded", heartbeatError);
    }
    const bucket = new Date().toISOString().slice(0, 16);
    const operatorAlert = await alertBillingOperator({
      reason: "failed",
      detail: message.slice(0, 1000),
      dedupeKey: `exception:${bucket}`,
    });
    return { ok: false as const, status: 503, body: { error: "The period billing run could not be completed.", operatorAlert } };
  }
}

/**
 * Read the heartbeat, and alert if it is unhealthy.
 *
 * Separate from the run itself, because the failure this exists to catch is the job not being
 * invoked at all — which no amount of code inside the job can report. Something outside it has to
 * ask.
 */
export async function checkPeriodBillingHeartbeat(maxAgeSeconds: number) {
  const heartbeat = await getPeriodBillingHeartbeat(maxAgeSeconds);
  if (heartbeat.healthy) return { status: 200 as const, body: { heartbeat } };

  // Bucketed by hour so a genuinely dead scheduler produces one alert an hour rather than one per
  // check, and still produces a fresh one tomorrow.
  const bucket = heartbeat.lastRunAt?.slice(0, 13) ?? new Date().toISOString().slice(0, 13);
  const operatorAlert = await alertBillingOperator({
    reason: heartbeat.reason,
    detail: describeBillingHeartbeat(heartbeat),
    dedupeKey: `heartbeat:${heartbeat.reason}:${bucket}`,
  });

  return { status: 503 as const, body: { heartbeat, operatorAlert } };
}
