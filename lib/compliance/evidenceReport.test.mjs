// LA-6.3 (Notion sprint, Module 6 — Compliance) · the compliance evidence report.
// Run with: node --experimental-strip-types --test lib/compliance/evidenceReport.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { bookLine, bookSummary, clock, describeGap, gapsSection, GAP_KEYS } from "./evidenceGaps.ts";
import { evidenceRange } from "./evidenceRange.ts";
import { AGENT_API_POLICIES } from "../entitlements/agentApiPolicy.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = "supabase/migrations/20261015120000_la_6_3_evidence_report.sql";
const REF = new Date("2026-10-15T00:00:00Z");
const row = (category, extra = {}) => ({ category, phone_digits: "8175550142", status: "gap", calls: 4, first_at: "2026-08-12T15:00:00Z", last_at: "2026-09-03T15:00:00Z", detail: {}, ...extra });

test("all eight gap checks exist, in the database and in words", () => {
  assert.deepEqual([...GAP_KEYS], ["called_after_dnc", "called_after_complaint", "calls_without_consent", "consent_expired_before_call", "outside_legal_hours", "never_scrubbed", "transfer_without_verdict", "disclosure_missing"]);
  const sql = read(MIGRATION);
  for (const key of GAP_KEYS) assert.match(sql, new RegExp(`'${key}'::text`), key);
});

test("the spec's two example gaps read as the spec writes them", () => {
  const consent = describeGap(row("calls_without_consent"), REF);
  assert.deepEqual(consent.lines, ["No consent artefact exists for this number.", "4 calls were made between 12 Aug and 3 Sep."]);
  const hours = describeGap(row("outside_legal_hours", { calls: 1, first_at: "2026-08-22T12:48:00Z", last_at: "2026-08-22T12:48:00Z", detail: { calls: [{ at: "2026-08-22T12:48:00Z", state: "TX", local_minute: 468, start_minute: 480, end_minute: 1260 }] } }), REF);
  assert.deepEqual(hours.lines, ["One call on 22 Aug at 07:48 local was outside legal hours. Window for TX is 08:00–21:00."]);
  assert.equal(clock(468), "07:48");
});

test("called after a DNC entry and after a complaint are the highest severity, listed first", () => {
  const s = gapsSection([row("never_scrubbed"), row("calls_without_consent"), row("called_after_complaint", { detail: { complaint_at: "2026-08-20T00:00:00Z" } }), row("called_after_dnc", { calls: 2, detail: { listed_at: "2026-08-21T00:00:00Z" } })], REF);
  assert.deepEqual(s.gaps.map((g) => g.category), ["called_after_dnc", "called_after_complaint", "calls_without_consent", "never_scrubbed"]);
  assert.equal(s.gaps[0].severity, "critical");
  assert.equal(s.gaps[1].severity, "critical");
  assert.match(s.gaps[0].lines.join(" "), /Fix today/);
  assert.equal(s.gapCount, 4);
});

test("a check that cannot be computed is undetermined, never a pass", () => {
  const s = gapsSection([row("called_after_complaint", { status: "undetermined", calls: 0, detail: { reason: "Complaints are not recorded yet." } }), row("outside_legal_hours", { status: "undetermined", calls: 2, detail: { reasons: ["no_state"] } })], REF);
  assert.equal(s.gapCount, 0);
  assert.equal(s.undetermined.length, 2);
  assert.match(s.undetermined.map((g) => g.lines.join(" ")).join(" "), /Undetermined: Complaints are not recorded yet\./);
  assert.match(s.undetermined.map((g) => g.lines.join(" ")).join(" "), /Undetermined is not a pass/);
  // In the database: no window recorded, no state, stale rules → undetermined, not inside.
  const sql = read(MIGRATION);
  assert.match(sql, /when w\.reason is null or w\.reason in \('no_state', 'rules_stale', 'no_zone'\) then 'undetermined'/);
  assert.match(sql, /and a\.window_verdict is distinct from 'inside'/);
  assert.match(sql, /if to_regclass\('public\.complaint'\) is null then/);
});

test("the book-wide scan gives the same categories as a summary, in the spec's words", () => {
  const lines = bookSummary([
    row("calls_without_consent", { phone_digits: "1111111111", calls: 3 }),
    row("calls_without_consent", { phone_digits: "2222222222", calls: 1 }),
    row("called_after_dnc", { phone_digits: "3333333333", calls: 2 }),
    row("outside_legal_hours", { phone_digits: "4444444444", calls: 1 }),
  ]);
  assert.deepEqual(lines.map((l) => l.category), [...GAP_KEYS]);
  assert.equal(bookLine(lines.find((l) => l.category === "calls_without_consent")), "2 numbers have calls with no consent artefact.");
  assert.equal(bookLine(lines.find((l) => l.category === "called_after_dnc")), "1 number was called after a DNC entry.");
  assert.equal(bookLine(lines.find((l) => l.category === "outside_legal_hours")), "1 call outside legal hours.");
});

test("one implementation of the gap checks: the report, the scan (and the dashboard) all call compliance_gaps", () => {
  const store = read("lib/compliance/evidenceReport.ts");
  assert.match(store, /rpc\("compliance_gaps", \{ p_tenant_id: tenantId, p_phone_digits: phone/);
  assert.match(store, /await gapRows\(viewer\.tenantId, p, range\)/);
  // The book-wide scan is summarised in the database from the same function (the API caps a response at 1,000 rows).
  assert.match(store, /db\(\)\.rpc\("compliance_gap_summary", \{ p_tenant_id: viewer\.tenantId/);
  assert.match(read("supabase/migrations/20261015180000_la_6_3_gap_summary.sql"), /from public\.compliance_gaps\(p_tenant_id, null, p_from, p_to, p_claim_hours\) g\n\s+group by g\.category, g\.status/);
  // The claim windows are LA-2.6's, passed in, not restated in SQL.
  assert.match(store, /JSON\.stringify\(PROVIDER_CLAIM_WINDOW_HOURS\)/);
  assert.doesNotMatch(read(MIGRATION), /interval '72 hours'|72 \* /);
  // The window is LA-2.4's own function, recorded on the call; no second window engine.
  assert.match(read(MIGRATION), /from public\.tenant_dial_window\(new\.tenant_id, v_state, v_campaign, new\.attempted_at\)/);
  assert.doesNotMatch(store, /canDialNow|tenant_dial_window/);
});

test("every report generation is logged; a report that cannot be logged is not served", () => {
  const store = read("lib/compliance/evidenceReport.ts");
  assert.match(store, /from\("compliance_report_log"\)\.insert\(/);
  assert.match(store, /\/\/ A report that cannot be logged is not served\.\n\s+throw new Error/);
  assert.ok(store.indexOf("await log(viewer, {") < store.indexOf("return {\n    scope, scopeLabel"), "logged before it is returned");
  const sql = read(MIGRATION);
  assert.match(sql, /revoke update, delete, truncate on public\.compliance_report_log from service_role, tenant_app;/);
});

test("setters, buffer agents (assistants), bookkeepers and partner users cannot reach it", () => {
  for (const file of ["app/api/app/compliance/evidence/route.ts", "app/api/app/compliance/gap-scan/route.ts"]) {
    const policy = AGENT_API_POLICIES.find((p) => p.sourceFile === file);
    assert.deepEqual(policy?.allowedRoles, ["owner", "producer"], file);
    assert.match(read(file), /const ROLES = \["owner", "producer"\] as const;\n[\s\S]*requireFeatureRole\("litigation_packet", ROLES(?:, \{ prefetchScope: true \})?\)/);
  }
  assert.match(read("app/app/(shell)/evidence-report/page.tsx"), /if \(!actAsPage\(guard, \["owner", "producer"\]\)\)/);
  assert.doesNotMatch(read("app/api/app/compliance/evidence/route.ts"), /requirePartner/);
});

test("on screen the gaps come first and the timeline is collapsed; the PDF carries scope and time on every page", () => {
  const view = read("components/app/compliance/evidence-report.tsx");
  assert.ok(view.indexOf("title={`Gaps found: ${report.gaps.length}`}") < view.indexOf("title={`Timeline:"), "gaps before the timeline");
  assert.match(view, /const \[open, setOpen\] = useState\(false\);/);
  const pdf = read("lib/compliance/evidencePdf.ts");
  const newPage = pdf.slice(pdf.indexOf("const newPage = () => {"), pdf.indexOf("const ensure"));
  assert.match(newPage, /page\.drawText\(safe\(scope\)/);
  assert.match(newPage, /page\.drawText\(safe\(header\)/);
  assert.match(pdf, /Page \$\{i \+ 1\} of \$\{pages\.length\}/);
  assert.ok(pdf.indexOf("heading(`Gaps found:") < pdf.indexOf("heading(`Timeline:"), "gaps first in the PDF too");
  assert.match(pdf, /csvCell/);
});

test("a date range is whole days, `to` inclusive", () => {
  assert.deepEqual(evidenceRange("2026-08-15", "2026-08-31"), { from: "2026-08-15T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" });
  assert.deepEqual(evidenceRange(null, null), { from: null, to: null });
  assert.ok("error" in evidenceRange("2026-02-30", null));
  assert.ok("error" in evidenceRange("2026-09-02", "2026-09-01"));
});

test("LA-2.4's answer is recorded on every call, and recording it can never stop a call being written", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /create trigger tenant_call_attempts_window_record before insert or update of attempted_at, lead_id on public\.tenant_call_attempts/);
  assert.match(sql, /exception when others then\n\s+-- Recording the window must never stop a call being written\.\n\s+new\.window_verdict := 'undetermined';/);
  assert.match(sql, /raise exception '20261015120000: % call\(s\) have no recorded window'/);
});
