import "server-only";

import { processUnclaimedSla } from "./service";
import { alertUnclaimedSlaOperator, recordUnclaimedSlaRun } from "./monitor";

export async function runUnclaimedSlaJob() {
  try {
    const report = await processUnclaimedSla();
    if (report.failures.length) {
      await recordUnclaimedSlaRun({ status: "failed", report });
      const eventKey = report.failures.map((failure) => failure.eventId).sort().join(":").slice(0, 500) || new Date().toISOString().slice(0, 16);
      const operatorAlert = await alertUnclaimedSlaOperator({ reason: "failed", detail: `${report.failures.length} SLA side effect(s) failed. The durable events remain available for retry.`, dedupeKey: `run:${eventKey}` });
      return { ok: false as const, status: 503, body: { ...report, operatorAlert } };
    }
    await recordUnclaimedSlaRun({ status: "succeeded", report });
    return { ok: true as const, status: 200, body: report };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scheduler failure";
    try { await recordUnclaimedSlaRun({ status: "failed", error: message }); }
    catch (heartbeatError) { console.error("Unclaimed SLA failure heartbeat could not be recorded", heartbeatError); }
    const bucket = new Date().toISOString().slice(0, 16);
    const operatorAlert = await alertUnclaimedSlaOperator({ reason: "failed", detail: message.slice(0, 1000), dedupeKey: `exception:${bucket}` });
    return { ok: false as const, status: 503, body: { error: "Unclaimed lead SLA could not be processed.", operatorAlert } };
  }
}
