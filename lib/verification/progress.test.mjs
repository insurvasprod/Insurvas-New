import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldVisible, requiredVisibleKeys, verificationProgress } from "./progress.ts";

const form = { sections: [{ section_key: "one", label: "One", sort_order: 0, fields: [
  { field_key: "name", is_required: true, show_when: null },
  { field_key: "notes", is_required: false, show_when: null },
  { field_key: "state_detail", is_required: true, show_when: { field_key: "name", equals: "Ray" } },
] }] };
const fields = [
  { field_key: "name", label: "Name", type: "text", is_required: false, options: [], sort_order: 0 },
  { field_key: "notes", label: "Notes", type: "text", is_required: false, options: [], sort_order: 1 },
  { field_key: "state_detail", label: "State detail", type: "text", is_required: false, options: [], sort_order: 2 },
];

test("verification progress counts visible required fields only and reaches exact 100", () => {
  const required = requiredVisibleKeys(form, fields, { name: "Ray", notes: "ignored", state_detail: "AZ" });
  assert.deepEqual(required, ["name", "state_detail"]);
  assert.equal(verificationProgress([
    { field_key: "name", state: "confirmed", is_required: true, is_visible: true },
    { field_key: "notes", state: "outstanding", is_required: false, is_visible: true },
    { field_key: "state_detail", state: "corrected", is_required: true, is_visible: true },
  ], required, ["name", "notes", "state_detail"]), 100);
});

test("conditional required fields disappear when their condition is false", () => {
  assert.equal(fieldVisible(form.sections[0].fields[2], { name: "Alex" }), false);
  assert.deepEqual(requiredVisibleKeys(form, fields, { name: "Alex" }), ["name"]);
  assert.equal(verificationProgress([{ field_key: "name", state: "confirmed", is_required: true, is_visible: true }], ["name"], ["name"]), 100);
});
