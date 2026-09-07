// M1-3/M1-4/M1-5/M1-6/M1-8/M1-9 live verification.
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
let failures = 0;
const check = (label, condition, detail = "") => { console.log(condition ? `  ok   ${label}` : `  FAIL ${label}${detail ? ` — ${detail}` : ""}`); if (!condition) failures++; };
const { data: admin } = await db.from("admin_users").select("id").eq("role", "super_admin").eq("is_active", true).limit(1).single();
const adminCookie = `insurvas_admin_session=${await new SignJWT({ role: "super_admin", stage: "authenticated" }).setProtectedHeader({ alg: "HS256" }).setSubject(admin.id).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(process.env.ADMIN_SESSION_SECRET))}`;
const api = (path, options = {}) => fetch(`${BASE}${path}`, { ...options, headers: { cookie: adminCookie, ...(options.headers ?? {}) }, redirect: "manual" });
const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const tenantIds = []; const userIds = [];
async function cleanup() {
  for (const tenantId of tenantIds) {
    await db.from("tenant_entitlements").delete().eq("tenant_id", tenantId);
    await db.from("subscriptions").delete().eq("tenant_id", tenantId);
    await db.from("tenant_users").delete().eq("tenant_id", tenantId);
    await db.from("tenants").delete().eq("id", tenantId);
  }
  if (userIds.length) { await db.from("user_invitations").delete().in("user_id", userIds); await db.from("users").delete().in("id", userIds); }
}

try {
  const tenantId = crypto.randomUUID(); const userId = crypto.randomUUID(); const invitedId = crypto.randomUUID();
  tenantIds.push(tenantId); userIds.push(userId, invitedId);
  await db.from("tenants").insert({ id: tenantId, name: `M1 integrity ${stamp}`, status: "active" });
  await db.from("users").insert([
    { id: userId, name: "Integrity Owner", email: `m1-owner-${stamp}@invalid.test`, status: "active" },
    { id: invitedId, name: "Invited User", email: `m1-invited-${stamp}@invalid.test`, status: "active" },
  ]);
  await db.from("tenant_users").insert([
    { tenant_id: tenantId, user_id: userId, role: "owner", accepted_at: new Date().toISOString() },
    { tenant_id: tenantId, user_id: invitedId, role: "producer", accepted_at: null },
  ]);
  const token = (version) => new SignJWT({ tenantId, sessionVersion: version }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET));
  const me = async (version) => fetch(`${BASE}/api/app/me`, { headers: { cookie: `insurvas_tenant_session=${await token(version)}` }, redirect: "manual" });

  check("a fresh tenant session can read its own data", (await me(0)).status === 200);
  const deactivate = await api(`/api/admin/users/${userId}/deactivate`, json({}));
  check("deactivation succeeds through the guarded route", deactivate.status === 200, await deactivate.clone().text());
  check("the old session is revoked immediately", (await me(0)).status === 401);
  const activate = await api(`/api/admin/users/${userId}/activate`, json({}));
  const activateText = await activate.clone().text();
  check("reactivation succeeds through the guarded route", activate.status === 200, activateText);
  if (activate.status !== 200) {
    const directActivate = await db.rpc("admin_set_user_status", { p_user_id: userId, p_status: "active", p_reason: null });
    console.log(`  diagnostic direct reactivation: ${directActivate.error?.message ?? "no error"}`);
  }
  check("the revoked session stays unusable after reactivation", (await me(0)).status === 401);
  check("a newly issued session works after reactivation", (await me(2)).status === 200);
  const repeat = await api(`/api/admin/users/${userId}/activate`, json({}));
  check("repeating the same lifecycle action is refused", repeat.status === 409, await repeat.clone().text());

  const clashId = crypto.randomUUID(); userIds.push(clashId);
  await db.from("users").insert({ id: clashId, name: "Email Clash", email: `m1-clash-${stamp}@invalid.test`, status: "active" });
  const atomic = await db.rpc("admin_update_user_with_email_change", { p_user_id: userId, p_name: "Should Not Commit", p_phone: null, p_role: "owner", p_requested_email: `m1-clash-${stamp}@invalid.test`, p_token_hash: `atomic-${stamp}`, p_expires_at: new Date(Date.now() + 3600000).toISOString(), p_created_by: admin.id });
  const unchanged = await db.from("users").select("name").eq("id", userId).single();
  check("duplicate email rejects the whole user edit", Boolean(atomic.error) && /EMAIL_ALREADY_REGISTERED/i.test(atomic.error.message));
  check("name was not partially committed after the email conflict", unchanged.data?.name === "Integrity Owner");

  const oldTokenHash = `replace-${stamp}`;
  const oldToken = await db.from("user_invitations").insert({ user_id: invitedId, token_hash: oldTokenHash, expires_at: new Date(Date.now() + 3600000).toISOString(), created_by: admin.id, purpose: "invite" });
  assert.equal(oldToken.error, null, oldToken.error?.message);
  const replacement = await db.rpc("admin_replace_user_token", { p_user_id: invitedId, p_purpose: "invite", p_token_hash: oldTokenHash, p_expires_at: new Date(Date.now() + 3600000).toISOString(), p_created_by: admin.id });
  const oldInvitation = await db.from("user_invitations").select("accepted_at").eq("user_id", invitedId).eq("token_hash", oldTokenHash).single();
  check("token replacement rolls back when the new token cannot be inserted", Boolean(replacement.error));
  check("the old invitation remains valid after replacement failure", oldInvitation.data?.accepted_at === null);

  const seatTenant = crypto.randomUUID(); const seatOwnerId = crypto.randomUUID(); const inactiveId = crypto.randomUUID(); const plan = await db.from("plans").select("id").eq("code", "basic").order("version", { ascending: false }).limit(1).single();
  tenantIds.push(seatTenant); userIds.push(seatOwnerId, inactiveId);
  await db.from("tenants").insert({ id: seatTenant, name: `M1 seat ${stamp}`, status: "active" });
  await db.from("subscriptions").insert({ tenant_id: seatTenant, plan_id: plan.data.id, status: "active", billing_cycle: "monthly", started_at: new Date().toISOString(), current_period_start: new Date().toISOString(), current_period_end: new Date(Date.now() + 2592000000).toISOString() });
  await db.from("users").insert({ id: seatOwnerId, name: "Seat Owner", email: `m1-seat-owner-${stamp}@invalid.test`, status: "active" });
  await db.from("tenant_users").insert({ tenant_id: seatTenant, user_id: seatOwnerId, role: "owner", accepted_at: new Date().toISOString() });
  await db.from("users").insert({ id: inactiveId, name: "Inactive Seat", email: `m1-seat-${stamp}@invalid.test`, status: "inactive" });
  await db.from("tenant_users").insert({ tenant_id: seatTenant, user_id: inactiveId, role: "producer", accepted_at: new Date().toISOString() });
  const seatCheck = await db.rpc("admin_set_user_status", { p_user_id: inactiveId, p_status: "active", p_reason: null });
  check("reactivation enforces the plan seat limit in SQL", Boolean(seatCheck.error) && /seat_limit_reached/i.test(seatCheck.error.message), seatCheck.error?.message ?? "no error");

  const first = await db.rpc("admin_create_user", { p_name: "First Member", p_email: `m1-first-${stamp}@invalid.test`, p_phone: null, p_tenant_id: null, p_new_tenant_name: `M1 first ${stamp}`, p_role: "producer", p_token_hash: `first-${stamp}`, p_expires_at: new Date(Date.now() + 3600000).toISOString(), p_created_by: admin.id });
  const firstRow = Array.isArray(first.data) ? first.data[0] : first.data;
  if (firstRow?.tenant_id) { tenantIds.push(firstRow.tenant_id); userIds.push(firstRow.user_id); }
  const firstRole = firstRow ? await db.from("tenant_users").select("role").eq("tenant_id", firstRow.tenant_id).eq("user_id", firstRow.user_id).single() : { data: null };
  check("the first member is forced to owner even if producer was requested", !first.error && firstRole.data?.role === "owner", first.error?.message ?? firstRole.error?.message ?? "");
} finally { await cleanup(); }

console.log(failures === 0 ? "\nAll user integrity checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
