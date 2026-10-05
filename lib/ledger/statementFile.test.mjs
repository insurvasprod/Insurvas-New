// LA-4.1 – LA-4.3 · statement files, PDF entry, name matching and re-processing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { statementFileKind, statementBytesMatch, statementFileProblem, statementStoragePath, STATEMENT_FILE_ACCEPT } = await import("./statementFile.ts");
const { normaliseInsuredName, proposeExactMatches, proposeFallbackMatches } = await import("./statementMatch.ts");
const { parseRateBp, parseStatementCsv, suggestStatementMapping } = await import("./statementParse.ts");
const { MAX_STATEMENT_FILE_BYTES } = await import("./statementConstants.ts");

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const bytes = (...values) => new Uint8Array(values);

// ── 4.1 · the file as it arrives ─────────────────────────────────────────────

test("4.1: a statement file is CSV, Excel or PDF, by its name first and its type second", () => {
  assert.equal(statementFileKind({ name: "AUG-2026.CSV" }), "csv");
  assert.equal(statementFileKind({ name: "mutual-aug.xlsx" }), "xlsx");
  assert.equal(statementFileKind({ name: "americo statement.pdf" }), "pdf");
  assert.equal(statementFileKind({ name: "statement", type: "application/pdf" }), "pdf");
  assert.equal(statementFileKind({ name: "statement.xls" }), null, "the old binary Excel format is not read");
  assert.equal(statementFileKind({ name: "notes.docx" }), null);
  assert.match(STATEMENT_FILE_ACCEPT, /\.csv/);
  assert.match(STATEMENT_FILE_ACCEPT, /\.xlsx/);
  assert.match(STATEMENT_FILE_ACCEPT, /\.pdf/);
});

test("4.1: the first bytes must be what the name says", () => {
  assert.equal(statementBytesMatch("pdf", bytes(0x25, 0x50, 0x44, 0x46, 0x2d)), true);
  assert.equal(statementBytesMatch("pdf", bytes(0x50, 0x4b, 0x03, 0x04)), false);
  assert.equal(statementBytesMatch("xlsx", bytes(0x50, 0x4b, 0x03, 0x04, 0x14)), true);
  assert.equal(statementBytesMatch("xlsx", new TextEncoder().encode("Policy,Amount")), false);
  assert.equal(statementBytesMatch("csv", new TextEncoder().encode("Policy,Amount\nA1,10")), true);
  assert.equal(statementBytesMatch("csv", bytes(0x50, 0x00, 0x41)), false, "a NUL byte means it is not text");
});

test("4.1: a file that cannot be imported gets a sentence the person can act on", () => {
  assert.match(statementFileProblem({ name: "a.docx", size: 10 }), /CSV, an Excel \(\.xlsx\) or a PDF/);
  assert.match(statementFileProblem({ name: "a.csv", size: 0 }), /empty/);
  assert.match(statementFileProblem({ name: "a.pdf", size: MAX_STATEMENT_FILE_BYTES + 1 }), /larger than 4 MB/);
  assert.match(statementFileProblem({ name: "a.pdf", size: 10 }, bytes(0x50, 0x4b, 0x03, 0x04)), /not the PDF/);
  assert.equal(statementFileProblem({ name: "a.csv", size: 10 }, new TextEncoder().encode("a,b")), null);
});

test("4.1: an original is stored under its own workspace, named by its content", () => {
  const sha = "a".repeat(64);
  assert.equal(statementStoragePath("t-1", sha, "pdf"), `t-1/statements/${sha}.pdf`);
  assert.throws(() => statementStoragePath("t-1", "../../other", "csv"), /SHA-256/);
});

test("4.1: the import keeps the original, reads Excel on the server, and falls back before the migration", () => {
  const service = read("lib/ledger/statementService.ts");
  assert.match(service, /export async function importStatementFile\(/);
  assert.match(service, /readXlsxAsCsv\(buffer\)/, "a workbook is read by the same code the browser previews with");
  assert.match(service, /storeOriginal\(tenantId, input\.kind, sha256, input\.bytes\)/);
  assert.match(service, /"import_commission_statement_v2"/);
  // Before 20261002100000 a CSV still imports through the LA-0 function; a PDF waits.
  assert.match(service, /if \(v2\.error && isPending\(v2\.error\)\)[\s\S]*?if \(input\.kind === "pdf" \|\| input\.reprocessFrom\)[\s\S]*?"import_commission_statement"/);
  // A failed import removes an original nothing points at.
  assert.match(service, /async function releaseOriginal\([\s\S]*?\.eq\("storage_path", path\)/);
  // Reads keep working on a database the migration has not reached.
  assert.match(service, /async function withStatementColumns/);
  const route = read("app/api/app/statements/route.ts");
  assert.match(route, /multipart\/form-data/);
  assert.match(route, /readStatementFileForm\(form\)/);
  assert.match(route, /importStatement\(auth\.context\.tenantId/, "the LA-0 JSON body is still accepted");
  const file = read("app/api/app/statements/[id]/file/route.ts");
  assert.match(file, /requireFeatureRole\("statement_ingestion", roles\)/);
  assert.match(service, /createSignedUrl\(row\.storage_path, 60/);
  assert.match(service, /if \(!row\.storage_path\.startsWith\(`\$\{tenantId\}\/`\)\)/);
});

// ── 4.2 · PDF statements are typed in ─────────────────────────────────────────

test("4.2: a PDF is stored and waits for its lines; nothing parses it", () => {
  const sql = read("supabase/migrations/20261002100000_la_4_1_4_3_statement_files_entry_matching.sql");
  assert.match(sql, /when p_file_kind = 'pdf' then 'awaiting_entry'/);
  assert.match(sql, /A PDF statement''s lines are typed in after it is stored/);
  assert.match(sql, /create or replace function public\.add_manual_statement_lines/);
  assert.match(sql, /if v_statement\.status <> 'awaiting_entry' then\s+raise exception 'This statement is not waiting for its lines to be entered' using errcode = '55000'/);
  const service = read("lib/ledger/statementService.ts");
  const csvOf = service.slice(service.indexOf("async function csvOf"), service.indexOf("async function storeOriginal"));
  assert.doesNotMatch(csvOf, /pdf/i, "no branch reads a PDF's bytes");
  assert.match(service, /export async function addManualStatementLines\([\s\S]*?parseAmountCents\(amountText\)[\s\S]*?parseStatementDate\(dateText\)/, "typed lines are read by the file's rules");
  assert.match(service, /"add_manual_statement_lines"/);
  const lines = read("app/api/app/statements/[id]/lines/route.ts");
  assert.match(lines, /add_manual_lines/);
  assert.match(lines, /requireFeatureRole\("statement_ingestion", roles, \{ write: true \}\)/);
});

// ── 4.3 · matching by name, re-matching, re-processing ────────────────────────

const carrier = { id: "c1", code: "MOO", name: "Mutual of Omaha" };
const policies = [
  { id: "p1", policyNumber: "MO-1001", insuredName: "Marla Jenkins", carrier: "Mutual of Omaha" },
  { id: "p2", policyNumber: "MO-1002", insuredName: "Robert Cline", carrier: "Mutual of Omaha" },
  { id: "p3", policyNumber: "MO-1003", insuredName: "Robert Cline", carrier: "Mutual of Omaha" },
  { id: "p4", policyNumber: "AM-2001", insuredName: "Dolores Ruiz", carrier: "Americo" },
];
const line = (lineNumber, policyNumber, insuredName, amountCents = 5000) => ({ lineNumber, policyNumber, insuredName, amountCents, error: null });

test("4.3: names are compared the way carriers print them", () => {
  assert.equal(normaliseInsuredName("JENKINS, MARLA"), "marla jenkins");
  assert.equal(normaliseInsuredName("Marla J. Jenkins"), "marla jenkins", "a middle initial is dropped");
  assert.equal(normaliseInsuredName("  marla   jenkins "), "marla jenkins");
});

test("4.3: a unique insured name with the statement's carrier is proposed, by name, and only when the number did not match", () => {
  const lines = [line(1, "MO-1001", "Marla Jenkins"), line(2, "MO1O01-typo", "JENKINS, MARLA")];
  const exact = proposeExactMatches(lines, policies, carrier);
  const named = proposeFallbackMatches(lines, policies, carrier, exact);
  assert.equal(exact.get(1).policyId, "p1");
  assert.equal(named.has(1), false, "an exact proposal is not second-guessed");
  assert.equal(named.get(2).policyId, "p1");
  assert.equal(named.get(2).method, "name");
  assert.match(named.get(2).reason, /Check before accepting/);
});

test("4.3: an ambiguous name, or a name with another carrier, proposes nothing", () => {
  const lines = [line(1, "", "Robert Cline"), line(2, "", "Dolores Ruiz")];
  const named = proposeFallbackMatches(lines, policies, carrier, proposeExactMatches(lines, policies, carrier));
  assert.equal(named.get(1).policyId, null);
  assert.match(named.get(1).reason, /2 Mutual of Omaha policies are for Robert Cline/);
  assert.equal(named.has(2), false, "Dolores Ruiz is an Americo policy, not this carrier's");
});

test("4.3: the amount breaks a name tie when one policy's expected entry is within the tolerance", () => {
  const lines = [line(1, "", "Robert Cline", 4210)];
  const expected = new Map([["p2", [4205]], ["p3", [9000]]]);
  const named = proposeFallbackMatches(lines, policies, carrier, proposeExactMatches(lines, policies, carrier), expected);
  assert.equal(named.get(1).policyId, "p2");
  assert.match(named.get(1).reason, /name, carrier and amount match/);
  const both = proposeFallbackMatches(lines, policies, carrier, new Map(), new Map([["p2", [4205]], ["p3", [4250]]]));
  assert.equal(both.get(1).policyId, null, "two policies within the tolerance is still a tie");
});

test("4.3: premium and rate columns are read when a carrier sends them", () => {
  assert.equal(parseRateBp("110%"), 11000);
  assert.equal(parseRateBp("110"), 11000);
  assert.equal(parseRateBp("1.10"), 11000);
  assert.equal(parseRateBp("0.85"), 8500);
  assert.equal(parseRateBp("abc"), null);
  const csv = "Policy,Amount,Premium,Rate\nMO-1001,642.60,714.00,90%\nMO-1002,10,lots,1.1";
  const parsed = parseStatementCsv(csv, { policyNumber: "Policy", amount: "Amount", premium: "Premium", rate: "Rate" });
  assert.equal(parsed.lines[0].premiumCents, 71400);
  assert.equal(parsed.lines[0].rateBp, 9000);
  assert.match(parsed.lines[1].error, /“lots” is not a premium/);
  const guess = suggestStatementMapping(["Policy Number", "Commission Amount", "Annual Premium", "Commission Rate"]);
  assert.equal(guess.premium, "Annual Premium");
  assert.equal(guess.rate, "Commission Rate");
});

test("4.3: a name match is a proposal in the database too, and re-match and re-process are one transaction each", () => {
  const sql = read("supabase/migrations/20261002100000_la_4_1_4_3_statement_files_entry_matching.sql");
  assert.match(sql, /check \(method in \('exact', 'name', 'manual'\)\)/);
  assert.match(sql, /check \(method in \('exact', 'name'\) or status <> 'proposed'\)/);
  assert.match(sql, /create or replace function public\.rematch_commission_statement_lines/);
  assert.match(sql, /and l\.review_status = 'unmatched'/, "a line left unmatched on purpose is not touched");
  // Re-processing voids the old statement inside the import's own transaction.
  assert.match(sql, /if p_reprocessed_from is not null then\s+update public\.tenant_commission_statements\s+set status = 'voided'/);
  assert.match(sql, /new\.reprocessed_from is distinct from old\.reprocessed_from/, "where a statement came from is fixed");
  assert.match(sql, /new\.row_count <> old\.row_count and old\.status <> 'awaiting_entry'/, "row count changes only while lines are typed in");
  const service = read("lib/ledger/statementService.ts");
  assert.match(service, /export async function reprocessStatement\(/);
  assert.match(service, /if \(row\.file_kind === "pdf"\) throw new StatementError/);
  assert.match(service, /export async function rematchStatementLines\(/);
  const policy = read("lib/entitlements/agentApiPolicy.ts");
  for (const route of ["statements/[id]/file/route.ts", "statements/unmatched/route.ts"]) assert.ok(policy.includes(`app/api/app/${route}`), `${route} is registered`);
  const actions = read("lib/audit/actions.ts");
  for (const action of ["tenant.statement_lines_entered_manually", "tenant.statement_lines_rematched", "tenant.commission_statement_reprocessed"]) assert.ok(actions.includes(`"${action}"`), action);
});

test("4.3: re-matching never proposes a pairing a person already rejected", () => {
  const service = read("lib/ledger/statementService.ts");
  const fn = service.slice(service.indexOf("export async function rematchStatementLines"), service.indexOf("// ── review"));
  assert.match(fn, /rejectedPairs\(tenantId, scoped\.map\(\(line\) => line\.id\)\)/);
  assert.match(fn, /!rejected\.has\(`\$\{line\.id\}\|\$\{hit\.policyId\}`\)/);
  assert.match(service, /async function rejectedPairs\([\s\S]*?start \+= 200[\s\S]*?\.eq\("status", "rejected"\)/);
});
