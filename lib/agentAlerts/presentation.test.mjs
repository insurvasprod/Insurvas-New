import test from "node:test";
import assert from "node:assert/strict";
import { coalesceAlertBatch, eventTypeForKind, leadIdFromAlertLink, partitionAlertRows } from "./presentation.ts";

test("maps durable notification kinds to independent alert settings", () => {
  assert.equal(eventTypeForKind("new_unclaimed_lead"), "new_lead");
  assert.equal(eventTypeForKind("handoff_offered"), "handoff_offered");
  assert.equal(eventTypeForKind("unclaimed_sla_escalation"), "unclaimed_escalation");
  assert.equal(eventTypeForKind("callback_reminder"), "callback_due");
  assert.equal(eventTypeForKind("appointment_reminder"), "callback_due");
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

const LEAD_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEAD_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = Date.parse("2026-09-23T18:00:00Z");
const ago = (minutes) => new Date(NOW - minutes * 60_000).toISOString();

test("the lead id is read from a workspace alert's link and nowhere else", () => {
  assert.equal(leadIdFromAlertLink(`/app/leads/${LEAD_A}`), LEAD_A);
  assert.equal(leadIdFromAlertLink(`/app/leads/${LEAD_A}?tab=notes`), LEAD_A);
  assert.equal(leadIdFromAlertLink("/app/leads"), null);
  assert.equal(leadIdFromAlertLink("/app/floor"), null);
});

test("a workspace alert stays while its lead is unclaimed, however old, and clears once claimed", () => {
  const stale = { id: "1", event_type: "unclaimed_escalation", link: `/app/leads/${LEAD_A}`, created_at: ago(90) };
  const claimed = { id: "2", event_type: "new_lead", link: `/app/leads/${LEAD_B}`, created_at: ago(1) };
  const { live, resolved } = partitionAlertRows([stale, claimed], new Set([LEAD_A]), NOW);
  assert.deepEqual(live.map((row) => row.id), ["1"]);
  assert.deepEqual(resolved.map((row) => row.id), ["2"]);
});

test("a live handoff offer keeps the ten-minute window and is never 'resolved'", () => {
  const fresh = { id: "3", event_type: "handoff_offered", link: `/app/leads/${LEAD_A}`, created_at: ago(2) };
  const stale = { id: "4", event_type: "handoff_offered", link: `/app/leads/${LEAD_A}`, created_at: ago(30) };
  const { live, resolved } = partitionAlertRows([fresh, stale], new Set(), NOW);
  assert.deepEqual(live.map((row) => row.id), ["3"]);
  assert.deepEqual(resolved, []);
});

test("a mention, partner message or callback stays until read, up to the one-day backstop", () => {
  const rows = [
    { id: "7", event_type: "mentioned", link: `/app/leads/${LEAD_A}`, created_at: ago(90) },
    { id: "8", event_type: "partner_message", link: "/app/partner-chat", created_at: ago(30) },
    { id: "9", event_type: "callback_due", link: `/app/leads/${LEAD_A}`, created_at: ago(25 * 60) },
  ];
  const { live, resolved } = partitionAlertRows(rows, new Set(), NOW);
  assert.deepEqual(live.map((row) => row.id), ["7", "8"]);
  assert.deepEqual(resolved, []);
});

test("a workspace alert with no lead in its link falls back to the window rather than staying forever", () => {
  const rows = [
    { id: "5", event_type: "new_lead", link: "/app/floor", created_at: ago(3) },
    { id: "6", event_type: "new_lead", link: "/app/floor", created_at: ago(45) },
  ];
  const { live, resolved } = partitionAlertRows(rows, new Set(), NOW);
  assert.deepEqual(live.map((row) => row.id), ["5"]);
  assert.deepEqual(resolved, []);
});
