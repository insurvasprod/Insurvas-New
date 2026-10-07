// LA-4.10 (Notion sprint) · existing-book import: the ordinary pipeline, one summary, honest limits.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { moneyOrUnknown, persistencyStatus, PERSISTENCY_MONTHS_NEEDED } from "./policyCurrent.ts";
import { historyOf, TRACKED_FIELDS } from "./snapshots.ts";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const sql = read("supabase/migrations/20261008190000_la_4_10_existing_book_import.sql");
const matching = read("lib/ingestion/policyMatchingStore.ts");
const store = read("lib/ingestion/bookImport.ts");
const route = read("app/api/app/book-import/route.ts");

test("importing 400 policies makes 400 first-seen events and zero change rows", () => {
  const blank = Object.fromEntries(TRACKED_FIELDS.map((field) => [field, null]));
  const book = Array.from({ length: 400 }, (_, i) => ({ policyNumber: `P${i}`, snapshotDate: "2026-10-05", fileId: "import", fileReceivedAt: "2026-10-05T10:00:00Z", values: { ...blank, status_normalized: i % 7 ? "active" : "lapsed", paid_to_date: "2026-09-01", premium_cents: 4000 + i } }));
  const { changes, events } = historyOf(book);
  assert.equal(changes.length, 0, "no phantom 'status changed' rows");
  assert.equal(events.length, 400);
  assert.ok(events.every((e) => e.event_type === "first_seen"));
});

test("the import is the ordinary pipeline, with the file marked as an initial import", () => {
  assert.match(sql, /alter table public\.file_registry add column if not exists is_initial_import boolean not null default false/);
  assert.match(store, /const result = await uploadCarrierFile\(tenantId, userId, \{ \.\.\.input, fileType: "policies" \}\);/, "the LA-4.1 upload door, not a separate importer");
  assert.match(store, /update\(\{ is_initial_import: true \}\)/);
  assert.ok(route.indexOf("uploadForImport(") < route.indexOf("after(() => processFileQuietly("), "marked before its processing starts");
  assert.match(route, /after\(\(\) => processFileQuietly\(tenantId, result\.fileId, extractRawRows\)\)/, "parsed straight away, so each carrier's result shows before the next upload");
});

test("bulk matching: no item per client, one summary per file, counted so a re-run never doubles it", () => {
  assert.match(matching, /\{ bulk: true \}\)/);
  assert.match(matching, /if \(!file\?\.is_initial_import\) return null;/, "only an initial-import file is matched in bulk");
  assert.match(matching, /\(await importedBook\(tenantId, carrier, fileId, rest\)\) \?\? \(await queueReviews\(/);
  assert.match(matching, /counted from what is now true of the file's policies/);
  assert.match(matching, /await openImportSummary\(tenantId, \{ id: fileId/);
  const queues = read("lib/ingestion/exceptionQueuesStore.ts");
  assert.match(queues, /if \(options\.bulk\) return \{ contactId, provisional, itemId: null \};/, "no queue-1 item per policy");
  assert.match(queues, /if \(likely && !options\.bulk\)/, "and no queue-3 item per client");
  assert.match(queues, /subjectKey: `import:\$\{file\.id\}`/, "one summary per file");
  assert.match(sql, /when 'initial_import' then 'admin'/, "the summary belongs to the owner by default");
});

test("persistency reads 'building' until there are files from enough months", () => {
  assert.equal(PERSISTENCY_MONTHS_NEEDED, 3);
  assert.deepEqual(persistencyStatus(0), { ready: false, label: "building — needs 3 months of files (0 so far)" });
  assert.equal(persistencyStatus(2).ready, false);
  assert.equal(persistencyStatus(3).ready, true);
});

test("an unknown advance reads 'Unknown', never $0.00", () => {
  assert.equal(moneyOrUnknown(null), "Unknown");
  assert.equal(moneyOrUnknown(undefined), "Unknown");
  assert.equal(moneyOrUnknown(0), "$0.00", "a real zero still reads as zero");
  assert.equal(moneyOrUnknown(123456), "$1,234.56");
  const page = read("app/app/(shell)/book-import/page.tsx");
  assert.match(page, /label="Advances at risk" value=\{moneyOrUnknown\(null\)\}/);
  assert.match(page, /label="Persistency" value=\{view\.persistency\.ready \? "Ready" : "Building"\}/);
});

test("portal guidance is platform content, editable without a deploy, and nothing is invented", () => {
  assert.match(sql, /create table if not exists public\.carrier_portal_guidance/);
  assert.doesNotMatch(sql, /insert into public\.carrier_portal_guidance/, "no portal instructions are made up");
  assert.match(read("app/api/admin/carrier-guidance/route.ts"), /saveGuidance\(scope\.adminId/);
  assert.match(read("lib/adminNav/build.ts"), /"\/admin\/carrier-guidance", "Portal guidance"/);
});

test("skipping is allowed and can be taken back", () => {
  assert.match(store, /status: "skipped"/);
  assert.match(store, /\.delete\(\)\.eq\("tenant_id", tenantId\)\.eq\("carrier_id", carrierId\)\.eq\("status", "skipped"\)/, "taking a skip back removes only the skip");
  assert.match(store, /status: \(row\?\.status === "skipped" && !file \? "skipped"/, "a carrier imported later counts as imported, the same as if it had never been skipped");
});

test("a file counts as still being read until its snapshots and matching are written", () => {
  assert.match(store, /status: file\.status === "parsed" && !file\.derived_at && !file\.parse_block/, "otherwise the row shows a stale 'no policies yet' (found in the live demo)");
});