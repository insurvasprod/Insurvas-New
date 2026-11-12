// Run with: node --experimental-strip-types --test lib/templates/formatTwo.test.mjs
//
// Settings r8, Application forms A: form definition format 2 — AND / OR logic, page skips and the two
// question rules intake does not take yet — stored inside form_definition so it needs no migration,
// and read the same way by the builder, the preview and the partner form (through visibility.ts).
import { test } from "node:test";
import assert from "node:assert/strict";

const { logicHolds, withLogic, placementLogic, logicSentence, conditionShadow, formForSave, formLogicProblem, formLogicList, cleanLogic } = await import("./logic.ts");
const { templateFormFieldVisible, pruneHiddenTemplateValues } = await import("./visibility.ts");
const { effectiveTemplateForm } = await import("./sectionAvailability.ts");
const { checkFieldValue, storedAnswer } = await import("./fieldRules.ts");
const { splitFieldRules, mergeFieldRules } = await import("./fieldRulesStore.ts");
const { formChanges } = await import("./formChanges.ts");
const { applicationFieldsFor } = await import("./applicationMatch.ts");

const today = new Date("2026-11-12T12:00:00Z");
// "Tobacco use is Yes and (the person is 60 or older or State is FL, GA or TX)" — board A3.
const board = {
  match: "all",
  rules: [
    { field_key: "tobacco_use", op: "is", value: "true" },
    { match: "any", rules: [{ field_key: "date_of_birth", op: "age_at_least", value: "60" }, { field_key: "state", op: "one_of", values: ["FL", "GA", "TX"] }] },
  ],
};
const labels = { tobacco_use: "Tobacco use", date_of_birth: "Date of birth", state: "State", cigarettes: "Cigarettes a day", coverage_amount: "Coverage amount" };
const labelOf = (key) => labels[key] ?? key;

test("AND / OR groups hold exactly when the board says they do", () => {
  assert.equal(logicHolds(board, { tobacco_use: "true", date_of_birth: "1958-06-02", state: "NY" }, today), true);
  assert.equal(logicHolds(board, { tobacco_use: "true", date_of_birth: "1990-06-02", state: "TX" }, today), true);
  assert.equal(logicHolds(board, { tobacco_use: "true", date_of_birth: "1990-06-02", state: "NY" }, today), false);
  assert.equal(logicHolds(board, { tobacco_use: "false", date_of_birth: "1958-06-02", state: "TX" }, today), false);
  // "Yes" and "true" are the same answer to a yes / no question.
  assert.equal(logicHolds({ match: "all", rules: [{ field_key: "tobacco_use", op: "is", value: "Yes" }] }, { tobacco_use: true }), true);
  assert.equal(logicHolds({ match: "any", rules: [] }, {}), true);
});

test("the readback is one plain sentence", () => {
  assert.equal(logicSentence(board, labelOf), "Tobacco use is Yes and (the person is 60 or older or State is FL, GA or TX)");
  assert.equal(logicSentence(null, labelOf), "");
});

test("one plain rule is stored the format-1 way, so every older reader agrees; anything else as logic", () => {
  const base = { field_key: "cigarettes", is_required: false, show_when: null };
  const single = withLogic(base, { match: "all", rules: [{ field_key: "tobacco_use", op: "is", value: "true" }] });
  assert.deepEqual(single.show_when, { field_key: "tobacco_use", equals: "true" });
  assert.equal("logic" in single, false);
  assert.deepEqual(placementLogic(single), { match: "all", rules: [{ field_key: "tobacco_use", op: "is", value: "true" }] });
  const both = withLogic(base, board);
  assert.equal(both.show_when, null);
  assert.deepEqual(both.logic, board);
  assert.equal(conditionShadow(board), null);
  const cleared = withLogic(both, null);
  assert.equal(cleared.show_when, null);
  assert.equal("logic" in cleared, false);
  // An empty group drops out; a group of one is unwrapped.
  assert.deepEqual(cleanLogic({ match: "all", rules: [{ match: "any", rules: [] }, { match: "any", rules: [{ field_key: "state", op: "filled" }] }] }), { match: "all", rules: [{ field_key: "state", op: "filled" }] });
});

const form = () => ({
  sections: [
    { section_key: "about", label: "About you", sort_order: 0, fields: [{ field_key: "date_of_birth", is_required: true, show_when: null }, { field_key: "state", is_required: true, show_when: null }, { field_key: "phone", is_required: true, show_when: null }] },
    { section_key: "health", label: "Health", sort_order: 1, fields: [{ field_key: "tobacco_use", is_required: true, show_when: null }, { field_key: "cigarettes", is_required: false, show_when: null, logic: board }] },
    { section_key: "coverage", label: "Coverage", sort_order: 2, skip_when: { match: "all", rules: [{ field_key: "state", op: "is", value: "NY" }] }, fields: [{ field_key: "coverage_amount", is_required: false, show_when: null }] },
  ],
});
const fields = [
  { field_key: "date_of_birth", label: "Date of birth", type: "date", is_required: true, options: [], sort_order: 0, validation: { age_min: 50, age_max: 85 } },
  { field_key: "state", label: "State", type: "single_select", is_required: true, options: ["FL", "GA", "TX", "NY"], sort_order: 1 },
  { field_key: "phone", label: "Phone", type: "phone", is_required: true, options: [], sort_order: 2 },
  { field_key: "tobacco_use", label: "Tobacco use", type: "boolean", is_required: true, options: [], sort_order: 3 },
  { field_key: "cigarettes", label: "Cigarettes a day", type: "number", is_required: false, options: [], sort_order: 4 },
  { field_key: "coverage_amount", label: "Coverage amount", type: "currency", is_required: false, options: [], sort_order: 5 },
];

test("the partner form's reader (templateFormFieldVisible) runs format-2 logic and page skips", () => {
  const cigarettes = form().sections[1].fields[1];
  assert.equal(templateFormFieldVisible(cigarettes, { tobacco_use: "true", state: "TX" }), true);
  assert.equal(templateFormFieldVisible(cigarettes, { tobacco_use: "false", state: "TX" }), false);
  const effective = effectiveTemplateForm(form(), fields);
  const coverage = effective.sections[2].fields[0];
  assert.deepEqual(coverage.page_skip, form().sections[2].skip_when);
  assert.equal(templateFormFieldVisible(coverage, { state: "NY" }), false);
  assert.equal(templateFormFieldVisible(coverage, { state: "TX" }), true);
  // Nothing format-2 on the form: the same object back, as before.
  const plain = { sections: [{ section_key: "a", label: "A", sort_order: 0, fields: [] }] };
  assert.equal(effectiveTemplateForm(plain, []), plain);
});

test("hidden answers and answers on a skipped page are cleared, even on the raw form", () => {
  assert.deepEqual(pruneHiddenTemplateValues(form(), { tobacco_use: "false", cigarettes: 10, state: "NY", coverage_amount: 15000 }), { tobacco_use: "false", state: "NY" });
});

test("saving: format set, logic checked, the computed page skip never written", () => {
  const effective = effectiveTemplateForm(form(), fields);
  const out = formForSave(effective);
  assert.equal(out.format, 2);
  assert.equal(out.sections[2].fields[0].page_skip, undefined);
  assert.equal(formLogicProblem(out), null);
  const broken = form();
  broken.sections[1].fields[1].logic = { match: "all", rules: [{ field_key: "cigarettes", op: "filled" }, { field_key: "state", op: "filled" }] };
  assert.match(formLogicProblem(broken), /cannot depend on its own answer/);
  assert.equal(formForSave({ sections: [] }).format, undefined);
  assert.equal(formLogicList(form(), fields).length, 2);
});

test("question rules: the board's age message, no future dates, money and try-a-value", () => {
  const dob = { ...fields[0], validation: { age_min: 50, age_max: 85, no_future: true, message: "Final Expense covers ages 50 to 85. This person is {age}." } };
  const fails = checkFieldValue(dob, storedAnswer(dob, "03/14/1932"), today);
  assert.equal(fails.ok, false);
  assert.equal(fails.message, "Final Expense covers ages 50 to 85. This person is 94.");
  assert.equal(fails.short, "Fails · age 94");
  assert.equal(checkFieldValue(dob, "2030-01-01", today).short, "In the future");
  assert.equal(checkFieldValue(dob, "1958-06-02", today).ok, true);
  const money = { ...fields[5], validation: { min: 5000, max: 25000 } };
  assert.equal(checkFieldValue(money, storedAnswer(money, "$50,000")).ok, false);
  assert.equal(checkFieldValue(money, storedAnswer(money, "15000")).ok, true);
});

test("rules intake does not take yet travel in the form, and come back on load", () => {
  const withRules = [{ ...fields[0], validation: { age_min: 50, no_future: true, message: "Too young", placeholder: "MM/DD/YYYY" } }];
  const split = splitFieldRules(withRules, { sections: [] });
  assert.deepEqual(split.fields[0].validation, { age_min: 50 });
  assert.deepEqual(split.form.field_rules, { date_of_birth: { no_future: true, message: "Too young" } });
  assert.deepEqual(mergeFieldRules(split.fields, split.form)[0].validation, { age_min: 50, no_future: true, message: "Too young" });
  assert.equal(splitFieldRules([fields[1]], { sections: [], field_rules: { x: {} } }).form.field_rules, undefined);
});

test("what changed: logic, page skips and the new rules each read as one line with its kind", () => {
  const draft = (over = {}) => ({ name: "Final Expense intake", stages: [], fields: fields.map((field) => ({ ...field, validation: { ...(field.validation ?? {}) } })), form: form(), ...over });
  const saved = draft();
  const next = draft();
  next.form.sections[1].fields[1] = withLogic(next.form.sections[1].fields[1], { match: "all", rules: [{ field_key: "tobacco_use", op: "is", value: "true" }] });
  delete next.form.sections[2].skip_when;
  next.fields[0].validation.no_future = true;
  next.fields.push({ field_key: "email", label: "Email", type: "email", is_required: false, options: [], sort_order: 6 });
  const lines = formChanges(saved, next);
  const titles = lines.map((line) => `${line.kind}: ${line.title}`);
  assert.ok(titles.includes("changed: “Cigarettes a day” shows when Tobacco use is Yes"), titles.join("\n"));
  assert.ok(titles.includes("changed: Page “Coverage” is never skipped"), titles.join("\n"));
  assert.ok(titles.includes("changed: “Date of birth” no longer takes dates in the future"), titles.join("\n"));
  assert.ok(titles.includes("added: “Email” added"), titles.join("\n"));
  assert.ok(!titles.some((title) => /no_future|validation:/.test(title)));
});

test("answers reach the application by name, and the match is shown openly", () => {
  assert.deepEqual(applicationFieldsFor("date_of_birth"), ["Date of birth"]);
  assert.deepEqual(applicationFieldsFor("tobacco_use"), ["Tobacco use"]);
  assert.deepEqual(applicationFieldsFor("best_time_to_call"), []);
});
