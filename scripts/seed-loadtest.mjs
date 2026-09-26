/**
 * Load-test workspaces for the Module 1 / Module 2 performance lines (qa_seed "loadtest-design2").
 *
 * User decision (2026-09-25): load tests run in ONE separate throwaway workspace, never in the demo
 * tenant d6f3950f-…. This script creates it, fills it with fictional data by bulk service-role
 * inserts in the real tables' shapes, and times the screens against the dev server.
 *
 *   "QA Load Test Workspace"        the loaded tenant
 *     500 unclaimed inbound transfers from one partner ........................ LA-1.10-10
 *     10,000 deal-flow rows over the last 30 days .............................. LA-1.13-10
 *     5,000 partner leads for a second partner (its own pipeline view) ........ LA-1.17-12
 *     20,000 contacts, each with its lead (book of business) .................. LA-1.24-9
 *     100,000 eligible outbound leads in four scrubbed, active campaigns ...... LA-2.8-7 (Design 3)
 *     100,000 served-card activity rows on those leads ......................... LA-2.21-4
 *   "QA Load Test Empty Workspace"  a brand-new tenant with an owner and nothing else ... LA-1.15-7
 *
 * Owners and the partner user have NO password: each is created with auth.admin.createUser and a
 * random, unprinted, unusable password (the seed-qa-agency.mjs way, never mailed, @loadtest.insurvas.test
 * which the mail transport refuses as reserved). They are reachable only by a minted test session:
 *   node --env-file=.env.local scripts/mint-session.mjs tenant --email loadtest.owner@loadtest.insurvas.test
 *   node --env-file=.env.local scripts/mint-session.mjs tenant --email loadtest.empty.owner@loadtest.insurvas.test
 *   node --env-file=.env.local scripts/mint-session.mjs partner --email loadtest.partner@loadtest.insurvas.test
 *
 * Plan: a NEW private plan (qa_loadtest_advance, not public, not default) with the demo private plan's
 * features, limits and meters, used by these two tenants only (refused if any other subscription uses
 * it). Prices are zero and there is no trial, so nothing about it can ever be billed.
 *
 * Queue & SLA: the loaded tenant's thresholds are set to ~10 years, so the pg_cron ladder never warns,
 * escalates, tells the partner or expires anything. The ladder scans the OLDEST 500 unclaimed transfers
 * platform-wide each minute (run_unclaimed_sla, limit 500, no per-tenant fairness — backlog #186), so
 * 500 idle transfers would crowd every other tenant's new transfers out of that window. They are
 * therefore inserted last, stay open only while they are measured, and are PARKED (status 'expired',
 * no SLA event, so no side effect of any kind) by --measure and --deactivate; --open-transfers
 * re-opens them.
 *
 * Idempotent: every row has a deterministic id from "loadtest-design2:<kind>:<n>" and goes in with
 * ON CONFLICT DO NOTHING in batches of 1,000; a dataset already complete is skipped. Lead values carry
 * qa_seed and qa_dataset; partners.metadata and contacts.custom_fields carry qa_seed; the audit rows
 * carry it in metadata. Phones are NXX-555-5000…9999, one area code per 5,000 people.
 *
 *   node --env-file=.env.local scripts/seed-loadtest.mjs                 # seed (then measure)
 *   node --env-file=.env.local scripts/seed-loadtest.mjs --measure       # time every line, park transfers
 *   node --env-file=.env.local scripts/seed-loadtest.mjs --measure --only=serve   # just the serve timing
 *   node --env-file=.env.local scripts/seed-loadtest.mjs --open-transfers | --park-transfers
 *   node --env-file=.env.local scripts/seed-loadtest.mjs --deactivate    # suspend both, park transfers
 *   node --env-file=.env.local scripts/seed-loadtest.mjs --reactivate    # unsuspend both
 *   node --env-file=.env.local scripts/seed-loadtest.mjs --cleanup --yes-delete-loadtest   # remove everything
 *
 * Needs the dev server on http://localhost:3000 for --measure only. Seeding talks to the database
 * alone, but pings :3000 between batches and stops if it stops answering (it shares the database).
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const TAG = "loadtest-design2";
const BASE = "http://localhost:3000";
const LOAD_NAME = "QA Load Test Workspace";
const EMPTY_NAME = "QA Load Test Empty Workspace";
const DEMO_TENANT_ID = "d6f3950f-0d88-4e66-869f-0de2ea6b396b";
const DEMO_PLAN_CODE = "qa_d1_advance_team";
const PLAN_CODE = "qa_loadtest_advance";
const DOMAIN = "loadtest.insurvas.test";
const EMAIL = { owner: `loadtest.owner@${DOMAIN}`, emptyOwner: `loadtest.empty.owner@${DOMAIN}`, partner: `loadtest.partner@${DOMAIN}` };
const PRODUCT = "term_life";
const BATCH = 1000;
const NOW = Date.now();
const DAY = 86400_000;
/** ~10 years, then an hour, two hours and a day on top: the ladder's rungs must be strictly increasing. */
const SLA = { warn_after_seconds: 315_360_000, escalate_after_seconds: 315_363_600, partner_notify_after_seconds: 315_367_200, expire_after_seconds: 315_446_400 };
const COUNTS = { transfers: 500, partnerLeads: 5000, deals: 10000, contacts: 20000, outbound: 100000, activity: 100000 };

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? null;

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// ── helpers ───────────────────────────────────────────────────────────────────
const sha = (text) => createHash("sha256").update(text).digest("hex");
/** Deterministic, RFC-shaped (version 5, variant 10xx) so every route's UUID check accepts it. */
function uid(kind, key) {
  const h = sha(`${TAG}:${kind}:${key}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const iso = (ms) => new Date(ms).toISOString();
const ymd = (ms) => iso(ms).slice(0, 10);
function must(result, what) {
  if (result.error) throw new Error(`${what}: ${[result.error.message, result.error.details, result.error.hint, result.error.code].filter(Boolean).join(" · ")}`);
  return result.data;
}
function log(line) { console.log(`  ${line}`); }
function mulberry32(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rngFor = (key) => mulberry32(parseInt(sha(`${TAG}:${key}`).slice(0, 8), 16));

async function serverAnswers() {
  for (let i = 0; i < 2; i += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      const response = await fetch(`${BASE}/app/login`, { redirect: "manual", signal: controller.signal });
      clearTimeout(timer);
      if (response.status < 500) return true;
    } catch { /* not answering */ }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  return false;
}
async function watchServer(where) {
  if (has("--no-server-watch")) return;
  if (!(await serverAnswers())) {
    console.error(`\nSTOPPED at ${where}: the dev server on :3000 is not answering. Nothing more is written; re-run to continue (every batch already written is kept).`);
    process.exit(2);
  }
}

/** Inserts in batches of 1,000, ON CONFLICT (id) DO NOTHING; a statement timeout halves the batch. */
async function bulk(table, rows, label = table) {
  let written = 0;
  const started = Date.now();
  const send = async (part) => {
    for (let attempt = 1; ; attempt += 1) {
      const result = await db.from(table).upsert(part, { onConflict: "id", ignoreDuplicates: true });
      if (!result.error) return;
      if ((result.error.code === "57014" || /timeout/i.test(result.error.message)) && part.length > 100) {
        const half = Math.ceil(part.length / 2);
        await send(part.slice(0, half)); await send(part.slice(half)); return;
      }
      if (attempt < 3 && /fetch failed|ECONNRESET|socket|502|503|504/i.test(`${result.error.message} ${result.error.code}`)) { await new Promise((r) => setTimeout(r, 3000 * attempt)); continue; }
      throw new Error(`${label}: ${[result.error.message, result.error.details, result.error.hint, result.error.code].filter(Boolean).join(" · ")}`);
    }
  };
  for (let i = 0; i < rows.length; i += BATCH) {
    await send(rows.slice(i, i + BATCH));
    written += Math.min(BATCH, rows.length - i);
    if ((i / BATCH) % 10 === 9) { log(`${label}: ${written.toLocaleString()} / ${rows.length.toLocaleString()} (${((Date.now() - started) / 1000).toFixed(0)}s)`); await watchServer(`${label} batch ${i / BATCH + 1}`); }
  }
  log(`${label}: ${written.toLocaleString()} rows sent in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
async function countOf(table, build) { const r = await build(db.from(table).select("id", { count: "exact", head: true })); if (r.error) throw new Error(`count ${table}: ${r.error.message}`); return r.count ?? 0; }

// ── fictional people ─────────────────────────────────────────────────────────
const FIRST = ["Avery", "Jordan", "Riley", "Casey", "Morgan", "Quinn", "Harper", "Rowan", "Emerson", "Sawyer", "Reese", "Parker", "Hayden", "Logan", "Blake", "Dakota", "Skyler", "Finley", "Jamie", "Kendall", "Marlowe", "Tatum", "Sutton", "Lennox", "Ellis", "Arden", "Briar", "Carmen", "Delia", "Everett", "Florence", "Gideon", "Hollis", "Imogen", "Jasper", "Kit", "Leona", "Milo", "Nolan", "Opal"];
const LAST = ["Abernathy", "Birchwood", "Calloway", "Delacroix", "Easton", "Fairbanks", "Galloway", "Hartwell", "Ingram", "Jessup", "Kingsley", "Lockhart", "Merriweather", "Northcott", "Oakes", "Pembroke", "Quimby", "Rutherford", "Sinclair", "Thornbury", "Underhill", "Vance", "Whitlock", "Yarborough", "Zeller", "Ashdown", "Blackwood", "Crane", "Dunmore", "Ellery"];
const STREETS = ["Cedar", "Maple", "Juniper", "Willow", "Aspen", "Sycamore", "Magnolia", "Hawthorn", "Linden", "Alder"];
/** 31 real area codes; one area code holds 5,000 fictional numbers (NXX-555-5000…9999). */
const AREA = { 602: ["AZ", "Phoenix", "85004"], 480: ["AZ", "Mesa", "85201"], 520: ["AZ", "Tucson", "85701"], 623: ["AZ", "Glendale", "85301"], 214: ["TX", "Dallas", "75201"], 713: ["TX", "Houston", "77002"], 210: ["TX", "San Antonio", "78205"], 404: ["GA", "Atlanta", "30303"], 512: ["TX", "Austin", "78701"], 678: ["GA", "Marietta", "30060"], 770: ["GA", "Roswell", "30075"], 704: ["NC", "Charlotte", "28202"], 919: ["NC", "Raleigh", "27601"], 336: ["NC", "Greensboro", "27401"], 614: ["OH", "Columbus", "43215"], 216: ["OH", "Cleveland", "44113"], 513: ["OH", "Cincinnati", "45202"], 215: ["PA", "Philadelphia", "19107"], 412: ["PA", "Pittsburgh", "15222"], 717: ["PA", "Harrisburg", "17101"], 312: ["IL", "Chicago", "60602"], 773: ["IL", "Chicago", "60614"], 217: ["IL", "Springfield", "62701"], 314: ["MO", "St. Louis", "63101"], 816: ["MO", "Kansas City", "64106"], 303: ["CO", "Denver", "80202"], 719: ["CO", "Colorado Springs", "80903"], 313: ["MI", "Detroit", "48226"], 616: ["MI", "Grand Rapids", "49503"], 517: ["MI", "Lansing", "48933"], 970: ["CO", "Fort Collins", "80521"] };
const AREAS_FOR = {
  transfers: [602], partnerLeads: [480], deals: [520, 623], contacts: [214, 713, 210, 404],
  outbound: [512, 678, 770, 704, 919, 336, 614, 216, 513, 215, 412, 717, 312, 773, 217, 314, 816, 303, 719, 313],
};
const STATES = [...new Set(Object.values(AREA).map(([state]) => state))];
function person(dataset, i) {
  const areas = AREAS_FOR[dataset];
  const area = areas[Math.floor(i / 5000) % areas.length];
  const [state, city, zip] = AREA[area];
  const first = FIRST[(i * 7 + dataset.length) % FIRST.length];
  const last = LAST[(i * 11 + Math.floor(i / FIRST.length)) % LAST.length];
  const year = 1945 + ((i * 13) % 40); const month = 1 + ((i * 5) % 12); const day = 1 + ((i * 3) % 28);
  return {
    first, last, full: `${first} ${last}`, state, city, zip,
    phone: `${area}555${String(5000 + (i % 5000)).padStart(4, "0")}`,
    dob: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    address: `${100 + (i % 9800)} ${STREETS[i % STREETS.length]} St`,
    email: `${first}.${last}.${dataset}${i}@example.test`.toLowerCase(),
  };
}

// ── identities (ids are deterministic) ───────────────────────────────────────
const ID = {
  load: uid("tenant", "load"), empty: uid("tenant", "empty"),
  partnerTransfers: uid("partner", "transfers"), partnerPipeline: uid("partner", "pipeline"),
  vendor: uid("vendor", "list"), template: uid("tenant_template", "term_life"),
};
const CAMPAIGNS = [
  { key: "c1", name: "Load · Final Stretch List", weight: 1 },
  { key: "c2", name: "Load · Evergreen Term List", weight: 2 },
  { key: "c3", name: "Load · Summit Aged 30d", weight: 3 },
  { key: "c4", name: "Load · Harbor Fresh List", weight: 4 },
].map((c) => ({ ...c, id: uid("campaign", c.key) }));

async function tenantRow(id) { return must(await db.from("tenants").select("id, name, status, suspended_at").eq("id", id).maybeSingle(), "read tenant"); }
async function guardTenants() {
  for (const [id, name] of [[ID.load, LOAD_NAME], [ID.empty, EMPTY_NAME]]) {
    if (id === DEMO_TENANT_ID) throw new Error("refusing: a load-test id collides with the demo tenant");
    const row = await tenantRow(id);
    if (row && row.name !== name) { console.error(`Tenant ${id} is "${row.name}", not "${name}". Refusing.`); process.exit(1); }
  }
}
async function userIdByEmail(email) { const row = must(await db.from("users").select("id").eq("email", email).maybeSingle(), `read ${email}`); return row?.id ?? null; }

// =============================================================================
// modes that do not seed
// =============================================================================
async function setTransfers(open) {
  const ids = Array.from({ length: COUNTS.transfers }, (_, i) => uid("queue", `transfer:${i}`));
  const now = Date.now();
  let changed = 0;
  for (let i = 0; i < ids.length; i += 250) {
    const part = ids.slice(i, i + 250);
    if (open) {
      // Freshly queued, newest last, so the demo's own older transfers stay ahead in the ladder's window.
      for (let j = 0; j < part.length; j += 1) {
        const r = await db.from("lead_queue").update({ status: "unclaimed", sla_expired_at: null, sla_warned_at: null, sla_escalated_at: null, sla_partner_notified_at: null, claimed_by: null, owner_user_id: null, owner_role: null, locked_until: null, queued_at: iso(now - (ids.length - (i + j)) * 1000) }).eq("tenant_id", ID.load).eq("id", part[j]).in("status", ["expired", "unclaimed"]).select("id");
        changed += must(r, "open transfer").length;
      }
    } else {
      const r = await db.from("lead_queue").update({ status: "expired", sla_expired_at: iso(now) }).eq("tenant_id", ID.load).in("id", part).eq("status", "unclaimed").select("id");
      changed += must(r, "park transfers").length;
    }
  }
  log(`${open ? "opened" : "parked"} ${changed} load-test transfers`);
}

async function setActive(active) {
  for (const [id, name] of [[ID.load, LOAD_NAME], [ID.empty, EMPTY_NAME]]) {
    const row = await tenantRow(id);
    if (!row) { log(`${name}: not found`); continue; }
    const from = row.status; const to = active ? "active" : "suspended";
    if (from === to) { log(`${name}: already ${to}`); continue; }
    const suspendedAt = active ? null : iso(Date.now());
    const changed = must(await db.from("tenants").update({ status: to, suspended_at: suspendedAt }).eq("id", id).eq("status", from).select("id"), "change tenant status");
    if (!changed.length) throw new Error(`${name} changed while this ran`);
    // The same audit row the admin Suspend / Unsuspend button writes (app/api/admin/tenants/[id]/suspension).
    must(await db.from("audit_log").insert({ actor_type: "system", actor_id: null, action: active ? "tenant.unsuspended" : "tenant.suspended", target_type: "tenant", target_id: id, reason: active ? "QA load-test workspace re-activated for a load run." : "QA load-test workspace deactivated after the load run; nothing in it is real.", metadata: { name, status: { from, to }, suspendedAt, qa_seed: TAG } }), "audit status change");
    log(`${name}: ${from} → ${to}`);
  }
}

async function cleanup() {
  if (!has("--yes-delete-loadtest")) { console.error("--cleanup deletes both load-test workspaces permanently. Add --yes-delete-loadtest to confirm."); process.exit(1); }
  await guardTenants();
  const tenants = [ID.load, ID.empty];
  // Children first, in batches the statement timeout allows; the tenant row's cascades then finish it.
  const tables = ["tenant_lead_activity", "tenant_scoring_decisions", "tenant_call_attempts", "deal_flow", "active_calls", "lead_queue", "agent_leads", "contact_phones", "contacts", "tenant_campaigns", "tenant_lead_vendors", "partner_users", "partner_rejected_submissions", "partners", "licenses", "tenant_products", "tenant_templates", "tenant_queue_sla_settings", "tenant_scoring_settings", "tenant_entitlements", "subscriptions", "platform_invoices", "payments", "credit_notes", "tenant_users"];
  for (const tenantId of tenants) {
    for (const table of tables) {
      for (;;) {
        const rows = await db.from(table).select(table === "tenant_queue_sla_settings" || table === "tenant_scoring_settings" || table === "tenant_entitlements" || table === "tenant_users" || table === "tenant_products" ? "tenant_id" : "id").eq("tenant_id", tenantId).limit(500);
        if (rows.error) { log(`${table}: ${rows.error.message} (skipped)`); break; }
        if (!rows.data.length) break;
        const del = rows.data[0].id !== undefined
          ? await db.from(table).delete().in("id", rows.data.map((r) => r.id))
          : await db.from(table).delete().eq("tenant_id", tenantId);
        if (del.error) { log(`${table}: ${del.error.message} (stopped on this table)`); break; }
      }
    }
    const gone = await db.from("tenants").delete().eq("id", tenantId);
    log(`tenant ${tenantId}: ${gone.error ? `NOT deleted — ${gone.error.message}` : "deleted"}`);
  }
  for (const email of Object.values(EMAIL)) {
    const id = await userIdByEmail(email);
    if (!id) continue;
    await db.from("users").delete().eq("id", id);
    await db.auth.admin.deleteUser(id).catch(() => {});
    log(`user ${email}: deleted`);
  }
  const plan = must(await db.from("plans").select("id").eq("code", PLAN_CODE).maybeSingle(), "read plan");
  if (plan) {
    const users = await countOf("subscriptions", (q) => q.eq("plan_id", plan.id));
    if (users) log(`plan ${PLAN_CODE}: still used by ${users} subscription(s); left in place`);
    else { for (const t of ["plan_features", "plan_prices", "plan_limits", "plan_meters", "plan_available_addons"]) await db.from(t).delete().eq("plan_id", plan.id); const del = await db.from("plans").delete().eq("id", plan.id); log(`plan ${PLAN_CODE}: ${del.error ? del.error.message : "deleted"}`); }
  }
}

if (has("--open-transfers")) { await guardTenants(); await setTransfers(true); process.exit(0); }
if (has("--park-transfers")) { await guardTenants(); await setTransfers(false); process.exit(0); }
if (has("--deactivate")) { await guardTenants(); await setTransfers(false); await setActive(false); process.exit(0); }
if (has("--reactivate")) { await guardTenants(); await setActive(true); process.exit(0); }
if (has("--cleanup")) { await cleanup(); process.exit(0); }
if (has("--measure")) { const { measure } = await import("./lib/loadtestMeasure.mjs"); await measure({ db, ID, EMAIL, COUNTS, uid, setTransfers, only: opt("only"), out: opt("out") }); process.exit(0); }

// =============================================================================
// seed
// =============================================================================
console.log(`Seeding the load-test workspaces (qa_seed ${TAG})`);
await guardTenants();
await watchServer("start");

// ── plan: a private copy of the demo's private plan ─────────────────────────
console.log("\n── plan");
const demoPlan = must(await db.from("plans").select("id, code, version").eq("code", DEMO_PLAN_CODE).order("version", { ascending: false }).limit(1).single(), "read the demo's private plan");
let plan = must(await db.from("plans").select("*").eq("code", PLAN_CODE).eq("version", 1).maybeSingle(), "read load plan");
if (!plan) {
  plan = must(await db.from("plans").insert({ code: PLAN_CODE, version: 1, name: "Advance (QA load test)", plan_type: "agency_with_teams", description: `Private plan for the QA load-test workspaces only (qa_seed ${TAG}). Zero price, no trial. Not sold.`, is_public: false, is_default: false, is_archived: false, sort_order: 91 }).select("*").single(), "create load plan");
  log(`created plan ${PLAN_CODE}`);
} else log(`plan ${PLAN_CODE} kept`);
{
  const others = must(await db.from("subscriptions").select("tenant_id").eq("plan_id", plan.id).neq("status", "cancelled"), "who uses the load plan");
  const strangers = others.filter((row) => row.tenant_id !== ID.load && row.tenant_id !== ID.empty);
  if (strangers.length) { console.error(`Plan ${PLAN_CODE} is used by another tenant (${strangers[0].tenant_id}). Refusing.`); process.exit(1); }
  const [features, limits, meters, haveFeatures, haveLimits, haveMeters, havePrices] = await Promise.all([
    db.from("plan_features").select("feature_key").eq("plan_id", demoPlan.id),
    db.from("plan_limits").select("*").eq("plan_id", demoPlan.id).maybeSingle(),
    db.from("plan_meters").select("meter_key, included_qty, hard_cap").eq("plan_id", demoPlan.id),
    db.from("plan_features").select("feature_key").eq("plan_id", plan.id),
    db.from("plan_limits").select("plan_id").eq("plan_id", plan.id).maybeSingle(),
    db.from("plan_meters").select("meter_key").eq("plan_id", plan.id),
    db.from("plan_prices").select("plan_id").eq("plan_id", plan.id).maybeSingle(),
  ]);
  const want = [...new Set([...must(features, "demo features").map((r) => r.feature_key), "partner_portal"])];
  const got = new Set(must(haveFeatures, "load features").map((r) => r.feature_key));
  for (const feature_key of want.filter((key) => !got.has(key))) {
    const r = await db.from("plan_features").insert({ plan_id: plan.id, feature_key });
    if (r.error) log(`feature ${feature_key}: ${r.error.message} (skipped)`);
  }
  if (!must(havePrices, "load prices")) must(await db.from("plan_prices").insert({ plan_id: plan.id, price_monthly_cents: 0, price_quarterly_cents: 0, price_yearly_cents: 0, setup_fee_cents: 0, trial_days: 0, currency: "USD" }), "prices");
  if (!must(haveLimits, "load limits")) {
    const src = must(limits, "demo limits") ?? {};
    must(await db.from("plan_limits").insert({ plan_id: plan.id, max_seats: src.max_seats ?? 25, max_carriers: src.max_carriers ?? null, max_publishers: Math.max(src.max_publishers ?? 0, 20), max_marketing_partners: src.max_marketing_partners ?? null, max_affiliates: src.max_affiliates ?? null, max_buffer_seats: src.max_buffer_seats ?? null, max_partner_users: src.max_partner_users ?? null, max_setter_seats: src.max_setter_seats ?? null, max_active_campaigns: src.max_active_campaigns ?? null }), "limits");
  }
  const gotMeters = new Set(must(haveMeters, "load meters").map((r) => r.meter_key));
  // Allowances far above what a load run uses, soft-capped: the load is the database's, not a meter's.
  for (const m of must(meters, "demo meters").filter((m) => !gotMeters.has(m.meter_key))) must(await db.from("plan_meters").insert({ plan_id: plan.id, meter_key: m.meter_key, included_qty: Math.max(Number(m.included_qty) || 0, 1_000_000), hard_cap: false }), `meter ${m.meter_key}`);
  log(`features ${want.length}, prices 0 / no trial, limits and meters copied from ${DEMO_PLAN_CODE}`);
}

// ── tenants ─────────────────────────────────────────────────────────────────
console.log("\n── tenants");
for (const [id, name] of [[ID.load, LOAD_NAME], [ID.empty, EMPTY_NAME]]) {
  const row = await tenantRow(id);
  if (row) { log(`${name} kept (${row.status})`); continue; }
  must(await db.from("tenants").insert({ id, name, status: "active", onboarding_state: "complete", billing_mode: "automatic" }), `create ${name}`);
  log(`${name} created (${id})`);
}
{
  const load = await tenantRow(ID.load);
  if (load.status !== "active") { console.error(`${LOAD_NAME} is ${load.status}. Run --reactivate first.`); process.exit(1); }
}

// ── users: no password, reachable only by a minted session ────────────────────
console.log("\n── users");
const USER = {};
for (const [key, email, name] of [["owner", EMAIL.owner, "Loadtest Owner"], ["emptyOwner", EMAIL.emptyOwner, "Loadtest Empty Owner"], ["partner", EMAIL.partner, "Loadtest Partner Admin"]]) {
  let id = await userIdByEmail(email);
  if (!id) {
    // seed-qa-agency.mjs's way: an Auth user with a random password nobody is told, never mailed.
    const created = await db.auth.admin.createUser({ email, password: `Unusable-${randomBytes(24).toString("base64url")}!`, email_confirm: true, user_metadata: { name, full_name: name, display_name: name, qa_seed: TAG } });
    if (created.error || !created.data.user) throw new Error(`createUser ${email}: ${created.error?.message}`);
    id = created.data.user.id;
    log(`+ ${email}`);
  } else log(`${email} kept`);
  // The bridge trigger makes the row 'invited'. Active, and no legacy password hash: no password at all.
  must(await db.from("users").update({ name, full_name: name, display_name: name, status: "active", active: true, password_hash: null }).eq("id", id), `activate ${email}`);
  USER[key] = id;
}
for (const [tenantId, userId] of [[ID.load, USER.owner], [ID.empty, USER.emptyOwner]]) {
  const member = must(await db.from("tenant_users").select("role").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle(), "read membership");
  if (!member) must(await db.from("tenant_users").insert({ tenant_id: tenantId, user_id: userId, role: "owner", invited_at: iso(NOW - 2 * DAY), accepted_at: iso(NOW - 2 * DAY) }), "owner membership");
}

// ── subscription + entitlement ───────────────────────────────────────────────
console.log("\n── subscriptions");
for (const tenantId of [ID.load, ID.empty]) {
  const sub = must(await db.from("subscriptions").select("id, plan_id, status").eq("tenant_id", tenantId).neq("status", "cancelled").maybeSingle(), "read subscription");
  if (sub && sub.plan_id !== plan.id) throw new Error(`tenant ${tenantId} is subscribed to another plan; refusing`);
  if (!sub) must(await db.rpc("admin_assign_subscription", { p_tenant_id: tenantId, p_plan_id: plan.id, p_billing_cycle: "monthly", p_start: iso(NOW - DAY) }), "assign subscription");
  must(await db.rpc("refresh_tenant_entitlement", { p_tenant_id: tenantId }), "refresh entitlement");
  const ent = must(await db.from("tenant_entitlements").select("entitlement").eq("tenant_id", tenantId).single(), "read entitlement");
  log(`${tenantId === ID.load ? LOAD_NAME : EMPTY_NAME}: ${ent.entitlement.status}, access ${ent.entitlement.access}, ${ent.entitlement.features.length} features`);
}
if (has("--only=base")) process.exit(0);

// ── the loaded tenant's settings ────────────────────────────────────────────
console.log("\n── settings (loaded tenant)");
must(await db.from("tenant_queue_sla_settings").upsert({ tenant_id: ID.load, ...SLA, updated_by: USER.owner }, { onConflict: "tenant_id" }), "SLA thresholds");
log(`Queue & SLA: warn ${SLA.warn_after_seconds}s (~10 years) … expire ${SLA.expire_after_seconds}s — the ladder never fires here`);
must(await db.from("tenant_products").upsert({ tenant_id: ID.load, product_code: PRODUCT, is_enabled: true, sort_order: 1 }, { onConflict: "tenant_id,product_code" }), "enable term life");
{
  const have = new Set(must(await db.from("licenses").select("state").eq("tenant_id", ID.load), "read licences").map((r) => r.state));
  const rows = STATES.filter((s) => !have.has(s)).map((state) => ({ id: uid("license", state), tenant_id: ID.load, state, license_number: `LT-${state}-${sha(state).slice(0, 6).toUpperCase()}`, expires_at: "2028-12-31" }));
  if (rows.length) must(await db.from("licenses").insert(rows), "licences");
  log(`agency licences: ${STATES.join(", ")}`);
}
const platformTemplate = must(await db.from("templates").select("id, version, product_code, name").eq("product_code", PRODUCT).eq("is_active", true).order("version", { ascending: false }).limit(1).single(), "term life template");
{
  const t = must(await db.from("tenant_templates").select("id").eq("tenant_id", ID.load).eq("product_code", PRODUCT).maybeSingle(), "read tenant template");
  if (!t) must(await db.from("tenant_templates").insert({ id: ID.template, tenant_id: ID.load, template_id: platformTemplate.id, template_version: platformTemplate.version, definition_version: 1, product_code: PRODUCT, name: platformTemplate.name, applied_by: USER.owner, applied_at: iso(NOW - DAY) }), "tenant template");
  else ID.template = t.id;
}
const TEMPLATE = { tenant_template_id: ID.template, template_id: platformTemplate.id, template_version: platformTemplate.version, definition_version: 1, product_line: PRODUCT };

const pipelines = must(await db.from("tenant_pipelines").select("id, name, partner_type, is_default").eq("tenant_id", ID.load), "read pipelines");
const stagesFor = async (pipelineId) => must(await db.from("tenant_pipeline_stages").select("id, name, stage_type, position").eq("pipeline_id", pipelineId).eq("is_archived", false).order("position"), "read stages");
const publisher = pipelines.find((p) => p.partner_type === "publisher" && p.is_default) ?? pipelines.find((p) => p.partner_type === "publisher");
if (!publisher) throw new Error(`no publisher pipeline (pipelines: ${JSON.stringify(pipelines)})`);
// The importer's own choice (app/api/app/leads/import/preflight/route.ts context()): the default
// pipeline with no partner type, else the default marketing one, else any default.
const outboundPipeline = pipelines.find((p) => p.partner_type === null && p.is_default) ?? pipelines.find((p) => p.partner_type === "marketing" && p.is_default) ?? pipelines.find((p) => p.is_default) ?? publisher;
const PUB_STAGES = await stagesFor(publisher.id);
const OUT_STAGES = outboundPipeline.id === publisher.id ? PUB_STAGES : await stagesFor(outboundPipeline.id);
const firstOpen = (stages) => stages.find((s) => s.stage_type === "open") ?? stages[0];
log(`pipelines: ${pipelines.map((p) => `${p.name} (${p.partner_type})`).join(", ")}; outbound leads go to "${outboundPipeline.name}"`);
const DISPOSITIONS = must(await db.from("dispositions").select("disposition_key, label").eq("tenant_id", ID.load), "read dispositions").map((r) => r.disposition_key);
log(`dispositions: ${DISPOSITIONS.join(", ")}`);
const dispo = (preferred, fallbackIndex) => (DISPOSITIONS.includes(preferred) ? preferred : DISPOSITIONS[fallbackIndex % Math.max(1, DISPOSITIONS.length)] ?? preferred);

// ── partners ────────────────────────────────────────────────────────────────
console.log("\n── partners");
await bulk("partners", [
  { id: ID.partnerTransfers, tenant_id: ID.load, name: "Loadtest Transfer Publisher", slug: `loadtest-transfers-${ID.load.slice(0, 6)}`, partner_type: "publisher", status: "active", country: "US", timezone: "America/Phoenix", contact_name: "Loadtest Transfers", contact_email: `transfers@${DOMAIN}`, notes: "Fictional publisher: the 500 waiting transfers and half the deal flow.", metadata: { qa_seed: TAG }, created_by: USER.owner },
  { id: ID.partnerPipeline, tenant_id: ID.load, name: "Loadtest Pipeline Partner", slug: `loadtest-pipeline-${ID.load.slice(0, 6)}`, partner_type: "publisher", status: "active", country: "US", timezone: "America/Phoenix", contact_name: "Loadtest Partner Admin", contact_email: EMAIL.partner, notes: "Fictional publisher: 5,000 leads for its own pipeline view.", metadata: { qa_seed: TAG }, created_by: USER.owner },
], "partners");
{
  const pu = must(await db.from("partner_users").select("id").eq("partner_id", ID.partnerPipeline).eq("user_id", USER.partner).maybeSingle(), "read partner user");
  if (!pu) must(await db.from("partner_users").insert({ id: uid("partner_user", "admin"), tenant_id: ID.load, partner_id: ID.partnerPipeline, user_id: USER.partner, role: "partner_admin", status: "active", invited_at: iso(NOW - 2 * DAY), accepted_at: iso(NOW - 2 * DAY) }), "partner membership");
  log(`partner admin ${EMAIL.partner} on Loadtest Pipeline Partner`);
}

// ── vendor + scrubbed active campaigns ───────────────────────────────────────
console.log("\n── vendor + campaigns");
await bulk("tenant_lead_vendors", [{ id: ID.vendor, tenant_id: ID.load, name: "Load · Vendor", lead_type: "list", contact: {}, terms: "Fictional vendor for load tests.", return_window_days: 14, status: "active", notes: `qa_seed ${TAG}`, created_by: USER.owner }], "vendor");
await bulk("tenant_campaigns", CAMPAIGNS.map((c) => ({ id: c.id, tenant_id: ID.load, vendor_id: ID.vendor, name: c.name, lead_type: "list", product_code: PRODUCT, target_states: STATES, status: "active", total_spend_cents: 125000, records_purchased: 25000, mixing_weight: c.weight, created_by: USER.owner, scrub_status: "scrubbed", scrubbed_at: iso(NOW - 5 * DAY) })), "campaigns");
// An existing campaign keeps whatever it had; the gate needs active + scrubbed, so say so if it drifted.
{
  const rows = must(await db.from("tenant_campaigns").select("name, status, scrub_status").eq("tenant_id", ID.load), "read campaigns");
  for (const r of rows) if (r.status !== "active" || r.scrub_status !== "scrubbed") log(`NOTE ${r.name} is ${r.status}/${r.scrub_status}: its leads are not servable`);
}

const lead = (dataset, i, extra) => {
  const p = person(dataset, i);
  return { id: uid("lead", `${dataset}:${i}`), tenant_id: ID.load, ...TEMPLATE, created_by: USER.owner, screening_outcome: "clear", preflight_status: "unchecked", ...extra(p) };
};
const tagValues = (dataset, values) => ({ ...values, qa_seed: TAG, qa_dataset: dataset });
async function datasetComplete(dataset, expected) {
  const n = await countOf("agent_leads", (q) => q.eq("tenant_id", ID.load).eq("values->>qa_dataset", dataset));
  return n >= expected;
}

// ── 5,000 partner leads (LA-1.17-12) ────────────────────────────────────────
console.log("\n── partner leads (5,000)");
if (!(await datasetComplete("partnerLeads", COUNTS.partnerLeads))) {
  const rng = rngFor("partnerLeads");
  const leads = []; const queue = [];
  for (let i = 0; i < COUNTS.partnerLeads; i += 1) {
    const stage = PUB_STAGES[i % PUB_STAGES.length];
    const created = NOW - Math.floor(rng() * 90 * DAY) - 3600_000;
    const row = lead("partnerLeads", i, (p) => ({ partner_id: ID.partnerPipeline, pipeline_id: publisher.id, stage_id: stage.id, submission_id: uid("submission", `partner:${i}`), lead_state: "closed", created_at: iso(created), updated_at: iso(created + 3600_000), stage_entered_at: iso(created + 1800_000), values: tagValues("partnerLeads", { full_name: p.full, first_name: p.first, last_name: p.last, phone: p.phone, state: p.state, zip: p.zip, date_of_birth: p.dob }) }));
    leads.push(row);
    // Worked, never waiting: a completed call or an expired transfer. Unclaimed rows would sit in the
    // SLA ladder's platform-wide window (see the header).
    const expired = i % 10 < 3;
    queue.push({ id: uid("queue", `partner:${i}`), tenant_id: ID.load, lead_id: row.id, partner_id: ID.partnerPipeline, product_line: PRODUCT, pipeline_id: publisher.id, stage_id: stage.id, status: expired ? "expired" : "completed", queued_at: iso(created), created_at: iso(created), sla_expired_at: expired ? iso(created + 4 * 3600_000) : null, disposition: expired ? null : dispo(["application_submitted", "not_interested", "no_answer", "callback_requested"][i % 4], i), disposition_at: expired ? null : iso(created + 1200_000), disposition_by: expired ? null : USER.owner });
  }
  await bulk("agent_leads", leads, "partner leads");
  await bulk("lead_queue", queue, "partner lead work items");
} else log("complete; skipped");

// ── 10,000 deal-flow rows (LA-1.13-10) ──────────────────────────────────────
console.log("\n── deal flow (10,000)");
if ((await countOf("deal_flow", (q) => q.eq("tenant_id", ID.load))) < COUNTS.deals) {
  const rng = rngFor("deals");
  const won = PUB_STAGES.find((s) => s.stage_type === "won") ?? PUB_STAGES.at(-1);
  const leads = []; const deals = [];
  const results = ["sold", "application_submitted", "not_interested", "no_answer", "callback_requested"];
  for (let i = 0; i < COUNTS.deals; i += 1) {
    const inbound = i % 2 === 0;
    const day = NOW - Math.floor(rng() * 30) * DAY;
    const campaign = CAMPAIGNS[i % CAMPAIGNS.length];
    const row = lead("deals", i, (p) => ({ partner_id: inbound ? ID.partnerTransfers : null, campaign_id: inbound ? null : campaign.id, pipeline_id: inbound ? publisher.id : outboundPipeline.id, stage_id: inbound ? won.id : firstOpen(OUT_STAGES).id, submission_id: inbound ? uid("submission", `deal:${i}`) : null, lead_state: "closed", created_at: iso(day - 3600_000), updated_at: iso(day), values: tagValues("deals", { full_name: p.full, first_name: p.first, last_name: p.last, phone: p.phone, state: p.state, zip: p.zip, date_of_birth: p.dob }) }));
    leads.push(row);
    const p = person("deals", i);
    const result = results[i % results.length];
    const sold = result === "sold" || result === "application_submitted";
    deals.push({ id: uid("deal", String(i)), tenant_id: ID.load, lead_id: row.id, partner_id: inbound ? ID.partnerTransfers : null, product_line: PRODUCT, pipeline_id: row.pipeline_id, stage_id: row.stage_id, submission_id: row.submission_id, insured_name: p.full, phone: p.phone, initial_quote: "Term Life 20-year", local_date: ymd(day), call_result: dispo(result, i), notes: null, disposition_at: iso(day), disposition_by: USER.owner, status: i % 7 === 0 ? "partial" : i % 11 === 0 ? "dropped" : "completed", carrier: sold ? "QA Mutual (fictional)" : null, product_type: sold ? "Level Term" : null, monthly_premium_cents: sold ? 4500 + (i % 60) * 100 : null, face_amount_cents: sold ? 25_000_000 : null, draft_date: sold ? ymd(day + 14 * DAY) : null, worked_by: USER.owner, manual_entry: false, campaign_id: inbound ? null : campaign.id, vendor_id: inbound ? null : ID.vendor, source: inbound ? "inbound" : "outbound", created_at: iso(day - 1800_000), updated_at: iso(day) });
  }
  await bulk("agent_leads", leads, "deal leads");
  await bulk("deal_flow", deals, "deal flow");
} else log("complete; skipped");

// ── 20,000 contacts + their leads (LA-1.24-9) ───────────────────────────────
console.log("\n── contacts + leads (20,000)");
if ((await countOf("contacts", (q) => q.eq("tenant_id", ID.load))) < COUNTS.contacts || !(await datasetComplete("contacts", COUNTS.contacts))) {
  const rng = rngFor("contacts");
  const contacts = []; const leads = [];
  for (let i = 0; i < COUNTS.contacts; i += 1) {
    const p = person("contacts", i);
    const created = NOW - Math.floor(rng() * 365 * DAY) - DAY;
    const contactId = uid("contact", String(i));
    contacts.push({ id: contactId, tenant_id: ID.load, first_name: p.first, last_name: p.last, dob: p.dob, primary_phone: p.phone, address_line1: p.address, city: p.city, postal_code: p.zip, state: p.state, name_search: `${p.first}${p.last}`.toLowerCase().replace(/[^a-z0-9]/g, ""), custom_fields: { qa_seed: TAG }, created_at: iso(created), updated_at: iso(created) });
    leads.push(lead("contacts", i, () => ({ contact_id: contactId, partner_id: null, pipeline_id: outboundPipeline.id, stage_id: firstOpen(OUT_STAGES).id, lead_state: "closed", created_at: iso(created), updated_at: iso(created), values: tagValues("contacts", { full_name: p.full, first_name: p.first, last_name: p.last, phone: p.phone, state: p.state, address_line1: p.address, city: p.city, zip: p.zip, date_of_birth: p.dob, outcome: i % 5 === 0 ? "sold" : undefined }) })));
  }
  await bulk("contacts", contacts, "contacts");
  await bulk("agent_leads", leads, "contact leads");
} else log("complete; skipped");

// ── 100,000 eligible outbound leads (LA-2.8-7) ──────────────────────────────
console.log("\n── outbound leads (100,000)");
if (!(await datasetComplete("outbound", COUNTS.outbound)) || (await countOf("lead_queue", (q) => q.eq("tenant_id", ID.load).is("partner_id", null))) < COUNTS.outbound) {
  const rng = rngFor("outbound");
  const stage = firstOpen(OUT_STAGES);
  for (let start = 0; start < COUNTS.outbound; start += 20000) {
    const leads = []; const queue = [];
    for (let i = start; i < Math.min(COUNTS.outbound, start + 20000); i += 1) {
      const p = person("outbound", i);
      const created = NOW - Math.floor(rng() * 10 * DAY) - 3600_000;
      const campaign = CAMPAIGNS[i % CAMPAIGNS.length];
      // What the importer leaves: fresh, never dialled, scrubbed clear, first and last name apart.
      const row = lead("outbound", i, () => ({ partner_id: null, campaign_id: campaign.id, pipeline_id: outboundPipeline.id, stage_id: stage.id, lead_state: "fresh", attempts_made: 0, created_at: iso(created), updated_at: iso(created), stage_entered_at: iso(created), values: tagValues("outbound", { first_name: p.first, last_name: p.last, phone: p.phone, state: p.state, zip: p.zip, email: p.email }) }));
      leads.push(row);
      queue.push({ id: uid("queue", `outbound:${i}`), tenant_id: ID.load, lead_id: row.id, partner_id: null, product_line: PRODUCT, pipeline_id: outboundPipeline.id, stage_id: stage.id, status: "unclaimed", queued_at: iso(created), created_at: iso(created) });
    }
    await bulk("agent_leads", leads, `outbound leads ${start + 1}–${start + leads.length}`);
    await bulk("lead_queue", queue, `outbound work items ${start + 1}–${start + queue.length}`);
  }
} else log("complete; skipped");

// ── 100,000 activity rows (LA-2.21-4) ───────────────────────────────────────
console.log("\n── activity (100,000)");
if ((await countOf("tenant_lead_activity", (q) => q.eq("tenant_id", ID.load))) < COUNTS.activity) {
  const rng = rngFor("activity");
  const outcomes = ["no_answer", "voicemail", "not_interested", "callback_requested", "wrong_number", "application_submitted"];
  for (let start = 0; start < COUNTS.activity; start += 20000) {
    const rows = [];
    for (let i = start; i < Math.min(COUNTS.activity, start + 20000); i += 1) {
      const served = NOW - Math.floor(rng() * 30 * DAY) - 600_000;
      const zeroClick = i % 10 === 0; const open = i % 23 === 0;
      const clicked = zeroClick ? null : served + 5_000 + Math.floor(rng() * 40_000);
      const done = open ? null : served + 60_000 + Math.floor(rng() * 400_000);
      rows.push({ id: uid("activity", String(i)), tenant_id: ID.load, work_item_id: uid("queue", `outbound:${i}`), lead_id: uid("lead", `outbound:${i}`), campaign_id: CAMPAIGNS[i % CAMPAIGNS.length].id, agent_user_id: USER.owner, served_at: iso(served), clicked_at: clicked ? iso(clicked) : null, dispositioned_at: done ? iso(done) : null, disposition: done ? dispo(outcomes[i % outcomes.length], i) : null, card_open_seconds: done ? Math.round((done - served) / 1000) : null, notes: null, created_at: iso(served), updated_at: iso(done ?? served) });
    }
    await bulk("tenant_lead_activity", rows, `activity ${start + 1}–${start + rows.length}`);
  }
} else log("complete; skipped");

// ── 500 unclaimed transfers from one partner (LA-1.10-10), LAST ─────────────
console.log("\n── inbound transfers (500, unclaimed)");
if (!(await datasetComplete("transfers", COUNTS.transfers))) {
  const stage = firstOpen(PUB_STAGES);
  const leads = []; const queue = [];
  for (let i = 0; i < COUNTS.transfers; i += 1) {
    const at = Date.now() - (COUNTS.transfers - i) * 1000;
    const row = lead("transfers", i, (p) => ({ partner_id: ID.partnerTransfers, pipeline_id: publisher.id, stage_id: stage.id, submission_id: uid("submission", `transfer:${i}`), lead_state: "fresh", created_at: iso(at), updated_at: iso(at), stage_entered_at: iso(at), values: tagValues("transfers", { full_name: p.full, first_name: p.first, last_name: p.last, phone: p.phone, state: p.state, zip: p.zip, date_of_birth: p.dob, age: 2026 - Number(p.dob.slice(0, 4)) }) }));
    leads.push(row);
    queue.push({ id: uid("queue", `transfer:${i}`), tenant_id: ID.load, lead_id: row.id, partner_id: ID.partnerTransfers, product_line: PRODUCT, pipeline_id: publisher.id, stage_id: stage.id, status: "unclaimed", queued_at: iso(at), created_at: iso(at) });
  }
  await bulk("agent_leads", leads, "transfer leads");
  await bulk("lead_queue", queue, "transfer work items");
} else log("complete; skipped (use --open-transfers to re-open parked ones)");

// ── audit ───────────────────────────────────────────────────────────────────
must(await db.from("audit_log").insert({ actor_type: "system", actor_id: null, action: "tenant.qa_seed_applied", target_type: "tenant", target_id: ID.load, reason: "Load-test workspace data (scripts/seed-loadtest.mjs).", metadata: { qa_seed: TAG, tenants: { load: ID.load, empty: ID.empty }, plan: PLAN_CODE, counts: COUNTS, sla: SLA } }), "audit seed");

console.log("\n── totals (loaded tenant)");
for (const [table, build] of [["agent_leads", (q) => q.eq("tenant_id", ID.load)], ["lead_queue", (q) => q.eq("tenant_id", ID.load)], ["lead_queue (unclaimed transfers)", null], ["deal_flow", (q) => q.eq("tenant_id", ID.load)], ["contacts", (q) => q.eq("tenant_id", ID.load)], ["tenant_lead_activity", (q) => q.eq("tenant_id", ID.load)]]) {
  const n = build ? await countOf(table, build) : await countOf("lead_queue", (q) => q.eq("tenant_id", ID.load).eq("status", "unclaimed").not("partner_id", "is", null));
  log(`${table.padEnd(34)} ${n.toLocaleString()}`);
}
console.log(`\nDone. Loaded tenant ${ID.load}, empty tenant ${ID.empty}. Next: --measure (it parks the transfers when it is done).`);
