// LA-1.23 focused live contract check. It intentionally stops with a clear prerequisite failure
// when the numbered migration is not present; local TypeScript/build evidence must not masquerade
// as proof that the connected Supabase project has the scheduler.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const requiredTables = ["tenant_queue_sla_settings", "lead_sla_events"];
let failures = 0;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures += 1; } };

for (const table of requiredTables) {
  const result = await db.from(table).select("*").limit(1);
  check(`${table} exists in connected Supabase`, !result.error, result.error?.message);
}
if (failures) { console.log("\nLA-1.23 live checks stopped: apply the numbered migration first."); process.exit(1); }

const tenantId = randomUUID();
const oldWorkItem = randomUUID();
const oldLead = randomUUID();
const claimedWorkItem = randomUUID();
const claimedLead = randomUUID();
const userId = randomUUID();
let pipelineId = null;
let stageId = null;
async function cleanup() {
  await db.from("lead_sla_events").delete().eq("tenant_id", tenantId);
  await db.from("lead_queue").delete().eq("tenant_id", tenantId);
  await db.from("agent_leads").delete().eq("tenant_id", tenantId);
  await db.from("tenant_queue_sla_settings").delete().eq("tenant_id", tenantId);
  await db.from("tenant_users").delete().eq("tenant_id", tenantId);
  await db.from("users").delete().eq("id", userId);
  await db.from("tenants").delete().eq("id", tenantId);
}
try {
  const tenant = await db.from("tenants").insert({ id: tenantId, name: `LA-1.23 QA ${Date.now()}`, status: "active", onboarding_state: "completed" }); if (tenant.error) throw tenant.error;
  const user = await db.from("users").insert({ id: userId, email: `la123-${Date.now()}@invalid.test`, name: "LA-1.23 QA", password_hash: "qa-only", status: "active" }); if (user.error) throw user.error;
  const member = await db.from("tenant_users").insert({ tenant_id: tenantId, user_id: userId, role: "owner", accepted_at: new Date().toISOString() }); if (member.error) throw member.error;
  const seeded = await db.rpc("seed_default_pipelines", { p_tenant_id: tenantId }); if (seeded.error) throw seeded.error;
  const pipeline = await db.from("pipelines").select("id").eq("tenant_id", tenantId).eq("partner_type", "publisher").eq("is_default", true).single(); if (pipeline.error) throw pipeline.error; pipelineId = pipeline.data.id;
  const stage = await db.from("pipeline_stages").select("id").eq("pipeline_id", pipelineId).eq("is_archived", false).order("position").limit(1).single(); if (stage.error) throw stage.error; stageId = stage.data.id;
  const template = await db.from("templates").select("id, version, product_code").eq("is_active", true).limit(1).single(); if (template.error) throw template.error;
  const settings = await db.rpc("update_tenant_queue_sla_settings", { p_tenant_id: tenantId, p_actor: userId, p_warn: 1, p_escalate: 2, p_partner: 3, p_expire: 4 }); if (settings.error) throw settings.error;
  const oldAt = new Date(Date.now() - 10_000).toISOString();
  const leads = await db.from("agent_leads").insert([{ id: oldLead, tenant_id: tenantId, template_id: template.data.id, template_version: template.data.version, product_line: template.data.product_code, pipeline_id: pipelineId, stage_id: stageId, values: { full_name: "LA-1.23 Old Lead" }, created_by: userId }, { id: claimedLead, tenant_id: tenantId, template_id: template.data.id, template_version: template.data.version, product_line: template.data.product_code, pipeline_id: pipelineId, stage_id: stageId, values: { full_name: "LA-1.23 Claimed Lead" }, created_by: userId }]); if (leads.error) throw leads.error;
  const queues = await db.from("lead_queue").insert([{ id: oldWorkItem, tenant_id: tenantId, lead_id: oldLead, product_line: template.data.product_code, pipeline_id: pipelineId, stage_id: stageId, status: "unclaimed", queued_at: oldAt }, { id: claimedWorkItem, tenant_id: tenantId, lead_id: claimedLead, product_line: template.data.product_code, pipeline_id: pipelineId, stage_id: stageId, status: "claimed", claimed_by: userId, claimed_at: oldAt, queued_at: oldAt }]); if (queues.error) throw queues.error;
  const first = await db.rpc("run_unclaimed_sla", { p_now: new Date().toISOString(), p_limit: 100 }); if (first.error) throw first.error;
  const second = await db.rpc("run_unclaimed_sla", { p_now: new Date().toISOString(), p_limit: 100 }); if (second.error) throw second.error;
  const events = await db.from("lead_sla_events").select("work_item_id, rung").eq("tenant_id", tenantId).eq("work_item_id", oldWorkItem); if (events.error) throw events.error;
  const counts = Object.fromEntries(["warn", "escalate", "partner", "expire"].map((rung) => [rung, (events.data ?? []).filter((row) => row.rung === rung).length]));
  check("all four rungs fire once on first run and stay once on second run", Object.values(counts).every((count) => count === 1), JSON.stringify(counts));
  const claimed = await db.from("lead_queue").select("status, sla_expired_at").eq("id", claimedWorkItem).single(); check("claimed lead is never expired by scheduler", claimed.data?.status === "claimed" && claimed.data.sla_expired_at === null);
  const reopened = await db.rpc("reopen_expired_lead", { p_tenant_id: tenantId, p_work_item_id: oldWorkItem, p_actor: userId }); check("expired lead can be reopened", !reopened.error && reopened.data?.status === "unclaimed", reopened.error?.message);
  const duplicate = await db.rpc("reopen_expired_lead", { p_tenant_id: tenantId, p_work_item_id: oldWorkItem, p_actor: userId }); check("reopening twice is idempotent", !duplicate.error && duplicate.data?.duplicate === true, duplicate.error?.message);
} finally { await cleanup(); }
process.exit(failures ? 1 : 0);
