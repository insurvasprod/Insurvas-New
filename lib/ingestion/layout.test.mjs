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
  assert.deepEqual(mapProblems(policyMap, policyEntries), []);
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