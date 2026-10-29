/**
 * Module 2 import fixes (FIX builder I): LA-2.2-1 Excel, LA-2.2-4 zones and states, LA-2.2-9 the one
 * transaction and its words, LA-2.2-10 the resumable scrub, LA-2.4-8 no state, LA-2.6-1 certificates.
 * Behaviour where the code is pure; the source contract where it is server-only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const csv = await import("./csv.ts");
const xlsx = await import("./xlsx.ts");
const model = await import("./importReviewModel.ts");
const errors = await import("./errors.ts");
const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");

const fields = [
  { field_key: "first_name", label: "First name", type: "text", is_required: true, options: [], sort_order: 0 },
  { field_key: "last_name", label: "Last name", type: "text", is_required: true, options: [], sort_order: 1 },
  { field_key: "phone", label: "Phone", type: "phone", is_required: true, options: [], sort_order: 2 },
  { field_key: "state", label: "State", type: "single_select", is_required: false, options: ["TX", "FL"], sort_order: 3 },
];
const stages = [{ id: "s1", name: "New" }];

// ── LA-2.2-4 ────────────────────────────────────────────────────────────────────────────────────

test("split-zone ZIPs correct Florida and Tennessee, and only for their own state", () => {
  assert.equal(csv.splitZoneForZip("32501", "FL"), "America/Chicago", "Pensacola is Central");
  assert.equal(csv.splitZoneForZip("32401", "FL"), "America/Chicago", "Panama City is Central");
  assert.equal(csv.splitZoneForZip("32301", "FL"), "America/New_York", "Tallahassee is Eastern");
  assert.equal(csv.splitZoneForZip("37902", "TN"), "America/New_York", "Knoxville is Eastern");
  assert.equal(csv.splitZoneForZip("37402", "TN"), "America/New_York", "Chattanooga is Eastern");
  assert.equal(csv.splitZoneForZip("37501", "TN"), "America/Chicago", "Memphis 375 is Central, not Eastern");
  assert.equal(csv.splitZoneForZip("37201", "TN"), "America/Chicago", "Nashville is Central");
  assert.equal(csv.splitZoneForZip("32501", "GA"), null, "a ZIP that contradicts the state moves nothing");
  assert.equal(csv.splitZoneForZip("3250", "FL"), null, "a short value is not a ZIP");
});

test("the dialer zone is set by a split ZIP, never by a label on a single-zone state", () => {
  assert.equal(csv.importDialTimezone("Eastern", "32501", "FL"), "America/Chicago");
  assert.equal(csv.importDialTimezone("Central", "", "FL"), "America/Chicago", "FL with no ZIP may use its own second zone");
  assert.equal(csv.importDialTimezone("Pacific", "", "FL"), null, "a zone Florida does not have is ignored");
  assert.equal(csv.importDialTimezone("Eastern", "75201", "TX"), null, "a wrong label never moves a Texan");
  assert.equal(csv.importDialTimezone("", "30301", "GA"), null, "the state's own zone is not stored");
});

test("the ZIP correction applies with no timezone field, and fills one when the template has it", () => {
  const file = "first_name,last_name,phone,state,zip\nAda,One,2055550142,FL,32501\nBo,Two,8655550143,TN,37902\nCy,Three,2145550144,TX,75201\n";
  const { rows, errors: rowErrors } = csv.parseLeadCsvRows(file, fields.map((f) => (f.field_key === "state" ? { ...f, options: ["FL", "TN", "TX"] } : f)), stages);
  assert.equal(rowErrors.length, 0);
  assert.deepEqual(rows.map((row) => row.dialTimezone), ["America/Chicago", "America/New_York", null]);
  assert.equal("zip" in rows[0].values, false, "an unmapped column is read for the zone, not written into values");
  assert.equal("timezone" in rows[0].values, false, "no timezone field, no timezone value");

  const withField = [...fields, { field_key: "timezone", label: "Timezone", type: "text", is_required: false, options: [], sort_order: 4 }];
  const filled = csv.parseLeadCsvRows(file, withField, stages).rows;
  assert.deepEqual(filled.map((row) => row.values.timezone), ["America/Chicago", "America/New_York", "America/Chicago"]);
});

test("state names and case are normalised to USPS codes", () => {
  assert.equal(csv.normalizeImportState(" tennessee "), "TN");
  assert.equal(csv.normalizeImportState("New  York"), "NY");
  assert.equal(csv.normalizeImportState("fl"), "FL");
  assert.ok(csv.US_STATE_CODES.includes("TN") && csv.US_STATE_CODES.includes("DC") && csv.US_STATE_CODES.length === 51);
});

test("TN is accepted at import even when the template's state list lacks it", () => {
  const service = read("lib", "agentTemplates", "service.ts");
  const body = service.slice(service.indexOf("export function validateImportValues"), service.indexOf("export function validateSingleTemplateValue"));
  assert.match(body, /field\.field_key === "state" && field\.type === "single_select"/);
  assert.match(body, /options: \[\.\.\.new Set\(\[\.\.\.field\.options, \.\.\.US_STATE_CODES\]\)\]/);
});

// ── LA-2.2-9 ────────────────────────────────────────────────────────────────────────────────────

test("control characters, NUL included, never reach the database", () => {
  const { rows } = csv.parseLeadCsvRows("first_name,last_name,phone\nA\u0000da,On\u0007e,2055550142\n", fields, stages);
  assert.equal(rows[0].values.first_name, "Ada");
  assert.equal(rows[0].values.last_name, "One");
});

test("database refusals are put into words, and the original is kept for the log", () => {
  const nul = errors.friendlyImportCommitError({ code: "22P05", message: "unsupported Unicode escape sequence" });
  assert.ok(nul instanceof errors.ImportDatabaseError);
  assert.match(nul.message, /hidden character/);
  assert.match(nul.message, /Nothing was imported\./);
  assert.equal(nul.internal, "unsupported Unicode escape sequence");
  const surrogate = errors.friendlyImportCommitError({ code: "22P02", message: "invalid input syntax for type json" });
  assert.doesNotMatch(surrogate.message, /invalid input syntax/, "never the raw Postgres text");
  // Seen live: a lone-surrogate cell makes PostgREST refuse the whole commit payload.
  const brokenJson = errors.friendlyImportCommitError({ code: "PGRST102", message: "Empty or invalid json" });
  assert.match(brokenJson.message, /hidden character/);
  assert.equal(errors.friendlyImportCommitError({ message: "a stray \u0000 byte" }).message.includes("hidden character"), false, "the NUL rule matches the escape text, not any NUL");
  const staging = read("lib", "agentTemplates", "importPreflight.ts");
  assert.doesNotMatch(staging, /throw new Error\((staged|written|updated|inserted)\.error/, "staging refusals are worded too");
  assert.equal(errors.friendlyImportCommitError({ message: "IMPORT_BATCH_ALREADY_COMMITTED" }), null, "the caller words a double commit itself");
  assert.equal(errors.friendlyImportCommitError({ code: "PGRST202", message: "Could not find the function" }), null, "a missing function is a deployment fault");
  const classified = errors.classifyImportFailure(nul);
  assert.equal(classified.message, nul.message);
  assert.equal(classified.cause, "unsupported Unicode escape sequence");
});

test("the ledger, leads, zone and certificates commit in one transaction, ledger first", () => {
  const sql = read("supabase", "migrations", "20260925709610_commit_reviewed_lead_import.sql");
  const body = sql.slice(sql.indexOf("create or replace function public.commit_reviewed_lead_import"), sql.indexOf("revoke all on function public.commit_reviewed_lead_import"));
  const lock = body.indexOf("for update");
  const ledger = body.indexOf("public.record_campaign_scrub_rejections(");
  const leads = body.indexOf("public.import_agent_lead_batch(");
  const zone = body.indexOf("set dial_timezone");
  const certs = body.indexOf("insert into public.tenant_consent_artefacts");
  assert.ok(lock > 0 && lock < ledger && ledger < leads && leads < zone && zone < certs, "lock → ledger → leads → zone → certificates, in one body");
  assert.match(body, /on conflict \(tenant_id, lead_id, provider\) do nothing/);
  assert.match(sql, /grant execute on function public\.commit_reviewed_lead_import\(uuid, uuid, jsonb, uuid, jsonb, jsonb\) to service_role/);

  const writer = read("lib", "agentTemplates", "importCommit.ts");
  // Before the migration: the leads commit first and the ledger is written only after they did.
  const fallbackLeads = writer.indexOf('await db.rpc("import_agent_lead_batch"');
  const fallbackLedger = writer.indexOf("await recordLedger(");
  assert.ok(fallbackLeads > 0 && fallbackLedger > fallbackLeads, "the fallback writes the ledger only after the leads committed");
  assert.match(writer, /if \(!isMissingFunction\(result\.error\)\) throw refusalOf\(result\.error\)/, "only a missing function falls back");
});

test("both import paths commit through the one writer, and the direct path's ledger goes with it", () => {
  const service = read("lib", "agentTemplates", "service.ts");
  const body = service.slice(service.indexOf("export async function importAgentLeads"), service.indexOf("export async function updateAgentLead"));
  const code = body.replace(/\/\/[^\n]*/g, "");
  assert.doesNotMatch(code, /rpc\("record_campaign_scrub_rejections"/, "no ledger round trip before the leads");
  assert.match(code, /commitLeadImport\(\{ tenantId, userId, items, batchId: null, spend: null, campaignId: campaignId \?\? null, rejections: ledger \}\)/);
  assert.match(code, /projectedUsableCostCents\(campaign\.data, ledger\.length\)/);
  const commit = read("lib", "agentTemplates", "importPreflight.ts");
  assert.match(commit.slice(commit.indexOf("export async function commitImport")), /await commitLeadImport\(\{/);
});

test("the commit reads the file against the form definition the review pinned", () => {
  const source = read("lib", "agentTemplates", "importPreflight.ts");
  assert.match(source, /definitionVersion: input\.template\.assignment\.definition_version \?\? null/);
  const commit = source.slice(source.indexOf("export async function commitImport"));
  assert.match(commit, /const template = await pinnedTemplate\(input\.tenantId, input\.template, plan\.definitionVersion\)/);
  assert.match(commit, /validateImportValues\(template\.template\.fields, row\.values\)/);
  assert.doesNotMatch(commit, /validateImportValues\(input\.template/, "the current form never judges a reviewed row");
});

test("a file's own rejections are counted into the cost per usable record before they land", () => {
  const campaign = { total_spend_cents: 10_000, credits_received_cents: 0, records_purchased: 100, records_rejected: 10, cost_per_record_cents: 100, cost_per_usable_record_cents: 111.1 };
  assert.equal(model.projectedUsableCostCents(campaign, 0), 111);
  assert.equal(model.projectedUsableCostCents(campaign, 40), 200, "10,000 over 50 usable");
  assert.equal(model.projectedUsableCostCents(campaign, 90), 100, "nothing usable: the purchased basis");
  assert.equal(model.projectedUsableCostCents({ cost_per_usable_record_cents: 42.4 }, 3), 42, "an older view without the counts");
});

// ── LA-2.2-10 ───────────────────────────────────────────────────────────────────────────────────

test("the scrub is a resumable job: stepped, stored, and staged only when every number is answered", () => {
  const source = read("lib", "agentTemplates", "importPreflight.ts");
  assert.match(source, /kind: "screening"/);
  assert.match(source, /\.eq\("response->>step", String\(job\.step\)\)/, "a step writes only over the step it read");
  assert.match(source, /if \(decision\.outcome === "unavailable"\) \{[\s\S]{0,200}return;/, "an unknown answer stays pending");
  assert.match(source, /const finished = job\.phones\.every\(\(phone\) => job\.screened\[phone\]\);\s*if \(!finished \|\| !input\.csv\) return/);
  assert.match(source, /export const STEP_BUDGET_MS = 20_000/);
  const route = read("app", "api", "app", "leads", "import", "preflight", "route.ts");
  assert.match(route, /export async function PATCH\(/);
  assert.match(route, /export const maxDuration = 60/);
  assert.match(route, /status: 202/);
  const bridge = read("components", "app", "import-review-bridge.tsx");
  assert.match(bridge, /method: "PATCH"/);
  assert.match(bridge, /export function ImportScreeningBridge/);
  const page = read("app", "app", "(shell)", "import", "review", "[batchId]", "page.tsx");
  assert.match(page, /state === "screening" && progress\) return <ImportScreeningBridge/);
});

// ── LA-2.4-8 ────────────────────────────────────────────────────────────────────────────────────

test("a new lead with no state is flagged on the review, before the commit", () => {
  const source = read("lib", "agentTemplates", "importPreflight.ts");
  assert.match(source, /record\(\{ \.\.\.base, outcome: "ready", detail: null \}, "ready"\);\s*\/\/[^\n]*\n\s*if \(!base\.state\) noState\.push\(row\.rowNumber\)/);
  const review = read("components", "app", "import-review-workspace.tsx");
  assert.match(review, /noState\.length > 0 && /);
  assert.match(review, /no state, so the dialer will not call/);
});

// ── LA-2.6-1 ────────────────────────────────────────────────────────────────────────────────────

test("a TrustedForm column is captured at import, unmapped, with its certificate id", () => {
  const file = "first_name,last_name,phone,xxTrustedFormCertUrl,consent_ip,consent_timestamp\nAda,One,2055550142,https://cert.trustedform.com/0123456789abcdef0123456789abcdef01234567,198.51.100.7,2026-09-29T10:00:00Z\nBo,Two,2055550143,,,\n";
  const { rows } = csv.parseLeadCsvRows(file, fields, stages);
  assert.deepEqual(rows[0].consent, {
    provider: "trustedform",
    certificate_id: "0123456789abcdef0123456789abcdef01234567",
    certificate_url: "https://cert.trustedform.com/0123456789abcdef0123456789abcdef01234567",
    consent_timestamp: "2026-09-29T10:00:00.000Z",
    ip: "198.51.100.7",
    source_url: null,
    landing_page: null,
  });
  assert.equal(rows[1].consent, null, "no certificate, nothing filed");
  assert.equal("xxtrustedformcerturl" in rows[0].values, false);
  const commit = read("lib", "agentTemplates", "importPreflight.ts");
  assert.match(commit, /consent: row\.consent \?\? null/);
});

// ── LA-2.2-1 ────────────────────────────────────────────────────────────────────────────────────

test("an Excel sheet becomes the same CSV text a CSV upload gives", () => {
  const sheet = [
    [{ value: "first_name" }, { value: "last_name" }, { value: "phone" }, { value: "zip" }, { value: "dob" }, { value: null }],
    [{ value: "Ada" }, { value: { richText: [{ text: "O'" }, { text: "Neil, Jr" }] } }, { value: 2055550142 }, { value: 3001, numFmt: "00000" }, { value: new Date(Date.UTC(1961, 4, 6)) }],
    [{ value: null }, { value: "" }, { value: null }],
    [{ value: "Bo" }, { value: { formula: "A1", result: "Two" } }, { value: { text: "205 555 0143", hyperlink: "tel:2055550143" } }, { value: "32501" }, { value: 25569 }],
  ];
  const text = xlsx.rowsToCsv(sheet);
  assert.equal(text, 'first_name,last_name,phone,zip,dob\nAda,"O\'Neil, Jr",2055550142,03001,1961-05-06\nBo,Two,205 555 0143,32501,25569');
  // And the importer reads it exactly as it reads a CSV.
  const { rows, errors: rowErrors } = csv.parseLeadCsvRows(text, fields, stages);
  assert.equal(rowErrors.length, 0);
  assert.deepEqual(rows.map((row) => row.values.phone), ["2055550142", "2055550143"]);
  assert.equal(xlsx.isXlsxFile({ name: "List.XLSX" }), true);
  assert.equal(xlsx.isXlsxFile({ name: "list.csv", type: "text/csv" }), false);
  assert.equal(xlsx.cellText({ value: 1e10 }), "10000000000", "never exponent notation");
  assert.equal(xlsx.cellText({ value: { error: "#N/A" } }), "");
  const workspace = read("components", "app", "lead-import-workspace.tsx");
  assert.match(workspace, /accept=\{`\.csv,text\/csv,\$\{XLSX_TYPES\}`\}/);
  assert.match(workspace, /readXlsxAsCsv\(await chosen\.arrayBuffer\(\)\)/);
  assert.match(read("package.json"), /"exceljs": "\^4\./);
});
