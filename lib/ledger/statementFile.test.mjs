// LA-4.1 – LA-4.3 · statement files, PDF entry, name matching and re-processing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { statementFileKind, statementBytesMatch, statementFileProblem, statementStoragePath, STATEMENT_FILE_ACCEPT } = await import("./statementFile.ts");
const { parseRateBp, parseStatementCsv, suggestStatementMapping } = await import("./statementParse.ts");
const { MAX_STATEMENT_FILE_BYTES } = await import("./statementConstants.ts");

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const bytes = (...values) => new Uint8Array(values);
// A parsed line without its verbatim cells, which differ by source (file headers vs typed labels).
const withoutRaw = (line) => { const copy = { ...line }; delete copy.raw; return copy; };

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

test("4.1: an Excel statement reads into the same lines as the equivalent CSV", async () => {
  const { readXlsxAsCsv } = await import("../agentTemplates/xlsx.ts");
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  // A hidden sheet first: the import reads the first VISIBLE one, as a person sees the workbook.
  workbook.addWorksheet("Notes", { state: "hidden" }).addRow(["not a statement"]);
  const sheet = workbook.addWorksheet("August 2026");
  sheet.addRow(["Policy Number", "Insured", "Commission Amount", "Type", "Paid Date"]);
  sheet.addRow(["MO-1001", "Marla Jenkins", 642.6, "Advance", new Date(Date.UTC(2026, 7, 15))]);
  sheet.addRow(["MO-1002", "Robert Cline", -120.5, "Chargeback", new Date(Date.UTC(2026, 7, 20))]);
  sheet.addRow(["00731", "Dolores Ruiz", 1000, "Commission", new Date(Date.UTC(2026, 7, 31))]);
  sheet.getCell("A4").numFmt = "@"; // a text column keeps its leading zeros
  const buffer = await workbook.xlsx.writeBuffer();

  const read = await readXlsxAsCsv(buffer);
  assert.equal(read.sheetName, "August 2026");
  const csv = [
    "Policy Number,Insured,Commission Amount,Type,Paid Date",
    "MO-1001,Marla Jenkins,642.60,Advance,2026-08-15",
    "MO-1002,Robert Cline,-120.50,Chargeback,2026-08-20",
    "00731,Dolores Ruiz,1000.00,Commission,2026-08-31",
  ].join("\n");
  const mapping = { policyNumber: "Policy Number", insuredName: "Insured", amount: "Commission Amount", kind: "Type", lineDate: "Paid Date" };
  const fromWorkbook = parseStatementCsv(read.csv, mapping).lines.map(withoutRaw);
  const fromCsv = parseStatementCsv(csv, mapping).lines.map(withoutRaw);
  assert.deepEqual(fromWorkbook, fromCsv);
  assert.equal(fromWorkbook.filter((line) => line.error).length, 0);
});

test("4.1: the preview checks duplicates by the ORIGINAL file's hash, the one the import stores", () => {
  const dialog = read("components/app/statement-import.tsx");
  assert.match(dialog, /crypto\.subtle\.digest\("SHA-256", await file\.arrayBuffer\(\)\)/, "hashed from the file's bytes, not its CSV text");
  assert.match(dialog, /file_sha256: fileSha256/);
  const http = read("lib/ledger/statementHttp.ts");
  assert.match(http, /file_sha256: z\.string\(\)\.regex\(\/\^\[0-9a-f\]\{64\}\$\//);
  const service = read("lib/ledger/statementService.ts");
  assert.match(service, /export async function previewStatement[\s\S]*?prepare\(tenantId, input, input\.fileSha256\)/);
  // The import never takes the browser's word for it: it hashes the bytes it received.
  const importFile = service.slice(service.indexOf("export async function importStatementFile"), service.indexOf("export async function importStatement("));
  assert.match(importFile, /const sha256 = sha256Of\(input\.bytes\);/);
  assert.doesNotMatch(importFile, /fileSha256/);
});

test("4.1: a file that cannot be stored stops the import before any statement row exists", () => {
  const service = read("lib/ledger/statementService.ts");
  const store = service.slice(service.indexOf("async function storeOriginal"), service.indexOf("async function releaseOriginal"));
  assert.match(store, /if \(\/bucket not found\/i\.test\(up\.error\.message\)\) return null;/, "only a missing bucket (before the migration) imports without the original");
  assert.doesNotMatch(store, /\|not found\//, "an object or permission error is not mistaken for a missing bucket");
  assert.match(store, /throw new StatementError\("The file could not be stored, so nothing was imported/);
  const importFile = service.slice(service.indexOf("export async function importStatementFile"), service.indexOf("export async function importStatement("));
  assert.ok(importFile.indexOf("storeOriginal(") < importFile.indexOf('"import_commission_statement_v2"'), "the file is stored before the statement row is written");
  // The bytes stored are the bytes received, so the download is the upload.
  assert.match(importFile, /storeOriginal\(tenantId, input\.kind, sha256, input\.bytes\)/);
});

test("4.1: the import keeps the original, reads Excel on the server, and falls back before the migration", () => {
  const service = read("lib/ledger/statementService.ts");
  assert.match(service, /export async function importStatementFile\(/);
  assert.match(service, /readXlsxAsCsv\(buffer\)/, "a workbook is read by the same code the browser previews with");
  assert.match(service, /storeOriginal\(tenantId, input\.kind, sha256, input\.bytes\)/);
  assert.match(service, /"import_commission_statement_v2"/);
  // One import path: v2, which keeps the original. The LA-0 function is dropped (20261007120000).
  assert.doesNotMatch(service, /rpc\("import_commission_statement"/, "the LA-0 import is never called");
  assert.match(service, /if \(isPending\(result\.error\)\) throw new StatementSchemaPendingError\(STATEMENT_FILES_PENDING_MESSAGE\);/, "without v2, nothing imports and the person is told why");
  const drop = read("supabase/migrations/20261007120000_la_4_drop_v1_statement_import.sql");
  assert.match(drop, /drop function if exists public\.import_commission_statement\(uuid, uuid, uuid, date, date, text, text, jsonb, jsonb, jsonb\);/);
  assert.match(drop, /import_commission_statement_v2 is missing; do not drop v1 without it/);
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
  const manual = service.slice(service.indexOf("export async function addManualStatementLines"), service.indexOf("// ── the unmatched queue"));
  assert.match(manual, /readStatementLine\(/, "typed lines go through the file's own line reader");
  assert.doesNotMatch(manual, /parseAmountCents|parseStatementDate|parseStatementKind/, "and do not re-implement any of it");
  assert.match(manual, /proposeAll\(tenantId, lines, await readPolicies\(tenantId\), carrier/, "and are matched by the file's matcher");
  assert.match(manual, /if \(row\.status !== "awaiting_entry"\) throw new StatementError\([^)]*, 409, "not_awaiting_entry"\)/, "a statement not waiting for lines answers 409");
  assert.match(service, /"add_manual_statement_lines"/);
  const lines = read("app/api/app/statements/[id]/lines/route.ts");
  assert.match(lines, /add_manual_lines/);
  assert.match(lines, /requireFeatureRole\("statement_ingestion", roles, \{ write: true \}\)/);
});

test("4.2: typed and imported lines agree, case by case", async () => {
  const { readStatementLine } = await import("./statementParse.ts");
  const rows = [
    ["MO-1001", "Marla Jenkins", "642.60", "Advance", "2026-08-15"],
    ["MO-1002", "Robert Cline", "120.50", "Chargeback", ""], // a positive chargeback is still money taken back
    ["MO-1003", "", "-75.00", "", ""], // no kind: the sign decides
    ["", "Dolores Ruiz", "$1,000.00", "", "08/31/2026"],
    ["MO-1004", "", "lots", "Commission", "someday"], // unreadable amount and date
    ["MO-1005", "", "", "", ""], // no amount
  ];
  const csv = ["Policy,Insured,Amount,Kind,Date", ...rows.map((cells) => cells.map((cell) => (cell.includes(",") ? `"${cell}"` : cell)).join(","))].join("\n");
  const fromFile = parseStatementCsv(csv, { policyNumber: "Policy", insuredName: "Insured", amount: "Amount", kind: "Kind", lineDate: "Date" }).lines;
  rows.forEach(([policyNumber, insuredName, amount, kind, lineDate], index) => {
    const typed = readStatementLine({ policyNumber, insuredName, amount, kind: kind.toLowerCase(), lineDate }, index + 1, {});
    const file = withoutRaw(fromFile[index]);
    const line = withoutRaw(typed);
    assert.deepEqual(line, file, `line ${index + 1}`);
  });
  assert.equal(fromFile[1].amountCents, -12050);
  assert.equal(fromFile[2].kind, "chargeback");
  assert.equal(fromFile[2].kindFrom, "sign");
  assert.match(fromFile[4].error, /not an amount[\s\S]*not a date/);
  assert.match(fromFile[5].error, /No amount/);
});

test("4.2: a read-only account sees the PDF and the queue, never the entry grid", () => {
  const entry = read("components/app/statement-manual-entry.tsx");
  const readOnlyBranch = entry.slice(entry.indexOf("if (!canWrite) {"), entry.indexOf("return (", entry.indexOf("if (!canWrite) {") + 40));
  assert.match(readOnlyBranch, /\{viewer\}/, "the PDF stays readable");
  assert.doesNotMatch(readOnlyBranch, /<table|<TableCard|Record /, "no grid and no record button");
  assert.doesNotMatch(entry, /disabled=\{!canWrite\}/, "the grid is not merely greyed out");
  const table = read("components/app/statements-table.tsx");
  assert.match(table, /readOnly \? "Open" : /, "the list does not offer Enter lines to a read-only account");
  assert.match(table, /awaiting_entry: \{ label: "Lines to type in"/, "the queue is a status the list filters by");
  const page = read("app/app/(shell)/statements/page.tsx");
  assert.match(page, /statement\.status === "awaiting_entry"/, "PDFs waiting for lines are counted");
  assert.match(page, /readOnly=\{readOnly\}/);
});

test("4.2: typed lines survive leaving the page, and are cleared once recorded", () => {
  const entry = read("components/app/statement-manual-entry.tsx");
  assert.match(entry, /const draftKey = \(statementId: string\) => `insurvas\.statement-lines-draft\.\$\{statementId\}`/);
  // useSyncExternalStore underneath: the server's empty grid and the browser's first paint agree.
  assert.match(entry, /usePersistedState<unknown>\(draftKey\(statementId\), null\)/);
  assert.match(entry, /const lines = useMemo\(\(\) => draftLines\(draft\), \[draft\]\)/, "a stored draft is re-read field by field, never trusted");
  assert.match(entry, /throw new Error\(data\.error \?\? "The lines were not recorded\."\);[\s\S]{0,80}setDraft\(null\);/, "cleared only after the server accepted the lines");
  // Foundation v3: the shared confirm dialog, not the browser's box.
  assert.match(entry, /confirmAction\(\{ title: "Clear every line typed so far\?"/, "clearing a long draft asks first");
});

// ── 4.3 · matching by name, re-matching, re-processing ────────────────────────

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
  assert.match(sql, /and l\.review_status = 'unmatched'/, "the original function re-matched unmatched lines only (20261006100000 adds the opt-in for left_unmatched)");
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

test("4.3 (option c): lines left unmatched join a re-match only when the person asks", () => {
  const sql = read("supabase/migrations/20261006100000_la_4_3_rematch_left_unmatched.sql");
  assert.match(sql, /drop function if exists public\.rematch_commission_statement_lines\(uuid, uuid, jsonb\);/, "the 3-argument form goes, so a call is never ambiguous");
  assert.match(sql, /p_include_left_unmatched boolean default false/, "off unless asked");
  assert.match(sql, /and \(l\.review_status = 'unmatched' or \(coalesce\(p_include_left_unmatched, false\) and l\.review_status = 'left_unmatched'\)\)/);
  assert.match(sql, /and s\.status <> 'voided'/, "a voided statement's lines are never re-proposed");
  assert.match(sql, /m\.status = 'rejected'[\s\S]*?continue;/, "the database itself never re-proposes a rejected pairing");
  assert.match(sql, /grant execute on function public\.rematch_commission_statement_lines\(uuid, uuid, jsonb, boolean\) to service_role;/);
  assert.match(sql, /do \$\$[\s\S]*pronargs = 3[\s\S]*pronargdefaults = 1[\s\S]*has_function_privilege\('anon'/, "the migration checks itself");

  const service = read("lib/ledger/statementService.ts");
  assert.match(service, /const statuses: StatementLineReview\[\] = options\.includeLeftUnmatched \? \["unmatched", "left_unmatched"\] : \["unmatched"\];/);
  const rematch = service.slice(service.indexOf("export async function rematchStatementLines"), service.indexOf("// ── review"));
  assert.match(rematch, /includeLeftUnmatched = false/, "off by default");
  // Plain re-matching sends three arguments, so it works whether or not 20261006100000 is applied.
  assert.match(rematch, /includeLeftUnmatched\s*\? \{ [^}]*p_include_left_unmatched: true \}\s*: \{ p_tenant_id: tenantId, p_actor_user_id: actorUserId, p_proposals: proposals \}/);
  assert.match(rematch, /REMATCH_LEFT_UNMATCHED_PENDING_MESSAGE/, "asking before the migration says what is missing");

  const http = read("lib/ledger/statementHttp.ts");
  assert.match(http, /rematchSchema = z\.object\(\{ action: z\.literal\("rematch"\), include_left_unmatched: z\.boolean\(\)\.optional\(\) \}\)\.strict\(\)/);
  for (const route of ["app/api/app/statements/unmatched/route.ts", "app/api/app/statements/[id]/lines/route.ts"]) {
    const source = read(route);
    assert.match(source, /const includeLeftUnmatched = body\.data\.include_left_unmatched === true;/, route);
    assert.match(source, /metadata: \{ tenantId[^}]*includeLeftUnmatched/, `${route} records the choice in the audit row`);
  }
  for (const screen of ["components/app/statement-review.tsx", "components/app/unmatched-lines-table.tsx"]) {
    const source = read(screen);
    assert.match(source, /<ToolbarCheckbox/, `${screen} offers the option`);
    assert.match(source, /include_left_unmatched: true/, `${screen} sends it only when ticked`);
    assert.match(source, /rematchCount === 0/, `${screen} disables Re-match when nothing would be re-matched`);
  }
});

test("4.3 (option c): the schema accepts the option and nothing else", async () => {
  const { z } = await import("zod");
  const schema = z.object({ action: z.literal("rematch"), include_left_unmatched: z.boolean().optional() }).strict();
  assert.equal(schema.safeParse({ action: "rematch" }).success, true);
  assert.equal(schema.safeParse({ action: "rematch", include_left_unmatched: true }).success, true);
  assert.equal(schema.safeParse({ action: "rematch", include_left_unmatched: "yes" }).success, false);
  assert.equal(schema.safeParse({ action: "rematch", everything: true }).success, false);
  // The schema above is the one in statementHttp.ts, character for character.
  assert.ok(read("lib/ledger/statementHttp.ts").includes('z.object({ action: z.literal("rematch"), include_left_unmatched: z.boolean().optional() }).strict()'));
});

test("4.3: re-matching never proposes a pairing a person already rejected", () => {
  const service = read("lib/ledger/statementService.ts");
  const fn = service.slice(service.indexOf("export async function rematchStatementLines"), service.indexOf("// ── review"));
  assert.match(fn, /rejectedPairs\(tenantId, scoped\.map\(\(line\) => line\.id\)\)/);
  assert.match(fn, /!rejected\.has\(`\$\{line\.id\}\|\$\{hit\.policyId\}`\)/);
  assert.match(service, /async function rejectedPairs\([\s\S]*?start \+= 200[\s\S]*?\.eq\("status", "rejected"\)/);
});
