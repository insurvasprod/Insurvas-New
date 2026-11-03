// LA-6.2 (Notion sprint, Module 6 — Compliance) · the pre-transfer gate and its recorded verdict.
// Run with: node --experimental-strip-types --test lib/compliance/transferGate.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { decideTransfer, partnerClearedPayload, partnerRejectPayload, screenedBeforeTransfer, timed, LOCKED_ON_CHECKS, PARTNER_ACK_MESSAGE, PARTNER_REJECT_CODE, SOURCE_MODULE } from "./transferGateCore.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");

const check = (name, result = "pass", detail = "") => ({ check: name, result, detail, source_module: SOURCE_MODULE[name], source_record_id: null, duration_ms: 1 });
const ALL = ["partner_product_approved", "tcpa_litigator", "internal_dnc", "federal_state_dnc", "consent_artefact", "existing_customer", "calling_hours"];
const checks = (over = {}) => ALL.map((n) => check(n, over[n] ?? "pass"));
const decide = (over = {}, extra = {}) => decideTransfer({ invalidPhone: false, checks: checks(over), consentMissingAction: "warn", ...extra });

test("every check passing is a clean accept, with every answer kept", () => {
  const d = decide();
  assert.equal(d.verdict, "accept");
  assert.equal(d.blockingReason, null);
  assert.deepEqual(d.checks.map((c) => c.check), ALL);
  for (const c of d.checks) assert.ok(c.source_module, `${c.check} names its module`);
});

test("a litigator rejects and is not also reported as a DNC hit", () => {
  const d = decide({ tcpa_litigator: "hit", internal_dnc: "hit", federal_state_dnc: "hit" });
  assert.equal(d.verdict, "reject");
  assert.equal(d.blockingReason, "tcpa_litigator");
  assert.equal(d.checks.find((c) => c.check === "internal_dnc").result, "skipped");
  assert.equal(d.checks.find((c) => c.check === "federal_state_dnc").result, "skipped");
});

test("blocking checks reject in the inherited order", () => {
  assert.equal(decide({}, { invalidPhone: true }).blockingReason, "invalid_phone");
  assert.equal(decide({ partner_product_approved: "hit" }).blockingReason, "partner_not_approved");
  assert.equal(decide({ internal_dnc: "hit" }).blockingReason, "internal_dnc");
  assert.equal(decide({ internal_dnc: "hit" }, { invalidPhone: true }).blockingReason, "invalid_phone");
});

test("LA-1.5 fails closed: a screen that could not complete rejects", () => {
  assert.equal(decide({ tcpa_litigator: "incomplete" }).blockingReason, "screening_incomplete");
  assert.equal(decide({ internal_dnc: "incomplete" }).blockingReason, "screening_incomplete");
  assert.equal(decide({ partner_product_approved: "incomplete" }).blockingReason, "screening_incomplete");
});

test("federal DNC, existing customer and outside hours warn; they never block", () => {
  for (const name of ["federal_state_dnc", "existing_customer", "calling_hours"]) {
    const d = decide({ [name]: "hit" });
    assert.equal(d.verdict, "accept_with_warnings", name);
    assert.ok(d.warnings.some((w) => w.check === name), name);
  }
});

test("a missing consent artefact warns prominently, is counted, and blocks only when the tenant chose that", () => {
  const warn = decide({ consent_artefact: "hit" });
  assert.equal(warn.verdict, "accept_with_warnings");
  assert.deepEqual(warn.warnings.map((w) => w.code), ["consent_missing"]);
  assert.match(warn.warnings[0].message, /loses a TCPA case/);
  const block = decide({ consent_artefact: "hit" }, { consentMissingAction: "block" });
  assert.equal(block.verdict, "reject");
  assert.equal(block.blockingReason, "consent_missing");
});

test("an incomplete check is recorded as incomplete, never as a pass", () => {
  for (const name of ["consent_artefact", "existing_customer", "calling_hours", "federal_state_dnc"]) {
    const d = decide({ [name]: "incomplete" });
    assert.equal(d.verdict, "accept_with_warnings", name);
    assert.equal(d.checks.find((c) => c.check === name).result, "incomplete");
    assert.ok(d.warnings.some((w) => w.code === `${name}_incomplete`), name);
  }
});

test("a check that runs past the budget is incomplete", async () => {
  const slow = await timed("calling_hours", 20, () => new Promise((resolve) => setTimeout(() => resolve({ result: "pass", detail: "", source_record_id: null }), 200)));
  assert.equal(slow.result, "incomplete");
  assert.match(slow.detail, /No answer within 20 ms/);
  const broken = await timed("existing_customer", 1000, async () => { throw new Error("db down"); });
  assert.equal(broken.result, "incomplete");
  const fine = await timed("consent_artefact", 1000, async () => ({ result: "hit", detail: "none", source_record_id: null }));
  assert.equal(fine.result, "hit");
  assert.equal(fine.source_module, "LA-2.6");
});

test("screened before transfer: on number entry always; at submit only after an accept on entry", () => {
  assert.equal(screenedBeforeTransfer("number_entry", false), true);
  assert.equal(screenedBeforeTransfer("submit", true), true);
  assert.equal(screenedBeforeTransfer("submit", false), false);
});

test("the partner sees a coded reason and a count — never the number or which check", () => {
  const payload = partnerRejectPayload(14, "Thanks for your time.");
  assert.equal(payload.code, PARTNER_REJECT_CODE);
  assert.equal(payload.blocked_count, 14);
  const text = JSON.stringify(payload);
  assert.doesNotMatch(text, /\d{4}/, "no digits of a phone number");
  assert.doesNotMatch(text, /do.not.call|litigator|dnc|consent/i);
  assert.deepEqual(Object.keys(payload).sort(), ["blocked", "blocked_count", "code", "error", "neutral_end_call_script"]);
});

test("an accept tells the partner it is cleared — never the screening outcome, a list, or the number", () => {
  const payload = partnerClearedPayload({ warning: { code: "dnc", message: "This number appears on a DNC list." }, checkedAt: "2026-10-15T10:00:00Z" });
  assert.deepEqual(Object.keys(payload).sort(), ["checked_at", "screened", "verdict", "warning"]);
  assert.equal(payload.verdict, "cleared");
  assert.equal(payload.warning.message, PARTNER_ACK_MESSAGE);
  assert.doesNotMatch(PARTNER_ACK_MESSAGE, /do.not.call|litigator|\bdnc\b|list|consent/i);
  assert.equal(partnerClearedPayload({ warning: null, checkedAt: null }).warning, null);
});

test("the screen route answers every list hit with the same coded payload (Q9)", () => {
  const screen = read("app/api/partner/forms/[productCode]/screen/route.ts");
  // No litigator code, no masked digits, no screening outcome or vendor answer to the partner.
  assert.doesNotMatch(screen, /code: TCPA_REJECTION_REASON|phone: rejection\.maskedPhone, blocked_count|outcome: screening\.outcome|code: screening\?\.outcome|slice\(-4\)/);
  assert.match(screen, /partnerRejectPayload\(Math\.max\(count, 1\), NEUTRAL_END_CALL_SCRIPT\)/);
  assert.match(screen, /partnerClearedPayload\(screening\)/);
  // The tenant's own record keeps the litigator reason.
  assert.match(screen, /recordRejectedPartnerSubmission\(\{[^}]*reason: TCPA_REJECTION_REASON/);
});

test("a verdict that cannot be recorded stops the transfer (one verdict row per attempt)", () => {
  const gate = read("lib/compliance/transferGate.ts");
  const record = gate.slice(gate.indexOf("async function recordVerdict"), gate.indexOf("\n}\n", gate.indexOf("async function recordVerdict")));
  assert.match(record, /throw new TransferGateUnrecorded\(/);
  assert.doesNotMatch(record, /return null;/);
  assert.match(read("app/api/partner/forms/[productCode]/screen/route.ts"), /error instanceof TransferGateUnrecorded/);
});

test("the gate's consent check is the report's rule: a pending certificate past its window is not valid", () => {
  const gate = read("lib/compliance/transferGate.ts");
  assert.match(gate, /consentValidAt\(a, at\)/);
  assert.doesNotMatch(gate, /a\.capture_status === "claimed" \|\| a\.capture_status === "pending"/);
  assert.match(read("lib/compliance/evidenceReport.ts"), /const valid = consentValidAt\(a, now\);/);
});

test("litigator and internal do-not-call are locked on", () => {
  assert.deepEqual([...LOCKED_ON_CHECKS], ["tcpa_litigator", "internal_dnc"]);
  const sql = read("supabase/migrations/20261015110000_la_6_2_transfer_gate.sql");
  assert.doesNotMatch(sql, /gate_check_(litigator|tcpa|internal)/);
});

test("every check is called in the module that owns it; LA-6 re-implements none", () => {
  const gate = read("lib/compliance/transferGate.ts");
  assert.match(gate, /assertPartnerProductApproved\(input\.tenantId, input\.partnerId, input\.productCode\)/);
  assert.match(gate, /screenPartnerPhone\(\{ tenantId: input\.tenantId/);
  assert.match(gate, /rpc\("is_tenant_phone_suppressed"/);
  assert.match(gate, /findExistingCustomer\(\{ tenantId: input\.tenantId/);
  assert.match(gate, /rpc\("tenant_dial_window"/);
  assert.match(gate, /lookupComplianceEvents\(tenantId, \{ phoneDigits \}\)/);
  for (const f of ["lib/compliance/transferGate.ts", "lib/compliance/transferGateCore.ts"]) {
    const src = read(f);
    assert.doesNotMatch(src, /runScreening\(|canDialNow\(|claim_screening_cache|find_existing_customer_preflight|tenant_suppression_list|replace\(\/\\D\/g/, f);
  }
  // LA-1.24's match is shared, not copied: the stored pre-flight calls the same function.
  assert.match(read("lib/existingCustomerPreflight/service.ts"), /const \{ status, matches \} = await findExistingCustomer\(\{ tenantId: params\.tenantId, values: params\.values, excludeLeadId: params\.leadId \}\);/);
});

test("both evaluations go through the gate and record one verdict each", () => {
  const screen = read("app/api/partner/forms/[productCode]/screen/route.ts");
  assert.match(screen, /evaluateTransfer\(\{[^}]*stage: "number_entry" \}\)/);
  assert.doesNotMatch(screen, /screenPartnerPhone|assertPartnerProductApproved/);
  const submit = read("app/api/partner/leads/route.ts");
  assert.match(submit, /evaluateTransfer\(\{[\s\S]*?stage: "submit",[\s\S]*?\}\);/);
  assert.doesNotMatch(submit, /screenPartnerPhone\(/);
  assert.match(submit, /await linkVerdictToLead\(auth\.context\.tenantId, gate\.verdictId, lead\.id\);/);
  // A reject never reaches createPartnerLead, so it is never billable and never in deal flow.
  assert.ok(submit.indexOf("partnerRejectPayload(") < submit.indexOf("await createPartnerLead("));
  assert.match(read("components/partner/partner-portal-workspace.tsx"), /carrier_state: market\?\.state \?\? null/);
});

test("the verdict row is evidence: one row, every answer, append-only but for the lead link", () => {
  const sql = read("supabase/migrations/20261015110000_la_6_2_transfer_gate.sql");
  assert.match(sql, /constraint transfer_verdict_reject_no_lead check \(verdict <> 'reject' or lead_id is null\)/);
  assert.match(sql, /constraint transfer_verdict_reject_reason check \(\(verdict = 'reject'\) = \(blocking_reason is not null\)\)/);
  assert.match(sql, /if \(to_jsonb\(new\) - 'lead_id'\) is distinct from \(to_jsonb\(old\) - 'lead_id'\) then/);
  assert.match(sql, /revoke delete, truncate on public\.transfer_verdict from service_role;/);
  // Findable by number through LA-6.1.
  assert.match(sql, /select public\.compliance_index_add_source\('transfer_verdict'/);
  assert.match(sql, /create trigger compliance_index_sync after insert or update or delete on public\.transfer_verdict/);
});

test("rejects and late screens count against the partner on the quality page", () => {
  assert.match(read("lib/partnerQuality/detail.ts"), /gateStatsByPartner\(tenantId, from, to, partnerId\)/);
  assert.match(read("components/app/partner-quality-detail.tsx"), /label: "Rejected at transfer", value: data\.gate\.current\.rejected/);
});
