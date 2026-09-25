import assert from "node:assert/strict";
import test from "node:test";

import { compareHoldout, MIN_ARM, pts } from "./holdout.ts";

test("the board's own example crosses zero, so it is noise, not a win", () => {
  // 18.4% of 1,204 against 17.6% of 386.
  const result = compareHoldout({ served: 1204, contacted: 222 }, { served: 386, contacted: 68 });
  assert.equal(result.verdict, "noise");
  assert.ok(result.interval.low < 0 && result.interval.high > 0);
  assert.equal(pts(result.differencePts), "+0.8 pts");
});

test("a clear lift over a big enough sample is called better", () => {
  const result = compareHoldout({ served: 4000, contacted: 560 }, { served: 1000, contacted: 100 });
  assert.equal(result.verdict, "better");
  assert.ok(result.interval.low > 0);
});

test("a clear loss is called worse, not hidden", () => {
  const result = compareHoldout({ served: 4000, contacted: 300 }, { served: 1000, contacted: 140 });
  assert.equal(result.verdict, "worse");
});

test("nothing is claimed under the minimum sample, or with an empty arm", () => {
  assert.equal(compareHoldout({ served: MIN_ARM - 1, contacted: 10 }, { served: 500, contacted: 50 }).verdict, "too_few");
  assert.equal(compareHoldout({ served: 500, contacted: 50 }, null).verdict, "too_few");
  assert.equal(compareHoldout({ served: 0, contacted: 0 }, { served: 0, contacted: 0 }).differencePts, null);
});

test("pts is signed and one decimal", () => {
  assert.equal(pts(-1.94), "-1.9 pts");
  assert.equal(pts(0), "0.0 pts");
  assert.equal(pts(3.46), "+3.5 pts");
});
