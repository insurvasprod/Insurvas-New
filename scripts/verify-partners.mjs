// LA-1.1 live contract checks. Run with: npm run verify:partners
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.APP_BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const tenantId = randomUUID(); const otherTenantId = randomUUID();
const ownerId = randomUUID(); const producerId = randomUUID(); const otherOwnerId = randomUUID(); const portalUserId = randomUUID();
let failures = 0; let partnerId = null; let otherPartnerId = null; let capacityId = null;

function check(label, condition, detail = "") { if (condition) console.log(`  ok   ${label}`); else { console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`); failures += 1; } }
async function token(userId, id = tenantId) { return new SignJWT({ tenantId: id }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(process.env.TENANT_SESSION_SECRET)); }
const cookie = (value) => `insurvas_tenant_session=${value}`;
async function api(path, session, options = {}) { return fetch(`${BASE}${path}`, { ...options, headers: { cookie: session, ...(options.headers ?? {}) } }); }
const json = (body) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const partner = (name, overrides = {}) => ({ name, partner_type: "publisher", country: "US", contact_name: "Ops", contact_email: "ops@example.test", timezone: "America/Phoenix", notes: "Verification partner", ...overrides });

async function cleanup() {
  for (const id of [tenantId, otherTenantId]) {
    await db.from("partner_users").delete().in("partner_id", [partnerId, otherPartnerId, capacityId].filter(Boolean));
    await db.from("partner_terms").delete().in("partner_id", [partnerId, otherPartnerId, capacityId].filter(Boolean));
    await db.from("agent_leads").delete().eq("tenant_id", id);
    await db.from("partners").delete().eq("tenant_id", id);
    await db.from("audit_log").delete().eq("actor_id", ownerId);
    await db.from("audit_log").delete().eq("actor_id", otherOwnerId);
    await db.from("tenant_entitlements").delete().eq("tenant_id", id);
    await db.from("tenant_users").delete().eq("tenant_id", id);
    await db.from("users").delete().in("id", [ownerId, producerId, otherOwnerId, portalUserId]);
    await db.from("tenants").delete().eq("id", id);
  }
}

async function main() {
  await cleanup();
  const tenants = await db.from("tenants").insert([
    { id: tenantId, name: `LA-1.1 verification ${stamp}`, status: "active", onboarding_state: "completed" },
    { id: otherTenantId, name: `LA-1.1 isolation ${stamp}`, status: "active", onboarding_state: "completed" },
  ]);
  if (tenants.error) throw new Error(tenants.error.message);
  const users = await db.from("users").insert([
    { id: ownerId, email: `la11-owner-${stamp}@invalid.test`, name: "LA-1.1 owner", password_hash: "verification-only", status: "active" },
    { id: producerId, email: `la11-producer-${stamp}@invalid.test`, name: "LA-1.1 producer", password_hash: "verification-only", status: "active" },
    { id: otherOwnerId, email: `la11-other-${stamp}@invalid.test`, name: "LA-1.1 other owner", password_hash: "verification-only", status: "active" },
    { id: portalUserId, email: `la11-portal-${stamp}@invalid.test`, name: "LA-1.1 portal user", password_hash: "verification-only", status: "active" },
  ]);
  if (users.error) throw new Error(users.error.message);
  const memberships = await db.from("tenant_users").insert([
    { tenant_id: tenantId, user_id: ownerId, role: "owner" }, { tenant_id: tenantId, user_id: producerId, role: "producer" }, { tenant_id: otherTenantId, user_id: otherOwnerId, role: "owner" },
  ]);
  if (memberships.error) throw new Error(memberships.error.message);
  const entitlement = { plan_code: "qa", plan_version: 1, status: "active", access: "full", computed_at: new Date().toISOString(), features: ["publisher_records"], meters: {}, limits: { max_seats: 3, max_partners: 2 } };
  const entitlements = await db.from("tenant_entitlements").insert([{ tenant_id: tenantId, entitlement: { ...entitlement, tenant_id: tenantId } }, { tenant_id: otherTenantId, entitlement: { ...entitlement, tenant_id: otherTenantId } }]);
  if (entitlements.error) throw new Error(entitlements.error.message);
  const owner = cookie(await token(ownerId)); const producer = cookie(await token(producerId)); const otherOwner = cookie(await token(otherOwnerId, otherTenantId));

  try {
    const missing = await fetch(`${BASE}/api/app/partners`); const forged = await api("/api/app/partners", "insurvas_tenant_session=forged");
    check("missing and forged sessions are rejected", missing.status === 401 && forged.status === 401);
    check("producer cannot manage partner records", (await api("/api/app/partners", producer)).status === 403);
    const invalid = await api("/api/app/partners", owner, { method: "POST", ...json(partner("<script>alert(1)</script>", { country: "USA" })) });
    check("hostile and malformed partner input is rejected", invalid.status === 400);

    const created = await api("/api/app/partners", owner, { method: "POST", ...json(partner("Apex Call Center")) }); const createdBody = await created.json(); partnerId = createdBody.partner?.id;
    check("owner can create a partner", created.status === 201 && partnerId, JSON.stringify(createdBody));
    const term = await api(`/api/app/partners/${partnerId}`, owner, { method: "PATCH", ...json({ action: "add_term", payout_model: "per_transfer", rate_cents: 8500, rate_pct_bp: null, effective_from: "2026-01-01" }) });
    const termBody = await term.json();
    check("commercial terms save in integer cents and are effective-dated", term.status === 201 && termBody.term?.rate_cents === 8500 && termBody.term?.effective_from === "2026-01-01");
    const secondTerm = await api(`/api/app/partners/${partnerId}`, owner, { method: "PATCH", ...json({ action: "add_term", payout_model: "per_transfer", rate_cents: 9000, rate_pct_bp: null, effective_from: "2026-06-01" }) });
    check("a new rate appends history instead of rewriting the old rate", secondTerm.status === 201 && (await secondTerm.json()).term?.rate_cents === 9000);
    const duplicateTerm = await api(`/api/app/partners/${partnerId}`, owner, { method: "PATCH", ...json({ action: "add_term", payout_model: "per_transfer", rate_cents: 1, rate_pct_bp: null, effective_from: "2026-06-01" }) });
    check("same effective date cannot be silently duplicated", duplicateTerm.status === 400);

    const updated = await api(`/api/app/partners/${partnerId}`, owner, { method: "PATCH", ...json({ action: "update", ...partner("Apex Updated", { partner_type: "marketing", notes: "Updated without deleting history" }) }) });
    check("partner details can be updated", updated.status === 200);
    const activated = await api(`/api/app/partners/${partnerId}`, owner, { method: "PATCH", ...json({ action: "transition", next_status: "active", reason: "Ready to receive submissions" }) });
    check("draft partner can be activated", activated.status === 200 && (await activated.json()).partner?.status === "active");
    const paused = await api(`/api/app/partners/${partnerId}`, owner, { method: "PATCH", ...json({ action: "transition", next_status: "paused", reason: "Temporary quality review" }) });
    check("pausing is an atomic lifecycle transition", paused.status === 200 && (await paused.json()).partner?.status === "paused");
    const offboardWithoutConfirmation = await api(`/api/app/partners/${partnerId}`, owner, { method: "PATCH", ...json({ action: "transition", next_status: "offboarded", reason: "Close partner relationship" }) });
    check("offboarding requires typed confirmation", offboardWithoutConfirmation.status === 400, `status ${offboardWithoutConfirmation.status}, body ${JSON.stringify(await offboardWithoutConfirmation.clone().json().catch(() => null))}`);

    const partnerUser = await db.from("partner_users").insert({ tenant_id: tenantId, partner_id: partnerId, user_id: portalUserId, role: "partner_user", status: "active" });
    if (partnerUser.error) throw new Error(partnerUser.error.message);
    const leadTemplate = await db.from("templates").select("id").eq("product_code", "term_life").eq("is_active", true).limit(1).maybeSingle();
    if (leadTemplate.data) {
      const pipeline = await db.from("pipelines").select("id").eq("tenant_id", tenantId).eq("partner_type", "marketing").eq("is_default", true).single();
      const stage = pipeline.data ? await db.from("pipeline_stages").select("id").eq("pipeline_id", pipeline.data.id).eq("name", "Form Lead").single() : { data: null };
      const lead = await db.from("agent_leads").insert({ tenant_id: tenantId, template_id: leadTemplate.data.id, template_version: 1, product_line: "term_life", pipeline_id: pipeline.data?.id, stage_id: stage.data?.id, values: { source: "LA-1.1 verification" }, created_by: ownerId, partner_id: partnerId });
      if (lead.error) throw new Error(lead.error.message);
    }
    const offboarded = await api(`/api/app/partners/${partnerId}`, owner, { method: "PATCH", ...json({ action: "transition", next_status: "offboarded", reason: "Relationship ended after review", confirmation: "OFFBOARD" }) });
    const offboardedBody = await offboarded.json();
    check("offboarding succeeds only with typed confirmation", offboarded.status === 200 && offboardedBody.partner?.status === "offboarded", `status ${offboarded.status}, body ${JSON.stringify(offboardedBody)}`);
    const revoked = await db.from("partner_users").select("status, revoked_at").eq("partner_id", partnerId).maybeSingle();
    check("offboarding revokes every partner portal membership", revoked.data?.status === "revoked" && revoked.data?.revoked_at);
    const retained = await db.from("agent_leads").select("id").eq("partner_id", partnerId);
    check("offboarding preserves lead history", !retained.error && (retained.data?.length ?? 0) <= 1);

    const capacity = await api("/api/app/partners", owner, { method: "POST", ...json(partner("Capacity holder")) }); const capacityBody = await capacity.json(); capacityId = capacityBody.partner?.id;
    check("an active partner occupies a plan-limit slot", capacity.status === 201 && capacityId);

    const concurrent = await Promise.all([
      api("/api/app/partners", owner, { method: "POST", ...json(partner("Concurrent A")) }),
      api("/api/app/partners", owner, { method: "POST", ...json(partner("Concurrent B")) }),
    ]);
    const concurrentBodies = await Promise.all(concurrent.map((response) => response.json()));
    const successful = concurrentBodies.map((body) => body.partner?.id).filter(Boolean); otherPartnerId = successful[0] ?? null;
    check("concurrent creates respect the cached partner limit atomically", concurrent.filter((response) => response.status === 201).length === 1 && concurrent.some((response) => response.status === 409), `${JSON.stringify(concurrent.map((response) => response.status))} ${JSON.stringify(concurrentBodies)}`);
    const limit = await api("/api/app/partners", owner, { method: "POST", ...json(partner("Over limit")) });
    check("plan partner limit rejects another create", limit.status === 409);

    const ownList = await api("/api/app/partners", owner); const ownBody = await ownList.json();
    const otherList = await api("/api/app/partners", otherOwner); const otherBody = await otherList.json();
    check("list is tenant-scoped", ownList.status === 200 && ownBody.partners?.every((row) => row.tenant_id === tenantId) && otherList.status === 200 && !otherBody.partners?.some((row) => row.id === partnerId));
    const auditRows = await db.from("audit_log").select("action, reason").eq("actor_id", ownerId).in("action", ["tenant.partner_created", "tenant.partner_updated", "tenant.partner_term_added", "tenant.partner_lifecycle_changed"]);
    check("successful partner writes have audit rows with lifecycle reason", (auditRows.data?.length ?? 0) >= 7 && auditRows.data?.some((row) => row.action === "tenant.partner_lifecycle_changed" && row.reason));

    const tenantUrl = process.env.TENANT_DB_URL;
    if (!tenantUrl) throw new Error("TENANT_DB_URL is required for direct RLS checks");
    const connection = new pg.Client({ connectionString: tenantUrl, ssl: { rejectUnauthorized: false } }); await connection.connect();
    try {
      await connection.query("begin"); await connection.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
      const scoped = await connection.query("select tenant_id from public.partners");
      check("direct tenant_app reads cannot cross tenants", scoped.rows.every((row) => row.tenant_id === tenantId));
      await connection.query("rollback");
    } finally { await connection.end(); }
  } finally { await cleanup(); }
  if (failures) return 1;
  console.log("\nAll live partner lifecycle checks passed."); return 0;
}

process.exitCode = await main().catch(async (error) => { console.error(error); await cleanup(); return 1; });
