// The bucket door, round 2 (2026-10-09): Drive-layout paths, Excel 2003 XML, the right sheet of a
// workbook, the values carrier files write (="...", 8/6/26, 13,235.56-, 0.825, fixed values), and
// one day of the bucket as expected / received / missing / unexpected.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bucketDay, weekdayOf } from "./bucket.ts";
import { carrierFileBytesMatch, carrierFileKind, isBinaryXls, isPolicyFeed } from "./constants.ts";
import { chooseSheet, parseCsvGrid } from "./grid.ts";
import { convertCell, parseWithMap, unwrapExcelText } from "./layout.ts";
import { fileTypeFromSegment, folderKey, parseDropPath, usDate } from "./path.ts";
import { readSpreadsheetMl } from "./spreadsheetMl.ts";

const T = "e27085a6-ec04-4cbd-a36c-112080e9b6df";
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("a Drive-layout path: MM-DD-YYYY, the agency, the carrier folder as written, the type", () => {
  const parsed = parseDropPath(`${T}/09-01-2026/Sample Agency/Mutual of Omaha/Policies/7376635-86416.csv`);
  assert.deepEqual(parsed.problems, []);
  assert.deepEqual(parsed.attribution, { fileDate: "2026-09-01", agency: "Sample Agency", carrierCode: null, fileType: "policies", carrierFolder: "Mutual of Omaha" });
  assert.equal(parsed.filename, "7376635-86416.csv");
  assert.equal(parseDropPath(`${T}/09-01-2026/Sample Agency/Corebridge/New Business/PolicySummary.xlsx`).attribution.fileType, "new_business");
  assert.match(parseDropPath(`${T}/02-30-2026/A/AMAM/Policies/x.csv`).problems.join(" "), /not a real date/);
  assert.match(parseDropPath(`${T}/09-01-2026/A/AMAM/x.csv`).problems.join(" "), /expected folders/);
  // The old layout still reads.
  assert.equal(parseDropPath(`${T}/inbox/2026-10-05/heritage/americo/Commissions/s.pdf`).attribution.carrierCode, "americo");
  assert.equal(usDate("09-01-2026"), "2026-09-01");
  assert.equal(fileTypeFromSegment("New_Business"), "new_business");
  assert.equal(folderKey("  Mutual   of Omaha "), "mutual of omaha");
  assert.ok(isPolicyFeed("new_business") && isPolicyFeed("policies") && !isPolicyFeed("commissions"));
});

test("the bucket lists both layouts, and a removed file comes back with the data it had", () => {
  const sql = read("supabase/migrations/20261009100000_la_4_bucket_door.sql");
  assert.match(sql, /\/\(inbox\/\|\[0-9\]\{2\}-\[0-9\]\{2\}-\[0-9\]\{4\}\/\)/);
  assert.match(sql, /v_existing\.removed_from_bucket_at is not null then\s+update public\.file_registry\s+set storage_path = p_storage_path, removed_from_bucket_at = null, restored_at = now\(\)/);
  assert.match(sql, /coalesce\(path_agency, ''\) = coalesce\(p_path_agency, ''\)/, "two agencies' files of one day never replace each other");
  assert.match(sql, /revoke update, delete, truncate on public\.carrier_bucket_check from service_role, tenant_app;/, "a check is a record");
  assert.match(read("lib/ingestion/pipeline.ts"), /outcome\.outcome === "restored"/);
});

test("Excel 2003 XML: cells placed by ss:Index, dates as dates, entities decoded", () => {
  const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="PolicyList"><Table>
    <Row><Cell><Data ss:Type="String">Policy Number</Data></Cell><Cell><Data ss:Type="String">Client &amp; Co</Data></Cell><Cell><Data ss:Type="String">Issue Date</Data></Cell><Cell><Data ss:Type="String">Status</Data></Cell></Row>
    <Row><Cell><Data ss:Type="String">0973996</Data></Cell><Cell ss:Index="3"><Data ss:Type="DateTime">2026-06-29T00:00:00.000</Data></Cell><Cell><Data ss:Type="String">Lapsed</Data></Cell></Row>
  </Table></Worksheet></Workbook>`;
  const [sheet] = readSpreadsheetMl(xml);
  assert.equal(sheet.name, "PolicyList");
  assert.deepEqual(sheet.rows, [["Policy Number", "Client & Co", "Issue Date", "Status"], ["0973996", "", "2026-06-29", "Lapsed"]]);
  const head = new TextEncoder().encode(xml.slice(0, 400));
  assert.equal(carrierFileKind({ name: "PolicyList.xls" }), "xls");
  assert.ok(carrierFileBytesMatch("xls", head));
  assert.ok(!carrierFileBytesMatch("xls", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])));
  assert.ok(isBinaryXls(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])));
  assert.throws(() => readSpreadsheetMl("<html></html>"), /Not an Excel 2003 XML workbook/);
});

test("a workbook's rows come from the layout's sheet, else the sheet with the widest header", () => {
  const summary = { name: "Commission Summary", grid: [["Commission Summary"], ["", "", "Agent Number", "", "GNW1"], ["", "", "", "", "", "ACC", "$1,444.88"]] };
  const details = { name: "Commission Details", grid: [["", "", "", "Commission Details"], ["COMPANY", "COMMISSIONTYPE", "POLICYNUMBER", "COMMISSIONAMOUNT"], ["ACC", "Advance", "ACC1", "$1,146.10"]] };
  assert.equal(chooseSheet([summary, details], null)?.name, "Commission Details");
  assert.equal(chooseSheet([summary, details], "commission summary")?.name, "Commission Summary");
  assert.equal(chooseSheet([{ ...details, hidden: true }, summary], null)?.name, "Commission Summary");
});

test("the values carrier files write: =\"...\", two-digit years, a trailing minus, a fraction rate", () => {
  // A CSV keeps ="0119859720" as =0119859720, and =("0000708844") as =(0000708844).
  const [header, row] = parseCsvGrid('Policy,Agent\n="0119859720",=("0000708844")\n');
  assert.deepEqual(header, ["Policy", "Agent"]);
  assert.deepEqual(row.map(unwrapExcelText), ["0119859720", "0000708844"]);
  assert.equal(unwrapExcelText("=SUM(A1:A2)"), "=SUM(A1:A2)", "a real formula is left alone");
  const text = { dataType: "text", transform: "none", enumValues: null, required: true };
  assert.deepEqual(convertCell("=0119859720", text), { ok: true, value: "0119859720" });
  const mmddyy = { dataType: "date", transform: "mmddyy", enumValues: null, required: false };
  assert.deepEqual(convertCell("8/6/26", mmddyy), { ok: true, value: "2026-08-06" });
  assert.deepEqual(convertCell("061426", mmddyy), { ok: true, value: "2026-06-14" });
  assert.deepEqual(convertCell("09/01/2026", mmddyy), { ok: true, value: "2026-09-01" });
  const money = { dataType: "int_cents", transform: "strip_currency", enumValues: null, required: false };
  assert.deepEqual(convertCell("13,235.56-", money), { ok: true, value: -1323556 });
  assert.deepEqual(convertCell("      $52.06", money), { ok: true, value: 5206 });
  assert.deepEqual(convertCell("-$79.48", money), { ok: true, value: -7948 });
  const fraction = { dataType: "basis_points", transform: "fraction_to_bp", enumValues: null, required: false };
  assert.deepEqual(convertCell("0.825", fraction), { ok: true, value: 8250 });
  assert.deepEqual(convertCell(".75000", fraction), { ok: true, value: 7500 });
  assert.equal(convertCell("0.12345", fraction).ok, false, "finer than a basis point is not a rate");
});

test("a fixed value (=annual) fills a field the carrier's file never states", () => {
  const raw = { headerRow: 1, columns: [{ column: "A", header: "Policy #", key: "Policy #" }, { column: "B", header: "Policy Status", key: "Policy Status" }, { column: "C", header: "Annualized Premium", key: "Annualized Premium" }], preamble: [], rows: [{ rowNumber: 2, payload: { "Policy #": "AM09018336", "Policy Status": "Incomplete", "Annualized Premium": "$900.96" } }], sheetName: "Sheet1" };
  const map = { id: "m", version: 1, fileType: "policies", headerRowIndex: null, sheetName: null, rowCountSwingPct: 50, totalRowColumn: null, totalRowValue: null };
  const entries = [
    { sourceColumn: "Policy #", targetField: "policy_number", dataType: "text", transform: "none", required: true, enumValues: null },
    { sourceColumn: "Policy Status", targetField: "carrier_status_raw", dataType: "text", transform: "none", required: true, enumValues: null },
    { sourceColumn: "Annualized Premium", targetField: "premium_cents", dataType: "int_cents", transform: "strip_currency", required: false, enumValues: null },
    { sourceColumn: "=annual", targetField: "premium_mode", dataType: "enum", transform: "none", required: false, enumValues: { annual: "annual" } },
  ];
  const result = parseWithMap({ map, entries, raw, previousRowCount: null });
  assert.equal(result.fatal, null);
  assert.deepEqual(result.rows[0].values, { policy_number: "AM09018336", carrier_status_raw: "Incomplete", premium_cents: 90096, premium_mode: "annual" });
});

test("one day of the bucket: expected, received, missing, unexpected; a removed file is missing", () => {
  const exp = (id, agency, carrierId, fileType, weekdays = [1, 2, 3, 4, 5]) => ({ id, agency, carrierId, carrierName: carrierId.toUpperCase(), fileType, weekdays, active: true });
  const file = (id, agency, carrierId, fileType, over = {}) => ({ id, agency, carrierId, carrierName: carrierId.toUpperCase(), fileType, fileDate: "2026-09-01", filename: `${id}.csv`, bytes: 10, receivedAt: "2026-09-01T14:00:00Z", status: "parsed", problem: null, removedAt: null, restoredAt: null, replaced: false, rows: 3, path: `${T}/09-01-2026/${agency}/${carrierId}/x/${id}.csv`, ...over });
  assert.equal(weekdayOf("2026-09-01"), 2, "a Tuesday");
  const day = bucketDay({
    date: "2026-09-01",
    timezone: "America/New_York",
    expectations: [exp("1", "Heritage", "aetna", "policies"), exp("2", "Heritage", "aetna", "commissions"), exp("3", "Heritage", "amam", "policies"), exp("4", "Heritage", "ssl", "policies", [6]), { ...exp("5", "Heritage", "moo", "policies"), active: false }],
    files: [
      file("a", " heritage ", "aetna", "policies"),
      file("a0", "Heritage", "aetna", "policies", { replaced: true }),
      file("b", "Heritage", "aetna", "commissions", { status: "failed", problem: "No header row" }),
      file("c", "Heritage", "amam", "policies", { removedAt: "2026-09-01T15:00:00Z" }),
      file("d", "Other Agency", "aetna", "policies"),
    ],
  });
  assert.deepEqual(day.counts, { expected: 3, received: 2, missing: 1, unexpected: 1 });
  assert.deepEqual(day.rows.map((row) => [row.agency, row.carrierId, row.fileType, row.state, row.file?.id ?? null, row.replaced]), [
    ["Heritage", "aetna", "commissions", "failed", "b", 0],
    ["Heritage", "aetna", "policies", "received", "a", 1],
    ["Heritage", "amam", "policies", "removed", "c", 0],
    ["Other Agency", "aetna", "policies", "unexpected", "d", 0],
  ]);
});
