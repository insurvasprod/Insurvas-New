/**
 * QA catalog "AG", Design 1 (agency): seeds the LA-1.25 Alert Demo tenant with a working agency.
 *
 *   D2  teammates (2 producers, 2 assistants, 1 bookkeeper, 2 setters, 1 pending + 1 expired invite)
 *   D3  agency profile, tenant carriers with contract levels and writing numbers, commission
 *       schedules, advance rules
 *   D4  carrier appointments, state licences, one E&O policy, CE records
 *   D5  carrier commission statements with lines and accepted matches, ~10 lines left unmatched
 *   D6  ~120 policies across every status tenant_policies allows
 *   D7  nothing is written: the commission ledger is DERIVED (lib/ledger/service.ts multiplies
 *       tenant_policies by the carrier library). D3 + D6 are what it posts from.
 *   D13 open lapse signals on six active policies
 *   D14 agent notifications, read and unread, for the owner and teammates
 *   D16 statement_pages usage at 80% of the period's allowance, and a trial reminder record
 *
 * Only ever touches tenant d6f3950f-0d88-4e66-869f-0de2ea6b396b ("LA-1.25 Alert Demo") and the one
 * private plan it creates for it. Never sends email: users are created through the same calls the
 * invite path makes (auth.admin.createUser → tenant_invite_user_with_auth → consume_user_password_token
 * → auth.admin.updateUserById) with the invitation token generated here and never mailed.
 *
 * Seats (the one seat rule, lib/tenantTeam/seats.ts, 20260924346000): the database reads the limit
 * from plan_limits.max_seats of the tenant's current plan, and nothing else — there is no per-tenant
 * limit override (tenant_feature_overrides carries features only) and add-ons carry features and
 * meters, not seats. Advance v1 is shared by 11 tenants, so raising its limit would change other
 * tenants. The per-tenant path the product has is the admin's: create a plan (POST /api/admin/plans),
 * give it limits, and move the tenant's subscription onto it (admin_change_subscription_plan +
 * refresh_tenant_entitlement). This script does exactly that with a private, non-public copy of
 * Advance ("qa_d1_advance_team": same features, same prices, 25 seats, and a statement_pages
 * allowance for D16), and writes an audit_log row saying so. The invite RPC still enforces the rule.
 *
 * Idempotent: every row has a deterministic natural key (policy numbers QA-D1-0001…, statement files
 * qa-d1-…, notification source keys qa-d1:…, lapse signal source_ref qa-d1-lapse-…, usage idempotency
 * keys qa-d1-…, emails @qa-demo.insurvas.test, licence/E&O numbers QAD1-…, writing numbers QAD1-…).
 * audit_log is the only touched table with a jsonb metadata column; it carries qa_seed.
 * A second run inserts nothing.
 *
 * Commission statements, their lines and matches cannot be deleted by anyone (20260924260000 revokes
 * DELETE even from service_role); remove them by voiding.
 *
 *   node --env-file=.env.local scripts/seed-qa-agency.mjs --dry-run
 *   node --env-file=.env.local scripts/seed-qa-agency.mjs
 *   node --env-file=.env.local scripts/seed-qa-agency.mjs --rotate-password   # new password for the seeded logins
 */
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

const DRY = process.argv.includes("--dry-run");
const ROTATE = process.argv.includes("--rotate-password");
const TAG = "design1-agency";
const TENANT_ID = "d6f3950f-0d88-4e66-869f-0de2ea6b396b";
const TENANT_NAME = "LA-1.25 Alert Demo";
const OWNER_EMAIL = "demo.agent@insurvas.test";
const EMAIL_DOMAIN = "qa-demo.insurvas.test";
const PLAN_CODE = "qa_d1_advance_team";
const SEAT_LIMIT = 25;
const TODAY = "2026-09-25";
const NOW = Date.now();

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── bookkeeping ───────────────────────────────────────────────────────────────
const stats = new Map();
const notes = [];
function bump(table, kind, n = 1) {
  if (!n) return;
  const row = stats.get(table) ?? { inserted: 0, updated: 0, kept: 0, failed: 0 };
  row[kind] += n;
  stats.set(table, row);
}
function note(line) { notes.push(line); console.log(`  · ${line}`); }
function must(result, what) {
  if (result.error) throw new Error(`${what}: ${[result.error.message, result.error.details, result.error.hint, result.error.code].filter(Boolean).join(" · ")}`);
  return result.data;
}
async function section(name, fn) {
  console.log(`\n── ${name}`);
  try { await fn(); } catch (error) {
    bump(name, "failed");
    note(`FAILED ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ── dates and a deterministic RNG ─────────────────────────────────────────────
const iso = (ms) => new Date(ms).toISOString();
const hoursAgo = (h) => iso(NOW - h * 3600_000);
const daysAgo = (d) => iso(NOW - d * 86400_000);
function addDays(date, days) { return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10); }
function addMonths(date, months) {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const total = (m - 1) + months;
  const year = y + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(d, last))).toISOString().slice(0, 10);
}
function wholeMonthsBetween(from, to) { let n = 0; if (to <= from) return 0; while (addMonths(from, n + 1) <= to) n += 1; return n; }
function daysBetween(from, to) { return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000); }
function mulberry32(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rng = mulberry32(20260925);
const pick = (list) => list[Math.floor(rng() * list.length)];
const between = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── guard: the right tenant, or nothing ───────────────────────────────────────
const tenant = must(await db.from("tenants").select("id, name").eq("id", TENANT_ID).maybeSingle(), "read tenant");
if (!tenant || tenant.name !== TENANT_NAME) { console.error(`Tenant ${TENANT_ID} is not "${TENANT_NAME}". Refusing to seed.`); process.exit(1); }
const owner = must(await db.from("users").select("id, name, email").eq("email", OWNER_EMAIL).maybeSingle(), "read owner");
const ownerMembership = owner ? must(await db.from("tenant_users").select("role").eq("tenant_id", TENANT_ID).eq("user_id", owner.id).maybeSingle(), "read owner membership") : null;
if (!owner || ownerMembership?.role !== "owner") { console.error(`${OWNER_EMAIL} is not the owner of ${TENANT_NAME}. Refusing to seed.`); process.exit(1); }
const subscription = must(await db.from("subscriptions").select("id, plan_id, status, started_at, current_period_start, current_period_end, trial_ends_at").eq("tenant_id", TENANT_ID).neq("status", "cancelled").order("started_at", { ascending: false }).limit(1).maybeSingle(), "read subscription");
console.log(`${DRY ? "DRY RUN — nothing is written. " : ""}Seeding ${TENANT_NAME} (${TENANT_ID}) · owner ${owner.email} · subscription ${subscription?.id ?? "none"} (${subscription?.status ?? "-"})`);

const carrierRows = must(await db.from("carriers").select("id, code, name").is("organization_id", null).eq("is_active", true), "read carrier library");
const CARRIER = Object.fromEntries(carrierRows.map((row) => [row.code, row]));
const productRows = must(await db.from("products").select("code, name").eq("is_active", true), "read products");
const PRODUCT = Object.fromEntries(productRows.map((row) => [row.code, row]));
for (const code of ["americo", "foresters", "national_life", "gerber", "transamerica", "american_national", "aetna"]) if (!CARRIER[code]) { console.error(`Carrier ${code} is missing from the library.`); process.exit(1); }

// Ids of rows this run would create but, in a dry run, does not.
const placeholder = (label) => `<new:${label}>`;
const isPlaceholder = (id) => typeof id === "string" && id.startsWith("<new:");

// =============================================================================
// Seats: a private copy of Advance with room for a team (see header)
// =============================================================================
let qaPlanId = null;
await section("plans", async () => {
  const advance = must(await db.from("plans").select("*").eq("id", subscription.plan_id).maybeSingle(), "read current plan");
  const current = advance?.code === PLAN_CODE ? advance : null;
  const source = current
    ? must(await db.from("plans").select("*").eq("code", "advance").order("version", { ascending: false }).limit(1).single(), "read advance")
    : advance;
  if (source.code !== "advance" && !current) throw new Error(`The tenant is on ${source.code}, not advance; not moving it.`);

  let plan = must(await db.from("plans").select("*").eq("code", PLAN_CODE).eq("version", 1).maybeSingle(), "read qa plan");
  const planRow = { code: PLAN_CODE, version: 1, name: "Advance Team (QA demo)", plan_type: "agency_with_teams", description: `Private copy of Advance with ${SEAT_LIMIT} seats for the QA demo agency (qa_seed ${TAG}). Not sold.`, is_public: false, is_default: false, is_archived: false, sort_order: 90 };
  if (!plan) {
    bump("plans", "inserted");
    if (!DRY) plan = must(await db.from("plans").insert(planRow).select("*").single(), "create qa plan");
  } else bump("plans", "kept");
  qaPlanId = plan?.id ?? placeholder("plan");

  const sourceId = source.id;
  const [features, prices, limits, addons] = await Promise.all([
    db.from("plan_features").select("feature_key").eq("plan_id", sourceId),
    db.from("plan_prices").select("*").eq("plan_id", sourceId).maybeSingle(),
    db.from("plan_limits").select("*").eq("plan_id", sourceId).maybeSingle(),
    db.from("plan_available_addons").select("addon_id").eq("plan_id", sourceId),
  ]);
  const have = plan ? {
    features: must(await db.from("plan_features").select("feature_key").eq("plan_id", plan.id), "read qa features").map((row) => row.feature_key),
    prices: must(await db.from("plan_prices").select("*").eq("plan_id", plan.id).maybeSingle(), "read qa prices"),
    limits: must(await db.from("plan_limits").select("*").eq("plan_id", plan.id).maybeSingle(), "read qa limits"),
    meters: must(await db.from("plan_meters").select("*").eq("plan_id", plan.id), "read qa meters"),
    addons: must(await db.from("plan_available_addons").select("addon_id").eq("plan_id", plan.id), "read qa addons").map((row) => row.addon_id),
  } : { features: [], prices: null, limits: null, meters: [], addons: [] };

  const missingFeatures = must(features, "read advance features").map((row) => row.feature_key).filter((key) => !have.features.includes(key));
  bump("plan_features", "inserted", missingFeatures.length);
  bump("plan_features", "kept", have.features.length);
  if (!DRY && missingFeatures.length) must(await db.from("plan_features").insert(missingFeatures.map((feature_key) => ({ plan_id: plan.id, feature_key }))), "copy features");

  const src = must(prices, "read advance prices");
  const wantPrices = { price_monthly_cents: src.price_monthly_cents, price_quarterly_cents: src.price_quarterly_cents, price_yearly_cents: src.price_yearly_cents, setup_fee_cents: src.setup_fee_cents, trial_days: src.trial_days, currency: src.currency };
  if (!have.prices) { bump("plan_prices", "inserted"); if (!DRY) must(await db.from("plan_prices").insert({ plan_id: plan.id, ...wantPrices }), "copy prices"); }
  else if (Object.keys(wantPrices).some((key) => have.prices[key] !== wantPrices[key])) { bump("plan_prices", "updated"); if (!DRY) must(await db.from("plan_prices").update(wantPrices).eq("plan_id", plan.id), "update prices"); }
  else bump("plan_prices", "kept");

  const srcLimits = must(limits, "read advance limits") ?? {};
  const wantLimits = { max_seats: SEAT_LIMIT, max_carriers: srcLimits.max_carriers ?? null, max_publishers: srcLimits.max_publishers ?? null, max_marketing_partners: srcLimits.max_marketing_partners ?? null, max_affiliates: srcLimits.max_affiliates ?? null, max_buffer_seats: srcLimits.max_buffer_seats ?? null, max_partner_users: srcLimits.max_partner_users ?? null, max_setter_seats: srcLimits.max_setter_seats ?? null, max_active_campaigns: srcLimits.max_active_campaigns ?? null };
  if (!have.limits) { bump("plan_limits", "inserted"); if (!DRY) must(await db.from("plan_limits").insert({ plan_id: plan.id, ...wantLimits }), "set limits"); }
  else if (Object.keys(wantLimits).some((key) => have.limits[key] !== wantLimits[key])) { bump("plan_limits", "updated"); if (!DRY) must(await db.from("plan_limits").update(wantLimits).eq("plan_id", plan.id), "update limits"); }
  else bump("plan_limits", "kept");

  // D16: an allowance on one meter, soft-capped so nothing is ever refused because of it.
  const wantMeter = { meter_key: "statement_pages", included_qty: 250, hard_cap: false };
  const meter = have.meters.find((row) => row.meter_key === wantMeter.meter_key);
  if (!meter) { bump("plan_meters", "inserted"); if (!DRY) must(await db.from("plan_meters").insert({ plan_id: plan.id, ...wantMeter }), "set meter"); }
  else if (meter.included_qty !== wantMeter.included_qty || meter.hard_cap !== wantMeter.hard_cap) { bump("plan_meters", "updated"); if (!DRY) must(await db.from("plan_meters").update(wantMeter).eq("plan_id", plan.id).eq("meter_key", wantMeter.meter_key), "update meter"); }
  else bump("plan_meters", "kept");

  const missingAddons = must(addons, "read advance addons").map((row) => row.addon_id).filter((id) => !have.addons.includes(id));
  bump("plan_available_addons", "inserted", missingAddons.length);
  if (!DRY && missingAddons.length) must(await db.from("plan_available_addons").insert(missingAddons.map((addon_id) => ({ plan_id: plan.id, addon_id }))), "copy addons");

  if (subscription.plan_id === plan?.id) { bump("subscriptions", "kept"); return; }
  bump("subscriptions", "updated");
  note(`seat decision: moving subscription ${subscription.id} from ${source.code} v${source.version} (max_seats ${srcLimits.max_seats ?? "∅"}, shared by other tenants) to private plan ${PLAN_CODE} (max_seats ${SEAT_LIMIT}, same features and prices)`);
  if (DRY) return;
  const changed = must(await db.rpc("admin_change_subscription_plan", { p_subscription_id: subscription.id, p_new_plan_id: plan.id, p_apply_now: true }), "change plan");
  must(await db.rpc("refresh_tenant_entitlement", { p_tenant_id: TENANT_ID }), "refresh entitlement");
  must(await db.from("audit_log").insert({
    actor_type: "system", actor_id: null, action: "subscription.plan_changed", target_type: "subscription", target_id: subscription.id,
    reason: "QA demo agency needs more than one seat; the seat limit is per plan, so the tenant moves to a private copy of Advance.",
    metadata: { qa_seed: TAG, tenantId: TENANT_ID, plan: { from: source.id, to: plan.id }, seatLimit: { from: srcLimits.max_seats ?? null, to: SEAT_LIMIT }, appliedNow: Array.isArray(changed) ? changed[0]?.applied_now : changed?.applied_now, proration: "none: identical prices, trialing, no provider membership" },
  }), "audit plan change");
  bump("audit_log", "inserted");
});

// =============================================================================
// D2 — teammates
// =============================================================================
const TEAM = [
  { key: "marisol", name: "Marisol Vance", role: "producer", phone: "(512) 555-0101", kind: "active", joined: 210, npn: "20448193", states: { TX: "2027-05-31", OK: "2026-11-15", GA: "2027-02-28", FL: "2027-08-31" }, seen: 0.3 },
  { key: "devin", name: "Devin Okafor", role: "producer", phone: "(512) 555-0102", kind: "active", joined: 160, npn: "20551077", states: { TX: "2027-01-31", AZ: "2027-09-30", NC: "2026-10-31" }, seen: 26 },
  { key: "priya", name: "Priya Castellanos", role: "assistant", phone: "(512) 555-0103", kind: "active", joined: 120, seen: 2 },
  { key: "tomas", name: "Tomas Reyes", role: "assistant", phone: "(512) 555-0104", kind: "active", joined: 45, seen: 70 },
  { key: "helen", name: "Helen Marsh", role: "bookkeeper", phone: "(512) 555-0105", kind: "active", joined: 250, seen: 5 },
  { key: "jordan", name: "Jordan Pike", role: "setter", phone: "(512) 555-0106", kind: "active", joined: 90, seen: 0.1 },
  { key: "aaliyah", name: "Aaliyah Brooks", role: "setter", phone: "(512) 555-0107", kind: "active", joined: 30, seen: 1 },
  { key: "colin", name: "Colin Reddy", role: "producer", phone: "(512) 555-0108", kind: "pending", invitedDaysAgo: 1, expiresInHours: 50 },
  { key: "nadia", name: "Nadia Ferris", role: "setter", phone: "(512) 555-0109", kind: "expired", invitedDaysAgo: 7, expiresInHours: -96 },
].map((member) => ({ ...member, email: `${member.name.toLowerCase().replace(/[^a-z]+/g, ".")}@${EMAIL_DOMAIN}` }));

const USER = { owner: owner.id };
let password = null;
function newPassword() { return `Qa-D1-${randomBytes(9).toString("base64url")}-Agency`; }

await section("users", async () => {
  const existingUsers = must(await db.from("users").select("id, email, status, phone").ilike("email", `%@${EMAIL_DOMAIN}`), "read seeded users");
  const byEmail = new Map(existingUsers.map((row) => [row.email.toLowerCase(), row]));
  const memberships = must(await db.from("tenant_users").select("user_id, role, accepted_at").eq("tenant_id", TENANT_ID), "read memberships");
  const memberById = new Map(memberships.map((row) => [row.user_id, row]));
  const needsActive = TEAM.filter((member) => member.kind === "active" && !byEmail.has(member.email));
  const existingActive = TEAM.filter((member) => member.kind === "active" && byEmail.has(member.email));
  if (needsActive.length || ROTATE) password = newPassword();

  for (const member of TEAM) {
    const found = byEmail.get(member.email);
    if (found) {
      USER[member.key] = found.id;
      const membership = memberById.get(found.id);
      bump("users", "kept");
      if (!membership) note(`${member.email} exists but is not a member of ${TENANT_NAME}; left alone (investigate by hand)`);
      else bump("tenant_users", "kept");
      if (found.phone !== member.phone) { bump("users", "updated"); bump("users", "kept", -1); if (!DRY) must(await db.from("users").update({ phone: member.phone }).eq("id", found.id), "set phone"); }
      continue;
    }
    bump("users", "inserted"); bump("auth.users", "inserted"); bump("tenant_users", "inserted"); bump("user_invitations", "inserted");
    if (DRY) { USER[member.key] = placeholder(member.email); continue; }

    // The invite path, exactly (app/api/app/team/route.ts), minus the email.
    const created = await db.auth.admin.createUser({ email: member.email, password: `Invite-${randomUUID()}-Only!`, email_confirm: false, user_metadata: { name: member.name, full_name: member.name, display_name: member.name } });
    if (created.error || !created.data.user) throw new Error(`createUser ${member.email}: ${created.error?.message}`);
    const userId = created.data.user.id;
    const token = randomBytes(32).toString("base64url");
    const tokenHash = sha256(token);
    const expiresAt = member.kind === "active" ? iso(NOW + 72 * 3600_000) : iso(NOW + member.expiresInHours * 3600_000);
    const invited = await db.rpc("tenant_invite_user_with_auth", { p_auth_user_id: userId, p_name: member.name, p_email: member.email, p_role: member.role, p_tenant_id: TENANT_ID, p_token_hash: tokenHash, p_expires_at: expiresAt, p_created_by: owner.id, p_max_buffer_seats: null });
    if (invited.error) {
      await db.auth.admin.deleteUser(userId);
      throw new Error(`tenant_invite_user_with_auth ${member.email}: ${invited.error.message}`);
    }
    USER[member.key] = userId;
    must(await db.from("users").update({ phone: member.phone }).eq("id", userId), "set phone");

    if (member.kind === "active") {
      // The accept path (app/api/app/auth/set-password/route.ts): burn the token, then the Auth credential.
      must(await db.rpc("consume_user_password_token", { p_token_hash: tokenHash, p_password_hash: await bcrypt.hash(password, 12) }), `accept ${member.email}`);
      const updated = await db.auth.admin.updateUserById(userId, { password, email_confirm: true });
      if (updated.error) throw new Error(`set password ${member.email}: ${updated.error.message}`);
      // Joined months ago, not today.
      const joinedAt = daysAgo(member.joined);
      must(await db.from("tenant_users").update({ invited_at: iso(Date.parse(joinedAt) - 2 * 86400_000), accepted_at: joinedAt }).eq("tenant_id", TENANT_ID).eq("user_id", userId), "backdate membership");
      must(await db.from("user_invitations").update({ created_at: iso(Date.parse(joinedAt) - 2 * 86400_000) }).eq("token_hash", tokenHash), "backdate invitation");
    } else {
      const invitedAt = daysAgo(member.invitedDaysAgo);
      must(await db.from("tenant_users").update({ invited_at: invitedAt }).eq("tenant_id", TENANT_ID).eq("user_id", userId), "backdate invite");
      must(await db.from("user_invitations").update({ created_at: invitedAt }).eq("token_hash", tokenHash), "backdate invitation");
    }
    console.log(`  + ${member.role.padEnd(10)} ${member.email} (${member.kind})`);
  }

  // One password for every seeded login: when new ones were created alongside existing ones, or on request.
  if (password && !DRY && (existingActive.length && (needsActive.length || ROTATE))) {
    for (const member of existingActive) {
      const id = USER[member.key];
      const updated = await db.auth.admin.updateUserById(id, { password, email_confirm: true });
      if (updated.error) throw new Error(`rotate ${member.email}: ${updated.error.message}`);
      must(await db.from("users").update({ password_hash: await bcrypt.hash(password, 12) }).eq("id", id), "rotate legacy hash");
      bump("auth.users", "updated");
    }
  }
  if (password && !DRY) console.log(`\n  >>> Password for every seeded ${EMAIL_DOMAIN} login (printed once, stored nowhere): ${password}\n`);
  else if (password && DRY) console.log(`  (a password would be generated and printed once on the real run)`);
  else console.log(`  (no login created or rotated, so no password printed; use --rotate-password to set a new one)`);
});

await section("team details", async () => {
  // Producers' own licences and NPNs, and presence stamps so "Last seen" is not blank for everyone.
  const states = DRY ? [] : must(await db.from("tenant_user_licensed_states").select("user_id, state, expires_on").eq("tenant_id", TENANT_ID), "read licensed states");
  const profiles = DRY ? [] : must(await db.from("tenant_user_producer_profiles").select("user_id, npn, state_licence_numbers").eq("tenant_id", TENANT_ID), "read producer profiles");
  const activity = DRY ? [] : must(await db.from("tenant_member_activity").select("user_id, last_seen_at").eq("tenant_id", TENANT_ID), "read activity");
  for (const member of TEAM.filter((m) => m.kind === "active")) {
    const id = USER[member.key];
    if (!id) continue;
    if (member.states) {
      const want = Object.entries(member.states).map(([state, expires_on]) => ({ state, expires_on })).sort((a, b) => a.state.localeCompare(b.state));
      const have = states.filter((row) => row.user_id === id).map((row) => ({ state: row.state, expires_on: row.expires_on?.slice(0, 10) ?? null })).sort((a, b) => a.state.localeCompare(b.state));
      if (same(want, have)) bump("tenant_user_licensed_states", "kept", want.length);
      else {
        bump("tenant_user_licensed_states", have.length ? "updated" : "inserted", want.length);
        if (!DRY) must(await db.rpc("set_tenant_user_licensed_states_with_expiry", { p_tenant_id: TENANT_ID, p_user_id: id, p_rows: want }), `licensed states ${member.email}`);
      }
      const numbers = Object.fromEntries(Object.keys(member.states).map((state, i) => [state, `QAD1-${state}-${member.npn.slice(-4)}${i}`]));
      const profile = profiles.find((row) => row.user_id === id);
      if (!profile) { bump("tenant_user_producer_profiles", "inserted"); if (!DRY) must(await db.from("tenant_user_producer_profiles").insert({ tenant_id: TENANT_ID, user_id: id, npn: member.npn, state_licence_numbers: numbers }), "producer profile"); }
      else if (profile.npn !== member.npn || !same(profile.state_licence_numbers, numbers)) { bump("tenant_user_producer_profiles", "updated"); if (!DRY) must(await db.from("tenant_user_producer_profiles").update({ npn: member.npn, state_licence_numbers: numbers, updated_at: iso(NOW) }).eq("tenant_id", TENANT_ID).eq("user_id", id), "producer profile"); }
      else bump("tenant_user_producer_profiles", "kept");
    }
    if (activity.some((row) => row.user_id === id)) bump("tenant_member_activity", "kept");
    else { bump("tenant_member_activity", "inserted"); if (!DRY) must(await db.from("tenant_member_activity").insert({ tenant_id: TENANT_ID, user_id: id, last_seen_at: hoursAgo(member.seen * 24) }), "presence"); }
  }
});

// =============================================================================
// D3 — agency profile and the carrier library
// =============================================================================
const C = (code) => CARRIER[code].id;
const NEW_CONTRACTS = [
  { carrier: "americo", effective_from: "2025-01-02", level: 9000, writing: "QAD1-AMR-22910" },
  { carrier: "foresters", effective_from: "2025-01-02", level: 8000, writing: "QAD1-FOR-58812" },
  { carrier: "national_life", effective_from: "2025-01-02", level: 9500, writing: "QAD1-NLG-30447" },
];
// A raise: applies to policies issued after it (lib/ledger/compute.ts). Saved after the advance rules,
// because save_advance_rule wants the active contract to be dated on or before the rule.
const RAISE = { carrier: "americo", effective_from: "2026-06-01", level: 10000, writing: "QAD1-AMR-22910" };
// Existing contracts on this tenant (seed-demo-data.mjs), which the schedules below price.
const EXISTING_LEVELS = { gerber: { from: "2025-09-11", level: 9000 }, transamerica: { from: "2025-11-10", level: 10000 }, american_national: { from: "2025-10-11", level: 8500 }, aetna: { from: "2025-12-10", level: 7500 } };

const SCHEDULE = [
  // carrier, product, level, effective_from, year-1 rate, year-2+ rate (bp of annual premium)
  ["americo", "final_expense", 9000, "2025-01-02", 9000, 500],
  ["americo", "term_life", 9000, "2025-01-02", 8000, 300],
  ["americo", "final_expense", 10000, "2026-06-01", 10000, 500],
  ["americo", "term_life", 10000, "2026-06-01", 9000, 300],
  ["foresters", "final_expense", 8000, "2025-01-02", 8500, 500],
  ["foresters", "whole_life", 8000, "2025-01-02", 7000, 400],
  ["national_life", "term_life", 9500, "2025-01-02", 8500, 300],
  ["national_life", "whole_life", 9500, "2025-01-02", 7500, 400],
  ["gerber", "final_expense", 9000, "2025-09-11", 9000, 500],
  ["gerber", "whole_life", 9000, "2025-09-11", 6500, 400],
  ["transamerica", "term_life", 10000, "2025-11-10", 9500, 300],
  ["transamerica", "final_expense", 10000, "2025-11-10", 10000, 500],
  ["american_national", "term_life", 8500, "2025-10-11", 8000, 300],
  ["american_national", "final_expense", 8500, "2025-10-11", 8500, 500],
  ["aetna", "final_expense", 7500, "2025-12-10", 7500, 500],
].map(([carrier, product, level, from, y1, y2]) => ({ carrier, product, level, from, y1, y2 }));

const ADVANCE = [
  { carrier: "americo", product: "final_expense", months: 9, pct: 7500, claw: 12, type: "full", from: "2025-01-02" },
  { carrier: "americo", product: "term_life", months: 9, pct: 7500, claw: 12, type: "prorated", from: "2025-01-02" },
  { carrier: "foresters", product: "final_expense", months: 9, pct: 7500, claw: 12, type: "full", from: "2025-01-02" },
  { carrier: "foresters", product: "final_expense", months: 6, pct: 5000, claw: 9, type: "prorated", from: "2026-03-01" },
  { carrier: "gerber", product: "final_expense", months: 6, pct: 5000, claw: 12, type: "prorated", from: "2025-09-11" },
  { carrier: "transamerica", product: "term_life", months: 9, pct: 7500, claw: 12, type: "full", from: "2025-11-10" },
  { carrier: "transamerica", product: "final_expense", months: 9, pct: 7500, claw: 12, type: "prorated", from: "2025-11-10" },
  { carrier: "aetna", product: "final_expense", months: 9, pct: 7500, claw: 12, type: "full", from: "2025-12-10" },
];

function levelOn(carrier, date) {
  const rows = [...NEW_CONTRACTS, RAISE].filter((row) => row.carrier === carrier).map((row) => ({ from: row.effective_from, level: row.level }));
  if (EXISTING_LEVELS[carrier]) rows.push(EXISTING_LEVELS[carrier]);
  return rows.filter((row) => row.from <= date).sort((a, b) => b.from.localeCompare(a.from))[0] ?? null;
}
function scheduleOn(carrier, product, level, date) {
  return SCHEDULE.filter((row) => row.carrier === carrier && row.product === product && row.level === level && row.from <= date).sort((a, b) => b.from.localeCompare(a.from))[0] ?? null;
}
function advanceOn(carrier, product, date) {
  return ADVANCE.filter((row) => row.carrier === carrier && row.product === product && row.from <= date).sort((a, b) => b.from.localeCompare(a.from))[0] ?? null;
}

await section("agency_profiles", async () => {
  const existing = must(await db.from("agency_profiles").select("tenant_id").eq("tenant_id", TENANT_ID).maybeSingle(), "read agency profile");
  const business = must(await db.from("business_profiles").select("tenant_id").eq("tenant_id", TENANT_ID).maybeSingle(), "read business profile");
  bump("business_profiles", business ? "kept" : "failed");
  if (!business) note("business_profiles is missing for this tenant (onboarding writes it); not seeded");
  if (existing) { bump("agency_profiles", "kept"); return; }
  bump("agency_profiles", "inserted"); bump("agency_profile_history", "inserted");
  if (DRY) return;
  must(await db.rpc("save_agency_profile", { p_tenant_id: TENANT_ID, p_actor_id: owner.id, p_legal_name: "Ellery & Fields Insurance Group LLC", p_dba: "Ellery & Fields", p_npn: "18442907", p_tax_id_change: false, p_tax_id_ciphertext: null, p_tax_id_last4: null, p_principal_address: "4820 Bluebonnet Ln, Suite 210, Austin, TX 78745", p_timezone: "America/Chicago" }), "save agency profile");
});

async function readContracts() { return must(await db.from("tenant_carriers").select("id, carrier_id, contract_level_bp, writing_number, effective_from, is_active").eq("tenant_id", TENANT_ID), "read tenant carriers"); }
async function saveContract(spec, existing) {
  const row = existing.find((r) => r.carrier_id === C(spec.carrier) && r.effective_from === spec.effective_from);
  if (!row) {
    bump("tenant_carriers", "inserted");
    if (!DRY) must(await db.rpc("save_tenant_carrier", { p_tenant_id: TENANT_ID, p_carrier_id: C(spec.carrier), p_contract_level_bp: spec.level, p_writing_number: spec.writing, p_effective_from: spec.effective_from }), `contract ${spec.carrier}`);
  } else if (row.contract_level_bp !== spec.level || row.writing_number !== spec.writing) {
    bump("tenant_carriers", "updated");
    // Not the RPC: it would deactivate the carrier's other rows.
    if (!DRY) must(await db.from("tenant_carriers").update({ contract_level_bp: spec.level, writing_number: spec.writing }).eq("id", row.id), `contract ${spec.carrier}`);
  } else bump("tenant_carriers", "kept");
}

await section("tenant_carriers + advance_rules", async () => {
  const contracts = await readContracts();
  for (const spec of NEW_CONTRACTS) await saveContract(spec, contracts);
  const kept = contracts.filter((row) => ![...NEW_CONTRACTS, RAISE].some((spec) => C(spec.carrier) === row.carrier_id && spec.effective_from === row.effective_from)).length;
  note(`${kept} tenant_carriers row(s) already on the tenant from earlier seeds are left as they are`);

  const rules = must(await db.from("advance_rules").select("id, carrier_id, product_code, advance_months, advance_pct_bp, clawback_months, clawback_type, effective_from").eq("tenant_id", TENANT_ID), "read advance rules");
  for (const spec of ADVANCE) {
    const row = rules.find((r) => r.carrier_id === C(spec.carrier) && r.product_code === spec.product && r.effective_from === spec.from);
    const values = { advance_months: spec.months, advance_pct_bp: spec.pct, clawback_months: spec.claw, clawback_type: spec.type };
    if (!row) {
      bump("advance_rules", "inserted");
      if (!DRY) must(await db.rpc("save_advance_rule", { p_tenant_id: TENANT_ID, p_carrier_id: C(spec.carrier), p_product_code: spec.product, p_advance_months: spec.months, p_advance_pct_bp: spec.pct, p_clawback_months: spec.claw, p_clawback_type: spec.type, p_effective_from: spec.from }), `advance rule ${spec.carrier}/${spec.product}`);
    } else if (Object.keys(values).some((key) => row[key] !== values[key])) {
      bump("advance_rules", "updated");
      if (!DRY) must(await db.from("advance_rules").update(values).eq("id", row.id), "update advance rule");
    } else bump("advance_rules", "kept");
  }
  await saveContract(RAISE, DRY ? contracts : await readContracts());
});

await section("commission_schedules", async () => {
  const rows = must(await db.from("commission_schedules").select("id, carrier_id, product_code, contract_level_bp, policy_year, rate_bp, effective_from, applies_onward").eq("tenant_id", TENANT_ID), "read schedules");
  for (const spec of SCHEDULE) {
    for (const [year, rate, onward] of [[1, spec.y1, false], [2, spec.y2, true]]) {
      const row = rows.find((r) => r.carrier_id === C(spec.carrier) && r.product_code === spec.product && r.contract_level_bp === spec.level && r.policy_year === year && r.effective_from === spec.from);
      if (row && row.rate_bp === rate && row.applies_onward === onward) { bump("commission_schedules", "kept"); continue; }
      bump("commission_schedules", row ? "updated" : "inserted");
      if (!DRY) must(await db.rpc("save_commission_schedule", { p_tenant_id: TENANT_ID, p_carrier_id: C(spec.carrier), p_product_code: spec.product, p_contract_level_bp: spec.level, p_policy_year: year, p_rate_bp: rate, p_effective_from: spec.from, p_applies_onward: onward }), `schedule ${spec.carrier}/${spec.product}/${year}`);
    }
  }
});

// =============================================================================
// D4 — appointments, licences, E&O, CE
// =============================================================================
const APPOINTMENTS = [
  ["americo", "TX", "active", "2025-01-15", null, null],
  ["americo", "FL", "active", "2025-01-15", null, null],
  ["americo", "GA", "active", "2025-03-03", "2026-10-20", null],      // expires in 25 days
  ["americo", "OK", "pending", "2026-09-10", null, null],
  ["foresters", "TX", "active", "2025-01-20", null, null],
  ["foresters", "AZ", "active", "2025-02-10", null, null],
  ["foresters", "NC", "terminated", "2025-02-10", null, "2026-06-30"],
  ["national_life", "TX", "active", "2025-01-22", null, null],
  ["national_life", "FL", "active", "2025-01-22", "2026-10-02", null], // expires in 7 days
  ["national_life", "OH", "pending", "2026-09-18", null, null],
  ["gerber", "OK", "active", "2025-10-01", null, null],
  ["transamerica", "AZ", "active", "2025-11-20", "2026-09-10", null], // lapsed on the 10th, still marked active
  ["american_national", "GA", "active", "2025-10-20", null, null],
  ["aetna", "OK", "terminated", "2025-12-20", null, "2026-08-31"],
].map(([carrier, state, status, effective_from, expires_at, terminated_at]) => ({ carrier, state, status, effective_from, expires_at, terminated_at }));

const LICENCES = [
  ["OK", "QAD1-OK-4481207", "2027-06-30", "non_resident"],
  ["NC", "QAD1-NC-1190442", "2027-03-31", "non_resident"],
  ["OH", "QAD1-OH-7730915", "2026-11-12", "non_resident"],   // expires in 48 days
  ["PA", "QAD1-PA-6602318", "2028-01-31", "non_resident"],
  ["TN", "QAD1-TN-2219084", "2027-10-31", "non_resident"],
  ["AL", "QAD1-AL-5540021", "2027-04-30", "non_resident"],
  ["SC", "QAD1-SC-3308871", "2026-09-02", "non_resident"],   // expired 23 days ago
  ["MO", "QAD1-MO-9917630", "2027-12-31", "non_resident"],
  ["IL", "QAD1-IL-4402277", "2027-08-31", "non_resident"],
].map(([state, license_number, expires_at, licence_type]) => ({ state, license_number, expires_at, licence_type, lines_of_authority: ["life", "health"] }));

const CE = [
  { state: "TX", credits_required: 24, credits_completed: 18, deadline: "2026-11-30", ethics_required: 3, ethics_completed: 3 },
  { state: "FL", credits_required: 24, credits_completed: 24, deadline: "2027-03-31", ethics_required: 5, ethics_completed: 5 },
  { state: "AZ", credits_required: 24, credits_completed: 9, deadline: "2026-10-15", ethics_required: 3, ethics_completed: 0 },  // 20 days left
  { state: "OK", credits_required: 24, credits_completed: 24, deadline: "2027-06-30", ethics_required: 3, ethics_completed: 3 },
  { state: "GA", credits_required: 24, credits_completed: 10, deadline: "2026-08-30", ethics_required: 3, ethics_completed: 1 },  // overdue
];

await section("appointments", async () => {
  const rows = must(await db.from("appointments").select("id, carrier_id, state, status, effective_from, expires_at, terminated_at").eq("tenant_id", TENANT_ID), "read appointments");
  const insert = [];
  for (const spec of APPOINTMENTS) {
    const row = rows.find((r) => r.carrier_id === C(spec.carrier) && r.state === spec.state && r.effective_from === spec.effective_from);
    const values = { status: spec.status, expires_at: spec.expires_at, terminated_at: spec.terminated_at };
    if (!row) insert.push({ tenant_id: TENANT_ID, carrier_id: C(spec.carrier), state: spec.state, effective_from: spec.effective_from, ...values });
    else if (Object.keys(values).some((key) => (row[key] ?? null) !== values[key])) { bump("appointments", "updated"); if (!DRY) must(await db.from("appointments").update(values).eq("id", row.id), "update appointment"); }
    else bump("appointments", "kept");
  }
  bump("appointments", "inserted", insert.length);
  if (!DRY && insert.length) must(await db.from("appointments").insert(insert), "insert appointments");
  note(`${rows.length} appointment(s) were already on the tenant; ${rows.length + insert.length} after this run`);
});

await section("licenses", async () => {
  const rows = must(await db.from("licenses").select("id, state, license_number, expires_at, licence_type, lines_of_authority").eq("tenant_id", TENANT_ID), "read licences");
  const insert = [];
  for (const spec of LICENCES) {
    const row = rows.find((r) => r.state === spec.state);
    if (!row) { insert.push({ tenant_id: TENANT_ID, ...spec }); continue; }
    if (!row.license_number.startsWith("QAD1-")) { bump("licenses", "kept"); note(`licence ${spec.state} already exists and is not a seeded one; left alone`); continue; }
    const values = { license_number: spec.license_number, expires_at: spec.expires_at, licence_type: spec.licence_type, lines_of_authority: spec.lines_of_authority };
    if (Object.keys(values).some((key) => !same(row[key], values[key]))) { bump("licenses", "updated"); if (!DRY) must(await db.from("licenses").update(values).eq("id", row.id), "update licence"); }
    else bump("licenses", "kept");
  }
  bump("licenses", "inserted", insert.length);
  if (!DRY && insert.length) must(await db.from("licenses").insert(insert), "insert licences");
  note(`${rows.length} licence(s) were already on the tenant; ${rows.length + insert.length} after this run`);
});

await section("eo_policies", async () => {
  const spec = { carrier: "Northfield Professional Liability", policy_number: "QAD1-EO-2026-0417", expires_at: "2027-02-28", coverage_amount_cents: 100_000_000, per_claim_cents: 100_000_000, aggregate_cents: 200_000_000 };
  const row = must(await db.from("eo_policies").select("*").eq("tenant_id", TENANT_ID).eq("policy_number", spec.policy_number).maybeSingle(), "read E&O");
  if (row && Object.keys(spec).every((key) => row[key] === spec[key])) { bump("eo_policies", "kept"); return; }
  bump("eo_policies", row ? "updated" : "inserted");
  if (!DRY) must(await db.rpc("save_eo_policy_with_limits", { p_tenant_id: TENANT_ID, p_carrier: spec.carrier, p_policy_number: spec.policy_number, p_expires_at: spec.expires_at, p_coverage_amount_cents: spec.coverage_amount_cents, p_details: { per_claim_cents: spec.per_claim_cents, aggregate_cents: spec.aggregate_cents } }), "save E&O");
});

await section("ce_records", async () => {
  const rows = must(await db.from("ce_records").select("*").eq("tenant_id", TENANT_ID), "read CE");
  const insert = [];
  for (const spec of CE) {
    const row = rows.find((r) => r.state === spec.state);
    if (!row) { insert.push({ tenant_id: TENANT_ID, ...spec }); continue; }
    const { state, ...values } = spec;
    if (Object.keys(values).some((key) => row[key] !== values[key])) { bump("ce_records", "updated"); if (!DRY) must(await db.from("ce_records").update(values).eq("id", row.id), `update CE ${state}`); }
    else bump("ce_records", "kept");
  }
  bump("ce_records", "inserted", insert.length);
  if (!DRY && insert.length) must(await db.from("ce_records").insert(insert), "insert CE");
});

// =============================================================================
// D6 — the book of business
// =============================================================================
const FIRST = ["Harold", "Rosa", "Walter", "Evelyn", "Clarence", "Dolores", "Raymond", "Juanita", "Eugene", "Loretta", "Marvin", "Bernice", "Curtis", "Gloria", "Leonard", "Irene", "Roland", "Opal", "Vernon", "Lucille", "Dwight", "Maxine", "Floyd", "Imogene", "Arturo", "Yolanda", "Chester", "Wilma", "Otis", "Geneva", "Rufus", "Minnie"];
const LAST = ["Jennings", "Delgado", "Briggs", "Hendricks", "Pruitt", "Castaneda", "Whitlock", "Oyelaran", "Stroud", "Fairbanks", "Mcallister", "Quintero", "Lockhart", "Vasquez", "Tillman", "Abernathy", "Kowalczyk", "Beaumont", "Driscoll", "Nakamura", "Ramsey", "Holloway", "Espinoza", "Carmichael", "Winslow", "Okonkwo", "Pettigrew", "Salgado"];
const BOOK = [
  { carrier: "americo", n: 26, from: "2025-02-03", products: ["final_expense", "term_life"] },
  { carrier: "foresters", n: 18, from: "2025-03-03", products: ["final_expense", "whole_life"] },
  { carrier: "national_life", n: 16, from: "2025-04-01", products: ["term_life", "whole_life"] },
  { carrier: "gerber", n: 16, from: "2025-09-15", products: ["final_expense", "whole_life"] },
  { carrier: "transamerica", n: 16, from: "2025-11-12", products: ["term_life", "final_expense"] },
  { carrier: "american_national", n: 14, from: "2025-10-15", products: ["term_life", "final_expense"] },
  { carrier: "aetna", n: 14, from: "2025-12-15", products: ["final_expense"] },
];
const MONTHLY = { final_expense: [38, 145], term_life: [28, 120], whole_life: [95, 340] };

function buildBook() {
  const policies = [];
  let seq = 0;
  for (const block of BOOK) {
    const span = daysBetween(block.from, "2026-09-18");
    for (let i = 0; i < block.n; i += 1) {
      seq += 1;
      const lastTwo = i >= block.n - 2;
      // The last two per carrier are applications not yet in force (effective next month or pending).
      const effective = lastTwo ? addDays("2026-09-28", between(0, 18)) : addDays(block.from, Math.floor((span * i) / (block.n - 2)) + between(0, 9));
      const product = block.products[i % block.products.length];
      const [lo, hi] = MONTHLY[product];
      const premium = between(lo, hi) * 12 * 100;
      const age = daysBetween(effective, TODAY);
      let status = "active";
      let endedOn = null;
      const roll = rng();
      if (lastTwo || (age < 12 && roll < 0.5)) status = "pending";
      else if (age > 75 && roll < 0.12) { status = "lapsed"; endedOn = addDays(effective, between(60, Math.min(age - 5, 300))); }
      else if (age > 30 && roll > 0.93) { status = "cancelled"; endedOn = addDays(effective, between(10, 28)); }
      const createdOn = status === "pending" && effective > TODAY ? addDays(TODAY, -between(1, 9)) : addDays(effective, -between(6, 24));
      const createdAt = `${createdOn}T${String(between(14, 22)).padStart(2, "0")}:${String(between(0, 59)).padStart(2, "0")}:00Z`;
      const producer = pick(["owner", "owner", "marisol", "marisol", "devin", "devin", "owner"]);
      policies.push({
        policy_number: `QA-D1-${String(seq).padStart(4, "0")}`,
        insured_name: `${pick(FIRST)} ${pick(LAST)}`,
        carrierCode: block.carrier,
        carrier: CARRIER[block.carrier].name,
        productCode: product,
        product: PRODUCT[product].name,
        effective_date: effective,
        annual_premium_cents: premium,
        status,
        endedOn,
        renewal_date: addMonths(effective, 12),
        source: rng() < 0.3 ? "csv" : "manual",
        producer,
        created_at: createdAt,
        updated_at: endedOn ? `${endedOn}T16:30:00Z` : createdAt,
      });
    }
  }
  return policies;
}
const BOOK_ROWS = buildBook();
const POLICY_ID = new Map();

await section("tenant_policies", async () => {
  const rows = must(await db.from("tenant_policies").select("id, policy_number").eq("tenant_id", TENANT_ID).like("policy_number", "QA-D1-%"), "read policies");
  for (const row of rows) POLICY_ID.set(row.policy_number, row.id);
  const insert = BOOK_ROWS.filter((p) => !POLICY_ID.has(p.policy_number));
  bump("tenant_policies", "kept", BOOK_ROWS.length - insert.length);
  bump("tenant_policies", "inserted", insert.length);
  const byStatus = BOOK_ROWS.reduce((acc, p) => ({ ...acc, [p.status]: (acc[p.status] ?? 0) + 1 }), {});
  note(`book: ${BOOK_ROWS.length} policies (${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(", ")}), effective ${BOOK_ROWS.map((p) => p.effective_date).sort()[0]} … ${BOOK_ROWS.map((p) => p.effective_date).sort().at(-1)}`);
  if (DRY) { for (const p of insert) POLICY_ID.set(p.policy_number, placeholder(p.policy_number)); return; }
  if (!insert.length) return;
  const payload = insert.map((p) => ({
    tenant_id: TENANT_ID, policy_number: p.policy_number, insured_name: p.insured_name, carrier: p.carrier, product: p.product,
    effective_date: p.effective_date, annual_premium_cents: p.annual_premium_cents, status: p.status, renewal_date: p.renewal_date,
    source: p.source, created_by: USER[p.producer] && !isPlaceholder(USER[p.producer]) ? USER[p.producer] : owner.id,
    created_at: p.created_at, updated_at: p.updated_at,
  }));
  const created = must(await db.from("tenant_policies").insert(payload).select("id, policy_number"), "insert policies");
  for (const row of created) POLICY_ID.set(row.policy_number, row.id);
});

// =============================================================================
// D13 — lapse risk
// =============================================================================
await section("tenant_policy_lapse_signals", async () => {
  const advanced = BOOK_ROWS.filter((p) => p.status === "active" && p.effective_date >= "2025-12-01" && p.effective_date <= "2026-08-15" && advanceOn(p.carrierCode, p.productCode, p.effective_date));
  const step = Math.max(1, Math.floor(advanced.length / 6));
  const targets = advanced.filter((_, i) => i % step === 0).slice(0, 6);
  const SIGNALS = [
    { kind: "returned_payment", days: 4, note: "Bank returned the September draft: NSF.", by: "helen" },
    { kind: "missed_draft", days: 9, note: "Draft did not run on the 16th; carrier notice received.", by: "marisol" },
    { kind: "missed_draft", days: 3, note: null, by: "devin" },
    { kind: "service_call", days: 12, note: "Customer called asking how to lower the monthly premium.", by: "priya" },
    { kind: "other", days: 6, note: "Daughter says the insured moved into assisted living; payer may change.", by: "owner" },
    { kind: "returned_payment", days: 18, note: "Card declined twice; left a voicemail.", by: "marisol" },
  ];
  const existing = must(await db.from("tenant_policy_lapse_signals").select("id, source_ref").eq("tenant_id", TENANT_ID).like("source_ref", "qa-d1-lapse-%"), "read lapse signals");
  const have = new Set(existing.map((row) => row.source_ref));
  const insert = [];
  targets.forEach((policy, i) => {
    const ref = `qa-d1-lapse-${String(i + 1).padStart(2, "0")}`;
    if (have.has(ref)) { bump("tenant_policy_lapse_signals", "kept"); return; }
    const signal = SIGNALS[i];
    const recorder = USER[signal.by];
    insert.push({ tenant_id: TENANT_ID, policy_id: POLICY_ID.get(policy.policy_number), kind: signal.kind, occurred_on: addDays(TODAY, -signal.days), note: signal.note, source: "manual", source_ref: ref, recorded_by: recorder && !isPlaceholder(recorder) ? recorder : owner.id, recorded_at: `${addDays(TODAY, -signal.days + 1)}T15:05:00Z` });
  });
  bump("tenant_policy_lapse_signals", "inserted", insert.length);
  note(`lapse risk on ${targets.map((p) => p.policy_number).join(", ")}`);
  if (!DRY && insert.length) must(await db.from("tenant_policy_lapse_signals").insert(insert), "insert lapse signals");
});

// =============================================================================
// D5 — carrier commission statements
// =============================================================================
const HEADERS = ["Policy Number", "Insured", "Type", "Amount", "Paid Date"];
const MAPPING = { policyNumber: "Policy Number", insuredName: "Insured", kind: "Type", amount: "Amount", lineDate: "Paid Date" };
const STATEMENTS = [
  { carrier: "americo", start: "2026-03-01", end: "2026-06-30", unmatched: 0, leftUnmatched: 0 },
  { carrier: "american_national", start: "2026-06-01", end: "2026-08-31", unmatched: 0, leftUnmatched: 0 },
  { carrier: "foresters", start: "2026-05-01", end: "2026-07-31", unmatched: 0, leftUnmatched: 2 },
  { carrier: "gerber", start: "2026-05-01", end: "2026-08-31", unmatched: 0, leftUnmatched: 0 },
  { carrier: "americo", start: "2026-07-01", end: "2026-08-31", unmatched: 6, leftUnmatched: 0 },
  { carrier: "national_life", start: "2026-07-01", end: "2026-08-31", unmatched: 4, leftUnmatched: 0 },
];
const MAX_MATCHED_LINES = 26;

/** What the carrier would pay on this statement, from the same library the ledger uses. */
function statementLines(spec) {
  const lines = [];
  const months = [];
  for (let m = spec.start.slice(0, 7) + "-01"; m <= spec.end; m = addMonths(m, 1)) months.push(m);
  for (const p of BOOK_ROWS.filter((row) => row.carrierCode === spec.carrier && row.status !== "pending" && row.effective_date <= spec.end)) {
    if (p.endedOn && p.endedOn < spec.start) continue;
    const contract = levelOn(p.carrierCode, p.effective_date);
    const schedule = contract && scheduleOn(p.carrierCode, p.productCode, contract.level, p.effective_date);
    if (!schedule) continue;
    const yearOne = Math.round((p.annual_premium_cents * schedule.y1) / 10000);
    const rule = advanceOn(p.carrierCode, p.productCode, p.effective_date);
    const advance = rule ? Math.round((yearOne * rule.pct) / 10000) : 0;
    const inWindow = (date) => date >= spec.start && date <= spec.end;
    const endedBy = (date) => p.endedOn && p.endedOn <= date;
    const push = (kind, amount, date) => lines.push({ policy: p, kind, amount, date: date > spec.end ? spec.end : date });
    if (rule) {
      if (inWindow(p.effective_date)) push("advance", advance, addDays(p.effective_date, 9));
      const balanceOn = addMonths(p.effective_date, rule.months);
      if (inWindow(balanceOn) && !endedBy(balanceOn)) push("commission", yearOne - advance, balanceOn);
      if (p.endedOn && inWindow(p.endedOn) && wholeMonthsBetween(p.effective_date, p.endedOn) < rule.claw) {
        const monthsIn = wholeMonthsBetween(p.effective_date, p.endedOn);
        const back = rule.type === "full" ? advance : Math.round((advance * (rule.claw - monthsIn)) / rule.claw);
        push("chargeback", -back, addDays(p.endedOn, 14));
      }
    }
    for (const month of months) {
      const paidOn = addDays(month, 14);
      if (paidOn < p.effective_date || endedBy(paidOn) || paidOn > TODAY) continue;
      const policyYear = wholeMonthsBetween(p.effective_date, paidOn) >= 12 ? 2 : 1;
      if (rule && policyYear === 1) continue; // year one was advanced; its balance posts once
      const rate = policyYear === 1 ? schedule.y1 : schedule.y2;
      push("commission", Math.round((p.annual_premium_cents * rate) / 10000 / 12), paidOn);
    }
  }
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.policy.policy_number.localeCompare(b.policy.policy_number));
  const matched = lines.slice(0, MAX_MATCHED_LINES);
  // A few carriers' figures disagree with the library by a few dollars — the discrepancy report's job.
  matched.forEach((line, i) => { if (i % 11 === 7) line.amount += 1235; });
  if (matched.length > 3) matched.push({ policy: matched[2].policy, kind: "adjustment", amount: -850, date: spec.end });
  return matched;
}

const CARRIER_PREFIX = { americo: "AMR", american_national: "ANL", foresters: "FOR", gerber: "GBR", national_life: "NLG" };
await section("tenant_commission_statements", async () => {
  const existing = must(await db.from("tenant_commission_statements").select("id, original_filename, status").eq("tenant_id", TENANT_ID).like("original_filename", "qa-d1-%"), "read statements");
  const mappings = must(await db.from("tenant_statement_column_mappings").select("carrier_id").eq("tenant_id", TENANT_ID), "read mappings");
  const uploader = USER.helen && !isPlaceholder(USER.helen) ? USER.helen : owner.id;
  let unmatchedTotal = 0;
  for (const [index, spec] of STATEMENTS.entries()) {
    const fileName = `qa-d1-${spec.carrier.replace(/_/g, "-")}-${spec.start}_${spec.end}.csv`;
    const found = existing.find((row) => row.original_filename === fileName);
    const matched = statementLines(spec);
    const extra = [];
    for (let i = 0; i < spec.unmatched + spec.leftUnmatched; i += 1) {
      extra.push({ policy: null, number: `${CARRIER_PREFIX[spec.carrier]}-${7730140 + index * 17 + i}`, insured: `${FIRST[(index * 5 + i * 3) % FIRST.length]} ${LAST[(index * 7 + i * 5) % LAST.length]}`, kind: "commission", amount: between(1800, 9600), date: addDays(spec.start, 14 + i), left: i >= spec.unmatched });
    }
    if (found) {
      bump("tenant_commission_statements", "kept");
      const count = must(await db.from("tenant_commission_statement_lines").select("id", { count: "exact", head: true }).eq("statement_id", found.id), "count lines");
      bump("tenant_commission_statement_lines", "kept", count ?? 0);
      unmatchedTotal += spec.unmatched;
      continue;
    }
    const all = [
      ...matched.map((line) => ({ number: line.policy.policy_number, insured: line.policy.insured_name, kind: line.kind, amount: line.amount, date: line.date, policy: line.policy })),
      ...extra,
    ];
    const kindLabel = { advance: "Advance", commission: "Commission", chargeback: "Chargeback", adjustment: "Adjustment" };
    const raw = all.map((line) => ({ "Policy Number": line.number, Insured: line.insured, Type: kindLabel[line.kind], Amount: (line.amount / 100).toFixed(2), "Paid Date": line.date }));
    const csv = [HEADERS.join(","), ...raw.map((row) => HEADERS.map((h) => `"${String(row[h]).replace(/"/g, '""')}"`).join(","))].join("\n") + "\n";
    const uploadedAt = `${addDays(spec.end, 5 + index)}T16:${String(10 + index * 7).padStart(2, "0")}:00Z`;
    const reviewedAt = `${addDays(spec.end, 6 + index)}T14:${String(20 + index * 5).padStart(2, "0")}:00Z`;
    const stillOpen = spec.unmatched > 0;
    bump("tenant_commission_statements", "inserted");
    bump("tenant_commission_statement_lines", "inserted", all.length);
    bump("tenant_commission_statement_matches", "inserted", matched.length);
    unmatchedTotal += spec.unmatched;
    console.log(`  ${fileName}: ${all.length} lines (${matched.length} matched, ${spec.unmatched} unmatched, ${spec.leftUnmatched} left unmatched) → ${stillOpen ? "review" : "reviewed"}`);
    if (DRY) continue;

    // What import_commission_statement + decide_commission_statement_lines write, dated as the
    // bookkeeper would have done it rather than all "today".
    const statement = must(await db.from("tenant_commission_statements").insert({
      tenant_id: TENANT_ID, carrier_id: C(spec.carrier), period_start: spec.start, period_end: spec.end, original_filename: fileName,
      file_sha256: sha256(csv), headers: HEADERS, column_mapping: MAPPING, row_count: all.length, status: "review", uploaded_by: uploader, uploaded_at: uploadedAt,
    }).select("id").single(), `statement ${fileName}`);
    const lineRows = all.map((line, i) => ({
      tenant_id: TENANT_ID, statement_id: statement.id, line_number: i + 1, raw: raw[i], policy_number: line.number, insured_name: line.insured,
      amount_cents: line.amount, kind: line.kind, line_date: line.date, parse_error: null,
      review_status: line.policy ? "accepted" : line.left ? "left_unmatched" : "unmatched",
      reviewed_by: line.policy || line.left ? uploader : null, reviewed_at: line.policy || line.left ? reviewedAt : null, created_at: uploadedAt,
    }));
    const insertedLines = must(await db.from("tenant_commission_statement_lines").insert(lineRows).select("id, line_number"), `lines ${fileName}`);
    const lineId = new Map(insertedLines.map((row) => [row.line_number, row.id]));
    const matches = all.map((line, i) => line.policy ? { tenant_id: TENANT_ID, line_id: lineId.get(i + 1), policy_id: POLICY_ID.get(line.policy.policy_number), method: "exact", status: "accepted", proposed_by: null, proposed_at: uploadedAt, accepted_by: uploader, accepted_at: reviewedAt } : null).filter(Boolean);
    must(await db.from("tenant_commission_statement_matches").insert(matches), `matches ${fileName}`);
    if (!stillOpen) must(await db.from("tenant_commission_statements").update({ status: "reviewed" }).eq("id", statement.id), "mark reviewed");
  }
  for (const code of [...new Set(STATEMENTS.map((s) => s.carrier))]) {
    if (mappings.some((row) => row.carrier_id === C(code))) { bump("tenant_statement_column_mappings", "kept"); continue; }
    bump("tenant_statement_column_mappings", "inserted");
    if (!DRY) must(await db.from("tenant_statement_column_mappings").insert({ tenant_id: TENANT_ID, carrier_id: C(code), mapping: MAPPING, updated_by: uploader, updated_at: `${addDays(TODAY, -20)}T16:00:00Z` }), "mapping");
  }
  note(`${unmatchedTotal} statement lines are left unmatched, in review`);
});

// =============================================================================
// D14 — agent alerts
// =============================================================================
const CUSTOMERS = ["Harold Jennings", "Rosa Delgado", "Walter Briggs", "Evelyn Hendricks", "Clarence Pruitt", "Dolores Castaneda", "Raymond Whitlock", "Juanita Quintero", "Eugene Stroud", "Loretta Fairbanks", "Marvin Lockhart", "Gloria Vasquez", "Leonard Tillman"];
function alerts() {
  const list = [];
  const add = (recipient, kind, title, body, link, ageHours, read) => list.push({ recipient, kind, title, body, link, ageHours, read });
  // Live in the last day, unread: the bell shows these.
  add("owner", "callback_reminder", `Callback reminder: ${CUSTOMERS[0]}`, "Callback at 2:30 PM (America/Chicago).", "/app/callbacks", 0.2, false);
  add("owner", "handoff_offered", `Jordan Pike asks you to pick up ${CUSTOMERS[1]}`, "Qualified final expense transfer, on the line now.", "/app/leads", 0.1, false);
  add("owner", "lead_note_mention", "You were mentioned in a lead note", "@Demo can you approve the draft date change for the Hendricks policy?", "/app/leads", 3, false);
  add("owner", "partner_message", "New partner message", "Open Partner Messages to read the latest update.", "/app/partner-chat", 5, false);
  add("owner", "appointment_reminder", `Appointment reminder: ${CUSTOMERS[2]}`, "Appointment at 4:00 PM (America/Chicago); customer local time 5:00 PM (America/New_York).", "/app/calendar", 1.5, false);
  add("marisol", "callback_reminder", `Callback reminder: ${CUSTOMERS[3]}`, "Callback at 11:00 AM (America/Chicago).", "/app/callbacks", 2, false);
  add("marisol", "lead_note_mention", "You were mentioned in a lead note", "@Marisol the carrier needs a new voice signature before Friday.", "/app/leads", 7, false);
  add("devin", "appointment_reminder", `Appointment reminder: ${CUSTOMERS[4]}`, "Appointment at 1:15 PM (America/Chicago); customer local time 12:15 PM (America/Denver).", "/app/calendar", 4, false);
  add("priya", "partner_message_mention", "You were mentioned in a partner message", "@Priya please resend the consent certificate for this transfer.", "/app/partner-chat", 6, false);
  add("jordan", "handoff_offered", `Aaliyah Brooks asks the team to pick up ${CUSTOMERS[5]}`, "Callback-ready prospect; needs a licensed agent in TX.", "/app/leads", 0.05, false);
  // Older and read.
  add("owner", "callback_reminder", `Callback reminder: ${CUSTOMERS[6]}`, "Callback at 9:30 AM (America/Chicago).", "/app/callbacks", 30, true);
  add("owner", "appointment_reminder", `Appointment reminder: ${CUSTOMERS[7]}`, "Appointment at 3:00 PM (America/Chicago); customer local time 3:00 PM (America/Chicago).", "/app/calendar", 52, true);
  add("owner", "partner_message", "New partner message", "Open Partner Messages to read the latest update.", "/app/partner-chat", 75, true);
  add("owner", "lead_note_mention", "You were mentioned in a lead note", "@Demo this one wants a quote from Americo and Foresters side by side.", "/app/leads", 120, true);
  add("owner", "handoff_offered", `Tomas Reyes asks you to pick up ${CUSTOMERS[8]}`, "Warm transfer, Medicare question first.", "/app/leads", 170, true);
  add("owner", "callback_reminder", `Callback reminder: ${CUSTOMERS[9]}`, "Callback at 5:45 PM (America/Chicago).", "/app/callbacks", 260, true);
  add("owner", "partner_message_mention", "You were mentioned in a partner message", "@Demo can you confirm last week's billable count?", "/app/partner-chat", 340, false); // an old one nobody opened
  add("marisol", "appointment_reminder", `Appointment reminder: ${CUSTOMERS[10]}`, "Appointment at 10:00 AM (America/Chicago); customer local time 11:00 AM (America/New_York).", "/app/calendar", 46, true);
  add("marisol", "handoff_offered", `Jordan Pike asks you to pick up ${CUSTOMERS[11]}`, "Qualified term transfer.", "/app/leads", 98, true);
  add("devin", "callback_reminder", `Callback reminder: ${CUSTOMERS[12]}`, "Callback at 12:30 PM (America/Chicago).", "/app/callbacks", 28, true);
  add("devin", "lead_note_mention", "You were mentioned in a lead note", "@Devin the applicant's bank changed; update the draft account.", "/app/leads", 200, true);
  add("tomas", "partner_message", "New partner message", "Open Partner Messages to read the latest update.", "/app/partner-chat", 60, true);
  add("helen", "lead_note_mention", "You were mentioned in a lead note", "@Helen the Americo July statement has six lines we could not match.", "/app/statements", 400, true);
  add("aaliyah", "callback_reminder", `Callback reminder: ${CUSTOMERS[2]}`, "Callback at 6:00 PM (America/Chicago).", "/app/callbacks", 20, true);
  add("jordan", "partner_message_mention", "You were mentioned in a partner message", "@Jordan the publisher is asking about yesterday's returns.", "/app/partner-chat", 140, true);
  return list;
}

await section("agent_notifications", async () => {
  const existing = must(await db.from("agent_notifications").select("source_key").eq("tenant_id", TENANT_ID).like("source_key", "qa-d1:%"), "read notifications");
  const have = new Set(existing.map((row) => row.source_key));
  const insert = [];
  alerts().forEach((alert, i) => {
    const sourceKey = `qa-d1:${String(i + 1).padStart(2, "0")}:${alert.kind}`;
    if (have.has(sourceKey)) { bump("agent_notifications", "kept"); return; }
    const recipient = USER[alert.recipient];
    if (!recipient) return;
    const createdAt = hoursAgo(alert.ageHours);
    insert.push({ tenant_id: TENANT_ID, recipient_user_id: recipient, kind: alert.kind, title: alert.title, body: alert.body, link: alert.link, source_key: sourceKey, created_at: createdAt, read_at: alert.read ? iso(Date.parse(createdAt) + 25 * 60_000) : null });
  });
  bump("agent_notifications", "inserted", insert.length);
  if (!DRY && insert.length) must(await db.from("agent_notifications").insert(insert), "insert notifications");
});

// =============================================================================
// D16 — metered usage and the trial reminder
// =============================================================================
await section("usage", async () => {
  // 200 of the plan's 250 statement pages, as eight uploads' worth of pages, through record_usage.
  const pages = [34, 22, 29, 31, 18, 27, 21, 18];
  for (const [i, qty] of pages.entries()) {
    const key = `qa-d1-statement-pages-${String(i + 1).padStart(2, "0")}`;
    const found = must(await db.from("usage_events").select("id").eq("tenant_id", TENANT_ID).eq("idempotency_key", key).maybeSingle(), "read usage event");
    if (found) { bump("usage_events", "kept"); continue; }
    bump("usage_events", "inserted");
    if (!DRY) {
      const recorded = must(await db.rpc("record_usage", { p_tenant_id: TENANT_ID, p_meter_key: "statement_pages", p_qty: qty, p_idempotency_key: key, p_ref: `qa_seed:${TAG}` }), "record usage");
      const row = Array.isArray(recorded) ? recorded[0] : recorded;
      if (i === pages.length - 1) note(`statement_pages used this period: ${row?.new_total} of 250`);
    }
  }
  note(`usage_totals is maintained by record_usage (not counted separately)`);

  if (subscription.status !== "trialing" || !subscription.trial_ends_at) { note("subscription is not trialing; no trial reminder"); return; }
  const kind = "four_days_left";
  const found = must(await db.from("trial_reminders").select("id").eq("subscription_id", subscription.id).eq("kind", kind).eq("trial_ends_at", subscription.trial_ends_at).maybeSingle(), "read trial reminder");
  if (found) { bump("trial_reminders", "kept"); return; }
  bump("trial_reminders", "inserted");
  // Recorded, not sent: delivered=false is what send-trial-reminders.mjs writes when a send is skipped.
  if (!DRY) must(await db.from("trial_reminders").insert({ subscription_id: subscription.id, kind, due_at: iso(Date.parse(subscription.trial_ends_at) - 4 * 86400_000), sent_at: hoursAgo(9), delivered: false, trial_ends_at: subscription.trial_ends_at }), "trial reminder");
});

await section("entitlement", async () => {
  if (DRY) return;
  const entitlement = must(await db.rpc("refresh_tenant_entitlement", { p_tenant_id: TENANT_ID }), "refresh entitlement");
  note(`entitlement: plan ${entitlement.plan_code}, max_seats ${entitlement.limits?.max_seats}, statement_pages ${JSON.stringify(entitlement.meters?.statement_pages ?? null)}, ${entitlement.features?.length} features`);
});

note("D7: no ledger table is written. lib/ledger/service.ts derives advance / commission / chargeback entries from tenant_policies × the carrier library at read time, and statement entries come from D5's accepted lines.");

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`\n${DRY ? "DRY RUN — would write" : "Wrote"}:`);
console.log(`${"table".padEnd(38)} ${"inserted".padStart(8)} ${"updated".padStart(8)} ${"kept".padStart(6)} ${"failed".padStart(6)}`);
for (const [table, row] of [...stats.entries()]) console.log(`${table.padEnd(38)} ${String(row.inserted).padStart(8)} ${String(row.updated).padStart(8)} ${String(row.kept).padStart(6)} ${String(row.failed).padStart(6)}`);
const failed = [...stats.values()].some((row) => row.failed > 0);
if (failed) { console.log("\nSome sections failed; see FAILED lines above."); process.exit(1); }
