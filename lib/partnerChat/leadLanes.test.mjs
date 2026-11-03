import { test } from "node:test";
import assert from "node:assert/strict";

import { leadLanes } from "./leadLanes.ts";

const card = (id, workItemId, cardType, createdAt, cardPayload = {}) => ({ id, channelId: "c", partnerId: "p", workItemId, message: "", messageKind: "system_card", cardType, cardPayload, createdBy: null, createdAt, attachments: [] });
const text = (id, createdAt) => ({ id, channelId: "c", partnerId: "p", workItemId: null, message: "hi", messageKind: "text", cardType: null, cardPayload: {}, createdBy: "u", createdAt, attachments: [] });

test("a lane per lead from its updates, newest activity first, with where it is now", () => {
  const lanes = leadLanes([
    card("1", "a", "new_lead", "2026-10-27T09:02:00Z", { customer: "Martha Greene" }),
    card("2", "a", "connected", "2026-10-27T09:03:00Z"),
    card("3", "b", "new_lead", "2026-10-27T09:20:00Z", { customer: "Robert Hale" }),
    text("4", "2026-10-27T09:21:00Z"),
    card("5", "b", "call_dropped", "2026-10-27T09:25:00Z"),
    card("6", "a", "transferred", "2026-10-27T09:09:00Z"),
    card("7", "a", "call_outcome", "2026-10-27T09:31:00Z", { counts_as_work_completed: true }),
    card("8", null, "agent_ready", "2026-10-27T09:01:00Z"),
    card("9", "c", "new_lead", "2026-10-27T10:05:00Z", { customer: "James Patel" }),
  ]);
  assert.deepEqual(lanes.map((lane) => [lane.workItemId, lane.customer, lane.state]), [["c", "James Patel", "waiting"], ["a", "Martha Greene", "won"], ["b", "Robert Hale", "dropped"]]);
  assert.deepEqual(lanes[1].reached, { new_lead: true, connected: true, transferred: true, outcome: true });
  assert.deepEqual(lanes[2].reached, { new_lead: true, connected: false, transferred: false, outcome: true });
  assert.deepEqual(lanes[1].steps.map((step) => step.id), ["1", "2", "6", "7"], "steps in time order");
});

test("an outcome that closes as dropped reads as dropped; one mid-call is live", () => {
  assert.equal(leadLanes([card("1", "a", "call_outcome", "2026-10-27T09:00:00Z", { closes_as: "dropped" })])[0].state, "dropped");
  assert.equal(leadLanes([card("1", "a", "connected", "2026-10-27T09:00:00Z")])[0].state, "live");
  assert.equal(leadLanes([card("1", "a", "call_outcome", "2026-10-27T09:00:00Z", { counts_as_work_completed: false })])[0].state, "closed");
});
