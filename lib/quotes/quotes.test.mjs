// LA-3.4 / 3.5 print view: the quotation template renders exactly its fields in order, and the
// client sheet's words are plain and carry nothing agent-only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { quotationFieldsOf } = await import("./quotationTemplate.ts");
const { headline, intro, whatItPays, comparisonNote, nextSteps, ordinal } = await import("./plainWords.ts");

const FE_GENERIC = {
  age_basis: "nearest",
  fields: [
    { field_key: "dob", label: "Date of birth", type: "date", is_required: true, options: [], sort_order: 10 },
    { field_key: "gender", label: "Gender", type: "single_select", is_required: true, options: ["Male", "Female"], sort_order: 20 },
    { field_key: "state", label: "State", type: "single_select", is_required: true, options: ["AZ", "TX"], sort_order: 30 },
    { field_key: "tobacco", label: "Tobacco or nicotine in the last 12 months", type: "boolean", is_required: true, options: [], sort_order: 40 },
    { field_key: "face_amount", label: "Face amount", type: "currency", is_required: true, options: [], sort_order: 50 },
    { field_key: "tier", label: "Tier", type: "single_select", is_required: true, options: ["level", "graded", "modified", "gi"], sort_order: 60 },
    { field_key: "riders", label: "Riders", type: "multi_select", is_required: false, options: ["Accidental death"], sort_order: 70 },
  ],
  form_definition: { sections: [{ section_key: "quote", label: "Quote", sort_order: 10, fields: [
    { field_key: "dob", is_required: true }, { field_key: "gender", is_required: true }, { field_key: "state", is_required: true },
    { field_key: "tobacco", is_required: true }, { field_key: "face_amount", is_required: true }, { field_key: "tier", is_required: true },
    { field_key: "riders", is_required: false },
  ] }] },
};

test("3.4: the rendered form's fields match the template exactly, in order", () => {
  const fields = quotationFieldsOf(FE_GENERIC);
  assert.deepEqual(fields.map((f) => f.key), ["dob", "gender", "state", "tobacco", "face_amount", "tier", "riders"]);
  assert.equal(fields.find((f) => f.key === "riders").required, false);
  assert.deepEqual(fields.find((f) => f.key === "gender").options, ["Male", "Female"]);
});

test("3.4: section order wins over field sort order; unlisted fields follow", () => {
  const def = {
    fields: [{ field_key: "a", label: "A", type: "text", sort_order: 1 }, { field_key: "b", label: "B", type: "text", sort_order: 2 }, { field_key: "c", label: "C", type: "text", sort_order: 0 }],
    form_definition: { sections: [{ sort_order: 2, fields: [{ field_key: "a" }] }, { sort_order: 1, fields: [{ field_key: "b" }] }] },
  };
  assert.deepEqual(quotationFieldsOf(def).map((f) => f.key), ["b", "a", "c"]);
  assert.deepEqual(quotationFieldsOf(null), []);
});

const q = (id, tier, monthly, extra = {}) => ({ id, carrierName: id, productLabel: "P", tier, faceAmountCents: 1_500_000, monthlyPremiumCents: monthly, annualPremiumCents: null, termLength: null, wholeLife: true, ...extra });
const three = [q("Gerber", "level", 7_120), q("Mutual", "graded", 6_840), q("Americo", "graded", 6_410)];

test("print: the headline and intro read from the real quotes", () => {
  assert.equal(headline(three), "Three ways to cover $15,000");
  assert.match(intro(three, "Grace"), /^All three pay the same \$15,000 and all three are whole life/);
  assert.match(intro(three, "Grace"), /if Grace passes in the first two years/);
  assert.equal(headline([q("A", "level", 5_000), q("B", "level", 6_000, { faceAmountCents: 1_000_000 })]), "Two coverage options");
});

test("print: tiers are explained in plain words, never an invented carrier rule", () => {
  assert.equal(whatItPays(three[0], "Grace").first, "The full $15,000, from the first day.");
  assert.match(whatItPays(three[1], "Grace").first, /The policy sets out exactly how much\.$/);
  assert.doesNotMatch(whatItPays(three[1], "Grace").first, /10%|plus/);
  const term = whatItPays(q("Banner", "level", 3_000, { termLength: 20, wholeLife: false, faceAmountCents: 50_000_000 }), "Sam");
  assert.equal(term.firstLabel, "If Sam passes during the 20 years");
  assert.equal(term.first, "The full $500,000.");
});

test("print: the comparison notes say only what the numbers show", () => {
  assert.equal(comparisonNote(three[0], three), "Costs the most because it pays in full straight away.");
  assert.equal(comparisonNote(three[1], three), "Cheaper each month, smaller payout in the first two years.");
  assert.equal(comparisonNote(three[2], three), "The lowest monthly payment of the three.");
  assert.equal(comparisonNote(three[0], [three[0]]), null);
});

test("print: the first payment line appears only with a draft day", () => {
  assert.match(nextSteps("Grace", 23), /the 23rd of the month\.$/);
  assert.doesNotMatch(nextSteps("Grace", null), /first payment/);
  assert.equal(ordinal(11), "11th");
  assert.equal(ordinal(22), "22nd");
});

test("3.5: the client sheet has no per-$1,000, commission, advance or appointment", () => {
  const src = readFileSync(new URL("../../components/app/applications/quotes/client-quote-sheet.tsx", import.meta.url), "utf8");
  const code = src.replace(/\/\*\*[\s\S]*?\*\//g, "");
  for (const banned of [/per\s*\$?1,?000/i, /premiumPer1000/, /payout/i, /fyc/i, /commission/i, /advance/i, /appoint/i]) {
    assert.doesNotMatch(code, banned, `client sheet mentions ${banned}`);
  }
});
