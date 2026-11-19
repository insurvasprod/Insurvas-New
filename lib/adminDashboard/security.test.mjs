import test from "node:test";
import assert from "node:assert/strict";

import { initials, signInDays, utcClock } from "./security.ts";

const NOW = Date.parse("2026-11-17T14:00:00Z");

test("sign-ins land on their UTC day, oldest first, today last; days outside the window are left out", () => {
  const days = signInDays(
    [
      { at: "2026-11-17T13:23:54Z", success: true },
      { at: "2026-11-17T09:00:00Z", success: false },
      { at: "2026-11-16T23:59:59Z", success: true },
      { at: "2026-11-01T10:00:00Z", success: true },
    ],
    NOW,
    14,
  );
  assert.equal(days.length, 14);
  assert.equal(days[0].key, "2026-11-04");
  assert.deepEqual(days.at(-1), { key: "2026-11-17", label: "Today", succeeded: 1, failed: 1 });
  assert.equal(days.at(-2).label, "Nov 16");
  assert.equal(days.at(-2).succeeded, 1);
  assert.equal(days.reduce((sum, day) => sum + day.succeeded + day.failed, 0), 3);
});

test("initials from a name or an email", () => {
  assert.equal(initials("Quinn Testmore"), "QT");
  assert.equal(initials("qa.design@insurvas.test"), "QD");
  assert.equal(initials("Rinor"), "RI");
  assert.equal(initials(""), "?");
});

test("UTC clock", () => {
  assert.equal(utcClock("2026-11-17T09:05:00Z"), "09:05");
  assert.equal(utcClock("nonsense"), "—");
});
