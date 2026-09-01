// LA-0.4 live contract checks. Run with: npm run verify:carrier-library
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
let failures = 0;
const tenantId = randomUUID();
const userId = randomUUID();
let carrierId = null;
let qaCarrierId = null;
const createdIds = { tenantCarriers: [], schedules: [], rules: [] };
const temporaryAdmins = [];

function check(label, condition, detail = "") { if (condition) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; } }

async function token() { return new SignJWT({ tenantId }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET)); }
async function adminCookie(role) {
  const { data } = await supabase.from("admin_users").select("id").eq("role", role).eq("is_active", true).limit(1).maybeSingle();
  let admin = data;
  if (!admin) {
    const inserted = await supabase.from("admin_users").insert({ email: `la04-${role}-${stamp}@invalid.test`, name: `LA-0.4 ${role}`, role, password_hash: "verification-only", totp_secret: "verification-only", is_active: true }).select("id").single();
    if (inserted.error) throw new Error(`Could not create ${role} fixture: ${inserted.error.message}`);
    admin = inserted.data; temporaryAdmins.push(admin.id);
  }
  const signed = await new SignJWT({ role, stage: "authenticated" }).setProtectedHeader({ alg: "HS256" }).setSubject(admin.id).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(process.env.ADMIN_SESSION_SECRET));
  return `insurvas_admin_session=${signed}`;
}
async function api(path, cookie, options = {}) { return fetch(`${BASE}${path}`, { ...options, headers: { cookie, ...(options.headers ?? {}) } }); }
function json(body) { return { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }; }

async function cleanup() {
  await supabase.from("advance_rules").delete().eq("tenant_id", tenantId);
  await supabase.from("commission_schedules").delete().eq("tenant_id", tenantId);
  await supabase.from("tenant_carriers").delete().eq("tenant_id", tenantId);
  await supabase.from("tenant_entitlements").delete().eq("tenant_id", tenantId);
  await supabase.from("tenant_users").delete().eq("tenant_id", tenantId);
  await supabase.from("users").delete().eq("id", userId);
  await supabase.from("tenants").delete().eq("id", tenantId);
  if (qaCarrierId) await supabase.from("carriers").delete().eq("id", qaCarrierId);
  for (const id of temporaryAdmins) await supabase.from("admin_users").delete().eq("id", id);
}

async function main() {
  const [{ data: carrier }, { data: product }] = await Promise.all([
    supabase.from("carriers").select("id").eq("is_active", true).limit(1).single(),
    supabase.from("products").select("code").eq("is_active", true).eq("code", "final_expense").single(),
  ]);
  if (!carrier || !product) throw new Error("Seed carrier/product missing");
  carrierId = carrier.id;
  await supabase.from("tenants").insert({ id: tenantId, name: `LA-0.4 verification ${stamp}`, status: "active", onboarding_state: "completed" });
  await supabase.from("users").insert({ id: userId, email: `la04-${stamp}@invalid.test`, name: "LA-0.4 verification", password_hash: "verification-only", status: "active" });
  await supabase.from("tenant_users").insert({ tenant_id: tenantId, user_id: userId, role: "owner" });
  await supabase.from("tenant_entitlements").insert({ tenant_id: tenantId, entitlement: { tenant_id: tenantId, plan_code: "qa", plan_version: 1, status: "active", access: "full", computed_at: new Date().toISOString(), features: ["appointment_vault"], meters: {}, limits: { max_seats: 1 } } });
  const cookie = `insurvas_tenant_session=${await token()}`;
  const admin = await adminCookie("super_admin");

  try {
    const createCarrier = await api("/api/admin/carriers", admin, { method: "POST", ...json({ code: `qa_carrier_${stamp}`, name: "QA Carrier", sort_order: 999 }) });
    const createdBody = await createCarrier.json();
    qaCarrierId = createdBody.carrier?.id ?? null;
    check("platform carrier can be added without a deploy", createCarrier.status === 201 && Boolean(qaCarrierId), `status ${createCarrier.status}`);
    const carrierForTenant = qaCarrierId ?? carrierId;

    const missingContract = await api("/api/app/carrier-library/commission-schedules", cookie, { method: "POST", ...json({ carrier_id: carrierForTenant, product_code: product.code, contract_level_bp: 11000, policy_year: 1, rate_bp: 10000, effective_from: "2026-01-01" }) });
    check("schedule without a carrier contract is rejected", missingContract.status === 400, `status ${missingContract.status}`);

    const contract = await api("/api/app/carrier-library/tenant-carriers", cookie, { method: "POST", ...json({ carrier_id: carrierForTenant, contract_level_bp: 11000, writing_number: "QA-110", effective_from: "2026-01-01" }) });
    const contractBody = await contract.json();
    check("agent can save a carrier contract", contract.status === 201, `status ${contract.status}`);
    if (contractBody.tenantCarrier?.id) createdIds.tenantCarriers.push(contractBody.tenantCarrier.id);

    const simultaneous = await Promise.all([
      api("/api/app/carrier-library/tenant-carriers", cookie, { method: "POST", ...json({ carrier_id: carrierForTenant, contract_level_bp: 11000, writing_number: "QA-110-A", effective_from: "2026-01-01" }) }),
      api("/api/app/carrier-library/tenant-carriers", cookie, { method: "POST", ...json({ carrier_id: carrierForTenant, contract_level_bp: 11000, writing_number: "QA-110-B", effective_from: "2026-01-01" }) }),
    ]);
    check("two simultaneous same-date saves are handled atomically", simultaneous.every((response) => response.status === 201));

    const oldSchedule = await api("/api/app/carrier-library/commission-schedules", cookie, { method: "POST", ...json({ carrier_id: carrierForTenant, product_code: product.code, contract_level_bp: 11000, policy_year: 1, rate_bp: 10000, effective_from: "2026-01-01" }) });
    check("commission schedule saves in integer basis points", oldSchedule.status === 201, `status ${oldSchedule.status}`);
    const oldBody = await oldSchedule.json(); if (oldBody.commissionSchedule?.id) createdIds.schedules.push(oldBody.commissionSchedule.id);
    const levelChange = await api("/api/app/carrier-library/tenant-carriers", cookie, { method: "POST", ...json({ carrier_id: carrierForTenant, contract_level_bp: 11500, writing_number: "QA-115", effective_from: "2026-02-01" }) });
    check("changing the level creates a new effective-dated contract", levelChange.status === 201, `status ${levelChange.status}`);
    const levelBody = await levelChange.json(); if (levelBody.tenantCarrier?.id) createdIds.tenantCarriers.push(levelBody.tenantCarrier.id);
    const newSchedule = await api("/api/app/carrier-library/commission-schedules", cookie, { method: "POST", ...json({ carrier_id: carrierForTenant, product_code: product.code, contract_level_bp: 11500, policy_year: 1, rate_bp: 11500, effective_from: "2026-02-01" }) });
    check("a different contract level accepts a different correct rate", newSchedule.status === 201, `status ${newSchedule.status}`);
    const newBody = await newSchedule.json(); if (newBody.commissionSchedule?.id) createdIds.schedules.push(newBody.commissionSchedule.id);
    const rule = await api("/api/app/carrier-library/advance-rules", cookie, { method: "POST", ...json({ carrier_id: carrierForTenant, product_code: product.code, advance_months: 9, advance_pct_bp: 10000, clawback_months: 12, clawback_type: "full", effective_from: "2026-02-01" }) });
    check("advance rule saves with integer percentages and months", rule.status === 201, `status ${rule.status}`);
    const ruleBody = await rule.json(); if (ruleBody.advanceRule?.id) createdIds.rules.push(ruleBody.advanceRule.id);
    const snapshot = await api("/api/app/carrier-library", cookie);
    const snapshotBody = await snapshot.json();
    check("agent reads platform carriers and products from one library", snapshot.status === 200 && snapshotBody.carriers.length >= 1 && snapshotBody.products.some((row) => row.code === "final_expense"));

    const hostile = await api("/api/app/carrier-library/tenant-carriers", cookie, { method: "POST", ...json({ carrier_id: carrierForTenant, contract_level_bp: "<script>alert(1)</script>", writing_number: "<script>alert(1)</script>", effective_from: "not-a-date" }) });
    check("hostile and malformed input is rejected", hostile.status === 400, `status ${hostile.status}`);
    const support = await adminCookie("support_agent");
    const wrongRole = await api("/api/admin/carriers", support, { method: "POST", ...json({ code: `qa_denied_${stamp}`, name: "Denied", sort_order: 1 }) });
    check("wrong admin role is rejected server-side", wrongRole.status === 403, `status ${wrongRole.status}`);
    const expired = `insurvas_tenant_session=not-a-session`;
    const expiredResponse = await api("/api/app/carrier-library", expired);
    check("forged/expired tenant session is rejected", expiredResponse.status === 401, `status ${expiredResponse.status}`);
  } finally {
    await cleanup();
  }
  if (failures) return 1;
  console.log("\nAll live carrier-library checks passed.");
  return 0;
}

process.exitCode = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; });
