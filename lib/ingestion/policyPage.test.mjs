// Book of business, round 2 (docs/la4/BUILD-ROUND2.md) · Step 3 · Policies: the policy detail page with its
// seven tabs, the Change client page, and the hand-entered policy in the same frame. A source contract plus
// the pure helpers. Run with: node --experimental-strip-types --test lib/ingestion/policyPage.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { HAND_POLICY_TABS, POLICY_TABS, carrierPolicyHref, changeClientHref, filterHistory, historyCsv, historyFields, matchCount, nextDateThatMatters, policyTabOf } from "./policyPage.ts";

const read = (p) => readFileSync(join(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const PAGE = "app/app/(shell)/policies/carrier/[carrierId]/[policyNumber]/page.tsx";
const CLIENT_PAGE = "app/app/(shell)/policies/carrier/[carrierId]/[policyNumber]/client/page.tsx";
const HAND_PAGE = "app/app/(shell)/policies/[id]/page.tsx";
const ROUTE = "app/api/app/policies/client-link/route.ts";

test("the seven tabs, in the approved order and words", () => {
  assert.deepEqual(POLICY_TABS.map((t) => t.label), ["Overview", "History", "Client", "Pipeline", "Commissions", "Files", "Notes"]);
  assert.deepEqual([...HAND_POLICY_TABS], ["overview", "commissions"]);
  assert.equal(policyTabOf("history"), "history");
  assert.equal(policyTabOf(["client", "x"]), "client");
  assert.equal(policyTabOf("nonsense"), "overview");
  assert.equal(policyTabOf("history", HAND_POLICY_TABS), "overview", "a hand-entered policy has no History tab");
  assert.equal(carrierPolicyHref("c", "AM 1/2", "client"), "/app/policies/carrier/c/AM%201%2F2?tab=client");
  assert.equal(carrierPolicyHref("c", "AM1", "overview"), "/app/policies/carrier/c/AM1");
  assert.equal(changeClientHref("c", "AM1"), "/app/policies/carrier/c/AM1/client");
});

test("every policy page renders inside the Book of business frame, under today's gates, with no header of its own", () => {
  for (const file of [PAGE, CLIENT_PAGE, HAND_PAGE]) {
    const page = read(file);
    assert.match(page, /<DataInPage\s+step="policies"/, file);
    assert.match(page, /guardPage\("book_of_business"\)/, file);
    assert.match(page, /actAsPage\(guard, \["owner", "producer", "bookkeeper"\]\)/, file);
    assert.doesNotMatch(page, /<PageHeader\b/, `${file}: the frame draws the one title`);
  }
});

test("the carrier policy page draws every tab from ?tab= and keeps its actions", () => {
  const page = read(PAGE);
  for (const part of ["PolicyOverviewTab", "PolicyHistoryTab", "PolicyClientTab", "PolicyPipelineTab", "PolicyCommissionsTab", "PolicyFilesTab", "PolicyAnnotationForm"]) assert.match(page, new RegExp(`<${part}\\b`), part);
  assert.match(page, /policyTabOf\(query\.tab\)/);
  for (const action of ["Open the lead", "Open the application", "Open in Save queue"]) assert.ok(page.includes(action), action);
  assert.match(page, /<CopyPolicyNumber\b/);
  // A producer still sees only a policy credited to them: the same loadPolicy, and the keys read with the same viewer.
  assert.match(page, /loadPolicy\(viewer, carrierId, policyNumber\)/);
  assert.match(page, /policyKeys\(viewer, carrierId, policyNumber\)/);
});

test("Change client writes through record_policy_match, owner and bookkeeper only; Unlink and Undo reuse existing paths", () => {
  const route = read(ROUTE);
  assert.match(route, /requireFeatureRole\("statement_ingestion", roles, \{ write: true \}\)/);
  assert.match(route, /const roles = \["owner", "bookkeeper"\] as const/);
  assert.match(route, /audit\(/);
  assert.match(read("lib/entitlements/agentApiPolicy.ts"), /app\/api\/app\/policies\/client-link\/route\.ts", featureKey: "statement_ingestion", allowedRoles: \["owner", "bookkeeper"\]/);
  const store = read("lib/ingestion/policyClientStore.ts");
  assert.match(store, /rpc\("record_policy_match"/, "the one link write path: supersede, never overwrite");
  assert.match(store, /method: "human"/);
  assert.match(store, /reasoning: reason/, "the why is kept with the link");
  assert.match(store, /refreshPolicyCurrent\(/);
  assert.match(store, /closeAnsweredItems\(/);
  const islands = read("components/app/book/policy/policy-islands.tsx");
  assert.match(islands, /action: "reopen", match_id: matchId/, "Unlink is Policy matching's reopen");
  assert.match(islands, /\/reconcile-stage`/, "Undo is the existing put-back");
  assert.match(islands, /confirmAction\(/, "both ask first");
  assert.doesNotMatch(islands, /window\.confirm/);
});

test("the pipeline rules land on the Pipeline tab: the page fills ruleLines from the rules' own loader", () => {
  const store = read("lib/ingestion/policyPageStore.ts");
  assert.match(store, /PIPELINE RULES EXTENSION SPOT/);
  assert.match(read("lib/ingestion/policyClientStore.ts"), /PIPELINE RULES EXTENSION SPOT/);
  const page = read(PAGE);
  assert.match(page, /loadPolicyRuleEvents\(tenantId, carrierId, policy\.policyNumber\)\.catch\(\(\) => null\)/);
  assert.match(page, /ruleLines: rules\?\.available \? policyRuleLines\(rules\.events\) : \[\]/);
});

test("no side panels: the policy area composes from components/ui and draws no sheet or drawer", () => {
  for (const name of ["policy-islands", "history-tab", "client-tab", "pipeline-tab", "commissions-tab", "files-tab", "overview-tab", "change-client-form", "policy-head"]) {
    const file = `components/app/book/policy/${name}.tsx`;
    assert.ok(existsSync(join(process.cwd(), file)), file);
    const source = read(file);
    assert.doesNotMatch(source, /DetailPanel|<Sheet\b|Drawer/, `${file}: list → detail → tabs, no side panels`);
    assert.doesNotMatch(source, /text-\[\d+px\]/, `${file}: text stays on the scale`);
  }
});

test("history: the field filter, its choices and the export", () => {
  const rows = [
    { date: "2026-11-02", field: "status_normalized", fieldLabel: "Status", from: "Active", to: "Lapsed", source: { fileId: "f1", fileName: "americo_1102.csv", rowNumber: 214 } },
    { date: "2026-10-08", field: "paid_to_date", fieldLabel: "Paid to", from: "Sep 8, 2026", to: "Oct 8, 2026", source: null },
    { date: "2026-10-01", field: "status_normalized", fieldLabel: "Status", from: null, to: "=Active, \"quoted\"", source: null },
  ];
  assert.deepEqual(historyFields(rows).map((f) => [f.key, f.count]), [["", 3], ["status_normalized", 2], ["paid_to_date", 1]]);
  assert.equal(filterHistory(rows, "paid_to_date").length, 1);
  assert.equal(filterHistory(rows, "").length, 3);
  const csv = historyCsv(rows).split("\r\n");
  assert.equal(csv[0], "Date,Field,From,To,File,Row");
  assert.equal(csv[1], "2026-11-02,Status,Active,Lapsed,americo_1102.csv,214");
  assert.equal(csv[3], "2026-10-01,Status,,\"'=Active, \"\"quoted\"\"\",,", "a formula is defused and quotes escaped");
});

test("Change client: the five-fact match count", () => {
  const carrier = { firstName: "Luisa", lastName: "Ortega", dob: "1961-03-03", phone: "(555) 555-0190" };
  assert.deepEqual(matchCount(carrier, { firstName: "luisa", lastName: "ORTEGA", dob: "1961-03-03", phone: "555-555-0190", hasSaleWithCarrier: true }), { matched: 5, of: 5, facts: ["first name", "last name", "date of birth", "phone", "a sale with this carrier"] });
  assert.equal(matchCount(carrier, { firstName: "Luis", lastName: "Ortega", dob: "1958-03-03", phone: "5555550190", hasSaleWithCarrier: false }).matched, 2);
  assert.equal(matchCount({ firstName: null, lastName: null, dob: null, phone: null }, { firstName: null, lastName: null, dob: null, phone: null, hasSaleWithCarrier: false }).matched, 0, "a missing fact never matches");
});

test("the next date that matters", () => {
  assert.deepEqual(nextDateThatMatters({ status: "lapsed", paidTo: "2026-10-08", daysPastDue: 25, daysLeft: 35, asOf: "2026-11-02" }), { label: "Can be reinstated until", date: "2026-12-07", detail: "35 more days, by the carrier's window in Carrier rules" });
  assert.equal(nextDateThatMatters({ status: "active", paidTo: "2026-12-01", daysPastDue: 0, daysLeft: null, asOf: "2026-11-02" })?.label, "Next payment due");
  assert.equal(nextDateThatMatters({ status: "paid_up", paidTo: null, daysPastDue: null, daysLeft: null, asOf: null }), null);
});
