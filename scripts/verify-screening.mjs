import "./lib/refuseProduction.mjs";
// LA-1.5 live verification. Uses an in-process HTTP vendor simulator and disposable fixtures.
// The simulator is HTTP only because it is never exposed outside this process; the admin registry
// still rejects non-HTTPS endpoints for real configuration.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";
import { createFixtureMarket, createFixtureUser, deleteFixtureUser, deleteLa1FixtureTenant } from "./lib/fixtureUser.mjs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const SUITE_SCRIPT = "verify:screening";

// Precondition. This suite proves FAIL-CLOSED screening, and `DEMO_SCREENING_MODE` short-circuits the
// provider so a missing or unreachable one answers cheerfully instead of refusing. Run against a
// demo-mode server the suite fails on an assertion that reads like a compliance defect and is not
// one — which is exactly what happened in the 2026-09-18 `verify:all` run, where this counted as one
// of ten failures for an environment reason nobody could see from the output.
//
// Said here, once, instead of left for whoever reads the assertion.
if (/^(1|true|yes|on)$/i.test(process.env.DEMO_SCREENING_MODE ?? "")) {
  console.error([
    "PRECONDITION NOT MET — this suite cannot prove fail-closed screening while DEMO_SCREENING_MODE is on.",
    "Start a server with it disabled and point the suite at that:",
    "  PORT=3110 DEMO_SCREENING_MODE=false npm start",
    `  APP_BASE_URL=http://localhost:3110 npm run ${SUITE_SCRIPT}`,
  ].join("\n"));
  process.exit(1);
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const tenantId = randomUUID();
let ownerId = null;
const partnerId = randomUUID();
let partnerUserId = null;
const vendorIds = [];
const existingVendorStates = [];
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
    if (path.includes("litigator-invalid-secondary")) { response.statusCode = 200; response.end(JSON.stringify({ message: "provider did not return a typed decision" })); return; }
    if (path.includes("litigator-timeout-secondary")) { setTimeout(() => response.end(JSON.stringify({ hit: false })), 11_000); return; }
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
  await deleteLa1FixtureTenant(db, tenantId);
  for (const id of [ownerId, partnerUserId]) await deleteFixtureUser(db, id);
  if (vendorIds.length) await db.from("compliance_vendors").delete().in("id", vendorIds);
}

async function restoreExistingVendorStates() {
  for (const vendor of existingVendorStates) {
    await db.from("compliance_vendors").update({ is_enabled: vendor.is_enabled }).eq("id", vendor.id);
  }
  existingVendorStates.length = 0;
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
    ({ userId: ownerId } = await createFixtureUser(db, { email: `la15-owner-${stamp}@invalid.test`, name: "LA-1.5 owner" }));
  ({ userId: partnerUserId } = await createFixtureUser(db, { email: `la15-partner-${stamp}@invalid.test`, name: "LA-1.5 partner" }));
    const member = await db.from("tenant_users").insert({ tenant_id: tenantId, user_id: ownerId, role: "owner" }); if (member.error) throw new Error(member.error.message);
    const plan = await db.from("plans").select("id").eq("code", "advance").eq("version", 1).single(); if (plan.error) throw new Error(plan.error.message);
    const sub = await db.rpc("admin_assign_subscription", { p_tenant_id: tenantId, p_plan_id: plan.data.id, p_billing_cycle: "monthly", p_start: new Date().toISOString() }); if (sub.error) throw new Error(sub.error.message);
    const entitlement = await db.rpc("refresh_tenant_entitlement", { p_tenant_id: tenantId }); if (entitlement.error) throw new Error(entitlement.error.message);
    const serverBase = `http://127.0.0.1:${simulator.port}`;
    const existingVendors = await db.from("compliance_vendors").select("id, is_enabled").in("vendor_type", ["litigator_scrub", "dnc_scrub"]);
    if (existingVendors.error) throw new Error(existingVendors.error.message);
    existingVendorStates.push(...(existingVendors.data ?? []));
    if (existingVendorStates.length) {
      const disabled = await db.from("compliance_vendors").update({ is_enabled: false }).in("id", existingVendorStates.map((vendor) => vendor.id));
      if (disabled.error) throw new Error(disabled.error.message);
    }
    const vendors = await db.from("compliance_vendors").insert([
      { name: `LA15 litigator primary ${stamp}`, vendor_type: "litigator_scrub", endpoint: `${serverBase}/litigator-primary`, is_enabled: true, priority: 1, cost_per_lookup_cents: 1 },
      { name: `LA15 litigator secondary ${stamp}`, vendor_type: "litigator_scrub", endpoint: `${serverBase}/litigator-secondary`, is_enabled: true, priority: 2, cost_per_lookup_cents: 1 },
      { name: `LA15 dnc primary ${stamp}`, vendor_type: "dnc_scrub", endpoint: `${serverBase}/dnc-primary`, is_enabled: true, priority: 1, cost_per_lookup_cents: 1 },
    ]).select("id, vendor_type, endpoint, priority"); if (vendors.error) throw new Error(vendors.error.message); vendorIds.push(...(vendors.data ?? []).map((row) => row.id));
    const litigatorSecondaryId = vendors.data?.find((row) => row.vendor_type === "litigator_scrub" && row.priority === 2)?.id;
    const dncPrimaryId = vendors.data?.find((row) => row.vendor_type === "dnc_scrub" && row.priority === 1)?.id;
    if (!litigatorSecondaryId || !dncPrimaryId) throw new Error("Disposable screening vendors were not returned with their expected types and priorities");
    const partner = await db.from("partners").insert({ slug: `fx-${Math.random().toString(36).slice(2, 10)}`, id: partnerId, tenant_id: tenantId, name: `LA15 partner ${stamp}`, partner_type: "publisher", status: "active" }); if (partner.error) throw new Error(partner.error.message);
    const partnerMember = await db.from("partner_users").insert({ id: randomUUID(), tenant_id: tenantId, partner_id: partnerId, user_id: partnerUserId, role: "partner_user", status: "active", accepted_at: new Date().toISOString() }); if (partnerMember.error) throw new Error(partnerMember.error.message);
    const product = await db.from("tenant_products").upsert({ tenant_id: tenantId, product_code: "term_life", is_enabled: true }); if (product.error) throw new Error(product.error.message);
    const approval = await db.from("partner_products").insert({ partner_id: partnerId, product_code: "term_life", name: "term_life", product_line: "term_life" }); if (approval.error) throw new Error(approval.error.message);
    const market = await createFixtureMarket(db, tenantId); const marketPayload = { carrier_id: market.carrierId, carrier_state: market.state };
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
    check("agent and partner sessions cannot cross authentication planes", (await api("/api/partner/me", owner)).status === 401 && (await api("/api/app/me", portal)).status === 401);
    const formResponse = await api("/api/partner/forms/term_life", portal); const formBody = await formResponse.json(); const form = formBody?.template?.template; check("the form contains a required phone field", formResponse.status === 200 && form?.fields?.some((field) => field.field_key === "phone" && field.type === "phone" && field.is_required));
    if (!form) throw new Error(`Could not load the disposable partner form (HTTP ${formResponse.status})`);
    const template = form;
    const invalidBefore = await db.from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    const invalid = await api("/api/partner/leads", portal, { method: "POST", ...json({ consent_attested: true, product_code: "term_life", ...marketPayload, submission_id: randomUUID(), values: valuesFor(template, "<script>alert(1)</script>") }) }); const invalidBody = await invalid.json();
    const invalidAudit = await db.from("screening_audit").select("outcome, raw_response").eq("tenant_id", tenantId).eq("outcome", "invalid_phone"); const invalidAfter = await db.from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    check("hostile or invalid phone is blocked, audited, and writes no lead", invalid.status === 422 && invalidBody.code === "invalid_phone" && invalidAfter.count === invalidBefore.count && invalidAudit.data?.length === 1);
    const dncValues = valuesFor(template, "6025550101"); const submissionId = randomUUID();
    const submitted = await api("/api/partner/leads", portal, { method: "POST", ...json({ consent_attested: true, product_code: "term_life", ...marketPayload, submission_id: submissionId, screening_warning_acknowledged: true, values: dncValues }) }); const submittedBody = await submitted.json();
    const lead = submittedBody.lead; const usage = await db.from("usage_events").select("meter_key, idempotency_key").eq("tenant_id", tenantId); const result = await db.from("screening_results").select("outcome, phone_digits, version").eq("tenant_id", tenantId).eq("phone_digits", "6025550101").single(); const audit = await db.from("screening_audit").select("outcome, raw_response, cached").eq("tenant_id", tenantId).eq("phone_digits", "6025550101");
    check("DNC warning allows submission, is persisted, and is visible on the returned lead", submitted.status === 201 && lead?.screening_outcome === "dnc" && lead?.screening_warning?.includes("DNC") && result.data?.outcome === "dnc" && audit.data?.some((row) => row.raw_response?.dnc?.listed === true) && usage.data?.length === 2);
    const providerCalls = await db.from("provider_calls").select("method, provider, status").eq("tenant_id", tenantId); check("primary vendor failure falls back to secondary and is logged", providerCalls.data?.some((row) => row.method === "fallback") && providerCalls.data?.some((row) => row.provider.includes(litigatorSecondaryId) && row.status === "ok"));
    const secondaryVendor = await db.from("compliance_vendors").select("endpoint").eq("id", litigatorSecondaryId).single();
    const secondaryUpdate = await db.from("compliance_vendors").update({ endpoint: `${serverBase}/litigator-down-secondary` }).eq("id", litigatorSecondaryId); if (secondaryUpdate.error) throw new Error(`Could not update disposable secondary vendor: ${secondaryUpdate.error.message}`);
    const unavailableBefore = await db.from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    const unavailable = await api("/api/partner/leads", portal, { method: "POST", ...json({ consent_attested: true, product_code: "term_life", ...marketPayload, submission_id: randomUUID(), values: valuesFor(template, "6025550002") }) }); const unavailableBody = await unavailable.json(); const unavailableAfter = await db.from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId); const unavailableAudit = await db.from("screening_audit").select("outcome").eq("tenant_id", tenantId).eq("phone_digits", "6025550002").eq("outcome", "unavailable");
    const unavailableProviders = await db.from("provider_calls").select("provider, method, status, response").eq("tenant_id", tenantId).eq("method", "litigator_scrub"); check("both screening vendors unavailable fails closed and creates no lead", unavailable.status === 503 && unavailableBody.code === "unavailable" && unavailableBody.error === "Screening could not be completed. Do not treat this number as safe." && unavailableAfter.count === unavailableBefore.count && unavailableAudit.data?.length === 1, JSON.stringify({ status: unavailable.status, body: unavailableBody, before: unavailableBefore.count, after: unavailableAfter.count, audit: unavailableAudit.data, auditError: unavailableAudit.error?.message, providers: unavailableProviders.data, providerError: unavailableProviders.error?.message }));
    await db.from("compliance_vendors").update({ endpoint: secondaryVendor.data?.endpoint ?? `${serverBase}/litigator-secondary` }).eq("id", litigatorSecondaryId);
    const replayUsageBefore = await db.from("usage_events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
    const replay = await api("/api/partner/leads", portal, { method: "POST", ...json({ consent_attested: true, product_code: "term_life", ...marketPayload, submission_id: submissionId, screening_warning_acknowledged: true, values: dncValues }) }); const replayBody = await replay.json(); const replayUsage = await db.from("usage_events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId); const replayResult = await db.from("screening_results").select("id").eq("tenant_id", tenantId).eq("phone_digits", "6025550101");
    check("same number and submission within TTL replays without another vendor call or credit", replay.status === 200 && replayBody.replayed === true && replayUsage.count === replayUsageBefore.count && replayResult.data?.length === 1);
    const timeoutUpdate = await db.from("compliance_vendors").update({ endpoint: `${serverBase}/litigator-timeout-secondary` }).eq("id", litigatorSecondaryId); if (timeoutUpdate.error) throw new Error(`Could not configure timeout simulator: ${timeoutUpdate.error.message}`);
    const timeout = await api("/api/partner/leads", portal, { method: "POST", ...json({ consent_attested: true, product_code: "term_life", ...marketPayload, submission_id: randomUUID(), values: valuesFor(template, "6025550003") }) }); const timeoutBody = await timeout.json(); const timeoutCall = await db.from("provider_calls").select("status, response").eq("tenant_id", tenantId).eq("provider", `compliance_vendor:${litigatorSecondaryId}`).eq("method", "litigator_scrub").eq("status", "timeout");
    check("provider timeout fails closed and is classified", timeout.status === 503 && timeoutBody.code === "unavailable" && timeoutCall.data?.length === 1);
    const invalidProviderUpdate = await db.from("compliance_vendors").update({ endpoint: `${serverBase}/litigator-invalid-secondary` }).eq("id", litigatorSecondaryId); if (invalidProviderUpdate.error) throw new Error(`Could not configure invalid-response simulator: ${invalidProviderUpdate.error.message}`);
    const invalidProvider = await api("/api/partner/leads", portal, { method: "POST", ...json({ consent_attested: true, product_code: "term_life", ...marketPayload, submission_id: randomUUID(), values: valuesFor(template, "6025550004") }) }); const invalidProviderBody = await invalidProvider.json(); const invalidProviderCall = await db.from("provider_calls").select("status, response").eq("tenant_id", tenantId).eq("provider", `compliance_vendor:${litigatorSecondaryId}`).eq("method", "litigator_scrub").eq("status", "error");
    check("malformed provider response fails closed and is classified", invalidProvider.status === 503 && invalidProviderBody.code === "unavailable" && invalidProviderCall.data?.length >= 1);
    await db.from("compliance_vendors").update({ endpoint: secondaryVendor.data?.endpoint ?? `${serverBase}/litigator-secondary` }).eq("id", litigatorSecondaryId);
    const recovered = await api("/api/partner/leads", portal, { method: "POST", ...json({ consent_attested: true, product_code: "term_life", ...marketPayload, submission_id: randomUUID(), screening_warning_acknowledged: true, values: valuesFor(template, "6025550005") }) }); const recoveredBody = await recovered.json();
    check("provider recovery permits a newly screened submission", recovered.status === 201 && recoveredBody.lead?.screening_outcome === "dnc");
    const tcpaValues = valuesFor(template, "6025550001"); const beforeTcpa = await db.from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId); const tcpa = await api("/api/partner/leads", portal, { method: "POST", ...json({ consent_attested: true, product_code: "term_life", ...marketPayload, submission_id: randomUUID(), values: tcpaValues }) }); const tcpaBody = await tcpa.json(); const afterTcpa = await db.from("agent_leads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId); const tcpaResult = await db.from("screening_results").select("outcome, raw_response").eq("tenant_id", tenantId).eq("phone_digits", "6025550001").single();
    check("TCPA litigator hit takes precedence over DNC and creates no lead", tcpa.status === 422 && tcpaBody.code === "tcpa_block" && afterTcpa.count === beforeTcpa.count && tcpaResult.data?.outcome === "tcpa_litigator" && tcpaResult.data.raw_response?.litigator?.hit === true);
      const concurrentPhone = "6025550102"; const concurrentValues = valuesFor(template, concurrentPhone); const concurrent = await Promise.all([randomUUID(), randomUUID()].map((submission) => api("/api/partner/leads", portal, { method: "POST", ...json({ consent_attested: true, product_code: "term_life", ...marketPayload, submission_id: submission, screening_warning_acknowledged: true, values: concurrentValues }) }))); const concurrentBodies = await Promise.all(concurrent.map((response) => response.clone().json().catch(() => null))); const concurrentResults = await db.from("screening_results").select("id").eq("tenant_id", tenantId).eq("phone_digits", concurrentPhone); const concurrentCalls = await db.from("provider_calls").select("id, provider, status").eq("tenant_id", tenantId).eq("method", "dnc_scrub").eq("provider", `compliance_vendor:${dncPrimaryId}`).eq("request->>phone", "••••0102"); const concurrentAudit = await db.from("screening_audit").select("id, outcome, cached").eq("tenant_id", tenantId).eq("phone_digits", concurrentPhone); check("two simultaneous checks share one cold-cache provider pass", concurrent.every((response) => response.status === 201 || response.status === 200 || response.status === 409) && concurrentResults.data?.length === 1 && concurrentCalls.data?.length === 1, JSON.stringify({ statuses: concurrent.map((response) => response.status), bodies: concurrentBodies, resultCount: concurrentResults.data?.length, providerCalls: concurrentCalls.data, audit: concurrentAudit.data, resultError: concurrentResults.error?.message, callsError: concurrentCalls.error?.message }));
  } finally { await new Promise((resolve) => simulator.server.close(resolve)); await cleanup(); await restoreExistingVendorStates(); }
  console.log(failures ? `\n${failures} check(s) FAILED.` : "\nAll LA-1.5 screening checks passed."); return failures ? 1 : 0;
}

process.exitCode = await main().catch(async (error) => { console.error(error); await simulatorCleanup(); await restoreExistingVendorStates(); return 1; });

async function simulatorCleanup() { await cleanup(); }
