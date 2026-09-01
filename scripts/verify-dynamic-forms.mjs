// LA-1.4 live acceptance check. Fixtures are disposable and removed in finally.
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now(); const tenantId = randomUUID(); const ownerId = randomUUID(); const partnerId = randomUUID(); const partnerUserId = randomUUID();
let copyId = null; let failures = 0;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; } };
const json = (body) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function token(userId, payload, secret) { return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(secret)); }
async function api(path, cookie, options = {}) { return fetch(`${BASE}${path}`, { ...options, headers: { cookie, ...(options.headers ?? {}) }, redirect: "manual" }); }
const agentCookie = (value) => `insurvas_tenant_session=${value}`;
const partnerCookie = (value) => `insurvas_partner_session=${value}`;
async function cleanup() {
  const leads = await db.from("agent_leads").select("id").eq("tenant_id", tenantId);
  const leadIds = (leads.data ?? []).map((row) => row.id);
  if (leadIds.length) {
    await db.from("intake_alerts").delete().eq("tenant_id", tenantId);
    await db.from("intake_failures").delete().in("lead_id", leadIds);
    await db.from("lead_notifications").delete().in("lead_id", leadIds);
    await db.from("lead_queue").delete().in("lead_id", leadIds);
    await db.from("deal_flow").delete().in("lead_id", leadIds);
  }
  await db.from("form_drafts").delete().eq("tenant_id", tenantId);
  await db.from("agent_leads").delete().eq("tenant_id", tenantId);
  await db.from("partner_products").delete().eq("partner_id", partnerId);
  await db.from("partner_users").delete().eq("partner_id", partnerId);
  await db.from("partners").delete().eq("id", partnerId);
  await db.from("tenant_products").delete().eq("tenant_id", tenantId);
  await db.from("audit_log").delete().eq("actor_id", ownerId);
  await db.from("audit_log").delete().eq("actor_id", partnerUserId);
  await db.from("tenant_templates").delete().eq("tenant_id", tenantId);
  await db.from("tenant_entitlements").delete().eq("tenant_id", tenantId);
  await db.from("subscriptions").delete().eq("tenant_id", tenantId);
  await db.from("tenant_users").delete().eq("tenant_id", tenantId);
  await db.from("users").delete().in("id", [ownerId, partnerUserId]);
  await db.from("tenants").delete().eq("id", tenantId);
}
function valuesFor(template) {
  const output = {};
  const required = new Set(template.form_definition.sections.flatMap((section) => section.fields.filter((field) => field.is_required).map((field) => field.field_key)));
  for (const field of template.fields) {
    if (!field.is_required && !required.has(field.field_key)) continue;
    output[field.field_key] = field.type === "number" || field.type === "currency" ? 1 : field.type === "date" ? "1990-01-01" : field.type === "phone" ? "6025550101" : field.type === "email" ? "qa@example.com" : field.type === "ssn" ? "123456789" : field.type === "boolean" ? true : field.type === "single_select" ? field.options[0] ?? "AZ" : field.type === "multi_select" ? [field.options[0] ?? "QA"] : "QA value";
  }
  return output;
}
async function main() {
  await cleanup();
  const tenants = await db.from("tenants").insert({ id: tenantId, name: `LA-1.4 QA ${stamp}`, status: "active", onboarding_state: "completed" }); if (tenants.error) throw new Error(tenants.error.message);
  const users = await db.from("users").insert([{ id: ownerId, email: `la14-owner-${stamp}@invalid.test`, name: "LA-1.4 owner", password_hash: "verification-only", status: "active" }, { id: partnerUserId, email: `la14-partner-${stamp}@invalid.test`, name: "LA-1.4 partner", password_hash: "verification-only", status: "active" }]); if (users.error) throw new Error(users.error.message);
  const member = await db.from("tenant_users").insert({ tenant_id: tenantId, user_id: ownerId, role: "owner" }); if (member.error) throw new Error(member.error.message);
  const plan = await db.from("plans").select("id").eq("code", "basic").eq("version", 1).single(); if (plan.error) throw new Error(plan.error.message);
  const sub = await db.rpc("admin_assign_subscription", { p_tenant_id: tenantId, p_plan_id: plan.data.id, p_billing_cycle: "monthly", p_start: new Date().toISOString() }); if (sub.error) throw new Error(sub.error.message);
  await db.rpc("refresh_tenant_entitlement", { p_tenant_id: tenantId });
  const partner = await db.from("partners").insert({ id: partnerId, tenant_id: tenantId, name: `QA partner ${stamp}`, partner_type: "publisher", status: "active" }); if (partner.error) throw new Error(partner.error.message);
  const partnerMember = await db.from("partner_users").insert({ id: randomUUID(), tenant_id: tenantId, partner_id: partnerId, user_id: partnerUserId, role: "partner_user", status: "active", accepted_at: new Date().toISOString() }); if (partnerMember.error) throw new Error(partnerMember.error.message);
  await db.from("tenant_products").upsert({ tenant_id: tenantId, product_code: "term_life", is_enabled: true });
  await db.from("partner_products").insert({ partner_id: partnerId, product_code: "term_life" });
  const owner = agentCookie(await token(ownerId, { tenantId }, process.env.TENANT_SESSION_SECRET)); const partnerSecret = process.env.PARTNER_SESSION_SECRET ?? `insurvas-partner:${process.env.TENANT_SESSION_SECRET}`; const portal = partnerCookie(await token(partnerUserId, { tenantId, partnerId }, partnerSecret));
  try {
    check("missing and forged sessions are rejected", (await api(`/api/partner/forms/term_life`, "")).status === 401 && (await api(`/api/partner/forms/term_life`, partnerCookie(await token(partnerUserId, { tenantId, partnerId }, `${partnerSecret}-wrong`)))).status === 401);
    check("a missing or unconfigured product form is blocked", (await api("/api/partner/forms/not_configured", portal)).status === 404);
    const initialResponse = await api("/api/app/templates", owner); const initial = await initialResponse.json(); copyId = initial.current?.tenant_template_id; check("agent receives a tenant-owned form copy", initialResponse.status === 200 && copyId && initial.current.template.form_definition);
    if (!copyId) throw new Error("No tenant template copy");
    const original = initial.current.template; const originalVersion = initial.current.assignment.definition_version;
    const draftResponse = await api("/api/partner/forms/term_life/draft", portal, { method: "PUT", ...json({ payload: { draft_note: "in flight" } }) }); check("partner draft autosave endpoint accepts JSONB", draftResponse.status === 200);
    const fields = [...original.fields, { field_key: "contact_preference", label: "Contact preference", type: "single_select", is_required: false, options: ["Email", "Phone"], sort_order: original.fields.length, help_text: "Choose one", validation: {} }, { field_key: "email_address", label: "Email address", type: "email", is_required: false, options: [], sort_order: original.fields.length + 1, help_text: null, validation: {} }];
    const firstSection = original.form_definition.sections[0] ?? { section_key: "application", label: "Application", fields: [], sort_order: 0 };
    const form = { sections: [{ ...firstSection, fields: [...firstSection.fields, { field_key: "contact_preference", is_required: false, show_when: null }, { field_key: "email_address", is_required: false, show_when: { field_key: "contact_preference", equals: "Email" } }] }] };
    const edit = await api(`/api/app/templates/${copyId}`, owner, { method: "PATCH", ...json({ name: original.name, description: original.description, fields, stages: original.stages, form_definition: form }) }); check("adding fields and a conditional form rule needs no deploy", edit.status === 200);
    const liveFormResponse = await api("/api/partner/forms/term_life", portal); const liveForm = await liveFormResponse.json(); check("new field appears immediately in the partner form", liveFormResponse.status === 200 && liveForm.template.template.fields.some((field) => field.field_key === "email_address"));
    const resumed = await (await api("/api/partner/forms/term_life/draft", portal)).json(); check("editing the live form does not rewrite an in-flight draft", resumed.draft?.definition_version === originalVersion, `got ${resumed.draft?.definition_version}, expected ${originalVersion}`);
    const concurrentDrafts = await Promise.all([1, 2].map((n) => api("/api/partner/forms/term_life/draft", portal, { method: "PUT", ...json({ payload: { attempt: n } }) }))); const count = await db.from("form_drafts").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("partner_id", partnerId); check("repeated and concurrent draft saves remain one draft", concurrentDrafts.every((response) => response.status === 200) && count.count === 1);
    const hidden = await api("/api/partner/leads", portal, { method: "POST", ...json({ product_code: "term_life", submission_id: crypto.randomUUID(), values: { contact_preference: "Phone", email_address: "hidden@example.com" } }) }); check("hidden conditional fields are rejected server-side", hidden.status === 400);
    const submissionId = crypto.randomUUID(); const submitValues = valuesFor(liveForm.template.template); submitValues.contact_preference = "Email"; submitValues.email_address = "qa@example.com"; const submitted = await api("/api/partner/leads", portal, { method: "POST", ...json({ product_code: "term_life", submission_id: submissionId, values: submitValues }) }); const submittedBody = await submitted.json().catch(() => null); const remainingDrafts = await db.from("form_drafts").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("partner_id", partnerId); const lead = submittedBody?.lead; const queue = lead ? await db.from("lead_queue").select("id, product_line").eq("lead_id", lead.id).maybeSingle() : { data: null }; const deal = lead ? await db.from("deal_flow").select("id, product_line, local_date").eq("lead_id", lead.id).maybeSingle() : { data: null }; const notification = lead ? await db.from("lead_notifications").select("id, status").eq("lead_id", lead.id).maybeSingle() : { data: null }; check("a valid partner form submits one lead, queue item, deal-flow row and notification", submitted.status === 201 && remainingDrafts.count === 0 && lead?.product_line === "term_life" && queue.data?.product_line === "term_life" && deal.data?.product_line === "term_life" && deal.data?.local_date && notification.data?.status === "queued", `status ${submitted.status}, error ${submittedBody?.error ?? "none"}`);
    const replay = await api("/api/partner/leads", portal, { method: "POST", ...json({ product_code: "term_life", submission_id: submissionId, values: submitValues }) }); const leadCount = await db.from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("submission_id", submissionId); check("submitting the same draft twice creates one lead", replay.status === 200 && (leadCount.count ?? 0) === 1);
    await db.from("partners").update({ status: "paused", paused_at: new Date().toISOString() }).eq("id", partnerId);
    const pausedBefore = await db.from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    const pausedSubmit = await api("/api/partner/leads", portal, { method: "POST", ...json({ product_code: "term_life", submission_id: crypto.randomUUID(), values: submitValues }) });
    const pausedAfter = await db.from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    check("a paused partner cannot submit a new lead", pausedSubmit.status === 403 && pausedAfter.count === pausedBefore.count);
    await db.from("partners").update({ status: "active" }).eq("id", partnerId);
    const unapprovedBefore = await db.from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId); const deniedProduct = await api("/api/partner/leads", portal, { method: "POST", ...json({ product_code: "final_expense", submission_id: crypto.randomUUID(), values: submitValues }) }); const unapprovedAfter = await db.from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId); check("an unapproved product is rejected before a lead write", deniedProduct.status === 403 && unapprovedAfter.count === unapprovedBefore.count);
    await db.from("tenant_products").update({ is_enabled: false }).eq("tenant_id", tenantId).eq("product_code", "term_life");
    const disabledRead = await api("/api/app/leads", owner); const disabledReadBody = await disabledRead.json().catch(() => null);
    check("a previously submitted lead remains readable after its product is disabled", disabledRead.status === 200 && disabledReadBody?.leads?.some((item) => item.id === lead?.id));
    await db.from("tenant_products").update({ is_enabled: true }).eq("tenant_id", tenantId).eq("product_code", "term_life");
    const hostile = await api("/api/partner/leads", portal, { method: "POST", ...json({ product_code: "term_life", submission_id: crypto.randomUUID(), values: { contact_preference: "Email", email_address: "<script>alert(1)</script>" } }) }); check("hostile free-text and invalid email input is rejected", hostile.status === 400);
    const auditRows = await db.from("audit_log").select("action").eq("actor_id", partnerUserId).in("action", ["tenant.form_draft_saved", "tenant.partner_lead_submitted"]); check("draft and partner submission writes are audited", new Set((auditRows.data ?? []).map((row) => row.action)).size === 2, `actions ${(auditRows.data ?? []).map((row) => row.action).join(", ")}`);
    if (process.env.TENANT_DB_URL) { const pool = new pg.Pool({ connectionString: process.env.TENANT_DB_URL, ssl: { rejectUnauthorized: false } }); const connection = await pool.connect(); try { await connection.query("begin"); await connection.query("select set_config('app.tenant_id', $1, true)", [tenantId]); const rows = await connection.query("select tenant_id from form_drafts"); check("form draft RLS is tenant-scoped", rows.rows.every((row) => row.tenant_id === tenantId)); await connection.query("rollback"); } finally { connection.release(); await pool.end(); } }
  } finally { await cleanup(); }
  console.log(failures ? `\n${failures} check(s) FAILED.` : "\nAll LA-1.4 dynamic form checks passed."); return failures ? 1 : 0;
}
process.exitCode = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; });
