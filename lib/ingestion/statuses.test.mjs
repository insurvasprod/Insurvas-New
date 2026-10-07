// LA-4.5 (Notion sprint) · the normalized status map and the unknown-status gate.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { detectHeaderRow, parseCsvGrid, rawRowsFromGrid } from "./grid.ts";
import { parseWithMap } from "./layout.ts";
import { effectiveStatus, gateStatuses, shownWord, STATUS_VOCABULARY } from "./statuses.ts";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const row = (n, status) => ({ rowNumber: n, values: { policy_number: `P${n}`, carrier_status_raw: status } });

test("exactly nine statuses, the BRD's list", () => {
  assert.deepEqual([...STATUS_VOCABULARY], ["submitted", "declined", "withdrawn", "approved_unpaid", "not_taken", "active", "at_risk", "lapsed", "paid_up"]);
});

test("a mapped status passes with both the carrier's word and ours", () => {
  const gate = gateStatuses([row(2, "INFORCE"), row(3, "Lapse-NonPay")], new Map([["INFORCE", "active"], ["Lapse-NonPay", "lapsed"]]));
  assert.deepEqual(gate.passed.map((r) => [r.values.carrier_status_raw, r.values.status_normalized]), [["INFORCE", "active"], ["Lapse-NonPay", "lapsed"]]);
  assert.equal(gate.heldRows, 0);
});

test("an unmapped status passes nothing, and is counted once per distinct word", () => {
  const gate = gateStatuses([row(2, "INFORCE"), row(3, "Pending UW"), row(4, "Pending UW"), row(5, "Reinstated")], new Map([["INFORCE", "active"]]));
  assert.deepEqual(gate.passed.map((r) => r.rowNumber), [2]);
  assert.deepEqual(gate.held, [{ raw: "Pending UW", rows: 2 }, { raw: "Reinstated", rows: 1 }]);
  assert.equal(gate.heldRows, 3);
});

test("matching is exact: a trailing space or another case is a different word, and is queued", () => {
  const map = new Map([["ACTIVE", "active"]]);
  const gate = gateStatuses([row(2, "ACTIVE"), row(3, "ACTIVE "), row(4, "Active")], map);
  assert.deepEqual(gate.passed.map((r) => r.rowNumber), [2]);
  assert.deepEqual(gate.held.map((h) => h.raw).sort(), ["ACTIVE ", "Active"]);
  assert.equal(shownWord("ACTIVE "), "“ACTIVE·”", "shown with its space visible");
});

test("the parser hands the gate the carrier's word verbatim, trailing space included", () => {
  const grid = parseCsvGrid("Policy,Status\nA1,ACTIVE \nA2,ACTIVE\n");
  const raw = { ...rawRowsFromGrid(grid, detectHeaderRow(grid)), sheetName: null };
  const map = { id: "m", version: 1, fileType: "policies", headerRowIndex: null, sheetName: null, rowCountSwingPct: 50, totalRowColumn: null, totalRowValue: null };
  const entries = [
    { sourceColumn: "Policy", targetField: "policy_number", dataType: "text", transform: "none", required: true, enumValues: null },
    { sourceColumn: "Status", targetField: "carrier_status_raw", dataType: "text", transform: "none", required: true, enumValues: null },
  ];
  const parsed = parseWithMap({ map, entries, raw, previousRowCount: null });
  assert.deepEqual(parsed.rows.map((r) => r.values.carrier_status_raw), ["ACTIVE ", "ACTIVE"]);
  assert.equal(parsed.rows[0].values.policy_number, "A1", "other text is still trimmed");
  const gate = gateStatuses(parsed.rows, new Map([["ACTIVE", "active"]]));
  assert.deepEqual(gate.held, [{ raw: "ACTIVE ", rows: 1 }]);
});

test("the explicit at_risk path and the derived one give the same value", () => {
  const mapped = gateStatuses([row(2, "Grace Period")], new Map([["Grace Period", "at_risk"]])).passed[0].values.status_normalized;
  const derived = effectiveStatus({ normalized: "active", paidToDate: "2026-08-01", today: "2026-10-07", graceDays: 31 });
  assert.equal(mapped, "at_risk");
  assert.equal(derived, "at_risk");
  assert.equal(mapped, derived, "downstream cannot tell which path produced it");
  assert.equal(effectiveStatus({ normalized: "active", paidToDate: "2026-09-20", today: "2026-10-07", graceDays: 31 }), "active", "inside the grace");
  assert.equal(effectiveStatus({ normalized: "active", paidToDate: "2026-01-01", today: "2026-10-07", graceDays: null }), "active", "no grace configured: null means null, nothing derived");
  assert.equal(effectiveStatus({ normalized: "lapsed", paidToDate: "2026-01-01", today: "2026-10-07", graceDays: 31 }), "lapsed", "only an active policy becomes at risk");
});

test("the migration: approval required to take effect, approved mappings frozen, one queue row per word, no seeds", () => {
  const sql = read("supabase/migrations/20261008130000_la_4_5_status_map.sql");
  assert.match(sql, /constraint carrier_status_map_key unique \(carrier_id, file_type, carrier_status_raw\)/);
  assert.match(sql, /constraint carrier_status_map_approved check \(\(approved_at is null\) = \(approved_by is null and approved_by_admin is null\)\)/);
  assert.match(sql, /An approved status mapping cannot change\./);
  assert.match(sql, /constraint unmapped_status_queue_key unique \(tenant_id, carrier_id, file_type, carrier_status_raw\)/);
  assert.match(sql, /This file's earlier counts are replaced, not added to\./);
  assert.match(sql, /set row_count = coalesce\(\(select sum\(o\.row_count\)/, "the queue's count is the sum of its files' counts");
  assert.match(sql, /update public\.unmapped_status_queue\s+set resolved_at = now\(\)/, "approval resolves every agency's entry for that word");
  assert.doesNotMatch(sql, /insert into public\.carrier_status_map\b/, "nothing is seeded without real sample files");
  // The gate reads approved mappings only.
  assert.match(read("lib/ingestion/parser.ts"), /from\("carrier_status_map"\)[\s\S]*?\.not\("approved_at", "is", null\)/);
});

test("the gate is wired: held rows go nowhere, are queued and told; approval reprocesses them", () => {
  const parser = read("lib/ingestion/parser.ts");
  assert.match(parser, /passed: gate\?\.available \? gate\.passed : result\.rows/, "only rows that passed go downstream");
  assert.match(parser, /rpc\("record_unmapped_statuses"/);
  assert.match(parser, /findingType: "unmapped_status",\s+severity: "blocking"/, "the parser guardian records it");
  assert.match(parser, /templateKey: "carrier_files\.unmapped_status"/, "the agency's owners and bookkeepers are told");
  assert.match(read("lib/ingestion/reprocessRuns.ts"), /typedRows: outcome\.passed/);
  const admin = read("lib/ingestion/statusAdmin.ts");
  assert.match(admin, /reprocessCarrierFiles\(file\.tenant_id, null, \{ kind: "file", fileId: file\.file_id \}, "status_map_approval"\)/, "approval reprocesses the held rows, with nothing uploaded again");
  assert.match(read("app/api/admin/status-maps/route.ts"), /carrier_status_raw: z\.string\(\)\.min\(1\)\.max\(200\),/, "the word is not trimmed on its way in");
});
