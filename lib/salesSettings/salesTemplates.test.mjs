// LA-3.1 / 3.4 / 3.7 / 3.17 · Settings › Sales templates: the definition rules the server refuses
// with, and the builder's round trip, checked against the platform seeds themselves.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { underwritingDefinitionSchema, quotationDefinitionSchema, fieldSetDefinitionSchema, definitionProblem, PERSISTENCY_KEYS } = await import("./templateSchemas.ts");
const {
  draftFromDefinition, definitionFromDraft, newUnderwritingDefinition, withQuoteInputs, quoteInputsOn, quoteInputsSummary, quoteValidDays,
  fieldSetEntries, fieldSetFromEntries, knockoutCount, questionCount,
} = await import("./templateDefinition.ts");
const { interviewQuestions } = await import("../applications/templates.ts");

const SEED_SQL = readFileSync(new URL("../../supabase/migrations/20260926100100_la_3_1_sales_templates.sql", import.meta.url), "utf8");
const seeds = [...SEED_SQL.matchAll(/'(underwriting|quotation|application_field_set)', p\.code, null, '([^']+)', 1, 'published', \$def\$([\s\S]*?)\$def\$/g)]
  .map(([, kind, name, json]) => ({ kind, name, definition: JSON.parse(json) }));
const seed = (name) => structuredClone(seeds.find((s) => s.name === name).definition);

test("the four platform seeds are read from the migration", () => {
  assert.deepEqual(seeds.map((s) => s.name).sort(), ["Final Expense — general intake", "Final Expense — generic", "Final Expense — platform default", "Term Life — standard"]);
});

test("3.1: every seeded definition passes the schema the server validates with", () => {
  for (const s of seeds) assert.equal(definitionProblem(s.kind, s.definition), null, `${s.name} is refused`);
});

test("3.1: the five persistency questions are on both seeded underwriting templates and cannot be removed", () => {
  for (const name of ["Final Expense — general intake", "Term Life — standard"]) {
    const def = seed(name);
    for (const key of PERSISTENCY_KEYS) assert.ok(def.fields.some((f) => f.field_key === key && f.persistency === true), `${name} lacks ${key}`);
    def.fields = def.fields.filter((f) => f.field_key !== "decision_maker");
    for (const s of def.form_definition.sections) s.fields = s.fields.filter((f) => f.field_key !== "decision_maker");
    assert.match(definitionProblem("underwriting", def), /persistency question decision_maker cannot be removed/);
  }
});

test("3.1: a new template starts with the five persistency questions and is valid", () => {
  const def = newUnderwritingDefinition();
  assert.equal(underwritingDefinitionSchema.safeParse(def).success, true);
  assert.deepEqual(interviewQuestions(def).filter((q) => q.persistency).map((q) => q.key), [...PERSISTENCY_KEYS]);
});

test("3.1: only a yes / no question carries a knockout, and it needs its note", () => {
  const def = seed("Final Expense — general intake");
  const health = def.form_definition.sections.find((s) => s.section_key === "health");
  health.fields.find((f) => f.field_key === "oxygen").knockout_note = "";
  assert.match(definitionProblem("underwriting", def), /Write the note the agent sees/);
  const def2 = seed("Final Expense — general intake");
  def2.form_definition.sections[0].fields.find((f) => f.field_key === "ss_deposit_day").is_knockout = true;
  def2.form_definition.sections[0].fields.find((f) => f.field_key === "ss_deposit_day").knockout_when = { equals: "true" };
  def2.form_definition.sections[0].fields.find((f) => f.field_key === "ss_deposit_day").knockout_note = "x";
  assert.match(definitionProblem("underwriting", def2), /Only a yes \/ no question can carry a knockout/);
});

test("3.1: a follow-up must come after the question it follows, and wait for an answer it can give", () => {
  const def = seed("Final Expense — general intake");
  const health = def.form_definition.sections.find((s) => s.section_key === "health");
  const i = health.fields.findIndex((f) => f.field_key === "cancer_when");
  const [moved] = health.fields.splice(i, 1);
  health.fields.unshift(moved);
  assert.match(definitionProblem("underwriting", def), /“When was it diagnosed\?” is a follow-up, so it has to come after “Have you been diagnosed with or treated for cancer in the last 3 years\?”/);
  const def2 = seed("Final Expense — general intake");
  def2.form_definition.sections.find((s) => s.section_key === "health").fields.find((f) => f.field_key === "cancer_when").show_when.equals = "maybe";
  assert.match(definitionProblem("underwriting", def2), /waits for an answer “Have you been diagnosed with or treated for cancer in the last 3 years\?” cannot give/);
});

test("3.1: every question type the task names is accepted — yes/no, single, multi, number, date, free text, medication list", () => {
  const def = newUnderwritingDefinition();
  const extra = [
    ["q_single", "single_select", ["A", "B"]], ["q_multi", "multi_select", ["A", "B"]], ["q_number", "number", []], ["q_date", "date", []],
    ["q_text", "text", []], ["q_long", "long_text", []], ["q_meds", "medication_list", []],
  ];
  extra.forEach(([key, type, options], i) => {
    def.fields.push({ field_key: key, label: key, type, is_required: false, options, sort_order: 100 + i, help_text: null });
    def.form_definition.sections[0].fields.push({ field_key: key, is_required: false, show_when: null });
  });
  assert.equal(definitionProblem("underwriting", def), null);
  def.fields.push({ field_key: "q_bad", label: "bad", type: "signature", is_required: false, options: [], sort_order: 999 });
  def.form_definition.sections[0].fields.push({ field_key: "q_bad", is_required: false, show_when: null });
  assert.notEqual(definitionProblem("underwriting", def), null);
});

test("3.1: preview == interview — the builder's round trip leaves interviewQuestions() unchanged for both seeds", () => {
  for (const name of ["Final Expense — general intake", "Term Life — standard"]) {
    const def = seed(name);
    const back = definitionFromDraft(draftFromDefinition(def));
    assert.deepEqual(interviewQuestions(back), interviewQuestions(def), name);
    assert.equal(definitionProblem("underwriting", back), null, `${name} round trip is refused`);
  }
  const fe = seed("Final Expense — general intake");
  assert.equal(knockoutCount(fe), 2);
  assert.equal(questionCount(fe), 16);
});

test("3.1: an edit in the builder reaches the preview through the same converter", () => {
  const draft = draftFromDefinition(seed("Final Expense — general intake"));
  const heart = draft.questions.find((q) => q.key === "heart");
  heart.knockout = { when: "true", note: "Most carriers decline within 2 years of heart failure." };
  const q = interviewQuestions(definitionFromDraft(draft)).find((x) => x.key === "heart");
  assert.deepEqual(q.knockout, { when: true, note: "Most carriers decline within 2 years of heart failure." });
});

test("3.4: switching quote inputs on and off, age basis and validity make a valid quotation definition", () => {
  const generic = seed("Final Expense — generic");
  assert.deepEqual(quoteInputsOn(generic), ["dob", "gender", "state", "tobacco", "face_amount", "tier", "riders"]);
  const next = withQuoteInputs(generic, ["dob", "state", "tobacco", "face_amount", "target_premium"], "last", 14);
  assert.equal(quotationDefinitionSchema.safeParse(next).success, true);
  assert.deepEqual(next.fields.map((f) => f.field_key), ["dob", "state", "tobacco", "face_amount", "target_premium"]);
  assert.deepEqual(next.form_definition.sections[0].fields.map((f) => f.field_key), next.fields.map((f) => f.field_key));
  assert.equal(next.age_basis, "last");
  assert.equal(quoteValidDays(next), 14);
  assert.equal(quoteInputsSummary(next), "DOB, state, tobacco, face amount, target premium");
  // The kept fields are the seed's own, not re-created.
  assert.deepEqual(next.fields.find((f) => f.field_key === "state").options, generic.fields.find((f) => f.field_key === "state").options);
  assert.match(definitionProblem("quotation", withQuoteInputs(generic, [], "nearest", 30)), /at least one input/);
});

test("3.7: a field set round-trips through the editor, and only application fields are allowed", () => {
  const def = seed("Final Expense — platform default");
  const entries = fieldSetEntries(def);
  assert.equal(entries.length, def.required.length + def.optional.length);
  assert.deepEqual(new Set(fieldSetFromEntries(entries).required), new Set(def.required));
  assert.equal(entries.find((e) => e.key === "insured.ssn").sensitive, true);
  const relabelled = fieldSetFromEntries(entries.map((e) => (e.key === "insured.dob" ? { ...e, label: "Birth date" } : e)));
  assert.equal(fieldSetDefinitionSchema.safeParse(relabelled).success, true);
  assert.equal(relabelled.labels["insured.dob"], "Birth date");
  assert.match(definitionProblem("application_field_set", { required: ["insured.first_name", "insured.shoe_size"], optional: [] }), /insured\.shoe_size is not an application field/);
});
