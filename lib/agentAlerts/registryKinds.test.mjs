import test from "node:test";
import assert from "node:assert/strict";
import { NOTIFICATION_EVENTS } from "../notifications/events.ts";
import { PROTECTED_ALERT_EVENTS, WORKSPACE_ALERT_EVENTS, eventTypeForKind, partitionAlertRows } from "./presentation.ts";
import { bellFilterChips, bellGroupSummary, bellKindOf, bellToneOf, filterBellItems, groupBellItems } from "./bell.ts";

// The bell shows every in-app row the registry says an event writes. A kind that maps to nothing is
// emailed by the outbox and never seen in the app — the bug this file guards against.

test("every kind registered in lib/notifications/events.ts reaches the bell", () => {
  for (const event of NOTIFICATION_EVENTS) {
    for (const kind of event.kinds) assert.notEqual(eventTypeForKind(kind), null, `${event.key}: ${kind} maps to no bell event`);
  }
});

test("the kinds added after the bell map to their own events", () => {
  assert.equal(eventTypeForKind("servicing_failed"), "servicing_failed");
  assert.equal(eventTypeForKind("reinstatement_closing"), "reinstatement_closing");
  assert.equal(eventTypeForKind("doi_deadline"), "doi_deadline");
  assert.equal(eventTypeForKind("credential_expiring"), "credential_expiring");
  assert.equal(eventTypeForKind("plan_payment_failed"), "plan_payment_failed");
  assert.equal(eventTypeForKind("compliance_monthly"), null);
});

test("the bell's protected events are exactly the registry's protected events", () => {
  const registry = NOTIFICATION_EVENTS.filter((event) => event.is_protected).flatMap((event) => event.kinds.map(eventTypeForKind));
  assert.deepEqual([...registry].sort(), [...PROTECTED_ALERT_EVENTS].sort());
});

test("protected events read as warnings under Action needed; a failed servicing request is a warning of its own", () => {
  for (const event of PROTECTED_ALERT_EVENTS) {
    assert.equal(bellToneOf(event), "warning", event);
    assert.equal(bellKindOf(event), "action_needed", event);
  }
  assert.equal(bellToneOf("servicing_failed"), "warning");
  assert.equal(bellKindOf("servicing_failed"), "servicing");
});

test("the six original kinds keep their tone and grouping", () => {
  assert.equal(bellToneOf("handoff_offered"), "success");
  assert.equal(bellToneOf("callback_due"), "warning");
  assert.equal(bellToneOf("partner_message"), "muted");
  assert.equal(bellToneOf("mentioned"), "accent");
  assert.equal(bellKindOf("handoff_offered"), "handoff");
  assert.equal(bellKindOf("mentioned"), "mention");
  assert.equal(bellKindOf("partner_message"), "partner_message");
  assert.equal(bellKindOf("callback_due"), "callback");
  assert.equal(bellKindOf("new_lead"), "other");
});

test("new kinds are notifications addressed to you, kept until read up to the day backstop", () => {
  const NOW = Date.parse("2026-10-15T12:00:00Z");
  const ago = (minutes) => new Date(NOW - minutes * 60_000).toISOString();
  const rows = [
    { id: "1", event_type: "reinstatement_closing", link: "/app/policies/p1", created_at: ago(300) },
    { id: "2", event_type: "credential_expiring", link: "/app/settings", created_at: ago(25 * 60) },
  ];
  for (const row of rows) assert.equal(WORKSPACE_ALERT_EVENTS.includes(row.event_type), false);
  const { live, resolved } = partitionAlertRows(rows, new Set(), NOW);
  assert.deepEqual(live.map((row) => row.id), ["1"]);
  assert.deepEqual(resolved, []);
});

test("protected items get their own chip and group per link", () => {
  const item = (id, event_type, link, created_at) => ({ id, title: id, body: "", link, event_type, created_at, read: false });
  const items = [
    item("a", "reinstatement_closing", "/app/policies/p1", "2026-10-15T10:00:00Z"),
    item("b", "reinstatement_closing", "/app/policies/p1", "2026-10-15T11:00:00Z"),
    item("c", "plan_payment_failed", "/app/settings/billing", "2026-10-15T09:00:00Z"),
    item("d", "mentioned", "/app/leads/x", "2026-10-15T08:00:00Z"),
  ];
  const chips = bellFilterChips(items, new Set(), "all");
  const action = chips.find((chip) => chip.key === "action_needed");
  assert.equal(action?.label, "Action needed");
  assert.equal(action?.count, 3);
  assert.equal(chips.findIndex((chip) => chip.key === "action_needed") < chips.findIndex((chip) => chip.key === "mention"), true);
  assert.deepEqual(filterBellItems(items, "action_needed", new Set()).map((i) => i.id), ["a", "b", "c"]);
  const groups = groupBellItems(items);
  const reinstatement = groups.find((group) => group.link === "/app/policies/p1");
  assert.equal(reinstatement?.count, 2);
  assert.equal(bellGroupSummary(reinstatement), "2 need action");
});
