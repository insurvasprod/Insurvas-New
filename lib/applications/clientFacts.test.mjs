import { test } from "node:test";
import assert from "node:assert/strict";

const { clientFacts } = await import("./clientFacts.ts");

const qs = [
  { key: "ss_deposit_day", label: "When does your Social Security arrive?", type: "single_select", section: "Before we start", persistency: true },
  { key: "deposit_account", label: "Is the account you'll pay from the one it lands in?", type: "boolean", section: "Before we start", persistency: true },
  { key: "existing_coverage", label: "Do you have any life insurance now?", type: "boolean", section: "Before we start", persistency: true },
  { key: "oxygen", label: "Do you use oxygen?", type: "boolean", section: "Health", knockout: { when: true, note: "Guaranteed issue only." } },
  { key: "medications", label: "What medications do you take?", type: "medication_list", section: "Medications" },
  { key: "tobacco", label: "Tobacco in the last 12 months?", type: "boolean", section: "Lifestyle" },
];
const med = (name, prescribedFor = "") => ({ id: name, name, dose: "", since: "", prescribedFor, prescribedForUnknown: !prescribedFor });

test("the answers read as plain facts with what to do, in the order the call gives them", () => {
  const facts = clientFacts(qs, {
    ss_deposit_day: { value: "3rd Wednesday" }, deposit_account: { value: false }, existing_coverage: { value: true },
    oxygen: { value: true }, tobacco: { value: false },
  }, [med("Metformin", "Diabetes"), med("Furosemide")]);
  assert.deepEqual(facts.map((f) => [f.key, f.tone]), [["deposit", "good"], ["account", "warning"], ["replacement", "warning"], ["ko-oxygen", "danger"], ["meds", "warning"], ["tobacco", "neutral"]]);
  assert.equal(facts[0].title, "Paid on the 3rd Wednesday");
  assert.equal(facts.find((f) => f.key === "ko-oxygen").detail, "Guaranteed issue only.", "a knockout says only the agency's own note");
  assert.match(facts.find((f) => f.key === "meds").detail, /Ask what Furosemide is for/);
});

test("nothing answered, nothing said; a knockout not given is not a fact", () => {
  assert.deepEqual(clientFacts(qs, {}, []), []);
  assert.deepEqual(clientFacts(qs, { oxygen: { value: false } }, []), []);
});
