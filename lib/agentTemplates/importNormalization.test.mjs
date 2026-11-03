import assert from "node:assert/strict";
import { test } from "node:test";

const { normalizeImportPhone, normalizeImportDate, resolveImportTimezone, normalizeImportValues, previewLeadCsv, inferredImportDateOrder } = await import("./csv.ts");

test("lead import normalizes valid US phones and rejects unsafe values", () => {
  assert.equal(normalizeImportPhone("+1 (747) 221-2104"), "7472212104");
  assert.equal(normalizeImportPhone("1234567890"), null);
  assert.equal(normalizeImportPhone("747221210"), null);
});

test("lead import normalizes ISO, Excel, and d-mmm-yy dates", () => {
  assert.equal(normalizeImportDate("1972-03-24"), "1972-03-24");
  assert.equal(normalizeImportDate("25569"), "1970-01-01");
  assert.equal(normalizeImportDate("2-sep-97"), "1997-09-02");
  assert.equal(normalizeImportDate("31-feb-90"), null);
});

test("slash dates are refused without a date order, and read either way with one", () => {
  // Today's behaviour, kept for every caller that does not pick an order (the direct import).
  assert.equal(normalizeImportDate("05/06/1961"), null);
  assert.equal(normalizeImportDate("05/06/1961", "mdy"), "1961-05-06");
  assert.equal(normalizeImportDate("05/06/1961", "dmy"), "1961-06-05");
  assert.equal(normalizeImportDate("03/14/1958", "mdy"), "1958-03-14");
  assert.equal(normalizeImportDate("03/14/1958", "dmy"), null);
  assert.equal(normalizeImportDate("2/29/2023", "mdy"), null);
  // Two-digit years use the d-mmm-yy century rule.
  assert.equal(normalizeImportDate("5/6/61", "mdy"), "1961-05-06");
  assert.equal(normalizeImportDate("5/6/01", "dmy"), "2001-06-05");
  // Other formats are untouched by the order.
  assert.equal(normalizeImportDate("1972-03-24", "dmy"), "1972-03-24");
  assert.equal(normalizeImportDate("2-sep-97", "dmy"), "1997-09-02");
});

test("the date of birth follows the chosen order through normalizeImportValues", () => {
  assert.equal(normalizeImportValues({ date_of_birth: "05/06/1961" }, 2, "dmy").date_of_birth, "1961-06-05");
  assert.throws(() => normalizeImportValues({ date_of_birth: "05/06/1961" }, 2), /date of birth/);
});

test("the preview scans every row for dates both readings accept", () => {
  const fields = [
    { field_key: "phone", label: "Phone", type: "phone", is_required: true, options: [], sort_order: 0 },
    { field_key: "first_name", label: "First name", type: "text", is_required: true, options: [], sort_order: 1 },
    { field_key: "last_name", label: "Last name", type: "text", is_required: true, options: [], sort_order: 2 },
    { field_key: "date_of_birth", label: "Date of birth", type: "date", is_required: false, options: [], sort_order: 3 },
  ];
  const stages = [{ id: "s1", name: "New" }];
  const csv = "phone,first_name,last_name,dob_str\n2052336644,Ada,One,03/14/1958\n2052336645,Bo,Two,05/06/1961\n2052336646,Cy,Three,07/07/1970\n2052336647,Di,Four,11/02/1966\n";
  const mapping = { phone: "phone", first_name: "first_name", last_name: "last_name", dob_str: "date_of_birth" };
  const plain = previewLeadCsv(csv, fields, stages, mapping);
  assert.equal(plain.dates.slashDates, 4);
  assert.equal(plain.dates.ambiguous, 2, "05/06 and 11/02 read two ways; 07/07 is the same date either way");
  assert.equal(plain.dates.firstAmbiguous, "05/06/1961");
  assert.equal(plain.dates.firstUnambiguous, "03/14/1958");
  assert.deepEqual(plain.dates.ambiguousByHeader, { dob_str: 2 });
  assert.equal(plain.validRows, 0, "without an order every slash date is refused, as before");
  assert.equal(previewLeadCsv(csv, fields, stages, mapping, 8, "mdy").validRows, 4);
  assert.equal(previewLeadCsv(csv, fields, stages, mapping, 8, "dmy").validRows, 3, "14 is not a month");
  assert.equal(inferredImportDateOrder(plain.dates), "mdy");
  assert.equal(inferredImportDateOrder({ ...plain.dates, slashDates: 0 }), null);
  assert.equal(inferredImportDateOrder({ ...plain.dates, invalidMdy: 3, invalidDmy: 0 }), "dmy");
});

test("Florida and Tennessee split-zone ZIP corrections win over source labels", () => {
  assert.equal(resolveImportTimezone("Eastern", "32501", "FL"), "America/Chicago");
  assert.equal(resolveImportTimezone("Central", "37402", "TN"), "America/New_York");
  assert.equal(resolveImportTimezone("Unknown", "", "TN"), null);
  assert.equal(resolveImportTimezone("Unknown", "30301", "GA"), "America/New_York");
});

test("normalization is applied after typed CSV parsing and preserves ZIP leading zeroes", () => {
  assert.deepEqual(normalizeImportValues({ phone: "+1 205-233-6644", date_of_birth: "38340", state: "ga", zip: "03001", timezone: "Unknown" }, 2), {
    phone: "2052336644", date_of_birth: "2004-12-19", state: "GA", zip: "03001", timezone: "America/New_York",
  });
  assert.throws(() => normalizeImportValues({ phone: "555", date_of_birth: "1972-03-24" }, 3), /phone/);
});
