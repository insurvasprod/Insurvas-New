// LA-4.2 (Notion sprint) · the raw layer: immutable rows and reprocessing.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { columnLetter, detectHeaderRow, gridFromRaw, parseCsvGrid, rawRowsFromGrid } from "./grid.ts";
import { reprocess, runParserVersion } from "./reprocess.ts";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("the grid keeps every line, blank ones included, and every cell exactly as written", () => {
  const grid = parseCsvGrid('﻿Policy #, Insured ,Amount\r\nA1,"Smith, Jo",  12.50 \r\n\r\nA2,"He said ""no""",\n,,\n');
  assert.deepEqual(grid, [
    ["Policy #", " Insured ", "Amount"],
    ["A1", "Smith, Jo", "  12.50 "],
    [""],
    ["A2", 'He said "no"', ""],
    ["", "", ""],
  ]);
  assert.throws(() => parseCsvGrid('a,"b\nc'), /never closes/);
  assert.deepEqual(parseCsvGrid("a,b"), [["a", "b"]], "no final newline");
  assert.equal(columnLetter(0), "A");
  assert.equal(columnLetter(25), "Z");
  assert.equal(columnLetter(26), "AA");
  assert.equal(columnLetter(45), "AT", "the 46-column Aetna/Aflac/AHL layout ends at AT");
});

test("the header row is the first line as wide as the widest, so a title line is passed over", () => {
  assert.equal(detectHeaderRow([["Americo commission statement"], ["Agent 4471"], ["Policy", "Name", "Amount"], ["A1", "Jo", "1"]]), 3);
  assert.equal(detectHeaderRow([["Policy", "Amount"], ["A1", "1"]]), 1);
  assert.equal(detectHeaderRow([["only one cell"], [""]]), null);
});

test("raw rows: headers verbatim as keys, blank cells kept, nothing filtered, physical row numbers", () => {
  const grid = [["Statement October"], ["Policy #", " Insured ", "", "Amount", "Amount"], ["A1", "Jo", "x", "12.50", "13"], [""], ["A2", "", "", "", "", "extra"]];
  const raw = rawRowsFromGrid(grid, 2);
  assert.deepEqual(raw.preamble, [["Statement October"]]);
  assert.deepEqual(raw.columns.map((column) => column.key), ["Policy #", " Insured ", "(column C)", "Amount", "Amount (column E)", "(column F)"]);
  assert.deepEqual(raw.columns.map((column) => column.header), ["Policy #", " Insured ", "", "Amount", "Amount", ""]);
  assert.equal(raw.rows.length, 3, "the blank line is a row");
  assert.deepEqual(raw.rows.map((row) => row.rowNumber), [3, 4, 5]);
  assert.deepEqual(raw.rows[0].payload, { "Policy #": "A1", " Insured ": "Jo", "(column C)": "x", Amount: "12.50", "Amount (column E)": "13", "(column F)": "" });
  assert.equal(raw.rows[1].payload["Policy #"], "", "blank cells are kept, not dropped");
  assert.equal(raw.rows[2].payload["(column F)"], "extra", "a cell past the header's width still has a column");
});

test("the payload round-trips: the whole grid comes back from the preamble, columns and rows", () => {
  const source = parseCsvGrid("Agent,4471\nPolicy,Status,Paid To,Ignored today\nA1,ACTIVE,2026-10-01,keep me\nA2,LAPSED,,\n");
  const raw = rawRowsFromGrid(source, detectHeaderRow(source));
  const pad = (rows, width) => rows.map((row) => [...row, ...Array(Math.max(0, width - row.length)).fill("")]);
  assert.deepEqual(pad(gridFromRaw(raw).slice(1), 4), pad(source.slice(1), 4));
  assert.deepEqual(gridFromRaw(raw)[0], ["Agent", "4471"]);
  assert.equal(raw.rows[0].payload["Ignored today"], "keep me", "a column no parser reads yet is still there for the next parser version");
});

function fakeWorld({ stages = [], rowsFor = () => [] } = {}) {
  const runs = [];
  const files = [{ id: "f1", carrierId: "c1", fileType: "policies", fileDate: "2026-10-05", parserVersion: null, rowCount: 2 }];
  return {
    runs,
    deps: {
      stages,
      resolveFiles: async () => files,
      readRows: async (_tenant, file) => rowsFor(file),
      startRun: async (input) => { runs.push({ ...input, finished: null }); return `run-${runs.length}`; },
      finishRun: async (id, result) => { runs[Number(id.split("-")[1]) - 1].finished = result; },
    },
  };
}
const twoRows = () => [{ rowNumber: 2, payload: { Policy: "A1" } }, { rowNumber: 3, payload: { Policy: "A2" } }];

test("a reprocess is recorded: trigger, scope, parser version, files, rows read and changed", async () => {
  const { deps, runs } = fakeWorld({ rowsFor: twoRows });
  const result = await reprocess(deps, { tenantId: "t", scope: { kind: "carrier", carrierId: "c1", from: "2026-10-01", to: "2026-10-31" }, trigger: "manual", triggeredBy: "u1" });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.fileIds, ["f1"]);
  assert.equal(result.rowsRead, 2);
  assert.equal(result.rowsChanged, 0, "no stage registered yet: nothing above Layer 1 to rebuild");
  assert.equal(runs.length, 1);
  assert.deepEqual({ trigger: runs[0].trigger, triggeredBy: runs[0].triggeredBy, scope: runs[0].scope.kind, parserVersion: runs[0].parserVersion }, { trigger: "manual", triggeredBy: "u1", scope: "carrier", parserVersion: null });
  assert.equal(runs[0].finished.status, "succeeded");
});

test("a reprocess hands each file's raw rows to every stage in order, and is idempotent", async () => {
  const derived = new Map();
  const calls = [];
  const stage = (name) => ({
    name,
    async rebuild(_tenant, file, rows) {
      calls.push(name);
      let changed = 0;
      for (const row of rows) {
        const key = `${name}:${file.id}:${row.rowNumber}`;
        const value = JSON.stringify(row.payload);
        if (derived.get(key) !== value) { derived.set(key, value); changed++; }
      }
      return { changed };
    },
  });
  const { deps } = fakeWorld({ stages: [stage("policy_snapshot"), stage("policy_current")], rowsFor: twoRows });
  const input = { tenantId: "t", scope: { kind: "file", fileId: "f1" }, trigger: "parser_update", triggeredBy: null };
  const first = await reprocess(deps, input);
  const second = await reprocess(deps, input);
  assert.deepEqual(calls, ["policy_snapshot", "policy_current", "policy_snapshot", "policy_current"]);
  assert.equal(first.rowsChanged, 4);
  assert.equal(second.rowsChanged, 0, "the same reprocess twice changes nothing the second time");
  assert.deepEqual(second.stages, [{ name: "policy_snapshot", files: 1, changed: 0 }, { name: "policy_current", files: 1, changed: 0 }]);
});

test("a reprocess that finds fewer raw rows than the registry promised fails and says so, still recorded", async () => {
  const { deps, runs } = fakeWorld({ rowsFor: () => [{ rowNumber: 2, payload: {} }] });
  const result = await reprocess(deps, { tenantId: "t", scope: { kind: "file", fileId: "f1" }, trigger: "manual", triggeredBy: "u1" });
  assert.equal(result.status, "failed");
  assert.match(result.errorDetail, /1 raw rows, but its registry row says 2/);
  assert.equal(runs[0].finished.status, "failed");
  assert.equal(runParserVersion([{ parserVersion: 2 }, { parserVersion: null }, { parserVersion: 3 }]), "3");
});

test("the migration: rows immutable by permission and trigger, sealed only when the count agrees, partitioned", () => {
  const sql = read("supabase/migrations/20261008110000_la_4_2_raw_rows.sql");
  assert.match(sql, /revoke update, delete, truncate on public\.raw_rows from service_role, tenant_app/);
  assert.match(sql, /create trigger raw_rows_no_update before update or delete on public\.raw_rows/);
  assert.match(sql, /create trigger raw_rows_no_truncate before truncate on public\.raw_rows/);
  assert.match(sql, /constraint raw_rows_pkey primary key \(file_id, row_number\)/);
  assert.match(sql, /on conflict \(file_id, row_number\) do nothing/, "a retried chunk inserts nothing twice");
  assert.match(sql, /if v_found <> p_row_count then\s+raise exception 'Expected % raw rows for this file, found %\.'/, "row_count is written only when raw_rows agree");
  assert.match(sql, /partition by hash \(file_id\)/);
  assert.match(sql, /for values with \(modulus 16, remainder %s\)/);
  assert.match(sql, /A file''s raw rows are fixed once extracted/);
  assert.match(sql, /constraint reprocess_runs_trigger check/);
  assert.match(sql, /revoke delete, truncate on public\.reprocess_runs from service_role, tenant_app/);
});

test("every door sends its spreadsheets to the raw layer, and the poll sweeps what is left", () => {
  assert.match(read("app/api/app/carrier-files/route.ts"), /after\(\(\) => extractRawRowsQuietly\(tenantId, result\.fileId\)\)/);
  assert.match(read("app/api/webhooks/postmark-inbound/route.ts"), /extractRawRowsQuietly\(tenantId, fileId\)/);
  assert.match(read("app/api/internal/carrier-files/poll/route.ts"), /await extractPendingRawRows\(20\)/);
  const layer = read("lib/ingestion/rawLayer.ts");
  assert.match(layer, /\.is\("raw_error", null\)/, "a file that will never read is not retried forever");
  assert.match(layer, /new TextDecoder\("utf-8", \{ fatal: true \}\)/, "no lossy decoding of a carrier's bytes");
  assert.doesNotMatch(layer, /from\("raw_rows"\)\.(update|delete|upsert)/);
  assert.match(read("lib/entitlements/agentApiPolicy.ts"), /app\/api\/app\/carrier-files\/reprocess\/route\.ts/);
});
