// LA-3 acceptance audit (docs/la3/ACCEPTANCE-AUDIT.md) — the criteria that had code but no test, and
// the rules added to close the gaps the audit found. Each test names its criterion.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const { runQa } = await import("./qa.ts");
const { FIXTURE_ATTEMPT, FIXTURE_CASE } = await import("./fixtures.ts");
const { genericTransitionRefusal } = await import("./transitionRules.ts");
const { hiddenAnswerKeys, interviewQuestions } = await import("./templates.ts");
const { disclosureChanges } = await import("./disclosureRules.ts");
const { prefillFromQuote, QUOTE_MAY_REPLACE } = await import("./prefill.ts");
const { buildSalesReport } = await import("./reportRules.ts");
const { pickQuotationTemplate, freezeRatingInputs } = await import("../quotes/quotationTemplate.ts");
const { checkQuote, bandFallback } = await import("../quotes/math.ts");
const { parseDollarsToCents } = await import("../money.ts");
const { FILLABLE_FIELD_MAP_STATUSES, EDITABLE_FIELD_MAP_STATUSES } = await import("../extension/constants.ts");

// ── 3.11 · every blocking rule, with a passing and a failing input ──────────

const TODAY = new Date("2026-09-29T12:00:00Z");
const acknowledged = (a) => ({ ...a, disclosures: a.disclosures.map((d) => ({ ...d, status: "acknowledged", method: "read_aloud" })) });
const BASE = acknowledged(structuredClone(FIXTURE_ATTEMPT));
const qa = (attempt, settings) => runQa({ caseId: FIXTURE_CASE.caseId, attempt, interview: FIXTURE_CASE.interviews.primary, today: TODAY, settings });
const blockingCodes = (v) => v.blocking.map((i) => i.code);

test("3.11: the fixture with its disclosure acknowledged passes every blocking rule", () => {
  const v = qa(BASE);
  assert.notEqual(v.verdict, "fail", JSON.stringify(v.blocking));
  assert.deepEqual(v.blocking, []);
});

const FAILING = {
  QA_NO_QUOTE: (a) => ({ ...a, selectedQuoteId: null }),
  QA_REQUIRED_FIELD: (a) => { const values = { ...a.values }; delete values["addr.zip"]; return { ...a, values }; },
  BENEFICIARY_PRIMARY_TOTAL: (a) => ({ ...a, beneficiaries: a.beneficiaries.map((b) => (b.id === "b1" ? { ...b, share_bp: 4_999 } : b)) }),
  BENEFICIARY_NO_PRIMARY: (a) => ({ ...a, beneficiaries: a.beneficiaries.filter((b) => b.tier === "contingent") }),
  BENEFICIARY_CONTINGENT_TOTAL: (a) => ({ ...a, beneficiaries: a.beneficiaries.map((b) => (b.tier === "contingent" ? { ...b, share_bp: 9_000 } : b)) }),
  BENEFICIARY_NAME: (a) => ({ ...a, beneficiaries: a.beneficiaries.map((b) => (b.id === "b1" ? { ...b, last_name: "" } : b)) }),
  BENEFICIARY_RELATIONSHIP_OTHER: (a) => ({ ...a, beneficiaries: a.beneficiaries.map((b) => (b.id === "b1" ? { ...b, relationship: "other", relationship_other: "" } : b)) }),
  QA_DISCLOSURE: () => structuredClone(FIXTURE_ATTEMPT),
  QA_PAYMENT_MISSING: (a) => ({ ...a, payment: null }),
  QA_ROUTING: (a) => ({ ...a, payment: { ...a.payment, routing: { masked: "••••", hasValue: false } } }),
  QA_ACCOUNT: (a) => ({ ...a, payment: { ...a.payment, account: { masked: "••••", hasValue: false } } }),
  QA_ACCOUNT_TYPE: (a) => ({ ...a, payment: { ...a.payment, accountType: null } }),
  QA_CARD: (a) => ({ ...a, payment: { ...a.payment, method: "debit_card", card: { masked: "••••", hasValue: false, brand: null, expMonth: null, expYear: null } } }),
  QA_CARD_EXPIRED: (a) => ({ ...a, payment: { ...a.payment, method: "credit_card", card: { masked: "••••1111", hasValue: true, brand: "visa", expMonth: 1, expYear: 2024 } } }),
  QA_DRAFT_DAY: (a) => ({ ...a, payment: { ...a.payment, draftDay: null } }),
  QA_ISSUE_AGE: (a) => ({ ...a, product: { ...a.product, issueAgeMax: 70 } }),
  QA_FACE_LIMIT: (a) => ({ ...a, product: { ...a.product, faceMaxCents: 500_000 } }),
};

for (const [code, mutate] of Object.entries(FAILING)) {
  test(`3.11: ${code} — passes on the clean fixture, blocks when broken, with a deep link`, () => {
    assert.ok(!blockingCodes(qa(BASE)).includes(code), `${code} fired on the passing input`);
    const v = qa(mutate(structuredClone(BASE)));
    assert.equal(v.verdict, "fail");
    const item = v.blocking.find((i) => i.code === code);
    assert.ok(item, `${code} did not block: ${blockingCodes(v).join(", ")}`);
    assert.match(item.deepLink, new RegExp(`^/app/applications/${FIXTURE_CASE.caseId}\\?attempt=2&insured=primary&step=${item.step}`));
  });
}

test("3.11: a missing appointment warns by default and blocks when the agency says so (LA-3.17)", () => {
  const unappointed = { ...BASE, appointment: { ok: false, reason: "No Mutual of Omaha appointment in TX." } };
  assert.ok(qa(unappointed).warnings.some((i) => i.code === "QA_APPOINTMENT"));
  assert.ok(!blockingCodes(qa(unappointed)).includes("QA_APPOINTMENT"));
  assert.ok(blockingCodes(qa(unappointed, { appointmentBlocks: true, per1000Band: { min: 0.5, max: 15 } })).includes("QA_APPOINTMENT"));
});

test("3.19: Direct Express outside the Mastercard BIN warns and does not block", () => {
  const de = { ...BASE, payment: { ...BASE.payment, method: "direct_express", card: { masked: "••••1111", hasValue: true, brand: "visa", expMonth: 12, expYear: 2030 } } };
  const v = qa(de);
  assert.ok(v.warnings.some((i) => i.code === "QA_DIRECT_EXPRESS_BIN"));
  assert.ok(!blockingCodes(v).some((c) => c.startsWith("QA_DIRECT")));
});

test("3.25: QA judges a quote by its product's own band before the agency's", () => {
  const productBand = { ...BASE, product: { ...BASE.product, band: { min: 7, max: 9 } } };
  assert.ok(qa(productBand).warnings.some((i) => i.code === "QA_PER1000"), "6.84 is outside the product's 7–9");
  assert.ok(!qa(BASE).warnings.some((i) => i.code === "QA_PER1000"), "6.84 is inside the agency's 0.5–15");
  const term = { ...BASE, productCode: "term_life", product: { ...BASE.product, band: null } };
  assert.ok(!qa(term).warnings.some((i) => i.code === "QA_PER1000"), "term with no band of its own is not judged");
});

// ── STATUS-MODEL §4 · edges that carry their own record ─────────────────────

test("3.18 / 3.26 / 3.15: the bare transition route refuses the edges their own services own", () => {
  assert.equal(genericTransitionRefusal("pending_carrier", null)?.code, "TRANSITION_USE_REQUIREMENT");
  assert.equal(genericTransitionRefusal("counteroffer_pending", null)?.code, "TRANSITION_USE_COUNTEROFFER");
  assert.equal(genericTransitionRefusal("closed", "declined_by_client")?.code, "TRANSITION_USE_COUNTEROFFER_ANSWER");
  assert.equal(genericTransitionRefusal("closed", "offer_expired")?.code, "TRANSITION_USE_COUNTEROFFER_ANSWER");
  assert.equal(genericTransitionRefusal("submitted", null)?.code, "TRANSITION_USE_SUBMISSION");
  for (const [to, outcome] of [["ready", null], ["draft", null], ["closed", "issued"], ["closed", "declined"], ["closed", "postponed"], ["closed", "withdrawn"]]) {
    assert.equal(genericTransitionRefusal(to, outcome), null, `${to}/${outcome}`);
  }
  // The services that own those edges move the attempt through the SQL writer themselves, not transition().
  const req = read("lib/applications/requirements.ts");
  const co = read("lib/applications/counteroffers.ts");
  assert.match(req, /moveAttempt\(actor, a\.id, "pending_carrier"/);
  assert.match(co, /moveAttempt\(actor, a\.id, "counteroffer_pending"/);
  assert.doesNotMatch(req + co, /from "\.\/mutations"/);
});

test("3.18: satisfying a requirement never moves the attempt — issue is only recorded from the carrier's notice", () => {
  const src = read("lib/applications/requirements.ts");
  const update = src.slice(src.indexOf("export async function updateRequirement"), src.indexOf("export async function chaseRequirement"));
  assert.ok(update.length > 100);
  assert.doesNotMatch(update, /moveAttempt|application_transition/);
});

// ── 3.1 · hidden follow-up answers are not stored ───────────────────────────

const DEF = {
  fields: [
    { field_key: "cancer", label: "Cancer?", type: "boolean" },
    { field_key: "cancer_when", label: "When?", type: "date" },
    { field_key: "cancer_treated", label: "Still treated?", type: "boolean" },
    { field_key: "heart", label: "Heart?", type: "boolean" },
  ],
  form_definition: { sections: [{ section_key: "h", label: "Health", fields: [
    { field_key: "cancer" },
    { field_key: "cancer_when", show_when: { field_key: "cancer", equals: "true" } },
    { field_key: "cancer_treated", show_when: { field_key: "cancer_when", equals: "2024-01-01" } },
    { field_key: "heart" },
  ] }] },
};

test("3.1: the server finds hidden follow-up answers from the template itself, chained follow-ups included", () => {
  const qs = interviewQuestions(DEF);
  assert.deepEqual(hiddenAnswerKeys(qs, { cancer: true, cancer_when: "2024-01-01", cancer_treated: true, heart: false }), []);
  assert.deepEqual(hiddenAnswerKeys(qs, { cancer: false, cancer_when: "2024-01-01", cancer_treated: true, heart: false }), ["cancer_when", "cancer_treated"]);
  assert.deepEqual(hiddenAnswerKeys(qs, { cancer: true, cancer_when: "2023-05-01", cancer_treated: true }), ["cancer_treated"]);
  // An unanswered hidden question is not "stored", so there is nothing to remove.
  assert.deepEqual(hiddenAnswerKeys(qs, { cancer: false }), []);
  // saveAnswers runs it on the merged answers and records removals after the call.
  const src = read("lib/applications/mutations.ts");
  assert.match(src, /hiddenAnswerKeys\(questions, merged\)/);
  assert.match(src, /tenant_uw_answer_changes/);
});

test("3.2: amending the medication list after the call leaves an audit row", () => {
  const src = read("lib/applications/mutations.ts");
  const meds = src.slice(src.indexOf("export async function saveMedications"), src.indexOf("export async function completeInterview"));
  assert.match(meds, /completed_at/);
  assert.match(meds, /tenant_uw_answer_changes"\)\.insert\(\{ interview_id: interviewId, tenant_id: actor\.tenantId, question_key: "medications"/);
  // The record goes first: an amendment that could not be recorded is not made.
  assert.ok(meds.indexOf("tenant_uw_answer_changes") < meds.indexOf('from("tenant_medications").delete()'));
});

// ── 3.10 · a new disclosure version never displaces an acknowledged one ─────

test("3.10: an acknowledged disclosure keeps its version; a new version is not added beside it", () => {
  const codeOf = new Map([["replacement-v2", "REPLACEMENT_NOTICE"], ["exchange-v1", "1035_EXCHANGE"]]);
  const r = disclosureChanges({ apply: new Set(["replacement-v2"]), current: [{ disclosureId: "replacement-v1", status: "acknowledged", code: "REPLACEMENT_NOTICE" }], codeOf });
  assert.deepEqual(r, { add: [], drop: [] });
  // Not yet acknowledged: the old version's required row is swapped for the live one.
  const s = disclosureChanges({ apply: new Set(["replacement-v2"]), current: [{ disclosureId: "replacement-v1", status: "required", code: "REPLACEMENT_NOTICE" }], codeOf });
  assert.deepEqual(s, { add: ["replacement-v2"], drop: ["replacement-v1"] });
  // "Not applicable" settles the code too; a disclosure that stops applying is dropped only while required.
  const t = disclosureChanges({ apply: new Set(["exchange-v1"]), current: [{ disclosureId: "replacement-v1", status: "not_applicable", code: "REPLACEMENT_NOTICE" }], codeOf });
  assert.deepEqual(t, { add: ["exchange-v1"], drop: [] });
});

// ── 3.4 / 3.5 · templates per carrier, frozen inputs, cents ─────────────────

const T = "tenant-1";
const tpl = (id, over) => ({ id, version: 1, tenant_id: null, carrier_id: null, product_code: "final_expense", ...over });

test("3.4: a carrier's own quotation template is chosen for that carrier, the general one for the rest", () => {
  const rows = [tpl("generic"), tpl("mutual", { carrier_id: "c-mutual" }), tpl("aetna-mine", { carrier_id: "c-aetna", tenant_id: T }), tpl("aetna-platform", { carrier_id: "c-aetna", version: 3 }), tpl("other-tenant", { tenant_id: "tenant-2", carrier_id: "c-gerber" }), tpl("term", { product_code: "term_life" })];
  assert.equal(pickQuotationTemplate(rows, { productCode: "final_expense", carrierId: "c-mutual", tenantId: T })?.id, "mutual");
  assert.equal(pickQuotationTemplate(rows, { productCode: "final_expense", carrierId: "c-aetna", tenantId: T })?.id, "aetna-mine", "the agency's own beats a newer platform one");
  assert.equal(pickQuotationTemplate(rows, { productCode: "final_expense", carrierId: "c-gerber", tenantId: T })?.id, "generic", "another agency's template is never offered");
  assert.equal(pickQuotationTemplate(rows, { productCode: "final_expense", carrierId: null, tenantId: T })?.id, "generic");
  assert.equal(pickQuotationTemplate(rows, { productCode: "term_life", carrierId: "c-mutual", tenantId: T })?.id, "term", "the case's product line comes first");
  assert.equal(pickQuotationTemplate([], { productCode: null, carrierId: null, tenantId: T }), null);
});

test("3.5: a saved quote's rating inputs always hold the facts it was rated on", () => {
  const frozen = freezeRatingInputs({}, { faceAmountCents: 1_000_000, tier: "level", dob: "1953-03-14", ageBasis: "nearest", ageUsed: 74, termLength: null, healthClass: null });
  assert.deepEqual(frozen, { face_amount: 1_000_000, tier: "level", dob: "1953-03-14", age_basis: "nearest", age_used: 74 });
  const kept = freezeRatingInputs({ gender: "female", tobacco: "no", tier: "graded" }, { faceAmountCents: 500_000_00, tier: "level", dob: null, ageBasis: "last", ageUsed: null, termLength: 20, healthClass: "Standard" });
  assert.equal(kept.gender, "female");
  assert.equal(kept.tier, "level", "the row's own tier wins");
  assert.equal(kept.term_length, 20);
  assert.equal(kept.health_class, "Standard");
});

test("3.5: $68.40 reads back as exactly 6840 cents; the API takes integer cents only", () => {
  assert.equal(parseDollarsToCents("68.40"), 6_840);
  assert.equal(parseDollarsToCents("$68.4"), 6_840);
  assert.equal(parseDollarsToCents("68.405"), null);
  const schemas = read("lib/applications/schemas.ts");
  assert.match(schemas, /const cents = z\.number\(\)\.int\(\)/);
  assert.match(schemas, /monthly_premium_cents: cents\.positive\(\)/);
});

test("3.25: bands resolve per product — $500k term is not judged by the FE band, $500k FE is", () => {
  const face = 50_000_000;
  const monthly = 3_000;
  assert.deepEqual(checkQuote({ monthlyPremiumCents: monthly, faceCents: face, age: 45, band: bandFallback("term_life") }).warnings, []);
  assert.ok(checkQuote({ monthlyPremiumCents: monthly, faceCents: face, age: 70, band: bandFallback("final_expense") }).warnings.some((w) => w.code === "QUOTE_PER1000_BAND"));
  // A product's own face limit warns and still saves.
  const capped = checkQuote({ monthlyPremiumCents: 30_000, faceCents: face, age: 70, band: bandFallback("final_expense"), faceMaxCents: 5_000_000 });
  assert.equal(capped.error, null);
  assert.ok(capped.warnings.some((w) => w.code === "QUOTE_FACE_MAX"));
});

// ── 3.7 · the application from a selected quote ─────────────────────────────

test("3.7: a selected quote's rating inputs prefill DOB, gender, tobacco and state, never over what a person typed", () => {
  assert.deepEqual(prefillFromQuote({ dob: "1953-03-14", gender: "female", tobacco: "no", state: "tx", face_amount: 1_000_000 }), [
    { key: "insured.dob", value: "1953-03-14" },
    { key: "insured.gender", value: "female" },
    { key: "insured.tobacco", value: "no" },
    { key: "addr.state", value: "TX" },
  ]);
  assert.deepEqual(prefillFromQuote({ dob: "", gender: "", tobacco: null, state: "Texas" }), []);
  assert.deepEqual(prefillFromQuote(null), []);
  assert.deepEqual([...QUOTE_MAY_REPLACE].sort(), ["carried_forward", "lead", "quote"]);
  assert.ok(!QUOTE_MAY_REPLACE.includes("manual") && !QUOTE_MAY_REPLACE.includes("interview") && !QUOTE_MAY_REPLACE.includes("household"));
});

test("3.7: list reads carry no SSN, bank or card value", () => {
  for (const f of ["lib/applications/lists.ts", "lib/applications/pending.ts", "lib/applications/report.ts"]) {
    assert.doesNotMatch(read(f), /ciphertext|_last4|insured\.ssn|routing_number|account_number|card_number/, f);
  }
  const service = read("lib/applications/service.ts");
  const list = service.slice(service.indexOf("export async function listApplications"));
  assert.doesNotMatch(list, /ciphertext|_last4|tenant_application_values|tenant_application_payment_methods/);
});

// ── 3.16 · what a new attempt carries ───────────────────────────────────────

test("3.16: attempt N+1 carries insured, contact, address, owner, beneficiaries and payment — not quote, coverage, disclosures or QA", () => {
  const sql = read("supabase/migrations/20260926100900_la_3_16_attempts.sql");
  const fn = sql.slice(sql.indexOf("create or replace function public.open_next_attempt"), sql.indexOf("revoke all on function public.open_next_attempt"));
  assert.match(fn, /attempt_no \+ 1, a\.id/, "attempt_no N+1 and supersedes");
  for (const group of ["insured.%", "contact.%", "addr.%", "owner.%"]) assert.ok(fn.includes(`'${group}'`), group);
  assert.doesNotMatch(fn, /'cov\.%'|tenant_quotes|tenant_application_disclosures|tenant_application_submissions|tenant_copy_assist_ticks|quote_id|carrier_id,/);
  assert.match(fn, /insert into tenant_application_beneficiaries/);
  assert.match(fn, /insert into tenant_application_payment_methods/);
  // The app re-encrypts the carried SSN and bank / card numbers for the new attempt.
  const mutations = read("lib/applications/mutations.ts");
  assert.match(mutations, /encryptSensitive\(plain, \{ tenantId: actor\.tenantId, applicationId: nextId, fieldKey: "insured\.ssn" \}\)/);
});

// ── 3.19 · no CVV anywhere ──────────────────────────────────────────────────

test("3.19: no CVV — no migration declares the column and the payment API refuses the key", () => {
  const dir = join(ROOT, "supabase/migrations");
  const offenders = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, f), "utf8");
    if (/^\s*(add column (if not exists )?)?"?(cvv|cvc|cvv2|security_code)"?\s+(text|varchar|char|integer|smallint|bigint)/im.test(sql)) offenders.push(f);
  }
  assert.deepEqual(offenders, []);
  const schemas = read("lib/applications/schemas.ts");
  const payment = schemas.slice(schemas.indexOf("export const paymentSchema"), schemas.indexOf("export const draftDaySchema"));
  assert.match(payment, /\}\)\.strict\(\);/);
  assert.doesNotMatch(payment, /cvv|cvc|security/i);
});

// ── 3.13 · only an approved map fills ───────────────────────────────────────

test("3.13: a draft or in-review map is never used by a fill; a flagged map still is", () => {
  for (const s of ["draft", "in_review", "retired"]) assert.ok(!FILLABLE_FIELD_MAP_STATUSES.includes(s), s);
  assert.deepEqual([...FILLABLE_FIELD_MAP_STATUSES].sort(), ["needs_review", "published"]);
  assert.deepEqual([...EDITABLE_FIELD_MAP_STATUSES].sort(), ["draft", "in_review"]);
  const maps = read("lib/extension/maps.ts");
  assert.match(maps, /\.in\("status", \[\.\.\.FILLABLE_FIELD_MAP_STATUSES\]\)/);
  // No AI at fill time: nothing on the fill path names a model or proposal.
  const fill = maps.slice(maps.indexOf("export async function fillableMapFor"));
  assert.doesNotMatch(fill + read("lib/extension/fields.ts"), /openai|anthropic|proposal_source: "ai"|\/ai\//i);
});

// ── 3.26 · FYC follows the accepted counteroffer ────────────────────────────

test("3.26: an issued application placed on an accepted counteroffer is estimated on the carrier's premium", () => {
  const C1 = "11111111-1111-4111-8111-111111111111";
  const input = {
    timeZone: "UTC", carriers: [{ id: C1, name: "Aetna" }], products: [{ code: "final_expense", label: "Final Expense" }], campaigns: [], producers: [{ id: "u1", name: "Priya" }],
    cases: [{ id: "case-1", source: "outbound", campaignId: null }],
    attempts: [{
      id: "a1", caseId: "case-1", leadId: "lead-1", insuredRole: "primary", attemptNo: 1, carrierId: C1, productCode: "final_expense", quoteId: "q1", status: "closed", outcome: "issued",
      outcomeReasonCode: null, createdBy: "u1", createdAt: "2026-09-01T10:00:00Z", updatedAt: "2026-09-10T10:00:00Z", submittedAt: "2026-09-02T10:00:00Z", outcomeRecordedAt: "2026-09-10T10:00:00Z",
      effectiveMonthlyCents: 5_840,
    }],
    quotes: [{ id: "q1", caseId: "case-1", leadId: "lead-1", insuredRole: "primary", carrierId: C1, productCode: "final_expense", monthlyPremiumCents: 6_840, createdBy: "u1", createdAt: "2026-09-01T09:00:00Z" }],
    counteroffers: [{ id: "o1", applicationId: "a1", status: "accepted", receivedAt: "2026-09-05T10:00:00Z", reasonCode: null }],
    requirements: [], rates: [{ carrierId: C1, productCode: "final_expense", rateBp: 11_000 }], reasonLabels: {},
  };
  const r = buildSalesReport(input, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(r.premium.total.submittedAnnualCents, 6_840 * 12, "submitted is what was applied for");
  assert.equal(r.premium.total.issuedAnnualCents, 5_840 * 12);
  assert.equal(r.premium.total.estimatedFycCents, 77_088);
  // Without an accepted offer the quote's premium stands.
  const plain = buildSalesReport({ ...input, attempts: [{ ...input.attempts[0], effectiveMonthlyCents: null }] }, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(plain.premium.total.estimatedFycCents, 90_288);
});

// ── 3.26 / 3.21 · the scheduled jobs run their bodies in the check block ─────

test("3.26 / 3.21: the expiry sweep and the report refresh are scheduled, and the migration runs each job once", () => {
  const sql = read("supabase/migrations/20260926103000_la_3_26_21_scheduled_jobs.sql");
  assert.match(sql, /cron\.schedule\(\s*'la3-expire-counteroffers',\s*'\*\/5 \* \* \* \*',\s*\$cron\$select count\(\*\) from public\.la3_expire_counteroffers\(\)\$cron\$/);
  assert.match(sql, /cron\.schedule\(\s*'la3-refresh-sales-report',\s*'7 \* \* \* \*',\s*\$cron\$select public\.la3_refresh_sales_report\(\)\$cron\$/);
  const check = sql.slice(sql.indexOf("-- ── checks"));
  assert.match(check, /perform count\(\*\) from public\.la3_expire_counteroffers\(\);/);
  assert.match(check, /perform public\.la3_refresh_sales_report\(\);/);
  assert.match(check, /errcode = 'P0099'/);
  // The sweep closes the attempt through the one SQL writer and waives what it was still waiting on.
  assert.match(sql, /perform public\.application_transition\(o\.tenant_id, o\.application_id, null, 'closed', 'offer_expired', null, null\);/);
  assert.match(sql, /set status = 'waived', satisfied_at = current_date, note = 'Waived: the attempt was closed\.'/);
  assert.doesNotMatch(sql.slice(0, sql.indexOf("-- ── checks")).replace(/^--.*$/gm, ""), /\bdelete from (?!cron\.job_run_details)/i);
});
