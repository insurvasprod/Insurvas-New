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
  // Round 5 (board 7): Commissions is "Money"; its key stays "commissions", so every old ?tab= link lands.
  assert.deepEqual(POLICY_TABS.map((t) => t.label), ["Overview", "History", "Client", "Pipeline", "Money", "Files", "Notes"]);
  assert.equal(POLICY_TABS.find((t) => t.label === "Money")?.key, "commissions");
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
  // Round 5 (board 7): one button (Open the lead first); the rest — Change client, Unlink, Add a note and Copy
  // policy number — in the "More" menu (components/ui DropdownMenu).
  assert.match(page, /links\.slice\(0, 1\)\.map\(/);
  assert.match(page, /<PolicyMoreMenu links=\{links\.slice\(1\)\} policyNumber=\{policy\.policyNumber\} unlink=\{/);
  for (const item of ["Change client", "Add a note"]) assert.ok(page.includes(item), item);
  assert.doesNotMatch(page, /<CopyPolicyNumber\b/);
  const islands = read("components/app/book/policy/policy-islands.tsx");
  assert.match(islands, /from "@\/components\/ui\/dropdown-menu"/);
  assert.match(islands, /export function PolicyMoreMenu[\s\S]*More<\/Button>[\s\S]*Copy policy number/);
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

test("round 3: the compact header — the Overview's status lines are chips and links on the facts line", () => {
  const page = read(PAGE);
  assert.match(page, /notices=\{notices\} \/>\}/);
  // QA 2026-11-03: only while nobody has settled the link (showsProvisional).
  assert.match(page, /\{showsProvisional\(client\?\.provisional, keys\?\.link\) && <span className="inline-flex items-center gap-1\.5"><ProvisionalBadge \/>/);
  assert.match(page, /\{sale && <Link href=\{`\/app\/applications\/\$\{sale\.caseId\}`\}/);
  assert.match(page, /\{!client && !sale && <span[^>]*><StatusChip tone="warning">No client linked<\/StatusChip>/);
  assert.match(read("components/app/book/policy/policy-head.tsx"), /\{notices && <span className="flex shrink-0 flex-wrap items-center gap-3 text-sm">\{notices\}<\/span>\}/);
  const overview = read("components/app/book/policy/overview-tab.tsx");
  assert.doesNotMatch(overview, /role="status"/, "no status lines left on the Overview");
  // QA 2026-11-03: the view as loaded, its "Came from" filled by the sale when no lead source is on record.
  assert.match(page, /<PolicyOverviewTab view=\{cameFrom \? \{ \.\.\.view, lead: \{ \.\.\.view\.lead, name: cameFrom \} \} : view\} \/>/);
  // The Commissions tab's clawback warning is one line: a title and no paragraph.
  const commissions = read("components/app/book/policy/commissions-tab.tsx");
  assert.match(commissions, /<Callout tone="warning" title=\{`Inside the clawback window: [^`]*`\} \/>/);
});

test("round 3: no info-tone explainer Callouts on the Policies pages; the list's warnings are one line each", () => {
  const LIST = "app/app/(shell)/policies/page.tsx";
  const files = [LIST, PAGE, CLIENT_PAGE, HAND_PAGE, ...["policy-islands", "history-tab", "client-tab", "pipeline-tab", "commissions-tab", "files-tab", "overview-tab", "change-client-form", "policy-head"].map((name) => `components/app/book/policy/${name}.tsx`)];
  for (const file of files) assert.doesNotMatch(read(file), /<Callout\b[^>]*tone="info"/, file);
  const list = read(LIST);
  assert.doesNotMatch(list, /<NextStepLine\b/, "the retired Next step strip is gone");
  assert.doesNotMatch(list, /role="status" className="rounded-lg border/, "no hand-built tinted banner");
  assert.match(list, /\{!book\.available && <Callout tone="warning" title=\{POLICY_BOOK_PENDING_MESSAGE\} \/>\}/);
  assert.match(list, /\{unpriced && \(\n\s*<Callout tone="warning" title=\{/);
});

test("round 3: Policies has a Book · Recent changes switch; Recent changes is the old Carrier files › Policy changes", () => {
  const list = read("app/app/(shell)/policies/page.tsx");
  assert.match(list, /\{ key: "book" as const, label: "Book", href: "\/app\/policies" \}, \{ key: "changes" as const, label: "Recent changes", href: "\/app\/policies\?view=changes" \}/);
  assert.match(list, /const view: PoliciesView = params\.view === "changes" && canSeeChanges \? "changes" : "book";/);
  // The view keeps the gates it had on Carrier files: it lists every policy's changes, so a producer sees only the Book.
  assert.match(list, /const ingestion = await guardPage\("statement_ingestion"\);\n\s*const canSeeChanges = ingestion\.entitled && actAsPagePermission\(ingestion, "statements\.view"\);/);
  assert.match(list, /const changes = await listPolicyChanges\(guard\.context\.tenantId\);/);
  assert.match(list, /<PolicyChangesTable\s+changes=\{changes\.changes\}/);
  assert.ok(existsSync(join(process.cwd(), "components/app/policy-changes-table.tsx")));
  // The old "Entered by hand" address still lands on the Book, filtered.
  assert.match(list, /params\.view === "entered" && !params\.source \? \[\["source", "hand"\]\]/);
});

test("an advance charged back whole reads as gone on the Money tab, not as earned (QA 2026-11-03)", () => {
  const tab = read("components/app/book/policy/commissions-tab.tsx");
  assert.match(tab, /const takenBack = grossAdvance > 0 && grossAdvance \+ chargedBack <= 0;/);
  assert.match(tab, /advancedCents: takenBack \? 0 : grossAdvance/, "the figures stop counting a charged-back advance");
  assert.match(tab, /takenBack \? "nothing left to take back"/);
  assert.match(tab, /takenBack \? "the advance was charged back"/);
});
test("the policy page after a person links it to a sale: no Provisional, Came from names the sale, a mismatch is one line (QA 2026-11-03)", async () => {
  const { agentMismatchLine, saleCameFrom, showsProvisional } = await import("./policyPage.ts");
  // 0119990010: a human link to the sale, still pointing at the stand-in client.
  assert.equal(showsProvisional(true, { type: "deal_flow", method: "human" }), false);
  assert.equal(showsProvisional(true, { type: "application", method: "submission_record" }), false, "step 2");
  assert.equal(showsProvisional(true, { type: "contact", method: "human" }), false, "a person chose the client");
  assert.equal(showsProvisional(true, { type: "provisional", method: "no_match" }), true, "made from the carrier's row, nobody settled it");
  assert.equal(showsProvisional(true, { type: "contact", method: "identity_exact" }), true, "matched by identity alone is still worth a look");
  assert.equal(showsProvisional(true, null), true);
  assert.equal(showsProvisional(false, null), false);

  assert.equal(saleCameFrom({ source: "outbound", date: "2026-11-03", agentName: "Demo Agent" }), "The sale of Nov 3, 2026 · from an outbound call · sold by Demo Agent");
  assert.equal(saleCameFrom({ source: null, date: null, agentName: null }), "The sale");
  assert.equal(saleCameFrom(null), null);

  assert.equal(agentMismatchLine({ userId: "devin", name: "Devin Okafor" }, { userId: "demo", name: "Demo Agent" }), "Carrier pays Devin Okafor · sold by Demo Agent");
  assert.equal(agentMismatchLine({ userId: "demo", name: "Demo Agent" }, { userId: "demo", name: "Someone else's spelling" }), null, "the same person, by user");
  assert.equal(agentMismatchLine({ userId: null, name: null }, { userId: "demo", name: "Demo Agent" }), null, "an unmapped writing number is another item, not a mismatch");

  const page = read("app/app/(shell)/policies/carrier/[carrierId]/[policyNumber]/page.tsx");
  assert.match(page, /\{showsProvisional\(client\?\.provisional, keys\?\.link\) && <span/);
  assert.doesNotMatch(page, /\{client\?\.provisional && /);
  assert.match(page, /agentMismatchLine\(keys\.carrierAgent, \{ userId: keys\.sale\.agentUserId, name: keys\.sale\.agentName \}\)/);
  assert.match(page, /const cameFrom = view\.lead\.name \? null : saleCameFrom\(keys\?\.sale\);/);
  const store = read("lib/ingestion/policyPageStore.ts");
  // The deal's seller is who worked it; the application's is who opened its case (as AG-1.4 credits it).
  assert.match(store, /select\("lead_id, source, local_date, worked_by"\)/);
  assert.match(store, /select\("source, opened_by"\)/);
});
