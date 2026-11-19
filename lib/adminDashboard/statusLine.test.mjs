import test from "node:test";
import assert from "node:assert/strict";

import { shortDay } from "./statusLine.ts";

test("short days", () => {
  assert.equal(shortDay("2026-09-21"), "Sep 21");
  assert.equal(shortDay("2026-01-05T00:00:00Z"), "Jan 5");
});
