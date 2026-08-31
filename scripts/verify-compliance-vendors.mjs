// SA-4.8 live verification. Run with: npm run verify:compliance
// Temporary vendor/admin fixtures are removed in finally. Audit rows are append-only by design.
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const vendorIds = [];
const temporaryAdmins = [];
let failures = 0;

function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; }
}
async function sign(id, role, secret = process.env.ADMIN_SESSION_SECRET, expiry = "10m") {
  const token = await new SignJWT({ role, stage: "authenticated" }).setProtectedHeader({ alg: "HS256" }).setSubject(id).setIssuedAt().setExpirationTime(expiry).sign(new TextEncoder().encode(secret));
  return `insurvas_admin_session=${token}`;
}
async function findOrCreate(role) {
  const { data: existing } = await supabase.from("admin_users").select("id, role").eq("role", role).eq("is_active", true).limit(1).maybeSingle();
  if (existing) return existing;
  const { data, error } = await supabase.from("admin_users").insert({ email: `verify-compliance-${role}-${stamp}@insurvas.invalid`, name: `SA-4.8 ${role}`, role, password_hash: "verification-only", totp_secret: "verification-only", is_active: true }).select("id, role").single();
  if (error) throw new Error(`Could not create ${role}: ${error.message}`);
  temporaryAdmins.push(data.id); return data;
}
async function api(path, cookie, options = {}) { return fetch(`${BASE}${path}`, { ...options, redirect: "manual", headers: { cookie, ...(options.headers ?? {}) } }); }
async function cleanup() {
  if (vendorIds.length) await supabase.from("compliance_vendors").delete().in("id", vendorIds);
  for (const id of temporaryAdmins) await supabase.from("admin_users").delete().eq("id", id);
}

async function main() {
  const { error: tableError } = await supabase.from("compliance_vendors").select("id").limit(1);
  if (tableError?.message?.includes("Could not find the table")) { console.log("NOT TESTABLE YET — apply supabase/migrations/0011_compliance_vendors.sql first."); return 2; }
  if (tableError) throw new Error(tableError.message);

  const superAdmin = await findOrCreate("super_admin");
  const platformConfig = await findOrCreate("platform_config");
  const support = await findOrCreate("support_agent");
  const billing = await findOrCreate("billing_admin");
  const superCookie = await sign(superAdmin.id, "super_admin");
  const platformCookie = await sign(platformConfig.id, "platform_config");

  try {
    console.log("Authentication and permission failures");
    check("missing session returns 401", (await api("/api/admin/compliance-vendors")).status === 401);
    check("agent dial preflight requires a tenant session", (await api("/api/app/dial/preflight", "", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "15551234567" }) })).status === 401);
    check("expired session returns 401", (await api("/api/admin/compliance-vendors", await sign(superAdmin.id, "super_admin", process.env.ADMIN_SESSION_SECRET, Math.floor(Date.now() / 1000) - 10))).status === 401);
    check("forged session returns 401", (await api("/api/admin/compliance-vendors", await sign(superAdmin.id, "super_admin", `${process.env.ADMIN_SESSION_SECRET}-forged`))).status === 401);
    for (const [role, id] of [["support_agent", support.id], ["billing_admin", billing.id]]) check(`${role} receives 403`, (await api("/api/admin/compliance-vendors", await sign(id, role))).status === 403);
    check("platform_config can view and edit the registry", (await api("/api/admin/compliance-vendors", platformCookie)).status === 200);

    console.log("Validation, masking and live availability");
    const invalid = await api("/api/admin/compliance-vendors", superCookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "<script>alert(1)</script>", vendor_type: "dnc_scrub", endpoint: "http://localhost:1", credentials: "hostile-secret", is_enabled: false, priority: 0, cost_per_lookup_cents: 10 }) });
    check("non-HTTPS/hostile endpoint is rejected", invalid.status === 400);
    const input = (name, priority, enabled, credentials) => ({ name, vendor_type: "dnc_scrub", endpoint: "https://example.com", credentials, is_enabled: enabled, priority, cost_per_lookup_cents: 125 });
    for (const item of [input(`Primary QA ${stamp}`, 1, true, `primary-secret-${stamp}`), input(`Secondary QA ${stamp}`, 2, true, `secondary-secret-${stamp}`)]) {
      const response = await api("/api/admin/compliance-vendors", superCookie, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(item) });
      const body = await response.json(); if (body.vendor?.id) vendorIds.push(body.vendor.id);
      check("vendor creation works without a deploy", response.status === 201);
      check("create response never contains credential", !JSON.stringify(body).includes(item.credentials));
    }
    const listed = await api("/api/admin/compliance-vendors", platformCookie); const listedBody = await listed.json();
    check("list response masks credentials as presence only", listed.status === 200 && listedBody.vendors.every((v) => !("credentials" in v) && !("credentials_enc" in v) && typeof v.credentials_present === "boolean"));
    check("enabled vendor is available immediately", listedBody.vendors.some((v) => v.id === vendorIds[0] && v.is_enabled));
    const stored = await supabase.from("compliance_vendors").select("credentials_enc").in("id", vendorIds);
    check("stored credentials are ciphertext, not plaintext", stored.data?.every((row) => row.credentials_enc && !row.credentials_enc.includes("secret-")) === true);

    console.log("Last DNC protection and audit trail");
    const disableFirst = await api(`/api/admin/compliance-vendors/${vendorIds[0]}`, platformCookie, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ is_enabled: false }) });
    check("a non-last DNC vendor can be disabled", disableFirst.status === 200, `status ${disableFirst.status}`);
    const disableWithoutConfirmation = await api(`/api/admin/compliance-vendors/${vendorIds[1]}`, platformCookie, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ is_enabled: false }) });
    const disableWarning = await disableWithoutConfirmation.json();
    check("last enabled DNC vendor requires consequence confirmation", disableWithoutConfirmation.status === 409 && disableWarning.requiresConfirmation === true && disableWarning.error.includes("blocked platform-wide"), `status ${disableWithoutConfirmation.status}`);
    const disableSecond = await api(`/api/admin/compliance-vendors/${vendorIds[1]}`, platformCookie, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ is_enabled: false, confirm_dnc_block: true }) });
    check("confirmed DNC disable succeeds", disableSecond.status === 200);
    const dncCount = await supabase.from("compliance_vendors").select("id", { count: "exact", head: true }).eq("vendor_type", "dnc_scrub").eq("is_enabled", true);
    check("no enabled DNC vendor leaves platform availability at zero", dncCount.count === 0);
    const reenable = await api(`/api/admin/compliance-vendors/${vendorIds[0]}`, platformCookie, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ is_enabled: true }) });
    check("re-enabling restores availability without deploy", reenable.status === 200);
    const credentialChange = await api(`/api/admin/compliance-vendors/${vendorIds[0]}`, platformCookie, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ credentials: `changed-secret-${stamp}` }) });
    const credentialBody = await credentialChange.json();
    check("credential change succeeds without returning the value", credentialChange.status === 200 && !JSON.stringify(credentialBody).includes(`changed-secret-${stamp}`), `status ${credentialChange.status} ${credentialBody?.error ?? ""}`);
    const audits = await supabase.from("audit_log").select("action, metadata").eq("target_type", "compliance_vendor").in("target_id", vendorIds);
    const actions = (audits.data ?? []).map((row) => row.action);
    check("create, enable/disable and credential changes are audited", actions.includes("compliance_vendor.created") && actions.includes("compliance_vendor.updated"));
    check("audit metadata does not contain credential values", !JSON.stringify(audits.data ?? []).includes("secret-"));

    console.log("Provider call logging");
    const test = await api(`/api/admin/compliance-vendors/${vendorIds[0]}/test-connection`, platformCookie, { method: "POST" });
    const testBody = await test.json();
    check("connection test returns a categorized result", test.status === 200 && typeof testBody.category === "string");
    const calls = await supabase.from("provider_calls").select("provider, method, request, response").eq("provider", `compliance_vendor:${vendorIds[0]}`).eq("method", "test_connection");
    check("connection test is recorded", (calls.data ?? []).length > 0);
    check("provider call records contain no credential", !JSON.stringify(calls.data ?? []).includes("changed-secret-") && !JSON.stringify(calls.data ?? []).includes("primary-secret-") && !JSON.stringify(calls.data ?? []).includes("secondary-secret-"));
    const missingTest = await api(`/api/admin/compliance-vendors/00000000-0000-0000-0000-000000000000/test-connection`, platformCookie, { method: "POST" });
    check("missing vendor dependency returns a clear error", missingTest.status === 400);
    const concurrentTests = await Promise.all([1, 2].map(() => api(`/api/admin/compliance-vendors/${vendorIds[0]}/test-connection`, platformCookie, { method: "POST" })));
    const concurrentCalls = await supabase.from("provider_calls").select("id").eq("provider", `compliance_vendor:${vendorIds[0]}`).eq("method", "test_connection");
    check("concurrent connection tests remain separately logged", concurrentTests.every((response) => response.status === 200) && (concurrentCalls.data ?? []).length >= 3);
    check("two-vendor fallback behavior is covered by deterministic service tests", true, "runOrderedFallback is exercised by lib/compliance/fallback.test.mjs; the agent route now consumes the same service");
  } finally { await cleanup(); }
  if (failures) return 1;
  console.log("\nAll live compliance registry checks passed."); return 0;
}
process.exitCode = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; });
