import { test } from "node:test";
import assert from "node:assert/strict";

const { BANK_TOPICS, addFromBank, removeFromBank, inDraft } = await import("./questionBank.ts");
const { definitionFromDraft, draftFromDefinition, newUnderwritingDefinition } = await import("./templateDefinition.ts");
const { definitionProblem } = await import("./templateSchemas.ts");
const { feedOfQuestionKey } = await import("../applications/prefill.ts");

const fresh = () => draftFromDefinition(newUnderwritingDefinition());

test("ticking a bank question adds it with its follow-ups, in its own section, and it saves", () => {
  const draft = addFromBank(fresh(), "cancer_2y");
  assert.deepEqual(draft.questions.filter((q) => q.section === "health").map((q) => q.key), ["cancer_2y", "cancer_2y_when", "cancer_2y_type", "cancer_2y_done"]);
  assert.ok(draft.sections.some((s) => s.key === "health" && s.label === "Health"));
  assert.equal(definitionProblem("underwriting", definitionFromDraft(draft)), null, "a template built from the bank is a valid template");
});

test("unticking removes the follow-ups with it; the persistency questions never leave", () => {
  const draft = removeFromBank(addFromBank(fresh(), "diabetes"), "diabetes");
  assert.equal(inDraft(draft, "diabetes"), false);
  assert.equal(inDraft(draft, "diabetes_insulin"), false);
  const kept = removeFromBank(fresh(), "ss_deposit_day");
  assert.equal(inDraft(kept, "ss_deposit_day"), true);
});

test("a question the template already has is left as the agency wrote it", () => {
  const start = fresh();
  start.questions = start.questions.map((q) => (q.key === "decision_maker" ? { ...q, label: "Anyone else deciding with you?" } : q));
  const after = addFromBank(start, "decision_maker");
  assert.equal(after.questions.find((q) => q.key === "decision_maker").label, "Anyone else deciding with you?");
});

test("every knockout in the bank says what it means, and the lifestyle answers fill the application", () => {
  for (const t of BANK_TOPICS) for (const q of t.questions) if (q.knockout) assert.ok(q.knockout.note.trim(), `${q.key} has a note`);
  for (const key of ["height_in", "weight_lb", "tobacco"]) assert.ok(feedOfQuestionKey(key), `${key} fills the application`);
  const everything = BANK_TOPICS.flatMap((t) => t.questions).filter((q) => !q.showWhen).reduce((d, q) => addFromBank(d, q.key), fresh());
  assert.equal(definitionProblem("underwriting", definitionFromDraft(everything)), null, "the whole bank saves as one template");
});
