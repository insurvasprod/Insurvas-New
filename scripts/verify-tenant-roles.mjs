import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";

const baseUrl = process.env.AGENT_QA_BASE_URL || "http://localhost:3000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const secret = new TextEncoder().encode(process.env.TENANT_SESSION_SECRET);
const passwordHash = await bcrypt.hash("RoleQA-only-password-2026!", 4);
const tenantId = randomUUID();
const users = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function session(userId, currentTenantId = tenantId) {
  return new SignJWT({ tenantId: currentTenantId }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("10m").sign(secret);
}

async function expiredSession(userId) {
  return new SignJWT({ tenantId }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) - 1).sign(secret);
}

async function request(path, init = {}, userId, currentTenantId = tenantId) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", `insurvas_tenant_session=${await session(userId, currentTenantId)}`);
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

async function json(response) {
  return response.json().catch(() => ({}));
}

try {
  const { error: tenantError } = await supabase.from("tenants").insert({ id: tenantId, name: "LA-0.2 role verification", status: "active", onboarding_state: "not_started" });
  assert(!tenantError, `tenant setup failed: ${tenantError?.message}`);
  const { error: entitlementError } = await supabase.from("tenant_entitlements").insert({ tenant_id: tenantId, entitlement: { tenant_id: tenantId, plan_code: "qa", plan_version: 1, status: "active", access: "full", computed_at: new Date().toISOString(), features: ["book_of_business", "commission_ledger", "outbound_dialing"], meters: {}, limits: { max_seats: 99 } } });
  assert(!entitlementError, `entitlement setup failed: ${entitlementError?.message}`);

  const roleNames = ["owner-a", "owner-b", "assistant", "bookkeeper", "producer"];
  const roleValues = ["owner", "owner", "assistant", "bookkeeper", "producer"];
  for (let i = 0; i < roleNames.length; i += 1) {
    const id = randomUUID(); users.push(id);
    const { error } = await supabase.from("users").insert({ id, name: `Role QA ${roleNames[i]}`, email: `${roleNames[i]}-${tenantId}@invalid.test`, password_hash: passwordHash, status: "active" });
    assert(!error, `user setup failed: ${error?.message}`);
    const { error: membershipError } = await supabase.from("tenant_users").insert({ tenant_id: tenantId, user_id: id, role: roleValues[i], accepted_at: new Date().toISOString() });
    assert(!membershipError, `membership setup failed: ${membershipError?.message}`);
  }
  const [ownerA, ownerB, assistant, bookkeeper, producer] = users;

  let response = await request("/api/app/ledger", {}, assistant); let body = await json(response);
  assert(response.status === 403 && body.code === "role_not_allowed", "assistant could access the ledger");
  response = await request("/api/app/templates", {}, assistant); body = await json(response);
  assert(response.status === 403 && body.code === "role_not_allowed", "assistant could access template settings");
  response = await request("/api/app/checkout/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }, assistant); body = await json(response);
  assert(response.status === 403, "assistant could access billing checkout");
  response = await request("/api/app/policies", { method: "POST", body: "{}" }, assistant); body = await json(response);
  assert(response.status === 403 && body.code === "role_not_allowed", "assistant could write policy data");
  response = await request("/api/app/dial/preflight", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: "6025550100" }) }, bookkeeper); body = await json(response);
  assert(response.status === 403 && body.code === "role_not_allowed", "bookkeeper could use the dialer");
  response = await request("/api/app/ledger", {}, bookkeeper); body = await json(response);
  assert(response.status === 200 && Array.isArray(body.entries), "bookkeeper could not read the ledger");

  response = await request(`/api/app/team/${ownerB}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "producer" }) }, ownerA); body = await json(response);
  assert(response.status === 200 && body.role === "producer", "owner could not change a member role");
  response = await request(`/api/app/team/${ownerA}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "producer" }) }, ownerA); body = await json(response);
  assert(response.status === 409 && body.code === "last_owner", "last-owner demotion was not blocked clearly");
  const simultaneous = await Promise.all([1, 2].map(() => request(`/api/app/team/${ownerA}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "producer" }) }, ownerA)));
  assert(simultaneous.every((item) => item.status === 409), "concurrent last-owner demotions were not both blocked");

  response = await request(`/api/app/team/${assistant}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "producer" }) }, ownerA); body = await json(response);
  assert(response.status === 200, "owner could not promote assistant");
  response = await request("/api/app/ledger", {}, assistant); body = await json(response);
  assert(response.status === 200, "role change did not apply on the next request");

  const invitedEmail = `invited-${tenantId}@invalid.test`;
  response = await request("/api/app/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Invited QA", email: invitedEmail, role: "assistant" }) }, ownerA); body = await json(response);
  assert(response.status === 201 && body.ok === true, `owner could not invite a teammate: ${response.status} ${JSON.stringify(body)}`);
  users.push(body.member.id);
  response = await request("/api/app/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Invited QA", email: invitedEmail, role: "assistant" }) }, ownerA); body = await json(response);
  assert(response.status === 409, "duplicate invite was not rejected");
  response = await request("/api/app/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "<script>alert(1)</script>", email: "not-an-email", role: "assistant" }) }, ownerA); body = await json(response);
  assert(response.status === 400 && typeof body.error === "string", "hostile invite input did not get a human validation error");
  response = await request(`/api/app/team/${randomUUID()}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "assistant" }) }, ownerA); body = await json(response);
  assert(response.status === 404, "cross-tenant or missing member was not rejected");
  response = await request("/api/app/team/not-a-uuid", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "assistant" }) }, ownerA); body = await json(response);
  assert(response.status === 400 && typeof body.error === "string", "hostile member identifier was not rejected");
  response = await fetch(`${baseUrl}/api/app/ledger`, { headers: { Cookie: "insurvas_tenant_session=forged" } });
  assert(response.status === 401, "forged session was accepted");
  response = await fetch(`${baseUrl}/api/app/ledger`, { headers: { Cookie: `insurvas_tenant_session=${await expiredSession(ownerA)}` } });
  assert(response.status === 401, "expired session was accepted");
  response = await request("/api/app/ledger", {}, randomUUID()); body = await json(response);
  assert(response.status === 401, "a session for a missing membership was accepted");
  const { data: supportAdmin } = await supabase.from("admin_users").select("id,role").eq("role", "support_agent").eq("is_active", true).limit(1).maybeSingle();
  if (supportAdmin) {
    const adminToken = await new SignJWT({ role: supportAdmin.role, stage: "authenticated" }).setProtectedHeader({ alg: "HS256" }).setSubject(supportAdmin.id).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(process.env.ADMIN_SESSION_SECRET));
    response = await fetch(`${baseUrl}/api/app/team`, { headers: { Cookie: `insurvas_admin_session=${adminToken}` } });
    assert(response.status === 401, "an admin session was accepted by a tenant endpoint");
  }
  response = await request("/api/app/team", {}, producer); body = await json(response);
  assert(response.status === 403, "non-owner could manage the team");

  console.log("PASS — LA-0.2 role API verification: assistant money denial, bookkeeper dial denial, own-producer role transition, atomic last-owner guard, next-request role change, invite idempotency, hostile input, missing member, forged session, and owner-only team access.");
} finally {
  if (users.length) {
    await supabase.from("user_invitations").delete().in("user_id", users);
    await supabase.from("audit_log").delete().in("target_id", [...users, tenantId]);
    await supabase.from("tenant_users").delete().eq("tenant_id", tenantId);
    await supabase.from("users").delete().in("id", users);
  }
  await supabase.from("tenant_entitlements").delete().eq("tenant_id", tenantId);
  await supabase.from("tenants").delete().eq("id", tenantId);
}
