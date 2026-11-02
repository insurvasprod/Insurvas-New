/**
 * "Check a sample post" (owner pick A, 2026-10-30): the guessed map, and the field checks in the
 * post path's order. A sample must fail with the reason a real post would get.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { checkSample, guessFieldMap, parseSample } from "./sampleCheck.ts";

test("parses JSON and form-encoded payloads, and says what is wrong otherwise", () => {
  assert.deepEqual(parseSample('{"fname":"Ana","st":"TX"}'), { payload: { fname: "Ana", st: "TX" } });
  assert.deepEqual(parseSample("fname=Ana&st=TX"), { payload: { fname: "Ana", st: "TX" } });
  assert.ok("error" in parseSample('{"fname":'));
  assert.ok("error" in parseSample("[1,2]"));
  assert.ok("error" in parseSample(""));
});

test("guesses our field from their usual names, leaves ours and unknowns alone, keeps existing rows", () => {
  const payload = { fname: "Ana", "Last Name": "Ruiz", Phone1: "512", st: "TX", state_of_mind: "calm", email: "a@b.c", DOB: "01/02/1960" };
  const guess = guessFieldMap(payload);
  assert.deepEqual(guess, [
    { ours: "first_name", theirs: "fname" },
    { ours: "last_name", theirs: "Last Name" },
    { ours: "phone", theirs: "Phone1" },
    { ours: "state", theirs: "st" },
    { ours: "date_of_birth", theirs: "DOB" },
  ]);
  // email is already our name; state_of_mind is nobody's. A field the map already fills is not offered twice.
  assert.deepEqual(guessFieldMap({ fname: "Ana", first: "Ana" }, [{ ours: "first_name", theirs: "given" }]), []);
});

test("checks run in the post path's order and the first failure is the vendor's reason", () => {
  const good = { fname: "Ana", lname: "Ruiz", phone1: "1 (512) 555-0142", st: "tx", consent_text: "I agree to be called.", ip: "203.0.113.9", dob: "01/02/1960" };
  const map = { first_name: "fname", last_name: "lname", phone: "phone1", state: "st", date_of_birth: "dob" };
  const passed = checkSample(good, map);
  assert.equal(passed.reasonCode, null);
  assert.deepEqual(passed.checks.map((check) => check.label), ["Phone", "State", "Name", "Consent text", "Consent IP", "Date of birth"]);
  assert.equal(passed.checks[0].detail, "(512) 555-0142");
  assert.equal(passed.checks[1].detail, "TX");

  // Harbor's case: they send phone_number under another name, so the map reads nothing.
  assert.equal(checkSample({ ...good, phone1: undefined, cell_no: "5125550142" }, map).reasonCode, "invalid_phone");
  assert.equal(checkSample({ ...good, st: "Texas" }, map).reasonCode, "unknown_state");
  assert.equal(checkSample({ ...good, consent_text: "" }, map).reasonCode, "missing_consent_text");
  assert.equal(checkSample({ ...good, dob: "not a date" }, map).reasonCode, "invalid_date_of_birth");
});
