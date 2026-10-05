// Settings › Sales, as pure checks — no database. The settings document (LA-3.17), the welcome
// pack's four locked tokens (LA-3.20), and disclosure rules written the way a person types them and
// read the way the workspace reads them (LA-3.10).
//
// Run with: node --experimental-strip-types --test lib/salesSettings/editing.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

const { DEFAULT_SALES_SETTINGS, DEFAULT_WELCOME_PACK, WELCOME_PACK_LOCKED_TOKENS, resolveSalesSettings, salesSettingsSchema } = await import("./schema.ts");
const { changedSettingKeys, settingsAuditDiff, missingLockedTokens, unknownTokens, fillTokens, tokenParts, parseClauseValue, clauseValueText, describeClause, parseStates, CLAUSE_FIELD } = await import("./editing.ts");
const { applicableDisclosures } = await import("../applications/disclosureRules.ts");

// ── the settings document ──────────────────────────────────────────────────

test("the defaults are a valid document, and an empty row resolves to them", () => {
  assert.equal(salesSettingsSchema.safeParse(DEFAULT_SALES_SETTINGS).success, true);
  assert.deepEqual(resolveSalesSettings(null), DEFAULT_SALES_SETTINGS);
  assert.deepEqual(resolveSalesSettings({}), DEFAULT_SALES_SETTINGS);
});

test("one bad stored key falls back alone; the rest of the document is kept", () => {
  const stored = { ...DEFAULT_SALES_SETTINGS, draftBufferDays: 9, requirementAgeingDays: 7 };
  const resolved = resolveSalesSettings(stored);
  assert.equal(resolved.draftBufferDays, DEFAULT_SALES_SETTINGS.draftBufferDays);
  assert.equal(resolved.requirementAgeingDays, 7);
});

test("the per-$1,000 band must run low to high", () => {
  const bad = { ...DEFAULT_SALES_SETTINGS, per1000Band: { min: 5, max: 4 } };
  assert.equal(salesSettingsSchema.safeParse(bad).success, false);
});

test("the draft-day buffer is 2–4 days", () => {
  for (const [days, ok] of [[1, false], [2, true], [4, true], [5, false]]) {
    assert.equal(salesSettingsSchema.safeParse({ ...DEFAULT_SALES_SETTINGS, draftBufferDays: days }).success, ok, `buffer ${days}`);
  }
});

test("an unknown key is refused (the document is strict)", () => {
  assert.equal(salesSettingsSchema.safeParse({ ...DEFAULT_SALES_SETTINGS, surprise: true }).success, false);
});

test("the audit diff names exactly the keys that changed, with old and new values", () => {
  const after = { ...DEFAULT_SALES_SETTINGS, appointmentBlocks: true, requirementAgeingDays: 8 };
  assert.deepEqual(changedSettingKeys(DEFAULT_SALES_SETTINGS, after), ["appointmentBlocks", "requirementAgeingDays"]);
  const diff = settingsAuditDiff(DEFAULT_SALES_SETTINGS, after);
  assert.deepEqual(diff.before, { appointmentBlocks: false, requirementAgeingDays: 5 });
  assert.deepEqual(diff.after, { appointmentBlocks: true, requirementAgeingDays: 8 });
  assert.deepEqual(settingsAuditDiff(after, after).changed, []);
});

// ── welcome pack ───────────────────────────────────────────────────────────

test("the default welcome pack carries all four locked tokens", () => {
  assert.deepEqual(missingLockedTokens(DEFAULT_WELCOME_PACK.body), []);
});

test("removing any locked token is refused by the schema and named by the editor", () => {
  for (const token of WELCOME_PACK_LOCKED_TOKENS) {
    const body = DEFAULT_WELCOME_PACK.body.split(token).join("");
    assert.deepEqual(missingLockedTokens(body), [token]);
    const doc = { ...DEFAULT_SALES_SETTINGS, welcomePack: { subject: "Hi", body } };
    assert.equal(salesSettingsSchema.safeParse(doc).success, false, `${token} removed`);
  }
});

test("a mistyped token is reported, and filling leaves it visible", () => {
  assert.deepEqual(unknownTokens("Hi {client_first_nam}, {monthly_amount}"), ["{client_first_nam}"]);
  assert.equal(fillTokens("Pay {monthly_amount} on the {draft_day}", { "{monthly_amount}": "$68.40", "{draft_day}": "3rd" }), "Pay $68.40 on the 3rd");
  assert.deepEqual(tokenParts("A {draft_day}."), [{ text: "A ", token: null }, { text: "{draft_day}", token: "{draft_day}" }, { text: ".", token: null }]);
});

// ── disclosure clauses ─────────────────────────────────────────────────────

test("yes / no on an interview question is stored as a boolean", () => {
  assert.deepEqual(parseClauseValue("eq", "Yes", { boolean: true }), { value: true });
  assert.deepEqual(parseClauseValue("eq", "no", { boolean: true }), { value: false });
  assert.ok("error" in parseClauseValue("eq", "maybe", { boolean: true }));
});

test("one of takes a comma list; more than takes a number; money is compared in cents", () => {
  assert.deepEqual(parseClauseValue("in", "TX, OK ,TX", {}), { value: ["TX", "OK"] });
  assert.deepEqual(parseClauseValue("gt", "$25,000", { money: true }), { value: 2_500_000 });
  assert.deepEqual(parseClauseValue("lt", "68.40", {}), { value: 68.4 });
  assert.ok("error" in parseClauseValue("gt", "lots", {}));
  assert.ok("error" in parseClauseValue("eq", "   ", {}));
});

test("a stored clause reads back as it was typed", () => {
  assert.equal(clauseValueText({ field: "health.existing_coverage", op: "eq", value: true }), "yes");
  assert.equal(clauseValueText({ field: "addr.state", op: "in", value: ["TX", "OK"] }), "TX, OK");
  assert.equal(clauseValueText({ field: "cov.face_amount", op: "gt", value: 2_500_000 }, { money: true }), "25000.00");
  assert.equal(describeClause({ field: "health.existing_coverage", op: "eq", value: true }, "existing coverage"), "existing coverage = yes");
});

test("rule fields are canonical keys or interview answers", () => {
  assert.ok(CLAUSE_FIELD.test("addr.state"));
  assert.ok(CLAUSE_FIELD.test("health.existing_coverage"));
  assert.ok(!CLAUSE_FIELD.test("state"));
  assert.ok(!CLAUSE_FIELD.test("health.Existing"));
});

test("states are two-letter codes; anything else is handed back to fix", () => {
  assert.deepEqual(parseStates("tx, ok  NM", ["TX", "OK", "NM"]), { states: ["TX", "OK", "NM"], unknown: [] });
  assert.deepEqual(parseStates("TX, Texas", ["TX"]), { states: ["TX"], unknown: ["TEXAS"] });
});

// ── the saved rule, read by the workspace's evaluator ──────────────────────

const typed = (field, op, text, opts) => ({ field, op, value: parseClauseValue(op, text, opts).value });

test("\"Yes\" to existing coverage makes the replacement notice required", () => {
  const rules = [{ disclosureId: "REPLACEMENT_NOTICE", clauses: [typed("health.existing_coverage", "eq", "yes", { boolean: true })] }];
  const scopes = new Map([["REPLACEMENT_NOTICE", { states: [], carrierIds: [] }]]);
  const base = { rules, scopes, values: {}, state: "AZ", carrierId: null };
  assert.equal(applicableDisclosures({ ...base, answers: { existing_coverage: true } }).has("REPLACEMENT_NOTICE"), true);
  assert.equal(applicableDisclosures({ ...base, answers: { existing_coverage: false } }).has("REPLACEMENT_NOTICE"), false);
});

test("a TX / OK scoped disclosure does not trigger for NM", () => {
  const rules = [{ disclosureId: "TX_OK", clauses: [typed("health.existing_coverage", "eq", "yes", { boolean: true })] }];
  const scopes = new Map([["TX_OK", { states: parseStates("TX, OK", ["TX", "OK", "NM"]).states, carrierIds: [] }]]);
  const run = (state) => applicableDisclosures({ rules, scopes, values: {}, answers: { existing_coverage: true }, state, carrierId: null }).has("TX_OK");
  assert.equal(run("TX"), true);
  assert.equal(run("OK"), true);
  assert.equal(run("NM"), false);
});

test("an AND rule needs every clause; a second rule is OR", () => {
  const rules = [
    { disclosureId: "D", clauses: [typed("health.existing_coverage", "eq", "yes", { boolean: true }), typed("addr.state", "in", "AZ, NV")] },
    { disclosureId: "D", clauses: [typed("cov.face_amount", "gt", "25000", { money: true })] },
  ];
  const scopes = new Map([["D", { states: [], carrierIds: [] }]]);
  const run = (values, answers) => applicableDisclosures({ rules, scopes, values, answers, state: values["addr.state"] ?? null, carrierId: null }).has("D");
  assert.equal(run({ "addr.state": "AZ" }, { existing_coverage: true }), true);
  assert.equal(run({ "addr.state": "TX" }, { existing_coverage: true }), false);
  assert.equal(run({ "addr.state": "TX", "cov.face_amount": 3_000_000 }, {}), true);
});
