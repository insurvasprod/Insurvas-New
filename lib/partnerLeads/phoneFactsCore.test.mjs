import test from "node:test";
import assert from "node:assert/strict";
import { attemptSummary, breakdownLines, firstName, liveFacts, readyCount } from "./phoneFactsCore.ts";

test("a partner sees the agent who took a transfer by first name only", () => {
  assert.equal(firstName("Jordan Reyes"), "Jordan");
  assert.equal(firstName("  Ana  "), "Ana");
  assert.equal(firstName(""), null);
  assert.equal(firstName(null), null);
});

test("the live line names the holder, the claim time and the earliest open callback", () => {
  const names = new Map([["u1", "Jordan Reyes"], ["u2", "Dana Fields"]]);
  const facts = liveFacts(
    [
      { id: "w1", claimed_at: "2026-11-20T14:09:00Z", owner_user_id: "u1", claimed_by: "u2" },
      { id: "w2", claimed_at: null, owner_user_id: null, claimed_by: "u2" },
      { id: "w3", claimed_at: null, owner_user_id: null, claimed_by: null },
    ],
    names,
    [
      { work_item_id: "w2", scheduled_at_utc: "2026-11-28T15:00:00Z" },
      { work_item_id: "w2", scheduled_at_utc: "2026-11-27T15:00:00Z" },
    ],
  );
  assert.deepEqual(facts.w1, { claimedBy: "Jordan", claimedAt: "2026-11-20T14:09:00Z", callbackAt: null });
  assert.deepEqual(facts.w2, { claimedBy: "Dana", claimedAt: null, callbackAt: "2026-11-27T15:00:00Z" });
  assert.equal(facts.w3, undefined, "nothing to say, nothing sent");
  // Never a full name, email or id.
  assert.ok(!JSON.stringify(facts).includes("Reyes"));
  assert.ok(!JSON.stringify(facts).includes("u1"));
});

test("attempts are a count and a span, never the outcomes", () => {
  assert.equal(attemptSummary([]), null);
  assert.deepEqual(attemptSummary([{ attempted_at: "2026-11-21T10:00:00Z" }, { attempted_at: "2026-11-20T10:00:00Z" }, { attempted_at: "2026-11-21T16:00:00Z" }]), { count: 3, firstAt: "2026-11-20T10:00:00Z", lastAt: "2026-11-21T16:00:00Z" });
});

test("agents ready counts a fresh ready heartbeat only", () => {
  const now = Date.parse("2026-11-27T12:00:00Z");
  assert.equal(readyCount([
    { status: "ready", last_seen_at: "2026-11-27T11:59:30Z" },
    { status: "ready", last_seen_at: "2026-11-27T11:50:00Z" },
    { status: "on_break", last_seen_at: "2026-11-27T11:59:50Z" },
    { status: "ready", last_seen_at: null },
  ], now), 1);
});

test("the breakdown keeps per-unit lines by their item type", () => {
  const labels = { sale: "Sales", transfer: "Accepted transfers", adjustment: "Adjustments" };
  assert.deepEqual(breakdownLines([
    { label: "Sales", count: 41, rateCents: 9500 },
    { label: "Accepted transfers", count: 12, rateCents: 3500 },
    { label: "Adjustments", count: 1, rateCents: null },
  ], labels), [{ itemType: "sale", count: 41, rateCents: 9500 }, { itemType: "transfer", count: 12, rateCents: 3500 }]);
});
