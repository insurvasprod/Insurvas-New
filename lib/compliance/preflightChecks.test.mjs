import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { answerAge, compactClock, refusalBody, windowHoursLabel } from "./preflightChecks.ts";

const row = (key, tone, refuses, refusal) => ({ key, label: key, result: "x", tone, source: "", age: "live", refuses, refusal });

test("the window reads the way the board prints it", () => {
  assert.equal(compactClock(480), "8am");
  assert.equal(compactClock(1260), "9pm");
  assert.equal(compactClock(510), "8:30am");
  assert.equal(compactClock(720), "12pm");
  assert.equal(windowHoursLabel(480, 1260, "CT"), "8am–9pm CT");
  assert.equal(windowHoursLabel(null, 1260, "CT"), null);
});

test("an answer's age is live under a minute, then minutes, hours, days", () => {
  const now = Date.parse("2026-09-24T12:00:00Z");
  assert.equal(answerAge(null, now), "live");
  assert.equal(answerAge("2026-09-24T11:59:30Z", now), "live");
  assert.equal(answerAge("2026-09-24T11:30:00Z", now), "30m");
  assert.equal(answerAge("2026-09-24T08:00:00Z", now), "4h");
  assert.equal(answerAge("2026-09-14T12:00:00Z", now), "10d");
});

test("the refusal says 'every other check passed' only when it is true", () => {
  const listed = row("suppression", "error", true, "It is on your own suppression list.");
  assert.equal(refusalBody([row("dnc", "success", false)]), null);
  assert.match(refusalBody([listed, row("dnc", "success", false), row("window", "success", false)]), /Every other check passed/);
  // A warning elsewhere (consent pending, a neutral "no lead") means not every other check passed.
  assert.doesNotMatch(refusalBody([listed, row("dnc", "success", false), row("consent", "warning", false)]), /Every other check passed/);
  assert.match(refusalBody([listed, row("window", "warning", true, "The state is unknown.")]), /Each of these refuses the dial on its own/);
});

test("the preflight route keeps every status and code the verification suite pins", () => {
  const route = readFileSync(join(process.cwd(), "app", "api", "app", "dial", "preflight", "route.ts"), "utf8");
  assert.match(route, /requireFeatureRole\("outbound_dialing", \["owner", "producer"\], \{ write: true \}\)/);
  assert.match(route, /field: "phone" \}, \{ status: 400 \}/);
  assert.match(route, /error: DNC_BLOCK_MESSAGE, code: "dnc_unavailable", blocked: true, \.\.\.detail \}, \{ status: 503 \}/);
  assert.match(route, /code: "dnc_listed"[^\n]*status: 422/);
  assert.match(route, /code: "dnc_unverified", blocked: true/);
  assert.match(route, /code: "dnc_cleared"/);
  // The DNC decision outranks the checks added with the dialog, so a missing vendor still answers
  // dnc_unavailable whatever the litigator or window rows say.
  assert.ok(route.indexOf('code: "dnc_unavailable"') < route.indexOf('code: "litigator_listed"'));
  assert.ok(route.indexOf('code: "dnc_unavailable"') < route.indexOf('code: "state_required"'));
});

test("the dialog never offers a dial and never says 'recording'", () => {
  const dialog = readFileSync(join(process.cwd(), "components", "app", "dialer-preflight.tsx"), "utf8");
  assert.match(dialog, /<button type="button" disabled aria-describedby="preflight-dial-reason"/);
  assert.match(dialog, /Dial from the queue or a lead/);
  const wizard = readFileSync(join(process.cwd(), "components", "app", "disposition-wizard-dialog.tsx"), "utf8");
  assert.match(wizard, /The answers, note and outcome are kept for audit\./);
  assert.doesNotMatch(wizard, /recording/i);
  assert.doesNotMatch(wizard, /of 5/);
});
