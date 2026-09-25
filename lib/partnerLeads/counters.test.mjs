import test from "node:test";
import assert from "node:assert/strict";
import { countersFromLanes, startOfTodayIn } from "./counters.ts";

test("LA-1.17-4: the home counters are the board's lanes", () => {
  const lanes = { new: 4, claimed: 3, verification: 2, converted: 9 };
  assert.deepEqual(countersFromLanes(lanes, 23), { submittedToday: 23, claimed: 5, converted: 9, stillOpen: 9 });
});

test("submitted today starts at 00:00 in the partner's timezone, not the database's UTC date", () => {
  const evening = Date.parse("2026-09-25T02:30:00Z"); // 19:30 on the 24th in Phoenix (UTC-7, no DST)
  assert.equal(startOfTodayIn("America/Phoenix", evening).toISOString(), "2026-09-24T07:00:00.000Z");
  assert.equal(startOfTodayIn("UTC", evening).toISOString(), "2026-09-25T00:00:00.000Z");
  assert.equal(startOfTodayIn("America/New_York", Date.parse("2026-03-08T15:00:00Z")).toISOString(), "2026-03-08T05:00:00.000Z");
});
