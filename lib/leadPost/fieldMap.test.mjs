/**
 * The vendor field map, both ways round.
 *
 * The mint dialog told owners "Their field name on the left, yours on the right" while the post
 * path read the key as OURS. These pin the contract, the tolerant reading of maps typed the old
 * way, and that the settings screen and the post path read a map identically.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { applyFieldMap, canonicalFieldMap, readFieldMap } from "./fieldMap.ts";

const payload = { Phone: "(555) 010-2030", st: "tx", fname: "Ada", contact: { email: "ada@example.com" }, phone: "ignored-by-map" };

test("the stored contract is { ours: theirs }", () => {
  const values = applyFieldMap(payload, { state: "st", first_name: "fname", email: "contact.email" });
  assert.equal(values.state, "tx");
  assert.equal(values.first_name, "Ada");
  assert.equal(values.email, "ada@example.com");
  // Everything the vendor sent is kept.
  assert.equal(values.Phone, "(555) 010-2030");
});

test("a map typed the old, backwards way is read the way it was meant", () => {
  // Exactly what the old placeholder taught: their name as the key, ours as the value.
  const values = applyFieldMap(payload, { Phone: "phone", st: "state", "contact.email": "email" });
  assert.equal(values.phone, "(555) 010-2030", "their Phone must fill our phone");
  assert.equal(values.state, "tx");
  assert.equal(values.email, "ada@example.com");
  assert.equal(readFieldMap({ Phone: "phone" })[0].inverted, true);
});

test("a correct map between two of our own names is never flipped", () => {
  const [entry] = readFieldMap({ phone: "phone_number" });
  assert.deepEqual(entry, { ours: "phone", theirs: "phone_number", inverted: false });
  assert.equal(applyFieldMap({ phone_number: "5550102030" }, { phone: "phone_number" }).phone, "5550102030");
});

test("two unknown names are taken at the contract's word", () => {
  assert.deepEqual(readFieldMap({ beneficiary: "bene" }), [{ ours: "beneficiary", theirs: "bene", inverted: false }]);
});

test("when a correct and a backwards pair claim the same field, the correct one wins", () => {
  const entries = readFieldMap({ Phone: "phone", phone: "ph1" });
  assert.deepEqual(entries, [{ ours: "phone", theirs: "ph1", inverted: false }]);
});

test("saving writes the canonical direction", () => {
  const fixed = canonicalFieldMap(readFieldMap({ Phone: "phone", st: "state" }));
  assert.deepEqual(fixed, { phone: "Phone", state: "st" });
  // Reading the canonical form back is a fixed point.
  assert.deepEqual(canonicalFieldMap(readFieldMap(fixed)), fixed);
});

test("the post path and the settings screen use this one reader", () => {
  const service = readFileSync(join(process.cwd(), "lib", "leadPost", "service.ts"), "utf8");
  assert.match(service, /from "\.\/fieldMap"/);
  assert.doesNotMatch(service, /for \(const \[ours, theirs\] of Object\.entries\(map\)\)/, "the old one-way loop is back");
  const screen = readFileSync(join(process.cwd(), "components", "app", "lead-post-keys-settings.tsx"), "utf8");
  assert.match(screen, /readFieldMap/);
  assert.doesNotMatch(screen, /\{"Phone": "phone"\}|"Phone": "phone"/, "the backwards example is back on the screen");
});
