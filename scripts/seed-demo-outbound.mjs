/**
 * QA catalog "M2", Design 2 (outbound): fills the LA-1.25 Alert Demo tenant so every Module 2 screen
 * has realistic data. Targets are D1–D18 of the readiness catalog, at the spec's LOWER bounds.
 *
 *   D2  4 vendors (1 realtime with a post key, 2 list, 1 aged), return windows 7 / 14 / 30 / 30 days
 *   D3  8 campaigns: active, paused, exhausted, 1 draft, 1 unscrubbed; weights 1–4; 1 cadence override;
 *       2 lists from the same vendor
 *   D4  ~15,000 leads through the REAL reviewed importer (POST/PUT /api/app/leads/import/preflight):
 *       scrub, dedupe, cost allocation, the scrub-rejection ledger, lead sources and queue items are all
 *       the product's own. ~14 states incl. AZ, FL panhandle and east-TN zips, FL/OK/AL (8pm statutes)
 *   D12 ~300 real-time posts through POST /api/leads/post/<key> with a key minted for the vendor
 *   D5  dial history (served cards, attempts, clicks, scoring decisions) over the last 14 days and
 *       older, written with the service role because no API can create an attempt in the past
 *   D6  callbacks · D7 availability (PUT /api/app/availability) · D8 appointments (book_appointment,
 *       reschedule/rebook/mark-outcome RPCs, past ones inserted) · D9/D10 applications through
 *       POST/PATCH /api/app/outbound/application, deal flow through PATCH /api/app/deal-flow/[id],
 *       issued policies through POST /api/app/policies/issued (mark_deal_policy_issued)
 *   D11 vendor claims through /api/app/vendor-returns/claims · D13 nurture rule + recycle batch
 *       through /api/app/nurture · D14 manual suppressions through /api/app/suppression plus the
 *       do_not_call dispositions' own suppress_phone · D15 scripts + rebuttals · D16 assignment rules
 *       + capacity · D17 scoring (10% holdout) · D18 the tenant's PRIVATE plan limits near the caps
 *
 * Only ever touches tenant d6f3950f-0d88-4e66-869f-0de2ea6b396b and its private plan
 * qa_d1_advance_team (refused if any other subscription uses it). Never sends email, never touches
 * payments, never changes platform-wide settings.
 *
 * Tag: design2-outbound. Vendors and campaigns are named "Demo · …"; lead values carry
 * qa_seed = "design2-outbound"; phones are NXX-555-XXXX from counters; policy numbers QA-D2-0001…;
 * idempotency / source keys qa-d2:…; every service-role row has a deterministic id derived from
 * "qa-d2:<kind>:<natural key>" and is inserted with ON CONFLICT DO NOTHING. A second run inserts nothing.
 * Child rows (attempts, cards, callbacks, appointments, cases, deals, policies, consent artefacts,
 * scoring decisions) hang off the tagged leads and go with them.
 *
 * Also serves the agent-side (AG) demo lines: D8 five publishers, one per payout model (POST
 * /api/app/partners + add_term) next to the vendors and the post key; D9 2,000 contacts through "Add
 * contact" (POST /api/app/contacts) with ~20 probable duplicates queued for review and one merged pair
 * (POST /api/app/contacts/merge), leads linked with link_leads_to_contacts; D15 consent certificates and
 * scrub results on the leads.
 *
 * The history stops at a FIXED instant (T0, 05:00 Central on 2026-09-25) so every run is identical.
 * `--today` adds the working day so far on top (dials, dispositions, today's deal flow, setter
 * bookings, and ONE callback and ONE appointment due ~15 minutes after it runs). Run it during US
 * calling hours and agent working hours (after ~09:15 Eastern / 08:15 Central on a weekday).
 *
 * Every HTTP request is sequential, imports go in pieces of at most 500 rows, and any request that
 * takes over 5 minutes stops the run (re-running continues where it stopped).
 *
 *   node --env-file=.env.local scripts/seed-demo-outbound.mjs --dry-run
 *   node --env-file=.env.local scripts/seed-demo-outbound.mjs
 *   node --env-file=.env.local scripts/seed-demo-outbound.mjs --today
 *
 * Needs the dev server on http://localhost:3000 (DEMO_SCREENING_MODE=true: numbers ending 0101 are
 * DNC-listed and 0001 litigator-listed).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const DRY = process.argv.includes("--dry-run");
const TODAY_MODE = process.argv.includes("--today");
const TAG = "design2-outbound";
const TENANT_ID = "d6f3950f-0d88-4e66-869f-0de2ea6b396b";
const TENANT_NAME = "LA-1.25 Alert Demo";
const OWNER_EMAIL = "demo.agent@insurvas.test";
const QA_DOMAIN = "qa-demo.insurvas.test";
const PLAN_CODE = "qa_d1_advance_team";
const BASE = "http://localhost:3000";
const PRODUCT = "term_life";
/** The simulation's horizon: nothing seeded happens after this instant (5 am Central on the 25th). */
const T0 = Date.parse("2026-09-25T10:00:00Z");
const NOW = Date.now();
const PERIOD_START_FALLBACK = Date.parse("2026-09-15T15:10:33Z");

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// ── bookkeeping (house style: seed-qa-agency.mjs) ─────────────────────────────
const stats = new Map();
const notes = [];
function bump(table, kind, n = 1) {
  if (!n) return;
  const row = stats.get(table) ?? { inserted: 0, updated: 0, kept: 0, failed: 0, api: 0 };
  row[kind] += n;
  stats.set(table, row);
}
function note(line) { notes.push(line); console.log(`  · ${line}`); }
function must(result, what) {
  if (result.error) throw new Error(`${what}: ${[result.error.message, result.error.details, result.error.hint, result.error.code].filter(Boolean).join(" · ")}`);
  return result.data;
}
async function section(name, fn, { critical = false } = {}) {
  console.log(`\n── ${name}`);
  const t0 = Date.now();
  try { await fn(); console.log(`  (${((Date.now() - t0) / 1000).toFixed(1)}s)`); } catch (error) {
    bump(name, "failed");
    note(`FAILED ${name}: ${error instanceof Error ? error.message : String(error)}`);
    if (SERVER_STALLED) { note(`STOPPED: the dev server is not keeping up (${SERVER_STALLED}); nothing more is sent. Re-run once it answers: every step already done is kept.`); printSummary(); process.exit(2); }
    if (critical) { printSummary(); process.exit(1); }
  }
}
async function mapLimit(items, limit, task) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await task(items[i], i); }
  }));
  return out;
}
const chunk = (list, size) => { const out = []; for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size)); return out; };
async function fetchAll(build, page = 1000) {
  const rows = [];
  for (let from = 0; ; from += page) {
    const data = must(await build().range(from, from + page - 1), "paged read");
    rows.push(...data);
    if (data.length < page) return rows;
  }
}
async function inChunks(ids, size, build) {
  const rows = [];
  for (const part of chunk(ids, size)) rows.push(...must(await build(part), "chunked read"));
  return rows;
}
/** INSERT … ON CONFLICT (id) DO NOTHING, in batches; returns how many rows were new. */
async function insertIgnore(table, rows, size = 400) {
  let inserted = 0;
  for (const part of chunk(rows, size)) {
    const data = must(await db.from(table).upsert(part, { onConflict: "id", ignoreDuplicates: true }).select("id"), `insert ${table}`);
    inserted += data.length;
  }
  bump(table, "inserted", inserted);
  bump(table, "kept", rows.length - inserted);
  return inserted;
}

// ── determinism ───────────────────────────────────────────────────────────────
const sha = (text) => createHash("sha256").update(text).digest("hex");
/** A stable uuid for a natural key, so every service-role insert is ON CONFLICT DO NOTHING. */
function uid(kind, key) {
  const h = sha(`qa-d2:${kind}:${key}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function mulberry32(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const seedOf = (text) => parseInt(sha(text).slice(0, 8), 16);
function rngFor(key) {
  const rng = mulberry32(seedOf(key));
  return {
    next: rng,
    int: (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1)),
    pick: (list) => list[Math.floor(rng() * list.length)],
    chance: (p) => rng() < p,
    weighted(entries) { const total = entries.reduce((s, [, w]) => s + w, 0); let r = rng() * total; for (const [v, w] of entries) { if ((r -= w) < 0) return v; } return entries.at(-1)[0]; },
  };
}
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

// ── time zones (every date here is inside US daylight time: DST ends 2026-11-01) ──
const OFFSET = { "America/New_York": -4, "America/Chicago": -5, "America/Denver": -6, "America/Phoenix": -7, "Asia/Manila": 8 };
const STATE_TZ = { TX: "America/Chicago", FL: "America/New_York", AZ: "America/Phoenix", GA: "America/New_York", OK: "America/Chicago", NC: "America/New_York", OH: "America/New_York", PA: "America/New_York", TN: "America/Chicago", AL: "America/Chicago", MO: "America/Chicago", IL: "America/Chicago", SC: "America/New_York", ME: "America/New_York" };
function local(ms, tz) { const d = new Date(ms + OFFSET[tz] * HOUR); return { dow: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), date: d.toISOString().slice(0, 10), mins: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
function atLocal(date, hh, mm, tz) { return Date.parse(`${date}T00:00:00Z`) + (hh * 60 + mm) * MIN - OFFSET[tz] * HOUR; }
/** Calling-window statutes in the platform table: FL/OK/AL stop at 8pm, FL/OK never on Sunday. */
const WINDOW_END = { FL: 20 * 60, OK: 20 * 60, AL: 20 * 60 };
const NO_SUNDAY = new Set(["FL", "OK"]);
/** `who` is a state code, or a lead: then its own zone counts too (FL panhandle, east Tennessee). */
function legal(ms, who) {
  const state = typeof who === "string" ? who : who?.state;
  const zones = [STATE_TZ[state], typeof who === "object" ? who?.tz2 : null].filter(Boolean);
  if (!STATE_TZ[state]) return false;
  return zones.every((tz) => {
    const l = local(ms, tz);
    if (l.dow === 0) return false; // nobody here dials on Sunday, and FL/OK forbid it
    return l.mins >= 8 * 60 && l.mins < (WINDOW_END[state] ?? 21 * 60) - 10;
  });
}
const splitZone = (row) => (row?.split ? (row.state === "FL" ? "America/Chicago" : "America/New_York") : null);
function slotOf(ms, state) {
  const l = local(ms, STATE_TZ[state]);
  if (l.dow === 0 || l.dow === 6) return "weekend";
  if (l.hour < 10) return "early_morning";
  if (l.hour < 12) return "late_morning";
  if (l.hour < 15) return "afternoon";
  if (l.hour < 18) return "early_evening";
  return "late_evening";
}

// ── guard: the right tenant, or nothing ───────────────────────────────────────
const tenant = must(await db.from("tenants").select("id, name").eq("id", TENANT_ID).maybeSingle(), "read tenant");
if (!tenant || tenant.name !== TENANT_NAME) { console.error(`Tenant ${TENANT_ID} is not "${TENANT_NAME}". Refusing to seed.`); process.exit(1); }
const owner = must(await db.from("users").select("id, email").eq("email", OWNER_EMAIL).maybeSingle(), "read owner");
const ownerRole = owner ? must(await db.from("tenant_users").select("role").eq("tenant_id", TENANT_ID).eq("user_id", owner.id).maybeSingle(), "read owner role") : null;
if (!owner || ownerRole?.role !== "owner") { console.error(`${OWNER_EMAIL} is not the owner of ${TENANT_NAME}. Refusing to seed.`); process.exit(1); }
const subscription = must(await db.from("subscriptions").select("id, plan_id, status, current_period_start").eq("tenant_id", TENANT_ID).neq("status", "cancelled").order("started_at", { ascending: false }).limit(1).maybeSingle(), "read subscription");
const PERIOD_START = subscription?.current_period_start ? Date.parse(subscription.current_period_start) : PERIOD_START_FALLBACK;
console.log(`${DRY ? "DRY RUN — nothing is written. " : ""}Seeding ${TENANT_NAME} · owner ${owner.email} · period since ${iso(PERIOD_START)} · horizon ${iso(T0)}`);

const TEAM_EMAILS = { owner: OWNER_EMAIL, marisol: `marisol.vance@${QA_DOMAIN}`, devin: `devin.okafor@${QA_DOMAIN}`, jordan: `jordan.pike@${QA_DOMAIN}`, aaliyah: `aaliyah.brooks@${QA_DOMAIN}`, priya: `priya.castellanos@${QA_DOMAIN}`, helen: `helen.marsh@${QA_DOMAIN}` };
const USER = {};
{
  const rows = must(await db.from("users").select("id, email, name, status").in("email", Object.values(TEAM_EMAILS)), "read team");
  const members = must(await db.from("tenant_users").select("user_id, role, accepted_at").eq("tenant_id", TENANT_ID), "read memberships");
  for (const [key, email] of Object.entries(TEAM_EMAILS)) {
    const user = rows.find((row) => row.email === email);
    const member = user && members.find((row) => row.user_id === user.id);
    if (!user || !member?.accepted_at || user.status !== "active") { console.error(`${email} is not an active member of ${TENANT_NAME}; run seed-qa-agency.mjs first.`); process.exit(1); }
    USER[key] = { id: user.id, email, name: user.name, role: member.role };
  }
}
const AGENTS = ["owner", "marisol", "devin", "jordan", "aaliyah"];
const idOf = (key) => USER[key].id;

// ── the product's HTTP surface, as the people who would use it ────────────────
const cookies = new Map();
function session(key) {
  if (cookies.has(key)) return cookies.get(key);
  const out = execFileSync(process.execPath, ["--env-file=.env.local", "scripts/mint-session.mjs", "tenant", "--email", TEAM_EMAILS[key], "--ttl", "360", "--js"], { encoding: "utf8" });
  const match = out.match(/document\.cookie=("(?:[^"\\]|\\.)*")/);
  if (!match) throw new Error(`could not mint a session for ${TEAM_EMAILS[key]}`);
  const cookie = JSON.parse(match[1]).split(";")[0];
  cookies.set(key, cookie);
  return cookie;
}
async function api(method, path, as, body, extraHeaders = {}) {
  if (DRY && method !== "GET") throw new Error(`dry run must not ${method} ${path}`);
  const headers = { origin: BASE, ...extraHeaders };
  if (as) headers.cookie = session(as);
  if (body !== undefined) headers["content-type"] = "application/json";
  const controller = new AbortController();
  // Agreed with the coordinator: a request that takes over 5 minutes stops the whole run.
  const timer = setTimeout(() => controller.abort(), 300_000);
  const started = Date.now();
  try {
    const response = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: controller.signal });
    const text = await response.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    if (method !== "GET") bump(`api ${method} ${path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ":id").replace(/\?.*$/, "")}`, "api");
    return { status: response.status, json, text };
  } catch (error) {
    if (error?.name === "AbortError") { SERVER_STALLED = `${method} ${path} took over 5 minutes (${Math.round((Date.now() - started) / 1000)}s)`; throw new Error(SERVER_STALLED); }
    throw error;
  } finally { clearTimeout(timer); }
}
let SERVER_STALLED = null;
/** The shared dev server can stall for minutes; never pile requests onto it, wait for it. */
async function waitForServer() {
  for (let i = 0; i < 90; i += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20_000);
      const response = await fetch(`${BASE}/login`, { redirect: "manual", signal: controller.signal });
      clearTimeout(timer);
      if (response.status < 500) return;
    } catch { /* not answering yet */ }
    console.log(`  (dev server not answering; waiting, ${new Date().toISOString()})`);
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  }
  throw new Error("the dev server on :3000 has not answered for 45 minutes");
}
function ok(result, what) {
  if (result.status < 200 || result.status >= 300) throw new Error(`${what}: HTTP ${result.status} ${result.text.slice(0, 400)}`);
  return result.json;
}

// =============================================================================
// The plan: vendors, campaigns and the files they sold
// =============================================================================
const VENDORS = {
  summit: { name: "Demo · Summit Live Leads", lead_type: "realtime", return_window_days: 7, category: "Real-time web", contact: { name: "Dana Whitcomb", email: "dana.whitcomb@summit-leads.example", phone: "(720) 555-4410" }, terms: "Billed per accepted post at $18. Duplicate, out-of-area and bad-number returns within 7 days of the post.", notes: "Ping-post from final-expense and term landing pages. Posts arrive at tier 0." },
  bayview: { name: "Demo · Bayview Data", lead_type: "list", return_window_days: 14, category: "Aged web list", contact: { name: "Marcus Oyelaran", email: "marcus@bayview-data.example", phone: "(617) 555-2290" }, terms: "Net 15. Credits disconnected, wrong-party and DNC records reported within 14 days of delivery.", notes: "Primary term list vendor. Two September drops." },
  crestview: { name: "Demo · Crestview Lists", lead_type: "list", return_window_days: 30, category: "Opt-in list", contact: { name: "Priscilla Nakamura", email: "p.nakamura@crestview-lists.example", phone: "(503) 555-7721" }, terms: "Net 30. 30-day return window on any record that fails the scrub or proves unreachable.", notes: "Standard and premium (verified, recent opt-in) tiers." },
  oakridge: { name: "Demo · Oakridge Direct Mail", lead_type: "aged", return_window_days: 30, category: "Direct mail responders", contact: { name: "Hollis Pettigrew", email: "hollis@oakridge-mail.example", phone: "(502) 555-6034" }, terms: "Bulk pricing. Returns for scrub failures only, within 30 days.", notes: "Aged 2025 direct-mail responders. Cheap, slow to contact." },
};
const CAMPAIGNS = {
  oakridge: { vendor: "oakridge", name: "Demo · Oakridge Aged Responders 2025", lead_type: "aged", weight: 1, states: ["TX", "FL", "GA", "AL", "TN", "OK", "MO"], final: "exhausted" },
  bayviewA: { vendor: "bayview", name: "Demo · Bayview Term List Sept A", lead_type: "list", weight: 4, states: ["TX", "FL", "AZ", "GA", "NC", "OH", "PA", "TN", "IL"], final: "active" },
  crest: { vendor: "crestview", name: "Demo · Crestview Term List", lead_type: "list", weight: 2, states: ["TX", "FL", "NC", "OH", "PA", "MO", "IL", "SC", "ME"], final: "paused" },
  bayviewB: { vendor: "bayview", name: "Demo · Bayview Term List Sept B", lead_type: "list", weight: 2, states: ["TX", "FL", "AZ", "OK", "NC", "TN", "AL"], final: "active" },
  premium: { vendor: "crestview", name: "Demo · Crestview Premium Term", lead_type: "list", weight: 3, states: ["TX", "FL", "AZ", "NC", "OH"], final: "active", cadence: true },
  summit: { vendor: "summit", name: "Demo · Summit Real-time Term", lead_type: "realtime", weight: 1, states: ["TX", "FL", "AZ", "OK", "NC", "OH", "PA", "TN", "AL", "MO", "IL"], final: "active", realtime: true },
  draft: { vendor: "crestview", name: "Demo · Crestview October Drop", lead_type: "list", weight: 1, states: ["TX", "FL"], final: "draft", spend: 30000, records: 1000 },
  unscrubbed: { vendor: "bayview", name: "Demo · Bayview Spanish Pilot", lead_type: "list", weight: 1, states: ["TX", "FL", "AZ"], final: "active", spend: 40000, records: 800, unscrubbed: true },
};
const RT_PRICE_CENTS = 1800;

/** One file per import call, at most 1,050 rows, so each preflight's screening fits one request. */
const FILES = [];
function addFiles(campaign, vendorStyle, parts, rowsEach, costEach, stamps, importer) {
  parts.forEach((_, i) => FILES.push({ key: `${campaign}-${i + 1}`, campaign, style: vendorStyle, rows: rowsEach[i], costCents: costEach[i], at: Date.parse(stamps[i]), importer, part: i + 1, of: parts.length }));
}
addFiles("oakridge", "oakridge", [1, 2, 3], [800, 800, 800], [20000, 20000, 20000], ["2026-08-27T15:20:00Z", "2026-08-27T15:40:00Z", "2026-08-27T16:05:00Z"], "owner");
addFiles("bayviewA", "bayview", [1, 2, 3, 4, 5], [1000, 1000, 1000, 1000, 1000], [35000, 35000, 35000, 35000, 35000], ["2026-08-29T14:10:00Z", "2026-08-29T14:35:00Z", "2026-08-29T15:00:00Z", "2026-08-29T15:30:00Z", "2026-08-29T16:00:00Z"], "priya");
addFiles("crest", "crestview", [1, 2, 3, 4, 5], [1000, 1000, 1000, 1000, 1000], [45000, 45000, 45000, 45000, 45000], ["2026-09-04T14:00:00Z", "2026-09-04T14:30:00Z", "2026-09-04T15:05:00Z", "2026-09-05T14:15:00Z", "2026-09-05T14:45:00Z"], "priya");
addFiles("bayviewB", "bayview", [1, 2, 3], [1050, 1050, 1050], [36750, 36750, 36750], ["2026-09-15T18:20:00Z", "2026-09-15T18:50:00Z", "2026-09-16T14:10:00Z"], "priya");
addFiles("premium", "crestview", [1], [300], [82500], ["2026-09-18T16:00:00Z"], "owner");
// The shared dev server screens ~2.7 numbers a second inside one request, so no request carries
// more than 500 rows: each vendor file is imported as the vendor's pieces of at most 500.
{
  const out = [];
  for (const f of FILES) {
    const pieces = Math.ceil(f.rows / 500);
    for (let k = 0; k < pieces; k += 1) out.push({ ...f, key: `${f.key}${String.fromCharCode(97 + k)}`, rows: Math.round(f.rows / pieces), costCents: Math.round(f.costCents / pieces), at: f.at + k * 7 * MIN, piece: k + 1, pieces });
  }
  FILES.splice(0, FILES.length, ...out);
}
for (const file of FILES) file.name = `qa-d2-${file.campaign.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}-part${file.part}of${file.of}-${file.piece}of${file.pieces}.csv`;

// ── people and places (fictional) ─────────────────────────────────────────────
const FIRST = ["Harold", "Rosa", "Walter", "Evelyn", "Clarence", "Dolores", "Raymond", "Juanita", "Eugene", "Loretta", "Marvin", "Bernice", "Curtis", "Gloria", "Leonard", "Irene", "Roland", "Opal", "Vernon", "Lucille", "Dwight", "Maxine", "Floyd", "Imogene", "Chester", "Wilma", "Otis", "Geneva", "Rufus", "Minnie", "Darnell", "Tamika", "Keith", "Sherry", "Rodney", "Wanda", "Gregory", "Brenda", "Terrence", "Patrice", "Dale", "Colleen", "Russell", "Janelle", "Wendell", "Marlene", "Lyle", "Doreen", "Clifton", "Arlene", "Glenn", "Rhonda", "Neil", "Paulette", "Byron", "Yvonne", "Reggie", "Charlene", "Alvin", "Priscilla", "Morris", "Delores", "Earl", "Verna", "Lamar", "Kathleen", "Travis", "Bonnie", "Jerome", "Faye"];
const LAST = ["Jennings", "Briggs", "Hendricks", "Pruitt", "Whitlock", "Stroud", "Fairbanks", "Mcallister", "Lockhart", "Tillman", "Abernathy", "Kowalczyk", "Beaumont", "Driscoll", "Ramsey", "Holloway", "Carmichael", "Winslow", "Pettigrew", "Oakes", "Burkett", "Caldwell", "Dunaway", "Easley", "Fenwick", "Gatling", "Hargrove", "Ingram", "Jessup", "Kimbrough", "Langford", "Mayfield", "Norwood", "Overby", "Pendleton", "Quarles", "Rutledge", "Satterfield", "Truett", "Upshaw", "Vickery", "Wadsworth", "Yancey", "Blanton", "Crowder", "Dillard", "Eckert", "Fulton", "Garrison", "Hollins", "Ivey", "Kinsey", "Lumpkin", "Merritt", "Nance", "Oglesby", "Presley", "Rigsby", "Sizemore", "Toliver"];
const FIRST_ES = ["Guadalupe", "Jose", "Maria", "Luis", "Carmen", "Jesus", "Rosario", "Manuel", "Esperanza", "Ramon", "Consuelo", "Alfredo", "Graciela", "Ernesto", "Leticia", "Armando", "Socorro", "Rogelio", "Maricela", "Arturo", "Yolanda", "Rafael", "Dolores", "Ignacio"];
const LAST_ES = ["Delgado", "Castaneda", "Quintero", "Vasquez", "Espinoza", "Salgado", "Ybarra", "Montoya", "Villarreal", "Cardenas", "Arellano", "Barajas", "Cervantes", "Ochoa", "Treviño", "Zamora", "Galindo", "Maldonado", "Rios", "Sepulveda"];
const STATES = {
  TX: { w: 18, areas: [713, 817, 210, 972, 832, 281], zips: [[750, 799]], label: "Central", es: 0.22 },
  FL: { w: 15, areas: [305, 407, 904, 727, 561, 239], zips: [[326, 349]], label: "Eastern", es: 0.16, split: { share: 0.22, areas: [850], zips: [[324, 325]] } },
  AZ: { w: 8, areas: [480, 520, 623], zips: [[850, 865]], label: "Mountain (no DST)", es: 0.18 },
  GA: { w: 6, areas: [678, 912, 770], zips: [[300, 319]], label: "Eastern", es: 0.03 },
  OK: { w: 5, areas: [405, 918], zips: [[730, 749]], label: "Central", es: 0.04 },
  NC: { w: 7, areas: [704, 919, 336], zips: [[270, 289]], label: "Eastern", es: 0.03 },
  OH: { w: 7, areas: [614, 216, 513], zips: [[430, 459]], label: "Eastern", es: 0.02 },
  PA: { w: 7, areas: [215, 412, 717], zips: [[150, 196]], label: "Eastern", es: 0.03 },
  TN: { w: 7, areas: [615, 901, 731], zips: [[370, 372], [380, 385]], label: "Central", es: 0.02, split: { share: 0.35, areas: [865, 423], zips: [[373, 379]] } },
  AL: { w: 5, areas: [334, 256, 251], zips: [[350, 369]], label: "Central", es: 0.02 },
  MO: { w: 5, areas: [314, 816, 417], zips: [[630, 658]], label: "Central", es: 0.02 },
  IL: { w: 5, areas: [312, 217, 618], zips: [[600, 629]], label: "Central", es: 0.05 },
  SC: { w: 3, areas: [803, 843], zips: [[290, 299]], label: "Eastern", es: 0.02 },
  ME: { w: 2, areas: [207], zips: [[39, 49]], label: "Eastern", es: 0 },
};
const STATE_CODES = Object.keys(STATES);
/** Area codes the tenant's existing (non-seed) leads already use; the seed never generates in them. */
const TAKEN_AREAS = new Set([512, 202, 214, 415, 479, 212, 205, 602, 419, 813, 404, 555, 206]);
/** Plant pools: every NXX that no state above and no existing lead uses. …0101 screens DNC, …0001 litigator. */
const PLANT_AREAS = [];
for (let a = 201; a <= 989; a += 1) { const s = String(a); if (s[1] === "1" && s[2] === "1") continue; if (s[1] === "9") continue; if (TAKEN_AREAS.has(a) || Object.values(STATES).some((st) => st.areas.includes(a) || st.split?.areas.includes(a))) continue; PLANT_AREAS.push(a); }
const areaCounter = new Map();
function nextPhone(area) { const n = (areaCounter.get(area) ?? 2000) + 1; areaCounter.set(area, n); if (n > 9999) throw new Error(`area ${area} exhausted`); return `${area}555${String(n).padStart(4, "0")}`; }
const fmtPhone = (digits, style) => style === "bayview" ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : style === "crestview" ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : digits;

/** The vendors' own column names — three different files, none of them ours. */
const STYLES = {
  bayview: { headers: ["First Name", "Last Name", "Phone Number", "Email Address", "DOB", "State", "Zip Code", "Time Zone", "Coverage Amount", "Tobacco", "Language", "TrustedForm URL"], map: { "first name": "first_name", "last name": "last_name", "phone number": "phone", "email address": "email", dob: "date_of_birth", state: "state", "zip code": "zip", "time zone": "timezone", "coverage amount": "coverage_amount", tobacco: "tobacco", language: "language", "trustedform url": null }, cert: 0.70, dateOrder: null },
  crestview: { headers: ["fname", "lname", "cell", "email", "birth_date", "st", "postal", "tz", "face_amount_cents", "smoker", "lang", "cert_url"], map: { fname: "first_name", lname: "last_name", cell: "phone", email: "email", birth_date: "date_of_birth", st: "state", postal: "zip", tz: "timezone", face_amount_cents: "coverage_amount", smoker: "tobacco", lang: "language", cert_url: null }, cert: 0.64, dateOrder: "mdy" },
  oakridge: { headers: ["FIRST", "LAST", "PHONE", "ADDRESS STATE", "ZIP", "DATE OF BIRTH", "MAIL CODE", "CERT"], map: { first: "first_name", last: "last_name", phone: "phone", "address state": "state", zip: "zip", "date of birth": "date_of_birth", "mail code": null, cert: null }, cert: 0.25, dateOrder: null },
};

// ── generate every file's rows, deterministically ─────────────────────────────
const LEAD_ROWS = []; // every row the importer should turn into a NEW lead
const plantCursor = { dnc: 0, lit: 0 };
function person(rng, state) {
  const spanish = state && rng.chance(STATES[state].es);
  const first = spanish ? rng.pick(FIRST_ES) : rng.pick(FIRST);
  const last = spanish ? rng.pick(LAST_ES) : rng.pick(LAST);
  const age = rng.int(31, 76);
  const dob = `${2026 - age}-${String(rng.int(1, 12)).padStart(2, "0")}-${String(rng.int(1, 28)).padStart(2, "0")}`;
  return { first, last, dob, language: state ? (spanish ? "Spanish" : rng.chance(0.55) ? "English" : "") : "" };
}
function placeFor(rng, campaign) {
  const states = CAMPAIGNS[campaign].states;
  const state = rng.weighted(states.map((s) => [s, STATES[s].w]));
  const st = STATES[state];
  const split = st.split && rng.chance(st.split.share);
  const areas = split ? st.split.areas : st.areas;
  const zips = split ? st.split.zips : st.zips;
  const [lo, hi] = rng.pick(zips);
  const zip = `${String(rng.int(lo, hi)).padStart(3, "0")}${String(rng.int(1, 99)).padStart(2, "0")}`;
  return { state, zip, area: rng.pick(areas), split };
}
function buildFiles() {
  const byCampaign = new Map();
  for (const file of FILES) {
    const rng = rngFor(`file:${file.key}`);
    const style = STYLES[file.style];
    const rows = [];
    const seen = [];
    const cross = file.campaign === "bayviewB" ? Math.round(file.rows * 0.048) : file.campaign === "premium" ? 25 : 0; // numbers another campaign already sold
    const pool = file.campaign === "bayviewB" ? (byCampaign.get("bayviewA") ?? []) : file.campaign === "premium" ? (byCampaign.get("crest") ?? []) : [];
    for (let i = 0; i < file.rows; i += 1) {
      const place = placeFor(rng, file.campaign);
      const who = person(rng, place.state);
      let kind = "lead";
      const roll = rng.next();
      if (roll < 0.034) kind = "dnc";
      else if (roll < 0.037) kind = "litigator";
      else if (roll < 0.041) kind = "invalid";
      else if (roll < 0.043) kind = "unreadable";
      else if (roll < 0.048 && seen.length > 10) kind = "dup_in_file";
      else if (i % Math.max(1, Math.floor(file.rows / Math.max(1, cross))) === 3 && cross && pool.length) kind = "dup_existing";
      let phone;
      if (kind === "dnc") phone = `${PLANT_AREAS[(plantCursor.dnc++ * 7 + FILES.indexOf(file) * 31) % PLANT_AREAS.length]}5550101`;
      else if (kind === "litigator") phone = `${PLANT_AREAS[(plantCursor.lit++ * 11 + 3) % PLANT_AREAS.length]}5550001`;
      else if (kind === "dup_in_file") phone = rng.pick(seen);
      else if (kind === "dup_existing") phone = pool[(i * 13 + file.part * 7) % pool.length].phone;
      else phone = nextPhone(place.area);
      const missingState = kind === "lead" && rng.chance(0.01);
      const row = {
        kind, phone, first: who.first, last: who.last, dob: who.dob,
        state: missingState ? "" : place.state, zip: missingState ? "" : place.zip,
        tz: missingState || file.style === "oakridge" ? "" : STATES[place.state].label,
        coverage: rng.pick([1000000, 1500000, 2500000, 5000000, 10000000, 25000000, 50000000]),
        tobacco: rng.chance(0.18), language: missingState ? "" : who.language,
        email: rng.chance(0.55) ? `${who.first}.${who.last}${rng.int(1, 99)}@example.net`.toLowerCase().normalize("NFD").replace(/[^a-z0-9.@]/g, "") : "",
        cert: rng.chance(file.campaign === "premium" ? 0.92 : style.cert),
        split: place.split, campaign: file.campaign, file: file.key, rowNumber: i + 2,
        optInDays: file.style === "oakridge" ? rng.int(200, 400) : rng.int(2, 25),
      };
      if (kind === "invalid") row.phoneText = `555-01${rng.int(10, 99)}`;
      if (kind === "unreadable") row.badDob = true;
      if (kind === "lead") { seen.push(phone); LEAD_ROWS.push(row); }
      rows.push(row);
    }
    file.data = rows;
    byCampaign.set(file.campaign, [...(byCampaign.get(file.campaign) ?? []), ...rows.filter((r) => r.kind === "lead")]);
  }
}
buildFiles();
// Two of the owner's own do-not-call entries (D14) are in Bayview's second September file, as a vendor
// re-selling a number the agency was told never to call again would be.
const OWN_DNC = [
  { phone: "7135559801", listType: "internal", reason: "Asked never to be called again; complaint logged by Demo Agent.", source: "complaint" },
  { phone: "9045559802", listType: "internal", reason: "Daughter called to remove her mother's number.", source: "manual" },
  { phone: "6145559803", listType: "internal", reason: "Wrong party, repeatedly re-sold by vendors. Manual block.", source: "manual" },
];
const LITIGATORS = [
  { phone: "3035550001", listType: "tcpa_litigator", reason: "Known serial TCPA plaintiff (industry list).", source: "manual" },
  { phone: "7025550001", listType: "tcpa_litigator", reason: "Litigator flagged by carrier compliance.", source: "manual" },
  { phone: "5035550001", listType: "tcpa_litigator", reason: "Filed TCPA suits against two agencies in 2025.", source: "manual" },
  { phone: "4065550001", listType: "tcpa_litigator", reason: "Industry litigator list, added after a demand letter.", source: "manual" },
];
{
  const b2 = FILES.find((f) => f.key === "bayviewB-2a");
  const counts = new Map();
  for (const row of b2.data) counts.set(row.phone, (counts.get(row.phone) ?? 0) + 1);
  const slots = b2.data.map((row, i) => [row, i]).filter(([row]) => row.kind === "lead" && counts.get(row.phone) === 1 && row.state).slice(20, 22);
  slots.forEach(([row, i], k) => {
    b2.data[i] = { ...row, kind: "own_dnc", phone: OWN_DNC[k].phone, state: k === 0 ? "TX" : "FL" };
    const at = LEAD_ROWS.indexOf(row);
    if (at >= 0) LEAD_ROWS.splice(at, 1);
  });
}
const csvCell = (value) => { const s = String(value ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function certUrl(phone) { return `https://cert.trustedform.com/qa-d2-${sha(`cert:${phone}`).slice(0, 32)}`; }
function csvFor(file, version = 1) {
  const style = STYLES[file.style];
  const lines = [[...style.headers, ...(version > 1 ? ["Batch Ref"] : [])].map(csvCell).join(",")];
  for (const row of file.data) {
    const phone = row.phoneText ?? fmtPhone(row.phone, file.style);
    let dob = row.dob;
    if (file.style === "crestview") { const [y, m, d] = row.dob.split("-"); dob = `${m}/${d}/${y}`; }
    if (row.badDob) dob = file.style === "crestview" ? "02/30/1958" : "1958-13-02";
    const cert = row.cert ? certUrl(row.phone) : "";
    const cells = file.style === "bayview"
      ? [row.first, row.last, phone, row.email, dob, row.state, row.zip, row.tz, row.coverage, row.tobacco ? "Yes" : "No", row.language, cert]
      : file.style === "crestview"
        ? [row.first, row.last, phone, row.email, dob, row.state, row.zip, row.tz, row.coverage, row.tobacco ? "yes" : "no", row.language, cert]
        : [row.first.toUpperCase(), row.last.toUpperCase(), phone, row.state, row.zip, dob, `OAK-${row.rowNumber}`, cert];
    if (version > 1) cells.push(`${file.key}-v${version}`);
    lines.push(cells.map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}
for (const file of FILES) file.csv = csvFor(file);
{
  const kinds = {};
  for (const f of FILES) for (const r of f.data) kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
  console.log(`Files: ${FILES.length}, rows ${FILES.reduce((s, f) => s + f.rows, 0)} · ${Object.entries(kinds).map(([k, v]) => `${v} ${k}`).join(", ")} · new leads expected ${LEAD_ROWS.length}`);
}

// ── the real-time posts (D12) ─────────────────────────────────────────────────
const POSTS = [];
{
  const rng = rngFor("posts");
  const start = Date.parse("2026-09-11T00:00:00Z");
  const licensed = CAMPAIGNS.summit.states;
  const listPhones = LEAD_ROWS.filter((r) => r.campaign === "bayviewA" || r.campaign === "crest").map((r) => r.phone);
  for (let i = 0; i < 300; i += 1) {
    const day = Math.floor((i / 300) * 14);
    const state = rng.weighted(licensed.map((s) => [s, STATES[s].w]));
    const tz = STATE_TZ[state];
    const date = iso(start + day * DAY).slice(0, 10);
    let at = atLocal(date, rng.int(9, 16), rng.int(0, 59), tz);
    const dow = local(at, tz).dow;
    if (dow === 6) at += 2 * DAY; else if (dow === 0) at += DAY; // weekday web traffic only
    if (!legal(at, state)) at = atLocal(local(at, tz).date, 11, rng.int(0, 59), tz);
    const place = placeFor(rng, "summit");
    const who = person(rng, state);
    let kind = "accepted";
    if (i % 23 === 5) kind = "duplicate";
    else if (i % 71 === 9) kind = "litigator";
    else if (i === 150) kind = "internal";
    else if (i % 41 === 17) kind = "invalid_phone";
    else if (i % 97 === 30) kind = "unlicensed";
    else if (i % 131 === 44) kind = "no_state";
    else if (i === 213 || i === 277) kind = "no_consent_ip";
    const phone = kind === "duplicate" ? listPhones[(i * 37) % listPhones.length]
      : kind === "litigator" ? LITIGATORS[i % LITIGATORS.length].phone
        : kind === "internal" ? OWN_DNC[2].phone
          : nextPhone(place.area);
    const payload = {
      first_name: who.first, last_name: who.last,
      phone1: kind === "invalid_phone" ? `555-01${rng.int(10, 99)}` : fmtPhone(phone, "bayview"),
      email: `${who.first}.${who.last}${rng.int(1, 99)}@example.org`.toLowerCase().normalize("NFD").replace(/[^a-z0-9.@]/g, ""),
      dob: `${who.dob.slice(5, 7)}/${who.dob.slice(8, 10)}/${who.dob.slice(0, 4)}`,
      st: kind === "no_state" ? "" : kind === "unlicensed" ? rng.pick(["CA", "NY", "WA"]) : state,
      zip: place.zip,
      consent_text: "By clicking Get My Quote I agree to be contacted by a licensed agent by phone, including by automated means, about life insurance. Consent is not a condition of purchase.",
      consent_ip: kind === "no_consent_ip" ? "" : `198.51.100.${rng.int(2, 254)}`,
      consent_timestamp: iso(at - rng.int(20, 90) * 1000),
      source_url: "https://quotes.summit-leads.example/term-life",
      landing_page: rng.pick(["/term-life/compare", "/final-expense/rates", "/term-life/no-exam"]),
      qa_seed: TAG,
      ...(rng.chance(0.93) ? { trusted_form_cert_url: certUrl(phone) } : {}),
      ...(who.language === "Spanish" ? { language: "Spanish" } : {}),
    };
    POSTS.push({ n: i + 1, key: `qa-d2:post:${String(i + 1).padStart(4, "0")}`, at, state, phone, kind, payload });
  }
  const byKind = POSTS.reduce((acc, p) => ({ ...acc, [p.kind]: (acc[p.kind] ?? 0) + 1 }), {});
  console.log(`Posts: ${POSTS.length} · ${Object.entries(byKind).map(([k, v]) => `${v} ${k}`).join(", ")}`);
}

// =============================================================================
// D1 · team (reused; nothing to create)
// =============================================================================
await waitForServer();
await section("D1 team", async () => {
  const states = must(await db.from("tenant_user_licensed_states").select("user_id, state, expires_on").eq("tenant_id", TENANT_ID), "read licensed states");
  for (const key of ["marisol", "devin"]) note(`${USER[key].name} licensed in ${states.filter((s) => s.user_id === idOf(key)).map((s) => s.state).sort().join(", ")} (already different; left alone)`);
  bump("tenant_user_licensed_states", "kept", states.length);
  note("setters jordan.pike (Asia/Manila, set through D7 availability) and aaliyah.brooks; assistant priya.castellanos imports; bookkeeper helen.marsh files claims");
});

// =============================================================================
// The intake form: 14 states and the location fields the vendors send
// =============================================================================
const WANT_STATES = ["TX", "FL", "AZ", "GA", "OK", "NC", "OH", "PA", "TN", "AL", "MO", "IL", "SC", "ME"];
await section("intake form (tenant template)", async () => {
  const current = ok(await api("GET", "/api/app/templates", "owner"), "read template").current;
  const template = current.template;
  const fields = template.fields.map((field) => ({ ...field }));
  const stateField = fields.find((field) => field.field_key === "state");
  const missing = WANT_STATES.filter((s) => !stateField.options.includes(s));
  const extra = [
    { type: "text", label: "ZIP code", options: [], field_key: "zip", sort_order: 11, is_required: false, help_text: null, validation: {} },
    { type: "text", label: "Time zone", options: [], field_key: "timezone", sort_order: 12, is_required: false, help_text: "Set at import from the ZIP (FL panhandle and east Tennessee differ from their state).", validation: {} },
    { type: "single_select", label: "Language", options: ["English", "Spanish"], field_key: "language", sort_order: 13, is_required: false, help_text: null, validation: {} },
  ].filter((field) => !fields.some((f) => f.field_key === field.field_key));
  if (!missing.length && !extra.length) { bump("tenant_templates", "kept"); return; }
  note(`form change: state options ${stateField.options.join("/")} + ${missing.join("/") || "none"}; new optional fields ${extra.map((f) => f.field_key).join(", ") || "none"} (before: definition_version ${template.definition_version})`);
  bump("tenant_templates", "updated");
  if (DRY) return;
  stateField.options = [...stateField.options, ...missing];
  const form = JSON.parse(JSON.stringify(template.form_definition));
  if (extra.length) {
    const location = form.sections.find((s) => s.section_key === "location") ?? (form.sections.push({ label: "Location", fields: [], sort_order: form.sections.length, section_key: "location" }), form.sections.at(-1));
    for (const field of extra) if (!location.fields.some((f) => f.field_key === field.field_key)) location.fields.push({ field_key: field.field_key, show_when: null, is_required: false });
  }
  ok(await api("PATCH", `/api/app/templates/${template.id}`, "owner", { name: template.name, description: template.description, fields: [...fields, ...extra], stages: template.stages, form_definition: form }), "save template");
});

// =============================================================================
// D2 · vendors · D3 · campaigns
// =============================================================================
const VENDOR_ID = {};
const CAMPAIGN_ID = {};
await section("D2 vendors", async () => {
  const rows = must(await db.from("tenant_lead_vendors").select("id, name, lead_type, return_window_days").eq("tenant_id", TENANT_ID).like("name", "Demo · %"), "read vendors");
  for (const [key, spec] of Object.entries(VENDORS)) {
    const found = rows.find((row) => row.name === spec.name);
    if (found) { VENDOR_ID[key] = found.id; bump("tenant_lead_vendors", "kept"); continue; }
    bump("tenant_lead_vendors", "inserted");
    if (DRY) { VENDOR_ID[key] = `<new:${key}>`; continue; }
    const created = ok(await api("POST", "/api/app/vendors", "owner", { name: spec.name, lead_type: spec.lead_type, contact: spec.contact, terms: spec.terms, return_window_days: spec.return_window_days, notes: spec.notes, category: spec.category }), `create vendor ${spec.name}`);
    VENDOR_ID[key] = created.vendor?.id ?? created.id;
  }
}, { critical: true });

await section("D3 campaigns", async () => {
  const rows = must(await db.from("tenant_campaigns").select("id, name, status, mixing_weight, target_states, total_spend_cents, records_purchased, product_code").eq("tenant_id", TENANT_ID).like("name", "Demo · %"), "read campaigns");
  for (const [key, spec] of Object.entries(CAMPAIGNS)) {
    let found = rows.find((row) => row.name === spec.name);
    if (!found) {
      bump("tenant_campaigns", "inserted");
      if (DRY) { CAMPAIGN_ID[key] = `<new:${key}>`; continue; }
      // Everything that will receive leads starts active; the draft stays a draft. Paused and
      // exhausted are where two of them END, after their leads arrive (an exhausted campaign refuses imports).
      const created = ok(await api("POST", "/api/app/campaigns", "owner", { vendor_id: VENDOR_ID[spec.vendor], name: spec.name, lead_type: spec.lead_type, product_code: PRODUCT, status: spec.final === "draft" ? "draft" : "active" }), `create campaign ${spec.name}`);
      found = created.campaign ?? created;
    } else bump("tenant_campaigns", "kept");
    CAMPAIGN_ID[key] = found.id;
    const patch = {};
    if (found.mixing_weight !== spec.weight) patch.mixing_weight = spec.weight;
    if (JSON.stringify([...(found.target_states ?? [])].sort()) !== JSON.stringify([...spec.states].sort())) patch.target_states = spec.states;
    if (spec.spend !== undefined && found.total_spend_cents !== spec.spend) { patch.total_spend_cents = spec.spend; patch.records_purchased = spec.records; }
    if (Object.keys(patch).length && !DRY) { ok(await api("PATCH", `/api/app/campaigns/${found.id}`, "owner", patch), `update campaign ${spec.name}`); bump("tenant_campaigns", "updated"); }
  }
}, { critical: true });

await section("D3 cadence override (Crestview Premium)", async () => {
  const rows = [["1 hour", "opposite_half"], ["4 hours", null], ["1 day", "evening"], ["1 day", "morning"], ["2 days", "weekend"], ["3 days", null], ["4 days", null]].map(([delayInterval, preferredSlot], i) => ({ attemptNumber: i + 1, delayInterval, preferredSlot }));
  if (DRY) { bump("tenant_cadence_rules", "inserted", rows.length); return; }
  const have = must(await db.from("tenant_cadence_rules").select("attempt_number").eq("tenant_id", TENANT_ID).eq("campaign_id", CAMPAIGN_ID.premium), "read cadence");
  if (have.length === rows.length) { bump("tenant_cadence_rules", "kept", have.length); return; }
  ok(await api("PUT", "/api/app/cadence", "owner", { campaignId: CAMPAIGN_ID.premium, rows }), "save cadence override");
  bump("tenant_cadence_rules", "inserted", rows.length);
});
const PREMIUM_DELAYS = [1 * HOUR, 4 * HOUR, DAY, DAY, 2 * DAY, 3 * DAY];
const DEFAULT_DELAYS = [2 * HOUR, DAY, DAY, 2 * DAY, 3 * DAY, 5 * DAY];

// =============================================================================
// D15 · scripts and rebuttals (before the history, so attempts can carry the script)
// =============================================================================
const SCRIPT = {};
await section("D15 scripts + rebuttals", async () => {
  const scripts = [
    { key: "default", campaign_id: null, sections: {
      opening: "Hi {{first_name}}, this is {{agent_name}} with {{agency_name}}. You asked about {{product}} coverage online a little while back, and I'm calling to get you the quotes you asked for. Is now still a good time?",
      qualifying_questions: "Great. Just a few quick ones so the quotes are accurate: what's your date of birth? Have you used any tobacco in the last twelve months? About how much coverage were you hoping for, and is it mostly to replace income or to cover a mortgage and final costs?",
      transition_to_quote: "Thanks, {{first_name}}. Based on that, I can compare a few carriers licensed in {{state}}. The rates depend on a short health questionnaire, and I'll go through it with you now so there are no surprises later.",
      close: "Of the options we looked at, this one fits what you told me best. If you're comfortable, we can start the application now. It takes about fifteen minutes, and nothing is charged until the carrier approves you.",
    } },
    { key: "premium", campaign: "premium", sections: {
      opening: "Hi {{first_name}}, it's {{agent_name}} from {{agency_name}}. You filled out a term life request on {{consent_date}}, and I have your quotes ready. Did I catch you at an okay time?",
      qualifying_questions: "To confirm a couple of things from your request: you're in {{state}}, and you were looking at a 20-year term? Any tobacco in the last year? Anyone else we should list as a beneficiary?",
      transition_to_quote: "Because you asked recently and your details are complete, you may qualify for a no-exam option. Let me pull the two best offers side by side.",
      close: "Let's lock in this rate today. I'll read each question exactly as the carrier asks it, and you can stop me at any point.",
    } },
    { key: "summit", campaign: "summit", sections: {
      opening: "Hi {{first_name}}, this is {{agent_name}} with {{agency_name}}. You just asked for a life insurance quote a moment ago, so I'm calling while it's fresh. Do you have two minutes?",
      qualifying_questions: "Perfect. Quick check: date of birth, tobacco use in the last year, and roughly the coverage you had in mind?",
      transition_to_quote: "Thanks. I can see a few carriers that fit. Let me walk you through the lowest two.",
      close: "If one of those works, we can start the application while I have you on the line.",
    } },
  ];
  const have = must(await db.from("tenant_scripts").select("id, campaign_id, product_code, version, sections").eq("tenant_id", TENANT_ID), "read scripts");
  for (const spec of scripts) {
    const campaignId = spec.campaign ? CAMPAIGN_ID[spec.campaign] : null;
    const match = have.filter((row) => (row.campaign_id ?? null) === campaignId && row.product_code === PRODUCT).sort((a, b) => b.version - a.version)[0];
    if (match && JSON.stringify(match.sections) === JSON.stringify(spec.sections)) { SCRIPT[spec.key] = match; bump("tenant_scripts", "kept"); continue; }
    bump("tenant_scripts", "inserted");
    if (DRY) { SCRIPT[spec.key] = { id: null, version: 1 }; continue; }
    const saved = ok(await api("PUT", "/api/app/dialer/scripts", "owner", { campaign_id: campaignId, product_code: PRODUCT, sections: spec.sections }), `save script ${spec.key}`);
    SCRIPT[spec.key] = saved.script;
  }
  const rebuttals = [
    ["how_did_you_get_my_number", "How did you get my number?", "Fair question. You filled out a life insurance request online, and it listed this number and gave permission for a licensed agent to call. If you'd rather not hear from us, I'll take you off our list right now."],
    ["too_expensive", "It's too expensive", "I hear you. Let's look at a smaller amount or a shorter term. Even covering the mortgage and final costs usually comes in under what people expect."],
    ["already_covered", "I already have coverage", "That's great. Most people I talk to have something through work, and it ends when the job does. Would it help to check whether yours would still cover the mortgage if it did?"],
    ["send_me_something", "Just send me something", "Happy to. The rates depend on a couple of health questions, so what I send would be a guess. Give me two minutes and I'll send you your real numbers instead."],
    ["not_interested", "I'm not interested", "Understood. Can I ask if it's the timing or the idea of coverage itself? If it's timing, I can call back when it suits you better."],
    ["call_me_later", "Call me later", "No problem. What works better, later today or tomorrow morning? I'll put it in your local time so I don't catch you at dinner."],
  ];
  const haveRebuttals = must(await db.from("tenant_rebuttals").select("objection_key, label, body").eq("tenant_id", TENANT_ID), "read rebuttals");
  for (const [objection_key, label, body] of rebuttals) {
    const found = haveRebuttals.find((row) => row.objection_key === objection_key);
    if (found && found.label === label && found.body === body) { bump("tenant_rebuttals", "kept"); continue; }
    bump("tenant_rebuttals", found ? "updated" : "inserted");
    if (!DRY) ok(await api("PUT", "/api/app/dialer/rebuttals", "owner", { objection_key, label, body, sort_order: rebuttals.findIndex((r) => r[0] === objection_key) * 10 }), `save rebuttal ${objection_key}`);
  }
  note("rebuttals: 6, not ~8 — tenant_rebuttals allows exactly six objection keys, one row each");
  note("state disclosures are admin-owned placeholder text (NOT COMPLIANCE-APPROVED); not written here");
});

// =============================================================================
// D14 (part 1) · suppressions entered by hand, before the files and posts that hit them
// =============================================================================
await section("D14 manual suppressions", async () => {
  const dnc = must(await db.from("tenant_do_not_call").select("phone_digits").eq("tenant_id", TENANT_ID).in("phone_digits", OWN_DNC.map((d) => d.phone)), "read dnc");
  const list = must(await db.from("tenant_suppression_list").select("phone_digits, list_type").eq("tenant_id", TENANT_ID).in("phone_digits", LITIGATORS.map((d) => d.phone)), "read litigators");
  for (const entry of [...OWN_DNC, ...LITIGATORS]) {
    const exists = entry.listType === "internal" ? dnc.some((r) => r.phone_digits === entry.phone) : list.some((r) => r.phone_digits === entry.phone && r.list_type === entry.listType);
    const table = entry.listType === "internal" ? "tenant_do_not_call" : "tenant_suppression_list";
    if (exists) { bump(table, "kept"); continue; }
    bump(table, "inserted");
    if (!DRY) ok(await api("POST", "/api/app/suppression", "owner", { phone: entry.phone, listType: entry.listType, reason: entry.reason, source: entry.source }), `suppress ${entry.phone}`);
  }
});

// =============================================================================
// AG-D8 · publishers, one per payout model (POST /api/app/partners, add_term, transition)
// =============================================================================
const PUBLISHERS = [
  { name: "Demo · Harborline Transfers", partner_type: "publisher", payout_model: "per_transfer", rate_cents: 4500, timezone: "America/New_York", contact_name: "Renee Albright" },
  { name: "Demo · Keystone Lead Exchange", partner_type: "publisher", payout_model: "per_lead", rate_cents: 1200, timezone: "America/Chicago", contact_name: "Malcolm Birch" },
  { name: "Demo · Northgate Media", partner_type: "publisher", payout_model: "per_sale", rate_cents: 15000, timezone: "America/Denver", contact_name: "Ines Carrow" },
  { name: "Demo · Evergreen Referral Network", partner_type: "publisher", payout_model: "per_issued_policy", rate_cents: 20000, timezone: "America/Los_Angeles", contact_name: "Otto Lindqvist" },
  { name: "Demo · Lakeshore Partners", partner_type: "publisher", payout_model: "revenue_share", rate_pct_bp: 1500, timezone: "America/Chicago", contact_name: "Priya Anand" },
];
await section("AG-D8 publishers (each payout model)", async () => {
  // The tenant was at max_publishers 10 of 10 (three QA drafts left by a tester cannot be removed
  // without an irreversible offboarding), so the tenant's PRIVATE plan gets room for 20 first.
  {
    const plan = must(await db.from("plans").select("id, is_public").eq("code", PLAN_CODE).eq("version", 1).single(), "read plan");
    const users = must(await db.from("subscriptions").select("tenant_id").eq("plan_id", plan.id), "read plan subscribers");
    if (plan.is_public || users.some((u) => u.tenant_id !== TENANT_ID)) throw new Error(`${PLAN_CODE} is public or shared; not raising its publisher cap`);
    const limits = must(await db.from("plan_limits").select("max_publishers").eq("plan_id", plan.id).single(), "read limits");
    if (limits.max_publishers !== null && limits.max_publishers < 20) {
      note(`max_publishers on ${PLAN_CODE}: ${limits.max_publishers} → 20`);
      bump("plan_limits (max_publishers)", "updated");
      if (!DRY) {
        must(await db.from("plan_limits").update({ max_publishers: 20 }).eq("plan_id", plan.id), "raise publisher cap");
        must(await db.rpc("refresh_tenant_entitlement", { p_tenant_id: TENANT_ID }), "refresh entitlement");
        must(await db.from("audit_log").insert({ actor_type: "system", actor_id: null, action: "plan.limits_changed", target_type: "plan", target_id: plan.id, reason: "Module 2 / AG demo: room for five demo publishers (the tenant was at 10 of 10).", metadata: { qa_seed: TAG, tenantId: TENANT_ID, plan: PLAN_CODE, before: { max_publishers: limits.max_publishers }, after: { max_publishers: 20 }, undo: `update plan_limits set max_publishers = ${limits.max_publishers} where plan_id = '${plan.id}'; then select refresh_tenant_entitlement('${TENANT_ID}').` } }), "audit publisher cap");
        bump("audit_log", "inserted");
      }
    } else bump("plan_limits (max_publishers)", "kept");
  }
  const have = must(await db.from("partners").select("id, name, status").eq("tenant_id", TENANT_ID).like("name", "Demo · %"), "read partners");
  const terms = have.length ? must(await db.from("partner_terms").select("partner_id, payout_model").in("partner_id", have.map((p) => p.id)), "read terms") : [];
  for (const spec of PUBLISHERS) {
    let partner = have.find((p) => p.name === spec.name);
    if (!partner) {
      bump("partners", "inserted");
      if (DRY) continue;
      partner = ok(await api("POST", "/api/app/partners", "owner", { name: spec.name, partner_type: spec.partner_type, country: "US", contact_name: `${spec.contact_name} (fictional)`, contact_email: `${spec.contact_name.toLowerCase().replace(/[^a-z]+/g, ".")}@partners.example`, timezone: spec.timezone, notes: `qa_seed ${TAG}: pays ${spec.payout_model.replace(/_/g, " ")}.` }), `create partner ${spec.name}`).partner;
    } else bump("partners", "kept");
    if (!terms.some((t) => t.partner_id === partner.id)) {
      bump("partner_terms", "inserted");
      if (!DRY) ok(await api("PATCH", `/api/app/partners/${partner.id}`, "owner", { action: "add_term", payout_model: spec.payout_model, rate_cents: spec.rate_cents ?? null, rate_pct_bp: spec.rate_pct_bp ?? null, effective_from: "2026-09-01" }), `term ${spec.name}`);
    } else bump("partner_terms", "kept");
    if (!DRY && partner.status !== "active") {
      const moved = await api("PATCH", `/api/app/partners/${partner.id}`, "owner", { action: "transition", next_status: "active", reason: "Agreement signed; demo publisher goes live." });
      if (moved.status >= 300) note(`activate ${spec.name}: HTTP ${moved.status} ${moved.text.slice(0, 160)}`); else bump("partners (activated)", "updated");
    }
  }
});

// =============================================================================
// D4 · the files, through the reviewed importer
// =============================================================================
const FILE_RESULT = new Map();
async function meterTotals() {
  const rows = must(await db.from("usage_totals").select("meter_key, used_qty, period_start").eq("tenant_id", TENANT_ID), "read usage");
  const current = rows.filter((row) => Date.parse(row.period_start) === PERIOD_START);
  return Object.fromEntries(["monthly_leads_imported", "dnc_lookups", "tcpa_checks"].map((key) => [key, current.find((row) => row.meter_key === key)?.used_qty ?? 0]));
}
await section("D4 vendor column maps", async () => {
  const have = must(await db.from("tenant_import_mappings").select("vendor_id, mapping, date_order").eq("tenant_id", TENANT_ID).eq("product_code", PRODUCT), "read mappings");
  for (const [vendor, style] of [["bayview", "bayview"], ["crestview", "crestview"], ["oakridge", "oakridge"]]) {
    const found = have.find((row) => row.vendor_id === VENDOR_ID[vendor]);
    const want = STYLES[style].map;
    if (found && JSON.stringify(found.mapping) === JSON.stringify(want) && (found.date_order ?? null) === STYLES[style].dateOrder) { bump("tenant_import_mappings", "kept"); continue; }
    bump("tenant_import_mappings", found ? "updated" : "inserted");
    if (!DRY) ok(await api("PUT", "/api/app/leads/import/mappings", "owner", { vendor_id: VENDOR_ID[vendor], product_code: PRODUCT, mapping: want, date_order: STYLES[style].dateOrder }), `save mapping ${vendor}`);
  }
});

await section("D4 imports (preflight → commit)", async () => {
  const done = must(await db.from("agent_lead_import_batches").select("id, file_name, status, response, created_at").eq("tenant_id", TENANT_ID).like("file_name", "qa-d2-%"), "read batches");
  for (const file of FILES) {
    // A file that committed nothing although it holds leads (2026-09-25: the intake form was being
    // edited by another session while it was read, and every row came back unreadable) is sent again
    // as the vendor's re-send: the same rows plus a "Batch Ref" column, so it is a new file to the importer.
    const expectsLeads = file.data.some((r) => r.kind === "lead");
    let version = 1;
    while (true) {
      const name = version === 1 ? file.name : file.name.replace(/\.csv$/, `-v${version}.csv`);
      const found = done.find((row) => row.file_name === name && row.status === "completed");
      if (found && expectsLeads && Number(found.response?.imported ?? 0) + Number(found.response?.attachedToExisting ?? 0) === 0) { version += 1; if (version > 5) throw new Error(`${file.name}: five empty commits`); continue; }
      file.version = version; file.sentName = name; file.completed = found; break;
    }
    if (file.version > 1) file.sentCsv = csvFor(file, file.version);
    const completed = file.completed;
    if (completed) { FILE_RESULT.set(file.key, { batchId: completed.id, summary: completed.response, kept: true }); bump("agent_lead_import_batches", "kept"); continue; }
    bump("agent_lead_import_batches", "inserted");
    if (DRY) continue;
    await waitForServer();
    const before = await meterTotals();
    const style = STYLES[file.style];
    const csv = file.sentCsv ?? file.csv;
    const mapping = file.version > 1 ? { ...style.map, "batch ref": null } : style.map;
    const preflightBody = { csv, campaign_id: CAMPAIGN_ID[file.campaign], vendor_id: VENDOR_ID[CAMPAIGNS[file.campaign].vendor], mapping, file_name: file.sentName, cost_cents: file.costCents, records_purchased: file.rows, date_order: style.dateOrder };
    let first = await api("POST", "/api/app/leads/import/preflight", file.importer, preflightBody);
    if (first.status >= 300 && /Screening could not be completed|screening cache|statement timeout|vendor is unavailable/i.test(first.text)) {
      // A screening outage: retried once after a minute, then the file is skipped and reported.
      note(`${file.sentName}: ${first.text.slice(0, 160)} — retrying once in 60s`);
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      await waitForServer();
      first = await api("POST", "/api/app/leads/import/preflight", file.importer, preflightBody);
      if (first.status >= 300) { note(`SKIPPED ${file.sentName}: screening failed twice (${first.text.slice(0, 160)})`); bump("agent_lead_import_batches (skipped)", "failed"); continue; }
    }
    const staged = ok(first, `preflight ${file.sentName}`);
    if (expectsLeads && !staged.counts?.ready && staged.counts?.unreadable === file.rows) throw new Error(`${file.sentName}: every row came back unreadable at preflight; the intake form has probably changed under the import. Not committing.`);
    const commitBody = { batch_id: staged.batchId, csv, decisions: { duplicates_in_file: "first", existing_leads: "attach", dnc: "exclude" }, add_to_campaign_spend: true };
    let commitResult = await api("PUT", "/api/app/leads/import/preflight", file.importer, commitBody);
    if (commitResult.status >= 300 && /statement timeout/i.test(commitResult.text)) {
      // The commit is one transaction, so a timed-out one wrote no leads; retried once after a minute.
      note(`${file.sentName}: commit timed out in the database — retrying once in 60s`);
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      await waitForServer();
      commitResult = await api("PUT", "/api/app/leads/import/preflight", file.importer, commitBody);
      if (commitResult.status >= 300) { note(`SKIPPED ${file.sentName}: commit failed twice (${commitResult.text.slice(0, 160)}); it stays staged for review`); bump("agent_lead_import_batches (skipped)", "failed"); continue; }
    }
    const committed = ok(commitResult, `commit ${file.sentName}`);
    if (expectsLeads && committed.summary.imported + committed.summary.attachedToExisting === 0) throw new Error(`${file.sentName}: committed nothing although the preflight found ${staged.counts?.ready} ready rows; stopping so it can be looked at.`);
    const after = await meterTotals();
    const delta = Object.fromEntries(Object.keys(after).map((key) => [key, after[key] - before[key]]));
    FILE_RESULT.set(file.key, { batchId: staged.batchId, counts: staged.counts, summary: committed.summary, delta });
    const s = committed.summary;
    console.log(`  ${file.sentName}: ${file.rows} rows → ${s.imported} new, ${s.attachedToExisting} attached, ${s.skippedDuplicates} dup, ${s.excluded} excluded, ${s.rejectionsRecorded} ledgered · ${JSON.stringify(staged.counts)} · meters +${delta.monthly_leads_imported}/${delta.dnc_lookups}/${delta.tcpa_checks}`);
  }
}, { critical: true });

// =============================================================================
// D12 · real-time posts, through the vendor's own key
// =============================================================================
const POST_RESULT = new Map();
await section("D12 real-time campaign scrub + post key + posts", async () => {
  if (DRY) { bump("tenant_lead_post_log", "inserted", POSTS.length); bump("tenant_vendor_post_keys", "inserted"); return; }
  const campaign = must(await db.from("tenant_campaigns").select("id, scrub_status, status").eq("id", CAMPAIGN_ID.summit).single(), "read summit");
  if (campaign.scrub_status !== "scrubbed") {
    const token = uid("scrub-token", "summit");
    let run = ok(await api("POST", `/api/app/campaigns/${campaign.id}/scrub`, "owner", { action: "start", token }), "start scrub").run;
    for (let i = 0; i < 50 && run?.status === "running"; i += 1) run = ok(await api("POST", `/api/app/campaigns/${campaign.id}/scrub`, "owner", { action: "step", token, runId: run.id }), "step scrub").run;
    note(`Summit real-time campaign scrub run: ${run?.status}`);
  }
  const logged = must(await db.from("tenant_lead_post_log").select("idempotency_key, lead_id, reason_code, http_status").eq("tenant_id", TENANT_ID).eq("vendor_id", VENDOR_ID.summit).like("idempotency_key", "qa-d2:post:%"), "read post log");
  for (const row of logged) POST_RESULT.set(row.idempotency_key, row);
  const pending = POSTS.filter((post) => !POST_RESULT.has(post.key));
  bump("tenant_lead_post_log", "kept", POSTS.length - pending.length);
  if (!pending.length) return;
  let key = null;
  const keys = must(await db.from("tenant_vendor_post_keys").select("id, is_active").eq("tenant_id", TENANT_ID).eq("vendor_id", VENDOR_ID.summit), "read post keys");
  const fieldMap = { phone: "phone1", state: "st", date_of_birth: "dob" };
  if (!keys.length) {
    const minted = ok(await api("POST", "/api/app/lead-post-keys", "owner", { vendorId: VENDOR_ID.summit, fieldMap, fieldNotes: { phone1: "Summit's primary phone, any format", st: "Two-letter state" }, campaignId: CAMPAIGN_ID.summit }), "mint post key");
    key = minted.key; bump("tenant_vendor_post_keys", "inserted");
  } else {
    // The key is shown once and stored only as a hash; a resumed run rotates it to post the rest.
    const rotated = ok(await api("PATCH", `/api/app/lead-post-keys/${keys[0].id}`, "owner", { action: "rotate" }), "rotate post key");
    key = rotated.key; bump("tenant_vendor_post_keys", "updated");
  }
  await mapLimit(pending, 1, async (post) => {
    const response = await api("POST", `/api/leads/post/${key}`, null, post.payload, { "Idempotency-Key": post.key });
    POST_RESULT.set(post.key, { idempotency_key: post.key, lead_id: response.json?.lead_id ?? null, reason_code: response.json?.reason_code, http_status: response.status });
    bump("tenant_lead_post_log", "inserted");
  });
  const codes = {};
  for (const post of POSTS) { const r = POST_RESULT.get(post.key); codes[r?.reason_code ?? "?"] = (codes[r?.reason_code ?? "?"] ?? 0) + 1; }
  note(`posts by reason code: ${Object.entries(codes).map(([k, v]) => `${v} ${k}`).join(", ")}`);
});

// =============================================================================
// AG-D9 · contacts, with probable duplicates and one merged pair (POST /api/app/contacts/import)
// The leads are linked to them afterwards with the importer's own link_leads_to_contacts.
// =============================================================================
await section("AG-D9 contacts + duplicates + one merge", async () => {
  // POST /api/app/contacts ("Add contact"), one person at a time: the CSV contact import cannot fill
  // this tenant's required boolean custom field (Tobacco use), so it refuses every row.
  const people = LEAD_ROWS.filter((r) => (r.campaign === "bayviewA" || r.campaign === "crest") && r.state).slice(0, 1980);
  const dupSource = people.filter((_, i) => i % 97 === 11).slice(0, 20);
  const typoDob = (dob) => { const d = new Date(`${dob}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + (d.getUTCDate() > 27 ? -1 : 1)); return d.toISOString().slice(0, 10); };
  const body = (r, dup) => {
    const dob = dup ? typoDob(r.dob) : r.dob;
    const email = dup ? `${r.first}.${r.last}.home@example.com`.toLowerCase().normalize("NFD").replace(/[^a-z0-9.@]/g, "") : r.email || null;
    return { first_name: r.first, last_name: r.last, dob, primary_phone: r.phone, email, state: r.state, postal_code: r.zip, custom_fields: { first_name: r.first, last_name: r.last, phone: r.phone, date_of_birth: dob, state: r.state, tobacco: r.tobacco, zip: r.zip, ...(email ? { email } : {}), ...(r.language ? { language: r.language } : {}) } };
  };
  const rows = [...people.map((r) => ({ r, dup: false })), ...dupSource.map((r) => ({ r, dup: true }))];
  const existing = await inChunks([...new Set(rows.map(({ r }) => r.phone))], 150, (part) => db.from("contacts").select("id, primary_phone, dob, merged_into_id").eq("tenant_id", TENANT_ID).in("primary_phone", part));
  const seen = new Set(existing.map((c) => `${c.primary_phone}:${String(c.dob ?? "").slice(0, 10)}`));
  const todo = rows.filter(({ r, dup }) => !seen.has(`${r.phone}:${dup ? typoDob(r.dob) : r.dob}`));
  bump("contacts", "kept", rows.length - todo.length);
  if (DRY) { bump("contacts", "inserted", todo.length); bump("contact_duplicate_reviews", "inserted", dupSource.length); return; }
  let queued = 0, autoMerged = 0, failed = 0;
  for (const { r, dup } of todo) {
    const created = await api("POST", "/api/app/contacts", "priya", body(r, dup));
    if (created.status >= 300) { failed += 1; if (failed <= 3) note(`contact ${r.phone}: HTTP ${created.status} ${created.text.slice(0, 160)}`); if (failed >= 25) throw new Error("too many contacts refused"); continue; }
    queued += created.json.queued ?? 0;
    if (created.json.outcome === "auto_merged") autoMerged += 1; else bump("contacts", "inserted");
  }
  bump("contact_duplicate_reviews", "inserted", queued);
  note(`contacts: ${todo.length} sent, ${queued} queued for review, ${autoMerged} auto-merged, ${failed} refused`);
  // One pair a person has already reviewed and merged.
  const first = dupSource[0];
  const pair = must(await db.from("contacts").select("id, dob, merged_into_id, created_at").eq("tenant_id", TENANT_ID).eq("primary_phone", first.phone).order("created_at"), "read pair");
  if (pair.length === 2 && !pair.some((c) => c.merged_into_id)) {
    const [kept, merged] = pair;
    const review = must(await db.from("contact_duplicate_reviews").select("id").eq("tenant_id", TENANT_ID).eq("status", "pending").or(`and(contact_id.eq.${merged.id},candidate_id.eq.${kept.id}),and(contact_id.eq.${kept.id},candidate_id.eq.${merged.id})`).limit(1).maybeSingle(), "read review");
    ok(await api("POST", "/api/app/contacts/merge", "priya", { kept_id: kept.id, merged_id: merged.id, field_choices: {}, review_id: review?.id ?? null }), "merge pair");
    bump("merge_log", "inserted");
  } else bump("merge_log", "kept");
});

// =============================================================================
// Read the leads back: every seeded lead, its work item, its cohort
// =============================================================================
const LEAD = new Map(); // phone → { id, workItemId, campaign, createdAt, row|post }
await section("read back seeded leads", async () => {
  const campaignKeyById = Object.fromEntries(Object.entries(CAMPAIGN_ID).map(([k, v]) => [v, k]));
  if (DRY) {
    for (const row of LEAD_ROWS) LEAD.set(row.phone, { id: uid("dry-lead", row.phone), workItemId: uid("dry-wi", row.phone), campaign: row.campaign, row, state: row.state, tz2: splitZone(row), values: {} });
    for (const post of POSTS.filter((p) => p.kind === "accepted")) LEAD.set(post.phone, { id: uid("dry-lead", post.phone), workItemId: uid("dry-wi", post.phone), campaign: "summit", post, state: post.state, values: {} });
    return;
  }
  const ids = Object.values(CAMPAIGN_ID);
  const leads = await fetchAll(() => db.from("agent_leads").select("id, campaign_id, values, created_at, posted_at, lead_state, attempts_made").eq("tenant_id", TENANT_ID).in("campaign_id", ids).order("id"));
  const rowByPhone = new Map(LEAD_ROWS.map((row) => [row.phone, row]));
  const postByPhone = new Map(POSTS.filter((p) => p.kind === "accepted").map((p) => [p.phone, p]));
  for (const lead of leads) {
    const phone = String(lead.values?.phone ?? "");
    LEAD.set(phone, { id: lead.id, campaign: campaignKeyById[lead.campaign_id], row: rowByPhone.get(phone), post: postByPhone.get(phone), state: lead.values?.state ?? "", tz2: splitZone(rowByPhone.get(phone)), values: lead.values, createdAt: lead.created_at, postedAt: lead.posted_at, leadState: lead.lead_state, attemptsMade: lead.attempts_made });
  }
  const queue = await inChunks(leads.map((l) => l.id), 150, (part) => db.from("lead_queue").select("id, lead_id, status, created_at, nurtured_from_work_item_id").eq("tenant_id", TENANT_ID).in("lead_id", part).order("created_at"));
  const firstItem = new Map();
  for (const item of queue) if (!firstItem.has(item.lead_id) && !item.nurtured_from_work_item_id) firstItem.set(item.lead_id, item);
  for (const lead of LEAD.values()) lead.workItemId = firstItem.get(lead.id)?.id ?? null;
  const unknown = [...LEAD.values()].filter((l) => !l.row && !l.post).length;
  note(`${LEAD.size} seeded leads read back (${[...LEAD.values()].filter((l) => l.post).length} posted); ${unknown} not matched to a generated row; ${[...LEAD.values()].filter((l) => !l.workItemId).length} without a work item`);
}, { critical: true });

// Leads imported before their contact existed are linked the way the importer links them
// (link_leads_to_contacts, confident matches only: same name, same date of birth, same phone or address).
await section("AG-D9 link leads to contacts", async () => {
  if (DRY) return;
  const unlinked = await inChunks([...LEAD.values()].map((l) => l.id), 150, (part) => db.from("agent_leads").select("id, values").in("id", part).is("contact_id", null));
  const norm = (v) => String(v ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, "").trim();
  const items = unlinked.map((l) => {
    const v = l.values ?? {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.date_of_birth ?? "")) || !v.first_name || !v.last_name) return null;
    const search = v.zip ? norm([v.zip, v.state].filter(Boolean).join(" ")) : "";
    return { lead_id: l.id, name_search: norm(`${v.first_name} ${v.last_name}`), dob: v.date_of_birth, phone: String(v.phone ?? "").replace(/\D/g, "") || null, address_hash: search ? sha(search) : null, address_search: search || null };
  }).filter(Boolean);
  let linked = 0;
  for (const part of chunk(items, 500)) linked += Number(must(await db.rpc("link_leads_to_contacts", { p_tenant_id: TENANT_ID, p_items: part }), "link leads")) || 0;
  bump("agent_leads (contact link)", linked ? "updated" : "kept", linked || unlinked.length);
  note(`linked ${linked} of ${unlinked.length} unlinked seeded leads to a contact`);
});

// The scoring holdout, computed exactly as serve_next_lead does: abs(hashtextextended(lead_id, 42)) % 100.
const BUCKET = new Map();
await section("scoring cohort buckets", async () => {
  const ids = [...LEAD.values()].map((l) => l.id);
  if (DRY || !process.env.TENANT_DB_URL) { for (const id of ids) BUCKET.set(id, seedOf(id) % 100); if (!DRY) note("TENANT_DB_URL missing: cohort buckets approximated"); return; }
  const client = new pg.Client({ connectionString: process.env.TENANT_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    for (const part of chunk(ids, 5000)) {
      const result = await client.query("select x as id, (abs(hashtextextended(x, 42)) % 100)::int as b from unnest($1::text[]) as x", [part]);
      for (const row of result.rows) BUCKET.set(row.id, row.b);
    }
  } finally { await client.end(); }
});

// =============================================================================
// The simulation: every dial, deterministically, from the day each list arrived
// =============================================================================
const SHIFT = {
  owner: { days: [1, 2, 3, 4, 5], from: 9 * 60, to: 16 * 60 },
  marisol: { days: [1, 2, 3, 4, 5], from: 8 * 60, to: 18 * 60, sat: [9 * 60, 12 * 60] },
  devin: { days: [1, 2, 3, 4, 5], from: 9 * 60, to: 20 * 60 },
  jordan: { days: [1, 2, 3, 4, 5], from: 8 * 60, to: 17 * 60 },
  aaliyah: { days: [1, 2, 3, 4, 5], from: 8 * 60, to: 16 * 60, sat: [9 * 60, 13 * 60] },
};
const AGENT_WEIGHT = { owner: 1, marisol: 2, devin: 2, jordan: 3, aaliyah: 2.5 };
const PRODUCER_STATES = { owner: null, marisol: ["TX", "OK", "FL"], devin: ["TX", "AZ", "NC"] };
const AGENCY_LICENSED = new Set(["TX", "FL", "AZ", "ME", "OK", "NC", "OH", "PA", "TN", "AL", "MO", "IL"]);
const isSetter = (agent) => agent === "jordan" || agent === "aaliyah";
function canWork(agent, state) {
  if (isSetter(agent)) return true;
  if (!AGENCY_LICENSED.has(state)) return false;
  return !PRODUCER_STATES[agent] || PRODUCER_STATES[agent].includes(state);
}
function onShift(agent, ms) {
  const l = local(ms, "America/Chicago");
  const shift = SHIFT[agent];
  if (shift.days.includes(l.dow)) return l.mins >= shift.from && l.mins < shift.to;
  if (l.dow === 6 && shift.sat) return l.mins >= shift.sat[0] && l.mins < shift.sat[1];
  return false;
}
const CAMPAIGN_PAUSED_AT = Date.parse("2026-09-22T13:00:00Z");
function campaignOpen(campaign, ms) { return campaign !== "crest" || ms < CAMPAIGN_PAUSED_AT; }
/** The next moment someone may legally dial this lead, preferring a slot it has not been tried in. */
function nextDialTime(lead, due, tried, rng, forcedAgent = null) {
  let firstLegal = null;
  for (let t = Math.ceil(due / (15 * MIN)) * 15 * MIN, i = 0; i < 7 * 96; i += 1, t += 15 * MIN) {
    if (!legal(t, lead) || !campaignOpen(lead.campaign, t)) continue;
    const agents = forcedAgent ? [forcedAgent].filter((a) => onShift(a, t)) : AGENTS.filter((a) => onShift(a, t) && canWork(a, lead.state));
    if (!agents.length) continue;
    if (!firstLegal) firstLegal = t;
    if (!tried.has(slotOf(t, lead.state)) || t - due > 3 * DAY) {
      const jitter = rng.int(0, 13) * MIN + rng.int(0, 59) * 1000;
      const at = legal(t + jitter, lead) ? t + jitter : t;
      return { at, agents };
    }
  }
  if (!firstLegal) return null;
  return { at: firstLegal, agents: forcedAgent ? [forcedAgent] : AGENTS.filter((a) => onShift(a, firstLegal) && canWork(a, lead.state)) };
}
const PLAN = {
  oakridge: { dial: 1350, from: "2026-08-28T13:00:00Z", to: "2026-09-09T22:00:00Z", contact: 0.45, bad: 1.8 },
  bayviewA: { dial: 1150, from: "2026-08-31T13:00:00Z", to: "2026-09-12T22:00:00Z", contact: 1.0, bad: 1.0 },
  crest: { dial: 620, from: "2026-09-07T13:00:00Z", to: "2026-09-19T22:00:00Z", contact: 0.95, bad: 1.1 },
  bayviewB: { dial: 520, from: "2026-09-16T13:00:00Z", to: "2026-09-24T22:00:00Z", contact: 1.0, bad: 1.0 },
  premium: { dial: 170, from: "2026-09-18T17:00:00Z", to: "2026-09-24T22:00:00Z", contact: 1.8, bad: 0.4 },
  summit: { dial: Infinity, contact: 2.0, bad: 0.5 },
};
const SCORING_ON_FROM = Date.parse("2026-09-10T14:00:00Z");
const CONTACT_OUTCOMES = new Set(["not_interested", "callback", "do_not_call", "app", "did_not_qualify", "booking"]);
const RETRY_OUTCOMES = new Set(["no_answer", "voicemail", "busy", "call_dropped"]);
function sampleOutcome(rng, lead, agent, n, at, factorExtra = 1) {
  const plan = PLAN[lead.campaign];
  const cohortFactor = at >= SCORING_ON_FROM ? (lead.bucket < 10 ? 0.8 : 1.07) : 1;
  const attemptFactor = [1.25, 1.1, 1.0, 0.95, 0.9, 0.85, 0.8][Math.min(n - 1, 6)];
  const rt = lead.campaign === "summit" && n === 1 ? 1.2 : 1;
  const c = plan.contact * cohortFactor * attemptFactor * rt * factorExtra;
  const bad = plan.bad;
  return rng.weighted([
    ["no_answer", 60], ["voicemail", 18], ["busy", 2], ["call_dropped", 2],
    ["wrong_number", 2.6 * bad], ["disconnected", 1.9 * bad],
    ["not_interested", 8.2 * c], ["callback", 0.22 * c], ["do_not_call", 0.35 * c],
    [isSetter(agent) ? "booking" : "app", (isSetter(agent) ? (at >= T0 - 5 * DAY ? 3.2 : 0.75) : 1.7) * c], ["did_not_qualify", 0.6 * c],
  ]);
}
function producerFor(lead) {
  return ["marisol", "devin", "owner"].filter((a) => canWork(a, lead.state));
}
// Producer calendars (D7): Mon–Fri 09:00–17:00 Central, lunch 12–13, one weekly block each.
const WEEKLY_BLOCK = { marisol: { dow: 3, from: 15 * 60, to: 16 * 60, reason: "Team pipeline review" }, devin: { dow: 5, from: 14 * 60, to: 15 * 60, reason: "Carrier product training" } };
function producerFree(agent, ms, busy) {
  const l = local(ms, "America/Chicago");
  if (l.dow < 1 || l.dow > 5) return false;
  if (l.mins < 9 * 60 || l.mins + 30 > 17 * 60) return false;
  if (l.mins + 30 > 12 * 60 && l.mins < 13 * 60) return false;
  const b = WEEKLY_BLOCK[agent];
  if (b && l.dow === b.dow && l.mins + 30 > b.from && l.mins < b.to) return false;
  const day = busy.get(`${agent}:${l.date}`) ?? [];
  if (day.length >= 6) return false;
  return !day.some((s) => Math.abs(s - ms) < 40 * MIN);
}
function claimSlot(agent, ms, busy) { const key = `${agent}:${local(ms, "America/Chicago").date}`; busy.set(key, [...(busy.get(key) ?? []), ms]); }

const SIM = { leads: [], attempts: [], cards: [], callbacks: [], appointments: [], apps: [], dnc: [] };
function simulate() {
  const busy = new Map();
  const leadsByCampaign = new Map();
  for (const lead of LEAD.values()) {
    if (!lead.state || !STATE_TZ[lead.state]) continue; // no state: not dialable (LA-2.4-8)
    lead.bucket = BUCKET.get(lead.id) ?? 50;
    const list = leadsByCampaign.get(lead.campaign) ?? [];
    list.push(lead);
    leadsByCampaign.set(lead.campaign, list);
  }
  for (const [campaign, leads] of leadsByCampaign) {
    const plan = PLAN[campaign];
    const ordered = [...leads].sort((a, b) => seedOf(`order:${a.id}`) - seedOf(`order:${b.id}`));
    const dialled = campaign === "summit" ? ordered : ordered.slice(0, plan.dial);
    dialled.forEach((lead, i) => {
      const rng = rngFor(`lead:${lead.id}`);
      let first;
      if (campaign === "summit") {
        const post = lead.post;
        const stl = rng.chance(0.42) ? rng.int(20, 59) * 1000 : rng.chance(0.7) ? rng.int(60, 300) * 1000 : rng.int(300, 1200) * 1000;
        first = post.at + stl;
        lead.postedAt = post.at;
      } else {
        const from = Date.parse(plan.from), to = Date.parse(plan.to);
        first = from + Math.floor(((to - from) * i) / dialled.length) + rng.int(0, 90) * MIN;
      }
      runLead(lead, first, rng, busy);
    });
  }
}
function newCallback(lead, attempt, at, assignee, noteText, kind) {
  const cb = { id: uid("callback", `${lead.id}:${attempt.n}`), lead, attempt, scheduledAt: at, assignee, createdBy: attempt.agent, createdAt: attempt.endAt, note: noteText, kind, history: [{ action: "scheduled", at: attempt.endAt, actor: attempt.agent, newAt: at, newStatus: "scheduled" }], status: "scheduled" };
  SIM.callbacks.push(cb);
  return cb;
}
function nextLegalLocal(lead, fromMs, hours, rng) {
  const tz = STATE_TZ[lead.state];
  for (let d = 0; d < 10; d += 1) {
    const date = local(fromMs + d * DAY, tz).date;
    const at = atLocal(date, rng.pick(hours), rng.pick([0, 15, 30, 45]), tz);
    if (at > fromMs && legal(at, lead)) return at;
  }
  return null;
}
function runLead(lead, first, rng, busy) {
  const campaign = lead.campaign;
  const delays = campaign === "premium" ? PREMIUM_DELAYS : DEFAULT_DELAYS;
  const tried = new Set();
  let due = first, n = 0, skipped = false, forced = null, factor = 1, pendingCallback = null, pendingAppt = null;
  lead.sim = { attempts: [], state: "fresh", callbacks: [] };
  for (let guard = 0; guard < 20; guard += 1) {
    // A real-time lead is dialled the moment it lands (speed to lead), not on the next quarter hour.
    const onArrival = campaign === "summit" && n === 0 && !skipped ? AGENTS.filter((a) => onShift(a, due) && canWork(a, lead.state)) : [];
    const pick = onArrival.length && legal(due, lead) ? { at: due, agents: onArrival } : nextDialTime(lead, due, tried, rng, forced);
    if (!pick || pick.at >= T0) { finish(lead, n ? "retry" : "fresh", due, tried); break; }
    const at = pick.at;
    // ~1% of cards are served and closed without a dial: served, never dispositioned.
    if (!skipped && !forced && rng.chance(0.012)) {
      skipped = true;
      const agent = rng.weighted(pick.agents.map((a) => [a, AGENT_WEIGHT[a]]));
      SIM.cards.push({ id: uid("card", `${lead.id}:skip`), lead, agent, servedAt: at - 20_000, attempt: null });
      due = at + rng.int(20, 120) * MIN;
      continue;
    }
    if (n >= 7) { finish(lead, "exhausted", null, tried); break; } // the ceiling, even for a call-back
    const agent = forced ?? rng.weighted(pick.agents.map((a) => [a, AGENT_WEIGHT[a]]));
    n += 1;
    let outcome = sampleOutcome(rng, lead, agent, n, at, factor);
    if (pendingCallback) { // the scheduled call-back itself: likelier to connect
      outcome = rng.weighted([["app", pendingCallback.kind === "finish_app" ? 55 : 22], ["not_interested", 30], ["did_not_qualify", 8], ["callback", 6], ["no_answer", 26], ["voicemail", 8]]);
      if (outcome === "app" && isSetter(agent)) outcome = "not_interested";
    }
    if (pendingAppt) outcome = pendingAppt.outcome === "showed" ? rng.weighted([["app", 42], ["not_interested", 30], ["callback", 18], ["did_not_qualify", 10]]) : "no_answer";
    if (outcome === "booking" && !producerFor(lead).filter((p) => p !== "owner").length) outcome = "not_interested";
    if (outcome === "app" && isSetter(agent)) outcome = "not_interested";
    const slot = slotOf(at, lead.state);
    tried.add(slot);
    const attempt = makeAttempt(lead, n, at, agent, outcome, slot, rng);
    lead.sim.attempts.push(attempt);
    SIM.attempts.push(attempt);
    if (pendingCallback) { pendingCallback.followUp = attempt; closeCallback(pendingCallback, attempt); pendingCallback = null; }
    if (pendingAppt) { pendingAppt.followUp = attempt; if (pendingAppt.callback) closeCallback(pendingAppt.callback, attempt); pendingAppt = null; }
    forced = null; factor = 1;
    if (RETRY_OUTCOMES.has(outcome)) {
      if (n >= 7) { finish(lead, "exhausted", null, tried, attempt); break; }
      due = at + delays[Math.min(n - 1, delays.length - 1)];
      continue;
    }
    if (outcome === "callback" || (outcome === "app" && rng.chance(0.2))) {
      const finishApp = outcome === "app";
      if (finishApp) { attempt.disposition = "callback_scheduled"; SIM.apps.push({ lead, attempt, agent, at, status: "partial" }); }
      const assignee = isSetter(agent) ? (producerFor(lead)[0] ?? "owner") : agent;
      const cbAt = nextLegalLocal(lead, at + rng.int(2, 50) * HOUR, [10, 11, 13, 14, 16, 17, 18], rng);
      const cb = newCallback(lead, attempt, cbAt ?? at + DAY, assignee, finishApp ? rng.pick(["Finish the application: needs the beneficiary's date of birth.", "Resume application: waiting on banking details for the draft.", "Finish application after spouse reviews the quote."]) : rng.pick(["Wants a call after work.", "Asked for a call back when her husband is home.", "Driving; call back this evening.", "Reviewing quotes from another agent; call back to compare.", "At the doctor's office, call tomorrow."]), finishApp ? "finish_app" : "plain");
      lead.sim.callbacks.push(cb);
      if (cb.scheduledAt < T0 - HOUR && onShift(assignee, cb.scheduledAt)) {
        pendingCallback = cb; forced = assignee; due = cb.scheduledAt + rng.int(0, 12) * MIN; continue;
      }
      if (cb.scheduledAt < T0 - HOUR) { cb.status = "missed"; cb.missedAt = cb.scheduledAt + 3 * HOUR; cb.history.push({ action: "missed", at: cb.missedAt, actor: null, via: "system", oldStatus: "scheduled", newStatus: "missed" }); due = cb.scheduledAt + DAY; continue; }
      finish(lead, "working", null, tried, attempt);
      break;
    }
    if (outcome === "booking") {
      const appt = bookAppointment(lead, attempt, rng, busy);
      if (!appt) { attempt.disposition = "not_interested"; finish(lead, "closed", null, tried, attempt); break; }
      attempt.disposition = "callback_scheduled";
      const cb = newCallback(lead, attempt, appt.startsAt, appt.agent, `Appointment booked by ${USER[agent].name}: ${appt.notes}`, "appointment");
      appt.callback = cb;
      lead.sim.callbacks.push(cb);
      const outcomeAppt = resolveAppointment(appt, rng, busy);
      if (outcomeAppt.pastFollowUp) { pendingAppt = outcomeAppt.pastFollowUp; forced = appt.finalAgent; due = pendingAppt.startsAt + rng.int(1, 4) * MIN; continue; }
      if (outcomeAppt.retryFrom) { due = outcomeAppt.retryFrom; continue; }
      finish(lead, "working", null, tried, attempt);
      break;
    }
    if (outcome === "app") {
      attempt.disposition = "application_submitted";
      SIM.apps.push({ lead, attempt, agent, at, status: "submitted" });
      finish(lead, "closed", null, tried, attempt); break;
    }
    if (outcome === "do_not_call") SIM.dnc.push({ lead, attempt });
    finish(lead, "closed", null, tried, attempt);
    break;
  }
  SIM.leads.push(lead);
}
function closeCallback(cb, attempt) {
  const contact = CONTACT_OUTCOMES.has(attempt.outcome);
  if (contact) { cb.status = "completed"; cb.completedAt = attempt.endAt; cb.keptAttempt = attempt; cb.history.push({ action: "completed", at: attempt.endAt, actor: attempt.agent, via: "call", oldStatus: "due", newStatus: "completed" }); }
  else { cb.status = "missed"; cb.missedAt = cb.scheduledAt + 2 * HOUR; cb.history.push({ action: "missed", at: cb.missedAt, actor: null, via: "system", oldStatus: "due", newStatus: "missed" }); }
}
function makeAttempt(lead, n, at, agent, outcome, slot, rng) {
  const disposition = outcome === "callback" ? "callback_scheduled" : outcome === "app" ? "application_submitted" : outcome === "booking" ? "callback_scheduled" : outcome;
  const zeroClick = rng.chance(0.024) && outcome !== "app" && outcome !== "booking";
  const fast = !zeroClick && rng.chance(0.004) && RETRY_OUTCOMES.has(outcome);
  const servedAt = at - rng.int(8, 40) * 1000;
  const clickAt = zeroClick ? null : at + rng.int(1, 6) * 1000;
  const talk = outcome === "app" ? rng.int(900, 2400) : outcome === "booking" ? rng.int(360, 900) : CONTACT_OUTCOMES.has(outcome) ? rng.int(70, 700) : outcome === "voicemail" ? rng.int(35, 75) : rng.int(18, 45);
  const endAt = fast ? servedAt + rng.int(2, 4) * 1000 : (clickAt ?? at) + talk * 1000;
  const attempt = { id: uid("attempt", `${lead.id}:${n}`), cardId: uid("card", `${lead.id}:${n}`), decisionId: uid("decision", `${lead.id}:${n}`), lead, n, at, servedAt, clickAt: fast ? null : clickAt, endAt, agent, outcome, disposition, slot, zeroClick: zeroClick || fast, fast };
  if (CONTACT_OUTCOMES.has(outcome) && rng.chance(0.35)) attempt.note = rng.pick(["Interested in 20-year term, wants to compare two carriers.", "Asked about no-exam options.", "Spouse on the line too.", "Already has group coverage through work.", "Said the monthly budget is about $40.", "Prefers Spanish; switched to Spanish mid-call.", "Wants coverage to pay off the mortgage."]);
  return attempt;
}
function finish(lead, state, due, tried, last = null) {
  lead.sim.state = state;
  lead.sim.nextDue = state === "retry" ? due : null;
  lead.sim.nextSlot = state === "retry" ? ["early_morning", "late_morning", "afternoon", "early_evening", "late_evening", "weekend"].find((s) => !tried.has(s)) ?? "afternoon" : null;
  lead.sim.last = last ?? lead.sim.attempts.at(-1) ?? null;
}
const SHOW = { jordan: [["showed", 60], ["no_show", 20], ["cancelled", 12], ["rescheduled", 8]], aaliyah: [["showed", 20], ["no_show", 52], ["cancelled", 18], ["rescheduled", 10]] };
function bookAppointment(lead, attempt, rng, busy, after = null, parent = null) {
  const agents = producerFor(lead).filter((p) => p !== "owner");
  const agent = parent?.agent && agents.includes(parent.agent) ? parent.agent : rng.pick(agents);
  const tz = STATE_TZ[lead.state];
  const base = after ?? attempt.endAt;
  for (let d = 1; d <= 8; d += 1) {
    for (const [hh, mm] of [[10, 0], [9, 30], [11, 0], [13, 30], [14, 30], [15, 30], [16, 0], [10, 30], [14, 0], [9, 0]].sort(() => rng.next() - 0.5)) {
      const date = local(base + d * DAY, "America/Chicago").date;
      const start = atLocal(date, hh, mm, "America/Chicago");
      if (start <= base + 12 * HOUR) continue;
      if (!legal(start, lead) || !legal(start + 30 * MIN, lead)) continue;
      if (!producerFree(agent, start, busy)) continue;
      claimSlot(agent, start, busy);
      const appt = { id: uid("appointment", `${lead.id}:${parent ? `${parent.id}:child` : attempt.n}`), lead, agent, bookedBy: parent?.bookedBy ?? attempt.agent, startsAt: start, createdAt: parent ? parent.changedAt : attempt.endAt, notes: rng.pick(["Wants to compare Americo and Foresters term quotes; has a 2019 diabetes diagnosis, controlled.", "Married, two kids; looking at $250k 20-year term. Spouse will join the call.", "Prefers the afternoon; hard of hearing, speak slowly.", "Already declined once by another carrier; needs an agent to review options.", "Budget around $45/month. Asked for a Spanish-speaking agent if possible.", "Retired teacher, wants final-expense sized coverage but asked about term first.", "Mortgage protection; closing on a house next month."]), customerTz: tz, parent, children: [] };
      if (parent) parent.children.push(appt);
      SIM.appointments.push(appt);
      return appt;
    }
  }
  return null;
}
function resolveAppointment(appt, rng, busy) {
  if (appt.startsAt >= T0) { appt.status = "upcoming"; appt.finalAgent = appt.agent; return {}; }
  const outcome = rng.weighted(SHOW[appt.bookedBy] ?? SHOW.jordan);
  appt.outcome = outcome;
  appt.finalAgent = appt.agent;
  const cb = appt.callback;
  if (outcome === "showed" || outcome === "no_show") {
    const follow = { outcome, startsAt: appt.startsAt, appt };
    if (outcome === "no_show" && rng.chance(0.25)) appt.rebook = true;
    return { pastFollowUp: follow };
  }
  appt.changedAt = Math.max(appt.startsAt - rng.int(5, 26) * HOUR, appt.createdAt + HOUR);
  if (outcome === "cancelled") {
    if (cb) { cb.status = "cancelled"; cb.history.push({ action: "cancelled", at: appt.changedAt, actor: cb.assignee, via: "manual", oldStatus: "scheduled", newStatus: "cancelled" }); }
    return { retryFrom: appt.startsAt + rng.int(2, 26) * HOUR };
  }
  // rescheduled: the customer asked to move it; a new appointment a few days later
  const child = bookAppointment(appt.lead, { endAt: appt.changedAt, agent: appt.bookedBy, n: 0 }, rng, busy, appt.startsAt, appt);
  if (!child) { appt.outcome = "cancelled"; return { retryFrom: appt.startsAt + DAY }; }
  if (cb) { cb.history.push({ action: "rescheduled", at: appt.changedAt, actor: cb.assignee, via: "manual", oldAt: cb.scheduledAt, newAt: child.startsAt, oldStatus: "scheduled", newStatus: "scheduled" }); cb.scheduledAt = child.startsAt; child.callback = cb; }
  return resolveAppointment(child, rng, busy);
}

/** One application per lead: opened on the first "interested" call, submitted on the call that finished it. */
let APPS = [];
await section("simulate dial history", async () => {
  simulate();
  const byLead = new Map();
  for (const app of SIM.apps) {
    const entry = byLead.get(app.lead.id);
    if (!entry) byLead.set(app.lead.id, { lead: app.lead, first: app, last: app, status: app.status, agent: app.agent, at: app.at });
    else { entry.last = app; entry.at = app.at; if (app.status === "submitted") entry.status = "submitted"; }
  }
  APPS = [...byLead.values()];
  const inWindow = SIM.attempts.filter((a) => a.at >= T0 - 14 * DAY);
  const contacts = inWindow.filter((a) => CONTACT_OUTCOMES.has(a.outcome));
  const byDisp = {};
  for (const a of inWindow) byDisp[a.disposition] = (byDisp[a.disposition] ?? 0) + 1;
  const bySlot = {};
  for (const a of inWindow) bySlot[a.slot] = (bySlot[a.slot] ?? 0) + 1;
  const byN = {};
  for (const a of inWindow) byN[a.n] = (byN[a.n] ?? 0) + 1;
  const states = SIM.leads.reduce((acc, l) => ({ ...acc, [l.sim.state]: (acc[l.sim.state] ?? 0) + 1 }), {});
  note(`attempts: ${SIM.attempts.length} total, ${inWindow.length} in the last 14 days; contact rate ${(100 * contacts.length / Math.max(1, inWindow.length)).toFixed(1)}%; zero-click ${inWindow.filter((a) => a.zeroClick).length}, fast ${inWindow.filter((a) => a.fast).length}, served-never-dispositioned ${SIM.cards.length}`);
  note(`14-day dispositions: ${Object.entries(byDisp).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / inWindow.length).toFixed(1)}%`).join(", ")}`);
  note(`14-day slots: ${Object.entries(bySlot).map(([k, v]) => `${k} ${v}`).join(", ")} · attempt numbers: ${Object.entries(byN).map(([k, v]) => `#${k} ${v}`).join(", ")}`);
  note(`lead states: ${Object.entries(states).map(([k, v]) => `${v} ${k}`).join(", ")} · callbacks ${SIM.callbacks.length} · appointments ${SIM.appointments.length} (${SIM.appointments.filter((a) => a.startsAt >= T0).length} upcoming) · applications ${APPS.length} (${APPS.filter((a) => a.status === "partial").length} still in progress) · do-not-call ${SIM.dnc.length}`);
  const setter = (who) => { const own = SIM.appointments.filter((a) => a.bookedBy === who && a.outcome); const showed = own.filter((a) => a.outcome === "showed").length, noShow = own.filter((a) => a.outcome === "no_show").length; return `${who} ${own.length} past, show rate ${showed + noShow ? Math.round((100 * showed) / (showed + noShow)) : "-"}%`; };
  note(`appointments: ${setter("jordan")}; ${setter("aaliyah")} · exhausted ${SIM.leads.filter((l) => l.sim.state === "exhausted").length}`);
}, { critical: true });

if (DRY) {
  printSummary();
  console.log("\nDRY RUN finished: the history, applications, callbacks, appointments, claims, nurture batch and plan limits above are what the real run would write.");
  process.exit(0);
}

// =============================================================================
// Writing the history (service role: nothing else can create the past)
// =============================================================================
const WRITTEN = new Set(); // leads whose attempts were first inserted by THIS run
await section("D4 backdate the imports", async () => {
  for (const file of FILES) {
    const result = FILE_RESULT.get(file.key);
    if (!result?.batchId) continue;
    const batch = must(await db.from("agent_lead_import_batches").select("created_at").eq("id", result.batchId).single(), "read batch");
    if (Math.abs(Date.parse(batch.created_at) - file.at) < 1000) { bump("agent_lead_import_batches (backdate)", "kept"); continue; }
    const at = iso(file.at), doneAt = iso(file.at + 95_000);
    must(await db.from("agent_lead_import_batches").update({ created_at: at, completed_at: doneAt }).eq("id", result.batchId).eq("tenant_id", TENANT_ID), "backdate batch");
    const leadIds = [...LEAD.values()].filter((l) => l.row?.file === file.key).map((l) => l.id);
    for (const part of chunk(leadIds, 150)) {
      must(await db.from("agent_leads").update({ created_at: doneAt }).eq("tenant_id", TENANT_ID).in("id", part), "backdate leads");
      must(await db.from("lead_queue").update({ created_at: doneAt, queued_at: doneAt }).eq("tenant_id", TENANT_ID).in("lead_id", part).is("nurtured_from_work_item_id", null), "backdate queue");
    }
    const phones = file.data.map((r) => r.phone);
    for (const part of chunk(phones, 150)) {
      const dated = await db.from("tenant_campaign_scrub_rejections").update({ rejected_at: doneAt }).eq("tenant_id", TENANT_ID).eq("campaign_id", CAMPAIGN_ID[file.campaign]).in("phone_digits", part);
      if (dated.error) { note(`scrub ledger rows keep their real time (${dated.error.message})`); break; }
    }
    const allLeadIds = [...new Set([...leadIds, ...file.data.filter((r) => r.kind === "dup_existing").map((r) => LEAD.get(r.phone)?.id).filter(Boolean)])];
    for (const part of chunk(allLeadIds, 150)) must(await db.from("tenant_lead_sources").update({ created_at: doneAt }).eq("tenant_id", TENANT_ID).eq("campaign_id", CAMPAIGN_ID[file.campaign]).in("lead_id", part), "backdate sources");
    for (const lead of LEAD.values()) if (lead.row?.file === file.key) lead.createdAt = doneAt;
    bump("agent_lead_import_batches (backdate)", "updated");
  }
  // Each campaign dates from its first file, as though it was set up the day the list arrived.
  for (const key of ["oakridge", "bayviewA", "crest", "bayviewB", "premium"]) {
    const firstAt = Math.min(...FILES.filter((f) => f.campaign === key).map((f) => f.at)) - 2 * HOUR;
    must(await db.from("tenant_campaigns").update({ created_at: iso(firstAt) }).eq("id", CAMPAIGN_ID[key]).eq("tenant_id", TENANT_ID), "backdate campaign");
  }
  must(await db.from("tenant_campaigns").update({ created_at: "2026-09-10T15:00:00Z" }).eq("id", CAMPAIGN_ID.summit), "backdate summit");
});

await section("D12 backdate the posts", async () => {
  await mapLimit(POSTS, 6, async (post) => {
    const result = POST_RESULT.get(post.key);
    if (!result) return;
    const log = must(await db.from("tenant_lead_post_log").select("id, received_at").eq("tenant_id", TENANT_ID).eq("idempotency_key", post.key).maybeSingle(), "read log");
    if (!log || Math.abs(Date.parse(log.received_at) - post.at) < 1000) { bump("tenant_lead_post_log (backdate)", "kept"); return; }
    must(await db.from("tenant_lead_post_log").update({ received_at: iso(post.at), completed_at: iso(post.at + 180 + (post.n % 7) * 40) }).eq("id", log.id), "backdate log");
    if (result.lead_id && post.kind === "accepted") {
      must(await db.from("agent_leads").update({ created_at: iso(post.at + 200), posted_at: iso(post.at + 200) }).eq("id", result.lead_id).eq("tenant_id", TENANT_ID), "backdate posted lead");
      must(await db.from("lead_queue").update({ created_at: iso(post.at + 250), queued_at: iso(post.at + 250) }).eq("lead_id", result.lead_id).eq("tenant_id", TENANT_ID), "backdate posted queue");
      must(await db.from("tenant_consent_artefacts").update({ captured_at: iso(post.at + 300) }).eq("lead_id", result.lead_id).eq("tenant_id", TENANT_ID), "backdate consent");
      // The arrival alert went to every owner, producer and assistant; worked long ago, so read.
      must(await db.from("agent_notifications").update({ created_at: iso(post.at + 400), read_at: iso(post.at + 400 + 90_000) }).eq("tenant_id", TENANT_ID).eq("source_key", `lead-post:${result.lead_id}`), "backdate alert");
      const lead = LEAD.get(post.phone);
      if (lead) { lead.createdAt = iso(post.at + 200); lead.postedAt = iso(post.at + 200); }
    }
    bump("tenant_lead_post_log (backdate)", "updated");
  });
});

await section("D5 attempts", async () => {
  const script = (lead) => lead.campaign === "premium" ? SCRIPT.premium : lead.campaign === "summit" ? SCRIPT.summit : SCRIPT.default;
  const rows = SIM.attempts.filter((a) => a.lead.workItemId).sort((a, b) => a.at - b.at).map((a) => ({
    id: a.id, tenant_id: TENANT_ID, lead_id: a.lead.id, work_item_id: a.lead.workItemId, attempt_number: a.n, slot: a.slot,
    attempted_at: iso(a.at - 1500), disposition: a.disposition, agent_id: idOf(a.agent), provider_call_id: null,
    dial_clicked_at: a.clickAt ? iso(a.clickAt) : null, script_id: script(a.lead)?.id ?? null, script_version: script(a.lead)?.version ?? null,
    disclosure_state: a.lead.state, disclosure_product_code: PRODUCT, disclosure_confirmed_at: iso(a.at - 1000),
  }));
  let inserted = 0;
  for (const part of chunk(rows, 400)) {
    const data = must(await db.from("tenant_call_attempts").upsert(part, { onConflict: "id", ignoreDuplicates: true }).select("id, lead_id"), "insert attempts");
    inserted += data.length;
    for (const row of data) WRITTEN.add(row.lead_id);
  }
  bump("tenant_call_attempts", "inserted", inserted);
  bump("tenant_call_attempts", "kept", rows.length - inserted);
}, { critical: true });

// D9 · applications, through the producer's own verification panel. The final attempt's card is the
// one the product writes when the work item is claimed (lead_queue_record_served_activity).
const APP_CARD = new Map();
await section("D9 applications (claim → POST/PATCH /api/app/outbound/application)", async () => {
  const cases = await inChunks(APPS.map((a) => a.lead.id), 150, (part) => db.from("tenant_application_cases").select("id, lead_id").eq("tenant_id", TENANT_ID).in("lead_id", part));
  const have = new Set(cases.map((c) => c.lead_id));
  const todo = APPS.filter((app) => !have.has(app.lead.id) && app.lead.workItemId);
  bump("tenant_application_cases", "kept", APPS.length - todo.length);
  const results = await mapLimit(todo, 1, async (app) => {
    const { lead, agent } = app;
    const attempt = app.first.attempt;
    must(await db.from("lead_queue").update({ status: "claimed", claimed_by: idOf(agent), owner_user_id: idOf(agent), claimed_at: iso(attempt.servedAt), locked_until: null, disposition: null }).eq("id", lead.workItemId).eq("tenant_id", TENANT_ID), "claim for application");
    const started = await api("POST", "/api/app/outbound/application", agent, { work_item_id: lead.workItemId, product_line: PRODUCT });
    if (started.status >= 300) { note(`start application for ${lead.id}: HTTP ${started.status} ${started.text.slice(0, 200)}`); bump("tenant_application_cases", "failed"); return null; }
    const panel = started.json.panel;
    const fields = (panel?.sections ?? []).flatMap((s) => s.fields).filter((f) => f.is_visible);
    const values = panel?.lead?.values ?? {};
    const rng = rngFor(`app:${lead.id}`);
    const want = app.status === "submitted" ? fields : fields.filter((f) => ["first_name", "last_name", "phone"].includes(f.field_key));
    for (const field of want) {
      const present = values[field.field_key] !== undefined && values[field.field_key] !== null && values[field.field_key] !== "";
      if (!present && !field.is_required) continue;
      const fill = field.field_key === "tobacco" ? false : field.field_key === "date_of_birth" ? `19${rng.int(52, 90)}-0${rng.int(1, 9)}-1${rng.int(0, 9)}` : field.field_key === "coverage_amount" ? 25000000 : field.field_key === "email" ? `${String(values.first_name ?? "client").toLowerCase()}.${rng.int(10, 99)}@example.net` : null;
      const body = present ? { work_item_id: lead.workItemId, field_key: field.field_key, state: "confirmed" } : fill !== null ? { work_item_id: lead.workItemId, field_key: field.field_key, state: "corrected", value: fill } : null;
      if (!body) continue;
      const saved = await api("PATCH", "/api/app/outbound/application", agent, body);
      if (saved.status >= 300) note(`verification ${field.field_key} on ${lead.id}: HTTP ${saved.status} ${saved.text.slice(0, 120)}`);
    }
    const card = must(await db.from("tenant_lead_activity").select("id").eq("tenant_id", TENANT_ID).eq("work_item_id", lead.workItemId).eq("agent_user_id", idOf(agent)).eq("served_at", iso(attempt.servedAt)).maybeSingle(), "read application card");
    if (card) APP_CARD.set(attempt.id, card.id);
    bump("tenant_application_cases", "inserted");
    return { app, caseId: started.json.applicationCaseId, dealId: started.json.dealId };
  });
  // Cases, sessions and deals are dated the day of the call.
  for (const r of results.filter(Boolean)) {
    const at = iso(r.app.first.attempt.servedAt + 60_000);
    must(await db.from("tenant_application_cases").update({ opened_at: at, ...(r.app.status === "submitted" ? { updated_at: iso(r.app.last.attempt.endAt) } : {}) }).eq("id", r.caseId).eq("tenant_id", TENANT_ID), "date case");
    if (r.dealId) must(await db.from("deal_flow").update({ created_at: at }).eq("id", r.dealId).eq("tenant_id", TENANT_ID), "date deal");
  }
});

await section("D5 served cards", async () => {
  const cards = [];
  for (const a of SIM.attempts) {
    if (!a.lead.workItemId) continue;
    if (APP_CARD.has(a.id)) {
      if (WRITTEN.has(a.lead.id)) { must(await db.from("tenant_lead_activity").update({ call_attempt_id: a.id, clicked_at: a.clickAt ? iso(a.clickAt) : null, dispositioned_at: iso(a.endAt), disposition: a.disposition, card_open_seconds: Math.round((a.endAt - a.servedAt) / 1000), notes: a.note ?? null }).eq("id", APP_CARD.get(a.id)), "complete application card"); bump("tenant_lead_activity (product card completed)", "updated"); }
      continue;
    }
    // Its card is the product's (above); only when that one was not found does it get its own.
    if (APPS.some((app) => app.first.attempt === a) && !WRITTEN.has(a.lead.id)) continue;
    cards.push({ id: a.cardId, tenant_id: TENANT_ID, work_item_id: a.lead.workItemId, lead_id: a.lead.id, campaign_id: CAMPAIGN_ID[a.lead.campaign], agent_user_id: idOf(a.agent), served_at: iso(a.servedAt), clicked_at: a.clickAt ? iso(a.clickAt) : null, dispositioned_at: iso(a.endAt), disposition: a.disposition, card_open_seconds: Math.round((a.endAt - a.servedAt) / 1000), notes: a.note ?? null, call_attempt_id: a.id, created_at: iso(a.servedAt), updated_at: iso(a.endAt) });
  }
  for (const c of SIM.cards) if (c.lead.workItemId) cards.push({ id: c.id, tenant_id: TENANT_ID, work_item_id: c.lead.workItemId, lead_id: c.lead.id, campaign_id: CAMPAIGN_ID[c.lead.campaign], agent_user_id: idOf(c.agent), served_at: iso(c.servedAt), clicked_at: null, dispositioned_at: null, disposition: null, card_open_seconds: null, notes: null, call_attempt_id: null, created_at: iso(c.servedAt), updated_at: iso(c.servedAt) });
  await insertIgnore("tenant_lead_activity", cards);
});

await section("D17 scoring decisions (history)", async () => {
  const reasons = {
    realtime: (l) => `Called first because it is a real-time lead that arrived moments ago from ${VENDORS.summit.name.replace("Demo · ", "")}.`,
    scored: (l, a) => `Called first because ${a.slot.replace("_", " ")} is a good time to reach ${l.state}, ${a.n === 1 ? "it has never been dialled" : `this slot has not been tried on attempt ${a.n}`}, and the vendor's contact rate is above average.`,
    control: () => "Holdout: served in queue order so the scored and control contact rates can be compared.",
    off: () => "Scoring was off: served in queue order.",
  };
  const rows = [];
  for (const a of SIM.attempts) {
    if (!a.lead.workItemId) continue;
    const scoringOn = a.servedAt >= SCORING_ON_FROM;
    const control = !scoringOn || a.lead.bucket < 10;
    const cohort = scoringOn ? (control ? "control" : "scored") : "control";
    const rng = rngFor(`score:${a.id}`);
    rows.push({ id: a.decisionId, tenant_id: TENANT_ID, lead_id: a.lead.id, work_item_id: a.lead.workItemId, agent_user_id: idOf(a.agent), cohort, score: cohort === "scored" ? rng.int(3200, 9600) / 100 : null, signal_snapshot: cohort === "scored" ? { recency: rng.int(20, 100), attempt_position: Math.max(0, 100 - a.n * 12), slot_freshness: rng.int(40, 100), vendor_contact_rate: rng.int(30, 90), time_of_day_fit: rng.int(30, 100), completeness: rng.int(60, 100), consent_artefact: rng.chance(0.65) ? 100 : 0 } : {}, selection_reason: a.lead.campaign === "summit" && a.n === 1 ? reasons.realtime(a.lead) : cohort === "scored" ? reasons.scored(a.lead, a) : scoringOn ? reasons.control() : reasons.off(), served_at: iso(a.servedAt), contacted_at: CONTACT_OUTCOMES.has(a.outcome) ? iso(a.endAt) : null, disposition: a.disposition });
  }
  await insertIgnore("tenant_scoring_decisions", rows);
});

await section("D4 consent certificates on imported leads", async () => {
  // The CSV import has no certificate capture (only the post path does), so the files' cert column is
  // carried here as the pending, unclaimed artefact the post path would have written.
  const rows = [];
  for (const lead of LEAD.values()) {
    if (!lead.row?.cert || !lead.createdAt) continue;
    const r = lead.row;
    rows.push({ id: uid("consent", lead.id), tenant_id: TENANT_ID, lead_id: lead.id, provider: "trustedform", certificate_url: certUrl(r.phone), certificate_id: null, consent_timestamp: iso(Date.parse(lead.createdAt) - r.optInDays * DAY), ip: `203.0.113.${(seedOf(r.phone) % 250) + 2}`, source_url: r.campaign === "oakridge" ? "https://respond.oakridge-mail.example/card" : "https://get.quotes-compare.example/term-life", landing_page: "/term-life/quote", capture_status: r.optInDays > 90 ? "expired" : "pending", captured_at: lead.createdAt });
  }
  await insertIgnore("tenant_consent_artefacts", rows);
});

// Where each disposition sends a lead (stage_dispositions, one stage per outcome, as the RPC does).
const STAGE_FOR = new Map();
{
  const mapped = must(await db.from("stage_dispositions").select("disposition_key, stage_id").eq("tenant_id", TENANT_ID), "read stage map");
  const stages = mapped.length ? must(await db.from("tenant_pipeline_stages").select("id, pipeline_id, is_archived").in("id", mapped.map((m) => m.stage_id)), "read stages") : [];
  for (const m of mapped) { const s = stages.find((x) => x.id === m.stage_id && !x.is_archived); if (s) STAGE_FOR.set(m.disposition_key, s); }
}

await section("D5 lead + work-item state (what the dispositions imply)", async () => {
  const leads = [...LEAD.values()];
  await mapLimit(leads, 12, async (lead) => {
    const needsTag = lead.values?.qa_seed !== TAG;
    const sim = lead.sim;
    // Written by this run, or behind the history (a run that stopped between the attempts and here).
    const written = WRITTEN.has(lead.id) || (sim?.attempts.length && (lead.attemptsMade ?? 0) < sim.attempts.length);
    if (!needsTag && !written) { bump("agent_leads", "kept"); return; }
    const update = {};
    if (needsTag) update.values = { ...(lead.values ?? {}), qa_seed: TAG };
    if (written && sim?.attempts.length) {
      const last = sim.last ?? sim.attempts.at(-1);
      // The application panel may have corrected values since they were read.
      if (needsTag && APPS.some((app) => app.lead === lead)) update.values = { ...must(await db.from("agent_leads").select("values").eq("id", lead.id).single(), "re-read values").values, qa_seed: TAG };
      update.attempts_made = sim.attempts.length;
      update.lead_state = sim.state;
      update.next_dial_after = sim.nextDue ? iso(sim.nextDue) : null;
      update.next_preferred_slot = sim.nextSlot;
      update.first_dial_at = iso(Math.min(...sim.attempts.map((a) => a.servedAt), ...SIM.cards.filter((c) => c.lead === lead).map((c) => c.servedAt)));
      const stage = ["closed", "exhausted", "working"].includes(sim.state) ? STAGE_FOR.get(last.disposition) : null;
      if (stage) { update.stage_id = stage.id; update.pipeline_id = stage.pipeline_id; }
      must(await db.from("agent_leads").update(update).eq("id", lead.id).eq("tenant_id", TENANT_ID), "update lead");
      if (sim.state === "exhausted") must(await db.from("agent_leads").update({ nurture_entered_at: iso(last.endAt) }).eq("id", lead.id).eq("tenant_id", TENANT_ID), "date nurture entry");
      const terminal = ["closed", "exhausted", "working"].includes(sim.state);
      must(await db.from("lead_queue").update({ status: terminal ? "completed" : "unclaimed", claimed_by: null, owner_user_id: null, locked_until: null, claimed_at: null, disposition: last.disposition, disposition_at: iso(last.endAt), disposition_by: idOf(last.agent), ...(stage ? { stage_id: stage.id, pipeline_id: stage.pipeline_id } : {}) }).eq("id", lead.workItemId).eq("tenant_id", TENANT_ID), "update work item");
      bump("agent_leads", "updated"); bump("lead_queue", "updated");
    } else {
      must(await db.from("agent_leads").update(update).eq("id", lead.id).eq("tenant_id", TENANT_ID), "tag lead");
      bump("agent_leads", "updated");
    }
  });
}, { critical: true });

await section("D10 deal flow + issued policies", async () => {
  const deals = await inChunks(APPS.map((a) => a.lead.id), 150, (part) => db.from("deal_flow").select("id, lead_id, status, carrier, local_date").eq("tenant_id", TENANT_ID).in("lead_id", part));
  const dealByLead = new Map(deals.map((d) => [d.lead_id, d]));
  const CARRIERS = ["Americo", "Foresters", "National Life Group", "Transamerica", "American National", "Mutual of Omaha"];
  for (const app of APPS) {
    const deal = dealByLead.get(app.lead.id);
    if (!deal) continue;
    const rng = rngFor(`deal:${app.lead.id}`);
    app.deal = deal;
    app.carrier = rng.pick(CARRIERS);
    const localDate = local(app.at, STATE_TZ[app.lead.state]).date;
    if (deal.local_date === localDate && (app.status !== "submitted" || deal.carrier)) { bump("deal_flow", "kept"); continue; }
    const body = app.status === "submitted"
      ? { local_date: localDate, carrier: app.carrier, product_type: rng.pick(["Term 10", "Term 20", "Term 30", "Final expense"]), monthly_premium_cents: rng.int(2800, 14500), face_amount_cents: rng.pick([5000000, 10000000, 25000000, 50000000]), draft_date: iso(app.at + rng.int(5, 20) * DAY).slice(0, 10), status: "completed", call_result: "Application submitted" }
      : { local_date: localDate, status: "partial", call_result: "Application in progress", notes: "Resumes on the scheduled call-back." };
    ok(await api("PATCH", `/api/app/deal-flow/${deal.id}`, "owner", body), `deal ${deal.id}`);
    bump("deal_flow", "updated");
  }
  // 40 issued, never from the aged vendor (its scorecard shows a dash for cost per issued policy).
  const issued = must(await db.from("tenant_issued_policies").select("policy_number").eq("tenant_id", TENANT_ID).like("policy_number", "QA-D2-%"), "read issued");
  const have = new Set(issued.map((p) => p.policy_number));
  const eligible = APPS.filter((a) => a.status === "submitted" && a.deal && a.lead.campaign !== "oakridge" && a.at < T0 - 6 * DAY).sort((a, b) => a.at - b.at).slice(0, 40);
  if (eligible.length < 40) note(`only ${eligible.length} submitted applications are old enough to have issued`);
  let n = 0;
  for (const app of eligible) {
    n += 1;
    const number = `QA-D2-${String(n).padStart(4, "0")}`;
    if (have.has(number)) { bump("tenant_issued_policies", "kept"); continue; }
    const issuedOn = iso(Math.min(app.at + (5 + (n % 8)) * DAY, T0 - DAY)).slice(0, 10);
    ok(await api("POST", "/api/app/policies/issued", "owner", { deal_id: app.deal.id, carrier: app.carrier, policy_number: number, issued_on: issuedOn }), `issue ${number}`);
    bump("tenant_issued_policies", "inserted");
  }
});

await section("D14 do-not-call dispositions → suppress_phone", async () => {
  const have = new Set(must(await db.from("tenant_do_not_call").select("phone_digits").eq("tenant_id", TENANT_ID).in("phone_digits", SIM.dnc.map((d) => d.lead.values?.phone ?? "")), "read dnc").map((r) => r.phone_digits));
  for (const { lead, attempt } of SIM.dnc) {
    const phone = String(lead.values?.phone ?? "");
    if (have.has(phone)) { bump("tenant_do_not_call", "kept"); continue; }
    must(await db.rpc("suppress_phone", { p_tenant_id: TENANT_ID, p_phone: phone, p_list_type: "internal", p_reason: "Agent recorded do not call on the dialer", p_source: "disposition", p_added_by: idOf(attempt.agent) }), "suppress");
    must(await db.from("tenant_do_not_call").update({ created_at: iso(attempt.endAt), lead_id: lead.id }).eq("tenant_id", TENANT_ID).eq("phone_digits", phone), "date suppression");
    bump("tenant_do_not_call", "inserted");
  }
});

// =============================================================================
// D7 · calendars · D8 · appointments · D6 · callbacks
// =============================================================================
await section("D7 availability", async () => {
  const current = ok(await api("GET", "/api/app/availability", "owner"), "read calendars");
  const members = current.members ?? [];
  const specs = [
    { key: "marisol", timezone: "America/Chicago", hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" })), blocks: [{ startsAt: "2026-09-21T17:00:00.000Z", endsAt: "2026-09-21T18:00:00.000Z", reason: "Lunch", repeats: "weekdays" }, { startsAt: "2026-09-23T20:00:00.000Z", endsAt: "2026-09-23T21:00:00.000Z", reason: WEEKLY_BLOCK.marisol.reason, repeats: "weekly" }], policy: { appointmentMinutes: 30, bufferMinutes: 10, maxPerDay: 6, allowSameDay: true } },
    { key: "devin", timezone: "America/Chicago", hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" })), blocks: [{ startsAt: "2026-09-21T17:00:00.000Z", endsAt: "2026-09-21T18:00:00.000Z", reason: "Lunch", repeats: "weekdays" }, { startsAt: "2026-09-25T19:00:00.000Z", endsAt: "2026-09-25T20:00:00.000Z", reason: WEEKLY_BLOCK.devin.reason, repeats: "weekly" }], policy: { appointmentMinutes: 30, bufferMinutes: 10, maxPerDay: 6, allowSameDay: true } },
    // The Manila setter works the US day overnight: 21:00–06:00 Asia/Manila is 08:00–17:00 Central.
    { key: "jordan", timezone: "Asia/Manila", hours: [...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: "21:00", endTime: "23:59" })), ...[2, 3, 4, 5, 6].map((weekday) => ({ weekday, startTime: "00:00", endTime: "06:00" }))], blocks: [], policy: { appointmentMinutes: 30, bufferMinutes: 0, maxPerDay: 8, allowSameDay: true } },
    { key: "aaliyah", timezone: "America/New_York", hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startTime: "09:00", endTime: "17:00" })), blocks: [], policy: { appointmentMinutes: 30, bufferMinutes: 0, maxPerDay: 8, allowSameDay: true } },
  ];
  for (const spec of specs) {
    const member = members.find((m) => (m.userId ?? m.user_id) === idOf(spec.key));
    const hours = member?.hours ?? [];
    const tz = member?.timezone ?? hours[0]?.timezone ?? null;
    const same = tz === spec.timezone && hours.length === spec.hours.length && (member?.blocks?.length ?? 0) === spec.blocks.length;
    if (same) { bump("tenant_agent_availability", "kept", spec.hours.length); continue; }
    ok(await api("PUT", "/api/app/availability", "owner", { user_id: idOf(spec.key), timezone: spec.timezone, hours: spec.hours, blocks: spec.blocks, policy: spec.policy }), `save calendar ${spec.key}`);
    bump("tenant_agent_availability", "inserted", spec.hours.length); bump("tenant_agent_blocks", "inserted", spec.blocks.length); bump("tenant_agent_booking_policy", "inserted");
  }
});

const APPT_ID = new Map(); // sim appointment → real id
await section("D8 appointments", async () => {
  const existing = must(await db.from("tenant_appointments").select("id, lead_id, starts_at_utc, status, agent_user_id").eq("tenant_id", TENANT_ID).in("lead_id", [...new Set(SIM.appointments.map((a) => a.lead.id))]), "read appointments");
  const findReal = (appt) => existing.find((row) => row.lead_id === appt.lead.id && Math.abs(Date.parse(row.starts_at_utc) - appt.startsAt) < 60_000);
  const ordered = [...SIM.appointments].sort((a, b) => a.createdAt - b.createdAt);
  for (const appt of ordered) {
    const found = findReal(appt);
    if (found) { APPT_ID.set(appt, found.id); bump("tenant_appointments", "kept"); continue; }
    if (appt.parent && APPT_ID.has(appt.parent) && appt.startsAt >= NOW + HOUR) {
      // The customer moved a booked appointment into the future: reschedule_appointment.
      const moved = await db.rpc("reschedule_appointment", { p_tenant_id: TENANT_ID, p_appointment_id: APPT_ID.get(appt.parent), p_actor: idOf(appt.bookedBy), p_starts_at_utc: iso(appt.startsAt) });
      if (!moved.error) {
        const row = Array.isArray(moved.data) ? moved.data[0] : moved.data;
        const id = row?.appointment_id ?? row?.id ?? null;
        APPT_ID.set(appt, id);
        if (id) must(await db.from("tenant_appointments").update({ created_at: iso(appt.createdAt) }).eq("id", id).eq("tenant_id", TENANT_ID), "date reschedule");
        bump("tenant_appointments", "inserted"); continue;
      }
      note(`reschedule ${APPT_ID.get(appt.parent)}: ${moved.error.message}; recorded as rescheduled and re-booked instead`);
      await db.rpc("mark_appointment_outcome", { p_tenant_id: TENANT_ID, p_appointment_id: APPT_ID.get(appt.parent), p_actor: idOf(appt.agent), p_outcome: "rescheduled" });
    }
    if (appt.startsAt >= NOW + HOUR) {
      const booked = await api("POST", "/api/app/appointments", appt.bookedBy, { lead_id: appt.lead.id, agent_user_id: idOf(appt.agent), starts_at_utc: iso(appt.startsAt), notes: appt.notes });
      if (booked.status >= 300) { note(`book ${appt.lead.id} at ${iso(appt.startsAt)}: HTTP ${booked.status} ${booked.text.slice(0, 160)}`); continue; }
      const id = booked.json?.appointment?.appointmentId ?? booked.json?.appointment?.appointment_id ?? booked.json?.appointment?.id;
      APPT_ID.set(appt, id);
      if (id) must(await db.from("tenant_appointments").update({ created_at: iso(appt.createdAt) }).eq("id", id).eq("tenant_id", TENANT_ID), "date booking");
      bump("tenant_appointments", "inserted"); continue;
    }
    if (appt.startsAt < NOW + HOUR && appt.startsAt >= T0) { note(`appointment ${appt.id} starts before the run; skipped`); continue; }
    // In the past: book_appointment refuses the past, so the row is written as it was booked…
    const row = { id: appt.id, tenant_id: TENANT_ID, lead_id: appt.lead.id, agent_user_id: idOf(appt.agent), booked_by: idOf(appt.bookedBy), starts_at_utc: iso(appt.startsAt), duration_minutes: 30, buffer_minutes: 10, customer_timezone: appt.customerTz, status: "booked", notes: appt.notes, created_at: iso(appt.createdAt), seat: 1, rebooked_from: appt.parent ? APPT_ID.get(appt.parent) ?? null : null };
    const inserted = must(await db.from("tenant_appointments").upsert(row, { onConflict: "id", ignoreDuplicates: true }).select("id"), "insert appointment");
    APPT_ID.set(appt, appt.id);
    bump("tenant_appointments", inserted.length ? "inserted" : "kept");
    if (!inserted.length) continue;
    // …and its outcome is recorded the way the producer records it.
    const outcome = appt.outcome === "rescheduled" && appt.children[0]?.startsAt >= NOW + HOUR ? null : appt.outcome;
    if (outcome) must(await db.rpc("mark_appointment_outcome", { p_tenant_id: TENANT_ID, p_appointment_id: appt.id, p_actor: idOf(appt.agent), p_outcome: outcome }), `outcome ${outcome}`);
  }
  // A few no-shows are rebooked into next week (rebook_appointment).
  for (const appt of SIM.appointments.filter((a) => a.rebook && a.outcome === "no_show").slice(0, 4)) {
    const id = APPT_ID.get(appt);
    if (!id) continue;
    const already = must(await db.from("tenant_appointments").select("id").eq("tenant_id", TENANT_ID).eq("rebooked_from", id), "read rebook");
    if (already.length) { bump("tenant_appointments", "kept"); continue; }
    const rng = rngFor(`rebook:${appt.id}`);
    let done = false;
    for (let d = 3; d <= 10 && !done; d += 1) for (const hh of [10, 11, 14, 15]) {
      const date = local(NOW + d * DAY, "America/Chicago").date;
      const start = atLocal(date, hh, rng.pick([0, 30]), "America/Chicago");
      const l = local(start, "America/Chicago");
      if (l.dow < 1 || l.dow > 5 || !legal(start, appt.lead)) continue;
      const r = await db.rpc("rebook_appointment", { p_tenant_id: TENANT_ID, p_appointment_id: id, p_actor: idOf(appt.bookedBy), p_starts_at_utc: iso(start) });
      if (!r.error) { done = true; bump("tenant_appointments", "inserted"); break; }
    }
  }
  const counts = must(await db.from("tenant_appointments").select("status").eq("tenant_id", TENANT_ID).in("lead_id", [...new Set(SIM.appointments.map((a) => a.lead.id))]), "count appointments").reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  note(`appointments by status: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}`);
});

await section("D6 callbacks", async () => {
  // Open call-backs are placed around the real clock: ~20 later today, ~12 already overdue.
  const open = SIM.callbacks.filter((cb) => cb.status === "scheduled" && cb.kind !== "appointment").sort((a, b) => seedOf(a.id) - seedOf(b.id));
  let today = 0, overdue = 0;
  for (const cb of open) {
    const tz = STATE_TZ[cb.lead.state];
    const rng = rngFor(`shape:${cb.id}`);
    const todayDate = local(NOW, tz).date;
    if (today < 20) {
      const end = (WINDOW_END[cb.lead.state] ?? 21 * 60) - 30;
      const startMins = Math.max(local(NOW, tz).mins + 45, 9 * 60);
      if (startMins < end) { const m = rng.int(startMins, end); const at = atLocal(todayDate, Math.floor(m / 60), m % 60, tz); if (at > cb.createdAt && legal(at, cb.lead)) { cb.scheduledAt = at; cb.history[0].newAt = at; today += 1; continue; } }
    }
    if (overdue < 12) {
      const at = atLocal(local(NOW - DAY, tz).date, rng.int(15, 18), rng.pick([0, 30]), tz);
      if (at > cb.createdAt + HOUR && legal(at, cb.lead)) { cb.scheduledAt = at; cb.history[0].newAt = at; overdue += 1; continue; }
    }
    if (cb.scheduledAt < NOW + HOUR) { const at = nextLegalLocal(cb.lead, NOW + DAY, [10, 11, 14, 16], rng); if (at) { cb.scheduledAt = at; cb.history[0].newAt = at; } }
  }
  note(`open call-backs shaped: ${today} later today, ${overdue} overdue from yesterday, ${open.length - today - overdue} on later days`);
  const ordered = [...SIM.callbacks].filter((cb) => cb.lead.workItemId).sort((a, b) => (a.status === "scheduled") - (b.status === "scheduled") || a.createdAt - b.createdAt);
  const rows = ordered.map((cb) => ({
    id: cb.id, tenant_id: TENANT_ID, lead_id: cb.lead.id, work_item_id: cb.lead.workItemId, scheduled_at_utc: iso(cb.scheduledAt), customer_timezone: STATE_TZ[cb.lead.state], assigned_to: idOf(cb.assignee), note: cb.note, status: cb.status,
    completed_at: cb.completedAt ? iso(cb.completedAt) : null, completed_via: cb.status === "completed" ? "call" : null, kept_attempt_id: cb.keptAttempt?.id ?? null, missed_at: cb.missedAt ? iso(cb.missedAt) : null,
    created_by: idOf(cb.createdBy), created_at: iso(cb.createdAt), updated_at: iso(cb.completedAt ?? cb.missedAt ?? cb.createdAt), idempotency_key: `qa-d2:dial:${cb.attempt.id}:callback`,
  }));
  const inserted = new Set();
  for (const row of rows) {
    const data = must(await db.from("tenant_callbacks").upsert(row, { onConflict: "id", ignoreDuplicates: true }).select("id"), "insert callback");
    if (data.length) inserted.add(row.id);
  }
  bump("tenant_callbacks", "inserted", inserted.size); bump("tenant_callbacks", "kept", rows.length - inserted.size);
  const history = [];
  for (const cb of ordered) {
    if (!inserted.has(cb.id)) continue;
    cb.history.forEach((h, i) => history.push({ id: uid("callback-history", `${cb.id}:${i}`), tenant_id: TENANT_ID, callback_id: cb.id, lead_id: cb.lead.id, actor_user_id: h.actor ? idOf(h.actor) : null, action: h.action, old_scheduled_at_utc: h.oldAt ? iso(h.oldAt) : null, new_scheduled_at_utc: h.newAt ? iso(h.newAt) : h.action === "scheduled" ? iso(cb.scheduledAt) : null, old_status: h.oldStatus ?? null, new_status: h.newStatus ?? null, note: h.action === "scheduled" ? cb.note : null, created_at: iso(h.at), via: h.via ?? "manual" }));
  }
  await insertIgnore("callback_history", history);
  // A few future ones are cancelled or moved the way an agent would: cancel_callback / reschedule_callback.
  const future = SIM.callbacks.filter((cb) => inserted.has(cb.id) && cb.status === "scheduled" && cb.kind === "plain" && cb.scheduledAt > NOW + 30 * HOUR).slice(0, 10);
  for (const [i, cb] of future.entries()) {
    if (i < 4) { must(await db.rpc("cancel_callback", { p_tenant_id: TENANT_ID, p_callback_id: cb.id, p_actor: idOf(cb.assignee) }), "cancel callback"); bump("tenant_callbacks (cancelled)", "updated"); continue; }
    const tz = STATE_TZ[cb.lead.state];
    const date = local(cb.scheduledAt + DAY, tz).date;
    const localText = `${date}T${rngFor(cb.id).pick(["10:30", "11:00", "14:00", "15:30"])}`;
    const moved = await db.rpc("reschedule_callback", { p_tenant_id: TENANT_ID, p_callback_id: cb.id, p_actor: idOf(cb.assignee), p_callback_local: localText });
    if (moved.error) note(`reschedule callback ${cb.id}: ${moved.error.message}`); else bump("tenant_callbacks (rescheduled)", "updated");
  }
});

// =============================================================================
// D13 · nurture: the recycling rule and one reactivation batch
// =============================================================================
await section("D13 nurture rule + reactivation batch", async () => {
  const campaignId = CAMPAIGN_ID.bayviewA;
  const batches = must(await db.from("tenant_recycle_batches").select("id, status, cleared, queued, created_at").eq("tenant_id", TENANT_ID).eq("campaign_id", campaignId), "read batches");
  if (batches.length) { bump("tenant_recycle_batches", "kept", batches.length); note(`recycle batch already there: ${batches.map((b) => `${b.status} ${b.cleared}/${b.queued}`).join(", ")}`); return; }
  // Eligible: exhausted on a no-answer or voicemail, rested long enough. Pick the rest period that
  // yields ~200 from what the history actually left behind.
  const exhausted = SIM.leads.filter((l) => l.campaign === "bayviewA" && l.sim?.state === "exhausted" && ["no_answer", "voicemail"].includes(l.sim.last?.disposition));
  let waitDays = 1;
  for (let w = 1; w <= 20; w += 1) { const n = exhausted.filter((l) => l.sim.last.at < NOW - w * DAY).length; if (n >= 200) waitDays = w; else break; }
  note(`nurture rule on Bayview A: wait ${waitDays} days → ${exhausted.filter((l) => l.sim.last.at < NOW - waitDays * DAY).length} eligible of ${exhausted.length} exhausted`);
  ok(await api("POST", "/api/app/nurture", "owner", { action: "save_rule", campaign_id: campaignId, wait_days: waitDays, allowed_dispositions: ["no_answer", "voicemail"], max_recycles: 2 }), "save nurture rule");
  const started = ok(await api("POST", "/api/app/nurture", "owner", { action: "start_batch", campaign_id: campaignId, angle: "Autumn rate lock: 20-year term quotes held until October 31", script: "Hi {{first_name}}, it's {{agent_name}} with {{agency_name}}. We tried you a few weeks ago about term life; carriers have a rate lock running through October 31 and I can hold a quote for you. Do you have two minutes?", attempt_ceiling: 3 }), "start batch");
  const batchId = started.batchId;
  note(`reactivation batch ${batchId}: ${started.queued} queued, ${started.excludedTooRecent} too recent, ${started.saidNo} said no`);
  for (let i = 0; i < 60; i += 1) {
    const step = ok(await api("POST", "/api/app/nurture", "owner", { action: "screen_chunk", batch_id: batchId }), "screen chunk");
    if (step.done || step.pending === 0) break;
  }
  bump("tenant_recycle_batches", "inserted");
});

await section("D13 date the batch and give it some dials", async () => {
  const batch = must(await db.from("tenant_recycle_batches").select("id, status, created_at, queued, cleared, blocked").eq("tenant_id", TENANT_ID).eq("campaign_id", CAMPAIGN_ID.bayviewA).order("created_at").limit(1).maybeSingle(), "read batch");
  if (!batch) return;
  const batchAt = Date.parse("2026-09-22T14:30:00Z");
  const fresh = Math.abs(Date.parse(batch.created_at) - batchAt) > 1000;
  const reactivations = must(await db.from("tenant_nurture_reactivations").select("id, lead_id, status").eq("tenant_id", TENANT_ID).eq("batch_id", batch.id), "read reactivations");
  const cleared = reactivations.filter((r) => r.status === "cleared");
  note(`recycle batch ${batch.status}: ${batch.cleared} cleared, ${batch.blocked} blocked of ${batch.queued}`);
  if (!fresh) { bump("tenant_recycle_batches (backdate)", "kept"); return; }
  must(await db.from("tenant_recycle_batches").update({ created_at: iso(batchAt), last_progress_at: iso(batchAt + 4 * MIN), completed_at: iso(batchAt + 4 * MIN) }).eq("id", batch.id), "date batch");
  for (const part of chunk(reactivations.map((r) => r.id), 150)) must(await db.from("tenant_nurture_reactivations").update({ reactivated_at: iso(batchAt), completed_at: iso(batchAt + 3 * MIN) }).in("id", part), "date reactivations");
  for (const part of chunk(cleared.map((r) => r.lead_id), 150)) {
    must(await db.from("agent_leads").update({ last_reactivated_at: iso(batchAt + 3 * MIN), nurture_entered_at: iso(batchAt + 3 * MIN), next_dial_after: iso(batchAt + 3 * MIN) }).eq("tenant_id", TENANT_ID).in("id", part), "date recycled leads");
    must(await db.from("tenant_lead_sources").update({ created_at: iso(batchAt + 3 * MIN) }).eq("tenant_id", TENANT_ID).eq("source_type", "recycle").in("lead_id", part), "date recycle sources");
  }
  // ~60 of the recycled leads have been dialled since, at the lowest tier.
  const items = await inChunks(cleared.map((r) => r.lead_id), 150, (part) => db.from("lead_queue").select("id, lead_id").eq("tenant_id", TENANT_ID).in("lead_id", part).not("nurtured_from_work_item_id", "is", null));
  const itemByLead = new Map(items.map((i) => [i.lead_id, i.id]));
  const byId = new Map([...LEAD.values()].map((l) => [l.id, l]));
  const recycled = cleared.map((r) => byId.get(r.lead_id)).filter((l) => l && itemByLead.has(l.id)).sort((a, b) => seedOf(`rc:${a.id}`) - seedOf(`rc:${b.id}`)).slice(0, 60);
  const attempts = [], cards = [], decisions = [];
  const leadUpdates = [];
  for (const lead of recycled) {
    const rng = rngFor(`recycle:${lead.id}`);
    const wi = itemByLead.get(lead.id);
    const tried = new Set();
    let due = batchAt + rng.int(1, 40) * HOUR, k = 0, state = "nurture", last = null, nextDue = null;
    const base = lead.sim?.attempts.length ?? 7;
    while (k < 3) {
      const pick = nextDialTime({ ...lead, campaign: "bayviewA" }, due, tried, rng);
      if (!pick || pick.at >= T0) { nextDue = due; break; }
      k += 1;
      const agent = rng.weighted(pick.agents.map((a) => [a, AGENT_WEIGHT[a]]));
      const outcome = rng.weighted([["no_answer", 62], ["voicemail", 20], ["not_interested", 9], ["wrong_number", 3], ["did_not_qualify", 2], [isSetter(agent) ? "not_interested" : "app", 1.5], ["callback", 2.5]]);
      const slot = slotOf(pick.at, lead.state);
      tried.add(slot);
      const a = makeAttempt(lead, base + k, pick.at, agent, outcome === "callback" ? "not_interested" : outcome === "app" ? "not_interested" : outcome, slot, rng);
      a.id = uid("attempt", `${lead.id}:recycle:${k}`); a.cardId = uid("card", `${lead.id}:recycle:${k}`); a.decisionId = uid("decision", `${lead.id}:recycle:${k}`);
      attempts.push({ id: a.id, tenant_id: TENANT_ID, lead_id: lead.id, work_item_id: wi, attempt_number: a.n, slot, attempted_at: iso(a.at - 1500), disposition: a.disposition, agent_id: idOf(agent), provider_call_id: null, dial_clicked_at: a.clickAt ? iso(a.clickAt) : null, script_id: SCRIPT.default?.id ?? null, script_version: SCRIPT.default?.version ?? null, disclosure_state: lead.state, disclosure_product_code: PRODUCT, disclosure_confirmed_at: iso(a.at - 1000) });
      cards.push({ id: a.cardId, tenant_id: TENANT_ID, work_item_id: wi, lead_id: lead.id, campaign_id: CAMPAIGN_ID.bayviewA, agent_user_id: idOf(agent), served_at: iso(a.servedAt), clicked_at: a.clickAt ? iso(a.clickAt) : null, dispositioned_at: iso(a.endAt), disposition: a.disposition, card_open_seconds: Math.round((a.endAt - a.servedAt) / 1000), notes: null, call_attempt_id: a.id, created_at: iso(a.servedAt), updated_at: iso(a.endAt) });
      const cohort = lead.bucket < 10 ? "control" : "scored";
      decisions.push({ id: a.decisionId, tenant_id: TENANT_ID, lead_id: lead.id, work_item_id: wi, agent_user_id: idOf(agent), cohort, score: cohort === "scored" ? rng.int(1500, 4200) / 100 : null, signal_snapshot: {}, selection_reason: "Recycled lead (nurture tier): served after every fresher lead in the queue.", served_at: iso(a.servedAt), contacted_at: CONTACT_OUTCOMES.has(a.outcome) ? iso(a.endAt) : null, disposition: a.disposition });
      last = a;
      if (!RETRY_OUTCOMES.has(a.outcome)) { state = "closed"; nextDue = null; break; }
      state = k >= 3 ? "exhausted" : "retry";
      due = a.at + DEFAULT_DELAYS[k - 1];
      nextDue = state === "retry" ? due : null;
    }
    if (last) leadUpdates.push({ lead, wi, k, state, last, nextDue });
  }
  await insertIgnore("tenant_call_attempts", attempts);
  await insertIgnore("tenant_lead_activity", cards);
  await insertIgnore("tenant_scoring_decisions", decisions);
  for (const u of leadUpdates) {
    must(await db.from("agent_leads").update({ attempts_made: u.k, lead_state: u.state, next_dial_after: u.nextDue ? iso(u.nextDue) : null, next_preferred_slot: null }).eq("id", u.lead.id).eq("tenant_id", TENANT_ID), "recycled lead state");
    must(await db.from("lead_queue").update({ status: u.state === "retry" ? "unclaimed" : "completed", disposition: u.last.disposition, disposition_at: iso(u.last.endAt), disposition_by: idOf(u.last.agent) }).eq("id", u.wi).eq("tenant_id", TENANT_ID), "recycled work item");
    if (u.state === "exhausted") must(await db.from("agent_leads").update({ nurture_entered_at: iso(u.last.endAt) }).eq("id", u.lead.id), "recycled nurture date");
  }
  note(`recycled leads dialled since the batch: ${leadUpdates.length} (${attempts.length} attempts)`);
});

// =============================================================================
// D11 · vendor returns: one claim in each status
// =============================================================================
await section("D11 vendor claims", async () => {
  const PLAN_CLAIMS = [
    { campaign: "oakridge", reasons: ["tcpa_litigator", "dnc"], end: "accepted", note: "qa-d2:claim:1 Scrub failures credited in full." },
    { campaign: "crest", reasons: null, end: "partial", pct: 0.6, note: "qa-d2:claim:2 Vendor credited 60%: disputes wrong-party records older than 21 days." },
    { campaign: "bayviewB", reasons: ["wrong_number", "disconnected"], end: "submitted", note: null },
    { campaign: "bayviewB", reasons: ["dnc", "tcpa_litigator", "invalid_phone", "duplicate_in_file"], end: "accepted", note: "qa-d2:claim:4 Removals credited against the next drop." },
    { campaign: "premium", reasons: null, end: "draft", note: null },
    { campaign: "summit", reasons: null, end: "rejected", reject: "Outside the vendor's terms: returns are accepted for duplicates and bad numbers only, and these connected.", note: "qa-d2:claim:6" },
  ];
  const existing = must(await db.from("lead_claims").select("id, campaign_id, status, created_at").eq("tenant_id", TENANT_ID).in("campaign_id", Object.values(CAMPAIGN_ID)).order("created_at"), "read claims");
  const used = new Set();
  for (const spec of PLAN_CLAIMS) {
    let claim = existing.find((c) => c.campaign_id === CAMPAIGN_ID[spec.campaign] && !used.has(c.id));
    if (!claim) {
      const created = await api("POST", "/api/app/vendor-returns/claims", "helen", { campaign_id: CAMPAIGN_ID[spec.campaign], reasons: spec.reasons });
      if (created.status >= 300) { note(`claim on ${spec.campaign}: HTTP ${created.status} ${created.text.slice(0, 200)}`); continue; }
      claim = { id: created.json.id ?? created.json.claim?.id, status: "draft" };
      bump("lead_claims", "inserted");
    } else bump("lead_claims", "kept");
    used.add(claim.id);
    if (spec.end === "draft" || claim.status !== "draft" && claim.status !== "submitted") continue;
    if (claim.status === "draft") ok(await api("PATCH", `/api/app/vendor-returns/claims/${claim.id}`, "helen", { action: "submit" }), "submit claim");
    if (spec.end === "submitted") continue;
    const detail = must(await db.from("lead_claims").select("amount_claimed_cents").eq("id", claim.id).single(), "read claim");
    const body = spec.end === "accepted" ? { action: "resolve", status: "accepted", amount_credited_cents: detail.amount_claimed_cents, notes: spec.note }
      : spec.end === "partial" ? { action: "resolve", status: "partial", amount_credited_cents: Math.max(1, Math.round(detail.amount_claimed_cents * spec.pct)), notes: spec.note }
        : { action: "resolve", status: "rejected", rejection_reason: spec.reject, notes: spec.note };
    ok(await api("PATCH", `/api/app/vendor-returns/claims/${claim.id}`, "helen", body), `resolve claim ${spec.end}`);
    bump("lead_claims", "updated");
  }
});

// =============================================================================
// D16 · assignment · D17 · scoring · D3 final statuses
// =============================================================================
await section("D16 assignment rules + capacity", async () => {
  const current = must(await db.from("assignment_rules").select("id, match_type, match_values, assignee_ids, is_active, strategy, conditions, priority").eq("tenant_id", TENANT_ID).eq("is_active", true).order("priority"), "read rules");
  const mine = [
    { matchType: "campaign", matchValues: { campaign_ids: [CAMPAIGN_ID.premium] }, assigneeIds: [idOf("marisol"), idOf("devin")], isActive: true, strategy: "least_loaded", conditions: [] },
    { matchType: "state", matchValues: { states: ["AZ"] }, assigneeIds: [idOf("devin")], isActive: true, strategy: "round_robin", conditions: [] },
    { matchType: "language", matchValues: { languages: ["spanish"] }, assigneeIds: [idOf("marisol")], isActive: true, strategy: "round_robin", conditions: [] },
    { matchType: "product", matchValues: { products: [PRODUCT], licensed_only: true }, assigneeIds: [idOf("owner"), idOf("marisol"), idOf("devin")], isActive: true, strategy: "least_loaded", conditions: [] },
    { matchType: "fallback", matchValues: {}, assigneeIds: [idOf("jordan"), idOf("aaliyah"), idOf("marisol"), idOf("devin")], isActive: true, strategy: "round_robin", conditions: [] },
  ];
  const signature = (r) => JSON.stringify([r.matchType ?? r.match_type, r.matchValues ?? r.match_values, [...(r.assigneeIds ?? r.assignee_ids)].sort(), r.strategy]);
  const haveMine = mine.every((m) => current.some((c) => signature(c) === signature(m)));
  if (haveMine) bump("assignment_rules", "kept", mine.length);
  else {
    // Rules not in the payload are switched off, so the existing ones are republished as they are
    // (a legacy {campaign_id} value is written as the {campaign_ids} the API now takes).
    const others = current.filter((c) => !mine.some((m) => signature(m) === signature(c)) && c.match_type !== "fallback").map((c) => ({ id: c.id, matchType: c.match_type, matchValues: c.match_type === "campaign" && c.match_values.campaign_id ? { campaign_ids: [c.match_values.campaign_id] } : c.match_values, assigneeIds: c.assignee_ids, isActive: true, strategy: c.strategy ?? "round_robin", conditions: c.conditions ?? [] }));
    ok(await api("PUT", "/api/app/assignments", "owner", { rules: [...others, ...mine] }), "publish rules");
    bump("assignment_rules", "inserted", mine.length);
    if (others.length) note(`republished ${others.length} existing rule(s) unchanged ahead of the demo rules`);
  }
  const caps = must(await db.from("agent_capacity").select("user_id, max_open_leads, languages").eq("tenant_id", TENANT_ID), "read capacity");
  for (const [key, max, languages] of [["owner", 60, ["english"]], ["marisol", 30, ["english", "spanish"]], ["devin", 30, ["english"]], ["jordan", 40, ["english"]], ["aaliyah", 25, ["english"]]]) {
    const row = caps.find((c) => c.user_id === idOf(key));
    if (row && row.max_open_leads === max && JSON.stringify(row.languages) === JSON.stringify(languages)) { bump("agent_capacity", "kept"); continue; }
    ok(await api("PATCH", "/api/app/assignments", "owner", { userId: idOf(key), maxOpenLeads: max, languages }), `capacity ${key}`);
    bump("agent_capacity", row ? "updated" : "inserted");
  }
});

await section("D17 scoring settings", async () => {
  const settings = must(await db.from("tenant_scoring_settings").select("enabled, holdout_pct").eq("tenant_id", TENANT_ID).maybeSingle(), "read scoring");
  if (settings?.enabled && settings.holdout_pct === 10) { bump("tenant_scoring_settings", "kept"); return; }
  const current = ok(await api("GET", "/api/app/scoring", "owner"), "read scoring");
  const weights = (current.weights ?? current.settings?.weights ?? []).map((w) => ({ signal: w.signal, weight: Number(w.weight) }));
  ok(await api("PUT", "/api/app/scoring", "owner", { enabled: true, holdout_pct: 10, weights }), "save scoring");
  bump("tenant_scoring_settings", "updated");
  note(`scoring: enabled ${settings?.enabled ?? "∅"} → true, holdout ${settings?.holdout_pct ?? "∅"}% → 10%`);
});

await section("D3 final campaign statuses + real-time spend", async () => {
  const rows = must(await db.from("tenant_campaigns").select("id, name, status, scrub_status, total_spend_cents, records_purchased").in("id", Object.values(CAMPAIGN_ID)), "read campaigns");
  const accepted = [...POST_RESULT.values()].filter((r) => r.reason_code === "accepted").length;
  for (const [key, spec] of Object.entries(CAMPAIGNS)) {
    const row = rows.find((r) => r.id === CAMPAIGN_ID[key]);
    const patch = {};
    if (spec.final !== row.status && ["paused", "exhausted"].includes(spec.final)) patch.status = spec.final;
    if (key === "summit" && accepted && row.records_purchased !== accepted) { patch.total_spend_cents = accepted * RT_PRICE_CENTS; patch.records_purchased = accepted; }
    if (!Object.keys(patch).length) { bump("tenant_campaigns (final)", "kept"); continue; }
    ok(await api("PATCH", `/api/app/campaigns/${row.id}`, "owner", patch), `finalise ${spec.name}`);
    bump("tenant_campaigns (final)", "updated");
  }
  const paused = rows.find((r) => r.id === CAMPAIGN_ID.crest);
  if (paused) must(await db.from("tenant_campaigns").update({ paused_at: iso(CAMPAIGN_PAUSED_AT) }).eq("id", paused.id).not("paused_at", "is", null), "date pause");
});

// =============================================================================
// D18 · the private plan's Module 2 limits, near the caps
// =============================================================================
await section("D18 plan limits", async () => {
  const plan = must(await db.from("plans").select("id, code, is_public").eq("code", PLAN_CODE).eq("version", 1).single(), "read plan");
  const users = must(await db.from("subscriptions").select("tenant_id, status").eq("plan_id", plan.id), "read plan subscribers");
  if (plan.is_public || users.some((s) => s.tenant_id !== TENANT_ID)) throw new Error(`${PLAN_CODE} is public or used by another tenant; not touching it`);
  if (subscription.plan_id !== plan.id) throw new Error(`the tenant is not on ${PLAN_CODE}`);
  // Imports dated before this billing period were metered today; their usage belongs to the period
  // they are dated in, so it comes back off this one through record_usage's own correction path.
  // What each such file was metered: the leads it created, and one DNC and one litigator lookup
  // per distinct number it was the first to screen (screening answers are cached per number).
  const screenedBefore = new Set();
  for (const file of FILES.filter((f) => f.at < PERIOD_START)) {
    const result = FILE_RESULT.get(file.key);
    if (!result?.summary) continue;
    const fresh = [...new Set(file.data.filter((r) => /^\d{10}$/.test(r.phone) && !r.phoneText).map((r) => r.phone))].filter((p) => !screenedBefore.has(p));
    fresh.forEach((p) => screenedBefore.add(p));
    const metered = { monthly_leads_imported: Number(result.summary.imported ?? 0), dnc_lookups: fresh.length, tcpa_checks: fresh.length };
    for (const [meter, qty] of Object.entries(metered)) {
      if (!qty) continue;
      const recorded = must(await db.rpc("record_usage", { p_tenant_id: TENANT_ID, p_meter_key: meter, p_qty: -qty, p_idempotency_key: `qa-d2:usage-period:${file.key}:${meter}`, p_ref: `qa_seed ${TAG}: ${file.name} is dated ${iso(file.at).slice(0, 10)}, before this period` }), "usage correction");
      const row = Array.isArray(recorded) ? recorded[0] : recorded;
      bump("usage_events (period correction)", row?.recorded ? "inserted" : "kept");
    }
  }
  const usage = await meterTotals();
  const limits = must(await db.from("plan_limits").select("*").eq("plan_id", plan.id).single(), "read limits");
  const meters = must(await db.from("plan_meters").select("*").eq("plan_id", plan.id), "read meters");
  const dncCap = Math.ceil(usage.dnc_lookups / 0.84 / 250) * 250;
  const want = { max_setter_seats: 3, meters: { monthly_leads_imported: { included_qty: 5000, hard_cap: true }, dnc_lookups: { included_qty: dncCap, hard_cap: true } } };
  const before = { max_setter_seats: limits.max_setter_seats, monthly_leads_imported: meters.find((m) => m.meter_key === "monthly_leads_imported") ?? null, dnc_lookups: meters.find((m) => m.meter_key === "dnc_lookups") ?? null };
  let changed = false;
  if (limits.max_setter_seats !== want.max_setter_seats) { must(await db.from("plan_limits").update({ max_setter_seats: want.max_setter_seats }).eq("plan_id", plan.id), "setter seats"); changed = true; bump("plan_limits", "updated"); } else bump("plan_limits", "kept");
  for (const [meter_key, spec] of Object.entries(want.meters)) {
    const row = meters.find((m) => m.meter_key === meter_key);
    if (row && (meter_key === "dnc_lookups" || row.included_qty === spec.included_qty) && row.hard_cap === spec.hard_cap) { bump("plan_meters", "kept"); continue; }
    if (row) must(await db.from("plan_meters").update(spec).eq("plan_id", plan.id).eq("meter_key", meter_key), `meter ${meter_key}`);
    else must(await db.from("plan_meters").insert({ plan_id: plan.id, meter_key, ...spec }), `meter ${meter_key}`);
    changed = true; bump("plan_meters", row ? "updated" : "inserted");
  }
  const entitlement = must(await db.rpc("refresh_tenant_entitlement", { p_tenant_id: TENANT_ID }), "refresh entitlement");
  note(`D18 before: max_setter_seats ${before.max_setter_seats ?? "∅ (unlimited)"}, monthly_leads_imported ${before.monthly_leads_imported ? JSON.stringify(before.monthly_leads_imported) : "no meter row (unlimited)"}, dnc_lookups ${before.dnc_lookups ? JSON.stringify(before.dnc_lookups) : "no meter row (unlimited)"}`);
  note(`D18 after: max_setter_seats 3; monthly_leads_imported ${entitlement.meters?.monthly_leads_imported?.used} of ${entitlement.meters?.monthly_leads_imported?.included} (hard cap); dnc_lookups ${entitlement.meters?.dnc_lookups?.used} of ${entitlement.meters?.dnc_lookups?.included} (hard cap)`);
  if (changed) {
    must(await db.from("audit_log").insert({
      actor_type: "system", actor_id: null, action: "plan.limits_changed", target_type: "plan", target_id: plan.id,
      reason: "Module 2 demo: outbound limits set near their caps on the tenant's private plan so the usage bars and upgrade prompts can be shown.",
      metadata: { qa_seed: TAG, tenantId: TENANT_ID, plan: PLAN_CODE, before, after: want, usageThisPeriod: usage, undo: `update plan_limits set max_setter_seats = ${before.max_setter_seats ?? "null"} where plan_id = '${plan.id}'; delete from plan_meters where plan_id = '${plan.id}' and meter_key in ('monthly_leads_imported','dnc_lookups'); then select refresh_tenant_entitlement('${TENANT_ID}'). The period corrections are usage_events with idempotency keys 'qa-d2:usage-period:%'.` },
    }), "audit limits");
    bump("audit_log", "inserted");
  }
});

// =============================================================================
// --today · the day so far, written when it has happened (AG D10–D12)
// =============================================================================
// The main seed stops at 05:00 Central on the 25th, before any US calling window opens, so it is
// identical on every run. `--today` adds what a working day has produced up to the moment it runs:
// dials, their dispositions, applications (today's deal flow), setter bookings, and ONE callback and
// ONE appointment due about 15 minutes later. Keyed by the date, so re-running it the same day adds
// only what has happened since the last run.
if (TODAY_MODE) await section("today: dials, applications, bookings, due-soon callback + appointment", async () => {
  const date = local(NOW, "America/Chicago").date;
  const open = Date.parse(`${date}T13:05:00Z`); // 08:05 Central, 09:05 Eastern
  const planned = SIM.leads
    .filter((l) => ["bayviewA", "bayviewB", "premium", "summit"].includes(l.campaign) && l.sim?.state === "retry" && l.workItemId)
    .sort((a, b) => seedOf(`today:${date}:${a.id}`) - seedOf(`today:${date}:${b.id}`))
    .slice(0, 260)
    .map((lead, i) => {
      const at = open + i * 150_000 + (seedOf(`t:${date}:${lead.id}`) % 90) * 1000;
      const agents = AGENTS.filter((a) => onShift(a, at) && canWork(a, lead.state));
      return { lead, at, agents };
    })
    .filter((p) => p.at <= NOW - 60_000 && legal(p.at, p.lead) && p.agents.length);
  const ids = planned.map((p) => uid("attempt", `${p.lead.id}:today:${date}`));
  const done = new Set((await inChunks(ids, 150, (part) => db.from("tenant_call_attempts").select("id").in("id", part))).map((r) => r.id));
  const todo = planned.filter((p, i) => !done.has(ids[i]));
  bump("tenant_call_attempts (today)", "kept", planned.length - todo.length);
  note(`today (${date}): ${planned.length} dials due by now, ${todo.length} new${NOW < open ? " — calling hours have not started yet" : ""}`);
  if (DRY) { bump("tenant_call_attempts (today)", "inserted", todo.length); return; }
  const current = new Map((await inChunks(todo.map((p) => p.lead.id), 150, (part) => db.from("agent_leads").select("id, attempts_made, lead_state, values").in("id", part))).map((r) => [r.id, r]));
  let apps = 0, bookings = 0;
  for (const p of todo) {
    const { lead } = p;
    const row = current.get(lead.id);
    if (!row || row.lead_state !== "retry") continue;
    const rng = rngFor(`today:${date}:${lead.id}`);
    const agent = rng.weighted(p.agents.map((a) => [a, AGENT_WEIGHT[a]]));
    const n = (row.attempts_made ?? 0) + 1;
    let outcome = sampleOutcome(rng, lead, agent, n, p.at, 1.3);
    if (outcome === "booking" && !producerFor(lead).length) outcome = "not_interested";
    if (outcome === "app" && isSetter(agent)) outcome = "not_interested";
    const slot = slotOf(p.at, lead.state);
    const a = makeAttempt(lead, n, p.at, agent, outcome, slot, rng);
    a.id = uid("attempt", `${lead.id}:today:${date}`); a.cardId = uid("card", `${lead.id}:today:${date}`); a.decisionId = uid("decision", `${lead.id}:today:${date}`);
    if (a.endAt > NOW) a.endAt = NOW - 5_000;
    let cardId = a.cardId;
    if (outcome === "app") {
      // Through the producer's panel, exactly as on a real call.
      must(await db.from("lead_queue").update({ status: "claimed", claimed_by: idOf(agent), owner_user_id: idOf(agent), claimed_at: iso(a.servedAt), locked_until: null, disposition: null }).eq("id", lead.workItemId), "claim");
      const started = await api("POST", "/api/app/outbound/application", agent, { work_item_id: lead.workItemId, product_line: PRODUCT });
      if (started.status < 300) {
        for (const f of (started.json.panel?.sections ?? []).flatMap((s) => s.fields).filter((f) => f.is_visible)) {
          const v = started.json.panel.lead.values?.[f.field_key];
          if (v !== undefined && v !== null && v !== "") await api("PATCH", "/api/app/outbound/application", agent, { work_item_id: lead.workItemId, field_key: f.field_key, state: "confirmed" });
          else if (f.is_required) await api("PATCH", "/api/app/outbound/application", agent, { work_item_id: lead.workItemId, field_key: f.field_key, state: "corrected", value: f.field_key === "tobacco" ? false : f.field_key === "date_of_birth" ? "1961-04-12" : "x" });
        }
        const card = must(await db.from("tenant_lead_activity").select("id").eq("work_item_id", lead.workItemId).eq("served_at", iso(a.servedAt)).maybeSingle(), "card");
        if (card) cardId = card.id;
        if (started.json.dealId) ok(await api("PATCH", `/api/app/deal-flow/${started.json.dealId}`, "owner", { local_date: local(p.at, STATE_TZ[lead.state]).date, carrier: rng.pick(["Americo", "Foresters", "Transamerica", "Mutual of Omaha"]), product_type: "Term 20", monthly_premium_cents: rng.int(3100, 9800), face_amount_cents: rng.pick([10000000, 25000000]), status: "completed", call_result: "Application submitted" }), "today's deal");
        apps += 1;
      } else outcome = a.outcome = a.disposition = "not_interested";
    }
    if (outcome === "booking") {
      const producer = rng.pick(producerFor(lead));
      let booked = null;
      for (let d = 1; d <= 6 && !booked; d += 1) for (const hh of [10, 11, 14, 15]) {
        const start = atLocal(local(NOW + d * DAY, "America/Chicago").date, hh, 0, "America/Chicago");
        const l = local(start, "America/Chicago");
        if (l.dow < 1 || l.dow > 5 || !legal(start, lead)) continue;
        const r = await api("POST", "/api/app/appointments", agent, { lead_id: lead.id, agent_user_id: idOf(producer), starts_at_utc: iso(start), notes: rng.pick(["Wants term quotes side by side; spouse joins.", "Budget about $40/month; prefers mornings.", "Asked for a callback-style appointment after work."]) });
        if (r.status < 300) { booked = r; break; }
      }
      a.disposition = booked ? "callback_scheduled" : "not_interested";
      if (booked) bookings += 1;
    }
    must(await db.from("tenant_call_attempts").upsert({ id: a.id, tenant_id: TENANT_ID, lead_id: lead.id, work_item_id: lead.workItemId, attempt_number: n, slot, attempted_at: iso(a.at - 1500), disposition: a.disposition, agent_id: idOf(agent), dial_clicked_at: a.clickAt ? iso(a.clickAt) : null, script_id: SCRIPT.default?.id ?? null, script_version: SCRIPT.default?.version ?? null, disclosure_state: lead.state, disclosure_product_code: PRODUCT, disclosure_confirmed_at: iso(a.at - 1000) }, { onConflict: "id", ignoreDuplicates: true }), "today attempt");
    const card = { tenant_id: TENANT_ID, work_item_id: lead.workItemId, lead_id: lead.id, campaign_id: CAMPAIGN_ID[lead.campaign], agent_user_id: idOf(agent), served_at: iso(a.servedAt), clicked_at: a.clickAt ? iso(a.clickAt) : null, dispositioned_at: iso(a.endAt), disposition: a.disposition, card_open_seconds: Math.max(0, Math.round((a.endAt - a.servedAt) / 1000)), call_attempt_id: a.id };
    if (cardId === a.cardId) must(await db.from("tenant_lead_activity").upsert({ id: a.cardId, ...card, created_at: iso(a.servedAt), updated_at: iso(a.endAt) }, { onConflict: "id", ignoreDuplicates: true }), "today card");
    else must(await db.from("tenant_lead_activity").update(card).eq("id", cardId), "today product card");
    const cohort = lead.bucket < 10 ? "control" : "scored";
    must(await db.from("tenant_scoring_decisions").upsert({ id: a.decisionId, tenant_id: TENANT_ID, lead_id: lead.id, work_item_id: lead.workItemId, agent_user_id: idOf(agent), cohort, score: cohort === "scored" ? rng.int(3000, 9400) / 100 : null, signal_snapshot: {}, selection_reason: cohort === "scored" ? `Called first because ${slot.replace("_", " ")} has not been tried for this ${lead.state} lead and the retry is due.` : "Holdout: served in queue order so the scored and control contact rates can be compared.", served_at: iso(a.servedAt), contacted_at: CONTACT_OUTCOMES.has(a.outcome) ? iso(a.endAt) : null, disposition: a.disposition }, { onConflict: "id", ignoreDuplicates: true }), "today decision");
    const retry = RETRY_OUTCOMES.has(a.outcome);
    const exhausted = retry && n >= 7;
    const state = a.disposition === "callback_scheduled" ? "working" : retry ? (exhausted ? "exhausted" : "retry") : "closed";
    const nextDue = retry && !exhausted ? a.at + (lead.campaign === "premium" ? PREMIUM_DELAYS : DEFAULT_DELAYS)[Math.min(n - 1, 5)] : null;
    const stage = state !== "retry" ? STAGE_FOR.get(a.disposition) : null;
    must(await db.from("agent_leads").update({ attempts_made: n, lead_state: state, next_dial_after: nextDue ? iso(nextDue) : null, next_preferred_slot: null, ...(stage ? { stage_id: stage.id, pipeline_id: stage.pipeline_id } : {}), ...(exhausted ? { nurture_entered_at: iso(a.endAt) } : {}) }).eq("id", lead.id), "today lead state");
    must(await db.from("lead_queue").update({ status: state === "retry" ? "unclaimed" : "completed", claimed_by: null, owner_user_id: null, locked_until: null, disposition: a.disposition, disposition_at: iso(a.endAt), disposition_by: idOf(agent) }).eq("id", lead.workItemId), "today work item");
    if (a.outcome === "do_not_call") await db.rpc("suppress_phone", { p_tenant_id: TENANT_ID, p_phone: String(row.values?.phone ?? ""), p_list_type: "internal", p_reason: "Agent recorded do not call on the dialer", p_source: "disposition", p_added_by: idOf(agent) });
    bump("tenant_call_attempts (today)", "inserted");
  }
  note(`today: ${apps} application(s) submitted into today's deal flow, ${bookings} appointment(s) booked by setters`);

  // ONE callback and ONE appointment due about 15 minutes from now.
  const soon = NOW + 15 * MIN;
  const leadById = new Map([...LEAD.values()].map((l) => [l.id, l]));
  const cbs = must(await db.from("tenant_callbacks").select("id, lead_id, scheduled_at_utc, status, customer_timezone").eq("tenant_id", TENANT_ID).in("status", ["scheduled", "due"]).gte("scheduled_at_utc", iso(NOW)).order("scheduled_at_utc").limit(400), "read open callbacks").filter((c) => leadById.has(c.lead_id));
  if (cbs.some((c) => Math.abs(Date.parse(c.scheduled_at_utc) - soon) <= 10 * MIN)) bump("due-soon callback", "kept");
  else {
    let moved = false;
    for (const cb of cbs.filter((c) => Date.parse(c.scheduled_at_utc) > NOW + 3 * HOUR)) {
      const lead = leadById.get(cb.lead_id);
      if (!lead || !legal(soon, lead) || !OFFSET[cb.customer_timezone]) continue;
      const at = Math.ceil(soon / (5 * MIN)) * 5 * MIN;
      const l = local(at, cb.customer_timezone);
      const r = await api("PATCH", "/api/app/callbacks", "owner", { action: "reschedule", callback_id: cb.id, callback_local: `${l.date}T${String(l.hour).padStart(2, "0")}:${String(l.minute).padStart(2, "0")}` });
      if (r.status < 300) { moved = true; note(`due-soon callback ${cb.id} → ${iso(at)} (${lead.state})`); bump("due-soon callback", "updated"); break; }
    }
    if (!moved) note("due-soon callback: no seeded lead is inside its calling window 15 minutes from now; run --today again during US calling hours");
  }
  const appts = must(await db.from("tenant_appointments").select("id, starts_at_utc").eq("tenant_id", TENANT_ID).in("status", ["booked", "confirmed"]).gte("starts_at_utc", iso(NOW)).lte("starts_at_utc", iso(NOW + HOUR)), "read soon appointments");
  if (appts.some((x) => Math.abs(Date.parse(x.starts_at_utc) - soon) <= 10 * MIN)) bump("due-soon appointment", "kept");
  else {
    const start = Math.ceil(soon / (5 * MIN)) * 5 * MIN;
    let booked = false;
    const candidates = SIM.leads.filter((l) => l.sim?.state === "retry" && legal(start, l) && legal(start + 30 * MIN, l)).sort((a, b) => seedOf(`soon:${a.id}`) - seedOf(`soon:${b.id}`)).slice(0, 12);
    for (const lead of candidates) {
      for (const producer of ["owner", ...producerFor(lead).filter((p) => p !== "owner")]) {
        const r = await api("POST", "/api/app/appointments", "jordan", { lead_id: lead.id, agent_user_id: idOf(producer), starts_at_utc: iso(start), notes: "Booked by Jordan: wants a 20-year term quote before his lunch break; call on time." });
        if (r.status < 300) { booked = true; note(`due-soon appointment for ${USER[producer].name} at ${iso(start)} (${lead.state} lead)`); bump("due-soon appointment", "inserted"); break; }
        if (lead === candidates[0]) note(`due-soon appointment with ${producer}: HTTP ${r.status} ${r.text.slice(0, 140)}`);
      }
      if (booked) break;
    }
    if (!booked) note("due-soon appointment: nobody's working hours and no customer window include 15 minutes from now; run --today again during working hours");
  }
});

await section("audit", async () => {
  const already = must(await db.from("audit_log").select("id").eq("action", "tenant.qa_seed_applied").eq("target_id", TENANT_ID).contains("metadata", { qa_seed: TAG }).limit(1), "read audit");
  if (already.length) { bump("audit_log", "kept"); return; }
  must(await db.from("audit_log").insert({ actor_type: "system", actor_id: null, action: "tenant.qa_seed_applied", target_type: "tenant", target_id: TENANT_ID, reason: "Module 2 demo data (scripts/seed-demo-outbound.mjs).", metadata: { qa_seed: TAG, vendors: VENDOR_ID, campaigns: CAMPAIGN_ID, files: FILES.map((f) => f.name) } }), "audit seed");
  bump("audit_log", "inserted");
});

printSummary();

function printSummary() {
  console.log(`\n${DRY ? "DRY RUN — would write" : "Wrote"}:`);
  console.log(`${"table / call".padEnd(52)} ${"inserted".padStart(8)} ${"updated".padStart(8)} ${"kept".padStart(7)} ${"api".padStart(5)} ${"failed".padStart(6)}`);
  for (const [table, row] of [...stats.entries()]) console.log(`${table.padEnd(52)} ${String(row.inserted).padStart(8)} ${String(row.updated).padStart(8)} ${String(row.kept).padStart(7)} ${String(row.api).padStart(5)} ${String(row.failed).padStart(6)}`);
  if ([...stats.values()].some((row) => row.failed > 0)) { console.log("\nSome sections failed; see FAILED lines above."); process.exitCode = 1; }
}
