// LA-4.20 (Notion sprint) · traceability: every figure back to its source row.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { CARRIER_DATA_STORES, TRACE_SCREENS, TRACED_SOURCES, columnTrace, fileHref, rowHref, unmatchedFields } from "./trace.ts";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const sql = read("supabase/migrations/20261008290000_la_4_20_traceability.sql");

function pages(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...pages(path));
    else if (name === "page.tsx") out.push(relative(root, path).replaceAll("\\", "/"));
  }
  return out;
}

test("every screen that reads carrier data is registered with its sources — a new one fails the build until it is", () => {
  const stores = new Set(CARRIER_DATA_STORES);
  const unregistered = [];
  for (const page of pages(join(root, "app", "app", "(shell)"))) {
    const source = read(page);
    const reads = [...source.matchAll(/from "@\/lib\/ingestion\/(\w+)"/g)].map((m) => m[1]).filter((name) => stores.has(name));
    if (reads.length && !TRACE_SCREENS[page]) unregistered.push(`${page} (reads ${reads.join(", ")})`);
  }
  assert.deepEqual(unregistered, [], "register the screen in TRACE_SCREENS (lib/ingestion/trace.ts) with the tables its figures come from");
  for (const page of Object.keys(TRACE_SCREENS)) assert.ok(statSync(join(root, page)).isFile(), `${page} is registered but doesn't exist`);
});

test("every source a screen names is covered by the database's trace check", () => {
  for (const [page, screen] of Object.entries(TRACE_SCREENS)) {
    assert.ok(screen.sources.length > 0, page);
    for (const source of screen.sources) assert.ok(source in TRACED_SOURCES, `${page}: ${source} is not a traced source`);
  }
  for (const check of new Set(Object.values(TRACED_SOURCES))) assert.match(sql, new RegExp(`select [^;]*'${check}'`), `trace_problems has no '${check}' check`);
});

test("the trace check: each layer's chain, and both sides of a discrepancy", () => {
  assert.match(sql, /join public\.policy_snapshot s on s\.id = pc\.snapshot_id/);
  assert.match(sql, /when s\.raw_row_id is null then 'its snapshot names no raw row'/);
  assert.match(sql, /not exists \(select 1 from public\.raw_rows r where r\.id = e\.raw_row_id and r\.file_id = e\.file_id and r\.tenant_id = e\.tenant_id\)/);
  assert.match(sql, /then 'a reported line is not in the ledger'/);
  assert.match(sql, /then 'its rate-card row is gone'/);
  assert.match(sql, /then 'its carrier statement is not on file'/);
  assert.match(sql, /and d\.status in \('open', 'disputed'\)/);
  assert.match(sql, /cron\.schedule\('la4-trace-health-daily', '45 7 \* \* \*'/);
  assert.match(sql, /revoke update, delete, truncate on public\.trace_health_check from service_role/);
  assert.match(sql, /revoke all on public\.trace_health_check from public, anon, authenticated, tenant_app/, "internal: no agency reads it");
});

test("a discrepancy with a broken trace is withheld from the agent, and can't go on a letter", () => {
  const store = read("lib/ingestion/discrepancyStore.ts");
  assert.match(store, /const shown = \(\(rows\.data \?\? \[\]\) as Loose\[\]\)\.filter\(\(d\) => !withheld\?\.has\(d\.id\)\);/);
  assert.match(store, /items: shown\.map\(/);
  assert.match(store, /if \(rows\.some\(\(r\) => withheld\?\.has\(r\.id\)\)\) throw new DiscrepancyError/);
  assert.match(read("lib/ingestion/traceStore.ts"), /if \(p\.screen === "discrepancies"\) out\.set\(p\.subject, p\.reason\);/);
});

test("the original file: role-gated, a sixty-second link, every download recorded", () => {
  const route = read("app/api/app/carrier-files/[id]/file/route.ts");
  assert.match(route, /const roles = \["owner", "bookkeeper"\] as const;/);
  assert.match(route, /action: "tenant\.carrier_file_downloaded"/);
  assert.match(read("lib/ingestion/registry.ts"), /signedUrl\(data\.storage_path, 60, data\.original_filename\)/);
  assert.match(read("components/app/carrier-file-download.tsx"), /\/api\/app\/carrier-files\/\$\{fileId\}\/file/);
});

test("the hops are in the screens: ledger lines, the policy's Source block, discrepancy lines and file names open their rows", () => {
  // A carrier-file line opens its row; a line of a statement imported by hand (href) opens that statement.
  assert.match(read("components/app/carrier-ledger.tsx"), /href=\{row\.href \?\? rowHref\(row\.fileId, row\.rowNumber\)\}/);
  const policy = read("app/app/(shell)/policies/carrier/[carrierId]/[policyNumber]/page.tsx");
  assert.match(policy, /rowHref\(field\.readFrom\.fileId, field\.readFrom\.rowNumber\)/);
  assert.match(policy, /rowHref\(entry\.fileId, entry\.rowNumber\)/);
  assert.match(read("components/app/carrier-discrepancies.tsx"), /rowHref\(line\.fileId, line\.rowNumber\)/);
  assert.match(read("components/app/carrier-files-table.tsx"), /href=\{fileHref\(file\.id\)\}/);
  assert.match(read("components/app/book-scorecards.tsx"), /rowHref\(e\.fileId, e\.rowNumber\)/);
  assert.equal(fileHref("f1"), "/app/carrier-files/file/f1");
  assert.equal(rowHref("f1", 12), "/app/carrier-files/file/f1/row/12");
});

test("a raw row: every original column, in order, with what the map made of it and what landed", () => {
  const columns = [{ column: "A", header: "Policy #", key: "c0" }, { column: "B", header: "Status", key: "c1" }, { column: "C", header: "Mode Prem", key: "c2" }, { column: "D", header: "Agent Notes", key: "c3" }];
  const payload = { c0: "AM123", c1: "Active", c2: "61.00", c3: "call after 5" };
  const entries = [
    { sourceColumn: "Policy #", targetField: "policy_number", dataType: "text", transform: null, required: true },
    { sourceColumn: "Status", targetField: "carrier_status_raw", dataType: "text", transform: null, required: true },
    { sourceColumn: "Mode Prem", targetField: "premium_cents", dataType: "int_cents", transform: null, required: false },
    { sourceColumn: "Face", targetField: "face_amount_cents", dataType: "int_cents", transform: null, required: false },
  ];
  const stored = { policy_number: "AM123", carrier_status_raw: "Active", premium_cents: 6100 };
  const trace = columnTrace(columns, payload, entries, stored, { "Agent Notes": "call after 5" });
  assert.deepEqual(trace.map((c) => [c.column, c.header, c.value, c.becameField, c.stored]), [
    ["A", "Policy #", "AM123", "policy_number", "AM123"],
    ["B", "Status", "Active", "carrier_status_raw", "Active"],
    ["C", "Mode Prem", "61.00", "premium_cents", "6100"],
    ["D", "Agent Notes", "call after 5", null, "call after 5"],
  ]);
  assert.equal(trace[0].required, true);
  assert.deepEqual(unmatchedFields(columns, entries).map((e) => e.targetField), ["face_amount_cents"], "a field the map expects and this file lacks");
});
