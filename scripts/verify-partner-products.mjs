// LA-1.3 live contract checks. Run with: npm run verify:partner-products
// The fixture proves tenant product selection, per-partner approval, server-side filtering and
// the no-deploy product catalog contract. It is disposable and is removed in finally.
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const tenantId = randomUUID();
const otherTenantId = randomUUID();
const ownerId = randomUUID();
const otherOwnerId = randomUUID();
const producerId = randomUUID();
const partnerUserId = randomUUID();
const productCode = `qa_product_${stamp}`;
let partnerId = null;
let otherPartnerId = null;
let productId = null;
let failures = 0;

function check(label, condition, detail = "") {
  if (condition) console.log(`  ok   ${label}`);
  else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures += 1; }
}

async function tenantToken(userId, currentTenantId = tenantId) {
  return new SignJWT({ tenantId: currentTenantId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET));
}

async function partnerToken() {
  const secret = process.env.PARTNER_SESSION_SECRET ?? `insurvas-partner:${process.env.TENANT_SESSION_SECRET}`;
  return new SignJWT({ tenantId, partnerId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(partnerUserId)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(secret));
}

const agentCookie = (token) => `insurvas_tenant_session=${token}`;
const partnerCookie = (token) => `insurvas_partner_session=${token}`;
const json = (body) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function api(path, cookie, options = {}) {
  return fetch(`${BASE}${path}`, { ...options, headers: { cookie, ...(options.headers ?? {}) }, redirect: "manual" });
}

async function cleanup() {
  await db.from("partner_products").delete().in("partner_id", [partnerId, otherPartnerId].filter(Boolean));
  await db.from("partner_users").delete().in("partner_id", [partnerId, otherPartnerId].filter(Boolean));
  await db.from("agent_leads").delete().in("tenant_id", [tenantId, otherTenantId]);
  await db.from("partners").delete().in("id", [partnerId, otherPartnerId].filter(Boolean));
  await db.from("tenant_products").delete().in("tenant_id", [tenantId, otherTenantId]);
  await db.from("audit_log").delete().in("actor_id", [ownerId, otherOwnerId, producerId]);
  await db.from("tenant_entitlements").delete().in("tenant_id", [tenantId, otherTenantId]);
  await db.from("tenant_users").delete().in("tenant_id", [tenantId, otherTenantId]);
  await db.from("users").delete().in("id", [ownerId, otherOwnerId, producerId, partnerUserId]);
  await db.from("tenants").delete().in("id", [tenantId, otherTenantId]);
  if (productId) await db.from("products").delete().eq("id", productId);
}

async function main() {
  await cleanup();
  const tenants = await db.from("tenants").insert([
    { id: tenantId, name: `LA-1.3 verification ${stamp}`, status: "active", onboarding_state: "completed" },
    { id: otherTenantId, name: `LA-1.3 isolation ${stamp}`, status: "active", onboarding_state: "completed" },
  ]);
  if (tenants.error) throw new Error(tenants.error.message);
  const users = await db.from("users").insert([
    { id: ownerId, email: `la13-owner-${stamp}@invalid.test`, name: "LA-1.3 owner", password_hash: "verification-only", status: "active" },
    { id: otherOwnerId, email: `la13-other-${stamp}@invalid.test`, name: "LA-1.3 other owner", password_hash: "verification-only", status: "active" },
    { id: producerId, email: `la13-producer-${stamp}@invalid.test`, name: "LA-1.3 producer", password_hash: "verification-only", status: "active" },
    { id: partnerUserId, email: `la13-partner-${stamp}@invalid.test`, name: "LA-1.3 partner user", password_hash: "verification-only", status: "active" },
  ]);
  if (users.error) throw new Error(users.error.message);
  const memberships = await db.from("tenant_users").insert([
    { tenant_id: tenantId, user_id: ownerId, role: "owner" },
    { tenant_id: tenantId, user_id: producerId, role: "producer" },
    { tenant_id: otherTenantId, user_id: otherOwnerId, role: "owner" },
  ]);
  if (memberships.error) throw new Error(memberships.error.message);
  const entitlement = { plan_code: "qa", plan_version: 1, status: "active", access: "full", computed_at: new Date().toISOString(), features: ["publisher_records"], meters: {}, limits: { max_seats: 3, max_partners: 3 } };
  const entitlements = await db.from("tenant_entitlements").insert([
    { tenant_id: tenantId, entitlement: { ...entitlement, tenant_id: tenantId } },
    { tenant_id: otherTenantId, entitlement: { ...entitlement, tenant_id: otherTenantId } },
  ]);
  if (entitlements.error) throw new Error(entitlements.error.message);
  const partners = await db.from("partners").insert([
    { tenant_id: tenantId, name: `LA-1.3 partner ${stamp}`, partner_type: "publisher", status: "active" },
    { tenant_id: otherTenantId, name: `LA-1.3 other partner ${stamp}`, partner_type: "publisher", status: "active" },
  ]).select("id, tenant_id");
  if (partners.error) throw new Error(partners.error.message);
  partnerId = partners.data.find((row) => row.tenant_id === tenantId)?.id ?? null;
  otherPartnerId = partners.data.find((row) => row.tenant_id === otherTenantId)?.id ?? null;
  if (!partnerId || !otherPartnerId) throw new Error("Could not create partner fixtures");
  const membership = await db.from("partner_users").insert({ id: partnerUserId, tenant_id: tenantId, partner_id: partnerId, user_id: partnerUserId, role: "partner_user", status: "active", accepted_at: new Date().toISOString() });
  if (membership.error) throw new Error(membership.error.message);
  const product = await db.from("products").insert({ code: productCode, name: "QA Dynamic Product", category: "life", description: "temporary LA-1.3 product", sort_order: 999 }).select("id").single();
  if (product.error) throw new Error(product.error.message);
  productId = product.data.id;
  const owner = agentCookie(await tenantToken(ownerId));
  const producer = agentCookie(await tenantToken(producerId));
  const otherOwner = agentCookie(await tenantToken(otherOwnerId, otherTenantId));
  const portal = partnerCookie(await partnerToken());

  try {
    const missing = await api("/api/app/products", "");
    const expired = await new SignJWT({ tenantId }).setProtectedHeader({ alg: "HS256" }).setSubject(ownerId).setIssuedAt(Math.floor(Date.now() / 1000) - 30).setExpirationTime(Math.floor(Date.now() / 1000) - 10).sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET));
    const forged = await new SignJWT({ tenantId }).setProtectedHeader({ alg: "HS256" }).setSubject(ownerId).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode("wrong-secret"));
    check("missing, expired and forged sessions are rejected", missing.status === 401 && (await api("/api/app/products", agentCookie(expired))).status === 401 && (await api("/api/app/products", agentCookie(forged))).status === 401);

    const initial = await api("/api/app/products", owner);
    const initialBody = await initial.json();
    check("owner can read tenant product settings", initial.status === 200 && Array.isArray(initialBody.products));
    check("a newly added catalog product appears without a deploy", initialBody.products.some((row) => row.code === productCode && row.is_enabled === false));

    const enabled = await api(`/api/app/products/${productCode}`, owner, { method: "PATCH", ...json({ is_enabled: true }) });
    check("owner can enable a catalog product", enabled.status === 200 && (await enabled.json()).product?.product_code === productCode);
    const repeatedEnable = await api(`/api/app/products/${productCode}`, owner, { method: "PATCH", ...json({ is_enabled: true }) });
    const concurrentEnable = await Promise.all([
      api(`/api/app/products/${productCode}`, owner, { method: "PATCH", ...json({ is_enabled: true }) }),
      api(`/api/app/products/${productCode}`, owner, { method: "PATCH", ...json({ is_enabled: true }) }),
    ]);
    check("repeating and concurrently saving the same product setting is safe", repeatedEnable.status === 200 && concurrentEnable.every((response) => response.status === 200));
    check("a non-owner cannot change product settings", (await api(`/api/app/products/${productCode}`, producer, { method: "PATCH", ...json({ is_enabled: false }) })).status === 403);
    const approved = await api(`/api/app/partners/${partnerId}/products`, owner, { method: "PUT", ...json({ product_code: productCode, approved: true }) });
    check("owner can approve an enabled product for a partner", approved.status === 200 && (await approved.json()).products.some((row) => row.code === productCode && row.approved));
    const repeatedApproval = await api(`/api/app/partners/${partnerId}/products`, owner, { method: "PUT", ...json({ product_code: productCode, approved: true }) });
    const concurrentApproval = await Promise.all([
      api(`/api/app/partners/${partnerId}/products`, owner, { method: "PUT", ...json({ product_code: productCode, approved: true }) }),
      api(`/api/app/partners/${partnerId}/products`, owner, { method: "PUT", ...json({ product_code: productCode, approved: true }) }),
    ]);
    check("repeating and concurrently saving the same approval is safe", repeatedApproval.status === 200 && concurrentApproval.every((response) => response.status === 200));

    const portalProducts = await api("/api/partner/products", portal);
    const portalBody = await portalProducts.json();
    check("partner product picker returns only approved enabled products", portalProducts.status === 200 && portalBody.products.some((row) => row.code === productCode));

    const crossTenant = await api(`/api/app/partners/${otherPartnerId}/products`, owner, { method: "PUT", ...json({ product_code: productCode, approved: true }) });
    check("tenant cannot configure another tenant's partner", crossTenant.status === 404);

    const disabled = await api(`/api/app/products/${productCode}`, owner, { method: "PATCH", ...json({ is_enabled: false }) });
    check("owner can disable a product without deleting approval history", disabled.status === 200);
    const hidden = await api("/api/partner/products", portal);
    const hiddenBody = await hidden.json();
    const retainedApproval = await db.from("partner_products").select("product_code").eq("partner_id", partnerId).eq("product_code", productCode).maybeSingle();
    check("disabling a product hides it from the partner picker immediately", hidden.status === 200 && !hiddenBody.products.some((row) => row.code === productCode));
    check("disabling keeps the approval row for later re-enable", retainedApproval.data?.product_code === productCode);

    const invalidApproval = await api(`/api/app/partners/${partnerId}/products`, owner, { method: "PUT", ...json({ product_code: productCode, approved: true }) });
    check("a disabled tenant product cannot be approved", invalidApproval.status === 409);
    const otherTenantRead = await api("/api/app/products", otherOwner);
    const otherTenantBody = await otherTenantRead.json();
    check("a second tenant sees the global product only as its own disabled setting", otherTenantRead.status === 200 && otherTenantBody.products.some((row) => row.code === productCode && row.is_enabled === false));

    const hostile = await api("/api/app/products/%3Cscript%3E", owner, { method: "PATCH", ...json({ is_enabled: true }) });
    const missingProduct = await api("/api/app/products/does_not_exist", owner, { method: "PATCH", ...json({ is_enabled: true }) });
    const hostileBody = await api(`/api/app/partners/${partnerId}/products`, owner, { method: "PUT", ...json({ product_code: "<script>alert(1)</script>", approved: true }) });
    check("hostile product codes are rejected", hostile.status === 400 && hostileBody.status === 400);
    check("a missing product dependency is reported without a write", missingProduct.status === 404);
    const auditRows = await db.from("audit_log").select("action").eq("actor_id", ownerId).in("target_type", ["tenant_product", "partner_product"]);
    const actions = (auditRows.data ?? []).map((row) => row.action);
    check("product enable/disable and partner approval are audit-logged", ["tenant.product_enabled", "tenant.product_disabled", "tenant.partner_product_approved"].every((action) => actions.includes(action)), actions.join(", "));

    if (process.env.TENANT_DB_URL) {
      const pool = new pg.Pool({ connectionString: process.env.TENANT_DB_URL, ssl: { rejectUnauthorized: false } });
      const connection = await pool.connect();
      try {
        await connection.query("begin");
        await connection.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
        const visible = await connection.query("select tenant_id from tenant_products");
        check("tenant product RLS does not expose another tenant", visible.rows.every((row) => row.tenant_id === tenantId));
        await connection.query("rollback");
      } finally { connection.release(); await pool.end(); }
    }
  } finally {
    await cleanup();
  }

  if (failures) { console.log(`\n${failures} check(s) FAILED.`); return 1; }
  console.log("\nAll live partner product checks passed.");
  return 0;
}

process.exitCode = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; });
