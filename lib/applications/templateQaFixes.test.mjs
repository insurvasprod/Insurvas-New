// Template QA, 2026-10-01: what the demo and the template review turned up.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { missingRequiredAnswers } = await import("./templates.ts");
const { definitionProblem, quotationDefinitionSchema, underwritingDefinitionSchema } = await import("../salesSettings/templateSchemas.ts");
const { withQuoteInputs } = await import("../salesSettings/templateDefinition.ts");

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const q = (key, extra = {}) => ({ key, label: key, type: "boolean", options: [], required: true, section: "s", appliesTo: "all", showWhen: null, knockout: null, ...extra });
const noFacts = { age: null, tobacco: null };

test("the server finds required questions still to ask, by the rule the Interview step shows", () => {
  const questions = [
    q("smoker"),
    q("packs", { type: "number", showWhen: { key: "smoker", equals: "true" } }),
    q("optional", { required: false }),
    q("over50", { appliesTo: "age_50_plus" }),
    q("meds", { type: "medication_list" }),
  ];
  // Nothing answered: the visible required ones are missing; a follow-up whose parent is unanswered is not.
  assert.deepEqual(missingRequiredAnswers(questions, {}, 0, noFacts).map((x) => x.key), ["smoker", "over50", "meds"]);
  // Yes opens the follow-up, which is then required; a 40-year-old is not asked the 50+ question.
  assert.deepEqual(missingRequiredAnswers(questions, { smoker: true }, 1, { age: 40, tobacco: null }).map((x) => x.key), ["packs"]);
  // No hides it again; one medication row answers the list; empty strings and empty arrays are not answers.
  assert.deepEqual(missingRequiredAnswers(questions, { smoker: false, over50: "" }, 1, noFacts).map((x) => x.key), ["over50"]);
  assert.deepEqual(missingRequiredAnswers(questions, { smoker: false, over50: false }, 1, noFacts), []);
});

test("completing an interview is refused on the server while a required question is unanswered", () => {
  const src = read("lib/applications/mutations.ts");
  const fn = src.slice(src.indexOf("export async function completeInterview"), src.indexOf("// ── quotes"));
  assert.match(fn, /missingRequiredAnswers\(/);
  assert.match(fn, /INTERVIEW_INCOMPLETE/);
  assert.ok(fn.indexOf("INTERVIEW_INCOMPLETE") < fn.indexOf('update({ completed_at'), "the check runs before the write");
});

test("leaving the Interview step any way completes it, not only the Continue button", () => {
  const step = read("components/app/applications/workspace/steps/interview-step.tsx");
  assert.match(step, /useEffect\(\(\) => \(\) => \{\s*if \(leave\.current\.complete\) void leave\.current\.run\(\);/);
  assert.match(step, /complete: Boolean\(interview\) && !interview\?\.completedAt && !readOnly && !sample && progress\.allRequired/);
});

test("a whole wrong routing number is flagged as typed, without leaving the field", () => {
  const pay = read("components/app/applications/workspace/steps/payment-step.tsx");
  assert.match(pay, /const routingWhole = digitsOnly\(form\.routing\)\.length >= 9;/);
  assert.match(pay, /error=\{\(checked \|\| routingWhole\) && routingBad \?/);
});

test("a quotation template must ask face amount and date of birth, or no quote could be saved", () => {
  const base = withQuoteInputs({}, ["dob", "state", "face_amount"], "nearest", 30);
  assert.equal(definitionProblem("quotation", base), null);
  assert.match(definitionProblem("quotation", withQuoteInputs({}, ["dob", "state"], "nearest", 30)), /Face amount is always asked/);
  assert.match(definitionProblem("quotation", withQuoteInputs({}, ["state", "face_amount"], "nearest", 30)), /Date of birth is always asked/);
  assert.ok(quotationDefinitionSchema);
  const ui = read("components/app/settings/sales/quotation.tsx");
  assert.match(ui, /const ALWAYS_ASKED = new Set\(\["face_amount", "dob"\]\);/);
  assert.match(ui, /disabled=\{readOnly \|\| always\}/);
});

test("template problems name the question by its text, and the stored definition is the trimmed one", () => {
  const def = {
    fields: [{ field_key: "new_question", label: "Heart attack in the last 2 years?", type: "boolean", options: [], sort_order: 0, persistency: false }],
    form_definition: { sections: [{ section_key: "health", label: "Health", sort_order: 0, fields: [{ field_key: "new_question", is_required: true, is_knockout: true, knockout_when: { equals: "true" }, knockout_note: "" }] }] },
  };
  const issues = underwritingDefinitionSchema.safeParse(def).error.issues.map((i) => i.message);
  assert.ok(issues.includes("Write the note the agent sees when “Heart attack in the last 2 years?” knocks a carrier out"), issues.join(" | "));
  const src = read("lib/salesSettings/templates.ts");
  assert.match(src, /function validDefinition\(/);
  assert.doesNotMatch(src, /definition: input\.definition/);
});

test("a knockout never reads as a bare 'Knockout —'", () => {
  assert.match(read("components/app/applications/workspace/interview/question-input.tsx"), /Knockout — \{q\.knockout\.note\?\.trim\(\) \|\| "this answer rules this carrier out\."\}/);
});

// ── 2026-10-01, second round: the field picker, quote inputs, publishing ──────────────────────

const { feedOfQuestionKey, INTERVIEW_FEEDS, prefillFromInterview } = await import("./prefill.ts");
const { scopeRatingInputs } = await import("../quotes/quotationTemplate.ts");

test("a question picked to fill an application field gets the key the application already reads", () => {
  assert.deepEqual(INTERVIEW_FEEDS.map((f) => f.key), ["height_in", "weight_lb", "tobacco"]);
  for (const f of INTERVIEW_FEEDS) assert.equal(feedOfQuestionKey(f.key)?.field, f.field);
  assert.equal(feedOfQuestionKey("height")?.field, "insured.height_in", "older synonyms still count");
  assert.equal(feedOfQuestionKey("new_question"), null);
  // The picked keys are exactly what the application prefill reads.
  assert.deepEqual(prefillFromInterview({ height_in: 70, weight_lb: 185, tobacco: false }), [
    { key: "insured.height_in", value: 70 }, { key: "insured.weight_lb", value: 185 }, { key: "insured.tobacco", value: "no" },
  ]);
  const b = read("components/app/settings/sales/templates-builder.tsx");
  assert.match(b, /label="Fills on the application"/);
  assert.match(b, /const rekey = \(from: string, to: string\) =>/);
  assert.match(b, /showWhen: q\.showWhen\?\.key === from \? \{ \.\.\.q\.showWhen, key: to \}/, "follow-ups move with the key");
});

test("a question that fills an application field must answer in that field's shape", () => {
  const def = (type) => ({
    fields: [{ field_key: "height_in", label: "How tall are you?", type, options: type === "single_select" ? ["Short", "Tall"] : [], sort_order: 0 }],
    form_definition: { sections: [{ section_key: "health", label: "Health", sort_order: 0, fields: [{ field_key: "height_in", is_required: true }] }] },
  });
  const issues = (type) => underwritingDefinitionSchema.safeParse(def(type)).error?.issues.map((i) => i.message) ?? [];
  assert.ok(issues("text").some((m) => m === "“How tall are you?” fills Height (inches) on the application, so its answer type has to be a number"));
  assert.ok(!issues("number").some((m) => /fills Height/.test(m)));
});

test("a quote keeps only its template's inputs, and a required one left empty is refused", () => {
  const fields = [
    { key: "dob", label: "Date of birth", type: "date", required: true, options: [] },
    { key: "gender", label: "Gender", type: "single_select", required: true, options: [] },
    { key: "face_amount", label: "Face amount", type: "currency", required: true, options: [] },
    { key: "riders", label: "Riders", type: "multi_select", required: true, options: [] },
  ];
  const sent = { dob: "1968-04-12", gender: "", state: "AZ", tobacco: "no", face_amount: 2500000, riders: [], age_basis: "nearest", term_length: 20 };
  const r = scopeRatingInputs(fields, sent, { faceAmountCents: 2500000, tier: "level", dob: "1968-04-12" });
  assert.deepEqual(r.missing, ["Gender"], "riders count as answered; face and dob come from the quote");
  assert.equal("state" in r.inputs, false, "switched-off inputs are not stored");
  assert.equal("tobacco" in r.inputs, false);
  assert.equal(r.inputs.term_length, 20, "the quote's own facts are always kept");
  assert.deepEqual(scopeRatingInputs(fields, { ...sent, gender: "male" }, { faceAmountCents: 2500000, tier: "level", dob: "1968-04-12" }).missing, []);
  const m = read("lib/applications/mutations.ts");
  assert.match(m, /QUOTE_INPUT_REQUIRED/);
  assert.match(m, /freezeRatingInputs\(sentInputs,/);
  const form = read("components/app/applications/quotes/add-quote-form.tsx");
  assert.match(form, /required by this quotation template\./);
  assert.match(form, /\.\.\.Object\.fromEntries\(fields\.map\(\(f\) => \[f\.key, valueFor\(f\.key\)\]\)\)/);
});

test("publishing always retires the versions it replaces", () => {
  const src = read("lib/salesSettings/templates.ts");
  const fn = src.slice(src.indexOf("export async function publishSalesTemplate"), src.indexOf("export async function retireSalesTemplate"));
  assert.doesNotMatch(fn, /if \(input\.retire_previous\)/);
  assert.match(fn, /update\(\{ status: "retired" \}\)/);
  const dialog = read("components/app/settings/sales/templates-dialogs.tsx");
  assert.match(dialog, /is retired at the same time\./);
  assert.doesNotMatch(dialog, /stays published beside it/);
});

test("clearing an application field removes its value instead of failing the one-form check", () => {
  const src = read("lib/applications/mutations.ts");
  const fn = src.slice(src.indexOf("export async function saveValues"), src.indexOf("export async function markReviewed"));
  assert.match(fn, /const cleared = values\.filter\(\(v\) => v\.value === null \|\| v\.value === ""\)/);
  assert.match(fn, /\.delete\(\)\.eq\("tenant_id", actor\.tenantId\)\.eq\("application_id", a\.id\)\.in\("field_key", cleared\)/);
  assert.doesNotMatch(fn, /values\.map\(\(v\) => \(\{ application_id: a\.id[^)]*value: v\.value, value_ciphertext: null/, "a null value is never upserted as a row");
});

test("a second beneficiary joins the primaries and splits evenly, not 100% and 100%", async () => {
  const { splitEvenly } = await import("./beneficiaries.ts");
  assert.deepEqual(splitEvenly(2), [5000, 5000]);
  assert.deepEqual(splitEvenly(3), [3334, 3333, 3333]);
  const step = read("components/app/applications/workspace/steps/beneficiaries-step.tsx");
  const fn = step.slice(step.indexOf("  function add() {"), step.indexOf("  /** Each tier divides"));
  assert.match(fn, /tier: "primary"/);
  assert.doesNotMatch(fn, /"contingent"/, "a new row is never put in the contingent tier for you");
  assert.match(fn, /if \(left <= 0\) \{[\s\S]*splitEvenly\(ids\.length\)/);
});
