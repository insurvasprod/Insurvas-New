// SA-4.7 live acceptance check. All tenants and platform templates created here are disposable.
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now(); let failures = 0; let removedPlanId = null; const templateIds = []; const tenantIds = []; const userIds = [];
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; } };
async function api(path, cookie, options = {}) { return fetch(`${BASE}${path}`, { ...options, headers: { cookie, ...(options.headers ?? {}) }, redirect: "manual" }); }
async function cookie(tenantId, userId) { const token = await new SignJWT({ tenantId }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET)); return `insurvas_tenant_session=${token}`; }
async function forgedCookie(tenantId, userId) { const token = await new SignJWT({ tenantId }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(`${process.env.TENANT_SESSION_SECRET}-forged`)); return `insurvas_tenant_session=${token}`; }
async function fixture(label) {
  const { data: tenant } = await supabase.from("tenants").insert({ name: `${label} ${stamp}`, status: "active" }).select("id").single();
  const { data: user } = await supabase.from("users").insert({ email: `${label.toLowerCase().replaceAll(" ", "-")}-${stamp}@insurvas.invalid`, name: label, status: "active" }).select("id").single();
  if (!tenant || !user) throw new Error("Could not create tenant fixture"); tenantIds.push(tenant.id); userIds.push(user.id);
  await supabase.from("tenant_users").insert({ tenant_id: tenant.id, user_id: user.id, role: "owner" });
  const { data: plan } = await supabase.from("plans").select("id").eq("code", "basic").eq("version", 1).single(); if (!plan) throw new Error("Missing the basic plan");
  const assigned = await supabase.rpc("admin_assign_subscription", { p_tenant_id: tenant.id, p_plan_id: plan.id, p_billing_cycle: "monthly", p_start: new Date().toISOString() }); if (assigned.error) throw new Error(assigned.error.message);
  await supabase.rpc("refresh_tenant_entitlement", { p_tenant_id: tenant.id }); return { tenantId: tenant.id, userId: user.id, cookie: await cookie(tenant.id, user.id), planId: plan.id };
}
const field = (key, label, type = "text", required = false, sort_order = 0) => ({ field_key: key, label, type, is_required: required, options: [], sort_order });
const stage = (key, label, stage_type = "open", color = "#2563eb", sort_order = 0) => ({ stage_key: key, label, stage_type, color, sort_order });
async function main() {
  const first = await fixture("SA47 primary"); const second = await fixture("SA47 other");
  const missingSession = await api("/api/app/templates", ""); check("missing tenant session returns 401", missingSession.status === 401, `status ${missingSession.status}`);
  const expiredToken = await new SignJWT({ tenantId: first.tenantId }).setProtectedHeader({ alg: "HS256" }).setSubject(first.userId).setIssuedAt(Math.floor(Date.now() / 1000) - 30).setExpirationTime(Math.floor(Date.now() / 1000) - 10).sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET));
  const expiredSession = await api("/api/app/templates", `insurvas_tenant_session=${expiredToken}`); check("expired tenant session returns 401", expiredSession.status === 401, `status ${expiredSession.status}`);
  const forgedSession = await api("/api/app/templates", await forgedCookie(first.tenantId, first.userId)); check("forged tenant session returns 401", forgedSession.status === 401, `status ${forgedSession.status}`);
  const initialResponse = await api("/api/app/templates", first.cookie); const initial = await initialResponse.json();
  check("template picker is available to an entitled agent", initialResponse.status === 200 && Array.isArray(initial.templates), `status ${initialResponse.status}, error ${initial.error ?? "none"}`);
  check("onboarding GET creates a tenant-owned working copy", Boolean(initial.current?.tenant_template_id) && initial.current?.template?.fields?.length === 6 && initial.current?.template?.stages?.length === 7);
  const copyId = initial.current?.tenant_template_id;
  if (!copyId || !initial.current?.template) throw new Error("The entitled-agent fixture could not obtain a working template copy");
  const copyRows = await supabase.from("tenant_templates").select("id, template_id, template_version, tenant_id").eq("id", copyId).maybeSingle();
  check("copy records source provenance without linking mutable child rows", copyRows.data?.tenant_id === first.tenantId && copyRows.data?.template_version === 1);
  const secondInitialResponse = await api("/api/app/templates", second.cookie); const secondInitial = await secondInitialResponse.json();
  check("a second tenant receives its own copy", secondInitialResponse.status === 200 && secondInitial.current?.tenant_template_id !== copyId);

  const edited = { ...initial.current.template, name: `Only primary ${stamp}`, fields: initial.current.template.fields.map((item, index) => index === 0 ? { ...item, label: "Primary-only name" } : item), stages: initial.current.template.stages };
  const editResponse = await api(`/api/app/templates/${copyId}`, first.cookie, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: edited.name, description: edited.description, fields: edited.fields, stages: edited.stages, form_definition: edited.form_definition }) });
  check("editing the tenant copy succeeds", editResponse.status === 200);
  const wrongTenant = await api(`/api/app/templates/${copyId}`, second.cookie, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Cross-tenant attempt", description: null, fields: edited.fields, stages: edited.stages, form_definition: edited.form_definition }) });
  check("a tenant cannot edit another tenant's copy", wrongTenant.status === 400);
  const hostileEdit = await api(`/api/app/templates/${copyId}`, first.cookie, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x".repeat(121), description: null, fields: edited.fields, stages: edited.stages, form_definition: edited.form_definition }) });
  check("oversized free-text template input is rejected", hostileEdit.status === 400);
  const otherAfterEdit = await (await api("/api/app/templates", second.cookie)).json(); const platformAfterEdit = await supabase.from("templates").select("name").eq("id", copyRows.data?.template_id).maybeSingle();
  check("editing a copy does not affect another tenant or the platform", otherAfterEdit.current?.template?.name !== edited.name && otherAfterEdit.current?.template?.fields?.[0]?.label !== "Primary-only name" && platformAfterEdit.data?.name !== edited.name);

  const originalSource = copyRows.data?.template_id; const duplicated = await supabase.rpc("admin_duplicate_template", { p_template_id: originalSource, p_name: `SA47 source ${stamp}`, p_created_by: null });
  const source = (Array.isArray(duplicated.data) ? duplicated.data[0] : duplicated.data)?.template_id; if (!source) throw new Error(duplicated.error?.message ?? "Could not create source fixture"); templateIds.push(source); const base = initial.current.template;
  const saved = await supabase.rpc("admin_save_template", { p_template_id: source, p_name: `SA47 source v2 ${stamp}`, p_product_code: "term_life", p_description: "extra source fields", p_is_active: true, p_fields: [...base.fields, field("preferred_contact", "Preferred contact", "phone", false, 99)], p_stages: [...base.stages, stage("review", "Review", "open", "#7c3aed", 99)], p_form_definition: { sections: [...base.form_definition.sections, { section_key: "review", label: "Review", sort_order: 99, fields: [] }] }, p_created_by: null });
  if (saved.error) throw new Error(saved.error.message); const newVersion = Array.isArray(saved.data) ? saved.data[0] : saved.data; const version = newVersion?.version;
  const previewResponse = await api("/api/app/templates/preview", first.cookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template_id: source, template_version: version }) }); const previewBody = await previewResponse.json();
  check("second-template preview lists exact fields, stages and sections before commit", previewResponse.status === 200 && previewBody.preview.fieldsToAdd.includes("Preferred contact") && previewBody.preview.stagesToAdd.includes("Review") && previewBody.preview.sectionsToAdd.includes("Review"));
  const concurrentApplies = await Promise.all([1, 2].map(() => api("/api/app/templates", first.cookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template_id: source, template_version: version }) })));
  check("concurrent template applies remain safe", concurrentApplies.every((response) => response.status === 200));
  const afterApply = (await (await api("/api/app/templates", first.cookie)).json()).current;
  check("merge keeps custom edits and adds new definitions", afterApply.template.fields.some((item) => item.field_key === "preferred_contact") && afterApply.template.fields.some((item) => item.label === "Primary-only name") && afterApply.template.stages.some((item) => item.stage_key === "review"));
  const countBefore = { fields: afterApply.template.fields.length, stages: afterApply.template.stages.length };
  const repeat = await api("/api/app/templates", first.cookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ template_id: source, template_version: version }) }); const repeatCurrent = (await (await api("/api/app/templates", first.cookie)).json()).current;
  check("applying the same template twice does not duplicate fields or stages", repeat.status === 200 && repeatCurrent.template.fields.length === countBefore.fields && repeatCurrent.template.stages.length === countBefore.stages);

  removedPlanId = first.planId; const planAccess = await supabase.from("plan_product_access").delete().eq("plan_id", first.planId).eq("product_code", "term_life");
  if (planAccess.error) throw new Error(planAccess.error.message);
  const filtered = await (await api("/api/app/templates", first.cookie)).json(); check("templates outside the subscription are not offered", !filtered.templates.some((item) => item.product_code === "term_life"));
  await supabase.from("plan_product_access").insert({ plan_id: first.planId, product_code: "term_life" });

  if (process.env.TENANT_DB_URL) { const pool = new Pool({ connectionString: process.env.TENANT_DB_URL, ssl: { rejectUnauthorized: false } }); const connection = await pool.connect(); try { await connection.query("begin"); await connection.query("select set_config('app.tenant_id', $1, true)", [first.tenantId]); const visible = await connection.query("select tenant_id from tenant_templates"); check("tenant template rows are tenant-RLS scoped", visible.rows.every((row) => row.tenant_id === first.tenantId)); await connection.query("rollback"); } finally { connection.release(); await pool.end(); } }
}
try { await main(); } finally { if (removedPlanId) await supabase.from("plan_product_access").upsert({ plan_id: removedPlanId, product_code: "term_life" }); await supabase.from("agent_leads").delete().in("tenant_id", tenantIds); await supabase.from("tenant_templates").delete().in("tenant_id", tenantIds); await supabase.from("tenant_template_assignments").delete().in("tenant_id", tenantIds); await supabase.from("tenant_entitlements").delete().in("tenant_id", tenantIds); await supabase.from("subscriptions").delete().in("tenant_id", tenantIds); await supabase.from("tenant_users").delete().in("tenant_id", tenantIds); for (const id of userIds) await supabase.from("users").delete().eq("id", id); for (const id of tenantIds) await supabase.from("tenants").delete().eq("id", id); for (const id of templateIds) { await supabase.from("template_forms").delete().eq("template_id", id); await supabase.from("template_fields").delete().eq("template_id", id); await supabase.from("template_stages").delete().eq("template_id", id); await supabase.from("templates").delete().eq("id", id); } }
console.log(failures ? `\n${failures} check(s) FAILED.` : "\nAll SA-4.7 checks passed."); process.exit(failures ? 1 : 0);
