import assert from "node:assert/strict";
import { test } from "node:test";

import { formatSupportPhone, isPlausiblePhone, supportContactInputSchema } from "./contact.ts";
import { composerCountLabel, PARTNER_CHAT_MESSAGE_MAX } from "../partnerChat/composer.ts";

test("formats North American numbers the way the board writes them", () => {
  assert.equal(formatSupportPhone("3125550100"), "(312) 555–0100");
  assert.equal(formatSupportPhone("+1 312 555 0100"), "(312) 555–0100");
  assert.equal(formatSupportPhone("312-555-0100"), "(312) 555–0100");
  assert.equal(formatSupportPhone("1 (312) 555.0100"), "(312) 555–0100");
});

test("leaves other numbers exactly as the agency typed them", () => {
  assert.equal(formatSupportPhone("+44 20 7946 0958"), "+44 20 7946 0958");
  assert.equal(formatSupportPhone("+4420794609"), "+4420794609");
  assert.equal(formatSupportPhone("555 0100"), "555 0100");
});

test("an empty phone is no phone", () => {
  assert.equal(formatSupportPhone(null), null);
  assert.equal(formatSupportPhone(undefined), null);
  assert.equal(formatSupportPhone("   "), null);
});

test("plausible phones have 7 to 15 digits and phone punctuation only", () => {
  assert.equal(isPlausiblePhone("(312) 555-0100"), true);
  assert.equal(isPlausiblePhone("+1 312 555 0100"), true);
  assert.equal(isPlausiblePhone("555-01"), false);
  assert.equal(isPlausiblePhone("1234567890123456"), false);
  assert.equal(isPlausiblePhone("call 312 555 0100"), false);
});

test("the input schema trims, lowercases and turns blanks into null", () => {
  const parsed = supportContactInputSchema.parse({ email: "  Support@Northline.Example ", phone: "  " });
  assert.deepEqual(parsed, { email: "support@northline.example", phone: null });
  assert.deepEqual(supportContactInputSchema.parse({}), { email: null, phone: null });
});

test("the input schema rejects a bad email, a bad phone and unknown keys", () => {
  assert.equal(supportContactInputSchema.safeParse({ email: "not-an-email" }).success, false);
  assert.equal(supportContactInputSchema.safeParse({ phone: "12" }).success, false);
  assert.equal(supportContactInputSchema.safeParse({ email: null, fax: "1" }).success, false);
});

test("the composer counter reads as the board draws it", () => {
  assert.equal(PARTNER_CHAT_MESSAGE_MAX, 2000);
  assert.equal(composerCountLabel(0), "0 / 2,000");
  assert.equal(composerCountLabel(1999), "1,999 / 2,000");
  assert.equal(composerCountLabel(-3), "0 / 2,000");
});
