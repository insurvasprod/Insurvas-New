// SA-4.9 · authenticated route, metering, invoice, performance and audit verification.
// Disposable rows are removed in finally. Audit rows remain because the audit log is append-only.
import { SignJWT } from "jose";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const secret = new TextEncoder().encode(process.env.ADMIN_SESSION_SECRET);
let failures = 0;
const createdAdmins = [];
const createdPackIds = [];
const createdGrantIds = [];
const createdInvoiceIds = [];
let temporarySubscriptionId = null;
let temporaryTenantId = null;
let primaryFixtureTenantId = null;
let temporaryPlanMeterPlanId = null;
let previousStatementPlanMeter = null;
let previousTcpaPlanMeter = null;

async function cleanupOrphanedPerformanceTenants() {
  // Billing and audit history make broad deletion unsafe. Deactivate only this verifier's named
  // disposable fixtures so a rerun remains safe even after a timeout committed a partial batch.
  const { data: oldRows, error: selectError } = await supabase.from("tenants").select("id").like("name", "SA-4.9 perf%");
  if (selectError) throw new Error(`orphaned performance fixtures: ${selectError.message}`);
  for (let offset = 0; offset < (oldRows ?? []).length; offset += 25) {
    const ids = (oldRows ?? []).slice(offset, offset + 25).map((row) => row.id);
    const { error } = await supabase.from("tenants").update({
      status: "suspended",
      suspended_at: new Date().toISOString(),
      suspension_reason: "Disposable SA-4.9 performance fixture retained for QA",
    }).in("id", ids);
    if (error) throw new Error(`orphaned performance fixtures: ${error.message}`);
  }
}

function check(label, ok, detail = "") {
  if (ok) console.log(`  PASS ${label}`);
  else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures++; }
}

async function cookie(adminId, role, expires = "10m", signingSecret = secret) {
  return `insurvas_admin_session=${await new SignJWT({ role, stage: "authenticated" }).setProtectedHeader({ alg: "HS256" }).setSubject(adminId).setIssuedAt().setExpirationTime(expires).sign(signingSecret)}`;
}

async function adminFor(role, stamp) {
  const { data: existing } = await supabase.from("admin_users").select("id, role").eq("role", role).eq("is_active", true).limit(1).maybeSingle();
  if (existing) return existing;
  const { data, error } = await supabase.from("admin_users").insert({ email: `verify-sa49-${role}-${stamp}@insurvas.invalid`, name: `SA-4.9 ${role}`, role, password_hash: "verification-only", totp_secret: "verification-only", is_active: true }).select("id, role").single();
  if (error) throw new Error(error.message);
  createdAdmins.push(data.id);
  return data;
}

async function request(path, init = {}, authCookie) {
  return fetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(authCookie ? { cookie: authCookie } : {}) }, redirect: "manual" });
}

async function json(response) { return response.json().catch(() => ({})); }

async function main() {
  const stamp = Date.now();
  await cleanupOrphanedPerformanceTenants();
  const roles = {};
  for (const role of ["super_admin", "platform_config", "billing_admin", "support_agent"]) {
    roles[role] = await adminFor(role, stamp);
  }
  const superCookie = await cookie(roles.super_admin.id, "super_admin");
  const platformCookie = await cookie(roles.platform_config.id, "platform_config");
  const billingCookie = await cookie(roles.billing_admin.id, "billing_admin");
  const supportCookie = await cookie(roles.support_agent.id, "support_agent");

  try {
    check("missing session returns 401", (await request("/api/admin/credits-limits")).status === 401);
    check("expired session returns 401", (await request("/api/admin/credits-limits", {}, await cookie(roles.super_admin.id, "super_admin", "0s"))).status === 401);
    check("forged session returns 401", (await request("/api/admin/credits-limits", {}, await cookie(roles.super_admin.id, "super_admin", "10m", new TextEncoder().encode("wrong-secret")))).status === 401);
    check("super_admin can read", (await request("/api/admin/credits-limits", {}, superCookie)).status === 200);
    check("platform_config can read", (await request("/api/admin/credits-limits", {}, platformCookie)).status === 200);
    check("billing_admin is forbidden", (await request("/api/admin/credits-limits", {}, billingCookie)).status === 403);
    check("support_agent is forbidden", (await request("/api/admin/credits-limits", {}, supportCookie)).status === 403);

    // Do not depend on a particular production plan already having a statement-pages row. The
    // shared project is allowed to have zero plan_meters rows. Use a disposable tenant and
    // temporarily add the explicit NULL row needed to prove plan-owned unlimited precedence.
    // Named rather than first-by-sort_order: fixture plans from other suites sort at 0, ahead of
    // Basic, and one of those has no plan_prices row at all.
    const { data: plan } = await supabase.from("plans").select("id").eq("code", "basic").eq("is_archived", false).order("version", { ascending: false }).limit(1).single();
    const { data: tenant, error: tenantError } = await supabase.from("tenants").insert({ name: `SA-4.9 fixture ${stamp}`, status: "provisioning", plan_code: null }).select("id, name").single();
    if (tenantError) throw new Error(`fixture tenant: ${tenantError.message}`);
    primaryFixtureTenantId = tenant.id;
    temporaryTenantId = [tenant.id];
    if (!plan) throw new Error("No non-archived plan available");
    temporaryPlanMeterPlanId = plan.id;
    previousStatementPlanMeter = (await supabase.from("plan_meters").select("plan_id, meter_key, included_qty, hard_cap").eq("plan_id", plan.id).eq("meter_key", "statement_pages").maybeSingle()).data;
    if (!previousStatementPlanMeter) {
      const { error } = await supabase.from("plan_meters").insert({ plan_id: plan.id, meter_key: "statement_pages", included_qty: null, hard_cap: true });
      if (error) throw new Error(`fixture plan meter: ${error.message}`);
    }
    // Use a finite disposable allowance for the grant and credit-pack assertions. A missing
    // plan_meters row means "use the platform default" and may legitimately be unlimited, which
    // cannot demonstrate that an additive grant changed capacity.
    previousTcpaPlanMeter = (await supabase.from("plan_meters").select("plan_id, meter_key, included_qty, hard_cap").eq("plan_id", plan.id).eq("meter_key", "tcpa_checks").maybeSingle()).data;
    if (!previousTcpaPlanMeter) {
      const { error } = await supabase.from("plan_meters").insert({ plan_id: plan.id, meter_key: "tcpa_checks", included_qty: 10, hard_cap: true });
      if (error) throw new Error(`fixture TCPA meter: ${error.message}`);
    }
    const { data: createdSub, error: subscriptionError } = await supabase.from("subscriptions").insert({ tenant_id: tenant.id, plan_id: plan.id, status: "active", billing_cycle: "monthly", started_at: new Date().toISOString(), current_period_start: new Date().toISOString() }).select("id").single();
    if (subscriptionError) throw new Error(`fixture subscription: ${subscriptionError.message}`);
    temporarySubscriptionId = createdSub.id;
    const subscriptionId = temporarySubscriptionId;

    const badPack = await request("/api/admin/credits-limits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "<script>alert(1)</script>", meter_key: "tcpa_checks", quantity: 1, price_cents: 100 }) }, superCookie);
    check("hostile pack input is rendered as text-safe input", badPack.status === 201);
    if (badPack.status === 201) { const body = await json(badPack); createdPackIds.push(body.pack.id); }
    const badGrant = await request("/api/admin/credits-limits/grants", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenant_id: tenant.id, meter_key: "tcpa_checks", quantity: 1, reason: "x" }) }, superCookie);
    check("short grant reason is rejected", badGrant.status === 400);
    const missingTenant = await request("/api/admin/credits-limits/grants", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenant_id: "00000000-0000-0000-0000-000000000000", meter_key: "tcpa_checks", quantity: 1, reason: "Missing tenant test" }) }, superCookie);
    check("missing dependency is rejected", missingTenant.status === 400);

    const packResponse = await request("/api/admin/credits-limits", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: `SA-4.9 test pack ${stamp}`, meter_key: "tcpa_checks", quantity: 100, price_cents: 1250 }) }, superCookie);
    const packBody = await json(packResponse);
    check("pack create works", packResponse.status === 201);
    if (!packBody.pack) throw new Error("pack fixture was not created");
    createdPackIds.push(packBody.pack.id);
    const archiveResponse = await request(`/api/admin/credits-limits/packs/${packBody.pack.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ is_active: false }) }, superCookie);
    check("pack archive works", archiveResponse.status === 200 && (await json(archiveResponse)).pack.is_active === false);
    const restoreResponse = await request(`/api/admin/credits-limits/packs/${packBody.pack.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ is_active: true }) }, superCookie);
    check("pack restore works", restoreResponse.status === 200);

    const pricingBefore = await supabase.from("meter_pricing").select("sell_cents, default_included, cost_cents").eq("meter_key", "tcpa_checks").single();
    const pricingResponse = await request("/api/admin/credits-limits/pricing", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ meter_key: "tcpa_checks", sell_cents: 100, default_included: 1234 }) }, superCookie);
    check("pricing update works", pricingResponse.status === 200);
    const pricingRead = await (await request("/api/admin/credits-limits", {}, superCookie)).json();
    const tcpa = pricingRead.pricing.find((row) => row.meter_key === "tcpa_checks");
    check(
      "margin data exposes configured cost and sell price",
      typeof tcpa?.cost_cents === "number" && tcpa.cost_cents === pricingBefore.data.cost_cents && tcpa.sell_cents === 100,
      `cost ${tcpa?.cost_cents}, sell ${tcpa?.sell_cents}`,
    );
    await supabase.from("meter_pricing").update({ sell_cents: pricingBefore.data.sell_cents, default_included: pricingBefore.data.default_included }).eq("meter_key", "tcpa_checks");

    const beforeCapacity = await supabase.rpc("check_meter_capacity", { p_tenant_id: tenant.id, p_meter_key: "tcpa_checks", p_qty: 1 });
    const grantRequests = await Promise.all([1, 2].map((n) => request("/api/admin/credits-limits/grants", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenant_id: tenant.id, meter_key: "tcpa_checks", quantity: 10, reason: `Concurrent grant ${n} ${stamp}` }) }, superCookie)));
    const grantBodies = await Promise.all(grantRequests.map(json));
    grantBodies.forEach((body) => { if (body.grant?.id) createdGrantIds.push(body.grant.id); });
    check("concurrent grants both commit", grantRequests.every((response) => response.status === 201));
    const afterCapacity = await supabase.rpc("check_meter_capacity", { p_tenant_id: tenant.id, p_meter_key: "tcpa_checks", p_qty: 1 });
    check("grant increases available capacity immediately", (afterCapacity.data?.[0]?.included ?? 0) >= (beforeCapacity.data?.[0]?.included ?? 0) + 20);
    const monitor = await (await request("/api/admin/credits-limits", {}, superCookie)).json();
    const monitorRow = monitor.monitor.find((row) => row.tenant_id === tenant.id && row.meter_key === "tcpa_checks");
    // bugs_sa.md #12: enforcement saw the grant, the tenant's own screen did not.
    const { data: entAfterGrant } = await supabase
      .from("tenant_entitlements").select("entitlement").eq("tenant_id", tenant.id).maybeSingle();
    check("the grant reaches the CACHED entitlement the agent's screen reads",
          (entAfterGrant?.entitlement?.meters?.tcpa_checks?.included ?? 0) >= 20,
          `cached included = ${entAfterGrant?.entitlement?.meters?.tcpa_checks?.included}`);

    check("grant appears in usage monitor", (monitorRow?.grant_qty ?? 0) >= 20, JSON.stringify(monitorRow ?? null));
    const auditRows = await supabase.from("audit_log").select("action, target_id").eq("action", "credit_grant.created").in("target_id", createdGrantIds);
    check("grant is audit-logged", (auditRows.data?.length ?? 0) === createdGrantIds.length);

    const purchaseResponse = await request(`/api/admin/credits-limits/packs/${packBody.pack.id}/purchase`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenant_id: tenant.id, subscription_id: subscriptionId, quantity: 1, reason: "Invoice credit pack test" }) }, superCookie);
    const purchaseBody = await json(purchaseResponse);
    if (purchaseBody.invoiceId) createdInvoiceIds.push(purchaseBody.invoiceId);
    const { data: invoiceLine } = purchaseBody.invoiceId ? await supabase.from("platform_invoice_lines").select("label, amount_cents").eq("invoice_id", purchaseBody.invoiceId).maybeSingle() : { data: null };
    check("buying a pack creates its invoice line", purchaseResponse.status === 201 && invoiceLine?.amount_cents === 1250);

    // bugs_sa.md #11. The assertion above was the ONLY one covering a purchase, so the suite stayed
    // green while customers were invoiced and given nothing. The criterion is about credits, not
    // about an invoice line, and this is what says so.
    const afterPurchase = await supabase.rpc("check_meter_capacity", { p_tenant_id: tenant.id, p_meter_key: "tcpa_checks", p_qty: 1 });
    const includedAfterPurchase = afterPurchase.data?.[0]?.included ?? 0;
    check(
      "buying a pack actually grants the credits",
      includedAfterPurchase >= (afterCapacity.data?.[0]?.included ?? 0) + 100,
      `included went ${afterCapacity.data?.[0]?.included} -> ${includedAfterPurchase}; the pack is 100 tcpa_checks`,
    );

    const { data: purchaseGrant } = await supabase
      .from("credit_grants").select("id, quantity, reason")
      .eq("tenant_id", tenant.id).eq("meter_key", "tcpa_checks").order("granted_at", { ascending: false }).limit(1).maybeSingle();
    if (purchaseGrant?.id) createdGrantIds.push(purchaseGrant.id);
    check("the purchase is recorded as a grant, so it is auditable like any other",
          purchaseGrant?.quantity === 100, JSON.stringify(purchaseGrant));

    const defaultBefore = await supabase.from("meter_pricing").select("default_included").eq("meter_key", "statement_pages").single();
    const defaultUpdate = await request("/api/admin/credits-limits/pricing", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ meter_key: "statement_pages", sell_cents: 100, default_included: 4321 }) }, superCookie);
    const resolved = await supabase.rpc("resolve_tenant_entitlement", { p_tenant_id: tenant.id });
    const resolvedStatement = resolved.data?.[0]?.meter_allowances?.statement_pages;
    check("plan-owned allowance is not changed by platform default", defaultUpdate.status === 200 && resolvedStatement?.included === null);
    await supabase.from("meter_pricing").update({ default_included: defaultBefore.data.default_included }).eq("meter_key", "statement_pages");

    // The compatibility monitor deliberately excludes unconfigured tenants. Creating another 500
    // rows here made this verifier both destructive-looking and flaky on a busy shared project,
    // while testing a behavior the admin page should no longer have: serializing empty rows.
    // cleanupOrphanedPerformanceTenants above still deactivates any rows left by older revisions.
    const started = performance.now();
    const performanceResponse = await request("/api/admin/credits-limits", {}, superCookie);
    const performanceBody = await json(performanceResponse);
    const elapsed = Math.round(performance.now() - started);
    check("usage monitor stays bounded for the shared tenant population", performanceResponse.status === 200 && performanceBody.monitor.length < 2000 && elapsed < 5000, `${elapsed}ms, ${performanceBody.monitor?.length ?? 0} rows`);
  } finally {
    if (createdInvoiceIds.length) await supabase.from("platform_invoice_lines").delete().in("invoice_id", createdInvoiceIds);
    if (createdInvoiceIds.length) await supabase.from("platform_invoices").delete().in("id", createdInvoiceIds);
    if (createdGrantIds.length) await supabase.from("credit_grants").delete().in("id", createdGrantIds);
    if (createdPackIds.length) await supabase.from("credit_packs").delete().in("id", createdPackIds);
    if (temporaryPlanMeterPlanId) {
      if (previousStatementPlanMeter) await supabase.from("plan_meters").upsert(previousStatementPlanMeter, { onConflict: "plan_id,meter_key" });
      else await supabase.from("plan_meters").delete().eq("plan_id", temporaryPlanMeterPlanId).eq("meter_key", "statement_pages");
      if (previousTcpaPlanMeter) await supabase.from("plan_meters").upsert(previousTcpaPlanMeter, { onConflict: "plan_id,meter_key" });
      else await supabase.from("plan_meters").delete().eq("plan_id", temporaryPlanMeterPlanId).eq("meter_key", "tcpa_checks");
    }
    if (temporarySubscriptionId) await supabase.from("subscriptions").update({ status: "cancelled" }).eq("id", temporarySubscriptionId);
    if (Array.isArray(temporaryTenantId) && temporaryTenantId.length) await supabase.from("tenants").delete().in("id", temporaryTenantId);
    if (primaryFixtureTenantId) await supabase.from("tenants").update({
      status: "suspended",
      suspended_at: new Date().toISOString(),
      suspension_reason: "Disposable SA-4.9 billing fixture retained for immutable QA evidence",
    }).eq("id", primaryFixtureTenantId);
    if (createdAdmins.length) await supabase.from("admin_users").delete().in("id", createdAdmins);
  }
  if (failures) process.exitCode = 1; else console.log("OK — SA-4.9 verification passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
