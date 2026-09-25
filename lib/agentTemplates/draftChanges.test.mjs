// Run with: node --test lib/agentTemplates/draftChanges.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { countWord, diffTemplateDraft, eligibilityFieldKey } from "./draftChanges.ts";

const field = (key, label, extra = {}) => ({ field_key: key, label, type: "text", is_required: false, options: [], sort_order: 0, help_text: null, validation: {}, ...extra });
const saved = {
  name: "Final expense",
  fields: [field("first_name", "First name", { is_required: true }), field("date_of_birth", "Date of birth", { type: "date", validation: { age_min: 50, age_max: 80 } }), field("consent_ip", "Consent IP")],
  stages: [{ stage_key: "new", label: "New", stage_type: "open", color: "#64748b", sort_order: 0 }],
  form: { sections: [{ section_key: "contact", label: "Contact", sort_order: 0, fields: [{ field_key: "first_name", is_required: true, show_when: null }, { field_key: "consent_ip", is_required: false, show_when: null }] }] },
};
const clone = (value) => JSON.parse(JSON.stringify(value));

test("an untouched draft has nothing to commit", () => {
  assert.deepEqual(diffTemplateDraft(saved, clone(saved)), []);
});

test("the board's three changes read the way the board writes them", () => {
  const draft = clone(saved);
  draft.fields.push(field("height_weight", "Height and weight"));
  draft.form.sections[0].fields.push({ field_key: "height_weight", is_required: false, show_when: null });
  draft.fields[2].is_required = true;
  draft.fields[1].validation.age_max = 85;
  const titles = diffTemplateDraft(saved, draft).map((change) => `${change.title} | ${change.sub ?? ""}`).sort();
  assert.deepEqual(titles, [
    "Maximum age 80 → 85 | ",
    "“Consent IP” made required | Was optional",
    "“Height and weight” added | Optional",
  ].sort());
});

test("undoing an edit by hand removes its line", () => {
  const draft = clone(saved);
  draft.fields[0].label = "Given name";
  assert.equal(diffTemplateDraft(saved, draft).length, 1);
  draft.fields[0].label = "First name";
  assert.equal(diffTemplateDraft(saved, draft).length, 0);
});

test("the date-of-birth field is the eligibility field", () => {
  assert.equal(eligibilityFieldKey(saved.fields), "date_of_birth");
  assert.equal(eligibilityFieldKey([field("x", "X")]), null);
});

test("counts are words up to ten", () => {
  assert.equal(countWord(3), "three");
  assert.equal(countWord(12), "12");
});
