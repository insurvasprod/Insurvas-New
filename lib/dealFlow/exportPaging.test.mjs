// LA-1.13-10 (M1 perf, 2026-09-30): the deal flow CSV at 10,000 rows answered 400 every time.
//
// The route asked list_deal_flow_report for one 10,000-row page, which built a history lateral, the
// KPIs, the partner summary and one jsonb_agg over every payload, and hit the statement timeout.
// These pin the paged export: a bounded keyset read per call (20260929140200) and a route that
// streams the CSV page by page, with the report's own pages as the fallback before the migration.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/20260929140200_m1_deal_flow_export_pages.sql", "utf8");
const service = await readFile("lib/dealFlow/service.ts", "utf8");
const route = await readFile("app/api/app/deal-flow/route.ts", "utf8");
const fn = migration.slice(migration.indexOf("create or replace function public.list_deal_flow_export("), migration.indexOf("$function$;"));

test("the export read is bounded by a keyset window over deal_flow alone", () => {
  const keys = fn.slice(fn.indexOf("keys as ("), fn.indexOf("base as not materialized ("));
  assert.match(keys, /from public\.deal_flow d\n  where d\.tenant_id = p_tenant_id/);
  assert.match(keys, /\(d\.local_date, d\.created_at, d\.id\) < \(/);
  assert.match(keys, /order by d\.local_date desc, d\.created_at desc, d\.id desc\n  limit least\(5000, greatest\(1, coalesce\(p_limit, 1000\)\)\)/);
  assert.doesNotMatch(keys, /agent_leads|stage_type|search/, "the window reads only the deal's own columns, so it never skips a row the grid shows");
  assert.match(fn, /where b\.id = any\(array\(select k\.id from keys k\)\)/);
  assert.match(migration, /create index if not exists deal_flow_tenant_order_idx\s+on public\.deal_flow \(tenant_id, local_date, created_at, id\)/);
});

test("the export filters exactly as the grid does and builds nothing the CSV does not print", () => {
  // The grid's filter lines are all still present in the export's filtered CTE.
  for (const line of [
    "and (p_to_date is null or b.local_date <= p_to_date)",
    "and (p_stage_type is null or coalesce(b.stage_type, 'open') = p_stage_type)",
    "or b.insured_name ilike s.search_like",
    "or left(b.lead_id::text, length(s.search_term)) = lower(s.search_term)",
  ]) assert.ok(fn.includes(line), line);
  assert.doesNotMatch(fn, /tenant_lead_activity|row_number\(\)|'kpis'|'summary'|'options'/);
  for (const name of ["worked_by_name", "buffer_agent_name", "disposition_by_name", "issued_at"]) assert.ok(fn.includes(`'${name}'`), name);
  assert.match(fn, /'more', \(select count\(\*\) from keys\) >= \(select page_size from settings\)/);
  assert.match(migration, /revoke all on function public\.list_deal_flow_export\([^)]*\) from public, anon, authenticated, tenant_app/);
  assert.match(migration, /has_schema_privilege\(current_user, 'public', 'CREATE'\)/);
  for (const line of migration.split("\n").filter((l) => l.trimStart().startsWith("--"))) assert.ok(!line.includes(";"), `no semicolon in a comment: ${line}`);
});

test("the route streams the CSV page by page and no longer asks for one 10,000-row page", () => {
  assert.doesNotMatch(route, /pageSize: 10000/);
  assert.match(route, /dealFlowExportPages\(tenantId/);
  assert.match(route, /new ReadableStream/);
  assert.match(route, /const first = await pages\.next\(\);/, "the first page is read before the response starts, so a failure is still a 400");
  assert.match(route, /controller\.error\(error\)/, "a later failure aborts the download instead of ending it short");
  assert.match(route, /"Content-Disposition": "attachment; filename=deal-flow\.csv"/);
});

test("the service pages the export RPC by cursor and falls back to the report's own pages", () => {
  assert.match(service, /export const DEAL_FLOW_EXPORT_PAGE_SIZE = 1000;/);
  assert.match(service, /db\.rpc\("list_deal_flow_export", \{ \.\.\.args, p_after_local_date: cursor\?\.local_date \?\? null, p_after_created_at: cursor\?\.created_at \?\? null, p_after_id: cursor\?\.id \?\? null \}\)/);
  assert.match(service, /if \(result\.error && read === 0 && schemaMissing\(result\.error\)\) \{\n\s+yield\* reportPages\(tenantId, filters\);/);
  assert.match(service, /listDealFlow\(tenantId, \{ \.\.\.filters, focusLeadId: undefined, page, pageSize: DEAL_FLOW_EXPORT_PAGE_SIZE \}\)/);
  assert.match(service, /cursor = payload\.more === true \? exportCursor\(payload\.next\) : null;/);
  // The CSV text is unchanged: the whole-file writer is the header plus the lines.
  assert.match(service, /export function csvForDealFlow\(rows: DealFlowRow\[\]\) \{\n\s+return dealFlowCsvHeader\(\) \+ dealFlowCsvLines\(rows\);/);
});
