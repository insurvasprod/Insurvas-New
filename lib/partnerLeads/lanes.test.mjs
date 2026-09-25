import test from "node:test";
import assert from "node:assert/strict";
import { partnerLane } from "./lanes.ts";

const NOW = Date.parse("2026-09-24T12:00:00Z");
const daysAgo = (d) => new Date(NOW - d * 86_400_000).toISOString();
const row = (status, disposition = null, updatedAt = daysAgo(1), workItemId = "w1") => ({ status, disposition, updatedAt, workItemId });

test("a submission sits in the lane its queue item and verification say it is in", () => {
  assert.equal(partnerLane(row("unclaimed"), new Set(), NOW), "new");
  assert.equal(partnerLane(row("claimed"), new Set(), NOW), "claimed");
  assert.equal(partnerLane(row("la_active"), new Set(), NOW), "claimed");
  assert.equal(partnerLane(row("la_active"), new Set(["w1"]), NOW), "verification");
  assert.equal(partnerLane(row("completed", "application_submitted"), new Set(), NOW), "converted");
});

test("converted means a sale in the last 30 days; everything else finished is closed", () => {
  assert.equal(partnerLane(row("completed", "application_submitted", daysAgo(29)), new Set(), NOW), "converted");
  assert.equal(partnerLane(row("completed", "application_submitted", daysAgo(31)), new Set(), NOW), "closed");
  assert.equal(partnerLane(row("completed", "not_interested"), new Set(), NOW), "closed");
  assert.equal(partnerLane(row("dropped"), new Set(), NOW), "closed");
  // An open verification session on a lead nobody holds any more does not make it "on a call".
  assert.equal(partnerLane(row("completed", "application_submitted"), new Set(["w1"]), NOW), "converted");
});
