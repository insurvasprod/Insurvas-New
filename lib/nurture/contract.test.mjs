import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRecycleRule } from "./contract.ts";

test("recycle rules deduplicate dispositions and preserve a zero cap", () => {
  assert.deepEqual(normalizeRecycleRule({ waitDays: 180, allowedDispositions: ["no_answer", "no_answer", "voicemail"], maxRecycles: 0 }), { waitDays: 180, allowedDispositions: ["no_answer", "voicemail"], maxRecycles: 0 });
});

test("recycle rules reject do-not-call and out of range values", () => {
  assert.throws(() => normalizeRecycleRule({ waitDays: 0, allowedDispositions: ["no_answer"], maxRecycles: 1 }), /Wait days/);
  assert.throws(() => normalizeRecycleRule({ waitDays: 180, allowedDispositions: ["do_not_call"], maxRecycles: 1 }), /Do not call/);
  assert.throws(() => normalizeRecycleRule({ waitDays: 180, allowedDispositions: ["no_answer"], maxRecycles: 101 }), /Recycle cap/);
});
