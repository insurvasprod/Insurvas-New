import assert from "node:assert/strict";
import test from "node:test";

import { heartbeatState } from "./heartbeat.ts";

test("an absent SLA run is unhealthy", () => {
  assert.deepEqual(heartbeatState(null, Date.UTC(2026, 8, 7, 12), 900), {
    healthy: false,
    reason: "never_run",
    lastRunAt: null,
    ageSeconds: null,
    lastReport: null,
  });
});

test("a recent successful SLA run is healthy", () => {
  const state = heartbeatState({ action: "system.unclaimed_sla_run_succeeded", metadata: { processed: 2 }, created_at: "2026-09-07T11:55:00.000Z" }, Date.UTC(2026, 8, 7, 12), 900);
  assert.equal(state.healthy, true);
  assert.equal(state.reason, "ok");
  assert.equal(state.ageSeconds, 300);
});

test("a stale or failed SLA run is unhealthy", () => {
  assert.equal(heartbeatState({ action: "system.unclaimed_sla_run_succeeded", metadata: {}, created_at: "2026-09-07T11:00:00.000Z" }, Date.UTC(2026, 8, 7, 12), 900).reason, "stale");
  assert.equal(heartbeatState({ action: "system.unclaimed_sla_run_failed", metadata: { error: "boom" }, created_at: "2026-09-07T11:59:00.000Z" }, Date.UTC(2026, 8, 7, 12), 900).reason, "last_run_failed");
});
