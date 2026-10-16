/**
 * A book of business for the demo agency's dashboard (2026-10-13).
 *
 * scripts/seed-dashboard-recent.mjs filled the dialling panels; this fills the ones that read the
 * book: "Premium · 30 days", the Policies tile, "Money and retention" (owed, statements to review,
 * chargeback exposure, lapse risk), "Pending cases", and the owner's "Your close-out · 30 days".
 * Tenant d6f3950f-0d88-4e66-869f-0de2ea6b396b only. Everything is fictional: names from a list,
 * policy numbers QA-D3-B####, no phone numbers, no email or SMS sent.
 *
 * Wherever the product has a write path it is used, over HTTP against the running dev server
 * (http://localhost:3000), with a session minted for the person who would do it
 * (scripts/mint-session.mjs; the token is never printed and its tenant is checked):
 *
 *   policies          POST /api/app/policies as the producer who wrote it: the older book as one
 *                     CSV import per producer, the last 30 days entered one by one (audit rows,
 *                     discrepancy refresh, created_by = the producer)
 *   lapse signals     POST /api/app/policies/lapse-risk/signals as the producer; two policies are
 *                     then resolved "policy lapsed" with PATCH as the owner (the ledger posts their
 *                     chargebacks the way the product does)
 *   statements        POST /api/app/statements as the bookkeeper (Helen Marsh), two CSV statements:
 *                     Corebridge (September) with every line decided through POST
 *                     /api/app/statements/[id]/lines, so it is "reviewed" and Discrepancies finds two
 *                     short-paid and two never-paid policies; Sentinel Security Life (September) left
 *                     in review
 *   pending cases     requirements, counteroffers and "issued" through the LA-3 attempt routes
 *                     (/api/app/applications/attempts/[id]/requirements | counteroffers | transition)
 *
 * Raw service-role writes, and why:
 *   - tenant_policies.created_at is back-dated after each POST (the API stamps "now");
 *   - the twelve pending cases (case, selected quote, attempt at "submitted", submission row): the
 *     only product path to "submitted" is the full application (interview, beneficiaries, payment,
 *     disclosures, QA) and the submission route also generates and may email the welcome pack, which
 *     this must never do. The submission row carries a seeded QA verdict and says so in its notes;
 *   - the owner's own appointments for the close-out strip, as seed-dashboard-recent.mjs does, with
 *     outcomes through mark_appointment_outcome.
 *
 * Ids are derived from "qa-d3:book:<kind>:<n>" (cases, quotes, attempts, submissions, appointments);
 * policies and statements are found again by their number / file name. A re-run adds only what is
 * missing. --remove takes everything back out EXCEPT what the database refuses to delete by design:
 * the two statements are voided (never deleted), and the policies their lines matched or their
 * findings name stay; it prints the SQL-editor block that removes those too.
 *
 *   node --env-file=.env.local scripts/seed-dashboard-book.mjs --dry-run
 *   node --env-file=.env.local scripts/seed-dashboard-book.mjs
 *   node --env-file=.env.local scripts/seed-dashboard-book.mjs --remove [--dry-run]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const TENANT_ID = "d6f3950f-0d88-4e66-869f-0de2ea6b396b";
const BASE = process.env.SEED_BASE_URL ?? "http://localhost:3000";
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry-run");
const REMOVE = process.argv.includes("--remove");
const ZONE = "America/Chicago";
const NOW = Date.now();
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const PREFIX = "QA-D3-B";
const TAG = "Demo seed (qa-d3:book)";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (result, what) => { if (result.error) throw new Error(`${what}: ${result.error.message}`); return result.data; };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function uid(key) {
  const h = createHash("sha1").update(`qa-d3:book:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}
function rngFor(key) {
  let s = parseInt(createHash("sha1").update(`qa-d3:book:${key}`).digest("hex").slice(0, 8), 16) || 1;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  return { next, int: (a, b) => a + Math.floor(next() * (b - a + 1)), chance: (p) => next() < p, pick: (xs) => xs[Math.floor(next() * xs.length)],
    weighted: (pairs) => { const total = pairs.reduce((t, [, w]) => t + w, 0); let r = next() * total; for (const [v, w] of pairs) { if ((r -= w) < 0) return v; } return pairs.at(-1)[0]; } };
}
const iso = (ms) => new Date(ms).toISOString();
function localDate(at) { return new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(at); }
function addDays(date, days) { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function addYear(date) { return `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`.replace(/-02-29$/, "-02-28"); }
/** The UTC instant of a Central wall-clock time on a date. */
function atLocal(date, hh, mm) {
  const guess = Date.parse(`${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: ZONE, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(guess).map((p) => [p.type, p.value]));
  const shown = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}:00Z`);
  return guess - (shown - guess);
}
const TODAY = localDate(NOW);
const usd = (cents) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── the database must be answering; pace the writes when it is slow ─────────────────────────────
const pingStart = Date.now();
const tenant = must(await db.from("tenants").select("id, name").eq("id", TENANT_ID).maybeSingle(), "read tenant");
if (!tenant) throw new Error(`tenant ${TENANT_ID} not found`);
const PACE = Date.now() - pingStart > 1000 ? 400 : 0;
if (PACE) console.log(`database is slow (${Date.now() - pingStart} ms for one read): pacing writes`);

// ── who ──────────────────────────────────────────────────────────────────────────────────────────
const members = must(await db.from("tenant_users").select("user_id, role, users(email, name)").eq("tenant_id", TENANT_ID), "read members");
const byEmail = new Map(members.map((m) => [m.users?.email, { id: m.user_id, role: m.role, email: m.users?.email, name: m.users?.name }]));
const person = (email) => { const p = byEmail.get(email); if (!p) throw new Error(`${email} is not a member of ${TENANT_ID}`); return p; };
const OWNER = person("demo.agent@insurvas.test");
const BOOKKEEPER = person("helen.marsh@qa-demo.insurvas.test");
// Who writes business. Colin Reddy, the third producer, has never accepted his invitation (status
// "invited"), so no session can act as him; the owner, who also sells, takes his share.
const PRODUCERS = [["devin.okafor@qa-demo.insurvas.test", 1.2], ["marisol.vance@qa-demo.insurvas.test", 1.0], ["demo.agent@insurvas.test", 0.75]].map(([email, w]) => ({ ...person(email), w }));
const SETTERS = ["jordan.pike@qa-demo.insurvas.test", "aaliyah.brooks@qa-demo.insurvas.test", "nadia.ferris@qa-demo.insurvas.test"].map(person);

// ── sessions (minted, tenant checked, never printed) ─────────────────────────────────────────────
const sessions = new Map();
function cookieFor(who) {
  if (sessions.has(who.email)) return sessions.get(who.email);
  const out = execFileSync(process.execPath, ["scripts/mint-session.mjs", "tenant", "--email", who.email, "--ttl", "30", "--js"], { cwd: REPO, encoding: "utf8", env: process.env });
  const pair = JSON.parse(out.match(/document\.cookie=("(?:[^"\\]|\\.)*")/)[1]).split(";")[0];
  const claims = JSON.parse(Buffer.from(pair.slice(pair.indexOf("=") + 1).split(".")[1], "base64url").toString("utf8"));
  if (claims.tenantId !== TENANT_ID || claims.sub !== who.id) throw new Error(`the session minted for ${who.email} is not for the demo agency; stopping`);
  sessions.set(who.email, pair);
  return pair;
}
async function api(who, method, path, body) {
  if (PACE) await sleep(PACE);
  const response = await fetch(`${BASE}${path}`, { method, headers: { cookie: cookieFor(who), "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 200) }; }
  return { status: response.status, json };
}
async function apiOk(who, method, path, body, what) {
  const result = await api(who, method, path, body);
  if (result.status >= 300) throw new Error(`${what}: HTTP ${result.status} ${JSON.stringify(result.json).slice(0, 300)}`);
  return result.json;
}

// ── carriers ─────────────────────────────────────────────────────────────────────────────────────
const carrierRows = must(await db.from("carriers").select("id, code, name").is("organization_id", null).eq("is_active", true), "read carriers");
const carrier = (code) => { const c = carrierRows.find((row) => row.code === code); if (!c) throw new Error(`carrier ${code} is not in the library`); return c; };
const contracted = new Set(must(await db.from("tenant_carriers").select("carrier_id").eq("tenant_id", TENANT_ID).eq("is_active", true), "read tenant carriers").map((r) => r.carrier_id));
// What the agency has rates for (Settings › Rate card), and the last issue date each contract level allows.
const FE = [["aetna", 9], ["aflac", 8], ["american_home_life", 7], ["americo", 10], ["mutual_of_omaha", 7, "2026-09-15"], ["american_amicable", 6, "2026-09-30"]];
const WL = [["sentinel_security_life", 1]];
const TERM = [["foresters", 3], ["transamerica", 3], ["national_life", 2]];
for (const [code] of [...FE, ...WL, ...TERM, ["corebridge"]]) if (!contracted.has(carrier(code).id)) throw new Error(`${code} is not one of the agency's carriers`);
const PRODUCT = { final_expense: "Final Expense", whole_life: "Whole Life", term_life: "Term Life" };

// ── the people insured (fictional) ───────────────────────────────────────────────────────────────
const FIRST = ["Harold", "Loretta", "Calvin", "Dolores", "Wendell", "Imogene", "Rufus", "Bernice", "Odell", "Marjorie", "Cletus", "Opal", "Virgil", "Thelma", "Lionel", "Geneva", "Elmer", "Darlene", "Floyd", "Rosalind", "Mervin", "Juanita", "Lowell", "Beatrice", "Clarence", "Agnes", "Delbert", "Winifred", "Homer", "Lucille", "Earl", "Gwendolyn", "Alton", "Nadine", "Rodney", "Phyllis"];
const LAST = ["Whitfield", "Abernathy", "Pruitt", "Castellano", "Hollis", "Brannigan", "Okonkwo", "Delacroix", "Fairbanks", "Ruelas", "Tidwell", "Kowalczyk", "Sandoval", "Pettigrew", "Marchetti", "Lindqvist", "Batiste", "Hargrove", "Quintero", "Ashby", "Villareal", "Stroud", "Nakamura", "Ellsworth", "Boudreaux", "Calloway", "Duquette", "Fenwick", "Galloway", "Holloway"];
const nameFor = (n) => { const r = rngFor(`name:${n}`); return `${r.pick(FIRST)} ${r.pick(LAST)}`; };

// ── the policies ─────────────────────────────────────────────────────────────────────────────────
// Corebridge is reserved for the reviewed statement's policies (a reviewed statement makes every
// unpaid Corebridge policy "never paid"); everything else is spread over the carriers with rates,
// and a few term policies with carriers the rate card has no term rates for (ledger gaps, as in life).
function premiumFor(product, r) {
  if (product === "whole_life") return r.int(90, 240) * 1000;
  if (product === "term_life") return r.int(40, 120) * 1000;
  return r.int(48, 180) * 1000 + r.pick([0, 240, 480, 600, 720]);
}
function pickCarrier(product, effective, r) {
  const list = (product === "final_expense" ? FE : product === "whole_life" ? WL : TERM).filter(([, , last]) => !last || effective <= last);
  return carrier(r.weighted(list.map(([code, w]) => [code, w])));
}
function makePolicy(n, createdAt, rng, fixed = {}) {
  const producer = fixed.producer ?? rng.weighted(PRODUCERS.map((p) => [p, p.w]));
  const product = fixed.product ?? rng.weighted([["final_expense", 70], ["whole_life", 18], ["term_life", 12]]);
  const effective = fixed.effective ?? addDays(localDate(createdAt), rng.int(2, 16));
  const chosen = fixed.carrier ?? pickCarrier(product, effective, rng);
  const premium = fixed.premium ?? premiumFor(product, rng);
  return {
    n, producer, createdAt,
    body: { policy_number: `${PREFIX}${String(n).padStart(4, "0")}`, insured_name: nameFor(n), carrier: chosen.name, product: PRODUCT[product], effective_date: effective, annual_premium_cents: premium, status: effective <= TODAY ? "active" : "pending", renewal_date: addYear(effective) },
  };
}

const plan = { old: [], recent: [], corebridge: [], sentinel: [] };
{
  const r = rngFor("book");
  // ~100 older policies, written 2026-01-02 to 32 days ago (the agency's contract levels start 2026-01-01).
  const start = atLocal("2026-01-02", 9, 0), end = NOW - 32 * DAY;
  for (let i = 0; i < 100; i += 1) {
    const at = start + Math.floor(r.next() * (end - start));
    const day = localDate(at);
    plan.old.push(makePolicy(1 + i, atLocal(day, r.int(9, 17), r.int(0, 59)), r));
  }
  // ~34 written in the last 30 days, entered one by one.
  for (let i = 0; i < 34; i += 1) {
    const at = NOW - Math.floor(r.next() * 29.5 * DAY);
    const day = localDate(at);
    const when = Math.min(atLocal(day, r.int(9, 18), r.int(0, 59)), NOW - 30 * MIN);
    plan.recent.push(makePolicy(201 + i, when, r));
  }
  // The reviewed Corebridge statement's book: six issued in September (four paid in full, two short),
  // and two issued in late July / early August that the September statement never paid.
  const core = carrier("corebridge");
  [["2026-09-02", 168000], ["2026-09-05", 126000], ["2026-09-09", 210000], ["2026-09-12", 144000], ["2026-09-18", 186000], ["2026-09-24", 132000], ["2026-07-24", 145000], ["2026-08-04", 210000]]
    .forEach(([effective, premium], i) => plan.corebridge.push(makePolicy(301 + i, atLocal(addDays(effective, -7), 11, 15 + i), r, { product: "whole_life", carrier: core, effective, premium, producer: PRODUCERS[i % 3] })));
  // The Sentinel Security Life statement still in review: four September policies.
  const ssl = carrier("sentinel_security_life");
  [["2026-09-04", 156000], ["2026-09-11", 99000], ["2026-09-17", 204000], ["2026-09-22", 118800]]
    .forEach(([effective, premium], i) => plan.sentinel.push(makePolicy(321 + i, atLocal(addDays(effective, -6), 14, 5 + i), r, { product: "whole_life", carrier: ssl, effective, premium, producer: PRODUCERS[(i + 1) % 3] })));
}
const ALL_POLICIES = [...plan.old, ...plan.recent, ...plan.corebridge, ...plan.sentinel];

// Year-one figures the book expects (the rate card: Corebridge whole life 45%, SSL 50%, 75% advance).
const advanceOf = (premium, rateBp) => Math.round(Math.round((premium * rateBp) / 10000) * 0.75);
const STATEMENTS = [
  {
    key: "corebridge", carrierCode: "corebridge", decide: true, rateBp: 4500,
    fileName: "Corebridge_Commission_Statement_2026-09.csv", periodStart: "2026-09-01", periodEnd: "2026-09-30",
    lines: () => [
      ...plan.corebridge.slice(0, 6).map((p, i) => {
        const full = advanceOf(p.body.annual_premium_cents, 4500);
        // Lines 2 and 5 are short: the carrier advanced 60% of the year-one commission, not 75%.
        const paid = i === 1 || i === 4 ? Math.round(Math.round((p.body.annual_premium_cents * 4500) / 10000) * 0.6) : full;
        return { policy: p.body.policy_number, insured: p.body.insured_name, amount: paid, kind: "Advance", date: addDays(p.body.effective_date, 6) };
      }),
      { policy: "CB-7730415", insured: "Ignatius Fairweather", amount: 3125, kind: "Commission", date: "2026-09-30" },
    ],
  },
  {
    key: "sentinel", carrierCode: "sentinel_security_life", decide: false, rateBp: 5000,
    fileName: "SSL_Agent_Statement_September_2026.csv", periodStart: "2026-09-01", periodEnd: "2026-09-30",
    lines: () => plan.sentinel.map((p) => ({ policy: p.body.policy_number, insured: p.body.insured_name, amount: advanceOf(p.body.annual_premium_cents, 5000), kind: "Advance", date: addDays(p.body.effective_date, 8) })),
  },
];
const STATEMENT_MAPPING = { policyNumber: "Policy Number", insuredName: "Insured", amount: "Commission Amount", kind: "Transaction Type", lineDate: "Paid Date" };
const csvOf = (lines) => ["Policy Number,Insured,Transaction Type,Commission Amount,Paid Date", ...lines.map((l) => `${l.policy},${l.insured},${l.kind},${(l.amount / 100).toFixed(2)},${l.date}`)].join("\r\n") + "\r\n";

// Lapse signals on in-force, advanced policies written two to eight months ago; two more end lapsed.
const SIGNAL_NOTES = {
  returned_payment: ["Draft returned NSF; client changing banks this week.", "Payment returned, account closed. Left a voicemail.", "Returned payment on the 3rd; daughter handles her bills now."],
  missed_draft: ["Missed the draft; client says the bank moved her deposit date.", "No draft this month; card on file expired."],
  service_call: ["Called the carrier asking how to cancel; wants a cheaper option.", "Client asked about lowering the face amount to cut the premium."],
};

// ── pending cases (LA-3) ─────────────────────────────────────────────────────────────────────────
// bucket: awaiting (submitted, no reference yet) · issued (closed issued, number not in yet) ·
// client (requirement waiting on the client) · carrier (requirement waiting on the carrier) ·
// offer (counteroffer waiting on the client; the first two expire inside five days).
const CASES = [
  { bucket: "awaiting", product: "final_expense", carrier: "aflac", face: 1500000, monthly: 6240, daysAgo: 3 },
  { bucket: "awaiting", product: "term_life", carrier: "transamerica", face: 25000000, monthly: 4890, daysAgo: 5 },
  { bucket: "awaiting", product: "final_expense", carrier: "americo", face: 1000000, monthly: 4975, daysAgo: 1 },
  { bucket: "issued", product: "final_expense", carrier: "american_home_life", face: 2000000, monthly: 8125, daysAgo: 16 },
  { bucket: "issued", product: "whole_life", carrier: "sentinel_security_life", face: 2500000, monthly: 11450, daysAgo: 21 },
  { bucket: "client", product: "final_expense", carrier: "aetna", face: 1500000, monthly: 7020, daysAgo: 22, req: ["phone_interview", "Carrier phone interview: client has not called back to schedule it.", 18] },
  { bucket: "client", product: "term_life", carrier: "foresters", face: 30000000, monthly: 5610, daysAgo: 15, req: ["voice_verification", "Voice signature still needed from the client.", 12] },
  { bucket: "client", product: "final_expense", carrier: "americo", face: 800000, monthly: 4410, daysAgo: 8, req: ["missing_info", "Second beneficiary's date of birth missing on the application.", 4] },
  { bucket: "client", product: "whole_life", carrier: "sentinel_security_life", face: 2000000, monthly: 9875, daysAgo: 6, req: ["amendment", "Client must sign an amendment correcting the height and weight.", 2] },
  { bucket: "carrier", product: "term_life", carrier: "national_life", face: 50000000, monthly: 7650, daysAgo: 19, req: ["aps", "APS requested from Dr. Hensley's office (cardiology).", 14, "carrier"] },
  { bucket: "offer", product: "final_expense", carrier: "aflac", face: 2000000, monthly: 8840, daysAgo: 12, offer: { tier: "graded", monthly: 10260, reason: "Graded benefit: insulin use within the last two years.", expiresInDays: 2 } },
  { bucket: "offer", product: "term_life", carrier: "transamerica", face: 25000000, monthly: 5120, daysAgo: 10, offer: { health: "Standard Plus", monthly: 6380, reason: "Rated Standard Plus for blood pressure readings at the paramed exam.", expiresInDays: 4 } },
  { bucket: "offer", product: "final_expense", carrier: "aetna", face: 1200000, monthly: 5430, daysAgo: 6, offer: { tier: "modified", monthly: 6985, reason: "Modified benefit: COPD diagnosis in the prescription history.", expiresInDays: 9 } },
].map((c, i) => ({ ...c, n: i + 1, caseId: uid(`case:${i + 1}`), quoteId: uid(`quote:${i + 1}`), appId: uid(`attempt:${i + 1}`), subId: uid(`submission:${i + 1}`), producer: PRODUCERS[i % 3] }));

// The owner's own appointments (booked by the setters) for "Your close-out · 30 days".
const OWNER_APPTS = [[27, 10, "showed"], [24, 14, "showed"], [20, 11, "no_show"], [17, 15, "showed"], [13, 9, "showed"], [9, 13, "no_show"], [6, 16, "showed"], [1, 10, null], [0, 9, null]]
  .map(([daysAgo, hour, outcome], i) => ({ id: uid(`owner-appointment:${i + 1}`), daysAgo, hour, outcome, setter: SETTERS[i % 3], n: i + 1 }));

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// remove
// ═════════════════════════════════════════════════════════════════════════════════════════════════
if (REMOVE) {
  const say = (line) => console.log(`${DRY ? "[dry run] " : ""}${line}`);
  const appts = must(await db.from("tenant_appointments").select("id").eq("tenant_id", TENANT_ID).in("id", OWNER_APPTS.map((a) => a.id)), "read appointments");
  if (!DRY && appts.length) must(await db.from("tenant_appointments").delete().eq("tenant_id", TENANT_ID).in("id", appts.map((a) => a.id)), "remove appointments");
  say(`appointments: ${appts.length} removed`);

  const cases = must(await db.from("tenant_application_cases").select("id").eq("tenant_id", TENANT_ID).in("id", CASES.map((c) => c.caseId)), "read cases");
  if (!DRY && cases.length) must(await db.from("tenant_application_cases").delete().eq("tenant_id", TENANT_ID).in("id", cases.map((c) => c.id)), "remove cases");
  say(`pending cases: ${cases.length} removed (their quote, attempt, submission, requirements and counteroffers go with them)`);

  const statements = must(await db.from("tenant_commission_statements").select("id, status, original_filename").eq("tenant_id", TENANT_ID).in("original_filename", STATEMENTS.map((s) => s.fileName)), "read statements");
  for (const s of statements.filter((row) => row.status !== "voided")) {
    if (!DRY) await apiOk(OWNER, "PATCH", `/api/app/statements/${s.id}`, { action: "void", reason: `${TAG}: removed` }, `void ${s.original_filename}`);
  }
  say(`statements: ${statements.filter((row) => row.status !== "voided").length} voided (statements are never deleted)`);

  const policies = must(await db.from("tenant_policies").select("id, policy_number").eq("tenant_id", TENANT_ID).like("policy_number", `${PREFIX}%`), "read policies");
  const ids = policies.map((p) => p.id);
  const held = new Set();
  for (let i = 0; i < ids.length; i += 200) {
    const part = ids.slice(i, i + 200);
    for (const m of must(await db.from("tenant_commission_statement_matches").select("policy_id").eq("tenant_id", TENANT_ID).in("policy_id", part), "read matches")) held.add(m.policy_id);
    for (const d of must(await db.from("tenant_commission_discrepancies").select("policy_id").eq("tenant_id", TENANT_ID).in("policy_id", part), "read findings")) held.add(d.policy_id);
  }
  const free = ids.filter((id) => !held.has(id));
  for (let i = 0; i < free.length; i += 200) {
    if (!DRY) must(await db.from("tenant_policies").delete().eq("tenant_id", TENANT_ID).in("id", free.slice(i, i + 200)), "remove policies");
  }
  say(`policies: ${free.length} removed (their lapse signals go with them); ${held.size} kept because a statement line or a finding points at them`);
  if (held.size || statements.length) {
    const kept = policies.filter((p) => held.has(p.id)).map((p) => `'${p.policy_number}'`).join(", ");
    console.log(`
-- To remove the rest, run this in the Supabase SQL editor (all or nothing):
begin;
do $$
declare v_t constant uuid := '${TENANT_ID}';
begin
  delete from public.tenant_commission_discrepancies d using public.tenant_policies p
   where d.tenant_id = v_t and p.id = d.policy_id and p.tenant_id = v_t and p.policy_number like '${PREFIX}%';
  delete from public.tenant_commission_statement_matches m using public.tenant_commission_statement_lines l, public.tenant_commission_statements s
   where m.tenant_id = v_t and l.id = m.line_id and s.id = l.statement_id and s.tenant_id = v_t
     and s.original_filename in (${STATEMENTS.map((s) => `'${s.fileName}'`).join(", ")});
  delete from public.tenant_commission_statement_lines l using public.tenant_commission_statements s
   where l.tenant_id = v_t and s.id = l.statement_id and s.tenant_id = v_t
     and s.original_filename in (${STATEMENTS.map((s) => `'${s.fileName}'`).join(", ")});
  delete from public.tenant_commission_statements
   where tenant_id = v_t and original_filename in (${STATEMENTS.map((s) => `'${s.fileName}'`).join(", ")});
  delete from public.tenant_policies where tenant_id = v_t and policy_number like '${PREFIX}%';
  if exists (select 1 from public.tenant_policies where tenant_id = v_t and policy_number like '${PREFIX}%') then
    raise exception 'policies left behind; rolled back';
  end if;
end $$;
commit;
-- (policies it removes: ${kept || "none"})`);
  }
  process.exit(0);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// seed
// ═════════════════════════════════════════════════════════════════════════════════════════════════
const tally = {};
const count = (key, by = 1) => { tally[key] = (tally[key] ?? 0) + by; };

// ── 1. policies, through POST /api/app/policies ──────────────────────────────────────────────────
async function existingPolicies() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = must(await db.from("tenant_policies").select("id, policy_number, status, created_at, created_by").eq("tenant_id", TENANT_ID).like("policy_number", `${PREFIX}%`).order("policy_number").range(from, from + 999), "read policies");
    rows.push(...page);
    if (page.length < 1000) return new Map(rows.map((r) => [r.policy_number, r]));
  }
}
let have = await existingPolicies();
const missing = ALL_POLICIES.filter((p) => !have.has(p.body.policy_number));
const bulk = missing.filter((p) => plan.old.includes(p));
const oneByOne = missing.filter((p) => !plan.old.includes(p));
if (!DRY) {
  // The older book: what each producer brought over, as one CSV import each.
  for (const producer of PRODUCERS) {
    const mine = bulk.filter((p) => p.producer === producer).map((p) => p.body);
    if (mine.length) await apiOk(producer, "POST", "/api/app/policies", { policies: mine }, `import ${producer.email}'s book`);
  }
  // The rest, entered by hand, oldest first.
  for (const p of oneByOne.sort((a, b) => a.createdAt - b.createdAt)) await apiOk(p.producer, "POST", "/api/app/policies", p.body, `enter ${p.body.policy_number}`);
  have = await existingPolicies();
  // Back-date created_at (the API stamps now) — the only raw write on the book.
  for (const p of ALL_POLICIES) {
    const row = have.get(p.body.policy_number);
    if (!row) throw new Error(`${p.body.policy_number} was not created`);
    if (Math.abs(Date.parse(row.created_at) - p.createdAt) > MIN) {
      must(await db.from("tenant_policies").update({ created_at: iso(p.createdAt) }).eq("tenant_id", TENANT_ID).eq("id", row.id), `date ${p.body.policy_number}`);
      count("policies back-dated");
    }
  }
}
count("policies new (CSV import)", bulk.length); count("policies new (entered)", oneByOne.length); count("policies already there", ALL_POLICIES.length - missing.length);

// ── 2. lapse signals, and two policies that lapsed ───────────────────────────────────────────────
{
  const r = rngFor("lapse");
  const advanced = new Set(["Aetna / CVS", "Aflac", "American Home Life", "Mutual of Omaha", "American Amicable", "Sentinel Security Life"]);
  const candidates = plan.old.filter((p) => advanced.has(p.body.carrier) && p.body.status === "active" && p.body.effective_date >= addDays(TODAY, -240) && p.body.effective_date <= addDays(TODAY, -60));
  const chosen = [];
  for (const p of candidates) { if (chosen.length >= 7) break; if (r.chance(0.35)) chosen.push(p); }
  if (chosen.length < 7) throw new Error(`only ${chosen.length} policies qualify for lapse signals`);
  const open = chosen.slice(0, 5), lapsing = chosen.slice(5);
  const signalsOn = async (policyId) => must(await db.from("tenant_policy_lapse_signals").select("id, resolved_at").eq("tenant_id", TENANT_ID).eq("policy_id", policyId), "read signals");
  for (const [i, p] of [...open, ...lapsing].entries()) {
    const row = have.get(p.body.policy_number);
    if (DRY && !row) { count("lapse signals new"); continue; }
    if ((await signalsOn(row.id)).length) { count("lapse signals already there"); continue; }
    const kind = lapsing.includes(p) ? "missed_draft" : r.weighted([["returned_payment", 3], ["missed_draft", 2], ["service_call", 2]]);
    const body = { policyId: row.id, kind, occurredOn: addDays(TODAY, -(lapsing.includes(p) ? 40 + i : r.int(1, 13))), note: r.pick(SIGNAL_NOTES[kind]) };
    if (!DRY) await apiOk(p.producer, "POST", "/api/app/policies/lapse-risk/signals", body, `signal on ${p.body.policy_number}`);
    count("lapse signals new");
  }
  for (const p of lapsing) {
    const row = have.get(p.body.policy_number);
    if (!DRY && row && row.status === "active") {
      const current = must(await db.from("tenant_policies").select("status").eq("tenant_id", TENANT_ID).eq("id", row.id).single(), "read policy");
      if (current.status === "active") {
        await apiOk(OWNER, "PATCH", "/api/app/policies/lapse-risk/signals", { policyId: row.id, resolution: "policy_lapsed", note: "Two missed drafts; client stopped answering. Carrier confirmed lapse." }, `lapse ${p.body.policy_number}`);
        count("policies lapsed (via lapse risk)");
      }
    }
  }
}

// ── 3. two commission statements, imported and reviewed by the bookkeeper ────────────────────────
for (const s of STATEMENTS) {
  const c = carrier(s.carrierCode);
  const found = must(await db.from("tenant_commission_statements").select("id, status").eq("tenant_id", TENANT_ID).eq("carrier_id", c.id).eq("original_filename", s.fileName).neq("status", "voided"), "read statements");
  let id = found[0]?.id ?? null;
  if (!id) {
    count("statements new");
    if (DRY) continue;
    const imported = await apiOk(BOOKKEEPER, "POST", "/api/app/statements", { carrier_id: c.id, period_start: s.periodStart, period_end: s.periodEnd, file_name: s.fileName, csv_text: csvOf(s.lines()), mapping: STATEMENT_MAPPING }, `import ${s.fileName}`);
    id = imported.statementId;
  } else count("statements already there");
  if (!s.decide || DRY) continue;
  const detail = await apiOk(BOOKKEEPER, "GET", `/api/app/statements/${id}`, undefined, `read ${s.fileName}`);
  const decisions = detail.lines.flatMap((line) => {
    if (line.review === "proposed" && line.match?.method === "exact") return [{ line_id: line.id, action: "accept" }];
    if (line.review === "proposed" || line.review === "unmatched") return [{ line_id: line.id, action: "leave_unmatched" }];
    return [];
  });
  if (decisions.length) {
    const decided = await apiOk(BOOKKEEPER, "POST", `/api/app/statements/${id}/lines`, { decisions }, `review ${s.fileName}`);
    count(`statement lines decided (${s.key})`, decisions.length);
    if (decided.status !== "reviewed") console.warn(`${s.fileName} is still ${decided.status} after review`);
  }
}

// ── 4. pending cases ─────────────────────────────────────────────────────────────────────────────
{
  const existing = new Map(must(await db.from("tenant_application_cases").select("id, lead_id").eq("tenant_id", TENANT_ID).in("id", CASES.map((c) => c.caseId)), "read cases").map((r) => [r.id, r.lead_id]));
  const needLeads = CASES.filter((c) => !existing.has(c.caseId));
  let pool = [];
  if (needLeads.length) {
    const leads = [];
    for (let from = 0; ; from += 1000) {
      const page = must(await db.from("agent_leads").select("id, values").eq("tenant_id", TENANT_ID).eq("values->>qa_seed", "design2-outbound").order("id").range(from, from + 999), "read leads");
      leads.push(...page);
      if (page.length < 1000 || leads.length >= 3000) break;
    }
    const ids = leads.map((l) => l.id);
    const work = new Map(), busy = new Set();
    for (let i = 0; i < ids.length; i += 300) {
      const part = ids.slice(i, i + 300);
      for (const q of must(await db.from("lead_queue").select("id, lead_id").eq("tenant_id", TENANT_ID).in("lead_id", part), "read work items")) work.set(q.lead_id, q.id);
      for (const c of must(await db.from("tenant_callbacks").select("lead_id").eq("tenant_id", TENANT_ID).in("status", ["scheduled", "due"]).in("lead_id", part), "read callbacks")) busy.add(c.lead_id);
      for (const c of must(await db.from("tenant_application_cases").select("lead_id").eq("tenant_id", TENANT_ID).in("lead_id", part), "read cases")) busy.add(c.lead_id);
      for (const a of must(await db.from("tenant_appointments").select("lead_id").eq("tenant_id", TENANT_ID).in("lead_id", part), "read appointments")) busy.add(a.lead_id);
    }
    pool = leads.filter((l) => work.has(l.id) && !busy.has(l.id)).map((l) => ({ id: l.id, workItemId: work.get(l.id), values: l.values }));
    if (pool.length < needLeads.length) throw new Error(`only ${pool.length} free demo leads for ${needLeads.length} cases`);
  }
  const r = rngFor("cases");
  const used = new Set();
  for (const c of CASES) {
    const subAt = NOW - c.daysAgo * DAY - r.int(2, 6) * HOUR;
    const openedAt = subAt - r.int(1, 3) * HOUR;
    if (!existing.has(c.caseId)) {
      let lead;
      do { lead = pool[Math.floor(r.next() * pool.length)]; } while (used.has(lead.id));
      used.add(lead.id);
      const v = lead.values ?? {};
      const cr = carrier(c.carrier);
      const state = String(v.state ?? "TX").toUpperCase();
      if (DRY) { count("pending cases new"); continue; }
      must(await db.from("tenant_application_cases").upsert({ id: c.caseId, tenant_id: TENANT_ID, lead_id: lead.id, work_item_id: lead.workItemId, product_line: c.product, source: "outbound", status: "open", opened_by: c.producer.id, opened_at: iso(openedAt), updated_at: iso(subAt) }, { onConflict: "id", ignoreDuplicates: true }), "insert case");
      must(await db.from("tenant_quotes").upsert({
        id: c.quoteId, tenant_id: TENANT_ID, case_id: c.caseId, lead_id: lead.id, insured_role: "primary", carrier_id: cr.id, product_code: c.product,
        tier: c.product === "final_expense" ? "level" : null, face_amount_cents: c.face, monthly_premium_cents: c.monthly, annual_premium_cents: c.monthly * 12,
        term_length: c.product === "term_life" ? 20 : null, assumed_health_class: c.product === "final_expense" ? null : "Preferred",
        rating_inputs: { state, tier: c.product === "final_expense" ? "level" : undefined, face_amount: c.face, term_length: c.product === "term_life" ? 20 : undefined, gender: v.gender ?? undefined },
        status: "selected", created_by: c.producer.id, created_at: iso(openedAt + 20 * MIN), updated_at: iso(openedAt + 25 * MIN),
      }, { onConflict: "id", ignoreDuplicates: true }), "insert quote");
      must(await db.from("tenant_applications").upsert({
        id: c.appId, tenant_id: TENANT_ID, case_id: c.caseId, lead_id: lead.id, insured_role: "primary", attempt_no: 1, carrier_id: cr.id, product_code: c.product, quote_id: c.quoteId,
        status: "submitted", draft_day: r.pick([1, 3, 5, 15, 20]), created_by: c.producer.id, created_at: iso(openedAt), updated_at: iso(subAt), submitted_at: iso(subAt),
      }, { onConflict: "id", ignoreDuplicates: true }), "insert attempt");
      must(await db.from("tenant_quotes").update({ application_id: c.appId }).eq("tenant_id", TENANT_ID).eq("id", c.quoteId), "link quote");
      const reference = c.bucket === "awaiting" ? null : `${cr.code.slice(0, 2).toUpperCase()}-${String(r.int(1000000, 9999999))}`;
      must(await db.from("tenant_application_submissions").upsert({
        id: c.subId, tenant_id: TENANT_ID, application_id: c.appId, attempt_no: 1, carrier_id: cr.id, carrier_reference: reference, reference_kind: reference ? "application_no" : null,
        submitted_at: iso(subAt), submitted_via: "carrier_portal_manual", qa_verdict: { verdict: "pass", passed: [], blocking: [], warnings: [], seeded: true }, health_snapshot: {},
        notes: `${TAG}: submitted without the guided application, so this QA verdict is a placeholder.`, created_by: c.producer.id, created_at: iso(subAt),
      }, { onConflict: "id", ignoreDuplicates: true }), "insert submission");
      count("pending cases new");
    } else count("pending cases already there");
    if (DRY) continue;

    // What happened after submission, through the product's own routes, as the producer.
    const app = must(await db.from("tenant_applications").select("status").eq("tenant_id", TENANT_ID).eq("id", c.appId).single(), "read attempt");
    const base = `/api/app/applications/attempts/${c.appId}`;
    if (c.req) {
      const reqs = must(await db.from("tenant_application_requirements").select("id").eq("tenant_id", TENANT_ID).eq("application_id", c.appId), "read requirements");
      if (!reqs.length) {
        const [kind, description, raisedDaysAgo, waitingOn = "client"] = c.req;
        const raised = addDays(TODAY, -raisedDaysAgo);
        await apiOk(c.producer, "POST", `${base}/requirements`, { kind, description, waiting_on: waitingOn, raised_at: raised, due_at: addDays(raised, 14) }, `requirement on case ${c.n}`);
        count("requirements raised");
      }
    }
    if (c.offer) {
      const offers = must(await db.from("tenant_application_counteroffers").select("id").eq("tenant_id", TENANT_ID).eq("application_id", c.appId), "read counteroffers");
      if (!offers.length) {
        const receivedAt = NOW - Math.max(1, c.daysAgo - 3) * DAY;
        await apiOk(c.producer, "POST", `${base}/counteroffers`, {
          offered_tier: c.offer.tier ?? null, offered_health_class: c.offer.health ?? null, offered_face_cents: c.face, offered_monthly_premium_cents: c.offer.monthly,
          reason_text: c.offer.reason, received_at: iso(receivedAt), expires_at: iso(NOW + c.offer.expiresInDays * DAY - 3 * HOUR),
        }, `counteroffer on case ${c.n}`);
        count("counteroffers recorded");
      }
    }
    if (c.bucket === "issued" && app.status !== "closed") {
      await apiOk(c.producer, "POST", `${base}/transition`, { to: "closed", outcome: "issued", issued_on: addDays(TODAY, -Math.max(1, c.daysAgo - 9)) }, `issue case ${c.n}`);
      count("cases marked issued");
    }
  }
}

// ── 5. the owner's own appointments ──────────────────────────────────────────────────────────────
{
  const leads = must(await db.from("agent_leads").select("id, values").eq("tenant_id", TENANT_ID).eq("values->>qa_seed", "design2-outbound").order("id").range(1000, 1400), "read leads");
  for (const a of OWNER_APPTS) {
    const lead = leads[(a.n * 37) % leads.length];
    const startsAt = atLocal(localDate(NOW - a.daysAgo * DAY), a.hour, 30);
    if (startsAt + 30 * MIN > NOW) continue; // not held yet: not part of the close-out
    const row = { id: a.id, tenant_id: TENANT_ID, lead_id: lead.id, agent_user_id: OWNER.id, booked_by: a.setter.id, starts_at_utc: iso(startsAt), duration_minutes: 30, buffer_minutes: 10, customer_timezone: "America/Chicago", status: "booked", notes: "Owner call: wants to compare final expense and a small whole life policy.", created_at: iso(startsAt - 2 * DAY), seat: 1 };
    if (DRY) { count("owner appointments planned"); continue; }
    const result = await db.from("tenant_appointments").upsert(row, { onConflict: "id", ignoreDuplicates: true }).select("id");
    if (result.error?.code === "23P01") { count("owner appointments skipped (already booked then)"); continue; }
    const inserted = must(result, "insert owner appointment");
    if (!inserted.length) { count("owner appointments already there"); continue; }
    count("owner appointments new");
    if (a.outcome) {
      must(await db.rpc("mark_appointment_outcome", { p_tenant_id: TENANT_ID, p_appointment_id: a.id, p_actor: OWNER.id, p_outcome: a.outcome }), `outcome ${a.outcome}`);
      count("owner appointments closed out");
    }
  }
}

// ── what the dashboard should now read ──────────────────────────────────────────────────────────
if (!DRY) {
  const since = iso(NOW - 30 * DAY);
  const recent = must(await db.from("tenant_policies").select("annual_premium_cents").eq("tenant_id", TENANT_ID).gte("created_at", since), "read recent");
  const active = await db.from("tenant_policies").select("id", { count: "exact", head: true }).eq("tenant_id", TENANT_ID).eq("status", "active");
  console.log(`policies written in 30 days: ${recent.length}, ${usd(recent.reduce((t, p) => t + Number(p.annual_premium_cents), 0))} annual premium; ${active.count ?? "?"} active in the book`);
}
if (DRY) {
  const recent = ALL_POLICIES.filter((p) => p.createdAt >= NOW - 30 * DAY);
  console.log(`[dry run] planned: ${ALL_POLICIES.length} policies, ${recent.length} written in 30 days (${usd(recent.reduce((t, p) => t + p.body.annual_premium_cents, 0))}); statements ${STATEMENTS.map((s) => `${s.fileName} ${s.lines().length} lines`).join(", ")}; ${CASES.length} pending cases`);
}
console.log(`${DRY ? "[dry run] " : ""}${Object.entries(tally).map(([k, v]) => `${k}: ${v}`).join("; ")}`);
