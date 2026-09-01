// LA-1.5 live verification. Uses an in-process HTTP vendor simulator and disposable fixtures.
// The simulator is HTTP only because it is never exposed outside this process; the admin registry
// still rejects non-HTTPS endpoints for real configuration.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const tenantId = randomUUID();
const ownerId = randomUUID();
const partnerId = randomUUID();
const partnerUserId = randomUUID();
const vendorIds = [];
let failures = 0;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; } };
const json = (body) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const partnerCookie = (token) => `insurvas_partner_session=${token}`;
const agentCookie = (token) => `insurvas_tenant_session=${token}`;
async function api(path, cookie, options = {}) { return fetch(`${BASE}${path}`, { ...options, headers: { cookie, ...(options.headers ?? {}) }, redirect: "manual" }); }
async function token(secret, userId, payload, expiry = "10m") { return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(expiry).sign(new TextEncoder().encode(secret)); }

function startVendorSimulator() {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
    let phone = "";
    try { phone = String(JSON.parse(body).phone ?? ""); } catch { /* malformed input is handled by the adapter */ }
    const path = request.url ?? "";
    response.setHeader("content-type", "application/json");
    if (path.includes("litigator-primary")) { response.statusCode = 503; response.end(JSON.stringify({ error: "primary unavailable" })); return; }
    if (path.includes("litigator-down-secondary")) { response.statusCode = 503; response.end(JSON.stringify({ error: "secondary unavailable" })); return; }
    if (path.includes("litigator-secondary")) { response.statusCode = 200; response.end(JSON.stringify({ hit: phone.endsWith("0001") })); return; }
    if (path.includes("dnc-primary")) { response.statusCode = 200; response.end(JSON.stringify({ listed: true })); return; }
    response.statusCode = 404; response.end(JSON.stringify({ error: "unknown simulator route" }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port })));
}

async function cleanup() {
  await db.from("screening_audit").delete().eq("tenant_id", tenantId);
  await db.from("screening_cache_locks").delete().eq("tenant_id", tenantId);
  await db.from("screening_results").delete().eq("tenant_id", tenantId);
  await db.from("usage_events").delete().eq("tenant_id", tenantId);
  await db.from("usage_totals").delete().eq("tenant_id", tenantId);
  const leads = await db.from("agent_leads").select("id").eq("tenant_id", tenantId);
  const leadIds = (leads.data ?? []).map((row) => row.id);
  if (leadIds.length) {
    await db.from("intake_alerts").delete().eq("tenant_id", tenantId);
    await db.from("intake_failures").delete().in("lead_id", leadIds);
    await db.from("lead_notifications").delete().in("lead_id", leadIds);
    await db.from("lead_queue").delete().in("lead_id", leadIds);
    await db.from("deal_flow").delete().in("lead_id", leadIds);
  }
  await db.from("agent_leads").delete().eq("tenant_id", tenantId);
  await db.from("partner_products").delete().eq("partner_id", partnerId);
  await db.from("partner_users").delete().eq("partner_id", partnerId);
  await db.from("partners").delete().eq("id", partnerId);
  await db.from("tenant_products").delete().eq("tenant_id", tenantId);
  await db.from("tenant_templates").delete().eq("tenant_id", tenantId);
  await db.from("tenant_entitlements").delete().eq("tenant_id", tenantId);
  await db.from("subscriptions").delete().eq("tenant_id", tenantId);
  await db.from("tenant_users").delete().eq("tenant_id", tenantId);
  await db.from("users").delete().in("id", [ownerId, partnerUserId]);
  await db.from("tenants").delete().eq("id", tenantId);
  if (vendorIds.length) await db.from("compliance_vendors").delete().in("id", vendorIds);
}

function valuesFor(template, phone) {
  const output = {};
  const required = new Set(template.form_definition.sections.flatMap((section) => section.fields.filter((field) => field.is_required).map((field) => field.field_key)));
  for (const field of template.fields) {
    if (!field.is_required && !required.has(field.field_key)) continue;
    output[field.field_key] = field.type === "number" || field.type === "currency" ? 1 : field.type === "date" ? "1990-01-01" : field.type === "phone" ? phone : field.type === "email" ? "qa@example.com" : field.type === "boolean" ? true : field.type === "single_select" ? field.options[0] ?? "AZ" : field.type === "multi_select" ? [field.options[0] ?? "QA"] : "QA value";
  }
  return output;
}

async function main() {
  const probes = await Promise.all(["screening_results", "screening_audit", "screening_cache_locks"].map((table) => db.from(table).select("*").limit(0)));
  if (probes.some((probe) => probe.error)) { console.log("NOT TESTABLE YET — apply 20260902160000_la_1_5_screening_service.sql first."); return 2; }
  await cleanup();
  const simulator = await startVendorSimulator();
  try {
    const tenant = await db.from("tenants").insert({ id: tenantId, name: `LA-1.5 QA ${stamp}`, status: "active", onboarding_state: "completed" }); if (tenant.error) throw new Error(tenant.error.message);
    const users = await db.from("users").insert([{ id: ownerId, email: `la15-owner-${stamp}@invalid.test`, name: "LA-1.5 owner", password_hash: "verification-only", status: "active" }, { id: partnerUserId, email: `la15-partner-${stamp}@invalid.test`, name: "LA-1.5 partner", password_hash: "verification-only", status: "active" }]); if (users.error) throw new Error(users.error.message);
    const member = await db.from("tenant_users").insert({ tenant_id: tenantId, user_id: ownerId, role: "owner" }); if (member.error) throw new Error(member.error.message);
    const plan = await db.from("plans").select("id").eq("code", "advance").eq("version", 1).single(); if (plan.error) throw new Error(plan.error.message);
    const sub = await db.rpc("admin_assign_subscription", { p_tenant_id: tenantId, p_plan_id: plan.data.id, p_billing_cycle: "monthly", p_start: new Date().toISOString() }); if (sub.error) throw new Error(sub.error.message);
    const entitlement = await db.rpc("refresh_tenant_entitlement", { p_tenant_id: tenantId }); if (entitlement.error) throw new Error(entitlement.error.message);
    const serverBase = `http://127.0.0.1:${simulator.port}`;
    const vendors = await db.from("compliance_vendors").insert([
      { name: `LA15 litigator primary ${stamp}`, vendor_type: "litigator_scrub", endpoint: `${serverBase}/litigator-primary`, is_enabled: true, priority: 1, cost_per_lookup_cents: 1 },
      { name: `LA15 litigator secondary ${stamp}`, vendor_type: "litigator_scrub", endpoint: `${serverBase}/litigator-secondary`, is_enabled: true, priority: 2, cost_per_lookup_cents: 1 },
      { name: `LA15 dnc primary ${stamp}`, vendor_type: "dnc_scrub", endpoint: `${serverBase}/dnc-primary`, is_enabled: true, priority: 1, cost_per_lookup_cents: 1 },
    ]).select("id"); if (vendors.error) throw new Error(vendors.error.message); vendorIds.push(...(vendors.data ?? []).map((row) => row.id));
    const partner = await db.from("partners").insert({ id: partnerId, tenant_id: tenantId, name: `LA15 partner ${stamp}`, partner_type: "publisher", status: "active" }); if (partner.error) throw new Error(partner.error.message);
    const partnerMember = await db.from("partner_users").insert({ id: randomUUID(), tenant_id: tenantId, partner_id: partnerId, user_id: partnerUserId, role: "partner_user", status: "active", accepted_at: new Date().toISOString() }); if (partnerMember.error) throw new Error(partnerMember.error.message);
    const product = await db.from("tenant_products").upsert({ tenant_id: tenantId, product_code: "term_life", is_enabled: true }); if (product.error) throw new Error(product.error.message);
    const approval = await db.from("partner_products").insert({ partner_id: partnerId, product_code: "term_life" }); if (approval.error) throw new Error(approval.error.message);
    const agentSecret = process.env.TENANT_SESSION_SECRET;
    if (!agentSecret) throw new Error("TENANT_SESSION_SECRET is required for live screening verification");
    const owner = agentCookie(await token(agentSecret, ownerId, { tenantId }));
    const provisioned = await api("/api/app/templates", owner);
    if (provisioned.status !== 200) throw new Error(`Could not provision the disposable tenant form (HTTP ${provisioned.status})`);
    const partnerSecret = process.env.PARTNER_SESSION_SECRET ?? `insurvas-partner:${process.env.TENANT_SESSION_SECRET}`;
    const portal = partnerCookie(await token(partnerSecret, partnerUserId, { tenantId, partnerId }));
    const expired = partnerCookie(await token(partnerSecret, partnerUserId, { tenantId, partnerId }, "-1s"));
    const forged = partnerCookie(await token(`${partnerSecret}-wrong`, partnerUserId, { tenantId, partnerId }));
    check("missing, expired and forged partner sessions are rejected", (await api("/api/partner/me", "")).status === 401 && (await api("/api/partner/me", expired)).status === 401 && (await api("/api/partner/me", forged)).status === 401);
    const formResponse = await api("/api/partner/forms/term_life", portal); const formBody = await formResponse.json(); const form = formBody?.template?.template; check("the form contains a required phone field", formResponse.status === 200 && form?.fields?.some((field) => field.field_key === "phone" && field.type === "phone" && field.is_required));
    if (!form) throw new Error(`Could not load the disposable partner form (HTTP ${formResponse.status})`);
    const template = form;
    const invalidBefore = await db.from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    const invalid = await api("/api/partner/leads", portal, { method: "POST", ...json({ product_code: "term_life", submission_id: randomUUID(), values: valuesFor(template, "<script>alert(1)</script>") }) }); const invalidBody = await invalid.json();
    const invalidAudit = await db.from("screening_audit").select("outcome, raw_response").eq("tenant_id", tenantId).eq("outcome", "invalid_phone"); const invalidAfter = await db.from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    check("hostile or invalid phone is blocked, audited, and writes no lead", invalid.status === 422 && invalidBody.code === "invalid_phone" && invalidAfter.count === invalidBefore.count && invalidAudit.data?.length === 1);
    const dncValues = valuesFor(template, "6025550101"); const submissionId = randomUUID();
    const submitted = await api("/api/partner/leads", portal, { method: "POST", ...json({ product_code: "term_life", submission_id: submissionId, values: dncValues }) }); const submittedBody = await submitted.json();
    const lead = submittedBody.lead; const usage = await db.from("usage_events").select("meter_key, idempotency_key").eq("tenant_id", tenantId); const result = await db.from("screening_results").select("outcome, phone_digits, version").eq("tenant_id", tenantId).eq("phone_digits", "6025550101").single(); const audit = await db.from("screening_audit").select("outcome, raw_response, cached").eq("tenant_id", tenantId).eq("phone_digits", "6025550101");
    check("DNC warning allows submission, is persisted, and is visible on the returned lead", submitted.status === 201 && lead?.screening_outcome === "dnc" && lead?.screening_warning?.includes("DNC") && result.data?.outcome === "dnc" && audit.data?.some((row) => row.raw_response?.dnc?.listed === true) && usage.data?.length === 2);
    const providerCalls = await db.from("provider_calls").select("method, provider, status").eq("tenant_id", tenantId); check("primary vendor failure falls back to secondary and is logged", providerCalls.data?.some((row) => row.method === "fallback") && providerCalls.data?.some((row) => row.provider.includes(vendorIds[1]) && row.status === "ok"));
    const secondaryVendor = await db.from("compliance_vendors").select("endpoint").eq("id", vendorIds[1]).single();
    await db.from("compliance_vendors").update({ endpoint: `${serverBase}/litigator-down-secondary` }).eq("id", vendorIds[1]);
    const unavailableBefore = await db.from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    const unavailable = await api("/api/partner/leads", portal, { method: "POST", ...json({ product_code: "term_life", submission_id: randomUUID(), values: valuesFor(template, "6025550002") }) }); const unavailableBody = await unavailable.json(); const unavailableAfter = await db.from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId); const unavailableAudit = await db.from("screening_audit").select("outcome").eq("tenant_id", tenantId).eq("phone_digits", "6025550002").eq("outcome", "unavailable");
    check("both screening vendors unavailable fails closed and creates no lead", unavailable.status === 503 && unavailableBody.code === "unavailable" && unavailableBody.error === "Screening could not be completed. Do not treat this number as safe." && unavailableAfter.count === unavailableBefore.count && unavailableAudit.data?.length === 1);
    await db.from("compliance_vendors").update({ endpoint: secondaryVendor.data?.endpoint ?? `${serverBase}/litigator-secondary` }).eq("id", vendorIds[1]);
    const replayUsageBefore = await db.from("usage_events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    const replay = await api("/api/partner/leads", portal, { method: "POST", ...json({ product_code: "term_life", submission_id: submissionId, values: dncValues }) }); const replayBody = await replay.json(); const replayUsage = await db.from("usage_events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId); const replayResult = await db.from("screening_results").select("id").eq("tenant_id", tenantId).eq("phone_digits", "6025550101");
    check("same number and submission within TTL replays without another vendor call or credit", replay.status === 200 && replayBody.replayed === true && replayUsage.count === replayUsageBefore.count && replayResult.data?.length === 1);
    const tcpaValues = valuesFor(template, "6025550001"); const beforeTcpa = await db.from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId); const tcpa = await api("/api/partner/leads", portal, { method: "POST", ...json({ product_code: "term_life", submission_id: randomUUID(), values: tcpaValues }) }); const tcpaBody = await tcpa.json(); const afterTcpa = await db.from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId); const tcpaResult = await db.from("screening_results").select("outcome, raw_response").eq("tenant_id", tenantId).eq("phone_digits", "6025550001").single();
    check("TCPA litigator hit takes precedence over DNC and creates no lead", tcpa.status === 422 && tcpaBody.code === "tcpa_litigator" && afterTcpa.count === beforeTcpa.count && tcpaResult.data?.outcome === "tcpa_litigator" && tcpaResult.data.raw_response?.litigator?.hit === true);
    const concurrentPhone = "6025550102"; const concurrentValues = valuesFor(template, concurrentPhone); const concurrent = await Promise.all([randomUUID(), randomUUID()].map((submission) => api("/api/partner/leads", portal, { method: "POST", ...json({ product_code: "term_life", submission_id: submission, values: concurrentValues }) }))); const concurrentResults = await db.from("screening_results").select("id").eq("tenant_id", tenantId).eq("phone_digits", concurrentPhone); const concurrentCalls = await db.from("provider_calls").select("id").eq("tenant_id", tenantId).eq("method", "dnc_scrub").eq("request->>phone", "••••0102"); check("two simultaneous checks share one cold-cache provider pass", concurrent.every((response) => response.status === 201 || response.status === 200) && concurrentResults.data?.length === 1 && concurrentCalls.data?.length === 1);
  } finally { await new Promise((resolve) => simulator.server.close(resolve)); await cleanup(); }
  console.log(failures ? `\n${failures} check(s) FAILED.` : "\nAll LA-1.5 screening checks passed."); return failures ? 1 : 0;
}

process.exitCode = await main().catch(async (error) => { console.error(error); await simulatorCleanup(); return 1; });

async function simulatorCleanup() { await cleanup(); }
