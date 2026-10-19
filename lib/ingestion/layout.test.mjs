// LA-4.3 (Notion sprint) · the parser framework and versioned layout maps.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { detectHeaderRow, parseCsvGrid, rawRowsFromGrid } from "./grid.ts";
import { chooseLayoutMap, convertCell, guessTargetField, mapProblems, parseWithMap, TARGET_FIELDS } from "./layout.ts";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

const policyMap = { id: "m1", version: 1, fileType: "policies", headerRowIndex: null, sheetName: null, rowCountSwingPct: 50, totalRowColumn: null, totalRowValue: null };
const policyEntries = [
  { sourceColumn: "Policy #", targetField: "policy_number", dataType: "text", transform: "none", required: true, enumValues: null },
  { sourceColumn: "Status", targetField: "carrier_status_raw", dataType: "text", transform: "none", required: true, enumValues: null },
  { sourceColumn: "Paid To", targetField: "paid_to_date", dataType: "date", transform: "mmddyyyy", required: false, enumValues: null },
  { sourceColumn: "Premium", targetField: "premium_cents", dataType: "int_cents", transform: "strip_currency", required: false, enumValues: null },
  { sourceColumn: "Mode", targetField: "premium_mode", dataType: "enum", transform: "none", required: false, enumValues: { M: "monthly", Q: "quarterly" } },
];
const rawOf = (csv, header) => {
  const grid = parseCsvGrid(csv);
  return { ...rawRowsFromGrid(grid, header ?? detectHeaderRow(grid)), sheetName: null };
};

test("cells are read through declared types and named transforms only, money in integer cents", () => {
  const e = (dataType, transform = "none", extra = {}) => ({ dataType, transform, required: false, enumValues: null, ...extra });
  assert.deepEqual(convertCell("$1,204.50", e("int_cents", "strip_currency")), { ok: true, value: 120450 });
  assert.deepEqual(convertCell("(12.00)", e("int_cents", "strip_currency")), { ok: true, value: -1200 });
  assert.deepEqual(convertCell("12.5", e("int_cents")), { ok: true, value: 1250 });
  assert.equal(convertCell("$12", e("int_cents")).ok, false, "a currency sign needs strip_currency: no silent coercion");
  assert.equal(convertCell("12.345", e("int_cents", "strip_currency")).ok, false, "no rounding of a third decimal");
  assert.deepEqual(convertCell("420.00", e("int_cents", "negate")), { ok: true, value: -42000 });
  assert.deepEqual(convertCell("110%", e("basis_points", "pct_to_bp")), { ok: true, value: 11000 });
  assert.deepEqual(convertCell("87.5", e("basis_points", "pct_to_bp")), { ok: true, value: 8750 });
  assert.deepEqual(convertCell("10/05/2026", e("date", "mmddyyyy")), { ok: true, value: "2026-10-05" });
  assert.deepEqual(convertCell("20261005", e("date", "yyyymmdd")), { ok: true, value: "2026-10-05" });
  assert.equal(convertCell("02/30/2026", e("date", "mmddyyyy")).ok, false);
  assert.deepEqual(convertCell("(555) 010-2030", e("text", "digits_only")), { ok: true, value: "5550102030" });
  assert.deepEqual(convertCell(" M ", e("enum", "none", { enumValues: { M: "monthly" } })), { ok: true, value: "monthly" });
  assert.equal(convertCell("X", e("enum", "none", { enumValues: { M: "monthly" } })).ok, false);
  assert.deepEqual(convertCell("", e("int_cents")), { ok: true, value: null });
  assert.equal(convertCell("", { ...e("text"), required: true }).ok, false);
  const values = [convertCell("0.10", e("int_cents")).value, convertCell("0.20", e("int_cents")).value];
  assert.equal(values[0] + values[1], 30, "0.10 + 0.20 is exactly 30 cents");
});

test("a map is data: it is checked before publishing, and needs no code", () => {
  // AG-1.4 amends LA-4.3: the writing number is a mapped field on every carrier profile.
  const writer = { sourceColumn: "Writing Agent", targetField: "agent_identifier", dataType: "text", transform: "none", required: false, enumValues: null };
  assert.deepEqual(mapProblems(policyMap, [...policyEntries, writer]), []);
  assert.match(mapProblems(policyMap, policyEntries).join(" "), /must read "Writing agent/);
  assert.match(mapProblems(policyMap, [policyEntries[0]]).join(" "), /must read "Status/);
  assert.match(mapProblems(policyMap, [...policyEntries, { ...policyEntries[3], targetField: "amount_cents" }]).join(" "), /"amount_cents" is not a field of a policies file/);
  assert.match(mapProblems(policyMap, [...policyEntries.slice(0, 2), { ...policyEntries[2], transform: "strip_currency" }]).join(" "), /does not apply to date/);
  assert.match(mapProblems(policyMap, [...policyEntries.slice(0, 2), { ...policyEntries[4], enumValues: { M: "weekly" } }]).join(" "), /"weekly" is not one of/);
  const layout = read("lib/ingestion/layout.ts");
  assert.doesNotMatch(layout, /^import .* from "(?!\.\/)/m, "only relative imports: no provider, no database");
  assert.doesNotMatch(layout, /fetch\(|openai|openrouter|fireworks|moonshot|anthropic/i, "no AI provider call happens during a parse");
  assert.ok(TARGET_FIELDS.commissions.find((field) => field.key === "entry_type").enumValues.length === 8, "all eight ledger entry types");
});

test("a policy file is read into typed rows; blank lines skipped, the carrier's status kept verbatim", () => {
  const raw = rawOf('Policy #,Status,Paid To,Premium,Mode\nA1,ACTIVE ,10/01/2026,"$42.10",M\n\nA2,Lapse-NonPay,09/01/2026,$35.00,Q\n');
  const parsed = parseWithMap({ map: policyMap, entries: policyEntries, raw, previousRowCount: null });
  assert.equal(parsed.fatal, null);
  assert.deepEqual(parsed.rows.map((row) => row.values), [
    // Verbatim, trailing space included: LA-4.5 matches the carrier's word exactly.
    { policy_number: "A1", carrier_status_raw: "ACTIVE ", paid_to_date: "2026-10-01", premium_cents: 4210, premium_mode: "monthly" },
    { policy_number: "A2", carrier_status_raw: "Lapse-NonPay", paid_to_date: "2026-09-01", premium_cents: 3500, premium_mode: "quarterly" },
  ]);
  assert.deepEqual(parsed.rows.map((row) => row.rowNumber), [2, 4], "rows keep their line in the source");
  assert.deepEqual(parsed.findings, []);
});

test("an unknown extra column parses successfully and raises a guardian finding", () => {
  const raw = rawOf("Policy #,Status,Reinstatement Date\nA1,ACTIVE,2026-11-01\n");
  const parsed = parseWithMap({ map: policyMap, entries: policyEntries, raw, previousRowCount: null });
  assert.equal(parsed.fatal, null);
  assert.equal(parsed.rows.length, 1);
  const finding = parsed.findings.find((f) => f.findingType === "unknown_column");
  assert.equal(finding.severity, "warning");
  assert.deepEqual(finding.payload.columns, ["Reinstatement Date"]);
});

test("a file missing a required column fails and yields nothing for Layer 2", () => {
  const raw = rawOf("Policy Number,Status\nA1,ACTIVE\n");
  const parsed = parseWithMap({ map: policyMap, entries: policyEntries, raw, previousRowCount: null });
  assert.match(parsed.fatal, /Required column "Policy #" is missing/);
  assert.deepEqual(parsed.rows, []);
  assert.equal(parsed.findings.find((f) => f.findingType === "required_column_missing").severity, "blocking");
});

test("a row-count swing past the threshold raises a finding without blocking the parse", () => {
  const raw = rawOf("Policy #,Status\nA1,ACTIVE\nA2,ACTIVE\nA3,ACTIVE\n");
  const swung = parseWithMap({ map: policyMap, entries: policyEntries, raw, previousRowCount: 10 });
  assert.equal(swung.fatal, null);
  assert.equal(swung.rows.length, 3);
  assert.match(swung.findings.find((f) => f.findingType === "row_count_swing").reasoning, /3 rows, against 10.*70% change/);
  assert.equal(parseWithMap({ map: policyMap, entries: policyEntries, raw, previousRowCount: 4 }).findings.length, 0, "25% is inside 50%");
});

test("an unreadable value holds that row back, says so, and lets the rest through", () => {
  const raw = rawOf("Policy #,Status,Paid To\nA1,ACTIVE,13/45/2026\nA2,ACTIVE,10/01/2026\n");
  const parsed = parseWithMap({ map: policyMap, entries: policyEntries, raw, previousRowCount: null });
  assert.equal(parsed.fatal, null);
  assert.deepEqual(parsed.rows.map((row) => row.values.policy_number), ["A2"]);
  assert.deepEqual(parsed.heldBack, [{ rowNumber: 2, field: "paid_to_date", reason: '"13/45/2026" is not a date this map reads' }]);
});

test("the map's header row wins over the raw layer's guess, re-read from the kept grid", () => {
  // Line 1 is as wide as the real header, so the raw layer guessed it; the map says line 2.
  const csv = "Report,Agent 4471\nPolicy #,Status\nA1,ACTIVE\n";
  const raw = rawOf(csv);
  assert.equal(raw.headerRow, 1);
  const parsed = parseWithMap({ map: { ...policyMap, headerRowIndex: 2 }, entries: policyEntries, raw, previousRowCount: null });
  assert.equal(parsed.fatal, null);
  assert.deepEqual(parsed.rows.map((row) => row.values.policy_number), ["A1"]);
  assert.equal(parsed.findings[0].findingType, "header_row_moved");
});

test("commission totals: a stated total that does not add up fails the file, with the arithmetic", () => {
  const map = { ...policyMap, id: "c1", fileType: "commissions", totalRowColumn: "Policy", totalRowValue: "TOTAL" };
  const entries = [
    { sourceColumn: "Policy", targetField: "policy_number", dataType: "text", transform: "none", required: true, enumValues: null },
    { sourceColumn: "Amount", targetField: "amount_cents", dataType: "int_cents", transform: "strip_currency", required: true, enumValues: null },
    { sourceColumn: "Type", targetField: "entry_type", dataType: "enum", transform: "none", required: false, enumValues: { ADV: "advance", CB: "chargeback" } },
  ];
  const good = parseWithMap({ map, entries, raw: rawOf("Policy,Amount,Type\nA1,540.00,ADV\nA2,-420.00,CB\nTOTAL,120.00,\n"), previousRowCount: null });
  assert.equal(good.fatal, null);
  assert.equal(good.rows.length, 2, "the total row is not a line");
  assert.deepEqual([good.statedTotalCents, good.linesTotalCents], [12000, 12000]);
  const bad = parseWithMap({ map, entries, raw: rawOf("Policy,Amount,Type\nA1,540.00,ADV\nA2,-420.00,CB\nTOTAL,130.00,\n"), previousRowCount: null });
  assert.match(bad.fatal, /lines sum to \$120\.00, the file states \$130\.00, a difference of -\$10\.00/);
  assert.deepEqual(bad.rows, [], "nothing is written further");
  assert.deepEqual(bad.findings.find((f) => f.findingType === "totals_mismatch").payload, { linesTotalCents: 12000, statedTotalCents: 13000, differenceCents: -1000 });
});

test("a newer map version picks up a column the old one ignored, from the same raw rows", () => {
  const raw = rawOf("Policy #,Status,Face\nA1,ACTIVE,10000.00\n");
  const v1 = parseWithMap({ map: policyMap, entries: policyEntries, raw, previousRowCount: null });
  const v2 = parseWithMap({ map: { ...policyMap, version: 2 }, entries: [...policyEntries, { sourceColumn: "Face", targetField: "face_amount_cents", dataType: "int_cents", transform: "none", required: false, enumValues: null }], raw, previousRowCount: null });
  assert.equal(v1.rows[0].values.face_amount_cents, undefined);
  assert.equal(v2.rows[0].values.face_amount_cents, 1000000);
});

test("one layout serves several carriers; a new carrier with a known layout is one assignment, no code", () => {
  const maps = [
    { id: "aaa-v2", tenantId: null, layoutKey: "aetna_aflac_ahl_policies", fileType: "policies", status: "published" },
    { id: "aaa-v1", tenantId: null, layoutKey: "aetna_aflac_ahl_policies", fileType: "policies", status: "retired" },
  ];
  const assignments = ["aetna", "aflac", "ahl"].map((carrierId) => ({ tenantId: null, carrierId, fileType: "policies", layoutKey: "aetna_aflac_ahl_policies" }));
  for (const carrierId of ["aetna", "aflac", "ahl"]) assert.equal(chooseLayoutMap({ tenantId: "t1", carrierId, fileType: "policies", assignments, maps })?.id, "aaa-v2", `${carrierId} reads the one shared layout`);
  // A test carrier added with nothing but one assignment row.
  const added = [...assignments, { tenantId: null, carrierId: "test_carrier", fileType: "policies", layoutKey: "aetna_aflac_ahl_policies" }];
  assert.equal(chooseLayoutMap({ tenantId: "t1", carrierId: "test_carrier", fileType: "policies", assignments: added, maps })?.id, "aaa-v2");
  assert.equal(chooseLayoutMap({ tenantId: "t1", carrierId: "aetna", fileType: "commissions", assignments, maps }), null, "no layout map for this carrier and file type");
});

test("an agency's override resolves ahead of the platform default", () => {
  const maps = [
    { id: "platform", tenantId: null, layoutKey: "moo_policies", fileType: "policies", status: "published" },
    { id: "theirs", tenantId: "t1", layoutKey: "moo_policies", fileType: "policies", status: "published" },
    { id: "own-layout", tenantId: "t1", layoutKey: "t1_moo_custom", fileType: "policies", status: "published" },
  ];
  const platformOnly = [{ tenantId: null, carrierId: "moo", fileType: "policies", layoutKey: "moo_policies" }];
  assert.equal(chooseLayoutMap({ tenantId: "t1", carrierId: "moo", fileType: "policies", assignments: platformOnly, maps })?.id, "theirs", "their own version of the platform's layout");
  assert.equal(chooseLayoutMap({ tenantId: "t2", carrierId: "moo", fileType: "policies", assignments: platformOnly, maps })?.id, "platform", "another agency still gets the platform's");
  const ownAssignment = [...platformOnly, { tenantId: "t1", carrierId: "moo", fileType: "policies", layoutKey: "t1_moo_custom" }];
  assert.equal(chooseLayoutMap({ tenantId: "t1", carrierId: "moo", fileType: "policies", assignments: ownAssignment, maps })?.id, "own-layout", "their own assignment first");
});

test("the migration: versions frozen once published, shared layouts by assignment, findings kept", () => {
  const sql = read("supabase/migrations/20261008120000_la_4_3_layout_maps.sql");
  assert.match(sql, /A published layout map cannot be edited; start version % instead\./);
  assert.match(sql, /A published layout map''s columns cannot change; start a new version\./);
  assert.match(sql, /A layout map is published from a draft, never inserted published\./);
  assert.match(sql, /carrier_layout_map_one_published[\s\S]*?where status = 'published'/);
  assert.match(sql, /create table if not exists public\.carrier_layout_assignment/, "a carrier references a layout; it does not own one");
  assert.match(sql, /update public\.carrier_layout_map set status = 'retired'/, "publishing retires the version before");
  assert.match(sql, /foreign key \(parser_id\) references public\.carrier_layout_map\(id\)/);
  assert.match(sql, /revoke delete, truncate on public\.agent_findings/);
  assert.doesNotMatch(sql, /insert into public\.carrier_layout_map\b/, "nothing is seeded without real sample files");
});

test("a header suggests its field only on an exact word, and every suggestion is a real field", () => {
  assert.equal(guessTargetField("policies", "Paid To"), "paid_to_date");
  assert.equal(guessTargetField("policies", "PAIDTODATE"), "paid_to_date");
  assert.equal(guessTargetField("policies", "Writing Agent"), "agent_identifier");
  assert.equal(guessTargetField("policies", "First Name"), "insured_first_name");
  assert.equal(guessTargetField("policies", "Test"), null);
  assert.equal(guessTargetField("policies", "Paid To Date Override"), null);
  assert.equal(guessTargetField("commissions", "Comm Type"), "entry_type");
  for (const type of ["policies", "commissions"]) {
    const keys = new Set(TARGET_FIELDS[type].map((field) => field.key));
    for (const header of ["Policy", "Status", "Premium", "Agent", "Amount", "Date", "Statement Date"]) {
      const field = guessTargetField(type, header);
      if (field) assert.ok(keys.has(field), `${type}: ${header} → ${field}`);
    }
  }
});

// Owner request 2026-10-13: a carrier file we edit ourselves (opened in Excel and saved, a row added)
// must still read. Measured on every bucket sample with real Excel saves; these pin what it changed.
test("an Excel-saved date reads, whatever the column's format", async () => {
  const { excelSavedDate } = await import("./layout.ts");
  const date = { dataType: "date", transform: "none", enumValues: null, required: false };
  // Excel 2003 XML (SSL's .xls) re-saved: the date cell lost its format and holds the serial.
  assert.deepEqual(convertCell("46202", date), { ok: true, value: "2026-06-29" });
  assert.deepEqual(convertCell("46202", { ...date, transform: "mmddyyyy" }), { ok: true, value: "2026-06-29" });
  // A CSV re-saved by Excel writes US dates over ISO ones.
  assert.deepEqual(convertCell("7/8/2026", date), { ok: true, value: "2026-07-08" });
  assert.deepEqual(convertCell("7/8/2026", { ...date, transform: "yyyymmdd" }), { ok: true, value: "2026-07-08" });
  // The map's own format still comes first, and six- or eight-digit dates are never serials.
  assert.deepEqual(convertCell("070826", { ...date, transform: "mmddyy" }), { ok: true, value: "2026-07-08" });
  assert.deepEqual(convertCell("20260708", { ...date, transform: "yyyymmdd" }), { ok: true, value: "2026-07-08" });
  assert.equal(excelSavedDate("12345"), null, "a serial before 1950 is not a date");
  assert.equal(excelSavedDate("99999"), null, "a serial after 2100 is not a date");
  assert.equal(convertCell("13/45/2026", date).ok, false);
});

test("Excel's binary noise in an amount is the cent it meant; a real third decimal is still refused", () => {
  const money = { dataType: "int_cents", transform: "none", enumValues: null, required: false };
  assert.deepEqual(convertCell("276.72000000000003", money), { ok: true, value: 27672 });
  assert.deepEqual(convertCell("1083.5999999999999", money), { ok: true, value: 108360 });
  assert.deepEqual(convertCell("-1194.3599999999999", money), { ok: true, value: -119436 });
  assert.equal(convertCell("12.345", money).ok, false);
  assert.equal(convertCell("12.3450000001", money).ok, false, "ten decimals that are not a whole cent");
});

test("a ZIP that Excel stored as a number gets its leading zero back", async () => {
  const { restoreZip } = await import("./layout.ts");
  assert.equal(restoreZip("8270"), "08270");
  assert.equal(restoreZip("501"), "00501");
  assert.equal(restoreZip("8270-1234"), "08270-1234");
  assert.equal(restoreZip("89230"), "89230");
  assert.equal(restoreZip("K1A 0B1"), "K1A 0B1");
  assert.equal(restoreZip(null), null);
  const raw = rawRowsFromGrid(parseCsvGrid("Policy,ZIP\nP1,8270\n"), 1);
  const map = { ...policyMap, id: "zip" };
  const result = parseWithMap({ map, entries: [{ sourceColumn: "Policy", targetField: "policy_number", dataType: "text", transform: "none", required: true, enumValues: null }, { sourceColumn: "ZIP", targetField: "insured_zip", dataType: "text", transform: "none", required: false, enumValues: null }], raw, previousRowCount: null });
  assert.equal(result.rows[0].values.insured_zip, "08270");
});

// Owner request 2026-10-13: the real (edited) carrier reports must read. Three reader changes they needed.
test("a header is found with the spaces around it ignored, exact text first", () => {
  const raw = rawRowsFromGrid(parseCsvGrid('Policy Number,Date of Issue  ,Status\nP1,01/02/2026,Active\n'), 1);
  const entries = [
    { sourceColumn: "Policy Number", targetField: "policy_number", dataType: "text", transform: "none", required: true, enumValues: null },
    { sourceColumn: "Status", targetField: "carrier_status_raw", dataType: "text", transform: "none", required: true, enumValues: null },
    { sourceColumn: "Date of Issue ", targetField: "issue_date", dataType: "date", transform: "mmddyyyy", required: false, enumValues: null },
  ];
  const result = parseWithMap({ map: { ...policyMap, id: "trim" }, entries, raw, previousRowCount: null });
  assert.equal(result.fatal, null);
  assert.equal(result.rows[0].values.issue_date, "2026-01-02", "one trailing space in the map, two in the file");
  assert.ok(!result.findings.some((finding) => finding.findingType === "unknown_column"), "the column is not reported as unread");
});

test("a premium or face amount past the cent is rounded; commission money still is not", async () => {
  const { roundToCent } = await import("./layout.ts");
  assert.equal(roundToCent("41.92302"), "41.92");
  assert.equal(roundToCent("104.86620"), "104.87");
  assert.equal(roundToCent("$1,234.5678"), "$1234.57", "the comma goes; the amount reader strips it anyway");
  assert.equal(roundToCent("(12.3456)"), "(12.35)");
  assert.equal(roundToCent("12.34"), "12.34", "already cents: untouched");
  // Half up on the digits, not through a float (1.005 is 1.00499999… as a double, 2.675 is 2.67499…).
  assert.equal(roundToCent("1.005"), "1.01");
  assert.equal(roundToCent("2.675"), "2.68");
  assert.equal(roundToCent("1.0049"), "1.00");
  assert.equal(roundToCent("0.995"), "1.00");
  assert.equal(roundToCent("999999.995"), "1000000.00");
  assert.equal(roundToCent("-8.125"), "-8.13", "the sign is kept; the amount rounds away from zero");
  assert.equal(convertCell("1.00999999999", { dataType: "int_cents", transform: "none", enumValues: null, required: false }).value, 101, "noise just under a cent, from the digits");
  const raw = rawRowsFromGrid(parseCsvGrid("Policy,Status,Premium\nP1,Active,41.92302\n"), 1);
  const entries = [
    { sourceColumn: "Policy", targetField: "policy_number", dataType: "text", transform: "none", required: true, enumValues: null },
    { sourceColumn: "Status", targetField: "carrier_status_raw", dataType: "text", transform: "none", required: true, enumValues: null },
    { sourceColumn: "Premium", targetField: "premium_cents", dataType: "int_cents", transform: "strip_currency", required: false, enumValues: null },
  ];
  assert.equal(parseWithMap({ map: { ...policyMap, id: "round" }, entries, raw, previousRowCount: null }).rows[0].values.premium_cents, 4192);
  assert.equal(convertCell("41.92302", { dataType: "int_cents", transform: "strip_currency", enumValues: null, required: true }).ok, false, "a commission amount with a third decimal is still refused");
});

test("a PDF statement with two tables: each read with its own columns, labelled by its section", async () => {
  const { pdfGrid, pdfLayoutProblems } = await import("./pdfLayout.ts");
  const piece = (x, text) => ({ x, text });
  const line = (...pieces) => ({ pieces, text: pieces.map((p) => p.text).join(" ") });
  const annualization = [{ name: "CO", x: 25 }, { name: "POLICY", x: 55 }, { name: "COMM TYPE", x: 265 }, { name: "ACTIVITY", x: 655 }];
  const override = [{ name: "CO", x: 25 }, { name: "POLICY", x: 55 }, { name: "PRODUCT", x: 110 }, { name: "ACTIVITY", x: 655 }];
  const layout = {
    columns: annualization, rowStart: { column: "CO", pattern: "^[A-Z]{3}$" }, start: "TRANSACTION DETAIL", stop: ["AD-ADVANCE"],
    sections: { column: "SECTION", parts: [{ start: "ANNUALIZATION", label: "ANNUALIZATION", columns: annualization }, { start: "OVERRIDE", label: "OVERRIDE", columns: override }] },
  };
  assert.deepEqual(pdfLayoutProblems(layout), []);
  const lines = [
    line(piece(29, "OVERRIDE"), piece(126, "($9.99)")), // the summary's OVERRIDE line, before the detail: not a row
    line(piece(29, "TRANSACTION"), piece(80, "DETAIL")),
    line(piece(29, "ANNUALIZATION")),
    line(piece(29, "AGL"), piece(59, "1000000001"), piece(273, "GENERICATTAD"), piece(663, "($418.76)")),
    line(piece(29, "SUB"), piece(46, "TOTAL"), piece(663, "($418.76)")),
    line(piece(29, "OVERRIDE")),
    line(piece(29, "AGL"), piece(59, "1000000002"), piece(117, "SAMPLE PRODUCT"), piece(663, "($119.65)")),
    line(piece(29, "AD-ADVANCE,"), piece(80, "AE-RECOVERED")),
  ];
  assert.deepEqual(pdfGrid(lines, layout), [
    ["CO", "POLICY", "COMM TYPE", "ACTIVITY", "PRODUCT", "SECTION"],
    ["AGL", "1000000001", "GENERICATTAD", "($418.76)", "", "ANNUALIZATION"],
    ["AGL", "1000000002", "", "($119.65)", "SAMPLE PRODUCT", "OVERRIDE"],
  ]);
  assert.match(pdfLayoutProblems({ ...layout, sections: { column: "SECTION", parts: [{ start: "X", label: "X", columns: [{ name: "A", x: 1 }, { name: "B", x: 2 }] }] } }).join(" "), /row-start column "CO"/);
});
