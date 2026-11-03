import test from "node:test";
import assert from "node:assert/strict";
import { cleanLicenceNumbers, licenceNumbersFromRow, ownProfileInputSchema } from "./ownProfile.ts";

test("a name is required and tidied; blanks become nulls", () => {
  const parsed = ownProfileInputSchema.parse({ name: "  Rinor   Gllareva ", phone: "  ", npn: "" });
  assert.deepEqual(parsed, { name: "Rinor Gllareva", phone: null, npn: null });
  assert.equal(ownProfileInputSchema.safeParse({ name: "   " }).success, false);
});

test("phone and NPN are checked the way the page explains them", () => {
  assert.equal(ownProfileInputSchema.safeParse({ name: "A", phone: "(312) 555-0100" }).success, true);
  assert.equal(ownProfileInputSchema.safeParse({ name: "A", phone: "call me" }).success, false);
  assert.equal(ownProfileInputSchema.safeParse({ name: "A", phone: "12345" }).success, false);
  assert.equal(ownProfileInputSchema.parse({ name: "A", npn: "1234 5678" }).npn, "12345678");
  assert.equal(ownProfileInputSchema.safeParse({ name: "A", npn: "12345678901" }).success, false);
  assert.equal(ownProfileInputSchema.safeParse({ name: "A", npn: "12AB" }).success, false);
});

test("unknown fields are refused rather than ignored", () => {
  assert.equal(ownProfileInputSchema.safeParse({ name: "A", email: "x@y.z" }).success, false);
});

test("licence numbers are kept only for the states the owner recorded", () => {
  assert.deepEqual(cleanLicenceNumbers({ az: " 123-45 ", TX: "" }, ["AZ", "TX"]), { ok: true, value: { AZ: "123-45" } });
  const refused = cleanLicenceNumbers({ FL: "999" }, ["AZ"]);
  assert.equal(refused.ok, false);
  assert.match(refused.error, /not recorded as licensed in FL/);
  assert.equal(cleanLicenceNumbers({ AZ: "12 34" }, ["AZ"]).ok, false);
  assert.equal(cleanLicenceNumbers({ Arizona: "1" }, ["AZ"]).ok, false);
});

test("the stored object is read defensively", () => {
  assert.deepEqual(licenceNumbersFromRow({ AZ: "1", tx: "2", CA: 3, NV: " " }), { AZ: "1" });
  assert.deepEqual(licenceNumbersFromRow(null), {});
  assert.deepEqual(licenceNumbersFromRow(["AZ"]), {});
});
