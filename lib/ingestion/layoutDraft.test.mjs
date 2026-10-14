// A layout drafted from a sample file (owner request 2026-10-14): every column listed, kept columns read into nothing.
import test from "node:test";
import assert from "node:assert/strict";

import { parseCsvGrid, rawRowsFromGrid } from "./grid.ts";
import { isKeptEntry, mapProblems, parseWithMap } from "./layout.ts";
import { draftFromGrid, draftPdfTables, keptEntry, nextKeptField } from "./layoutDraft.ts";
import { pdfGrid, pdfLayoutProblems } from "./pdfLayout.ts";

const csv = [
  "Book of business as of 10/01/2026,,,,,,,",
  "Policy Number,Status,Paid To,Modal Premium,Mode,Agent Name,Beneficiary,Rider Code",
  "AM100,Active,10/01/2026,\"$1,204.50\",Monthly,Lee,Jordan,R1",
  "AM101,Lapsed,09/01/2026,45.00,Q,Lee,,",
].join("\n");

test("every column of a sample becomes an entry, in the file's order: ours as fields, the rest kept as sent", () => {
  const draft = draftFromGrid(parseCsvGrid(csv), "policies");
  assert.equal(draft.headerRow, 2);
  assert.deepEqual(draft.columns.map((column) => [column.column, column.header, column.becomes]), [
    ["A", "Policy Number", "policy_number"],
    ["B", "Status", "carrier_status_raw"],
    ["C", "Paid To", "paid_to_date"],
    ["D", "Modal Premium", "premium_cents"],
    ["E", "Mode", "premium_mode"],
    ["F", "Agent Name", "agent_identifier"],
    ["G", "Beneficiary", null],
    ["H", "Rider Code", null],
  ]);
  assert.equal(draft.entries.length, 8);
  assert.deepEqual(draft.entries.filter(isKeptEntry).map((entry) => [entry.sourceColumn, entry.targetField, entry.dataType, entry.required]), [["Beneficiary", "kept_g", "text", false], ["Rider Code", "kept_h", "text", false]]);
  const byField = Object.fromEntries(draft.entries.map((entry) => [entry.targetField, entry]));
  assert.equal(byField.policy_number.required, true);
  assert.equal(byField.carrier_status_raw.transform, "none");
  assert.equal(byField.premium_cents.transform, "strip_currency");
  assert.equal(byField.paid_to_date.transform, "mmddyyyy", "the format most of the column's values have");
  assert.deepEqual(byField.premium_mode.enumValues, { Monthly: "monthly", Q: "quarterly" });
  assert.deepEqual(draft.missingRequired, []);
});

test("a column the draft cannot place is reported, and a field already taken keeps its first column", () => {
  const draft = draftFromGrid(parseCsvGrid("Policy,Policy No,Type,Amount\nP1,P1,Weird,1.00\n"), "commissions");
  assert.deepEqual(draft.columns.map((column) => column.becomes), ["policy_number", null, "entry_type", "amount_cents"]);
  assert.deepEqual(draft.unmatchedWords, [{ field: "entry_type", words: ["Weird"] }]);
});

test("kept entries are listed but read into nothing, and the columns they name raise no finding", () => {
  const grid = parseCsvGrid(csv);
  const draft = draftFromGrid(grid, "policies");
  const map = { id: "m", version: 1, fileType: "policies", headerRowIndex: null, sheetName: null, rowCountSwingPct: 50, totalRowColumn: null, totalRowValue: null };
  const result = parseWithMap({ map, entries: draft.entries, raw: { ...rawRowsFromGrid(grid, 2), sheetName: null }, previousRowCount: null });
  assert.equal(result.fatal, null);
  assert.equal(result.rows.length, 2);
  assert.ok(Object.keys(result.rows[0].values).every((field) => !field.startsWith("kept_")));
  assert.equal(result.rows[0].values.premium_cents, 120450);
  assert.equal(result.rows[1].values.paid_to_date, "2026-09-01");
  assert.ok(!result.findings.some((finding) => finding.findingType === "unknown_column"));
  // Dropping the kept entries brings the finding back: the columns are unknown again.
  const without = parseWithMap({ map, entries: draft.entries.filter((entry) => !isKeptEntry(entry)), raw: { ...rawRowsFromGrid(grid, 2), sheetName: null }, previousRowCount: null });
  assert.deepEqual(without.findings.find((finding) => finding.findingType === "unknown_column").payload.columns, ["Beneficiary", "Rider Code"]);
});

test("a kept entry passes the publish check, but never as required", () => {
  const entries = [
    { sourceColumn: "Policy", targetField: "policy_number", dataType: "text", transform: "none", required: true, enumValues: null },
    { sourceColumn: "Status", targetField: "carrier_status_raw", dataType: "text", transform: "none", required: true, enumValues: null },
    keptEntry("Beneficiary", "c"),
  ];
  assert.deepEqual(mapProblems({ fileType: "policies" }, entries), []);
  assert.match(mapProblems({ fileType: "policies" }, [...entries.slice(0, 2), { ...keptEntry("Beneficiary", "c"), required: true }]).join(" "), /cannot be required/);
  assert.equal(nextKeptField([{ targetField: "kept_1" }, { targetField: "kept_2" }]), "kept_3");
  assert.match(keptEntry("x", "AB").targetField, /^[a-z][a-z0-9_]{1,60}$/, "the database's target-field rule");
});

test("a PDF statement's table is found from its rows: columns where values start, named by the titles above", () => {
  const line = (pieces) => ({ pieces: pieces.map(([x, text]) => ({ x, text })), text: pieces.map(([, text]) => text).join("  ") });
  const lines = [
    line([[107, "CARRIER Commission Report as of 09/29/2026"]]),
    line([[40, "Note:"], [60, "To view your commissions history click"], [190, "here"]]),
    line([[57, "Policy Number"], [135, "Name"], [248, "Eff. Date"], [398, "Months"], [500, "Rate"], [660, "Amt"]]),
    line([[66, "AM100"], [156, "Lane"], [248, "090126"], [408, "12"], [507, "1.10"], [655, "50.04"]]),
    line([[66, "AM101"], [146, "Kent"], [248, "090126"], [408, "9"], [502, "11.20"], [651, "191.13"]]),
    line([[130, "MML75R"], [255, "Alex Cole"], [655, "241.17"]]),
    line([[66, "AM102"], [152, "Cole"], [248, "090126"], [408, "12"], [507, "1.20"], [655, "95.35"]]),
    line([[651, "336.52"], [691, "**"]]),
  ];
  const [table] = draftPdfTables(lines);
  assert.deepEqual(pdfLayoutProblems(table.layout), []);
  assert.deepEqual(table.layout.columns.map((column) => column.name), ["Policy Number", "Name", "Eff. Date", "Months", "Rate", "Amt"]);
  assert.equal(table.layout.rowStart.column, "Policy Number");
  const grid = pdfGrid(lines, table.layout);
  assert.deepEqual(grid.slice(1).map((row) => [row[0], row[1], row[5]]), [["AM100", "Lane", "50.04"], ["AM101", "Kent", "191.13"], ["AM102", "Cole", "95.35"]]);
  assert.equal(table.rows, 3, "the second line under a row and the total line are not rows");
});
