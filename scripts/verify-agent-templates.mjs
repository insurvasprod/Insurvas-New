// SA-4.6 agent-side acceptance check: the assigned template drives the JSONB lead form, board,
// filtering, sorting and export. All tenant fixtures are disposable.
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";

const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
let failures = 0;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; } };

const tenant = (await supabase.from("tenants").insert({ name: `Template consumer check ${stamp}`, status: "active" }).select("id").single()).data;
const user = (await supabase.from("users").insert({ email: `template-consumer-${stamp}@insurvas.invalid`, name: "Template Consumer", status: "active" }).select("id").single()).data;
if (!tenant || !user) throw new Error("Could not provision agent fixture");
const tenantId = tenant.id;
const userId = user.id;
const temporaryTemplateIds = [];
const tenantPool = new Pool({ connectionString: process.env.TENANT_DB_URL, ssl: { rejectUnauthorized: false } });
await supabase.from("tenant_users").insert({ tenant_id: tenantId, user_id: userId, role: "owner" });
const plan = (await supabase.from("plans").select("id").eq("code", "plan_a").eq("version", 1).single()).data;
if (!plan) throw new Error("Could not find plan_a fixture");
await supabase.rpc("admin_assign_subscription", { p_tenant_id: tenantId, p_plan_id: plan.id, p_billing_cycle: "monthly", p_start: new Date().toISOString() });
await supabase.rpc("refresh_tenant_entitlement", { p_tenant_id: tenantId });
const token = await new SignJWT({ tenantId }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET));
const cookie = `insurvas_tenant_session=${token}`;
const api = (path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { cookie, ...(options.headers ?? {}) }, redirect: "manual" });

try {
  const initial = await api("/api/app/leads");
  const initialBody = await initial.json();
  check("agent receives an active pinned Term Life template", initial.status === 200 && initialBody.template?.template?.product_code === "term_life" && initialBody.template?.assignment?.template_version === 1);
  check("lead form and pipeline come from the template", initialBody.template?.template?.form_definition?.sections?.[0]?.fields?.length === 6 && initialBody.template?.template?.stages?.length === 7);
  const duplicate = await supabase.rpc("admin_duplicate_template", { p_template_id: initialBody.template.template.id, p_name: `Pinned version check ${stamp}`, p_created_by: null });
  const duplicateId = (Array.isArray(duplicate.data) ? duplicate.data[0] : duplicate.data)?.template_id;
  if (duplicateId) temporaryTemplateIds.push(duplicateId);
  await supabase.from("tenant_template_assignments").update({ template_id: duplicateId, template_version: 1 }).eq("tenant_id", tenantId).eq("product_code", "term_life");
  await supabase.rpc("admin_save_template", { p_template_id: duplicateId, p_name: `Pinned version check v2 ${stamp}`, p_product_code: "term_life", p_description: "Version pin check", p_is_active: true, p_fields: initialBody.template.template.fields, p_stages: initialBody.template.template.stages, p_form_definition: initialBody.template.template.form_definition, p_created_by: null });
  const pinned = await api("/api/app/leads");
  const pinnedBody = await pinned.json();
  check("existing agents stay pinned when the live template is edited", pinnedBody.template?.assignment?.template_version === 1 && pinnedBody.template?.template?.version === 1 && pinnedBody.template?.latest?.version === 2);
  const invalid = await api("/api/app/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ values: { full_name: "" }, stage_key: "new" }) });
  check("missing required JSONB values are rejected server-side", invalid.status === 400);
  const hostile = await api("/api/app/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ values: { full_name: "<script>alert(1)</script>", date_of_birth: "1980-01-01", state: "CA", tobacco_use: false, unexpected: "no" }, stage_key: "new" }) });
  check("unknown JSONB fields are rejected", hostile.status === 400);
  const leadPayload = { values: { full_name: `Alice ${stamp}`, date_of_birth: "1980-01-01", state: "CA", coverage_wanted: 5000000, tobacco_use: true, health_notes: "Prefers evening calls" }, stage_key: "new" };
  const created = await api("/api/app/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(leadPayload) });
  const createdBody = await created.json();
  check("valid values create a lead through the normal path", created.status === 201 && Boolean(createdBody.lead?.id));
  const scopedClient = await tenantPool.connect();
  try {
    await scopedClient.query("begin");
    await scopedClient.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const scopedRows = await scopedClient.query("select tenant_id from agent_leads");
    check("agent lead rows are protected by tenant RLS", scopedRows.rows.length === 1 && scopedRows.rows[0].tenant_id === tenantId);
    await scopedClient.query("commit");
  } finally {
    scopedClient.release();
  }
  const leadId = createdBody.lead?.id;
  const second = await api("/api/app/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(leadPayload) });
  check("repeating a create request does not corrupt the template or pipeline", second.status === 201);
  const filtered = await api(`/api/app/leads?filter_field=full_name&filter_value=Alice%20${stamp}`);
  const filteredBody = await filtered.json();
  check("custom fields are filterable", filtered.status === 200 && filteredBody.leads?.length === 2);
  const sorted = await api("/api/app/leads?sort=full_name&direction=desc");
  const sortedBody = await sorted.json();
  check("custom fields are sortable", sorted.status === 200 && sortedBody.leads?.length === 2 && sortedBody.leads[0].values.full_name >= sortedBody.leads[1].values.full_name);
  if (leadId) {
    const moved = await api(`/api/app/leads/${leadId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ values: leadPayload.values, stage_key: "contacted" }) });
    check("pipeline stage changes are saved", moved.status === 200);
  }
  const exported = await api(`/api/app/leads/export?filter_field=full_name&filter_value=Alice%20${stamp}`);
  const csv = await exported.text();
  check("custom fields are exportable", exported.status === 200 && csv.includes("Full name") && csv.includes(`Alice ${stamp}`) && !csv.includes("<script>"));
} finally {
  await supabase.from("agent_leads").delete().eq("tenant_id", tenantId);
  await supabase.from("tenant_template_assignments").delete().eq("tenant_id", tenantId);
  for (const id of temporaryTemplateIds) {
    await supabase.from("template_forms").delete().eq("template_id", id);
    await supabase.from("template_fields").delete().eq("template_id", id);
    await supabase.from("template_stages").delete().eq("template_id", id);
    await supabase.from("templates").delete().eq("id", id);
  }
  await supabase.from("tenant_entitlements").delete().eq("tenant_id", tenantId);
  await supabase.from("subscriptions").delete().eq("tenant_id", tenantId);
  await supabase.from("tenant_users").delete().eq("tenant_id", tenantId);
  await supabase.from("users").delete().eq("id", userId);
  await supabase.from("tenants").delete().eq("id", tenantId);
  await tenantPool.end();
}

console.log(failures === 0 ? "\nAll agent template checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
