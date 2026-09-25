import assert from "node:assert/strict";
import { test } from "node:test";

const { parseLeadCsv, previewLeadCsv, suggestLeadCsvMappings } = await import("./csv.ts");

const fields = [
  { field_key: "full_name", label: "Full name", type: "text", is_required: true, options: [], sort_order: 0 },
  { field_key: "annual_income", label: "Annual income", type: "currency", is_required: false, options: [], sort_order: 1 },
  { field_key: "preferred_products", label: "Preferred products", type: "multi_select", is_required: false, options: ["Term", "Whole life"], sort_order: 2 },
  { field_key: "is_homeowner", label: "Is homeowner", type: "boolean", is_required: false, options: [], sort_order: 3 },
];
const stages = [{ id: "stage-new", name: "New" }, { id: "stage-submitted", name: "Submitted" }];

test("lead CSV uses stable field keys and restores typed values", () => {
  const rows = parseLeadCsv('stage,full_name,annual_income,preferred_products,is_homeowner\r\nNew,"Ray, Jr.",125000,"Term|Whole life",yes\r\n', fields, stages);
  assert.deepEqual(rows, [{ rowNumber: 2, stageId: "stage-new", values: { full_name: "Ray, Jr.", annual_income: 125000, preferred_products: ["Term", "Whole life"], is_homeowner: true } }]);
});

test("lead CSV accepts friendly labels for existing exports", () => {
  const rows = parseLeadCsv("stage,Full name,Annual income\nSubmitted,Ada,90000\n", fields, stages);
  assert.equal(rows[0].stageId, "stage-submitted");
  assert.deepEqual(rows[0].values, { full_name: "Ada", annual_income: 90000 });
});

test("lead CSV suggests safe aliases and permits an explicit corrected mapping", () => {
  const suggestions = suggestLeadCsvMappings(["stage", "Mobile Phone", "DOB", "vendor_note"], fields);
  assert.deepEqual(suggestions.map((item) => [item.header, item.fieldKey, item.confidence]), [
    ["stage", null, "exact"], ["mobile phone", null, "unmapped"], ["dob", null, "unmapped"], ["vendor_note", null, "unmapped"],
  ]);
  // Adding a phone field turns on the identity requirement — a dialable template must carry
  // first_name and last_name, and those fields are mandatory per row regardless of their
  // `is_required` flag. State is optional at import and can be completed later. This test is
  // about alias mapping, so it supplies them rather than tripping an unrelated guard.
  const rows = parseLeadCsv("stage,Mobile Phone,DOB,first_name,last_name,state\nNew,2052336644,1972-03-24,Ada,Lovelace,FL\n", [
    ...fields,
    { field_key: "phone", label: "Phone", type: "text", is_required: false, options: [], sort_order: 4 },
    { field_key: "date_of_birth", label: "Date of birth", type: "date", is_required: false, options: [], sort_order: 5 },
    { field_key: "first_name", label: "First name", type: "text", is_required: false, options: [], sort_order: 6 },
    { field_key: "last_name", label: "Last name", type: "text", is_required: false, options: [], sort_order: 7 },
    { field_key: "state", label: "State", type: "text", is_required: false, options: [], sort_order: 8 },
  ], stages, { "mobile phone": "phone", dob: "date_of_birth" });
  assert.equal(rows[0].values.phone, "2052336644");
  assert.equal(rows[0].values.date_of_birth, "1972-03-24");
});

test("lead CSV ignores unmapped columns but rejects invalid stage and typed values", () => {
  const unmapped = parseLeadCsv("stage,unknown\nNew,value\n", fields, stages);
  assert.deepEqual(unmapped[0].values, {});
  assert.throws(() => parseLeadCsv("stage,full_name\nMissing,Ada\n", fields, stages), /active pipeline stage/i);
  assert.throws(() => parseLeadCsv("stage,full_name,annual_income\nNew,Ada,12.5\n", fields, stages), /integer-cent/i);
});

test("lead CSV preview uses the write parser and reports row or file problems", () => {
  const valid = previewLeadCsv("stage,full_name\nNew,Ada\n", fields, stages);
  assert.deepEqual(valid, { totalRows: 1, validRows: 1, rejectedRows: 0, rowErrors: [], moreRowErrors: 0, error: null });
  const unmapped = previewLeadCsv("stage,unknown\nNew,value\n", fields, stages);
  assert.deepEqual(unmapped, { totalRows: 1, validRows: 1, rejectedRows: 0, rowErrors: [], moreRowErrors: 0, error: null });
});

test("lead CSV preview returns a controlled error for malformed quoted input", () => {
  const result = previewLeadCsv('stage,"full_name\nNew,Ada\n', fields, stages);
  assert.equal(result.error, "CSV contains an unclosed quote");
  assert.equal(result.validRows, 0);
});

test("lead CSV accepts the required name and phone fields and defaults the stage", () => {
  const importFields = [
    { field_key: "phone", label: "Phone", type: "phone", is_required: true, options: [], sort_order: 0 },
    { field_key: "first_name", label: "First name", type: "text", is_required: false, options: [], sort_order: 1 },
    { field_key: "last_name", label: "Last name", type: "text", is_required: false, options: [], sort_order: 2 },
    { field_key: "state", label: "State", type: "single_select", is_required: true, options: ["FL", "TX"], sort_order: 3 },
  ];
  const rows = parseLeadCsv("phone,first_name,last_name,state\n(205) 233-6644,Ada,Lovelace,\n", importFields, stages);
  assert.equal(rows[0].stageId, "stage-new");
  assert.deepEqual(rows[0].values, { phone: "2052336644", first_name: "Ada", last_name: "Lovelace" });
  const preview = previewLeadCsv("phone,first_name,last_name,state\n(205) 233-6644,Ada,Lovelace,\n", importFields, stages);
  assert.deepEqual(preview, { totalRows: 1, validRows: 1, rejectedRows: 0, rowErrors: [], moreRowErrors: 0, error: null });
  assert.throws(() => parseLeadCsv("phone,first_name,last_name\n2052336644,Ada,\n", importFields, stages), /Last name is required/i);
});
