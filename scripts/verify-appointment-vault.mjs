// LA-0.5 live contract checks. Run with: npm run verify:appointment-vault
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";
import { canWriteFromVault } from "../lib/appointments/eligibility.ts";
import { dueExpiryWarnings } from "../lib/appointments/warnings.ts";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const tenantId = randomUUID();
const ownerId = randomUUID();
const producerId = randomUUID();
let failures = 0;
let carrierId = null;

function check(label, condition, detail = "") { if (condition) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; } }
async function token(userId) { return new SignJWT({ tenantId }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET)); }
function cookie(value) { return `insurvas_tenant_session=${value}`; }
async function api(path, session, options = {}) { return fetch(`${BASE}${path}`, { ...options, headers: { cookie: session, ...(options.headers ?? {}) } }); }
function json(body) { return { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }; }

async function cleanup() {
  await supabase.from("audit_log").delete().eq("tenant_id", tenantId);
  await supabase.from("appointments").delete().eq("tenant_id", tenantId);
  await supabase.from("licenses").delete().eq("tenant_id", tenantId);
  await supabase.from("eo_policies").delete().eq("tenant_id", tenantId);
  await supabase.from("ce_records").delete().eq("tenant_id", tenantId);
  await supabase.from("tenant_carriers").delete().eq("tenant_id", tenantId);
  await supabase.from("tenant_entitlements").delete().eq("tenant_id", tenantId);
  await supabase.from("tenant_users").delete().eq("tenant_id", tenantId);
  await supabase.from("users").delete().in("id", [ownerId, producerId]);
  await supabase.from("tenants").delete().eq("id", tenantId);
}

async function main() {
  const { data: carrier } = await supabase.from("carriers").select("id").eq("is_active", true).limit(1).single();
  if (!carrier) throw new Error("Seed carrier missing");
  carrierId = carrier.id;
  const { error: tenantError } = await supabase.from("tenants").insert({ id: tenantId, name: `LA-0.5 verification ${stamp}`, status: "active", onboarding_state: "completed" });
  if (tenantError) throw new Error(tenantError.message);
  await supabase.from("users").insert([
    { id: ownerId, email: `la05-owner-${stamp}@invalid.test`, name: "LA-0.5 owner", password_hash: "verification-only", status: "active" },
    { id: producerId, email: `la05-producer-${stamp}@invalid.test`, name: "LA-0.5 producer", password_hash: "verification-only", status: "active" },
  ]);
  await supabase.from("tenant_users").insert([{ tenant_id: tenantId, user_id: ownerId, role: "owner" }, { tenant_id: tenantId, user_id: producerId, role: "producer" }]);
  await supabase.from("tenant_entitlements").insert({ tenant_id: tenantId, entitlement: { tenant_id: tenantId, plan_code: "qa", plan_version: 1, status: "active", access: "full", computed_at: new Date().toISOString(), features: ["appointment_vault", "book_of_business"], meters: {}, limits: { max_seats: 1 } } });
  const { error: contractError } = await supabase.from("tenant_carriers").insert({ tenant_id: tenantId, carrier_id: carrierId, contract_level_bp: 11000, writing_number: "LA05-QA", effective_from: "2025-01-01", is_active: true });
  if (contractError) throw new Error(contractError.message);

  const owner = cookie(await token(ownerId));
  const producer = cookie(await token(producerId));
  try {
    const empty = await api("/api/app/appointment-vault", owner);
    check("owner can read the tenant-scoped vault", empty.status === 200, `status ${empty.status}`);

    const states = ["AZ", "AL", "AK", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC"];
    const rows = states.map((state) => ({ carrier_id: carrierId, state, status: "active", effective_from: "2025-01-01", terminated_at: null }));
    const batch = await api("/api/app/appointment-vault/appointments", owner, { method: "POST", ...json({ appointments: rows }) });
    const batchBody = await batch.json();
    check("one bulk request captures forty appointments", batch.status === 201 && batchBody.appointments?.length === 40, `status ${batch.status}, body ${JSON.stringify(batchBody)}`);

    const simultaneous = await Promise.all([
      api("/api/app/appointment-vault/appointments", owner, { method: "POST", ...json({ appointments: [rows[0]] }) }),
      api("/api/app/appointment-vault/appointments", owner, { method: "POST", ...json({ appointments: [rows[0]] }) }),
    ]);
    const { count: duplicateCount } = await supabase.from("appointments").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("state", "AZ").eq("effective_from", "2025-01-01");
    check("repeated and concurrent bulk saves are idempotent", simultaneous.every((response) => response.status === 201) && duplicateCount === 1);

    const terminated = await api("/api/app/appointment-vault/appointments", owner, { method: "POST", ...json({ appointments: [{ ...rows[0], status: "terminated", terminated_at: "2026-01-01" }] }) });
    check("an appointment can be terminated without deleting its history", terminated.status === 201);
    const license = await api("/api/app/appointment-vault/licenses", owner, { method: "POST", ...json({ state: "AZ", license_number: "AZ-LA05", expires_at: "2027-01-01" }) });
    const eo = await api("/api/app/appointment-vault/eo-policies", owner, { method: "POST", ...json({ carrier: "QA E&O", policy_number: "EO-LA05", expires_at: "2027-01-01", coverage_amount_cents: 1000000 }) });
    const ce = await api("/api/app/appointment-vault/ce-records", owner, { method: "POST", ...json({ state: "AZ", credits_required: 24, credits_completed: 24, deadline: "2027-01-01" }) });
    check("licence, E&O and CE records save through protected APIs", license.status === 201 && eo.status === 201 && ce.status === 201);

    const vaultResponse = await api("/api/app/appointment-vault", owner);
    const vault = await vaultResponse.json();
    check("historical eligibility remains true before termination and false after it", canWriteFromVault(vault, carrierId, "AZ", "2025-12-31") && !canWriteFromVault(vault, carrierId, "AZ", "2026-01-01"));
    check("missing and future appointments are refused", !canWriteFromVault(vault, carrierId, "WY", "2025-01-01") && !canWriteFromVault({ ...vault, appointments: [...vault.appointments, { ...rows[1], state: "WY", effective_from: "2027-01-01" }] }, carrierId, "WY", "2026-01-01"));
    check("expired licence or E&O refuses writing", !canWriteFromVault({ ...vault, appointments: rows.slice(1, 2), licenses: [{ ...vault.licenses[0], state: "AL", expires_at: "2024-12-31" }] }, carrierId, "AL", "2025-12-31") && !canWriteFromVault({ ...vault, appointments: rows.slice(1, 2), eoPolicies: [{ ...vault.eoPolicies[0], expires_at: "2024-12-31" }] }, carrierId, "AL", "2025-12-31"));
    const warnings = dueExpiryWarnings({ licenses: [{ ...vault.licenses[0], expires_at: "2026-04-01" }], eoPolicies: [{ ...vault.eoPolicies[0], expires_at: "2026-03-02" }], ceRecords: [{ ...vault.ceRecords[0], deadline: "2026-01-31" }] }, "2026-01-01");
    check("expiry warnings are emitted at the configured 90/60/30-day thresholds", warnings.some((warning) => warning.days === 90) && warnings.some((warning) => warning.days === 60) && warnings.some((warning) => warning.days === 30), JSON.stringify(warnings));

    const malformed = await api("/api/app/appointment-vault/licenses", owner, { method: "POST", ...json({ state: "<script>", license_number: "x", expires_at: "nope" }) });
    check("hostile and malformed input is rejected next to the API boundary", malformed.status === 400, `status ${malformed.status}`);
    const noSession = await fetch(`${BASE}/api/app/appointment-vault`);
    const forged = await api("/api/app/appointment-vault", "insurvas_tenant_session=forged");
    check("missing and forged sessions are rejected", noSession.status === 401 && forged.status === 401);
    check("a producer cannot change owner-only vault settings", (await api("/api/app/appointment-vault", producer)).status === 403);
    const { count: auditCount } = await supabase.from("audit_log").select("id", { count: "exact", head: true }).eq("actor_id", ownerId).in("action", ["tenant.appointment_saved", "tenant.license_saved", "tenant.eo_policy_saved", "tenant.ce_record_saved"]);
    check("every successful write has an audit row", (auditCount ?? 0) >= 46, `count ${auditCount}`);
  } finally { await cleanup(); }
  if (failures) return 1;
  console.log("\nAll live appointment-vault checks passed.");
  return 0;
}

process.exitCode = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; });
