import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";

const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const stamp = Date.now();
const tenantId = randomUUID();
const agentId = randomUUID();
const partnerAdminId = randomUUID();
const partnerUserId = randomUUID();
const activePartnerId = randomUUID();
const pausedPartnerId = randomUUID();
const draftPartnerId = randomUUID();
const password = "LA1DemoAccess2026!";
const emails = {
  agent: `la1-demo-agent-${stamp}@invalid.test`,
  partnerAdmin: `la1-demo-partner-admin-${stamp}@invalid.test`,
  partnerUser: `la1-demo-partner-user-${stamp}@invalid.test`,
};

const features = [
  "publisher_records", "book_of_business", "lead_import", "inbound_transfers",
  "duplicate_detection", "tcpa_checker", "consent_locker", "daily_deal_flow",
  "callback_calendar", "partner_quality", "commission_ledger", "statement_ingestion",
  "appointment_vault", "discrepancy_report", "outbound_dialing", "quoting", "applications",
  "draft_date_optimizer", "chargeback_radar", "payment_repair", "winback", "true_cpa",
  "cohort_persistency", "payout_runs", "partner_portal", "profit_and_loss", "tax_summaries",
  "litigation_packet",
];

async function must(result, label) {
  const settled = await result;
  if (settled.error) throw new Error(`${label}: ${settled.error.message}`);
  return settled.data;
}

function cookieFrom(response, name) {
  const values = response.headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""];
  const entry = values.find((value) => value.startsWith(`${name}=`));
  return entry?.split(";", 1)[0] ?? "";
}

async function api(path, cookie, options = {}) {
  return fetch(`${base}${path}`, { ...options, headers: { ...(options.headers ?? {}), cookie } });
}

const json = (value) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(value) });

async function main() {
  const passwordHash = await bcrypt.hash(password, 12);
  await must(db.from("tenants").insert({ id: tenantId, name: `LA-1 Demo Workspace ${stamp}`, status: "active", onboarding_state: "completed", plan_code: "advance" }), "create demo tenant");
  await must(db.from("users").insert([
    { id: agentId, email: emails.agent, name: "LA Demo Agent", password_hash: passwordHash, status: "active" },
    { id: partnerAdminId, email: emails.partnerAdmin, name: "LA Demo Partner Admin", password_hash: passwordHash, status: "active" },
    { id: partnerUserId, email: emails.partnerUser, name: "LA Demo Partner User", password_hash: passwordHash, status: "active" },
  ]), "create demo users");
  const seededUsers = await db.from("users").select("id, email, password_hash").in("id", [agentId, partnerAdminId, partnerUserId]);
  if (seededUsers.error || seededUsers.data?.length !== 3 || seededUsers.data.some((user) => !user.password_hash)) throw new Error(`demo user seed did not persist password hashes: ${seededUsers.error?.message ?? JSON.stringify(seededUsers.data?.map((user) => ({ id: user.id, email: user.email, hasPassword: Boolean(user.password_hash) })))}`);
  await must(db.from("tenant_users").insert({ tenant_id: tenantId, user_id: agentId, role: "owner", accepted_at: new Date().toISOString() }), "create agent membership");
  await must(db.from("tenant_entitlements").insert({
    tenant_id: tenantId,
    entitlement: { tenant_id: tenantId, plan_code: "advance", plan_version: 1, status: "active", access: "full", computed_at: new Date().toISOString(), features, meters: {}, limits: { max_publishers: 10, max_marketing_partners: 10, max_affiliates: 10, max_partner_users: 25, max_buffer_seats: null, max_seats: 10 } },
  }), "create demo entitlement");
  await must(db.from("partners").insert([
    { id: activePartnerId, tenant_id: tenantId, name: "LA Demo Publisher", partner_type: "publisher", status: "active", country: "US", contact_name: "Alex Morgan", contact_email: "alex@demo.invalid", timezone: "America/Phoenix", notes: "Active partner for the LA-1 demo", created_by: agentId },
    { id: pausedPartnerId, tenant_id: tenantId, name: "LA Demo Marketing Partner", partner_type: "marketing", status: "paused", country: "US", contact_name: "Jamie Lee", contact_email: "jamie@demo.invalid", timezone: "America/New_York", notes: "Paused partner: existing history remains visible", paused_at: new Date().toISOString(), created_by: agentId },
    { id: draftPartnerId, tenant_id: tenantId, name: "LA Demo Affiliate", partner_type: "affiliate", status: "draft", country: "US", contact_name: "Taylor Reed", contact_email: "taylor@demo.invalid", timezone: "America/Chicago", notes: "Draft partner for lifecycle walkthrough", created_by: agentId },
  ]), "create demo partners");
  await must(db.from("partner_terms").insert({ partner_id: activePartnerId, payout_model: "per_transfer", rate_cents: 8500, rate_pct_bp: null, effective_from: "2026-01-01", created_by: agentId }), "create active partner terms");
  await must(db.from("partner_terms").insert({ partner_id: pausedPartnerId, payout_model: "revenue_share", rate_cents: null, rate_pct_bp: 1500, effective_from: "2026-01-01", created_by: agentId }), "create paused partner terms");
  await must(db.from("partner_users").insert([
    { id: randomUUID(), tenant_id: tenantId, partner_id: activePartnerId, user_id: partnerAdminId, role: "partner_admin", status: "active", accepted_at: new Date().toISOString() },
    { id: randomUUID(), tenant_id: tenantId, partner_id: activePartnerId, user_id: partnerUserId, role: "partner_user", status: "active", accepted_at: new Date().toISOString() },
  ]), "create partner portal memberships");
  await must(db.from("tenant_products").upsert({ tenant_id: tenantId, product_code: "term_life", is_enabled: true, sort_order: 1 }, { onConflict: "tenant_id,product_code" }), "enable Term Life");
  await must(db.from("partner_products").insert({ partner_id: activePartnerId, product_code: "term_life", approved_by: agentId }), "approve Term Life for active partner");

  const agentLogin = await fetch(`${base}/api/app/auth/login`, { method: "POST", ...json({ email: emails.agent, password }) });
  if (agentLogin.status !== 200) {
    const row = await db.from("users").select("id, email, status, password_hash").eq("id", agentId).maybeSingle();
    throw new Error(`agent login failed with ${agentLogin.status}: ${await agentLogin.text()} (seeded user ${JSON.stringify({ id: row.data?.id, email: row.data?.email, status: row.data?.status, hasPassword: Boolean(row.data?.password_hash), dbError: row.error?.message })})`);
  }
  const agentCookie = cookieFrom(agentLogin, "insurvas_tenant_session");
  const templates = await api("/api/app/templates", agentCookie);
  if (templates.status !== 200) throw new Error(`template setup failed with ${templates.status}: ${await templates.text()}`);

  const partnerLogin = await fetch(`${base}/api/partner/auth/login`, { method: "POST", ...json({ email: emails.partnerAdmin, password }) });
  if (partnerLogin.status !== 200) throw new Error(`partner admin login failed with ${partnerLogin.status}`);
  const partnerCookie = cookieFrom(partnerLogin, "insurvas_partner_session");
  const products = await api("/api/partner/products", partnerCookie);
  if (products.status !== 200) throw new Error(`partner product check failed with ${products.status}: ${await products.text()}`);

  console.log(JSON.stringify({
    ok: true,
    app: base,
    tenant: { id: tenantId, name: `LA-1 Demo Workspace ${stamp}` },
    credentials: {
      agentOwner: { email: emails.agent, password, login: `${base}/app/login` },
      partnerAdmin: { email: emails.partnerAdmin, password, login: `${base}/partner/login` },
      partnerUser: { email: emails.partnerUser, password, login: `${base}/partner/login` },
    },
    partners: { active: "LA Demo Publisher", paused: "LA Demo Marketing Partner", draft: "LA Demo Affiliate" },
    approvedProducts: products.status === 200 ? (await products.json()).products?.map((product) => product.code) ?? [] : [],
    cleanup: "These are disposable demo records. Remove the tenant by id if the demo should be reset.",
  }, null, 2));
}

process.exitCode = await main().catch((error) => { console.error(error.message); return 1; });
