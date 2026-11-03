import test from "node:test";
import assert from "node:assert/strict";
import { oldestOpenLabel } from "./age.ts";

const NOW = Date.parse("2026-09-24T12:00:00Z");
const ago = (hours) => new Date(NOW - hours * 3_600_000).toISOString();

test("the still-open footnote says how long the longest-waiting lead has waited", () => {
  assert.equal(oldestOpenLabel(0, null, NOW), "nothing open");
  assert.equal(oldestOpenLabel(3, null, NOW), "not yet resolved");
  assert.equal(oldestOpenLabel(3, ago(0.5), NOW), "oldest under an hour");
  assert.equal(oldestOpenLabel(3, ago(1), NOW), "oldest 1 hour");
  assert.equal(oldestOpenLabel(3, ago(23.9), NOW), "oldest 23 hours");
  assert.equal(oldestOpenLabel(3, ago(24), NOW), "oldest 1 day");
  assert.equal(oldestOpenLabel(19, ago(6 * 24 + 5), NOW), "oldest 6 days");
});
