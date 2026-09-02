// LA-1.19 live contract checks. Run with: npm run verify:subscription-limits
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const tenantId = randomUUID(); const otherTenantId = randomUUID();
const ownerId = randomUUID(); const producerId = randomUUID(); const otherOwnerId = randomUUID();
let failures = 0; let partnerId = null; let secondPartnerId = null;
const check = (label, ok, detail = "") => { if (ok) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures += 1; } };
const json = (body) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const partner = (name, type = "publisher") => ({ name, partner_type: type, country: "US", contact_name: "QA", contact_email: `${name.toLowerCase().replaceAll(" ", "-")}@invalid.test`, timezone: "America/Phoenix", notes: "LA-1.19 verification" });
async function session(userId, tenant = tenantId, expires = "10m") { return new SignJWT({ tenantId: tenant }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(expires).sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET)); }
async function api(path, token, options = {}) { return fetch(`${BASE}${path}`, { ...options, headers: { cookie: `insurvas_tenant_session=${token}`, ...(options.headers ?? {}) } }); }
async function cleanup() {
  await db.from("agent_leads").delete().in("tenant_id", [tenantId, otherTenantId]);
  await db.from("partner_users").delete().in("tenant_id", [tenantId, otherTenantId]);
  await db.from("partner_terms").delete().in("partner_id", [partnerId, secondPartnerId].filter(Boolean));
  await db.from("partners").delete().in("id", [partnerId, secondPartnerId].filter(Boolean));
  await db.from("tenant_entitlements").delete().in("tenant_id", [tenantId, otherTenantId]);
  await db.from("audit_log").delete().in("actor_id", [ownerId, producerId, otherOwnerId]);
  await db.from("tenant_users").delete().in("tenant_id", [tenantId, otherTenantId]);
  await db.from("users").delete().in("id", [ownerId, producerId, otherOwnerId]);
  await db.from("tenants").delete().in("id", [tenantId, otherTenantId]);
}
async function main() {
  const probe = await db.rpc("create_partner_with_limits", { p_tenant_id: tenantId, p_name: "probe", p_partner_type: "publisher", p_country: "US", p_contact_name: "", p_contact_email: "", p_timezone: "UTC", p_notes: "", p_created_by: ownerId, p_max_publishers: 0, p_max_marketing_partners: null, p_max_affiliates: null });
  if (probe.error && /does not exist|could not find/i.test(probe.error.message)) { console.error("LA-1.19 migration is not applied to the connected database."); return 2; }
  await cleanup();
  const setup = await db.from("tenants").insert([{ id: tenantId, name: `LA-1.19 ${stamp}`, status: "active", onboarding_state: "completed" }, { id: otherTenantId, name: `LA-1.19 other ${stamp}`, status: "active", onboarding_state: "completed" }]);
  if (setup.error) throw new Error(setup.error.message);
  const users = await db.from("users").insert([{ id: ownerId, email: `la19-owner-${stamp}@invalid.test`, name: "LA-1.19 owner", status: "active", password_hash: "qa" }, { id: producerId, email: `la19-producer-${stamp}@invalid.test`, name: "LA-1.19 producer", status: "active", password_hash: "qa" }, { id: otherOwnerId, email: `la19-other-${stamp}@invalid.test`, name: "LA-1.19 other", status: "active", password_hash: "qa" }]);
  if (users.error) throw new Error(users.error.message);
  const members = await db.from("tenant_users").insert([{ tenant_id: tenantId, user_id: ownerId, role: "owner" }, { tenant_id: tenantId, user_id: producerId, role: "producer" }, { tenant_id: otherTenantId, user_id: otherOwnerId, role: "owner" }]);
  if (members.error) throw new Error(members.error.message);
  const entitlement = { tenant_id: tenantId, plan_code: "qa", plan_version: 1, status: "active", access: "full", computed_at: new Date().toISOString(), features: ["publisher_records"], meters: {}, limits: { max_seats: 5, max_publishers: 1, max_marketing_partners: 1, max_affiliates: 1, max_buffer_seats: 1, max_partner_users: 1 } };
  const grants = await db.from("tenant_entitlements").insert([{ tenant_id: tenantId, entitlement }, { tenant_id: otherTenantId, entitlement: { ...entitlement, tenant_id: otherTenantId } }]);
  if (grants.error) throw new Error(grants.error.message);
  const owner = await session(ownerId); const producer = await session(producerId); const other = await session(otherOwnerId, otherTenantId);
  try {
    check("missing, forged and expired sessions fail closed", (await fetch(`${BASE}/api/app/partners`)).status === 401 && (await api("/api/app/partners", "forged")).status === 401 && (await api("/api/app/partners", await session(ownerId, tenantId, "-1s"))).status === 401);
    check("wrong tenant role cannot create", (await api("/api/app/partners", producer, { method: "POST", ...json(partner("wrong role")) })).status === 403);
    check("hostile input is rejected", (await api("/api/app/partners", owner, { method: "POST", ...json(partner("<script>alert(1)</script>")) })).status === 400);
    const created = await api("/api/app/partners", owner, { method: "POST", ...json(partner("Publisher one")) }); const createdBody = await created.json(); partnerId = createdBody.partner?.id;
    check("first publisher is created", created.status === 201 && Boolean(partnerId));
    const activated = await api(`/api/app/partners/${partnerId}`, owner, { method: "PATCH", ...json({ action: "transition", next_status: "active", reason: "capacity test" }) });
    check("activating a partner consumes its type capacity", activated.status === 200);
    const over = await api("/api/app/partners", owner, { method: "POST", ...json(partner("Publisher two")) }); const overBody = await over.json();
    check("hand-crafted create over max_publishers is 403 and specific", over.status === 403 && overBody.code === "limit_reached" && overBody.limitKey === "max_publishers");
    const concurrent = await Promise.all([api("/api/app/partners", owner, { method: "POST", ...json(partner("Concurrent one")) }), api("/api/app/partners", owner, { method: "POST", ...json(partner("Concurrent two")) })]);
    check("concurrent creates cannot overrun the cap", concurrent.filter((r) => r.status === 201).length === 0 && concurrent.every((r) => r.status === 403));
    const paused = await api(`/api/app/partners/${partnerId}`, owner, { method: "PATCH", ...json({ action: "transition", next_status: "active", reason: "already active" }) });
    check("invalid lifecycle transition does not mutate", paused.status === 409 || paused.status === 400);
    const pause = await api(`/api/app/partners/${partnerId}`, owner, { method: "PATCH", ...json({ action: "transition", next_status: "paused", reason: "capacity test" }) });
    const resumed = await api(`/api/app/partners/${partnerId}`, owner, { method: "PATCH", ...json({ action: "transition", next_status: "active", reason: "capacity test" }) });
    check("pause and unpause preserve cap semantics", pause.status === 200 && resumed.status === 200);
    const list = await api("/api/app/partners", owner); const listBody = await list.json();
    check("usage is returned against each configured cap", list.status === 200 && listBody.limits.max_publishers === 1 && typeof listBody.usage.publishers === "number");
    const otherList = await api("/api/app/partners", other); const otherBody = await otherList.json();
    check("tenant scope cannot cross-read", otherList.status === 200 && !otherBody.partners?.some((p) => p.id === partnerId));
    const lowered = await db.from("tenant_entitlements").update({ entitlement: { ...entitlement, limits: { ...entitlement.limits, max_publishers: 0 } } }).eq("tenant_id", tenantId);
    check("downgrade below current usage keeps existing data", !lowered.error && (await api("/api/app/partners", owner)).status === 200);
    const blockedAfterDowngrade = await api("/api/app/partners", owner, { method: "POST", ...json(partner("After downgrade")) });
    check("downgrade blocks new creation without deleting history", blockedAfterDowngrade.status === 403);
  } finally { await cleanup(); }
  if (failures) return 1;
  console.log("\nAll live LA-1.19 subscription-limit checks passed."); return 0;
}
process.exitCode = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; });
