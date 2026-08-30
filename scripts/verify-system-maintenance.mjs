// SA-4.12 · End-to-end verification through the real HTTP routes.
//
// Run with the development server running on NEXT_PUBLIC_APP_URL (default http://localhost:3000).
// The script provisions one tenant, cleans it up, and leaves audit rows intact as evidence.
import { createClient } from "@supabase/supabase-js";
import { SignJWT } from "jose";
import { hash } from "bcryptjs";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const app = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
if (!supabaseUrl || !serviceKey) throw new Error("Missing Supabase environment variables");
for (const key of ["ADMIN_SESSION_SECRET", "TENANT_SESSION_SECRET"]) if (!process.env[key]) throw new Error(`Missing ${key}`);

const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
const stamp = Date.now();
let tenantId;
let userId;
let announcementIds = [];
let failures = 0;

function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else { failures++; console.log(`  FAIL ${label}${detail ? ` (${detail})` : ""}`); }
}

async function sign(secret, claims) {
  return new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setSubject(claims.sub).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(secret));
}

async function request(path, options = {}, cookie) {
  const headers = new Headers(options.headers);
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${app}${path}`, { ...options, headers, signal: AbortSignal.timeout(8000) });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

const json = (value) => ({ "content-type": "application/json", body: JSON.stringify(value) });

try {
  const { data: plan, error: planError } = await sb.from("admin_plan_list").select("id, code, plan_type").eq("is_archived", false).order("sort_order").limit(1).maybeSingle();
  if (planError || !plan) throw new Error(planError?.message || "No active plan exists");
  const { data: admin, error: adminError } = await sb.from("admin_users").select("id").eq("role", "super_admin").eq("is_active", true).limit(1).maybeSingle();
  if (adminError || !admin) throw new Error(adminError?.message || "No active super admin exists");
  const { data: support } = await sb.from("admin_users").select("id").eq("role", "support_agent").eq("is_active", true).limit(1).maybeSingle();
  const { data: platformConfig } = await sb.from("admin_users").select("id").eq("role", "platform_config").eq("is_active", true).limit(1).maybeSingle();

  const email = `system-verify-${stamp}@verify.invalid`;
  const password = "SystemVerify-Password-123!";
  const created = await sb.rpc("create_tenant_with_owner", { p_tenant_name: `System verify ${stamp}`, p_owner_name: "System Verify", p_owner_email: email, p_owner_password_hash: await hash(password, 12) });
  if (created.error) throw new Error(created.error.message);
  ({ tenant_id: tenantId, user_id: userId } = Array.isArray(created.data) ? created.data[0] : created.data);
  const subscription = await sb.rpc("admin_assign_subscription", { p_tenant_id: tenantId, p_plan_id: plan.id, p_billing_cycle: "monthly", p_start: new Date().toISOString() });
  if (subscription.error) throw new Error(subscription.error.message);
  const entitlement = await sb.rpc("refresh_tenant_entitlement", { p_tenant_id: tenantId });
  if (entitlement.error) throw new Error(entitlement.error.message);

  const adminCookie = `insurvas_admin_session=${await sign(process.env.ADMIN_SESSION_SECRET, { sub: admin.id, role: "super_admin", stage: "authenticated" })}`;
  const supportCookie = support ? `insurvas_admin_session=${await sign(process.env.ADMIN_SESSION_SECRET, { sub: support.id, role: "support_agent", stage: "authenticated" })}` : null;
  const platformCookie = platformConfig ? `insurvas_admin_session=${await sign(process.env.ADMIN_SESSION_SECRET, { sub: platformConfig.id, role: "platform_config", stage: "authenticated" })}` : null;
  const tenantCookie = `insurvas_tenant_session=${await sign(process.env.TENANT_SESSION_SECRET, { sub: userId, tenantId })}`;

  console.log("Auth and permissions");
  check("unauthenticated system read returns 401", (await request("/api/admin/system")).status === 401);
  check("support_agent system read returns 403", supportCookie ? (await request("/api/admin/system", {}, supportCookie)).status === 403 : true, supportCookie ? "" : "no fixture role");
  check("platform_config system read is allowed", platformCookie ? (await request("/api/admin/system", {}, platformCookie)).status === 200 : true, platformCookie ? "" : "no fixture role");

  console.log("Maintenance levels");
  await request("/api/admin/system/maintenance", { method: "PATCH", ...json({ level: "off" }) }, adminCookie);
  check("normal tenant read works", (await request("/api/app/policies", {}, tenantCookie)).status === 200);
  const readOnly = await request("/api/admin/system/maintenance", { method: "PATCH", ...json({ level: "read_only", message: "Deploy in progress — changes are paused." }) }, adminCookie);
  check("read_only saves", readOnly.status === 200);
  check("read_only still allows reads", (await request("/api/app/policies", {}, tenantCookie)).status === 200);
  const write = await request("/api/app/policies", { method: "POST" }, tenantCookie);
  check("read_only write returns a clear non-500 response", write.status === 503 && write.body.code === "maintenance_read_only" && write.body.error.includes("Deploy in progress"), JSON.stringify(write.body));

  const locked = await request("/api/admin/system/maintenance", { method: "PATCH", ...json({ level: "locked", message: "Scheduled platform maintenance." }) }, adminCookie);
  check("locked saves", locked.status === 200);
  check("locked blocks tenant reads with maintenance code", (await request("/api/app/policies", {}, tenantCookie)).status === 503);
  const loginBlocked = await request("/api/app/auth/login", { method: "POST", ...json({ email, password }) });
  check("locked blocks tenant login", loginBlocked.status === 503 && loginBlocked.body.code === "maintenance_locked");
  check("admin remains able to use the system while locked", (await request("/api/admin/system", {}, adminCookie)).status === 200);

  console.log("Scheduled window");
  const futureStart = new Date(Date.now() + 60_000).toISOString();
  const futureEnd = new Date(Date.now() + 120_000).toISOString();
  await request("/api/admin/system/maintenance", { method: "PATCH", ...json({ level: "read_only", message: "Upcoming maintenance.", scheduled_start: futureStart, scheduled_end: futureEnd }) }, adminCookie);
  const publicSchedule = await request("/api/maintenance");
  check("future schedule is banner_only before start", publicSchedule.status === 200 && publicSchedule.body.level === "banner_only");
  check("future schedule keeps writes available", (await request("/api/app/policies", { method: "POST" }, tenantCookie)).status === 201);
  const pastStart = new Date(Date.now() - 120_000).toISOString();
  const pastEnd = new Date(Date.now() + 60_000).toISOString();
  await request("/api/admin/system/maintenance", { method: "PATCH", ...json({ level: "read_only", message: "Maintenance is live.", scheduled_start: pastStart, scheduled_end: pastEnd }) }, adminCookie);
  check("active schedule applies its configured level", (await request("/api/app/policies", { method: "POST" }, tenantCookie)).status === 503);
  await request("/api/admin/system/maintenance", { method: "PATCH", ...json({ level: "off" }) }, adminCookie);
  check("turning maintenance off restores writes", (await request("/api/app/policies", { method: "POST" }, tenantCookie)).status === 201);

  console.log("Announcements");
  const now = new Date(Date.now() - 60_000).toISOString();
  const later = new Date(Date.now() + 3_600_000).toISOString();
  const createdAnnouncement = await request("/api/admin/system/announcements", { method: "POST", ...json({ message: `Global announcement ${stamp}`, type: "warning", audience: "all", starts_at: now, ends_at: later, is_dismissible: true }) }, adminCookie);
  const announcementId = createdAnnouncement.body.announcement?.id;
  if (announcementId) announcementIds.push(announcementId);
  check("admin can create an announcement", createdAnnouncement.status === 201 && Boolean(announcementId));
  const active = await request("/api/app/announcements", {}, tenantCookie);
  check("active announcement reaches the tenant", active.status === 200 && active.body.announcements?.some((item) => item.id === announcementId));
  const dismissed = await request(`/api/app/announcements/${announcementId}/dismiss`, { method: "POST" }, tenantCookie);
  check("dismissal succeeds", dismissed.status === 200);
  const afterDismiss = await request("/api/app/announcements", {}, tenantCookie);
  check("dismissed announcement stays dismissed", afterDismiss.status === 200 && !afterDismiss.body.announcements?.some((item) => item.id === announcementId));

  const targeted = await request("/api/admin/system/announcements", { method: "POST", ...json({ message: `Non-matching plan ${stamp}`, type: "info", audience: plan.plan_type === "individual" ? "agency_no_teams" : "individual", starts_at: now, ends_at: later, is_dismissible: true }) }, adminCookie);
  const targetedId = targeted.body.announcement?.id;
  if (targetedId) announcementIds.push(targetedId);
  const targetedRead = await request("/api/app/announcements", {}, tenantCookie);
  check("plan-targeted announcement excludes a different plan", targeted.status === 201 && !targetedRead.body.announcements?.some((item) => item.id === targetedId));

  const editable = await request("/api/admin/system/announcements", { method: "POST", ...json({ message: `Editable announcement ${stamp}`, type: "info", audience: "all", starts_at: now, ends_at: later, is_dismissible: false }) }, adminCookie);
  const editableId = editable.body.announcement?.id;
  if (editableId) announcementIds.push(editableId);
  const updated = await request(`/api/admin/system/announcements/${editableId}`, { method: "PATCH", ...json({ message: `Updated announcement ${stamp}`, type: "critical", audience: "all", starts_at: now, ends_at: later, is_dismissible: false }) }, adminCookie);
  check("admin can edit an announcement", updated.status === 200 && updated.body.announcement?.message.includes("Updated"));
  const refusedDismiss = await request(`/api/app/announcements/${editableId}/dismiss`, { method: "POST" }, tenantCookie);
  check("non-dismissible announcement refuses dismissal", refusedDismiss.status === 400);

  const { data: auditRows } = await sb.from("audit_log").select("action, target_id").in("action", ["maintenance.updated", "announcement.created", "announcement.updated", "announcement.deleted"]);
  check("maintenance changes are audit-logged", (auditRows ?? []).some((row) => row.action === "maintenance.updated"));
  check("announcement changes are audit-logged", announcementIds.every((id) => (auditRows ?? []).some((row) => row.target_id === id)));
} finally {
  console.log("Cleaning up…");
  const admin = await sb.from("admin_users").select("id").eq("role", "super_admin").eq("is_active", true).limit(1).maybeSingle();
  if (admin.data) {
    const adminCookie = `insurvas_admin_session=${await sign(process.env.ADMIN_SESSION_SECRET, { sub: admin.data.id, role: "super_admin", stage: "authenticated" })}`;
    await request("/api/admin/system/maintenance", { method: "PATCH", ...json({ level: "off" }) }, adminCookie);
  }
  for (const id of announcementIds) await sb.from("announcements").delete().eq("id", id);
  if (tenantId) {
    await sb.from("subscriptions").delete().eq("tenant_id", tenantId);
    await sb.from("tenant_entitlements").delete().eq("tenant_id", tenantId);
    await sb.from("tenant_users").delete().eq("tenant_id", tenantId);
    await sb.from("users").delete().eq("id", userId);
    await sb.from("tenants").delete().eq("id", tenantId);
  }
}

console.log(failures === 0 ? "\nAll SA-4.12 checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
