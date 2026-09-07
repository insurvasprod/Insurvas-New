import test from "node:test";
import assert from "node:assert/strict";
import { coalesceAlertBatch, eventTypeForKind } from "./presentation.ts";

test("maps durable notification kinds to independent alert settings", () => {
  assert.equal(eventTypeForKind("new_unclaimed_lead"), "new_lead");
  assert.equal(eventTypeForKind("handoff_offered"), "handoff_offered");
  assert.equal(eventTypeForKind("unclaimed_sla_escalation"), "unclaimed_escalation");
  assert.equal(eventTypeForKind("callback_reminder"), "callback_due");
  assert.equal(eventTypeForKind("lead_note_mention"), "mentioned");
  assert.equal(eventTypeForKind("partner_message"), "partner_message");
  assert.equal(eventTypeForKind("unknown"), null);
});

test("a burst of alerts is delivered as one sound batch", () => {
  const alerts = [{ id: "1" }, { id: "2" }, { id: "3" }];
  const result = coalesceAlertBatch(alerts);
  assert.deepEqual(result.alerts, alerts);
  assert.equal(result.playSound, true);
  assert.equal(coalesceAlertBatch([]).playSound, false);
});
