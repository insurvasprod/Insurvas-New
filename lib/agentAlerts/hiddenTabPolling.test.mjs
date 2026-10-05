// Run with: npm test
//
// LA-1.25 criterion 1: "a lead arriving while the tab is in the background produces a browser
// notification and a sound". The 2026-09-28 performance pass made the alert poll pause in a hidden
// tab, which silently broke exactly that. The poll may be one-request-at-a-time; it may not stop
// when the tab is hidden.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(process.cwd(), "lib/agentAlerts/useAgentAlertFeed.ts"), "utf8");

test("the alert poll does not stop while the tab is hidden", () => {
  assert.doesNotMatch(src, /visibilityState\s*===\s*"hidden"\)\s*return/, "a hidden tab must keep polling for new transfers");
});

test("the poll stays one request at a time and re-checks as soon as the tab is shown", () => {
  assert.match(src, /if \(cancelled \|\| inFlight\) return;/, "never two polls in flight");
  assert.match(src, /visibilityState === "visible" && !inFlight\) schedule\(0\)/, "shown again → poll immediately");
});

test("a hidden tab can still raise the browser notification", () => {
  assert.match(src, /new Notification\("Insurvas alert"/);
});
