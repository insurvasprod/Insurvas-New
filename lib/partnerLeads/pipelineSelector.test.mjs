import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile("supabase/migrations/20261102180000_partner_pipeline_selector.sql", "utf8");
const languageMigration = await readFile("supabase/migrations/20261102200000_partner_pipeline_language.sql", "utf8");
const service = await readFile("lib/partnerLeads/service.ts", "utf8");
const route = await readFile("app/api/partner/leads/pipeline/route.ts", "utf8");
const component = await readFile("components/partner/partner-lead-pipeline.tsx", "utf8");
const record = await readFile("components/partner/partner-lead-record.tsx", "utf8");
const fn = migration.slice(migration.indexOf("create or replace function public.partner_lead_pipeline_page"), migration.indexOf("$function$;"));

test("pipeline selection narrows the same tenant and partner filtered read model", () => {
  const filtered = fn.slice(fn.indexOf("with filtered as"), fn.indexOf("), available_pipeline_ids as"));
  assert.match(filtered, /q\.tenant_id=p_tenant_id and q\.partner_id=p_partner_id/);
  assert.match(filtered, /p_pipeline_id is null or q\.pipeline_id=p_pipeline_id/);
  assert.match(service, /p_pipeline_id: filters\.pipelineId \?\? null/);
  assert.match(route, /pipelineId: params\.get\("pipeline_id"\)/);
});

test("pipeline choices show the agency's live pipelines while lead rows remain team scoped", () => {
  const visible = fn.slice(fn.indexOf("), available_pipeline_ids as"), fn.indexOf("), available_pipelines as"));
  assert.match(visible, /pipeline\.tenant_id=p_tenant_id and pipeline\.status='live'/);
  assert.match(visible, /select pipeline\.id as pipeline_id/);
  assert.match(fn, /join available_pipeline_ids available on available\.pipeline_id=pipeline\.id/);
  assert.match(fn, /l\.created_by = any\(coalesce\(p_visible_submitter_ids, array\[\]::uuid\[\]\)\)/);
  assert.match(route, /partnerTeamMembers\(auth\.context\.tenantId, auth\.context\.partnerId\)/);
  assert.match(route, /visibleSubmitters\(\{ userId: auth\.context\.userId, role: auth\.context\.role \}, members\)/);
  assert.match(service, /filters\.pipelineId && !pipelines\.some/);
  assert.match(service, /p_visible_submitter_ids: access\?\.visibleSubmitterIds \?\? \[\]/);
  assert.match(service, /selectedPipelineId, pipelines:/);
});

test("the export shares the same signed-in team boundary as the pipeline", async () => {
  const exportRoute = await readFile("app/api/partner/leads/export/route.ts", "utf8");
  assert.match(exportRoute, /visibleSubmitters\(\{ userId: auth\.context\.userId, role: auth\.context\.role \}, members\)/);
  assert.match(exportRoute, /visibleSubmitterIds \}\)/);
});

test("the selector keeps service-role-only access and replaces the old RPC signature", () => {
  assert.match(migration, /drop function if exists public\.partner_lead_pipeline_page\(uuid, uuid, date, date, uuid, text, uuid, text, text, integer, integer\)/);
  assert.match(migration, /revoke all on function public\.partner_lead_pipeline_page\([^)]*uuid\[\]\) from public, anon, authenticated, tenant_app/);
  assert.match(migration, /grant execute on function public\.partner_lead_pipeline_page\([^)]*uuid\[\]\) to service_role/);
});

test("pipeline toolbar uses the shared searchable menu and icon switch in the requested order", () => {
  assert.match(component, /<SelectMenu[\s\S]*?label="Pipeline"[\s\S]*?searchPlaceholder="Search pipelines"/);
  assert.match(component, /<IconViewSwitch label="Pipeline view"/);
  const viewAt = component.indexOf("<IconViewSwitch label=\"Pipeline view\"");
  const filtersAt = component.indexOf("<FilterButton iconOnly open={moreFilters}", viewAt);
  const refreshAt = component.indexOf("<RefreshButton", filtersAt);
  assert.ok(viewAt >= 0 && filtersAt > viewAt && refreshAt > filtersAt);
  assert.match(component, /bg-card px-3 py-2 text-sm font-semibold md:static/);
});

test("pipeline cards receive the customer's saved language without changing existing RPC positions", () => {
  assert.match(languageMigration, /as customer_language/);
  assert.match(languageMigration, /\(sla_partner_notified_at is not null and status in \('unclaimed','expired'\)\), customer_language\)/);
  assert.match(service, /value\.length >= 17 && typeof value\[16\] === "string"/);
  assert.match(component, /row\.language && <StatusChip tone="neutral"/);
});

test("lead information tabs share the header row and the record exposes the language tag", () => {
  // Since 2026-11-04 the lead's pages and the application's sections are one side navigation (SettingsLayout).
  assert.match(record, /<SettingsLayout[\s\S]*?sections: \["call-updates", "notes"\]/);
  assert.match(record, /Customer language: \$\{detail\.language\}/);
});
