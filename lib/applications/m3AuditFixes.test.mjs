// Module 3 audit fixes (2026-10-15): each test is one confirmed defect, kept fixed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { normaliseStateCode, clientStateOf, prefillFromLead, LEAD_SSN_KEYS } = await import("./prefill.ts");
const { stateOfPhone } = await import("./areaCodes.ts");
const { runQa } = await import("./qa.ts");
const { FIXTURE_ATTEMPT, FIXTURE_CASE } = await import("./fixtures.ts");
const { recommendDraftDay, draftTiming, isSafeDraftDay } = await import("../draftDates/optimiser.ts");

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const migration = read("../../supabase/migrations/20261015570000_la_3_audit_fixes.sql");

test("1 · the appointment state: the application's own address first, then the lead's, each normalised", () => {
  assert.equal(normaliseStateCode("Texas"), "TX");
  assert.equal(normaliseStateCode(" new  york "), "NY");
  assert.equal(normaliseStateCode("tx"), "TX");
  assert.equal(normaliseStateCode("Texass"), null);
  assert.equal(clientStateOf("FL", { state: "TX" }), "FL", "the application's address wins over the lead");
  assert.equal(clientStateOf(null, { state_code: "tx" }), "TX", "a lead keyed state_code is read");
  assert.equal(clientStateOf(null, { state: "Texas" }), "TX", "a lead with the full name is read");
  assert.equal(clientStateOf("", { state: "Narnia", state_code: "OH" }), "OH");
  assert.equal(clientStateOf(null, {}), null);
  assert.deepEqual(prefillFromLead({ state: "Texas" }).find((p) => p.key === "addr.state")?.value, "TX");
  const service = read("./service.ts");
  assert.match(service, /clientStateOf\(vals\["addr\.state"\]\?\.value, leadValues\)/);
  assert.doesNotMatch(service, /leadValues\.state\.toUpperCase/);
  assert.doesNotMatch(read("../../app/api/app/applications/cases/[caseId]/catalog/route.ts"), /values\?\.state\b/);
});

test("2 · extension grants end with the sign-in: revoked on session end, bound and checked per request", () => {
  assert.match(read("../tenantAuth/sessionStore.ts"), /revokeExtensionGrantsForSessionEnd\(\{ userId: input\.userId, sessionId: input\.sessionId \?\? null, except: input\.except \?\? null/);
  assert.match(read("../../app/api/app/auth/logout/route.ts"), /revokeExtensionGrantsForSessionEnd\(\{ userId: session\.sub, reason: "signed_out" \}\)/);
  const grants = read("../extension/grants.ts");
  assert.match(grants, /session_id: actor\.sessionId \?\? null/);
  assert.ok(grants.indexOf("grantSessionLive(grant)") > 0 && grants.indexOf("grantSessionLive(grant)") < grants.indexOf("memberStillAllowed(grant.tenant_id"), "the session is checked on every extension request");
  assert.match(migration, /add column if not exists session_id uuid references public\.tenant_user_session\(id\)/);
});

test("3 · SSN validity: the SSA rules in the prefill and in QA; the lead's plaintext is masked once encrypted", () => {
  assert.equal(prefillFromLead({ ssn: "666-12-3456" }).some((p) => p.key === "insured.ssn"), false);
  assert.equal(prefillFromLead({ ssn: "123-00-4567" }).some((p) => p.key === "insured.ssn"), false);
  assert.equal(prefillFromLead({ ssn: "123-45-6789" }).find((p) => p.key === "insured.ssn")?.sensitive, true);
  const withSsn = (ssn) => ({ ...FIXTURE_ATTEMPT, values: { ...FIXTURE_ATTEMPT.values, "insured.ssn": ssn } });
  const blocked = (attempt, extra = {}) => runQa({ caseId: FIXTURE_CASE.caseId, attempt, ...extra }).blocking.map((i) => i.code);
  assert.ok(!blocked(FIXTURE_ATTEMPT).includes("QA_SSN_INVALID"));
  assert.ok(blocked(FIXTURE_ATTEMPT, { ssnValid: false }).includes("QA_SSN_INVALID"), "the server's decrypted verdict blocks");
  assert.ok(blocked(withSsn({ value: null, source: "manual", reviewed: true, masked: "••••0000", hasValue: true })).includes("QA_SSN_INVALID"), "a 0000 serial is visible in the last four");
  assert.ok(blocked(withSsn({ value: "900123456", source: "manual", reviewed: true })).includes("QA_SSN_INVALID"));
  assert.deepEqual([...LEAD_SSN_KEYS], ["ssn", "social_security_number", "social_security"]);
  assert.match(migration, /array\['ssn', 'social_security_number', 'social_security'\]/, "the SQL scrubs the same keys");
  const reveal = read("../../app/api/app/outbound/application/reveal/route.ts");
  assert.ok(reveal.indexOf("applicationSsn(") < reveal.indexOf("const value = panel.lead.values"), "an SSN is read back from the application first");
  assert.match(read("./mutations.ts"), /decryptSensitive\(cipher\.value_ciphertext[\s\S]{0,200}isPlausibleSsn\(ssnPlain\)/);
});

test("4 · a household's two policies: issued per application, not per shared deal", () => {
  const mutations = read("./mutations.ts");
  assert.match(mutations, /markApplicationPolicyIssued\(actor\.tenantId, \{ applicationId,/);
  assert.doesNotMatch(mutations, /markDealPolicyIssued/);
  assert.doesNotMatch(read("../ingestion/applicationIssueStore.ts"), /markDealPolicyIssued/);
  assert.match(mutations, /if \(quote && !primarySubmitted\)/, "a spouse's submission does not overwrite the primary's figures on the deal");
  assert.match(migration, /create unique index if not exists tenant_issued_policies_application_key\s+on public\.tenant_issued_policies \(application_id\) where application_id is not null/);
});

test("5 · submission is one transaction with a unique key per attempt", () => {
  const mutations = read("./mutations.ts");
  assert.match(mutations, /client\.rpc\("record_application_submission"/);
  assert.doesNotMatch(mutations, /from\("tenant_application_submissions"\)\.insert/);
  assert.match(migration, /create unique index if not exists tenant_application_submissions_application_key\s+on public\.tenant_application_submissions \(application_id\)/);
  for (const fn of ["record_application_submission", "mark_application_policy_issued", "save_application_beneficiaries", "scrub_lead_ssn"]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated, tenant_app;`), fn);
  }
});

test("6 · the workspace's Quote step is part of the application: the quoting engine's kill switch never stops it", () => {
  for (const route of ["../../app/api/app/applications/cases/[caseId]/quotes/route.ts", "../../app/api/app/quotes/[id]/select/route.ts"]) {
    const src = read(route);
    assert.match(src, /requireFeatureRole\("applications"/, route);
    assert.doesNotMatch(src, /requireFeatureRole\("quoting"/, route);
  }
});

test("7 · weekly and every-two-weeks pay get an honest best guess, not a recommendation", () => {
  const from = new Date("2026-09-15T00:00:00Z");
  for (const payFrequency of ["weekly", "biweekly"]) {
    const r = recommendDraftDay({ incomeType: "payroll", payFrequency, payAnchor: "2026-09-11", from });
    assert.equal(r.kind, "neutral", payFrequency);
    assert.doesNotMatch(r.recommended.reason, /always in the account first/);
    assert.match(r.recommended.reason, /moves through the month/);
    // LA-5 still measures where a draft sits against weekly pay.
    assert.ok(draftTiming({ incomeType: "payroll", payFrequency, payAnchor: "2026-09-11", from }, 10) !== null, payFrequency);
  }
  const ssa = recommendDraftDay({ incomeType: "ssa", birthDay: 15, from });
  assert.equal(ssa.kind, "recommended");
  assert.ok(ssa.recommended.minGapDays >= 2);
  assert.equal(isSafeDraftDay({ incomeType: "none", from }, 15), true);
});

test("7 · SSI paid early on 31 December is January's money, not December's", () => {
  const r = recommendDraftDay({ incomeType: "ssi", from: new Date("2026-09-15T00:00:00Z") });
  assert.equal(r.kind, "recommended");
  const by = Object.fromEntries(r.arrivals.map((a) => [a.month, a.date]));
  assert.equal(by["2026-12"], "2026-12-01");
  assert.equal(by["2027-01"], "2026-12-31");
});

test("8 · beneficiaries are replaced atomically; a contingent needs a primary at save", () => {
  const mutations = read("./mutations.ts");
  assert.match(mutations, /rpc\("save_application_beneficiaries"/);
  assert.doesNotMatch(mutations, /from\("tenant_application_beneficiaries"\)\.delete\(\)/);
  assert.match(mutations, /BENEFICIARY_CONTINGENT_WITHOUT_PRIMARY/);
});

test("9 · opening a confirmation screenshot is logged before its URL is issued", () => {
  const src = read("./confirmations.ts");
  const fn = src.slice(src.indexOf("export async function confirmationUrl"));
  assert.ok(fn.indexOf('from("tenant_sensitive_access_log").insert') > 0 && fn.indexOf('from("tenant_sensitive_access_log").insert') < fn.indexOf("createSignedUrl"));
});

test("10 · future submission times, a card with no expiry, and the phone's state", async () => {
  const pay = { ...FIXTURE_ATTEMPT.payment, method: "debit_card", card: { masked: "••••1111", hasValue: true, brand: "visa", expMonth: null, expYear: null } };
  const qa = runQa({ caseId: FIXTURE_CASE.caseId, attempt: { ...FIXTURE_ATTEMPT, payment: pay } });
  assert.ok(qa.blocking.some((i) => i.code === "QA_CARD_EXPIRY_MISSING"));
  assert.equal(stateOfPhone("(817) 555-0142"), "TX");
  assert.equal(stateOfPhone("+1 212 555 0100"), "NY");
  assert.equal(stateOfPhone("800-555-0100"), null, "toll-free has no state");
  const phoned = runQa({ caseId: FIXTURE_CASE.caseId, attempt: FIXTURE_ATTEMPT, phoneState: stateOfPhone("2125550100") });
  assert.ok(phoned.warnings.some((i) => i.code === "QA_PHONE_STATE"));
  assert.match(read("./mutations.ts"), /phoneState: stateOfPhone\(phone\)/);
  assert.match(read("./schemas.ts"), /Date\.parse\(v\) <= Date\.now\(\) \+ SUBMITTED_AT_SKEW_MS/);
});
