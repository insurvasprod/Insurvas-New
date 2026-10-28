// Run with: node --experimental-strip-types --test lib/templates/formTemplatesC.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { TEMPLATE_FIELD_TYPES } from "./constants.ts";
import { COMMON_FIELD_TYPES, REQUIRED_CHOICE_LABELS, TEMPLATE_FIELD_PLAIN, applyRequiredChoice, requiredChoice, requiredChoices } from "./plainLabels.ts";
import { questionSentence } from "./questionSentence.ts";
import { fieldMoveBounds, moveFieldWithinSection, moveSection } from "./formMoves.ts";
import { automaticWidth, placementWidth } from "./placementWidth.ts";
import { readFileSync } from "node:fs";

const field = (over = {}) => ({ field_key: "coverage_amount", label: "Coverage amount", type: "currency", is_required: false, options: [], sort_order: 0, help_text: null, validation: {}, ...over });
const placement = (over = {}) => ({ field_key: "coverage_amount", is_required: false, show_when: null, ...over });

test("every stored answer type has a plain label and hint, and the common ones are real types", () => {
  for (const type of TEMPLATE_FIELD_TYPES) {
    assert.ok(TEMPLATE_FIELD_PLAIN[type]?.label, type);
    assert.ok(TEMPLATE_FIELD_PLAIN[type]?.hint, type);
  }
  assert.equal(Object.keys(TEMPLATE_FIELD_PLAIN).length, TEMPLATE_FIELD_TYPES.length);
  for (const type of COMMON_FIELD_TYPES) assert.ok(TEMPLATE_FIELD_TYPES.includes(type), type);
});

test("the required choice reads today's two flags", () => {
  assert.equal(requiredChoice({ is_required: true }, placement()), "always");
  assert.equal(requiredChoice({ is_required: true }, placement({ is_required: true })), "always");
  assert.equal(requiredChoice({ is_required: false }, placement({ is_required: true })), "form");
  assert.equal(requiredChoice({ is_required: false }, placement()), "no");
  assert.equal(requiredChoice({ is_required: false }, null), "no");
  assert.equal(REQUIRED_CHOICE_LABELS.form, "Only on this form");
});

test("each choice sets the flags it reads back as", () => {
  for (const choice of ["always", "form", "no"]) {
    const flags = applyRequiredChoice(choice, true);
    assert.equal(requiredChoice({ is_required: flags.field }, placement({ is_required: flags.placement })), choice);
  }
  assert.deepEqual(applyRequiredChoice("always", false), { field: true, placement: null });
  assert.deepEqual(applyRequiredChoice("no", false), { field: false, placement: null });
  assert.deepEqual(requiredChoices(null), ["always", "no"]);
  assert.deepEqual(requiredChoices(placement()), ["always", "form", "no"]);
});

test("the sentence says what partners will experience", () => {
  assert.equal(
    questionSentence(field({ validation: { min: 10000, max: 2000000 } }), placement()),
    "Partners see “Coverage amount” and type an amount of money. It must be $10,000 to $2,000,000. They can skip it.",
  );
  assert.equal(
    questionSentence(field({ field_key: "date_of_birth", label: "Date of birth", type: "date", is_required: true, validation: { age_min: 18, age_max: 80 } }), placement()),
    "Partners see “Date of birth” and pick a date. They must be 18 to 80 years old. They must answer it.",
  );
  assert.equal(
    questionSentence(field({ label: "Tobacco type", type: "single_select", options: ["Cigarettes", "Cigars", "Vape", "Chew"] }), placement({ show_when: { field_key: "tobacco_use", equals: "Yes" } }), { label: "Tobacco use", equals: "Yes" }),
    "Partners see “Tobacco type” and pick one of 4 choices. They can skip it. They only see it after answering “Yes” to “Tobacco use”.",
  );
  assert.equal(
    questionSentence(field({ label: "Term length", type: "single_select", options: ["10 years"] }), placement({ is_required: true })),
    "Partners see “Term length” and can only pick its one choice. Partners must answer it here.",
  );
});

test("limits read naturally with one end set, and only where the type has them", () => {
  assert.match(questionSentence(field({ type: "number", validation: { min: 3 } }), placement()), /It must be at least 3\./);
  assert.match(questionSentence(field({ type: "text", validation: { max_length: 40 } }), placement()), /It must be at most 40 characters long\./);
  assert.doesNotMatch(questionSentence(field({ type: "boolean", validation: { min: 1 } }), placement()), /must be/);
});

test("every type gets a sentence, and an empty list says so", () => {
  for (const type of TEMPLATE_FIELD_TYPES) assert.match(questionSentence(field({ type }), placement()), /^Partners see “Coverage amount” and .+\./, type);
  assert.match(questionSentence(field({ type: "multi_select" }), placement()), /no choices yet/);
});

test("a field kept on the lead only is described for agents", () => {
  assert.equal(questionSentence(field({ label: "Lead source notes", type: "long_text" }), null), "Partners never see “Lead source notes”; your agents fill it in. It can be left empty.");
  assert.match(questionSentence(field({ is_required: true }), null), /A lead can’t be saved without it\./);
});

const form = () => ({
  sections: [
    { section_key: "a", label: "A", sort_order: 0, fields: [{ field_key: "x", is_required: false, show_when: null }, { field_key: "y", is_required: false, show_when: null }] },
    { section_key: "b", label: "B", sort_order: 1, fields: [] },
  ],
  section_availability: { banking: false },
});

test("sections and questions move one step, and never past either end", () => {
  assert.deepEqual(moveSection(form(), "b", -1).sections.map((s) => s.section_key), ["b", "a"]);
  assert.equal(moveSection(form(), "a", -1).sections[0].section_key, "a");
  assert.deepEqual(moveSection(form(), "b", -1).section_availability, { banking: false });
  assert.deepEqual(moveFieldWithinSection(form(), "a", "y", -1).sections[0].fields.map((f) => f.field_key), ["y", "x"]);
  const same = form();
  assert.equal(moveFieldWithinSection(same, "a", "y", 1), same);
  assert.deepEqual(fieldMoveBounds(form(), "a", "x"), { up: false, down: true });
  assert.deepEqual(fieldMoveBounds(form(), "a", "y"), { up: true, down: false });
  assert.deepEqual(fieldMoveBounds(form(), "b", "x"), { up: false, down: false });
});

test("a question's width: the owner's choice, else today's rule (long text and pick several full)", () => {
  for (const type of TEMPLATE_FIELD_TYPES) assert.equal(automaticWidth({ type }), type === "long_text" || type === "multi_select" ? "full" : "half", type);
  assert.equal(placementWidth({ type: "text" }, null), "half");
  assert.equal(placementWidth({ type: "text" }, placement({ width: "full" })), "full");
  assert.equal(placementWidth({ type: "long_text" }, placement({ width: "half" })), "half");
  assert.equal(placementWidth({ type: "long_text" }, placement()), "full");
});

test("the partner form takes its full rows from placementWidth, and the schema keeps the width", () => {
  const portal = readFileSync(new URL("../../components/partner/partner-portal-workspace.tsx", import.meta.url), "utf8");
  assert.match(portal, /placementWidth\(field, formField\) === "full"/);
  // zod drops keys it does not know, so the width must be in the schema to reach the database.
  const schemas = readFileSync(new URL("./schemas.ts", import.meta.url), "utf8");
  assert.match(schemas, /width: z\.enum\(\["half", "full"\]\)\.optional\(\)/);
});
