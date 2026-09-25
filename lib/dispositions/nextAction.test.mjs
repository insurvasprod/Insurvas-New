/**
 * Settings → Dispositions: the Next action column is a setting the dialer honours, a callback is
 * checked against the calling window, and an outcome with no stage is refused.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { allowedNextActions, derivedNextAction, endsDialing, nextActionLabel, splitMinutes, toMinutes, validateNextAction } from "./nextAction.ts";
import { zonedLocalToUtc } from "./callbackTime.ts";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");

test("the board's phrases come from the stored setting", () => {
  assert.equal(nextActionLabel({ kind: "cadence", minutes: null }), "Next cadence attempt");
  assert.equal(nextActionLabel({ kind: "retry", minutes: 20 }), "Retry in 20 minutes");
  assert.equal(nextActionLabel({ kind: "retry", minutes: 60 }), "Retry in 1 hour");
  assert.equal(nextActionLabel({ kind: "rest", minutes: 90 * 1440 }), "Rest 90 days");
  assert.equal(nextActionLabel({ kind: "callback", minutes: null }), "Book a time · required");
  assert.equal(nextActionLabel(null), "—");
});

test("the compliance outcomes are fixed, the rest choose from four", () => {
  assert.deepEqual(allowedNextActions("do_not_call"), ["suppress"]);
  assert.deepEqual(allowedNextActions("callback_scheduled"), ["callback"]);
  assert.deepEqual(allowedNextActions("busy"), ["cadence", "retry", "rest", "close"]);
  assert.throws(() => validateNextAction("busy", "suppress", null));
  assert.throws(() => validateNextAction("do_not_call", "close", null));
  assert.throws(() => validateNextAction("busy", "retry", 0));
  assert.throws(() => validateNextAction("busy", "rest", 600_000));
  assert.deepEqual(validateNextAction("busy", "retry", 20), { kind: "retry", minutes: 20 });
  assert.deepEqual(validateNextAction("busy", "close", 20), { kind: "close", minutes: null }, "a delay is dropped where it means nothing");
});

test("ends call follows the next action, and a row with none behaves as it does today", () => {
  assert.equal(endsDialing("rest"), true);
  assert.equal(endsDialing("close"), true);
  assert.equal(endsDialing("retry"), false);
  assert.equal(endsDialing("cadence"), false);
  assert.deepEqual(derivedNextAction("not_interested", true), { kind: "close", minutes: null });
  assert.deepEqual(derivedNextAction("no_answer", false), { kind: "cadence", minutes: null });
  assert.equal(derivedNextAction("no_answer", null), null);
});

test("durations split into the largest whole unit and back", () => {
  assert.deepEqual(splitMinutes(129600), { value: 90, unit: "days" });
  assert.deepEqual(splitMinutes(120), { value: 2, unit: "hours" });
  assert.deepEqual(splitMinutes(20), { value: 20, unit: "minutes" });
  assert.equal(toMinutes(2, "days"), 2880);
});

test("a callback's local time is the instant it names, across DST", () => {
  // 14:30 in New York on 1 Oct 2026 (EDT, UTC-4) is 18:30Z.
  assert.equal(zonedLocalToUtc("2026-10-01T14:30", "America/New_York")?.toISOString(), "2026-10-01T18:30:00.000Z");
  // After the fall-back (EST, UTC-5).
  assert.equal(zonedLocalToUtc("2026-11-10T09:00", "America/New_York")?.toISOString(), "2026-11-10T14:00:00.000Z");
  // Phoenix has no DST.
  assert.equal(zonedLocalToUtc("2026-07-01T08:00", "America/Phoenix")?.toISOString(), "2026-07-01T15:00:00.000Z");
  assert.equal(zonedLocalToUtc("tomorrow", "America/New_York"), null);
  assert.equal(zonedLocalToUtc("2026-10-01T14:30", "Not/AZone"), null);
});

test("the dialer reads the next action and keeps the ceiling, routing and compliance branches", () => {
  const sql = read("supabase", "migrations", "20260924240200_dispositions_next_action_is_a_setting.sql");
  assert.match(sql, /select d\.ends_call, d\.next_action, d\.next_action_minutes into v_ends_call, v_next_action, v_next_minutes/);
  assert.match(sql, /v_next_action = 'rest'[\s\S]{0,900}lead_state = 'nurture'/, "a rest takes the lead off the dialer until it ends");
  assert.match(sql, /if v_sched\.exhausted then[\s\S]*v_next_action = 'retry'/, "a fixed retry still honours the attempt ceiling");
  assert.match(sql, /when v_new_state in \('retry', 'nurture'\) then 'unclaimed'/, "a rested lead can be served when its rest ends");
  assert.match(sql, /v_new_state in \('closed', 'exhausted', 'working', 'nurture'\)/);
  assert.match(sql, /suppress_phone/);
  assert.match(sql, /inbound_return_call/);
  assert.match(sql, /dispositions_fixed_next_actions/);
});

test("both callback paths check the calling window before writing", () => {
  const window = read("lib", "dispositions", "callbackWindow.ts");
  assert.match(window, /rpc\("tenant_can_dial_now"/, "the enforcement function, not a second copy of the rules");
  assert.match(window, /from "@\/lib\/callingWindow\/engine"/);
  const wizard = read("lib", "dispositions", "service.ts");
  assert.ok(wizard.indexOf("checkCallbackInCallingWindow({") < wizard.indexOf('rpc("complete_disposition_with_callback"'));
  const dialer = read("lib", "dialerScripts", "service.ts");
  assert.ok(dialer.indexOf("checkCallbackInCallingWindow({") > 0 && dialer.indexOf("checkCallbackInCallingWindow({") < dialer.indexOf('rpc("complete_dial_disposition_with_callback"'));
});

test("saving an active outcome with no stage is refused, naming the pipelines", () => {
  const service = read("lib", "dispositions", "service.ts");
  assert.match(service, /if \(active\) await assertOutcomeHasStage\(/);
  assert.match(service, /await assertOutcomeHasStage\(tenantId, dispositionKey, label, stageId\);\r?\n  const next = nextActionPatch/);
  assert.match(service, /from\("tenant_pipelines"\)\.select\("name"\)/);
  const pipelines = read("lib", "pipelines", "service.ts");
  assert.match(pipelines, /every active outcome must land on a stage/);
});

test("counts as work counts on the scorecard", async () => {
  const activity = read("lib", "activityLog", "service.ts");
  assert.match(activity, /counts_as_work_completed/);
  assert.match(activity, /scorecard: await withWorked\(/);
  assert.match(read("components", "app", "activity-log-workspace.tsx"), /row\.worked/);
});
