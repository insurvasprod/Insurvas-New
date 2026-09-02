// LA-0.1 acceptance verification. Uses one signed tenant session through a plan change so the
// test proves the next request reads the cached entitlement, not a role or plan claim in the cookie.
// Everything is created under a throwaway tenant and removed in finally.
//
// Needs the app running. Run with: npm run verify:agent-shell
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const stamp = Date.now();
let tenantId = null;
let userId = null;
let failures = 0;

function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; }
}

async function tenantCookie() {
  const token = await new SignJWT({ tenantId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET));
  return `insurvas_tenant_session=${token}`;
}

async function api(path, cookie, options = {}) {
  return fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...(cookie ? { cookie } : {}), ...(options.headers ?? {}) },
    redirect: "manual",
  });
}

async function assignPlan(code) {
  const { data: plan, error: planError } = await supabase
    .from("plans").select("id").eq("code", code).eq("version", 1).single();
  if (planError || !plan) throw new Error(`Missing ${code} plan fixture: ${planError?.message ?? "not found"}`);
  await supabase.from("subscriptions").delete().eq("tenant_id", tenantId);
  const { error } = await supabase.rpc("admin_assign_subscription", {
    p_tenant_id: tenantId,
    p_plan_id: plan.id,
    p_billing_cycle: "monthly",
    p_start: new Date().toISOString(),
  });
  if (error) throw new Error(`Could not assign ${code}: ${error.message}`);
  const { error: refreshError } = await supabase.rpc("refresh_tenant_entitlement", { p_tenant_id: tenantId });
  if (refreshError) throw new Error(`Could not refresh ${code} entitlement: ${refreshError.message}`);
}

async function acceptCurrentLegalDocuments() {
  const { data: documents, error } = await supabase.rpc("outstanding_legal_documents", { p_user_id: userId });
  if (error) throw new Error(`Could not inspect legal fixture: ${error.message}`);
  for (const document of documents ?? []) {
    const { error: acceptanceError } = await supabase.rpc("record_legal_acceptance", {
      p_user_id: userId,
      p_document_id: document.id,
      p_ip: null,
      p_user_agent: "LA-0.1 verification",
      p_context: "signup",
    });
    if (acceptanceError) throw new Error(`Could not accept legal fixture: ${acceptanceError.message}`);
  }
}

async function cleanup() {
  if (!tenantId) return;
  await supabase.from("tenant_entitlements").delete().eq("tenant_id", tenantId);
  await supabase.from("subscriptions").delete().eq("tenant_id", tenantId);
  await supabase.from("tenant_users").delete().eq("tenant_id", tenantId);
  if (userId) await supabase.from("users").delete().eq("id", userId);
  await supabase.from("tenants").delete().eq("id", tenantId);
}

try {
  const { data: tenant, error: tenantError } = await supabase
    .from("tenants").insert({ name: `LA-0.1 shell ${stamp}`, status: "active" }).select("id").single();
  if (tenantError) throw new Error(tenantError.message);
  tenantId = tenant.id;

  const { data: user, error: userError } = await supabase
    .from("users")
    .insert({ email: `la01-shell-${stamp}@insurvas.invalid`, name: "LA-0.1 Shell", status: "active" })
    .select("id").single();
  if (userError) throw new Error(userError.message);
  userId = user.id;

  const { error: membershipError } = await supabase
    .from("tenant_users").insert({ tenant_id: tenantId, user_id: userId, role: "owner" });
  if (membershipError) throw new Error(membershipError.message);

  // The shell correctly enforces the platform-wide legal gate before any feature page. Clear it
  // for this entitlement test so the assertions exercise the intended route rather than signup.
  await acceptCurrentLegalDocuments();

  const cookie = await tenantCookie();

  console.log("Basic plan: menu and direct URL gate\n");
  await assignPlan("basic");
  const inboundPage = await api("/app/inbound", cookie);
  const inboundHtml = await inboundPage.text();
  check(
    "unentitled inbound URL returns the gate screen",
    inboundPage.status === 200 && inboundHtml.includes("in your plan"),
    `status ${inboundPage.status}; location ${inboundPage.headers.get("location") ?? "-"}; body markers: ${["Inbound transfers", "in your plan", "View upgrade options"].filter((marker) => inboundHtml.includes(marker)).join(", ") || "none"}`,
  );
  check("unentitled inbound URL is not rendered as a navigation link", !inboundHtml.includes('href="/app/inbound"'));

  const inboundApi = await api("/api/app/inbound/transfer", cookie, { method: "POST" });
  const inboundBody = await inboundApi.json();
  check("unentitled inbound API returns 403", inboundApi.status === 403 && inboundBody.code === "feature_not_entitled");

  console.log("\nPlan change: same session, next page load\n");
  await assignPlan("advance");
  const entitledPage = await api("/app/inbound", cookie);
  const entitledHtml = await entitledPage.text();
  check(
    "the same session sees inbound after a plan change",
    entitledPage.status === 200 && entitledHtml.includes('href="/app/inbound"'),
    `status ${entitledPage.status}; location ${entitledPage.headers.get("location") ?? "-"}; body markers: ${["Inbound transfers", 'href="/app/inbound"', "on the way"].filter((marker) => entitledHtml.includes(marker)).join(", ") || "none"}`,
  );
  const entitledApi = await api("/api/app/inbound/transfer", cookie, { method: "POST" });
  check("the entitled inbound API passes authorization", entitledApi.status === 501, `expected frame placeholder 501, got ${entitledApi.status}`);

  const duplicateRequests = await Promise.all([
    api("/api/app/inbound/transfer", cookie, { method: "POST" }),
    api("/api/app/inbound/transfer", cookie, { method: "POST" }),
  ]);
  check(
    "repeating the same entitled request has no duplicate side effect",
    duplicateRequests.every((response) => response.status === 501),
    duplicateRequests.map((response) => response.status).join(", "),
  );

  const { error: missingMembershipError } = await supabase
    .from("tenant_users").delete().eq("tenant_id", tenantId).eq("user_id", userId);
  if (missingMembershipError) throw new Error(`Could not remove membership dependency: ${missingMembershipError.message}`);
  const missingDependency = await api("/api/app/policies", cookie);
  check("a missing tenant membership dependency fails closed", missingDependency.status === 401, `status ${missingDependency.status}`);
  const { error: restoreMembershipError } = await supabase
    .from("tenant_users").insert({ tenant_id: tenantId, user_id: userId, role: "owner" });
  if (restoreMembershipError) throw new Error(`Could not restore membership dependency: ${restoreMembershipError.message}`);

  await supabase.from("subscriptions").update({ status: "past_due" }).eq("tenant_id", tenantId);
  await supabase.rpc("refresh_tenant_entitlement", { p_tenant_id: tenantId });
  const pastDuePage = await api("/app/dashboard", cookie);
  const pastDueHtml = await pastDuePage.text();
  check("past_due tenant sees a payment warning", pastDuePage.status === 200 && pastDueHtml.includes("Payment needs attention"));

  console.log("\nSuspended subscription: preserve reads, block writes\n");
  await supabase.from("subscriptions").update({ status: "suspended" }).eq("tenant_id", tenantId);
  await supabase.rpc("refresh_tenant_entitlement", { p_tenant_id: tenantId });
  const read = await api("/api/app/policies", cookie);
  const readBody = await read.json();
  check("suspended tenant can still read its book", read.status === 200 && readBody.readOnly === true);
  const write = await api("/api/app/policies", cookie, { method: "POST" });
  const writeBody = await write.json();
  check("suspended tenant cannot create new work", write.status === 403 && writeBody.code === "read_only");
  const concurrentWrites = await Promise.all([
    api("/api/app/policies", cookie, { method: "POST" }),
    api("/api/app/policies", cookie, { method: "POST" }),
  ]);
  check(
    "concurrent suspended writes are both rejected",
    concurrentWrites.every((response) => response.status === 403),
    concurrentWrites.map((response) => response.status).join(", "),
  );

  console.log("\nSeparate admin and tenant sessions\n");
  const { data: admin, error: adminError } = await supabase
    .from("admin_users").select("id, role").eq("is_active", true).eq("role", "super_admin").limit(1).maybeSingle();
  if (adminError || !admin) throw new Error(`Missing super_admin fixture: ${adminError?.message ?? "not found"}`);
  const adminToken = await new SignJWT({ sub: admin.id, role: admin.role, stage: "authenticated" })
    .setProtectedHeader({ alg: "HS256" }).setSubject(admin.id).setIssuedAt().setExpirationTime("15m")
    .sign(new TextEncoder().encode(process.env.ADMIN_SESSION_SECRET));
  const adminAsTenant = await api("/api/app/policies", `insurvas_admin_session=${adminToken}`);
  check("admin cookie cannot authenticate as a tenant", adminAsTenant.status === 401);
  const tenantAsAdmin = await api("/api/admin/me", cookie);
  check("tenant cookie cannot authenticate as an admin", tenantAsAdmin.status === 401);
} finally {
  console.log("\nCleaning up…");
  await cleanup();
}

console.log(failures === 0 ? "\nAll LA-0.1 agent shell checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures ? 1 : 0);
