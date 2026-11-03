import test from "node:test";
import assert from "node:assert/strict";

import { ageOn, appliesToInsured, insuredFacts, interviewQuestions } from "./templates.ts";

const def = {
  fields: [
    { field_key: "heart", label: "Heart trouble?", type: "boolean" },
    { field_key: "cigars", label: "Cigars or a pipe?", type: "boolean" },
    { field_key: "colon", label: "Colonoscopy in ten years?", type: "boolean" },
  ],
  form_definition: {
    sections: [{
      section_key: "health", label: "Health", fields: [
        { field_key: "heart" },
        { field_key: "cigars", applies_to: "tobacco" },
        { field_key: "colon", applies_to: "age_50_plus" },
      ],
    }],
  },
};

test("3.1 Applies to: the stored rule reaches the interview's question", () => {
  const qs = interviewQuestions(def);
  assert.deepEqual(qs.map((q) => q.appliesTo), [null, "tobacco", "age_50_plus"]);
});

test("3.1 Applies to: a tobacco question is asked of a smoker and not of a non-smoker", () => {
  const [, cigars] = interviewQuestions(def);
  assert.equal(appliesToInsured(cigars, { age: 60, tobacco: true }), true);
  assert.equal(appliesToInsured(cigars, { age: 60, tobacco: false }), false);
});

test("3.1 Applies to: the age bands split at 50", () => {
  const [, , colon] = interviewQuestions(def);
  assert.equal(appliesToInsured(colon, { age: 50, tobacco: null }), true);
  assert.equal(appliesToInsured(colon, { age: 49, tobacco: null }), false);
  assert.equal(appliesToInsured({ ...colon, appliesTo: "age_under_50" }, { age: 49, tobacco: null }), true);
});

test("3.1 Applies to: a fact nobody has entered never hides a question", () => {
  for (const q of interviewQuestions(def)) assert.equal(appliesToInsured(q, { age: null, tobacco: null }), true);
});

test("3.1 Applies to: the interview's tobacco answer outranks the application value", () => {
  const values = { "insured.dob": { value: "1960-06-15" }, "insured.tobacco": { value: "no" } };
  assert.deepEqual(insuredFacts(values, {}, new Date(2026, 8, 29)), { age: 66, tobacco: false });
  assert.deepEqual(insuredFacts(values, { tobacco: { value: true } }, new Date(2026, 8, 29)), { age: 66, tobacco: true });
});

test("3.1 Applies to: age is last birthday, and nonsense is unknown", () => {
  assert.equal(ageOn("1960-09-30", new Date(2026, 8, 29)), 65);
  assert.equal(ageOn("1960-09-29", new Date(2026, 8, 29)), 66);
  assert.equal(ageOn("09/29/1960"), null);
  assert.equal(ageOn(null), null);
});
