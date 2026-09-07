// LA-1.2 live contract checks. Run with: npm run verify:partner-users
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const PARTNER_SECRET = process.env.PARTNER_SESSION_SECRET || `insurvas-partner:${process.env.TENANT_SESSION_SECRET}`;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const tenantId = randomUUID();
const ownerId = randomUUID();
const adminId = randomUUID();
const userId = randomUUID();
const otherPartnerAdminId = randomUUID();
const offboardUserId = randomUUID();
const invitedIds = [];
const partnerId = randomUUID();
const otherPartnerId = randomUUID();
let failures = 0;

function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures += 1; }
}

async function partnerToken(userIdValue, partnerIdValue = partnerId, expiry = "10m") {
  return new SignJWT({ tenantId, partnerId: partnerIdValue }).setProtectedHeader({ alg: "HS256" }).setSubject(userIdValue).setIssuedAt().setExpirationTime(expiry).sign(new TextEncoder().encode(PARTNER_SECRET));
}
function partnerCookie(token) { return `insurvas_partner_session=${token}`; }
function json(body) { return { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }; }
async function api(path, cookie, options = {}) { return fetch(`${BASE}${path}`, { ...options, headers: { cookie, ...(options.headers ?? {}) } }); }
function inviteToken(url) { return new URL(url).searchParams.get("token"); }
function sessionCookie(response) {
  const values = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const value = values.find((entry) => entry.startsWith("insurvas_partner_session="));
  return value?.split(";", 1)[0] ?? "";
}

async function cleanup() {
  const userIds = [ownerId, adminId, userId, otherPartnerAdminId, offboardUserId, ...invitedIds];
  await db.from("user_invitations").delete().in("user_id", userIds);
  await db.from("partner_users").delete().in("partner_id", [partnerId, otherPartnerId]);
  await db.from("audit_log").delete().in("actor_id", userIds);
  await db.from("login_events").delete().in("user_id", userIds);
  await db.from("tenant_users").delete().in("user_id", [ownerId]);
  await db.from("tenant_entitlements").delete().eq("tenant_id", tenantId);
  await db.from("partners").delete().in("id", [partnerId, otherPartnerId]);
  await db.from("users").delete().in("id", userIds);
  await db.from("tenants").delete().eq("id", tenantId);
}

async function main() {
  await cleanup();
  const passwordHash = await bcrypt.hash("Partner QA password 123!", 4);
  const inserted = await db.from("tenants").insert({ id: tenantId, name: `LA-1.2 verification ${stamp}`, status: "active", onboarding_state: "completed" });
  if (inserted.error) throw new Error(inserted.error.message);
  const users = await db.from("users").insert([
    { id: ownerId, email: `la12-owner-${stamp}@invalid.test`, name: "LA-1.2 owner", password_hash: passwordHash, status: "active" },
    { id: adminId, email: `la12-admin-${stamp}@invalid.test`, name: "Partner administrator", password_hash: passwordHash, status: "active" },
    { id: userId, email: `la12-user-${stamp}@invalid.test`, name: "Partner operator", password_hash: passwordHash, status: "active" },
    { id: otherPartnerAdminId, email: `la12-other-${stamp}@invalid.test`, name: "Other partner administrator", password_hash: passwordHash, status: "active" },
    { id: offboardUserId, email: `la12-offboard-${stamp}@invalid.test`, name: "Offboarded operator", password_hash: passwordHash, status: "active" },
  ]);
  if (users.error) throw new Error(users.error.message);
  const membership = await db.from("tenant_users").insert({ tenant_id: tenantId, user_id: ownerId, role: "owner" });
  if (membership.error) throw new Error(membership.error.message);
  const entitlement = await db.from("tenant_entitlements").insert({ tenant_id: tenantId, entitlement: { tenant_id: tenantId, plan_code: "qa", plan_version: 1, status: "active", access: "full", computed_at: new Date().toISOString(), features: ["publisher_records"], meters: {}, limits: { max_publishers: 10, max_marketing_partners: 10, max_affiliates: 10, max_buffer_seats: null, max_partner_users: 10 } } });
  if (entitlement.error) throw new Error(entitlement.error.message);
  const partners = await db.from("partners").insert([
    { id: partnerId, tenant_id: tenantId, name: "QA Partner A", partner_type: "publisher", status: "active", country: "US", timezone: "America/Phoenix", created_by: ownerId },
    { id: otherPartnerId, tenant_id: tenantId, name: "QA Partner B", partner_type: "publisher", status: "active", country: "US", timezone: "America/Phoenix", created_by: ownerId },
  ]);
  if (partners.error) throw new Error(partners.error.message);
  const memberships = await db.from("partner_users").insert([
    { id: randomUUID(), tenant_id: tenantId, partner_id: partnerId, user_id: adminId, role: "partner_admin", status: "active", accepted_at: new Date().toISOString() },
    { id: randomUUID(), tenant_id: tenantId, partner_id: partnerId, user_id: userId, role: "partner_user", status: "active", accepted_at: new Date().toISOString() },
    { id: randomUUID(), tenant_id: tenantId, partner_id: otherPartnerId, user_id: otherPartnerAdminId, role: "partner_admin", status: "active", accepted_at: new Date().toISOString() },
    { id: randomUUID(), tenant_id: tenantId, partner_id: otherPartnerId, user_id: offboardUserId, role: "partner_user", status: "active", accepted_at: new Date().toISOString() },
  ]);
  if (memberships.error) throw new Error(memberships.error.message);

  const adminLogin = await fetch(`${BASE}/api/partner/auth/login`, { method: "POST", ...json({ email: `la12-admin-${stamp}@invalid.test`, password: "Partner QA password 123!" }) });
  const adminCookie = sessionCookie(adminLogin);
  const userLogin = await fetch(`${BASE}/api/partner/auth/login`, { method: "POST", ...json({ email: `la12-user-${stamp}@invalid.test`, password: "Partner QA password 123!" }) });
  const userCookie = sessionCookie(userLogin);
  check("partner login issues only the partner session", adminLogin.status === 200 && adminCookie.startsWith("insurvas_partner_session=") && !adminLogin.headers.get("set-cookie")?.includes("insurvas_tenant_session"));
  check("partner user login succeeds", userLogin.status === 200 && userCookie.startsWith("insurvas_partner_session="));
  check("missing, expired and forged partner sessions are rejected", (await fetch(`${BASE}/api/partner/me`)).status === 401 && (await api("/api/partner/me", "insurvas_partner_session=forged")).status === 401 && (await api("/api/partner/me", partnerCookie(await partnerToken(adminId, partnerId, "-1s")))).status === 401);
  check("partner session cannot authenticate an agent route", (await api("/api/app/me", adminCookie)).status === 401 && (await api("/api/app/templates", adminCookie)).status === 401);

  const ownUsers = await api("/api/partner/users", adminCookie);
  check("partner admin sees only the current partner users", ownUsers.status === 200 && (await ownUsers.clone().json()).users?.every((row) => [adminId, userId].includes(row.user_id)));
  const crossRole = await api(`/api/partner/users/${userId}`, userCookie, { method: "PATCH", ...json({ action: "deactivate" }) });
  check("partner user cannot manage users", crossRole.status === 403);
  const crossPartner = await api(`/api/partner/users/${otherPartnerAdminId}`, adminCookie, { method: "PATCH", ...json({ action: "deactivate" }) });
  check("partner admin cannot target a different partner", crossPartner.status === 404);

  const invite = await api("/api/partner/users", adminCookie, { method: "POST", ...json({ name: "Invited Operator", email: `la12-invited-${stamp}@invalid.test`, role: "partner_user", partnerId: otherPartnerId, ignored: "<script>alert(1)</script>" }) });
  const inviteBody = await invite.json();
  const invitedId = inviteBody.user?.id;
  if (invitedId) invitedIds.push(invitedId);
  const linked = invitedId ? await db.from("partner_users").select("partner_id, role, status").eq("user_id", invitedId).single() : { data: null };
  check("partner admin cannot redirect an invite by editing the request", invite.status === 201 && linked.data?.partner_id === partnerId && linked.data?.role === "partner_user", JSON.stringify({ status: invite.status, body: inviteBody, linked: linked.data }));
  check("invites use the required portal path and bounded expiry", inviteBody.invite?.url?.includes("/partner/set-password?token=") && new Date(inviteBody.invite.expiresAt).getTime() - Date.now() > 71 * 60 * 60 * 1000, JSON.stringify(inviteBody));

  const token = inviteBody.invite?.url ? inviteToken(inviteBody.invite.url) : "";
  const redemptions = await Promise.all([
    fetch(`${BASE}/api/partner/auth/set-password`, { method: "POST", ...json({ token, password: "Partner invited password 123!" }) }),
    fetch(`${BASE}/api/partner/auth/set-password`, { method: "POST", ...json({ token, password: "Partner invited password 123!" }) }),
  ]);
  check("one-time invitation redemption is concurrency safe", redemptions.filter((response) => response.status === 200).length === 1 && redemptions.filter((response) => response.status === 400).length === 1, JSON.stringify(redemptions.map((response) => response.status)));
  const wrongPlane = await fetch(`${BASE}/api/app/auth/set-password`, { method: "POST", ...json({ token, password: "Partner invited password 123!" }) });
  check("partner invitation cannot be redeemed on the agent endpoint", wrongPlane.status === 400);

  const revoke = await api(`/api/partner/users/${userId}`, adminCookie, { method: "PATCH", ...json({ action: "deactivate" }) });
  check("deactivation succeeds", revoke.status === 200);
  check("deactivation kills the existing session on the next request", (await api("/api/partner/me", userCookie)).status === 401);
  const restore = await api(`/api/partner/users/${userId}`, adminCookie, { method: "PATCH", ...json({ action: "reactivate" }) });
  check("reactivation succeeds", restore.status === 200);

  const offboard = await db.rpc("transition_partner", { p_tenant_id: tenantId, p_partner_id: otherPartnerId, p_next_status: "offboarded", p_confirmation: "OFFBOARD" });
  check("offboarding transition succeeds", !offboard.error);
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
