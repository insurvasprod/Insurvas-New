import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DIAL_OUTCOME_KEY_PATTERN, decideDialOutcomeKey, setterMayRecord } from "./dialOutcomeKey.ts";

const BUILT_IN = ["no_answer", "voicemail", "busy", "call_dropped", "not_interested", "callback_scheduled", "application_submitted", "do_not_call", "inbound_return_call"];
const route = readFileSync(join(process.cwd(), "app", "api", "app", "dialer", "attempt", "[id]", "disposition", "route.ts"), "utf8");

test("the format is a short slug", () => {
  assert.ok(DIAL_OUTCOME_KEY_PATTERN.test("quoted_thinking"));
  for (const bad of ["", "a", "Quoted", "1st_call", "quoted-thinking", "x".repeat(81), "drop table"]) assert.ok(!DIAL_OUTCOME_KEY_PATTERN.test(bad), bad);
});

test("built-in keys are accepted; custom keys only when the tenant has them active", () => {
  assert.deepEqual(decideDialOutcomeKey({ key: "no_answer", builtIn: BUILT_IN, row: null }), { ok: true, path: "record" });
  assert.deepEqual(decideDialOutcomeKey({ key: "quoted_thinking", builtIn: BUILT_IN, row: { is_active: true, next_action: "retry" } }), { ok: true, path: "record" });
  const unknown = decideDialOutcomeKey({ key: "quoted_thinking", builtIn: BUILT_IN, row: null });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.status, 400);
  assert.equal(unknown.code, "unknown_disposition");
  const archived = decideDialOutcomeKey({ key: "quoted_thinking", builtIn: BUILT_IN, row: { is_active: false, next_action: "close" } });
  assert.equal(archived.ok, false);
  assert.equal(archived.code, "disposition_archived");
});

test("only callback_scheduled books a callback, and no callback-type outcome schedules nothing", () => {
  assert.deepEqual(decideDialOutcomeKey({ key: "callback_scheduled", builtIn: BUILT_IN, row: null }), { ok: true, path: "callback" });
  const custom = decideDialOutcomeKey({ key: "call_me_friday", builtIn: BUILT_IN, row: { is_active: true, next_action: "callback" } });
  assert.equal(custom.ok, false);
  assert.equal(custom.code, "callback_not_bookable");
  // The database already forbids that row (dispositions_fixed_next_actions); this is the second refusal.
  const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "20260924240200_dispositions_next_action_is_a_setting.sql"), "utf8");
  assert.match(sql, /disposition_key not in \('do_not_call', 'callback_scheduled'\) and next_action not in \('suppress', 'callback'\)/);
});

test("a setter may not record any application-type outcome, and the rule fails closed", () => {
  assert.equal(setterMayRecord({ role: "owner", key: "application_submitted", isApplication: true }), true);
  assert.equal(setterMayRecord({ role: "setter", key: "application_submitted", isApplication: false }), false);
  assert.equal(setterMayRecord({ role: "setter", key: "sent_to_underwriting", isApplication: true }), false);
  assert.equal(setterMayRecord({ role: "setter", key: "no_answer", isApplication: false }), true);
  assert.equal(setterMayRecord({ role: "setter", key: "quoted_thinking", isApplication: null }), false);
});

test("the route validates, then checks the table, then the setter rule, then the verification gate", () => {
  assert.match(route, /disposition: z\.string\(\)\.regex\(DIAL_OUTCOME_KEY_PATTERN/);
  const order = ["loadDialOutcomeRow(", "decideDialOutcomeKey(", "applicationOutcomeFor(", "setterMayRecord(", "assertApplicationOutcomeVerified(", "recordCallbackDisposition(", "recordDisposition("];
  let at = route.indexOf("export async function POST");
  for (const marker of order) {
    const found = route.indexOf(marker, at);
    assert.ok(found > at, `${marker} is out of order in the dialer disposition route`);
    at = found;
  }
  // The callback path keeps its attempt-scoped idempotency key.
  assert.match(route, /idempotencyKey: `dial:\$\{attemptId\}:callback`/);
  // Call mode's walk is served under the dialer's guard, owners and producers only.
  assert.match(route, /export async function GET[\s\S]*requireFeatureRole\("outbound_dialing", \["owner", "producer"\]\)/);
  assert.match(route, /body\?\.action === "answer"[\s\S]{0,200}auth\.context\.role === "setter"/);
});
