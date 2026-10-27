/**
 * Settings → Pipelines: a pipeline may have no partner type (the board's "Outbound final expense ·
 * —"), without changing how a partner's lead finds its pipeline. And the screen counts leads in one
 * grouped statement rather than one request per stage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cssColorToHex } from "../design/tokenColor.ts";

const read = (...parts) => readFileSync(join(process.cwd(), ...parts), "utf8");
const migration = read("supabase", "migrations", "20260924240100_pipelines_partner_type_is_optional.sql");
const service = read("lib", "pipelines", "service.ts");

test("partner_type becomes optional, with the uniques NULL would otherwise escape", () => {
  assert.match(migration, /alter column partner_type drop not null/);
  assert.match(migration, /on public\.tenant_pipelines \(tenant_id, name\)\s+where partner_type is null/);
  assert.match(migration, /on public\.tenant_pipelines \(tenant_id\)\s+where is_default and partner_type is null/);
});

test("partner routing still looks a pipeline up by the partner's type, which NULL never matches", () => {
  assert.match(service, /export async function resolveRuntimeStage[\s\S]{0,600}\.eq\("partner_type", partnerType\)\.eq\("is_default", true\)/);
  assert.match(service, /export async function resolvePartnerEntryStage[\s\S]{0,400}\.eq\("partner_type", partnerType\)/);
});

test("a lead with no partner enters the default pipeline with no partner type, else marketing as before", () => {
  assert.match(service, /\.is\("partner_type", null\)\.eq\("is_default", true\)/);
  assert.match(service, /return resolveRuntimeStage\(tenantId, "new", "marketing"\);/);
  assert.match(read("lib", "leadPost", "service.ts"), /resolveUnpartneredEntry\(keyRow\.tenant_id\)/);
  assert.match(read("app", "api", "app", "leads", "import", "route.ts"), /item\.partner_type === null && item\.is_default/);
});

test("the service accepts no partner type, and says when the database cannot store it yet", () => {
  assert.match(service, /if \(value === null \|\| value === ""\) return null;/);
  assert.match(service, /error\?\.code === "23502" && \/partner_type\//);
});

test("lead counts are one grouped statement, with a per-stage fallback until it exists", () => {
  assert.match(migration, /group by l\.pipeline_id, l\.stage_id/);
  assert.match(migration, /grant execute on function public\.tenant_pipeline_lead_counts\(uuid\) to service_role/);
  assert.match(service, /"tenant_pipeline_lead_counts"/);
  assert.match(service, /if \(!isMissingFunction\(grouped\.error\)\)/);
});

test("Settings › Pipelines & outcomes edits a pipeline's partner type, default and stages, owner-only", () => {
  // 2026-10-27: Pipelines and Dispositions became one page; the stage manager, the new-pipeline
  // wizard and the disposition library were replaced by its editors (components/app/settings/pipelines-outcomes.tsx).
  const ui = read("components", "app", "settings", "pipelines-outcomes.tsx");
  assert.match(ui, /label: "No partner type"/, "a pipeline can still have no partner type");
  assert.match(ui, /fetch\("\/api\/app\/leads\/pipeline-context"/, "the editors read the stage rules from the pipeline context");
  assert.match(ui, /\/api\/app\/pipelines\/\$\{op\.pipelineId\}\/stages\/reorder/, "stages are reordered through the reorder route");
  assert.match(ui, /is_archived: true/, "a stage is archived, never deleted");
  assert.doesNotMatch(ui, /#[0-9a-f]{6}/i, "colours come from the palette in lib/pipelines/outcomesBoard.ts, not hex in the screen");
  assert.match(read("lib", "settings", "sections.ts"), /id: "pipelines",[^\n]*required_feature: "book_of_business", required_roles: OWNER,/);
});

test("a stored stage colour is read from a token as hex", () => {
  assert.equal(cssColorToHex("#59606B"), "#59606b");
  assert.equal(cssColorToHex("#abc"), "#aabbcc");
  assert.equal(cssColorToHex("rgb(89, 96, 107)"), "#59606b");
  assert.equal(cssColorToHex("oklch(0.5 0.1 200)"), null);
  assert.doesNotMatch(read("components", "app", "template-settings.tsx"), /#64748b/i);
});
