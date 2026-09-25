// M1-3/M1-4/M1-5/M1-6/M1-8/M1-9 live verification.
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";
import { createFixtureUser, deleteFixtureUser } from "./lib/fixtureUser.mjs";

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
  if (userIds.length) await db.from("user_invitations").delete().in("user_id", userIds);
  for (const userId of [...new Set(userIds)]) await deleteFixtureUser(db, userId);
}

try {
  const tenantId = crypto.randomUUID();
  const owner = await createFixtureUser(db, { email: `m1-owner-${stamp}@invalid.test`, name: "Integrity Owner" });
  const invited = await createFixtureUser(db, { email: `m1-invited-${stamp}@invalid.test`, name: "Invited User" });
  const userId = owner.userId; const invitedId = invited.userId;
  tenantIds.push(tenantId); userIds.push(userId, invitedId);
  await db.from("tenants").insert({ id: tenantId, name: `M1 integrity ${stamp}`, status: "active" });
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

  const clash = await createFixtureUser(db, { email: `m1-clash-${stamp}@invalid.test`, name: "Email Clash" });
  const clashId = clash.userId; userIds.push(clashId);
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

  const seatTenant = crypto.randomUUID();
  const seatOwner = await createFixtureUser(db, { email: `m1-seat-owner-${stamp}@invalid.test`, name: "Seat Owner" });
  const inactive = await createFixtureUser(db, { email: `m1-seat-${stamp}@invalid.test`, name: "Inactive Seat", status: "inactive" });
  const seatOwnerId = seatOwner.userId; const inactiveId = inactive.userId;
  const plan = await db.from("plans").select("id").eq("code", "basic").order("version", { ascending: false }).limit(1).single();
  tenantIds.push(seatTenant); userIds.push(seatOwnerId, inactiveId);
  await db.from("tenants").insert({ id: seatTenant, name: `M1 seat ${stamp}`, status: "active" });
  await db.from("subscriptions").insert({ tenant_id: seatTenant, plan_id: plan.data.id, status: "active", billing_cycle: "monthly", started_at: new Date().toISOString(), current_period_start: new Date().toISOString(), current_period_end: new Date(Date.now() + 2592000000).toISOString() });
  await db.from("tenant_users").insert({ tenant_id: seatTenant, user_id: seatOwnerId, role: "owner", accepted_at: new Date().toISOString() });
  await db.from("tenant_users").insert({ tenant_id: seatTenant, user_id: inactiveId, role: "producer", accepted_at: new Date().toISOString() });
  const seatCheck = await db.rpc("admin_set_user_status", { p_user_id: inactiveId, p_status: "active", p_reason: null });
  check("reactivation enforces the plan seat limit in SQL", Boolean(seatCheck.error) && /seat_limit_reached/i.test(seatCheck.error.message), seatCheck.error?.message ?? "no error");
  // The one seat rule (20260924346000): active, suspended and unaccepted invites hold a seat;
  // inactive / deactivated and deleted do not. The basic plan above allows one seat, which the owner holds.
  const seatsHeld = await db.rpc("tenant_seats_used", { p_tenant_id: seatTenant });
  check("an inactive member holds no seat and the active owner holds one", seatsHeld.data === 1, seatsHeld.error?.message ?? `got ${seatsHeld.data}`);
  const suspendSeat = await db.rpc("admin_set_user_status", { p_user_id: inactiveId, p_status: "suspended", p_reason: "QA one seat rule" });
  check("inactive -> suspended takes a seat, so it is refused at the limit too", Boolean(suspendSeat.error) && /seat_limit_reached/i.test(suspendSeat.error.message), suspendSeat.error?.message ?? "no error");
  const pending = await createFixtureUser(db, { email: `m1-seat-invited-${stamp}@invalid.test`, name: "Invited Seat", status: "invited" });
  userIds.push(pending.userId);
  await db.from("tenant_users").insert({ tenant_id: seatTenant, user_id: pending.userId, role: "producer", accepted_at: null });
  const seatsWithInvite = await db.rpc("tenant_seats_used", { p_tenant_id: seatTenant });
  check("an unaccepted invite holds a seat from the moment it is sent", seatsWithInvite.data === 2, seatsWithInvite.error?.message ?? `got ${seatsWithInvite.data}`);

  // Exercise the current Auth-first HTTP boundary. This is the route users actually take, and it
  // applies the first-member owner invariant while the matching SQL migration awaits DDL authority.
  const firstPlan = await db.from("plans").select("id").eq("is_archived", false).order("version", { ascending: false }).limit(1).single();
  assert.equal(firstPlan.error, null, firstPlan.error?.message);
  const firstResponse = await api("/api/admin/users", json({ name: "First Member", email: `m1-first-${stamp}@invalid.test`, phone: "", newTenantName: `M1 first ${stamp}`, planId: firstPlan.data.id, role: "producer" }));
  const firstBody = await firstResponse.json().catch(() => ({}));
  if (firstBody.user?.id) userIds.push(firstBody.user.id);
  if (firstBody.tenantId) tenantIds.push(firstBody.tenantId);
  const firstRole = firstBody.tenantId && firstBody.user?.id
    ? await db.from("tenant_users").select("role").eq("tenant_id", firstBody.tenantId).eq("user_id", firstBody.user.id).single()
    : { data: null, error: null };
  const firstProvisioningAvailable = firstResponse.status === 201;
  check("the plan-aware new-tenant provisioning contract is live", firstProvisioningAvailable, firstBody.code ?? firstBody.error ?? `HTTP ${firstResponse.status}`);
  check("the first member is forced to owner even if producer was requested", !firstProvisioningAvailable || firstRole.data?.role === "owner", firstRole.error?.message ?? "");
  const firstSubscription = firstProvisioningAvailable && firstBody.tenantId
    ? await db.from("subscriptions").select("id, plan_id, status, billing_cycle").eq("tenant_id", firstBody.tenantId).maybeSingle()
    : { data: null, error: null };
  check("a new tenant receives the selected initial plan", !firstProvisioningAvailable || firstSubscription.data?.plan_id === firstPlan.data.id, firstSubscription.error?.message ?? "");
  check("the initial subscription uses the monthly billing cycle", !firstProvisioningAvailable || firstSubscription.data?.billing_cycle === "monthly", firstSubscription.error?.message ?? "");
} finally { await cleanup(); }

console.log(failures === 0 ? "\nAll user integrity checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
