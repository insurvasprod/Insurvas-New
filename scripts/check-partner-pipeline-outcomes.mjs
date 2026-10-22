// Read-only check that 20261022200000 (marketing and affiliate leads keep their pipeline) is live and
// does what it says. Writes nothing.
//   node --env-file=.env.local scripts/check-partner-pipeline-outcomes.mjs [tenant-id]
// Checks: the table and resolver exist; the four movers and seed_default_pipelines are patched; every
// default marketing / affiliate pipeline has its own outcome stages; and, for one agency (default: the
// demo agency), each outcome resolves inside its own pipeline for a marketing and an affiliate lead.
import { createRequire } from "node:module";
const R = process.cwd();
const require = createRequire(`${R}/package.json`);
const { Client } = require("pg");
const { createClient } = require("@supabase/supabase-js");

const tenantId = process.argv[2] ?? "d6f3950f-0d88-4e66-869f-0de2ea6b396b";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const pg = new Client({ connectionString: process.env.TENANT_DB_URL, ssl: { rejectUnauthorized: false } });
let failed = 0;
const check = (ok, label) => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); if (!ok) failed += 1; };

await pg.connect();
try {
  const table = await pg.query("select to_regclass('public.pipeline_disposition_stages') is not null as ok");
  check(table.rows[0].ok, "table pipeline_disposition_stages exists");
  const fns = await pg.query(`select p.proname, pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any($1)`, [["resolve_disposition_stage", "seed_partner_pipeline_outcomes", "complete_disposition", "complete_existing_dial_disposition", "apply_lead_disposition_move", "move_lead_to_disposition", "seed_default_pipelines"]]);
  const body = Object.fromEntries(fns.rows.map((row) => [row.proname, row.d]));
  check(Boolean(body.resolve_disposition_stage), "resolve_disposition_stage exists");
  for (const name of ["complete_disposition", "complete_existing_dial_disposition", "apply_lead_disposition_move", "move_lead_to_disposition"]) {
    check(Boolean(body[name]?.includes("resolve_disposition_stage(") && !body[name]?.includes("stage_dispositions")), `${name} reads the pipeline's own stage first`);
  }
  check(Boolean(body.seed_default_pipelines?.includes("seed_partner_pipeline_outcomes(p_tenant_id)")), "new agencies are seeded");
} finally { await pg.end(); }

// Every default marketing / affiliate pipeline has rows of its own (counted through the service client).
const pipelines = [];
for (let from = 0; ; from += 1000) {
  const page = await db.from("tenant_pipelines").select("id, tenant_id, partner_type").eq("is_default", true).in("partner_type", ["marketing", "affiliate"]).range(from, from + 999);
  if (page.error) { check(false, `read pipelines: ${page.error.message}`); break; }
  pipelines.push(...page.data);
  if (page.data.length < 1000) break;
}
const seeded = new Set();
for (let from = 0; ; from += 1000) {
  const page = await db.from("pipeline_disposition_stages").select("pipeline_id").range(from, from + 999);
  if (page.error) { check(false, `read outcome stages: ${page.error.message}`); break; }
  page.data.forEach((row) => seeded.add(row.pipeline_id));
  if (page.data.length < 1000) break;
}
const bare = pipelines.filter((pipeline) => !seeded.has(pipeline.id));
check(bare.length === 0, `${pipelines.length - bare.length} of ${pipelines.length} default marketing / affiliate pipelines have their own outcome stages${bare.length ? ` (bare, e.g. renamed stages: ${bare.slice(0, 5).map((p) => p.id).join(", ")})` : ""}`);

// One agency: where each outcome takes a marketing and an affiliate lead.
const { data: own } = await db.from("tenant_pipelines").select("id, name, partner_type").eq("tenant_id", tenantId).eq("is_default", true).in("partner_type", ["marketing", "affiliate"]);
for (const pipeline of own ?? []) {
  for (const key of ["application_submitted", "not_interested", "no_answer"]) {
    const { data: stageId, error } = await db.rpc("resolve_disposition_stage", { p_tenant_id: tenantId, p_pipeline_id: pipeline.id, p_disposition_key: key, p_live_only: false });
    if (error) { check(false, `resolve ${key}: ${error.message}`); continue; }
    const { data: stage } = stageId ? await db.from("tenant_pipeline_stages").select("name, pipeline_id").eq("id", stageId).maybeSingle() : { data: null };
    check(stage?.pipeline_id === pipeline.id, `${pipeline.name}: ${key} → ${stage ? stage.name : "stays where it is"}`);
  }
}
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
