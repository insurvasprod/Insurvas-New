import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const { normalizeImportMapping, sanitizeImportMapping } = await import("./csv.ts");
const migration = readFileSync(new URL("../../supabase/migrations/20260914170000_la_2_2_vendor_import_mappings.sql", import.meta.url), "utf8");
const route = readFileSync(new URL("../../app/api/app/leads/import/mappings/route.ts", import.meta.url), "utf8");
const fields = [{ field_key: "first_name", label: "First name", type: "text", is_required: true, options: [], sort_order: 0 }];

test("LA-2.2 mappings normalize headers and reject unknown template fields", () => {
  assert.deepEqual(normalizeImportMapping({ " First Name ": "first_name" }, ["first name"], fields), { "first name": "first_name" });
  assert.throws(() => sanitizeImportMapping({ phone: "missing" }, fields), /unknown field/);
  assert.throws(() => normalizeImportMapping({ old_column: "first_name" }, ["first name"], fields), /not in this file/);
});

test("LA-2.2 mapping storage is tenant-scoped and additive", () => {
  assert.match(migration, /create table if not exists public\.tenant_import_mappings/);
  assert.match(migration, /unique \(tenant_id, vendor_id, product_code\)/);
  assert.match(migration, /tenant_id = nullif\(\(select current_setting\('app\.tenant_id'/);
  assert.match(migration, /before insert or update of tenant_id, vendor_id/);
  assert.match(migration, /revoke all on public\.tenant_import_mappings from anon, authenticated, public/);
  assert.match(route, /requireFeatureRole\("lead_import", roles, \{ write: true \}\)/);
  assert.match(route, /eq\("tenant_id", auth\.context\.tenantId\)/g);
  assert.match(route, /upsert/);
});

const dateOrderMigration = readFileSync(new URL("../../supabase/migrations/20260924343000_import_mapping_date_order.sql", import.meta.url), "utf8");
const importRoute = readFileSync(new URL("../../app/api/app/leads/import/route.ts", import.meta.url), "utf8");
const preflightRoute = readFileSync(new URL("../../app/api/app/leads/import/preflight/route.ts", import.meta.url), "utf8");
const preflight = readFileSync(new URL("./importPreflight.ts", import.meta.url), "utf8");

test("a saved map can remember the vendor's date order, and works before the migration", () => {
  assert.match(dateOrderMigration, /add column if not exists date_order text/);
  assert.match(dateOrderMigration, /date_order is null or date_order in \('mdy', 'dmy'\)/);
  assert.match(dateOrderMigration, /raise exception/);
  // PUT: the map is saved without the date order on the old schema, with a note, not a 503.
  assert.match(route, /isMissingDateOrder\(saved\.error\)/);
  assert.match(route, /The date format was not/);
  // GET: saved maps are still read when the column does not exist.
  assert.match(importRoute, /isMissingColumn\(withDateOrder\.error\)/);
});

test("the date order travels preflight → plan → commit, and the direct import only when passed", () => {
  assert.match(preflightRoute, /date_order: z\.enum\(IMPORT_DATE_ORDERS\)\.nullable\(\)\.optional\(\)/);
  assert.match(preflightRoute, /dateOrder: parsed\.data\.date_order \?\? null/);
  // In the reuse key only when set, so batches staged before it existed still match.
  assert.match(preflight, /\.\.\.\(input\.dateOrder \? \[input\.dateOrder\] : \[\]\)/);
  assert.match(preflight, /\.\.\.\(dateOrder \? \{ dateOrder \} : \{\}\)/);
  assert.match(preflight, /plan\.dateOrder \?\? null/);
  assert.match(importRoute, /isImportDateOrder\(body\.date_order\) \? body\.date_order : null/);
});
