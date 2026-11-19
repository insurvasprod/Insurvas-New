/**
 * Puts the "Docs Screenshots" agency back to a brand-new agency's Get set up, so scripts/docs-shots.mjs can photograph
 * every Ready to sell step again after a screen changes. Only ever touches tenant 2f20eabf-… (the agency made for the
 * screenshots, comped, owner docs.shots@insurvas.test) and refuses to run if that tenant's name is not
 * "Docs Screenshots".
 *
 * Each step's fact (lib/dashboard/setupProgress.ts) is undone the gentlest way that turns it false: carriers
 * switched off, appointments ended, publishers offboarded, imported batches and their leads removed, campaigns and
 * vendors removed, calling hours removed, statements voided (statements cannot be deleted by anyone), and the
 * owner's Get set up row cleared.
 *
 *   node --env-file=.env.local scripts/docs-shots-reset.mjs --dry-run
 *   node --env-file=.env.local scripts/docs-shots-reset.mjs
 */
import { createClient } from "@supabase/supabase-js";

const TENANT_ID = "2f20eabf-15f7-41bf-b4d4-d9f4d09d522c";
const DRY = process.argv.includes("--dry-run");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: tenant, error: tenantError } = await db.from("tenants").select("id, name").eq("id", TENANT_ID).maybeSingle();
if (tenantError || !tenant) throw new Error(`Docs Screenshots agency not found: ${tenantError?.message ?? "no row"}`);
if (tenant.name !== "Docs Screenshots") throw new Error(`Refusing: tenant ${TENANT_ID} is "${tenant.name}", not "Docs Screenshots"`);

const now = new Date().toISOString();
/** [label, the query to run] — every one filtered to this one tenant. */
const steps = [
  ["switch carriers off", () => db.from("tenant_carriers").update({ is_active: false }).eq("tenant_id", TENANT_ID).eq("is_active", true)],
  ["clear contracted switches", () => db.from("tenant_carrier_requirements").delete().eq("tenant_id", TENANT_ID)],
  ["end appointments", () => db.from("appointments").update({ terminated_at: now }).eq("tenant_id", TENANT_ID).is("terminated_at", null)],
  ["offboard publishers", () => db.from("partners").update({ status: "offboarded" }).eq("tenant_id", TENANT_ID).neq("status", "offboarded")],
  ["remove queued leads", () => db.from("lead_queue").delete().eq("tenant_id", TENANT_ID)],
  ["remove leads", () => db.from("agent_leads").delete().eq("tenant_id", TENANT_ID)],
  ["remove import batches", () => db.from("agent_lead_import_batches").delete().eq("tenant_id", TENANT_ID)],
  ["remove campaigns", () => db.from("tenant_campaigns").delete().eq("tenant_id", TENANT_ID)],
  ["remove vendors", () => db.from("tenant_lead_vendors").delete().eq("tenant_id", TENANT_ID)],
  ["remove calling hours", () => db.from("tenant_calling_windows").delete().eq("tenant_id", TENANT_ID)],
  ["void statements", () => db.from("tenant_commission_statements").update({ status: "voided", voided_at: now, void_reason: "Docs screenshots reset" }).eq("tenant_id", TENANT_ID).neq("status", "voided")],
  ["switch products off", () => db.from("tenant_products").update({ is_enabled: false }).eq("tenant_id", TENANT_ID).eq("is_enabled", true)],
  ["clear the owner's Get set up", () => db.from("tenant_setup_guide").update({ skipped_steps: [], done_steps: [], hidden_at: null, finished_at: null, paused_step: null, paused_move: null }).eq("tenant_id", TENANT_ID)],
  ["clear the finished stamp", () => db.from("tenants").update({ setup_checklist_completed_at: null }).eq("id", TENANT_ID)],
];

let failed = 0;
for (const [label, run] of steps) {
  if (DRY) { console.log(`would ${label}`); continue; }
  const { error } = await run();
  if (error) { failed += 1; console.log(`✗ ${label}: ${error.message}`); } else console.log(`✓ ${label}`);
}
if (failed) { console.log(`${failed} step(s) failed: Get set up may still show some steps as done.`); process.exitCode = 1; }
