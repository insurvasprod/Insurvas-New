import assert from "node:assert/strict";
import test from "node:test";

import { PHONE_COUNTRIES, checkInternationalPhone, checkPhone, phoneCountry } from "./phone.ts";

test("every country is offered, the United States first, each with its code and an example number", () => {
  assert.ok(PHONE_COUNTRIES.length > 200);
  assert.equal(PHONE_COUNTRIES[0].code, "US");
  assert.deepEqual(phoneCountry("US"), { code: "US", name: "United States", dial: "1", example: "(201) 555-0123" });
  assert.equal(phoneCountry("XK")?.dial, "383");
  assert.ok(PHONE_COUNTRIES.every((country) => country.dial && country.name));
});

test("a number is checked against its country's plan and kept as E.164", () => {
  assert.deepEqual(checkPhone("US", "(201) 555-0123"), { ok: true, e164: "+12015550123" });
  assert.deepEqual(checkPhone("GB", "07400 123456"), { ok: true, e164: "+447400123456" });
  assert.deepEqual(checkPhone("XK", "043 201 234"), { ok: true, e164: "+38343201234" });
  assert.equal(checkPhone("US", "201 555 012").ok, false, "too short");
  assert.equal(checkPhone("US", "555 555 0100").ok, false, "555 is not an area code");
  assert.equal(checkPhone("US", "").ok, false);
  assert.equal(checkPhone("US", "555-CALL-NOW").ok, false);
});

test("the server reads a number with its country code", () => {
  assert.deepEqual(checkInternationalPhone("+1 201 555 0123"), { ok: true, e164: "+12015550123" });
  assert.deepEqual(checkInternationalPhone("+383 43 201 234"), { ok: true, e164: "+38343201234" });
  assert.equal(checkInternationalPhone("201 555 0123").ok, false, "no country code");
  assert.equal(checkInternationalPhone("+1 201 555").ok, false, "too short");
});
