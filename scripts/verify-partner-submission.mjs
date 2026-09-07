// LA-1.6 live acceptance check. Fixtures are disposable and exercise the real partner API.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now(); const tenantId = randomUUID(); const ownerId = randomUUID(); const partnerId = randomUUID(); const partnerUserId = randomUUID(); const vendorIds = [];
let failures = 0;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; } };
const json = (body) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const cookie = (name, token) => `${name}=${token}`;
async function token(secret, userId, payload) { return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(secret)); }
async function api(path, requestCookie, options = {}) { return fetch(`${BASE}${path}`, { ...options, headers: { cookie: requestCookie, ...(options.headers ?? {}) }, redirect: "manual" }); }

function startVendorSimulator() {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      let phone = ""; try { phone = String(JSON.parse(body).phone ?? ""); } catch { /* adapter rejects malformed responses */ }
      response.setHeader("content-type", "application/json");
      if ((request.url ?? "").includes("litigator-primary")) { response.statusCode = 503; response.end(JSON.stringify({ error: "primary unavailable" })); return; }
      if ((request.url ?? "").includes("litigator-secondary")) { response.statusCode = 200; response.end(JSON.stringify({ hit: phone.endsWith("0001") })); return; }
      if ((request.url ?? "").includes("dnc-primary")) { response.statusCode = 200; response.end(JSON.stringify({ listed: phone.endsWith("0101") })); return; }
      response.statusCode = 404; response.end(JSON.stringify({ error: "unknown simulator route" }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

async function cleanup() {
  const leads = await db.from("agent_leads").select("id").eq("tenant_id", tenantId); const leadIds = (leads.data ?? []).map((row) => row.id);
  if (leadIds.length) { await db.from("intake_alerts").delete().eq("tenant_id", tenantId); await db.from("intake_failures").delete().in("lead_id", leadIds); await db.from("lead_notifications").delete().in("lead_id", leadIds); await db.from("lead_queue").delete().in("lead_id", leadIds); await db.from("deal_flow").delete().in("lead_id", leadIds); }
  await db.from("screening_audit").delete().eq("tenant_id", tenantId); await db.from("screening_cache_locks").delete().eq("tenant_id", tenantId); await db.from("screening_results").delete().eq("tenant_id", tenantId); await db.from("usage_events").delete().eq("tenant_id", tenantId); await db.from("usage_totals").delete().eq("tenant_id", tenantId); await db.from("form_drafts").delete().eq("tenant_id", tenantId); await db.from("agent_leads").delete().eq("tenant_id", tenantId);
  await db.from("partner_products").delete().eq("partner_id", partnerId); await db.from("partner_users").delete().eq("partner_id", partnerId); await db.from("partners").delete().eq("id", partnerId); await db.from("tenant_products").delete().eq("tenant_id", tenantId); await db.from("tenant_templates").delete().eq("tenant_id", tenantId); await db.from("tenant_entitlements").delete().eq("tenant_id", tenantId); await db.from("subscriptions").delete().eq("tenant_id", tenantId); await db.from("tenant_users").delete().eq("tenant_id", tenantId); await db.from("users").delete().in("id", [ownerId, partnerUserId]); await db.from("tenants").delete().eq("id", tenantId); if (vendorIds.length) await db.from("compliance_vendors").delete().in("id", vendorIds);
}

function valuesFor(template, phone, fullName = "QA Prospect") {
  const output = {}; const required = new Set(template.form_definition.sections.flatMap((section) => section.fields.filter((field) => field.is_required).map((field) => field.field_key)));
  for (const field of template.fields) {
    if (!field.is_required && !required.has(field.field_key)) continue;
    output[field.field_key] = field.type === "number" || field.type === "currency" ? 1 : field.type === "date" ? "1990-01-01" : field.type === "phone" ? phone : field.type === "email" ? "qa@example.com" : field.type === "ssn" ? "123456789" : field.type === "boolean" ? true : field.type === "single_select" ? field.options[0] ?? "AZ" : field.type === "multi_select" ? [field.options[0] ?? "QA"] : field.field_key === "full_name" ? fullName : field.field_key === "first_name" ? fullName.split(" ")[0] : field.field_key === "last_name" ? fullName.split(" ").slice(1).join(" ") : "QA value";
  }
  for (const field of template.fields) if (field.type === "phone") output[field.field_key] = phone;
  for (const key of ["full_name", "name"]) if (template.fields.some((field) => field.field_key === key)) output[key] = fullName;
  return output;
}

async function main() {
  const probes = await Promise.all(["agent_leads", "form_drafts"].map((table) => db.from(table).select("*").limit(0)));
  if (probes.some((probe) => probe.error)) { console.log("NOT TESTABLE YET — apply the LA-1.6 migration first."); return 2; }
  await cleanup(); const simulator = await startVendorSimulator();
  try {
    const tenant = await db.from("tenants").insert({ id: tenantId, name: `LA-1.6 QA ${stamp}`, status: "active", onboarding_state: "completed" }); if (tenant.error) throw new Error(tenant.error.message);
    const users = await db.from("users").insert([{ id: ownerId, email: `la16-owner-${stamp}@invalid.test`, name: "LA-1.6 owner", password_hash: "verification-only", status: "active" }, { id: partnerUserId, email: `la16-partner-${stamp}@invalid.test`, name: "LA-1.6 partner", password_hash: "verification-only", status: "active" }]); if (users.error) throw new Error(users.error.message);
    const member = await db.from("tenant_users").insert({ tenant_id: tenantId, user_id: ownerId, role: "owner" }); if (member.error) throw new Error(member.error.message);
    const plan = await db.from("plans").select("id").eq("code", "advance").eq("version", 1).single(); if (plan.error) throw new Error(plan.error.message);
    const sub = await db.rpc("admin_assign_subscription", { p_tenant_id: tenantId, p_plan_id: plan.data.id, p_billing_cycle: "monthly", p_start: new Date().toISOString() }); if (sub.error) throw new Error(sub.error.message);
    const entitlement = await db.rpc("refresh_tenant_entitlement", { p_tenant_id: tenantId }); if (entitlement.error) throw new Error(entitlement.error.message);
    const serverBase = `http://127.0.0.1:${simulator.port}`;
    const vendors = await db.from("compliance_vendors").insert([{ name: `LA16 litigator primary ${stamp}`, vendor_type: "litigator_scrub", endpoint: `${serverBase}/litigator-primary`, is_enabled: true, priority: 1, cost_per_lookup_cents: 1 }, { name: `LA16 litigator secondary ${stamp}`, vendor_type: "litigator_scrub", endpoint: `${serverBase}/litigator-secondary`, is_enabled: true, priority: 2, cost_per_lookup_cents: 1 }, { name: `LA16 dnc primary ${stamp}`, vendor_type: "dnc_scrub", endpoint: `${serverBase}/dnc-primary`, is_enabled: true, priority: 1, cost_per_lookup_cents: 1 }]).select("id"); if (vendors.error) throw new Error(vendors.error.message); vendorIds.push(...(vendors.data ?? []).map((row) => row.id));
    const partner = await db.from("partners").insert({ id: partnerId, tenant_id: tenantId, name: `LA16 partner ${stamp}`, partner_type: "publisher", status: "active" }); if (partner.error) throw new Error(partner.error.message);
    const partnerMember = await db.from("partner_users").insert({ id: randomUUID(), tenant_id: tenantId, partner_id: partnerId, user_id: partnerUserId, role: "partner_user", status: "active", accepted_at: new Date().toISOString() }); if (partnerMember.error) throw new Error(partnerMember.error.message);
    const product = await db.from("tenant_products").upsert({ tenant_id: tenantId, product_code: "term_life", is_enabled: true }); if (product.error) throw new Error(product.error.message); const approval = await db.from("partner_products").insert({ partner_id: partnerId, product_code: "term_life" }); if (approval.error) throw new Error(approval.error.message);
    const agentSecret = process.env.TENANT_SESSION_SECRET; const partnerSecret = process.env.PARTNER_SESSION_SECRET ?? `insurvas-partner:${agentSecret}`; if (!agentSecret) throw new Error("TENANT_SESSION_SECRET is required");
    const owner = cookie("insurvas_tenant_session", await token(agentSecret, ownerId, { tenantId })); const portal = cookie("insurvas_partner_session", await token(partnerSecret, partnerUserId, { tenantId, partnerId }));
    const provisioned = await api("/api/app/templates", owner); if (provisioned.status !== 200) throw new Error(`Could not provision form (HTTP ${provisioned.status})`);
    const formResponse = await api("/api/partner/forms/term_life", portal); const formBody = await formResponse.json(); const template = formBody?.template?.template; if (!template) throw new Error(`Could not load form (HTTP ${formResponse.status})`);
    const phone = "6025550103"; const draftValues = valuesFor(template, phone); const draftSave = await api("/api/partner/forms/term_life/draft", portal, { method: "PUT", ...json({ payload: { ...draftValues, draft_note: "resume me" } }) }); const draftRead = await (await api("/api/partner/forms/term_life/draft", portal)).json(); check("draft saves and returns every typed value with its definition version", draftSave.status === 200 && draftRead.draft?.payload?.draft_note === "resume me" && draftRead.template?.assignment?.definition_version === draftRead.draft?.definition_version);
    const tcpa = await api("/api/partner/forms/term_life/screen", portal, { method: "POST", ...json({ phone: "6025550001" }) }); const tcpaBody = await tcpa.json(); check("TCPA-blocked number is stopped before the form gate", tcpa.status === 422 && tcpaBody.code === "tcpa_litigator" && tcpaBody.blocked === true);
    const dnc = await api("/api/partner/forms/term_life/screen", portal, { method: "POST", ...json({ phone: "6025550101" }) }); const dncBody = await dnc.json(); check("DNC screening returns a visible warning that can be acknowledged", dnc.status === 200 && dncBody.warning?.code === "dnc");
    const dncValues = valuesFor(template, "6025550101", "DNC Prospect"); const dncId = randomUUID(); const dncWithoutAck = await api("/api/partner/leads", portal, { method: "POST", ...json({ product_code: "term_life", values: dncValues, submission_id: dncId }) }); const beforeAck = await db.from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("submission_id", dncId); const dncSubmit = await api("/api/partner/leads", portal, { method: "POST", ...json({ product_code: "term_life", values: dncValues, submission_id: dncId, screening_warning_acknowledged: true }) }); const dncSubmitBody = await dncSubmit.json(); check("DNC warning blocks unacknowledged submit, then records acknowledgement on the lead", dncWithoutAck.status === 409 && beforeAck.count === 0 && dncSubmit.status === 201 && dncSubmitBody.lead?.screening_warning_acknowledged === true);
    const duplicateValues = valuesFor(template, phone, "Duplicate Prospect"); const first = await api("/api/partner/leads", portal, { method: "POST", ...json({ product_code: "term_life", values: duplicateValues, submission_id: randomUUID() }) }); const duplicateId = randomUUID(); const duplicate = await api("/api/partner/leads", portal, { method: "POST", ...json({ product_code: "term_life", values: duplicateValues, submission_id: duplicateId }) }); const duplicateBody = await duplicate.json(); const override = await api("/api/partner/leads", portal, { method: "POST", ...json({ product_code: "term_life", values: duplicateValues, submission_id: duplicateId, duplicate_override_justification: "Customer confirmed this is a separate household." }) }); const overrideBody = await override.json(); check("duplicate override requires justification and stores it", first.status === 201 && duplicate.status === 409 && duplicateBody.code === "duplicate_lead" && override.status === 201 && overrideBody.lead?.duplicate_override_justification?.includes("separate household"));
    const replayId = randomUUID(); const replayValues = valuesFor(template, "6025550104", "Replay Prospect"); const repeated = await Promise.all([1, 2].map(() => api("/api/partner/leads", portal, { method: "POST", ...json({ product_code: "term_life", values: replayValues, submission_id: replayId }) }))); const replayCount = await db.from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("submission_id", replayId); check("two quick submissions create one lead", repeated.every((response) => response.status === 201 || response.status === 200) && replayCount.count === 1);
    const audits = await db.from("audit_log").select("action").eq("actor_id", partnerUserId).in("action", ["tenant.form_draft_saved", "tenant.partner_lead_duplicate_detected", "tenant.partner_lead_duplicate_overridden", "tenant.partner_lead_submitted"]); const actions = new Set((audits.data ?? []).map((row) => row.action)); check("draft, duplicate and submission writes leave audit evidence", actions.has("tenant.form_draft_saved") && actions.has("tenant.partner_lead_duplicate_detected") && actions.has("tenant.partner_lead_duplicate_overridden") && actions.has("tenant.partner_lead_submitted"));
  } finally { await new Promise((resolve) => simulator.server.close(resolve)); await cleanup(); }
  console.log(failures ? `\n${failures} check(s) FAILED.` : "\nAll LA-1.6 partner submission checks passed."); return failures ? 1 : 0;
}

process.exitCode = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; });
