import "./lib/refuseProduction.mjs";
// LA-1.2 live contract checks. Run with: npm run verify:partner-users
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";
import { createFixtureUser, deleteFixtureUser, createFixtureOrganization, deleteFixtureOrganization } from "./lib/fixtureUser.mjs";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const PARTNER_SECRET = process.env.PARTNER_SESSION_SECRET || `insurvas-partner:${process.env.TENANT_SESSION_SECRET}`;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const tenantId = randomUUID();
let ownerId = null;
let adminId = null;
let userId = null;
let otherPartnerAdminId = null;
let offboardUserId = null;
let existingAccountId = null;
const invitedIds = [];
const partnerId = randomUUID();
const otherPartnerId = randomUUID();
const ownerEmail = `la12-owner-${stamp}@invalid.test`;
const adminEmail = `la12-admin-${stamp}@invalid.test`;
const userEmail = `la12-user-${stamp}@invalid.test`;
const normalLoginIp = `192.0.2.${(stamp % 200) + 1}`;
const protectionEmail = `la12-protection-${stamp}@invalid.test`;
const protectionIp = `198.51.100.${(stamp % 200) + 1}`;
const clearProtectionIp = `203.0.113.${(stamp % 200) + 1}`;
const clearEmail = `la12-admin-${stamp}@invalid.test`;
const clearEmailKey = `login_user_email:${clearEmail}`;
const clearIpKey = `login_user_ip:${clearProtectionIp}`;
const clearLockoutPrefix = `login_lockout:login:user:${encodeURIComponent(clearEmail)}:${encodeURIComponent(clearProtectionIp)}`;
let failures = 0;

function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures += 1; }
}

async function partnerToken(userIdValue, partnerIdValue = partnerId, expiry = "10m") {
  return new SignJWT({ tenantId, partnerId: partnerIdValue }).setProtectedHeader({ alg: "HS256" }).setSubject(userIdValue).setIssuedAt().setExpirationTime(expiry).sign(new TextEncoder().encode(PARTNER_SECRET));
}
function partnerCookie(token) { return `insurvas_partner_session=${token}`; }
async function tenantToken(userIdValue, expiry = "10m") {
  return new SignJWT({ tenantId }).setProtectedHeader({ alg: "HS256" }).setSubject(userIdValue).setIssuedAt().setExpirationTime(expiry).sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET));
}
function tenantCookie(token) { return `insurvas_tenant_session=${token}`; }
function json(body) { return { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }; }
async function api(path, cookie, options = {}) { return fetch(`${BASE}${path}`, { ...options, headers: { cookie, ...(options.headers ?? {}) } }); }
async function jsonBody(response) {
  if (typeof response.text !== "function") return response.json();
  const raw = await response.text();
  try { return JSON.parse(raw); }
  catch { return { __nonJson: { status: response.status, contentType: response.headers.get("content-type") ?? "", body: raw.slice(0, 240) } }; }
}
function inviteToken(url) { return new URL(url).searchParams.get("token"); }
function sessionCookie(response) {
  const values = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const value = values.find((entry) => entry.startsWith("insurvas_partner_session="));
  return value?.split(";", 1)[0] ?? "";
}
function tenantSessionCookie(response) {
  const values = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const value = values.find((entry) => entry.startsWith("insurvas_tenant_session="));
  return value?.split(";", 1)[0] ?? "";
}
function hasClearedCookie(response, cookieName) {
  const values = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  return values.some((entry) => new RegExp(`^${cookieName}=;.*(?:Max-Age=0|Expires=Thu, 01 Jan 1970)`, "i").test(entry));
}

async function cleanup() {
  const protectionEmailKey = `login_user_email:${protectionEmail}`;
  const protectionIpKey = `login_user_ip:${protectionIp}`;
  const protectionLockoutPrefix = `login_lockout:login:user:${encodeURIComponent(protectionEmail)}:${encodeURIComponent(protectionIp)}`;
  const adminEmailKey = `login_user_email:${adminEmail}`;
  const userEmailKey = `login_user_email:${userEmail}`;
  const normalLoginIpKey = `login_user_ip:${normalLoginIp}`;
  await db.from("rate_limits").delete().in("bucket_key", [adminEmailKey, userEmailKey, normalLoginIpKey, protectionEmailKey, protectionIpKey, clearEmailKey, clearIpKey]);
  await db.from("rate_limits").delete().like("bucket_key", `${protectionLockoutPrefix}%`);
  await db.from("rate_limits").delete().like("bucket_key", `${clearLockoutPrefix}%`);
  await db.from("rate_limits").delete().like("bucket_key", `login_lockout:login:user:${encodeURIComponent(adminEmail)}:${encodeURIComponent(normalLoginIp)}%`);
  await db.from("rate_limits").delete().like("bucket_key", `login_lockout:login:user:${encodeURIComponent(userEmail)}:${encodeURIComponent(normalLoginIp)}%`);
  const userIds = [ownerId, adminId, userId, otherPartnerAdminId, offboardUserId, existingAccountId, ...invitedIds];
  await db.from("user_invitations").delete().in("user_id", userIds);
  await db.from("partner_users").delete().in("partner_id", [partnerId, otherPartnerId]);
  await db.from("audit_log").delete().in("actor_id", userIds);
  await db.from("login_events").delete().in("user_id", userIds);
  await db.from("tenant_users").delete().in("user_id", [ownerId]);
  await db.from("tenant_entitlements").delete().eq("tenant_id", tenantId);
  await db.from("partners").delete().in("id", [partnerId, otherPartnerId]);
  // Both halves. deleteFixtureUser removes the public row first, then the auth.users row it
  // references, so a re-run is not blocked by a leftover Auth identity holding the email.
  for (const id of userIds) await deleteFixtureUser(db, id);
  await db.from("tenants").delete().eq("id", tenantId);
  await deleteFixtureOrganization(db, tenantId);
}

async function main() {
  await cleanup();
  const passwordHash = await bcrypt.hash("Partner QA password 123!", 4);
  await createFixtureOrganization(db, tenantId, `LA-1.2 verification ${stamp}`);
  const inserted = await db.from("tenants").insert({ id: tenantId, name: `LA-1.2 verification ${stamp}`, status: "active", onboarding_state: "completed" });
  if (inserted.error) throw new Error(inserted.error.message);
  ({ userId: ownerId } = await createFixtureUser(db, { email: ownerEmail, name: "LA-1.2 owner", password: "Partner QA password 123!" }));
  ({ userId: adminId } = await createFixtureUser(db, { email: `la12-admin-${stamp}@invalid.test`, name: "Partner administrator", password: "Partner QA password 123!" }));
  ({ userId: userId } = await createFixtureUser(db, { email: `la12-user-${stamp}@invalid.test`, name: "Partner operator", password: "Partner QA password 123!" }));
  ({ userId: otherPartnerAdminId } = await createFixtureUser(db, { email: `la12-other-${stamp}@invalid.test`, name: "Other partner administrator", password: "Partner QA password 123!" }));
  ({ userId: offboardUserId } = await createFixtureUser(db, { email: `la12-offboard-${stamp}@invalid.test`, name: "Offboarded operator", password: "Partner QA password 123!" }));
  ({ userId: existingAccountId } = await createFixtureUser(db, { email: `la12-existing-${stamp}@invalid.test`, name: "Existing Insurvas account", password: "Partner QA password 123!" }));
  // The partner portal verifies against `users.password_hash` with bcrypt, while the agent app
  // verifies against Supabase Auth. A fixture created through Auth therefore has no credential the
  // portal can check, and every portal login returns 401. Set both until the two planes agree on
  // one credential authority.
  const hashed = await db.from("users").update({ password_hash: passwordHash })
    .in("id", [ownerId, adminId, userId, otherPartnerAdminId, offboardUserId, existingAccountId]);
  if (hashed.error) throw new Error(hashed.error.message);

  const membership = await db.from("tenant_users").insert({ tenant_id: tenantId, user_id: ownerId, role: "owner" });
  if (membership.error) throw new Error(membership.error.message);
  const entitlement = await db.from("tenant_entitlements").insert({ tenant_id: tenantId, entitlement: { tenant_id: tenantId, plan_code: "qa", plan_version: 1, status: "active", access: "full", computed_at: new Date().toISOString(), features: ["publisher_records"], meters: {}, limits: { max_publishers: 10, max_marketing_partners: 10, max_affiliates: 10, max_buffer_seats: null, max_partner_users: 10 } } });
  if (entitlement.error) throw new Error(entitlement.error.message);
  const partners = await db.from("partners").insert([
    { id: partnerId, tenant_id: tenantId, organization_id: tenantId, name: "QA Partner A", slug: `qa-partner-a-${stamp}`, partner_type: "publisher", status: "active", country: "US", timezone: "America/Phoenix", created_by: ownerId },
    { id: otherPartnerId, tenant_id: tenantId, organization_id: tenantId, name: "QA Partner B", slug: `qa-partner-b-${stamp}`, partner_type: "publisher", status: "active", country: "US", timezone: "America/Phoenix", created_by: ownerId },
  ]);
  if (partners.error) throw new Error(partners.error.message);
  const memberships = await db.from("partner_users").insert([
    { id: randomUUID(), tenant_id: tenantId, organization_id: tenantId, partner_id: partnerId, user_id: adminId, role: "partner_admin", status: "active", accepted_at: new Date().toISOString() },
    { id: randomUUID(), tenant_id: tenantId, organization_id: tenantId, partner_id: partnerId, user_id: userId, role: "partner_user", status: "active", accepted_at: new Date().toISOString() },
    { id: randomUUID(), tenant_id: tenantId, organization_id: tenantId, partner_id: otherPartnerId, user_id: otherPartnerAdminId, role: "partner_admin", status: "active", accepted_at: new Date().toISOString() },
    { id: randomUUID(), tenant_id: tenantId, organization_id: tenantId, partner_id: otherPartnerId, user_id: offboardUserId, role: "partner_user", status: "active", accepted_at: new Date().toISOString() },
  ]);
  if (memberships.error) throw new Error(memberships.error.message);

  const adminLogin = await fetch(`${BASE}/api/partner/auth/login`, { method: "POST", ...json({ email: adminEmail, password: "Partner QA password 123!" }), headers: { "content-type": "application/json", "x-forwarded-for": normalLoginIp } });
  const adminCookie = sessionCookie(adminLogin);
  const userLogin = await fetch(`${BASE}/api/partner/auth/login`, { method: "POST", ...json({ email: userEmail, password: "Partner QA password 123!" }), headers: { "content-type": "application/json", "x-forwarded-for": normalLoginIp } });
  const userCookie = sessionCookie(userLogin);
  check("partner login issues the partner session and clears the agent session", adminLogin.status === 200 && adminCookie.startsWith("insurvas_partner_session=") && hasClearedCookie(adminLogin, "insurvas_tenant_session"));
  check("partner user login succeeds", userLogin.status === 200 && userCookie.startsWith("insurvas_partner_session="));
  const partnerCredentialOnAgentLogin = await fetch(`${BASE}/api/app/auth/login`, { method: "POST", ...json({ email: adminEmail, password: "Partner QA password 123!" }), headers: { "content-type": "application/json", "x-forwarded-for": normalLoginIp } });
  const agentCredentialOnPartnerLogin = await fetch(`${BASE}/api/partner/auth/login`, { method: "POST", ...json({ email: ownerEmail, password: "Partner QA password 123!" }), headers: { "content-type": "application/json", "x-forwarded-for": normalLoginIp } });
  // One account, one portal (lib/auth/planeSeparation.ts): past the password the agent login names
  // the right door with 403 wrong_portal, and still issues no agent session.
  const partnerOnAgentBody = await partnerCredentialOnAgentLogin.clone().json().catch(() => ({}));
  check("partner credentials are rejected by the agent login", partnerCredentialOnAgentLogin.status === 403 && partnerOnAgentBody.code === "wrong_portal" && tenantSessionCookie(partnerCredentialOnAgentLogin).length <= "insurvas_tenant_session=".length,JSON.stringify({ status: partnerCredentialOnAgentLogin.status, body: partnerOnAgentBody }));
  check("agent credentials are rejected by the partner login", agentCredentialOnPartnerLogin.status === 401);
  const agentLogin = await fetch(`${BASE}/api/app/auth/login`, { method: "POST", ...json({ email: ownerEmail, password: "Partner QA password 123!" }), headers: { "content-type": "application/json", "x-forwarded-for": normalLoginIp } });
  check("agent login issues the agent session and clears the partner session", agentLogin.status === 200 && tenantSessionCookie(agentLogin).startsWith("insurvas_tenant_session=") && hasClearedCookie(agentLogin, "insurvas_partner_session"));

  const protectionAttempts = [];
  for (let index = 0; index < 7; index += 1) {
    protectionAttempts.push(await fetch(`${BASE}/api/partner/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": protectionIp },
      body: JSON.stringify({ email: protectionEmail, password: "not-the-password" }),
    }));
  }
  const protectionStatuses = protectionAttempts.map((response) => response.status);
  check("partner login protection permits five generic failures", protectionStatuses.slice(0, 5).every((status) => status === 401), protectionStatuses.join(", "));
  check("partner login protection refuses repeated attempts", protectionStatuses[5] === 429 && protectionStatuses[6] === 429, protectionStatuses.join(", "));
  check("partner login protection returns Retry-After", protectionAttempts[5].headers.get("retry-after") !== null);
  const protectionBody = await jsonBody(protectionAttempts[5]);
  check("partner rate limiting keeps the generic error", protectionBody.error === "Invalid email or password");
  const { data: protectionCounters, error: protectionError } = await db.from("rate_limits")
    .select("bucket_key, hits")
    .or(`bucket_key.eq.login_user_email:${protectionEmail},bucket_key.eq.login_user_ip:${protectionIp},bucket_key.like.login_lockout:login:user:${encodeURIComponent(protectionEmail)}:%`);
  check("partner login writes persistent email/IP and failure counters", !protectionError && (protectionCounters?.length ?? 0) >= 3, protectionError?.message);

  const clearFailure = await fetch(`${BASE}/api/partner/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": clearProtectionIp },
    body: JSON.stringify({ email: clearEmail, password: "not-the-password" }),
  });
  const clearSuccess = await fetch(`${BASE}/api/partner/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": clearProtectionIp },
    body: JSON.stringify({ email: clearEmail, password: "Partner QA password 123!" }),
  });
  const { data: remainingLockouts, error: remainingLockoutError } = await db.from("rate_limits")
    .select("bucket_key")
    .like("bucket_key", "login_lockout:login:user:%")
    .like("bucket_key", `${clearLockoutPrefix}%`);
  check("successful partner login clears its failed-login lockout", clearFailure.status === 401 && clearSuccess.status === 200 && !remainingLockoutError && (remainingLockouts?.length ?? 0) === 0, JSON.stringify({ failure: clearFailure.status, success: clearSuccess.status, error: remainingLockoutError?.message }));

  check("missing, expired and forged partner sessions are rejected", (await fetch(`${BASE}/api/partner/me`)).status === 401 && (await api("/api/partner/me", "insurvas_partner_session=forged")).status === 401 && (await api("/api/partner/me", partnerCookie(await partnerToken(adminId, partnerId, "-1s")))).status === 401);
  check("partner session cannot authenticate an agent route", (await api("/api/app/me", adminCookie)).status === 401 && (await api("/api/app/templates", adminCookie)).status === 401);

  const ownUsers = await api("/api/partner/users", adminCookie);
  check("partner admin sees only the current partner users", ownUsers.status === 200 && await (async () => { const u = (await jsonBody(ownUsers.clone())).users ?? []; return u.length > 0 && u.every((row) => [adminId, userId].includes(row.user_id)); })());
  const userRoster = await api("/api/partner/users", userCookie);
  check("partner user cannot access team roster", userRoster.status === 403);
  const crossRole = await api(`/api/partner/users/${userId}`, userCookie, { method: "PATCH", ...json({ action: "deactivate" }) });
  check("partner user cannot manage users", crossRole.status === 403);
  const crossPartner = await api(`/api/partner/users/${otherPartnerAdminId}`, adminCookie, { method: "PATCH", ...json({ action: "deactivate" }) });
  check("partner admin cannot target a different partner", crossPartner.status === 404);
  const missingResend = await api(`/api/partner/users/${randomUUID()}/resend-invite`, adminCookie, { method: "POST" });
  check("resend fails closed when the pending user dependency is missing", missingResend.status === 409);

  const invite = await api("/api/partner/users", adminCookie, { method: "POST", ...json({ name: "<script>alert(1)</script>", email: `la12-invited-${stamp}@invalid.test`, role: "partner_user", partnerId: otherPartnerId, ignored: "<script>alert(1)</script>" }) });
  let inviteBody = await jsonBody(invite);
  const invitedId = inviteBody.user?.id;
  if (invitedId) invitedIds.push(invitedId);
  const linked = invitedId ? await db.from("partner_users").select("partner_id, role, status").eq("user_id", invitedId).single() : { data: null };
  check("partner admin cannot redirect an invite by editing the request", invite.status === 201 && linked.data?.partner_id === partnerId && linked.data?.role === "partner_user", JSON.stringify({ status: invite.status, body: inviteBody, linked: linked.data }));
  check("invites use the required portal path and bounded expiry", inviteBody.invite?.url?.includes("/partner/set-password?token=") && new Date(inviteBody.invite.expiresAt).getTime() - Date.now() > 71 * 60 * 60 * 1000, JSON.stringify(inviteBody));
  check("invitation reports a delivery result and writes a delivery log", typeof inviteBody.invite?.delivered === "boolean" && (await db.from("email_log").select("status, template_key, to_address").eq("user_id", invitedId).eq("template_key", "user.invitation").limit(1)).data?.[0]?.to_address === `la12-invited-${stamp}@invalid.test`);

  const resent = invitedId ? await api(`/api/partner/users/${invitedId}/resend-invite`, adminCookie, { method: "POST" }) : { status: 0, json: async () => ({}) };
  const resentBody = await jsonBody(resent);
  const resendState = invitedId ? await Promise.all([
    db.from("users").select("id, password_hash").eq("id", invitedId).maybeSingle(),
    db.from("partner_users").select("status, accepted_at").eq("partner_id", partnerId).eq("user_id", invitedId).maybeSingle(),
    db.from("user_invitations").select("token_hash, accepted_at, expires_at").eq("partner_id", partnerId).eq("user_id", invitedId).order("created_at", { ascending: false }).limit(2),
  ]) : [];
  check("partner admin can resend a pending invitation", resent.status === 200 && typeof resentBody.invite?.delivered === "boolean" && resentBody.invite?.url?.includes("/partner/set-password?token="), JSON.stringify({ status: resent.status, body: resentBody, state: resendState }));
  if (resent.status === 200) inviteBody = { ...inviteBody, invite: resentBody.invite };

  const ownerCookie = tenantCookie(await tenantToken(ownerId));
  const agentInvite = await api(`/api/app/partners/${partnerId}/users`, ownerCookie, { method: "POST", ...json({ name: "Agent Invited Operator", email: `la12-agent-invited-${stamp}@invalid.test`, role: "partner_user" }) });
  const agentInviteBody = await jsonBody(agentInvite);
  const agentInvitedId = agentInviteBody.user?.id;
  if (agentInvitedId) invitedIds.push(agentInvitedId);
  check("agent owner can issue a partner invitation", agentInvite.status === 201 && agentInviteBody.invite?.url?.includes("/partner/set-password?token=") && typeof agentInviteBody.invite?.delivered === "boolean");
  const agentResend = agentInvitedId ? await api(`/api/app/partners/${partnerId}/users/${agentInvitedId}/resend-invite`, ownerCookie, { method: "POST" }) : { status: 0, json: async () => ({}) };
  const agentResendBody = await jsonBody(agentResend);
  check("agent owner can resend a pending partner invitation", agentResend.status === 200 && typeof agentResendBody.invite?.delivered === "boolean", JSON.stringify({ status: agentResend.status, body: agentResendBody }));

  const existingInvite = await api(`/api/app/partners/${partnerId}/users`, ownerCookie, { method: "POST", ...json({ name: "Existing Partner Admin", email: `la12-existing-${stamp}@invalid.test`, role: "partner_admin" }) });
  const existingInviteBody = await jsonBody(existingInvite);
  const existingToken = existingInviteBody.invite?.url ? inviteToken(existingInviteBody.invite.url) : "";
  const existingPasswordBefore = (await db.from("users").select("password_hash").eq("id", existingAccountId).single()).data?.password_hash;
  const wrongSetPassword = await fetch(`${BASE}/api/partner/auth/set-password`, { method: "POST", ...json({ token: existingToken, password: "A replacement password 123!" }) });
  check("existing invitation cannot reach the password replacement endpoint", wrongSetPassword.status === 400);
  const wrongExisting = await fetch(`${BASE}/api/partner/auth/accept-invite`, { method: "POST", ...json({ token: existingToken, email: `la12-existing-${stamp}@invalid.test`, password: "wrong password" }) });
  const acceptedExisting = await fetch(`${BASE}/api/partner/auth/accept-invite`, { method: "POST", ...json({ token: existingToken, email: `la12-existing-${stamp}@invalid.test`, password: "Partner QA password 123!" }) });
  const acceptedExistingCookie = sessionCookie(acceptedExisting);
  const replayExisting = await fetch(`${BASE}/api/partner/auth/accept-invite`, { method: "POST", ...json({ token: existingToken, email: `la12-existing-${stamp}@invalid.test`, password: "Partner QA password 123!" }) });
  const existingPasswordAfter = (await db.from("users").select("password_hash").eq("id", existingAccountId).single()).data?.password_hash;
  const existingDetail = JSON.stringify({ invite: { status: existingInvite.status, body: existingInviteBody }, wrong: wrongExisting.status, accepted: acceptedExisting.status, replay: replayExisting.status });
  check("existing account receives a sign-in acceptance link", existingInvite.status === 201 && existingInviteBody.invite?.url?.includes("/partner/accept-invite?token=") && existingInviteBody.invite?.mode === "existing_account", existingDetail);
  check("existing account requires its current password", wrongExisting.status === 401 && acceptedExisting.status === 200 && acceptedExistingCookie.startsWith("insurvas_partner_session=") && existingPasswordBefore === existingPasswordAfter, existingDetail);
  check("existing account acceptance is one-time", replayExisting.status === 400, existingDetail);

  const token = inviteBody.invite?.url ? inviteToken(inviteBody.invite.url) : "";
  const redemptions = await Promise.all([
    fetch(`${BASE}/api/partner/auth/set-password`, { method: "POST", ...json({ token, password: "Partner invited password 123!" }) }),
    fetch(`${BASE}/api/partner/auth/set-password`, { method: "POST", ...json({ token, password: "Partner invited password 123!" }) }),
  ]);
  check("one-time invitation redemption is concurrency safe", redemptions.filter((response) => response.status === 200).length === 1 && redemptions.filter((response) => response.status === 400).length === 1, JSON.stringify(redemptions.map((response) => response.status)));
  const wrongPlane = await fetch(`${BASE}/api/app/auth/set-password`, { method: "POST", ...json({ token, password: "Partner invited password 123!" }) });
  check("partner invitation cannot be redeemed on the agent endpoint", wrongPlane.status === 400);

  const revoke = await api(`/api/partner/users/${userId}`, adminCookie, { method: "PATCH", ...json({ action: "deactivate" }) });
  check("deactivation succeeds", revoke.status === 200, JSON.stringify({ status: revoke.status, body: await revoke.clone().json().catch(() => null) }));
  check("deactivation kills the existing session on the next request", (await api("/api/partner/me", userCookie)).status === 401);
  const restore = await api(`/api/partner/users/${userId}`, adminCookie, { method: "PATCH", ...json({ action: "reactivate" }) });
  check("reactivation succeeds", restore.status === 200);

  const offboard = await db.rpc("transition_partner", { p_tenant_id: tenantId, p_partner_id: otherPartnerId, p_next_status: "offboarded", p_confirmation: "OFFBOARD" });
  check("offboarding transition succeeds", !offboard.error, offboard.error ? `${offboard.error.code ?? ""} ${offboard.error.message}` : "");
  const offboardRows = await db.from("partner_users").select("status, deactivated_at, revoked_at").eq("partner_id", otherPartnerId);
  check("offboarding revokes every partner user atomically", !offboardRows.error && offboardRows.data?.length === 2 && offboardRows.data.every((row) => row.status === "revoked" && row.deactivated_at && row.revoked_at));
  check("offboarded partner session is rejected", (await api("/api/partner/me", partnerCookie(await partnerToken(otherPartnerAdminId, otherPartnerId)))).status === 401);

  const audits = await db.from("audit_log").select("action").in("actor_id", [adminId, invitedId].filter(Boolean));
  const actions = new Set((audits.data ?? []).map((row) => row.action));
  check("partner writes and acceptance are audited", actions.has("tenant.partner_user_invited") && actions.has("tenant.partner_user_accepted") && actions.has("tenant.partner_user_deactivated") && actions.has("tenant.partner_user_reactivated"));
  check("partner API exposes no configuration or commission route", (await api("/api/app/ledger", adminCookie)).status === 401 && (await api("/api/app/carrier-library", adminCookie)).status === 401 && (await api("/api/app/partners", adminCookie)).status === 401);
}

try { await main(); } catch (error) { console.error(error); failures += 1; } finally { await cleanup(); }
if (failures) process.exit(1);
console.log("\nAll live LA-1.2 partner user checks passed.");
