// LA-3 application flow — regressions found driving the real workspace (2026-09-29 QA pass).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { keepUnsaved, unsavedInterviewMark, unsavedValueMark } = await import("./keepUnsaved.ts");
const { prefillFromInterview, INTERVIEW_MAY_REPLACE, INTERVIEW_VALUE_KEYS, QUOTE_MAY_REPLACE } = await import("./prefill.ts");

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

const caseWith = ({ answers = {}, medications = [], values = {} } = {}) => ({
  caseId: "c1", attempts: [{ id: "a1", values }],
  interviews: { primary: { id: "iv1", answers, medications } },
});

test("a re-read of the case keeps answers still waiting to save, and takes the server's copy otherwise", () => {
  const screen = caseWith({ answers: { existing_coverage: { value: true }, height_in: { value: 70 } } });
  const server = caseWith({ answers: { existing_coverage: { value: true } } });
  const kept = keepUnsaved(screen, server, new Set(), new Set([unsavedInterviewMark("iv1", "answers")]));
  assert.deepEqual(kept.interviews.primary.answers, screen.interviews.primary.answers);
  const taken = keepUnsaved(screen, server, new Set(), new Set());
  assert.equal(taken, server);
});

test("a re-read keeps a typed value that has not saved yet, and only that one", () => {
  const screen = caseWith({ values: { "addr.city": { value: "Austin", source: "manual" }, "addr.zip": { value: "78701", source: "manual" } } });
  const server = caseWith({ values: { "addr.city": { value: null, source: "lead" }, "addr.zip": { value: "78701", source: "manual" }, "addr.state": { value: "TX", source: "lead" } } });
  const kept = keepUnsaved(screen, server, new Set([unsavedValueMark("a1", "addr.city")]), new Set());
  assert.equal(kept.attempts[0].values["addr.city"].value, "Austin");
  assert.equal(kept.attempts[0].values["addr.state"].value, "TX");
});

test("a re-read never lays one interview's answers over a different interview", () => {
  const screen = caseWith({ answers: { a: { value: 1 } } });
  const server = { ...caseWith(), interviews: { primary: { id: "iv2", answers: {}, medications: [] } } };
  const kept = keepUnsaved(screen, server, new Set(), new Set([unsavedInterviewMark("iv1", "answers")]));
  assert.deepEqual(kept.interviews.primary.answers, {});
});

test("height, weight and tobacco answered in the interview become application values", () => {
  assert.deepEqual(prefillFromInterview({ height_in: 70, weight_lb: 180.4, tobacco: false, driving_dui: true }), [
    { key: "insured.height_in", value: 70 },
    { key: "insured.weight_lb", value: 180 },
    { key: "insured.tobacco", value: "no" },
  ]);
  assert.deepEqual(prefillFromInterview({ height_in: null, weight_lb: "", tobacco: null }), []);
  assert.ok(INTERVIEW_VALUE_KEYS.has("height_in") && INTERVIEW_VALUE_KEYS.has("weight_lb"));
  // What a person typed or the household shares is never replaced; the quote does not override the interview.
  assert.ok(!INTERVIEW_MAY_REPLACE.includes("manual") && !INTERVIEW_MAY_REPLACE.includes("household"));
  assert.ok(!QUOTE_MAY_REPLACE.includes("interview"));
});

test("the doorway opens the primary interview with the case, and the workspace can start one that is missing", () => {
  const start = read("../../app/api/app/applications/start/route.ts");
  assert.match(start, /ensureInterview\(actor, started\.applicationCaseId, "primary"\)/);
  const step = read("../../components/app/applications/workspace/steps/interview-step.tsx");
  assert.match(step, /actions\.startInterview\(\)/);
  assert.doesNotMatch(step, /Start it from the lead or the dialer/);
});

test("the interview save writes the carried values and the workspace re-reads on them", () => {
  const mutations = read("./mutations.ts");
  assert.match(mutations, /prefillFromInterview\(/);
  assert.match(mutations, /source: "interview"/);
  const ctx = read("../../components/app/applications/workspace/context.tsx");
  assert.match(ctx, /keepUnsaved\(prev, r\.data/);
  assert.match(ctx, /INTERVIEW_VALUE_KEYS\.has/);
});

test("disclosure text is drawn from its markdown, not shown with its asterisks", () => {
  const step = read("../../components/app/applications/workspace/steps/disclosures-step.tsx");
  assert.match(step, /parseLegalMarkdown\(text\)/);
  assert.doesNotMatch(step, /whitespace-pre-line text-sm leading-\[1\.6\] text-\[var\(--body\)\]">\{d\.body\}/);
});

const { pickTemplate } = await import("./templates.ts");
const { quoteExpired, DEFAULT_QUOTE_VALID_DAYS } = await import("./listRules.ts");

test("a new interview uses the attempt carrier's own underwriting template before the general one", () => {
  const T = "t1", C = "carrier-a";
  const list = [
    { id: "gen-plat", version: 1, tenant_id: null, carrier_id: null, product_code: "term_life" },
    { id: "gen-mine", version: 2, tenant_id: T, carrier_id: null, product_code: "term_life" },
    { id: "car-plat", version: 1, tenant_id: null, carrier_id: C, product_code: "term_life" },
    { id: "car-mine", version: 3, tenant_id: T, carrier_id: C, product_code: "term_life" },
    { id: "fe-plat", version: 1, tenant_id: null, carrier_id: null, product_code: "final_expense" },
  ];
  assert.equal(pickTemplate(list, { tenantId: T, carrierId: C, productCode: "term_life" })?.id, "car-mine");
  assert.equal(pickTemplate(list.filter((t) => t.id !== "car-mine"), { tenantId: T, carrierId: C, productCode: "term_life" })?.id, "car-plat");
  assert.equal(pickTemplate(list, { tenantId: T, carrierId: null, productCode: "term_life" })?.id, "gen-mine");
  assert.equal(pickTemplate(list, { tenantId: T, carrierId: "other", productCode: "term_life" })?.id, "gen-mine");
  assert.equal(pickTemplate(list.filter((t) => t.id.startsWith("fe")), { tenantId: T, carrierId: C, productCode: "term_life" })?.id, "fe-plat");
  // Newest version inside a rung.
  assert.equal(pickTemplate([{ id: "v1", version: 1, tenant_id: null, carrier_id: null, product_code: "term_life" }, { id: "v2", version: 2, tenant_id: null, carrier_id: null, product_code: "term_life" }], { tenantId: T, carrierId: null, productCode: "term_life" })?.id, "v2");
});

test("the interview picks its template through the carrier ladder, not only carrier-less rows", () => {
  const mutations = read("./mutations.ts");
  const ensure = mutations.slice(mutations.indexOf("export async function ensureInterview"), mutations.indexOf("export async function saveAnswers"));
  assert.match(ensure, /pickTemplate\(list/);
  assert.doesNotMatch(ensure, /\.is\("carrier_id", null\)/);
});

test("a quote older than its template's valid_days is expired; 30 days when the template says nothing", () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  assert.equal(DEFAULT_QUOTE_VALID_DAYS, 30);
  assert.equal(quoteExpired("2026-09-14T12:00:00Z", 14, now), true);
  assert.equal(quoteExpired("2026-09-16T12:00:00Z", 14, now), false);
  assert.equal(quoteExpired("2026-08-29T11:00:00Z", undefined, now), true);
  assert.equal(quoteExpired("2026-09-01T12:00:00Z", null, now), false);
  assert.equal(quoteExpired("2026-08-01T12:00:00Z", 60, now), false);
  const catalog = read("./catalog.ts");
  assert.match(catalog, /validDays: quoteValidDays\(t\.definition\)/);
  const step = read("../../components/app/applications/workspace/steps/quote-step.tsx");
  assert.match(step, /Quote expired/);
});

test("the Application step's required fields fall back to the product's general field set before Final Expense", () => {
  const service = read("./service.ts");
  const req = service.slice(service.indexOf("const requiredFor"), service.indexOf("const attemptViews"));
  const general = req.indexOf('f.tenant_id === null && f.carrier_id === null && f.product_code === code');
  const fe = req.indexOf('f.product_code === "final_expense"');
  assert.ok(general > 0 && fe > general);
});

test("the interview prints one heading when its questions follow the persistency block under the same words", () => {
  const form = read("../../components/app/applications/workspace/interview/interview-form.tsx");
  assert.match(form, /const sectionKey = \(q: InterviewQuestion\) => sectionHeading\(q\)\.trim\(\)\.toLowerCase\(\)/);
});

test("a retry keeps the case's product, a draft can be withdrawn, and a withdrawn last attempt can close the case", () => {
  const mutations = read("./mutations.ts");
  const next = mutations.slice(mutations.indexOf("export async function openNextAttempt"), mutations.indexOf("export async function closeCase"));
  assert.match(next, /update\(\{ product_code: productCode \}\)/);
  const after = read("../../components/app/applications/workspace/steps/after-step.tsx");
  assert.match(after, /<WithdrawDialog/);
  const withdraw = read("../../components/app/applications/outcome/withdraw-dialog.tsx");
  assert.match(withdraw, /actions\.transition\("closed", \{ outcome: "withdrawn"/);
  const card = read("../../components/app/applications/outcome/outcome-card.tsx");
  assert.match(card, /const canLose = newest && caseView\.status === "open" && attempt\.outcome !== null && attempt\.outcome !== "issued"/);
});

test("the timeline dates a satisfied requirement by its own update, and lists the interview and quotes", () => {
  const tl = read("./timeline.ts");
  assert.match(tl, /export function satisfiedAt/);
  assert.ok(tl.includes('const whose = iv.insured_role === "spouse" ? "Spouse\'s interview" : "Interview";'));
  assert.ok(tl.includes("title: `${whose} started`"));
  assert.match(tl, /`Quoted \$\{/);
  assert.doesNotMatch(tl, /outbound: "the dialer"/);
});
