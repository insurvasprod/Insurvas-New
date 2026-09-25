/**
 * Module 1 (inbound) demo data for the pre-demo QA pass — tenant "LA-1.25 Alert Demo" only.
 *
 *   node --env-file=.env.local scripts/seed-qa-inbound.mjs --dry-run      # counts only, writes nothing
 *   node --env-file=.env.local scripts/seed-qa-inbound.mjs                # insert what is missing
 *   node --env-file=.env.local scripts/seed-qa-inbound.mjs --refresh-live # also re-queue the live rows
 *
 * Idempotent: every row gets a deterministic id derived from a natural key ("qa-m1:lead:0001"), or is
 * found by its natural key (partner names "QA · …", emails @qa-demo.insurvas.test). Existing rows are
 * KEPT, never overwritten, so a second run inserts 0. Rows are tagged qa_seed:"design1-m1" wherever a
 * jsonb metadata / values / payload column exists.
 *
 * Product paths used where they enforce invariants: create_partner_with_limits,
 * transition_partner_with_limits, add_partner_term, set_partner_product_approval,
 * partner_invite_user_with_auth (+ auth.admin.createUser), partner_set_user_status_with_limit,
 * admin_apply_tenant_template / admin_update_tenant_template, find_existing_customer_preflight,
 * claim_transfer_lead, update_verification_field, offer_buffer_handoff, accept_buffer_handoff,
 * refresh_tenant_entitlement. History (30 days back) cannot go through those functions (they stamp
 * now()), so historical leads, work items, calls, verification sessions, deal-flow rows, cards,
 * dispositions, callbacks and SLA ladder rows are written directly, exactly as intake.ts,
 * claim_transfer_lead, complete_disposition(_with_callback) and run_unclaimed_sla write them.
 *
 * Nothing here sends email, SMS, push, telephony or Whop traffic, sets a session GUC, or runs DDL.
 * Agent alerts (notifyTenantAgents / notifyPartnerUsers) and usage metering are skipped on purpose.
 *
 * LIVE ROWS: the 8 "unclaimed right now" transfers are queued 0:30–16:00 before the run and the 5
 * live work items are claimed at run time. The pg_cron SLA ladder expires unclaimed transfers after
 * the tenant's expire threshold and a pending handoff times out after 5 minutes, so re-run with
 * --refresh-live right before a demo to re-queue / re-claim them.
 */
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";

const DRY = process.argv.includes("--dry-run");
const REFRESH = process.argv.includes("--refresh-live");
const TAG = "design1-m1";
const T = "d6f3950f-0d88-4e66-869f-0de2ea6b396b";
const TENANT_NAME = "LA-1.25 Alert Demo";
const RAY_EMAIL = "demo.agent@insurvas.test";
const DEMO_PARTNER = "97b4adf7-06f5-40f3-a952-d7c09d2ef6cb";
const TL_PLATFORM_TEMPLATE = "fff9c3ac-7354-4aa5-8f6c-aa717e0d9257";
const NOW = new Date();
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString();
const ago = (ms) => iso(NOW.getTime() - ms);

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

// ── bookkeeping ─────────────────────────────────────────────────────────────────────────────────
const stats = new Map();
const problems = [];
function stat(table, kind, n = 1) {
  const row = stats.get(table) ?? { inserted: 0, updated: 0, kept: 0 };
  row[kind] += n;
  stats.set(table, row);
}
function problem(section, error) {
  const message = error instanceof Error ? error.message : typeof error === "object" ? [error?.message, error?.details, error?.hint, error?.code].filter(Boolean).join(" · ") : String(error);
  problems.push(`${section}: ${message}`);
  console.error(`  ! ${section}: ${message}`);
}
async function section(name, fn) {
  console.log(`- ${name}`);
  try { await fn(); } catch (error) { problem(name, error); }
}
function must(result, label) {
  if (result.error) throw new Error(`${label}: ${[result.error.message, result.error.details, result.error.hint].filter(Boolean).join(" · ")}`);
  return result.data;
}

/** Deterministic RFC-4122-shaped (v5) uuid from a natural key. */
function uid(key) {
  const h = createHash("sha1").update(`qa-m1:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
/** Deterministic pseudo-random in [0,1) per key, so a re-run computes the same plan. */
function rnd(key) { return parseInt(createHash("md5").update(key).digest("hex").slice(0, 8), 16) / 0x100000000; }
const pick = (key, list) => list[Math.floor(rnd(key) * list.length)];
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

/** Insert the rows whose id is missing; count the rest as kept. */
async function ensure(table, rows, { pk = "id" } = {}) {
  if (!rows.length) return;
  const existing = new Set();
  for (const part of chunks(rows.map((row) => row[pk]), 150)) {
    const found = must(await db.from(table).select(pk).in(pk, part), `${table} lookup`);
    for (const row of found ?? []) existing.add(row[pk]);
  }
  const missing = rows.filter((row) => !existing.has(row[pk]));
  stat(table, "kept", rows.length - missing.length);
  if (!missing.length) return;
  if (!DRY) for (const part of chunks(missing, 100)) must(await db.from(table).insert(part, { defaultToNull: false }), `${table} insert`);
  stat(table, "inserted", missing.length);
}
/** Same, for composite keys (few rows): match on every column in `keys`. */
async function ensureComposite(table, rows, keys) {
  for (const row of rows) {
    let query = db.from(table).select(keys[0]);
    for (const key of keys) query = query.eq(key, row[key]);
    const found = must(await query.limit(1), `${table} lookup`);
    if (found?.length) { stat(table, "kept"); continue; }
    if (!DRY) must(await db.from(table).insert(row), `${table} insert`);
    stat(table, "inserted");
  }
}
/** Audit rows are append-only; they are found again by metadata.qa_key. */
const auditKeys = new Set();
async function loadAuditKeys() {
  let from = 0;
  for (;;) {
    const rows = must(await db.from("audit_log").select("metadata").eq("metadata->>qa_seed", TAG).range(from, from + 999), "audit lookup");
    for (const row of rows ?? []) auditKeys.add(row.metadata?.qa_key);
    if (!rows || rows.length < 1000) break;
    from += 1000;
  }
}
const pendingAudit = [];
function audit(key, row) {
  if (auditKeys.has(key)) { stat("audit_log", "kept"); return; }
  auditKeys.add(key);
  pendingAudit.push({ actor_type: "tenant", ...row, metadata: { ...(row.metadata ?? {}), tenantId: T, qa_seed: TAG, qa_key: key } });
}
async function flushAudit() {
  if (!pendingAudit.length) return;
  if (!DRY) for (const part of chunks(pendingAudit, 200)) must(await db.from("audit_log").insert(part), "audit insert");
  stat("audit_log", "inserted", pendingAudit.length);
  pendingAudit.length = 0;
}
async function rpc(name, args) { return must(await db.rpc(name, args), name); }

/** "2026-09-25" for an instant in a time zone (intakeLocalDate). */
function localDate(ms, timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
/** UTC instant for a wall-clock time in a zone (DST-safe enough for demo data). */
function zoned(dateStr, hh, mm, timeZone) {
  const guess = Date.parse(`${dateStr}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess));
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  const asLocal = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return guess - (asLocal - guess);
}

// ── context ─────────────────────────────────────────────────────────────────────────────────────
const ctx = {};

async function loadContext() {
  const tenant = must(await db.from("tenants").select("id, name").eq("id", T).maybeSingle(), "tenant");
  if (!tenant || tenant.name !== TENANT_NAME) throw new Error(`Refusing to run: tenant ${T} is not "${TENANT_NAME}"`);
  const ray = must(await db.from("users").select("id, name").eq("email", RAY_EMAIL).maybeSingle(), "ray");
  if (!ray) throw new Error("demo.agent@insurvas.test is missing");
  ctx.ray = ray;
  const members = must(await db.from("tenant_users").select("role, accepted_at, users!tenant_users_user_id_fkey(id, email, name, status)").eq("tenant_id", T), "members");
  const qa = members.filter((m) => m.users?.email?.endsWith("@qa-demo.insurvas.test") && m.accepted_at && m.users.status === "active")
    .map((m) => ({ id: m.users.id, email: m.users.email, name: m.users.name, role: m.role }))
    .sort((a, b) => a.email.localeCompare(b.email));
  const producers = qa.filter((m) => m.role === "producer");
  ctx.la = producers.find((m) => m.email.startsWith("marisol.")) ?? producers[0];
  const assistants = qa.filter((m) => m.role === "assistant");
  // Buffer 1 English, buffer 2 Spanish (by agent_capacity.languages), buffer 3 = whoever else exists.
  ctx.buffers = assistants;
  if (!ctx.la) throw new Error("No active licensed (producer) @qa-demo.insurvas.test member to reuse");
  if (assistants.length < 2) throw new Error("Fewer than two active assistant (buffer) @qa-demo.insurvas.test members to reuse");
  ctx.spare = producers.find((m) => m.id !== ctx.la.id) ?? null;
  const pipelines = must(await db.from("tenant_pipelines").select("id, partner_type").eq("tenant_id", T).eq("is_default", true), "pipelines");
  const stages = must(await db.from("tenant_pipeline_stages").select("id, pipeline_id, name, position, is_archived").in("pipeline_id", pipelines.map((p) => p.id)), "stages");
  const entry = (type, name) => {
    const pipeline = pipelines.find((p) => p.partner_type === type);
    const stage = stages.find((s) => s.pipeline_id === pipeline?.id && s.name === name && !s.is_archived);
    if (!stage) throw new Error(`No "${name}" stage on the default ${type} pipeline`);
    return { pipeline_id: pipeline.id, stage_id: stage.id };
  };
  ctx.entry = { publisher: entry("publisher", "Partner Submitted"), marketing: entry("marketing", "Form Lead"), affiliate: entry("affiliate", "Referred") };
  const mapped = must(await db.from("stage_dispositions").select("stage_id, disposition_key").eq("tenant_id", T), "stage map");
  const allStages = must(await db.from("tenant_pipeline_stages").select("id, pipeline_id, is_archived"), "all stages");
  ctx.dispositionStage = new Map(mapped.map((row) => {
    const stage = allStages.find((s) => s.id === row.stage_id && !s.is_archived);
    return [row.disposition_key, stage ? { stage_id: stage.id, pipeline_id: stage.pipeline_id } : null];
  }));
  ctx.dispositions = new Map(must(await db.from("dispositions").select("disposition_key, label, closes_as").eq("tenant_id", T).eq("is_active", true), "dispositions").map((d) => [d.disposition_key, d]));
  const sla = must(await db.from("tenant_queue_sla_settings").select("*").eq("tenant_id", T).maybeSingle(), "sla");
  ctx.sla = { warn: sla?.warn_after_seconds ?? 45, escalate: sla?.escalate_after_seconds ?? 120, partner: sla?.partner_notify_after_seconds ?? 300, expire: sla?.expire_after_seconds ?? 14400 };
  const carriers = must(await db.from("carriers").select("id, name"), "carriers");
  ctx.carrierName = new Map(carriers.map((c) => [c.id, c.name]));
  const appts = must(await db.from("appointments").select("carrier_id, state, status").eq("tenant_id", T).eq("status", "active"), "appointments");
  const activeCarriers = new Set(must(await db.from("tenant_carriers").select("carrier_id").eq("tenant_id", T).eq("is_active", true), "tenant carriers").map((r) => r.carrier_id));
  ctx.markets = appts.filter((a) => activeCarriers.has(a.carrier_id));
  await loadAuditKeys();
  console.log(`tenant ${tenant.name} · Ray ${ray.id} · licensed ${ctx.la.name} · buffers ${ctx.buffers.map((b) => b.name).join(", ")} · SLA ${JSON.stringify(ctx.sla)}${DRY ? " · DRY RUN" : ""}${REFRESH ? " · REFRESH LIVE" : ""}`);
}

// ── D1 · team ───────────────────────────────────────────────────────────────────────────────────
async function seedTeam() {
  // Nobody new joins the tenant: Ray (owner), the licensed agent and the buffer agents are reused
  // @qa-demo.insurvas.test members, so the seat count does not move. The Spanish speaker is recorded
  // where the floor reads it (agent_capacity.languages), as a NEW row; an existing row is kept.
  const [english, spanish] = ctx.buffers;
  ctx.bufferEn = english;
  ctx.bufferEs = spanish;
  ctx.bufferX = ctx.buffers[2] ?? english;
  await ensureComposite("agent_capacity", [{ tenant_id: T, user_id: spanish.id, languages: ["spanish", "english"] }], ["tenant_id", "user_id"]);
  await ensureComposite("agent_capacity", [{ tenant_id: T, user_id: english.id, languages: ["english"] }], ["tenant_id", "user_id"]);
  // Mixed presence, inserted only where a person has no presence row yet.
  const presence = [
    { user_id: ctx.la.id, status: "on_call" },
    { user_id: english.id, status: "on_call" },
    { user_id: spanish.id, status: "on_call" },
    ...(ctx.spare ? [{ user_id: ctx.spare.id, status: "on_break" }] : []),
  ].map((row) => ({ tenant_id: T, ...row, last_seen_at: iso(NOW.getTime()) }));
  await ensureComposite("agent_presence", presence, ["tenant_id", "user_id"]);
  if (REFRESH && !DRY) {
    const mine = presence.map((p) => p.user_id);
    must(await db.from("agent_presence").update({ last_seen_at: iso(Date.now()) }).eq("tenant_id", T).in("user_id", mine), "presence refresh");
    stat("agent_presence", "updated", mine.length);
  }
}

// ── D3 · products and forms ─────────────────────────────────────────────────────────────────────
const US = ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"];
const STAGES = [
  { stage_key: "new", label: "New", stage_type: "open", color: "#2563eb", sort_order: 1 },
  { stage_key: "contacted", label: "Contacted", stage_type: "open", color: "#7c3aed", sort_order: 2 },
  { stage_key: "submitted", label: "Submitted", stage_type: "open", color: "#0891b2", sort_order: 3 },
  { stage_key: "issued", label: "Issued", stage_type: "won", color: "#16a34a", sort_order: 4 },
  { stage_key: "declined", label: "Declined", stage_type: "lost", color: "#dc2626", sort_order: 5 },
];
const f = (field_key, label, type, is_required, sort_order, extra = {}) => ({ field_key, label, type, is_required, options: [], sort_order, help_text: null, validation: {}, ...extra });
// FE v1: 8 required fields (3 of 8 confirmed reads 38%). FE v2: 10 required (7 of 10 reads 70%).
const FE_V1_FIELDS = [
  f("first_name", "First name", "text", true, 1), f("last_name", "Last name", "text", true, 2),
  f("phone", "Phone", "phone", true, 3), f("email", "Email", "email", false, 4),
  f("date_of_birth", "Date of birth", "date", true, 5), f("state", "State", "single_select", true, 6, { options: US }),
  f("coverage_amount", "Coverage amount", "currency", true, 7), f("tobacco", "Tobacco use", "boolean", true, 8),
  f("beneficiary_name", "Beneficiary name", "text", true, 9), f("beneficiary_relationship", "Beneficiary relationship", "single_select", false, 10, { options: ["Spouse", "Child", "Sibling", "Friend", "Other"] }),
];
const FE_V2_FIELDS = [
  ...FE_V1_FIELDS.map((field) => field.field_key === "beneficiary_relationship" ? { ...field, is_required: true } : field),
  f("existing_coverage", "Has existing life coverage", "boolean", true, 11),
  f("language", "Preferred language", "single_select", false, 12, { options: ["English", "Spanish"] }),
  f("health_notes", "Health notes", "long_text", false, 13),
];
function formFor(fields) {
  const req = new Map(fields.map((field) => [field.field_key, field.is_required]));
  const sec = (section_key, label, keys, sort_order) => ({ section_key, label, sort_order, fields: keys.filter((k) => req.has(k)).map((k) => ({ field_key: k, is_required: req.get(k), show_when: null })) });
  return { sections: [
    sec("applicant", "Applicant", ["first_name", "last_name", "date_of_birth", "state", "language"], 0),
    sec("contact", "Contact", ["phone", "email"], 1),
    sec("coverage", "Coverage", ["coverage_amount", "tobacco", "existing_coverage", "health_notes"], 2),
    sec("beneficiary", "Beneficiary", ["beneficiary_name", "beneficiary_relationship"], 3),
  ].filter((s) => s.fields.length) };
}
const IUL_FIELDS = [
  f("first_name", "First name", "text", true, 1), f("last_name", "Last name", "text", true, 2),
  f("phone", "Phone", "phone", true, 3), f("date_of_birth", "Date of birth", "date", true, 4),
  f("state", "State", "single_select", true, 5, { options: US }), f("coverage_amount", "Coverage amount", "currency", false, 6),
];

async function seedProducts() {
  ctx.templates = {};
  const copies = must(await db.from("tenant_templates").select("id, product_code, definition_version, template_id, template_version").eq("tenant_id", T), "tenant templates");
  const tl = copies.find((c) => c.product_code === "term_life");
  if (!tl) throw new Error("The tenant has no Term Life form copy");
  ctx.templates.term_life = { id: tl.id, current: tl.definition_version, templateId: tl.template_id, templateVersion: tl.template_version };
  stat("tenant_templates", "kept");
  for (const [code, name, v1, v2] of [["final_expense", "Final Expense intake", FE_V1_FIELDS, FE_V2_FIELDS], ["iul", "Indexed Universal Life intake", IUL_FIELDS, null]]) {
    const existing = copies.find((c) => c.product_code === code);
    if (existing) { ctx.templates[code] = { id: existing.id, current: existing.definition_version, templateId: existing.template_id, templateVersion: existing.template_version }; stat("tenant_templates", "kept"); continue; }
    // tenant_templates is unique on (tenant, platform template, version) and the catalog holds only the
    // Term Life template (v1, already used by this tenant's TL copy), so each extra product copy is
    // sourced from it at the next free version number.
    const usedVersions = new Set(must(await db.from("tenant_templates").select("template_version").eq("tenant_id", T).eq("template_id", TL_PLATFORM_TEMPLATE), "used versions").map((r) => r.template_version));
    let sourceVersion = 1;
    while (usedVersions.has(sourceVersion)) sourceVersion += 1;
    if (DRY) { ctx.templates[code] = { id: uid(`template:${code}`), current: v2 ? 2 : 1, templateId: TL_PLATFORM_TEMPLATE, templateVersion: sourceVersion }; console.log(`  would create the ${code} form copy from template v${sourceVersion}`); stat("tenant_templates", "inserted"); stat("tenant_template_revisions", "inserted", v2 ? 2 : 1); continue; }
    // The product's own path (applyTemplate → admin_apply_tenant_template), sourced from the only
    // platform template there is (Term Life) with this product's fields; then a v2 edit.
    const id = await rpc("admin_apply_tenant_template", { p_tenant_id: T, p_template_id: TL_PLATFORM_TEMPLATE, p_template_version: sourceVersion, p_product_code: code, p_name: name, p_description: `QA demo form (${TAG})`, p_applied_by: ctx.ray.id, p_fields: v1, p_stages: STAGES, p_form_definition: formFor(v1) });
    stat("tenant_templates", "inserted"); stat("tenant_template_revisions", "inserted");
    if (v2) {
      await rpc("admin_update_tenant_template", { p_tenant_template_id: id, p_tenant_id: T, p_name: name, p_description: `QA demo form (${TAG}) · v2 adds existing coverage, language and health notes`, p_fields: v2, p_stages: STAGES, p_form_definition: formFor(v2) });
      stat("tenant_template_revisions", "inserted");
      stat("tenant_templates", "updated");
    }
    must(await db.from("tenant_templates").update({ applied_at: ago(40 * DAY), created_at: ago(40 * DAY) }).eq("id", id), "backdate template");
    must(await db.from("tenant_template_revisions").update({ created_at: ago(40 * DAY) }).eq("tenant_template_id", id).eq("revision", 1), "backdate v1");
    if (v2) must(await db.from("tenant_template_revisions").update({ created_at: ago(10 * DAY) }).eq("tenant_template_id", id).eq("revision", 2), "backdate v2");
    ctx.templates[code] = { id, current: v2 ? 2 : 1, templateId: TL_PLATFORM_TEMPLATE, templateVersion: sourceVersion };
  }
  // Which definition version a lead submitted at a given moment was on (the revision live then).
  ctx.revisions = {};
  for (const [code, copy] of Object.entries(ctx.templates)) {
    const revs = DRY && !copies.find((c) => c.product_code === code)
      ? [{ revision: 1, created_at: ago(40 * DAY) }, ...(code === "final_expense" ? [{ revision: 2, created_at: ago(10 * DAY) }] : [])]
      : must(await db.from("tenant_template_revisions").select("revision, created_at").eq("tenant_template_id", copy.id).order("revision"), "revisions");
    ctx.revisions[code] = revs.map((r) => ({ revision: r.revision, at: Date.parse(r.created_at) }));
  }
  // iul stays disabled (the tenant's existing setting); its old leads are seeded below.
  const iul = must(await db.from("tenant_products").select("is_enabled").eq("tenant_id", T).eq("product_code", "iul").maybeSingle(), "iul");
  ctx.iulDisabled = iul ? !iul.is_enabled : true;
}

// ── D4–D8 · partners, marketing, affiliates, terms, partner users ───────────────────────────────
const PARTNERS = [
  { key: "apex", name: "QA · Apex Health Partners", type: "publisher", final: "active", tz: "America/Phoenix", contact: "Dana Whitfield", products: ["final_expense", "term_life"], age: 90,
    terms: [["per_transfer", 3500, null, -90], ["per_transfer", 4000, null, 14]] },
  { key: "vertex", name: "QA · Vertex Life Transfers", type: "publisher", final: "active", tz: "America/New_York", contact: "Rafael Ortiz", products: ["final_expense"], age: 75,
    terms: [["per_transfer", 3000, null, -75], ["per_sale", 12000, null, -10]] },
  { key: "bluebird", name: "QA · Bluebird Call Center", type: "publisher", final: "paused", tz: "America/Chicago", contact: "Paula Reed", products: ["final_expense", "term_life"], age: 120,
    terms: [["per_lead", 1500, null, -120]], reason: "Paused while their consent scripts are re-reviewed" },
  { key: "northwind", name: "QA · Northwind Leads", type: "publisher", final: "offboarded", tz: "America/Denver", contact: "Victor Hale", products: ["term_life"], age: 200,
    terms: [["per_transfer", 2500, null, -200]], reason: "Contract ended; repeated DNC complaints" },
  { key: "summit", name: "QA · Summit Draft Media", type: "publisher", final: "draft", tz: "America/Los_Angeles", contact: "Mia Torres", products: [], age: 3,
    terms: [["per_lead", 1000, null, 7]] },
  { key: "harbor", name: "QA · Harbor Marketing Co", type: "marketing", final: "active", tz: "America/New_York", contact: "Tara Quinn", products: ["final_expense", "term_life"], age: 60,
    terms: [["per_lead", 1800, null, -60]] },
  { key: "seniorsavers", name: "QA · SeniorSavers Affiliate", type: "affiliate", final: "active", tz: "America/Phoenix", contact: "Grace Holt", products: ["final_expense", "term_life"], age: 55,
    terms: [["per_sale", 5000, null, -45]], links: [["qa-seniorsavers-fall-mailer", "fall-mailer", 342], ["qa-seniorsavers-facebook", "facebook-sept", 128]] },
  { key: "familyfirst", name: "QA · FamilyFirst Referrals", type: "affiliate", final: "active", tz: "America/Los_Angeles", contact: "Hank Rios", products: ["final_expense"], age: 110,
    terms: [["per_sale", 6000, null, -100], ["per_issued_policy", 7500, null, -45]], links: [["qa-familyfirst-newsletter", "newsletter", 96], ["qa-familyfirst-church", "church-bulletin", 41]] },
  { key: "quietoak", name: "QA · Quiet Oak Publishing", type: "publisher", final: "active", tz: "America/Chicago", contact: "Ellis Park", products: ["term_life"], age: 30,
    terms: [["per_transfer", 3000, null, -30]] },
];
const email = (name) => `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@qa-demo.insurvas.test`;
const PARTNER_USERS = [
  { partner: "apex", name: "Dana Whitfield", role: "partner_admin", state: "active", signIn: true },
  { partner: "apex", name: "Marcus Bell", role: "partner_user", state: "active", signIn: true },
  { partner: "apex", name: "Keisha Grant", role: "partner_user", state: "active", signIn: true },
  { partner: "apex", name: "Owen Pratt", role: "partner_user", state: "revoked" },
  { partner: "vertex", name: "Rafael Ortiz", role: "partner_admin", state: "active" },
  { partner: "vertex", name: "Nina Shah", role: "partner_user", state: "active" },
  { partner: "vertex", name: "Caleb Stone", role: "partner_user", state: "active" },
  { partner: "vertex", name: "Jade Lin", role: "partner_user", state: "pending" },
  { partner: "harbor", name: "Tara Quinn", role: "partner_admin", state: "active" },
  { partner: "harbor", name: "Leo Marsh", role: "partner_user", state: "active" },
  { partner: "harbor", name: "Ivy Chen", role: "partner_user", state: "expired" },
  { partner: "bluebird", name: "Paula Reed", role: "partner_admin", state: "active" },
  { partner: "northwind", name: "Victor Hale", role: "partner_admin", state: "active" },
  { partner: "seniorsavers", name: "Grace Holt", role: "partner_admin", state: "active" },
  { partner: "familyfirst", name: "Hank Rios", role: "partner_admin", state: "active" },
];
let PASSWORD = null;
const signInUsers = [];

async function entitlementLimits() {
  const row = must(await db.from("tenant_entitlements").select("entitlement").eq("tenant_id", T).maybeSingle(), "entitlement");
  return row?.entitlement?.limits ?? {};
}

async function seedPartners() {
  ctx.partners = {};
  const limits = await entitlementLimits();
  const existing = must(await db.from("partners").select("id, name, status, partner_type, timezone").eq("tenant_id", T).in("name", PARTNERS.map((p) => p.name)), "partners");
  for (const spec of PARTNERS) {
    const found = existing.find((p) => p.name === spec.name);
    if (found) { ctx.partners[spec.key] = { ...spec, id: found.id, status: found.status }; stat("partners", "kept"); continue; }
    stat("partners", "inserted");
    if (DRY) { ctx.partners[spec.key] = { ...spec, id: uid(`partner:${spec.key}`), status: spec.final, dry: true }; continue; }
    const created = await rpc("create_partner_with_limits", {
      p_tenant_id: T, p_name: spec.name, p_partner_type: spec.type, p_country: "US", p_contact_name: spec.contact,
      p_contact_email: email(spec.contact), p_timezone: spec.tz, p_notes: `QA demo partner (${TAG})`, p_created_by: ctx.ray.id,
      p_max_publishers: limits.max_publishers ?? null, p_max_marketing_partners: limits.max_marketing_partners ?? null, p_max_affiliates: limits.max_affiliates ?? null,
    });
    const id = (Array.isArray(created) ? created[0] : created).id;
    const createdAt = ago(spec.age * DAY);
    must(await db.from("partners").update({ metadata: { qa_seed: TAG, qa_key: `partner:${spec.key}` }, created_at: createdAt }).eq("id", id), "tag partner");
    must(await db.from("partner_channels").update({ created_at: createdAt }).eq("tenant_id", T).eq("partner_id", id).eq("channel_type", "partner"), "backdate channel");
    stat("partner_channels", "inserted");
    audit(`partner-created:${spec.key}`, { actor_id: ctx.ray.id, action: "tenant.partner_created", target_type: "partner", target_id: id, ts: createdAt, metadata: { name: spec.name, partnerType: spec.type } });
    ctx.partners[spec.key] = { ...spec, id, status: "draft", fresh: true };
    if (spec.final !== "draft") {
      await rpc("transition_partner_with_limits", { p_tenant_id: T, p_partner_id: id, p_next_status: "active", p_confirmation: null, p_max_publishers: limits.max_publishers ?? null, p_max_marketing_partners: limits.max_marketing_partners ?? null, p_max_affiliates: limits.max_affiliates ?? null, p_max_partner_users: limits.max_partner_users ?? null });
      ctx.partners[spec.key].status = "active";
      audit(`partner-activated:${spec.key}`, { actor_id: ctx.ray.id, action: "tenant.partner_lifecycle_changed", target_type: "partner", target_id: id, reason: "Contract signed, go live", ts: iso(Date.parse(createdAt) + DAY), metadata: { from: "draft", to: "active", revokedPartnerUsers: false } });
    }
    for (const code of spec.products) {
      const approved = await db.rpc("set_partner_product_approval", { p_tenant_id: T, p_partner_id: id, p_product_code: code, p_approved: true, p_approved_by: ctx.ray.id });
      if (approved.error) problem(`approve ${code} for ${spec.key}`, approved.error); else stat("partner_products", "inserted");
    }
    for (const [model, cents, bp, offsetDays] of spec.terms) {
      const effective = localDate(NOW.getTime() + offsetDays * DAY, "UTC");
      const term = await rpc("add_partner_term", { p_tenant_id: T, p_partner_id: id, p_payout_model: model, p_rate_cents: cents, p_rate_pct_bp: bp, p_effective_from: effective, p_created_by: ctx.ray.id });
      const termId = (Array.isArray(term) ? term[0] : term).id;
      stat("partner_terms", "inserted");
      audit(`partner-term:${spec.key}:${effective}`, { actor_id: ctx.ray.id, action: "tenant.partner_term_added", target_type: "partner_term", target_id: termId, reason: `Effective ${effective}`, ts: offsetDays < 0 ? iso(NOW.getTime() + offsetDays * DAY) : ago(2 * DAY), metadata: { partnerId: id, payoutModel: model, rateCents: cents, ratePctBp: bp, effectiveFrom: effective } });
    }
  }
  await flushAudit();
}

async function seedAffiliateLinks() {
  ctx.links = {};
  const rows = [];
  for (const spec of PARTNERS.filter((p) => p.links)) {
    for (const [slug, campaign, clicks] of spec.links) {
      const id = uid(`link:${slug}`);
      ctx.links[slug] = { id, campaign, partner: spec.key };
      rows.push({ id, tenant_id: T, partner_id: ctx.partners[spec.key].id, slug, campaign, is_active: true, click_count: clicks, created_at: ago((spec.age - 5) * DAY) });
    }
  }
  await ensure("affiliate_links", rows);
}

async function ensurePartnerUser(spec) {
  const partner = ctx.partners[spec.partner];
  const address = email(spec.name);
  const user = must(await db.from("users").select("id, status").eq("email", address).maybeSingle(), "partner user lookup");
  if (user) {
    const member = must(await db.from("partner_users").select("id, status").eq("partner_id", partner.id).eq("user_id", user.id).maybeSingle(), "membership");
    if (member) { stat("partner_users", "kept"); return user.id; }
  }
  stat("partner_users", "inserted");
  if (DRY || partner.dry) return uid(`user:${address}`);
  let userId = user?.id;
  if (!userId) {
    if (spec.signIn && !PASSWORD) PASSWORD = `QaDemo-${randomBytes(9).toString("base64url")}-26!`;
    const created = await db.auth.admin.createUser({ email: address, password: spec.signIn ? PASSWORD : `Invite-${randomBytes(12).toString("hex")}!`, email_confirm: true, user_metadata: { name: spec.name, full_name: spec.name, qa_seed: TAG } });
    if (created.error) throw new Error(`createUser ${address}: ${created.error.message}`);
    userId = created.data.user.id;
    stat("auth.users", "inserted");
    stat("users", "inserted");
  }
  const invitedAt = spec.state === "expired" ? ago(4 * DAY) : spec.state === "pending" ? ago(1 * DAY) : ago(Math.min(partner.age - 2, 40) * DAY);
  const expiresAt = spec.state === "expired" ? ago(1 * DAY) : spec.state === "pending" ? iso(NOW.getTime() + 2 * DAY) : iso(Date.parse(invitedAt) + 3 * DAY);
  const adminId = spec.role === "partner_user" ? ctx.partnerAdmins?.[spec.partner] ?? null : null;
  await rpc("partner_invite_user_with_auth", {
    p_auth_user_id: userId, p_tenant_id: T, p_partner_id: partner.id, p_name: spec.name, p_email: address, p_role: spec.role,
    p_partner_admin_user_id: adminId, p_token_hash: createHash("sha256").update(randomBytes(32)).digest("hex"), p_expires_at: expiresAt, p_max_partner_users: null,
  });
  stat("user_invitations", "inserted");
  must(await db.from("user_invitations").update({ created_at: invitedAt }).eq("user_id", userId).eq("partner_id", partner.id).is("accepted_at", null), "backdate invite");
  must(await db.from("partner_users").update({ invited_at: invitedAt, created_at: invitedAt, invited_by: ctx.ray.id }).eq("partner_id", partner.id).eq("user_id", userId), "backdate member");
  audit(`partner-user-invited:${address}`, { actor_id: ctx.ray.id, action: "tenant.partner_user_invited", target_type: "partner_user", target_id: userId, ts: invitedAt, metadata: { partnerId: partner.id, role: spec.role } });
  if (spec.state === "active" || spec.state === "revoked") {
    const acceptedAt = iso(Date.parse(invitedAt) + 3 * HOUR);
    must(await db.from("user_invitations").update({ accepted_at: acceptedAt }).eq("user_id", userId).eq("partner_id", partner.id).is("accepted_at", null), "accept invite");
    must(await db.from("partner_users").update({ accepted_at: acceptedAt }).eq("partner_id", partner.id).eq("user_id", userId), "accept membership");
    must(await db.from("users").update({ status: "active", active: true, must_reset_password: false, password_hash: spec.signIn ? await bcrypt.hash(PASSWORD, 12) : null }).eq("id", userId), "activate user");
    if (spec.signIn) signInUsers.push(`${address} (${spec.role}, ${partner.name})`);
  }
  if (spec.state === "revoked") {
    await rpc("partner_set_user_status_with_limit", { p_tenant_id: T, p_partner_id: partner.id, p_user_id: userId, p_status: "revoked", p_max_partner_users: null });
    audit(`partner-user-revoked:${address}`, { actor_id: ctx.ray.id, action: "tenant.partner_user_status_changed", target_type: "partner_user", target_id: userId, reason: "Left the call center", ts: ago(6 * DAY), metadata: { partnerId: partner.id, from: "active", to: "revoked" } });
  }
  return userId;
}

async function seedPartnerUsers() {
  ctx.partnerAdmins = {};
  ctx.partnerUsers = {};
  for (const spec of PARTNER_USERS) {
    try {
      const id = await ensurePartnerUser(spec);
      ctx.partnerUsers[spec.name] = id;
      if (spec.role === "partner_admin") ctx.partnerAdmins[spec.partner] = id;
    } catch (error) { problem(`partner user ${spec.name}`, error); }
  }
  await flushAudit();
  // Final lifecycle states, after users exist (offboarding revokes them and archives the channel).
  const limits = await entitlementLimits();
  for (const spec of PARTNERS) {
    const partner = ctx.partners[spec.key];
    if (!partner.fresh || spec.final === "active" || spec.final === "draft") continue;
    await rpc("transition_partner_with_limits", { p_tenant_id: T, p_partner_id: partner.id, p_next_status: spec.final, p_confirmation: spec.final === "offboarded" ? "OFFBOARD" : null, p_max_publishers: limits.max_publishers ?? null, p_max_marketing_partners: limits.max_marketing_partners ?? null, p_max_affiliates: limits.max_affiliates ?? null, p_max_partner_users: limits.max_partner_users ?? null });
    const when = spec.final === "paused" ? ago(9 * DAY) : ago(12 * DAY);
    must(await db.from("partners").update(spec.final === "paused" ? { paused_at: when } : { offboarded_at: when }).eq("id", partner.id), "backdate lifecycle");
    stat("partners", "updated");
    audit(`partner-${spec.final}:${spec.key}`, { actor_id: ctx.ray.id, action: "tenant.partner_lifecycle_changed", target_type: "partner", target_id: partner.id, reason: spec.reason, ts: when, metadata: { from: "active", to: spec.final, revokedPartnerUsers: spec.final === "offboarded" } });
    partner.status = spec.final;
  }
  await flushAudit();
}

// ── D2 · this tenant's own limits ───────────────────────────────────────────────────────────────
async function seedLimits() {
  // The tenant is on a private one-tenant plan (the agency seeder's "Advance Team (QA demo)"); its
  // plan_limits row is this tenant's own allowance. Refuse if anyone else subscribes to it. Limits
  // already set (non-null) are kept, so a re-run changes nothing.
  const planId = await rpc("tenant_current_plan", { p_tenant_id: T });
  const plan = must(await db.from("plans").select("id, code, is_public").eq("id", planId).single(), "plan");
  const subscribers = must(await db.from("subscriptions").select("tenant_id").eq("plan_id", planId), "plan subscribers");
  if (plan.is_public || subscribers.some((s) => s.tenant_id !== T)) throw new Error(`Plan ${plan.code} is not private to this tenant; not touching plan-wide limits`);
  const current = must(await db.from("plan_limits").select("*").eq("plan_id", planId).maybeSingle(), "plan limits");
  const partnersNow = must(await db.from("partners").select("partner_type, status").eq("tenant_id", T), "partner counts");
  const count = (type, statuses) => partnersNow.filter((p) => p.partner_type === type && statuses.includes(p.status)).length;
  const assistants = must(await db.from("tenant_users").select("role, users!tenant_users_user_id_fkey(status)").eq("tenant_id", T).eq("role", "assistant"), "assistants")
    .filter((m) => ["active", "suspended", "invited", "pending_verification"].includes(m.users?.status)).length;
  const partnerUsers = must(await db.from("partner_users").select("status").eq("tenant_id", T).eq("status", "active"), "partner users").length;
  const wanted = {
    max_publishers: 10,
    // At its cap (draft + active marketing partners): the create button shows the upgrade prompt.
    max_marketing_partners: Math.max(1, count("marketing", ["draft", "active"])),
    max_affiliates: 5,
    max_buffer_seats: assistants + 2,
    max_partner_users: Math.max(40, partnerUsers + 10),
  };
  const patch = Object.fromEntries(Object.entries(wanted).filter(([key]) => current?.[key] == null));
  if (!Object.keys(patch).length) { stat("plan_limits", "kept"); ctx.limits = current; return; }
  if (!DRY) {
    must(await db.from("plan_limits").update(patch).eq("plan_id", planId), "plan limits");
    await rpc("refresh_tenant_entitlement", { p_tenant_id: T });
    stat("tenant_entitlements", "updated");
  }
  stat("plan_limits", "updated");
  ctx.limits = { ...current, ...patch };
  console.log(`  limits on private plan ${plan.code}: ${JSON.stringify(patch)}`);
}

// ── D9–D16 · the lead plan (deterministic) ──────────────────────────────────────────────────────
const FIRST = ["Lorraine", "Harold", "Beatrice", "Walter", "Gloria", "Eugene", "Marjorie", "Clarence", "Dolores", "Raymond", "Evelyn", "Franklin", "Josefina", "Arturo", "Mildred", "Curtis", "Rosalind", "Vernon", "Consuelo", "Leonard", "Yolanda", "Chester", "Imogene", "Rodrigo", "Pauline", "Stanley", "Graciela", "Wendell", "Loretta", "Ignacio", "Bernadette", "Otis", "Marisela", "Delbert", "Priscilla", "Homer", "Adelina", "Lamar", "Geneva", "Rufus"];
const LAST = ["Pruitt", "Delgado", "Whitaker", "Okonkwo", "Fairbanks", "Castillo", "Hargrove", "Nakamura", "Bellamy", "Quintero", "Ashford", "Villanueva", "Tillman", "Obregon", "Sutherland", "Mbeki", "Crenshaw", "Ybarra", "Lindqvist", "Pemberton", "Salcedo", "Holloway", "Ferreira", "Gallagher", "Espinoza", "Rutledge", "Caldwell", "Montoya", "Blackwell", "Arriaga"];
const AREA = { AZ: ["602", "480", "520"], NY: ["212", "718", "518"], CA: ["213", "415", "619"], TX: ["512", "214", "713"], FL: ["305", "813", "407"], GA: ["404", "912"], OH: ["614", "216"], NC: ["704", "919"], PA: ["215", "412"], IL: ["312", "217"] };
const TZ_BY_STATE = { AZ: "America/Phoenix", NY: "America/New_York", CA: "America/Los_Angeles", TX: "America/Chicago", FL: "America/New_York", GA: "America/New_York", OH: "America/New_York", NC: "America/New_York", PA: "America/New_York", IL: "America/Chicago" };
const TL_STATES = ["TX", "FL", "AZ", "GA"];
const FE_STATES = ["TX", "FL", "AZ", "GA", "NY", "CA", "OH", "NC", "PA", "IL"];
const DISPOSITION_COUNTS = { application_submitted: 32, sent_to_underwriting: 11, callback_scheduled: 12, did_not_qualify: 22, no_payment_method: 9, not_interested: 17, do_not_call: 5, call_dropped: 12 };
const DISPOSITIONED_BY_PARTNER = { apex: 45, vertex: 30, bluebird: 11, northwind: 8, harbor: 12, seniorsavers: 8, familyfirst: 6 };
const CLOSERS = { apex: ["Marcus Bell", "Keisha Grant", "Dana Whitfield"], vertex: ["Nina Shah", "Caleb Stone"], harbor: ["Leo Marsh", "Tara Quinn"], bluebird: ["Paula Reed"], northwind: ["Victor Hale"] };
const SUBTYPES = ["Wants spouse on the call", "Needs to find bank details", "Call after payday", "Checking with daughter first", "Asked for an evening call", "Comparing with current policy"];
const NOTE_BODIES = [
  "Customer prefers morning calls; hard of hearing on the left side, speak slowly.", "Confirmed beneficiary spelling twice. Daughter lives out of state.",
  "Asked about graded benefit; explained the two-year waiting period.", "Takes metformin and lisinopril. No hospital stays in 24 months.",
  "Bank draft on the 3rd works best, social security arrives that day.", "Already has a small policy through work, wants it to cover the funeral only.",
  "Wife joined the call halfway; she handles the finances.", "Declined the add-on rider after hearing the price.",
  "Wanted written quote by mail before deciding.", "Transfer came in without DOB; collected it on the call.",
  "Partner closer said she was very interested but she sounded confused about why we called.", "Customer is a smoker, quoted tobacco rates.",
  "Needs Spanish-speaking agent for the application questions.", "Rate went up since the partner quoted; customer was fine with it.",
];

const versionAt = (code, ms) => {
  const revs = ctx.revisions[code] ?? [{ revision: 1, at: 0 }];
  return [...revs].reverse().find((r) => r.at <= ms)?.revision ?? revs[0].revision;
};

function buildPlan() {
  const leads = [];
  let serial = 0;
  const areaCounter = new Map();
  const phoneFor = (state, forced) => {
    if (forced) return forced;
    const codes = AREA[state] ?? ["512"];
    for (;;) {
      const code = codes[(areaCounter.get(state) ?? 0) % codes.length];
      const n = Math.floor((areaCounter.get(state) ?? 0) / codes.length) + 2; // never 0101 (demo DNC)
      areaCounter.set(state, (areaCounter.get(state) ?? 0) + 1);
      if (n > 99) throw new Error(`Ran out of 555-01xx numbers for ${state}`);
      return `(${code}) 555-01${String(n).padStart(2, "0")}`;
    }
  };
  const add = (kind, partner, extra = {}) => {
    serial += 1;
    const key = `qa-m1-${String(serial).padStart(4, "0")}`;
    const p = PARTNERS.find((x) => x.key === partner);
    const r = (s) => rnd(`${key}:${s}`);
    let product = extra.product;
    if (!product) {
      if (partner === "vertex" || partner === "familyfirst" || !partner) product = "final_expense";
      else product = r("product") < 0.55 ? "final_expense" : "term_life";
    }
    const state = extra.state ?? pick(`${key}:state`, product === "term_life" ? TL_STATES : FE_STATES);
    const age = product === "term_life" ? 30 + Math.floor(r("age") * 30) : 55 + Math.floor(r("age") * 26);
    const lead = {
      n: serial, key, kind, partner, type: p?.type ?? null, product, state,
      first: FIRST[(serial * 7) % FIRST.length], last: LAST[(serial * 11) % LAST.length],
      dob: `${NOW.getUTCFullYear() - age}-${String(1 + Math.floor(r("m") * 12)).padStart(2, "0")}-${String(1 + Math.floor(r("d") * 28)).padStart(2, "0")}`,
      tobacco: r("tob") < 0.22, coverage: product === "term_life" ? [100000, 250000, 500000][Math.floor(r("cov") * 3)] : [10000, 15000, 20000, 25000][Math.floor(r("cov") * 4)],
      screening: "clear", ...extra,
    };
    lead.phone = phoneFor(lead.state, extra.phone);
    leads.push(lead);
    return lead;
  };

  // 120 dispositioned over the last 30 days, paused/offboarded partners only before they stopped.
  const slots = Object.entries(DISPOSITIONED_BY_PARTNER).flatMap(([partner, n]) => Array(n).fill(partner));
  const outcomes = Object.entries(DISPOSITION_COUNTS).flatMap(([key, n]) => Array(n).fill(key));
  const order = (list, salt) => list.map((v, i) => ({ v, s: rnd(`${salt}:${i}`) })).sort((a, b) => a.s - b.s).map((x) => x.v);
  const shuffledSlots = order(slots, "slots");
  const shuffledOutcomes = order(outcomes.filter((o) => o !== "callback_scheduled"), "outcomes");
  const cbStates = ["AZ", "AZ", "AZ", "AZ", "NY", "NY", "NY", "NY", "CA", "CA", "CA", "CA"];
  const cbDays = [1, 1, 2, 2, 3, 4, 3, 5, 6, 2, 8, 7]; // categories below need the booking before the slot
  let iulLeft = 4;
  let cbIndex = 0;
  for (let i = 0; i < 120; i += 1) {
    let partner = shuffledSlots[i];
    const isCallback = i % 10 === 4 && cbIndex < 12;
    if (isCallback && ["bluebird", "northwind", "familyfirst"].includes(partner)) partner = ["apex", "vertex", "harbor", "seniorsavers"][cbIndex % 4];
    const disposition = isCallback ? "callback_scheduled" : shuffledOutcomes.pop() ?? "not_interested";
    const minDays = partner === "bluebird" ? 10 : partner === "northwind" ? 13 : 1;
    const days = isCallback ? cbDays[cbIndex] : minDays + rnd(`day:${i}`) * (29.5 - minDays);
    const extra = { disposition, days };
    if (isCallback) { extra.product = "final_expense"; extra.state = cbStates[cbIndex]; extra.callbackIndex = cbIndex; cbIndex += 1; }
    if (partner === "bluebird" && iulLeft > 0 && ["not_interested", "did_not_qualify", "call_dropped"].includes(disposition)) { extra.product = "iul"; iulLeft -= 1; extra.days = 20 + rnd(`iul:${i}`) * 9; }
    add("dispositioned", partner, extra);
  }
  // Live and other queue states.
  [30, 45, 60, 90, 180, 240, 360, 960].forEach((wait, i) => add("unclaimed", ["apex", "vertex", "apex", "harbor", "seniorsavers", "apex", "vertex", "familyfirst"][i], { waitSeconds: wait }));
  add("live", "apex", { live: "L1", product: "final_expense", waitSeconds: 540, defVersion: 1 }); // a v1 draft, submitted after the v2 edit
  add("live", "vertex", { live: "L2", product: "final_expense", state: "TX", language: "Spanish", waitSeconds: 420 });
  add("live", "apex", { live: "L3", product: "final_expense", waitSeconds: 780 });
  add("live", "harbor", { live: "L4", product: "term_life", waitSeconds: 1500 });
  add("live", "seniorsavers", { live: "L5", product: "final_expense", waitSeconds: 660 });
  [["apex", 2.2], ["vertex", 5.1], ["harbor", 8.3], ["seniorsavers", 11.4], ["familyfirst", 16.2], ["apex", 21.7]].forEach(([partner, days], i) => add("expired", partner, { days, laddered: i % 2 === 0 }));
  add("claimed_nocall", "apex", { hoursAgo: 3.2 });
  add("claimed_nocall", "familyfirst", { hoursAgo: 1.4 });
  add("failure", "vertex", { hoursAgo: 2.1 });
  add("manual", null, { days: 6, manual: true });
  add("manual", null, { days: 13, manual: true });

  // Timestamps (business hours in the customer's zone).
  for (const lead of leads) {
    const zone = TZ_BY_STATE[lead.state] ?? "America/Chicago";
    if (lead.waitSeconds != null) lead.createdMs = NOW.getTime() - lead.waitSeconds * 1000 - 3000;
    else if (lead.hoursAgo != null) lead.createdMs = NOW.getTime() - lead.hoursAgo * HOUR;
    else {
      const day = localDate(NOW.getTime() - lead.days * DAY, zone);
      lead.createdMs = Math.min(zoned(day, 9 + Math.floor(rnd(`${lead.key}:h`) * 8), Math.floor(rnd(`${lead.key}:mi`) * 60), zone), NOW.getTime() - 2 * HOUR);
    }
  }
  leads.sort((a, b) => a.createdMs - b.createdMs);

  // D15/D16 · screening and duplicates, applied to later leads copying earlier people.
  const dispositioned = leads.filter((l) => l.kind === "dispositioned");
  const later = (lead) => dispositioned.filter((l) => l.createdMs > lead.createdMs + DAY && l.disposition !== "callback_scheduled" && !l.dup && !l.src && l.product !== "iul");
  const copyPerson = (target, source, keepPhone) => {
    source.src = true;
    Object.assign(target, { first: source.first, last: source.last, dob: source.dob, state: source.state, product: source.product === "iul" ? target.product : source.product, dupOf: source.key, dup: true });
    if (keepPhone) target.phone = source.phone;
    else target.phone = phoneFor(target.state);
    if (target.partner === "vertex") target.product = "final_expense";
    if (target.product === "term_life" && !TL_STATES.includes(target.state)) target.product = "final_expense";
  };
  const notSold = dispositioned.filter((l) => ["not_interested", "did_not_qualify", "no_payment_method", "call_dropped"].includes(l.disposition) && l.product !== "iul");
  // 6 spoken before (same name, DOB and state, new phone) — one of them waiting in the inbox now.
  for (let i = 0; i < 6; i += 1) {
    const source = notSold[i * 3];
    const candidates = i === 5 ? leads.filter((l) => l.kind === "unclaimed" && l.waitSeconds === 90) : later(source);
    const target = candidates[Math.floor(rnd(`spoken:${i}`) * candidates.length)];
    if (source && target) { copyPerson(target, source, false); target.expect = "spoken_before"; }
  }
  // 2 sold twice by two partners: an Apex sale re-sold by Vertex / Harbor.
  const sold = dispositioned.filter((l) => l.partner === "apex" && l.disposition === "application_submitted" && l.product === "final_expense" && !l.dup);
  const resellers = dispositioned.filter((l) => ["vertex", "harbor"].includes(l.partner) && !l.dup && !["callback_scheduled", "do_not_call", "application_submitted", "sent_to_underwriting"].includes(l.disposition));
  for (let i = 0; i < 2; i += 1) {
    const source = sold[i];
    const target = resellers.find((l) => l.createdMs > source.createdMs + 2 * DAY && !l.dup && !l.src && l.partner !== source.partner && (i === 0 ? l.partner === "vertex" : l.partner === "harbor"));
    if (source && target) { copyPerson(target, source, false); target.expect = "already_customer"; target.disposition = "not_interested"; }
  }
  // 3 duplicate overrides: same name + phone from another partner → internal DQ warning + justification.
  const justifications = ["Customer called us back directly after the first agent never reached her.", "Different product this time: prior submission was term, this one is final expense.", "Prior lead was a wrong-number entry by the other partner; confirmed identity on the call."];
  const dqSources = dispositioned.filter((l) => ["did_not_qualify", "not_interested"].includes(l.disposition) && !l.dup && l.product !== "iul").slice(5, 8);
  dqSources.forEach((source, i) => {
    const target = dispositioned.find((l) => l.createdMs > source.createdMs + DAY && !l.dup && !l.src && l.partner !== source.partner && l.disposition !== "callback_scheduled" && l.type !== "affiliate");
    if (!target) return;
    copyPerson(target, source, true);
    Object.assign(target, { screening: "internal_dq", justification: justifications[i] });
  });
  // 8 DNC-warned: 6 on vendor DNC lists (…555-0101), 2 re-submitted numbers already on the internal DNC list.
  const dncTargets = [...dispositioned.filter((l) => !l.dup && l.disposition !== "do_not_call" && l.disposition !== "callback_scheduled" && l.product !== "iul").filter((_, i) => i % 17 === 3).slice(0, 4), ...leads.filter((l) => l.kind === "unclaimed" && [45, 240].includes(l.waitSeconds))];
  const dncAreas = ["602", "212", "213", "512", "305", "404"];
  dncTargets.slice(0, 6).forEach((lead, i) => {
    const zoneState = Object.entries(AREA).find(([, codes]) => codes.includes(dncAreas[i]))[0];
    if (lead.product === "term_life" && !TL_STATES.includes(zoneState)) lead.product = "final_expense";
    Object.assign(lead, { state: zoneState, phone: `(${dncAreas[i]}) 555-0101`, screening: "dnc", dncVendor: true });
  });
  const dncDispositioned = dispositioned.filter((l) => l.disposition === "do_not_call");
  const resubmits = dispositioned.filter((l) => !l.dup && !l.dncVendor && l.disposition !== "callback_scheduled" && l.disposition !== "do_not_call" && l.product !== "iul");
  for (let i = 0; i < 2; i += 1) {
    const source = dncDispositioned[i];
    const target = resubmits.find((l) => l.createdMs > source.createdMs + DAY && !l.dup && !l.src && l.partner !== source.partner);
    // Same number, different person in the household (so it is a DNC hit, not a name+phone duplicate).
    if (target) {
      source.src = true;
      Object.assign(target, { phone: source.phone, state: source.state, last: source.last, screening: "dnc", dncInternal: true, dup: true });
      if (target.product === "term_life" && !TL_STATES.includes(target.state)) target.product = "final_expense";
    }
  }
  // Owners, buffers, times.
  for (const lead of leads) {
    const r = (s) => rnd(`${lead.key}:${s}`);
    lead.submissionId = uid(`submission:${lead.key}`);
    lead.id = uid(`lead:${lead.key}`);
    lead.wi = uid(`wi:${lead.key}`);
    lead.closer = lead.type === "affiliate" || !lead.partner ? null : pick(`${lead.key}:closer`, CLOSERS[lead.partner] ?? []);
    lead.owner = r("owner") < 0.45 ? "ray" : "la";
    lead.buffer = lead.kind === "dispositioned" && lead.type !== "affiliate" && r("buffer") < 0.25 ? (lead.language === "Spanish" || r("es") < 0.4 ? "es" : "en") : null;
    if (lead.product === "final_expense" && r("lang") < 0.12 && !lead.language) lead.language = "Spanish";
    lead.claimMs = lead.createdMs + (20 + Math.floor(r("wait") * 200)) * 1000;
    lead.dispoMs = lead.claimMs + (6 + Math.floor(r("talk") * 38)) * MIN;
    if (lead.dispoMs > NOW.getTime() - 5 * MIN) lead.dispoMs = NOW.getTime() - 5 * MIN;
    const markets = ctx.markets.filter((m) => m.state === lead.state);
    const market = markets.length ? markets[Math.floor(r("mkt") * markets.length)] : null;
    lead.carrierId = market?.carrier_id ?? null;
    lead.carrierState = market ? lead.state : null;
    if (lead.buffer && lead.language === "Spanish") lead.buffer = "es";
  }
  return leads;
}

// ── D9–D17, D24 · leads, work items, calls, verification, deal flow ─────────────────────────────
const WARN = { dnc: "This number appears on a DNC list. The lead was accepted with a compliance warning.", internal_dq: "This number matches an existing lead. Review it before contacting the consumer." };
const digits = (phone) => phone.replace(/\D/g, "").slice(-10);
const nameOf = (lead) => `${lead.first} ${lead.last}`;
const person = (key) => (key === "ray" ? { id: ctx.ray.id, name: ctx.ray.name, role: "owner" } : key === "la" ? { id: ctx.la.id, name: ctx.la.name, role: "producer" } : key === "es" ? { ...ctx.bufferEs, role: "assistant" } : { ...ctx.bufferEn, role: "assistant" });

function valuesFor(lead) {
  const base = { qa_seed: TAG, qa_ref: lead.key };
  if (lead.manual) return { full_name: nameOf(lead), phone: lead.phone, ...base };
  if (lead.type === "affiliate") return { full_name: nameOf(lead), phone: lead.phone, state: lead.state, product_interest: lead.product, consent: true, ...(lead.language ? { language: lead.language } : {}), ...base };
  const values = { first_name: lead.first, last_name: lead.last, phone: lead.phone, email: `${lead.first}.${lead.last}.${lead.n}@example.test`.toLowerCase(), date_of_birth: lead.dob, state: lead.state, coverage_amount: lead.coverage, tobacco: lead.tobacco };
  if (lead.product === "final_expense") {
    Object.assign(values, { beneficiary_name: `${pick(`${lead.key}:bf`, FIRST)} ${lead.last}`, beneficiary_relationship: pick(`${lead.key}:br`, ["Spouse", "Child", "Child", "Sibling"]) });
    if (versionAt("final_expense", lead.createdMs) >= 2) values.existing_coverage = rnd(`${lead.key}:ec`) < 0.3;
  }
  if (lead.language) values.language = lead.language;
  if (rnd(`${lead.key}:q`) < 0.6) values.initial_quote = lead.product === "term_life" ? `$${(22 + rnd(`${lead.key}:qp`) * 40).toFixed(2)}/mo · ${lead.coverage / 1000}k 20-yr term` : `$${(38 + rnd(`${lead.key}:qp`) * 50).toFixed(2)}/mo · $${lead.coverage.toLocaleString("en-US")} level`;
  return { ...values, ...base };
}

async function seedLeads(plan) {
  if (!ctx.revisions || !ctx.templates?.final_expense || !ctx.templates?.iul) throw new Error("skipped: the product forms (D3) are not in place");
  const channels = must(await db.from("partner_channels").select("id, partner_id, status").eq("tenant_id", T).eq("channel_type", "partner"), "channels");
  ctx.channel = new Map(channels.map((c) => [c.partner_id, c.id]));
  const partnerId = (key) => ctx.partners[key]?.id ?? null;
  const channelOf = (key) => ctx.channel.get(partnerId(key)) ?? uid(`channel:${key}`);
  const closerId = (lead) => (lead.closer ? ctx.partnerUsers[lead.closer] ?? null : null);
  const R = { screening_results: [], screening_audit: [], agent_leads: [], lead_queue: [], active_calls: [], tenant_verification_sessions: [], buffer_handoffs: [], deal_flow: [], lead_notifications: [], partner_messages: [], intake_failures: [], tenant_do_not_call: [], tenant_lead_sla_events: [] };
  const card = (id, lead, at, fields) => R.partner_messages.push({ id, tenant_id: T, partner_id: partnerId(lead.partner), channel_id: channelOf(lead.partner), created_at: iso(at), card_payload: {}, ...fields });

  for (const lead of plan) {
    const p = lead.partner ? ctx.partners[lead.partner] : null;
    const tz = p?.tz ?? "America/Phoenix";
    const created = lead.createdMs;
    const product = lead.product;
    const copy = ctx.templates[product] ?? ctx.templates.term_life;
    const definitionVersion = lead.defVersion ?? versionAt(product, created);
    const entry = lead.manual ? ctx.entry.marketing : ctx.entry[lead.type];
    const outcome = lead.kind === "dispositioned" ? ctx.dispositions.get(lead.disposition) : null;
    const target = outcome ? ctx.dispositionStage.get(lead.disposition) ?? entry : entry;
    const link = lead.type === "affiliate" ? Object.values(ctx.links).filter((l) => l.partner === lead.partner)[lead.n % 2] : null;
    const values = valuesFor(lead);
    const name = nameOf(lead);
    // Screening (lib/compliance/screening.ts): one cached result + one audit row per check.
    let resultId = null;
    const screenedAt = created - 45_000;
    if (!lead.manual) {
      const vendor = lead.dncInternal ? "tenant_suppression" : "litigator:qa-demo-litigator,dnc:qa-demo-dnc";
      const raw = lead.dncInternal ? { source: "tenant_do_not_call", qa_seed: TAG } : { litigator: { listed: false, provider: "qa-demo" }, dnc: { listed: lead.screening === "dnc", provider: "qa-demo" }, internal_dq: lead.screening === "internal_dq", qa_seed: TAG };
      if (!lead.dncInternal) {
        resultId = uid(`screen:${lead.key}`);
        R.screening_results.push({ id: resultId, tenant_id: T, partner_id: partnerId(lead.partner), phone_digits: digits(lead.phone), outcome: lead.screening, vendor, raw_response: raw, version: 1, checked_at: iso(screenedAt), expires_at: iso(screenedAt + 30 * DAY), created_at: iso(screenedAt), warnings: WARN[lead.screening] ? [{ code: lead.screening, message: WARN[lead.screening] }] : [] });
      }
      R.screening_audit.push({ id: uid(`screen-audit:${lead.key}`), tenant_id: T, partner_id: partnerId(lead.partner), user_id: closerId(lead), phone_digits: digits(lead.phone), outcome: lead.screening, vendor, raw_response: raw, result_id: resultId, cached: false, version: 1, ts: iso(screenedAt) });
    }
    const overrideBy = lead.justification ? closerId(lead) : null;
    R.agent_leads.push({
      id: lead.id, tenant_id: T, template_id: copy.templateId ?? TL_PLATFORM_TEMPLATE, template_version: copy.templateVersion ?? 1, tenant_template_id: copy.id, definition_version: definitionVersion,
      product_line: product, partner_id: partnerId(lead.partner), submission_id: lead.manual ? null : lead.submissionId,
      pipeline_id: target.pipeline_id, stage_id: target.stage_id, values, created_by: lead.manual ? ctx.ray.id : closerId(lead),
      created_at: iso(created), updated_at: iso(outcome ? lead.dispoMs : created), stage_entered_at: iso(outcome ? lead.dispoMs : created),
      screening_result_id: resultId, screening_version: lead.manual ? null : 1, screening_outcome: lead.manual ? null : lead.screening,
      screening_warning: WARN[lead.screening] ?? null, screening_checked_at: lead.manual ? null : iso(screenedAt),
      screening_warning_acknowledged: lead.screening === "dnc", screening_warning_acknowledged_at: lead.screening === "dnc" ? iso(created - 20_000) : null,
      duplicate_override_justification: lead.justification ?? null, duplicate_override_by: overrideBy, duplicate_override_at: lead.justification ? iso(created - 10_000) : null,
      preflight_status: "unchecked", callback_subtype: lead.disposition === "callback_scheduled" ? pick(`${lead.key}:sub`, SUBTYPES) : null,
      affiliate_link_id: link?.id ?? null, affiliate_campaign: link?.campaign ?? null, carrier_id: lead.carrierId, carrier_state: lead.carrierState,
    });
    if (lead.manual) {
      R.deal_flow.push({ id: uid(`deal:${lead.key}`), tenant_id: T, lead_id: lead.id, partner_id: null, product_line: product, pipeline_id: entry.pipeline_id, stage_id: entry.stage_id, insured_name: name, phone: lead.phone, local_date: localDate(created, "America/Phoenix"), carrier: ctx.carrierName.get(lead.carrierId) ?? "Mutual of Omaha", product_type: "Level whole life", monthly_premium_cents: 6150 + lead.n * 10, face_amount_cents: lead.coverage * 100, draft_date: localDate(created + 9 * DAY, "UTC"), status: "completed", call_result: "application_submitted", notes: "Walk-in referral from an existing client; entered by hand.", worked_by: ctx.ray.id, manual_entry: true, created_at: iso(created), updated_at: iso(created) });
      audit(`manual-deal:${lead.key}`, { actor_id: ctx.ray.id, action: "tenant.deal_flow_manual_created", target_type: "deal_flow", target_id: uid(`deal:${lead.key}`), ts: iso(created), metadata: { productLine: product } });
      continue;
    }
    audit(`submitted:${lead.key}`, { actor_type: lead.type === "affiliate" ? "system" : "tenant", actor_id: closerId(lead), action: "tenant.partner_lead_submitted", target_type: "agent_lead", target_id: lead.id, ts: iso(created), metadata: { partnerId: partnerId(lead.partner), productCode: product, definitionVersion, replayed: false, ...(link ? { affiliateLinkId: link.id, campaign: link.campaign } : { consentAttestedAt: iso(created - 5000) }) } });
    if (lead.justification) audit(`dup-override:${lead.key}`, { actor_id: closerId(lead), action: "tenant.partner_lead_duplicate_overridden", target_type: "agent_lead", target_id: lead.id, reason: lead.justification, ts: iso(created), metadata: { partnerId: partnerId(lead.partner), productCode: product } });
    R.lead_notifications.push({ id: uid(`notif:${lead.key}`), tenant_id: T, lead_id: lead.id, channel: "internal", event_type: "lead_available", payload: { productCode: product, partnerId: partnerId(lead.partner), submissionId: lead.submissionId, affiliateLinkId: link?.id ?? null, campaign: link?.campaign ?? null, qa_seed: TAG }, created_at: iso(created + 1500) });
    card(uid(`card:new:${lead.key}`), lead, created + 2500, { work_item_id: null, message: `${name} is available for lead`, message_kind: "system_card", card_type: "new_lead", card_payload: { customer: name, agent: lead.closer ?? "An agent", product: "lead", disposition: "Call outcome", state: lead.state, qa_seed: TAG }, event_key: `new-lead:${lead.id}`, created_by: closerId(lead) });

    // The deal-flow row intake writes (lib/agentTemplates/intake.ts), then what later steps changed.
    const deal = { id: uid(`deal:${lead.key}`), tenant_id: T, lead_id: lead.id, partner_id: partnerId(lead.partner), submission_id: lead.submissionId, product_line: product, pipeline_id: entry.pipeline_id, stage_id: entry.stage_id, insured_name: name, phone: lead.phone, initial_quote: values.initial_quote ?? null, tracking_id: null, local_date: localDate(created, tz), affiliate_link_id: link?.id ?? null, affiliate_campaign: link?.campaign ?? null, created_at: iso(created + 1200), updated_at: iso(created + 1200) };
    R.deal_flow.push(deal);
    if (lead.kind === "failure") {
      R.intake_failures.push({ id: uid(`failure:${lead.key}`), tenant_id: T, lead_id: lead.id, step: "work_item", error_message: 'new row violates row-level security policy for table "lead_queue"', metadata: { submissionId: lead.submissionId, productCode: product, affiliateLinkId: null, qa_seed: TAG }, created_at: iso(created + 1100) });
      continue;
    }
    const queue = { id: lead.wi, tenant_id: T, lead_id: lead.id, partner_id: partnerId(lead.partner), product_line: product, pipeline_id: entry.pipeline_id, stage_id: entry.stage_id, status: "unclaimed", submission_id: lead.submissionId, queued_at: iso(created + 1000), created_at: iso(created + 1000), updated_at: iso(created + 1000), affiliate_link_id: link?.id ?? null, affiliate_campaign: link?.campaign ?? null };
    R.lead_queue.push(queue);
    if (lead.kind === "unclaimed" || lead.kind === "live") continue;

    if (lead.kind === "expired") {
      const q = created + 1000;
      const at = (s) => iso(q + s * 1000 + 20_000);
      Object.assign(queue, { status: "expired", sla_expired_at: at(ctx.sla.expire), updated_at: at(ctx.sla.expire) });
      const rungs = lead.laddered ? [["warn", ctx.sla.warn, "tenant.lead_sla_warned"], ["escalate", ctx.sla.escalate, "tenant.lead_sla_escalated"], ["partner", ctx.sla.partner, "tenant.lead_sla_partner_notified"], ["expire", ctx.sla.expire, "tenant.lead_sla_expired"]] : [["expire", ctx.sla.expire, "tenant.lead_sla_expired"]];
      if (lead.laddered) Object.assign(queue, { sla_warned_at: at(ctx.sla.warn), sla_escalated_at: at(ctx.sla.escalate), sla_partner_notified_at: at(ctx.sla.partner) });
      for (const [rung, seconds, action] of rungs) {
        // processed_at is set: these are history, and the app-side job must never pick them up (it would email the owner).
        R.tenant_lead_sla_events.push({ id: uid(`sla:${lead.key}:${rung}`), tenant_id: T, work_item_id: lead.wi, lead_id: lead.id, partner_id: partnerId(lead.partner), rung, occurred_at: at(seconds), claimed_at: at(seconds + 30), processed_at: at(seconds + 31), attempts: 1, created_at: at(seconds) });
        audit(`sla:${lead.key}:${rung}`, { actor_type: "system", actor_id: null, action, target_type: "lead_queue", target_id: lead.wi, ts: at(seconds), metadata: { ageSeconds: seconds + 20, thresholdSeconds: seconds, ...(rung === "expire" ? { quiet: !lead.laddered } : {}) } });
      }
      if (lead.laddered) card(uid(`card:nobody:${lead.key}`), lead, q + ctx.sla.partner * 1000 + 60_000, { work_item_id: lead.wi, message: `${name} was not claimed before the response window. Our team has been notified.`, message_kind: "system_card", card_type: "nobody_claimed", card_payload: { customer: name, agent: "An agent", product, disposition: "Call outcome", state: lead.state, qa_seed: TAG }, event_key: `unclaimed-sla:${lead.wi}:partner`, created_by: null });
      continue;
    }

    // Claimed (claim_transfer_lead) → optional buffer handoff (offer/accept_buffer_handoff) → outcome (complete_disposition).
    const owner = person(lead.kind === "claimed_nocall" ? "la" : lead.owner);
    const buffer = lead.buffer ? person(lead.buffer) : null;
    const firstClaimer = buffer ?? owner;
    Object.assign(queue, { status: "claimed", claimed_by: owner.id, owner_user_id: owner.id, owner_role: owner.role, buffer_user_id: buffer?.id ?? null, claimed_at: iso(lead.claimMs), updated_at: iso(lead.claimMs) });
    audit(`claimed:${lead.key}`, { actor_id: firstClaimer.id, action: "tenant.transfer_claimed", target_type: "lead_queue", target_id: lead.wi, ts: iso(lead.claimMs), metadata: { activeCallId: uid(`call:${lead.key}`), verificationSessionId: uid(`vs:${lead.key}`), chatPosted: true } });
    if (buffer) {
      card(uid(`card:claim:${lead.key}`), lead, lead.claimMs + 1000, { work_item_id: lead.wi, message: `${name} is connected to the buffer agent`, message_kind: "system_card", card_type: "transferred", card_payload: { customer: name, agent: buffer.name, product, disposition: "Call outcome", state: lead.state, qa_seed: TAG }, event_key: `buffer-claim:${lead.wi}`, created_by: buffer.id });
      const offered = lead.claimMs + 4 * MIN;
      const handoffId = uid(`handoff:${lead.key}`);
      R.buffer_handoffs.push({ id: handoffId, tenant_id: T, work_item_id: lead.wi, buffer_user_id: buffer.id, licensed_agent_id: owner.id, status: "accepted", offered_at: iso(offered), expires_at: iso(offered + 30_000), accepted_at: iso(offered + 12_000), created_at: iso(offered), updated_at: iso(offered + 12_000) });
      audit(`handoff-offered:${lead.key}`, { actor_id: buffer.id, action: "tenant.buffer_handoff_offered", target_type: "buffer_handoff", target_id: handoffId, ts: iso(offered), metadata: { workItemId: lead.wi, licensedAgentId: owner.id, expiresAt: iso(offered + 30_000) } });
      audit(`handoff-accepted:${lead.key}`, { actor_id: owner.id, action: "tenant.buffer_handoff_accepted", target_type: "buffer_handoff", target_id: handoffId, ts: iso(offered + 12_000), metadata: { workItemId: lead.wi, bufferUserId: buffer.id, progressPercentage: 100 } });
      card(uid(`card:accept:${lead.key}`), lead, offered + 13_000, { work_item_id: lead.wi, message: `${owner.name} accepted the transfer for ${name}`, message_kind: "system_card", card_type: "transferred", card_payload: { customer: name, agent: owner.name, product, disposition: "Call outcome", state: lead.state, qa_seed: TAG }, event_key: `handoff-accepted:${handoffId}`, created_by: owner.id });
    } else {
      card(uid(`card:claim:${lead.key}`), lead, lead.claimMs + 1000, { work_item_id: lead.wi, message: `${name} is connected to the agent`, message_kind: "system_card", card_type: "connected", card_payload: { customer: name, agent: owner.name, product, disposition: "Call outcome", state: lead.state, qa_seed: TAG }, event_key: `claim:${lead.wi}`, created_by: owner.id });
    }
    const ended = lead.kind === "claimed_nocall" ? lead.claimMs + 2 * MIN : lead.dispoMs;
    R.active_calls.push({ id: uid(`call:${lead.key}`), tenant_id: T, work_item_id: lead.wi, lead_id: lead.id, submission_id: lead.submissionId, user_id: owner.id, agent_role: owner.role, started_at: iso(lead.claimMs), ended_at: iso(ended), created_at: iso(lead.claimMs), updated_at: iso(ended) });
    const progress = lead.kind === "claimed_nocall" ? 17 : ["application_submitted", "sent_to_underwriting", "no_payment_method"].includes(lead.disposition) ? 100 : [17, 33, 50, 67, 83, 100][Math.floor(rnd(`${lead.key}:vp`) * 6)];
    R.tenant_verification_sessions.push({ id: uid(`vs:${lead.key}`), tenant_id: T, work_item_id: lead.wi, lead_id: lead.id, user_id: owner.id, agent_role: owner.role, status: lead.kind === "claimed_nocall" ? "open" : "closed", progress_percentage: progress, started_at: iso(lead.claimMs), ended_at: lead.kind === "claimed_nocall" ? null : iso(lead.dispoMs), completed_at: lead.kind === "claimed_nocall" ? null : iso(lead.dispoMs), last_actor_id: owner.id, created_at: iso(lead.claimMs), updated_at: iso(ended) });
    if (!outcome) continue;

    // complete_disposition: work item, lead stage, call, verification, deal flow, outcome card, DNC list, audit.
    Object.assign(queue, { status: outcome.closes_as, disposition: outcome.disposition_key, disposition_at: iso(lead.dispoMs), disposition_by: owner.id, stage_id: target.stage_id, pipeline_id: target.pipeline_id, updated_at: iso(lead.dispoMs) });
    Object.assign(deal, { status: outcome.closes_as === "dropped" ? "dropped" : "completed", call_result: outcome.disposition_key, disposition_at: iso(lead.dispoMs), disposition_by: owner.id, worked_by: owner.id, pipeline_id: target.pipeline_id, stage_id: target.stage_id, updated_at: iso(lead.dispoMs) });
    if (["application_submitted", "sent_to_underwriting"].includes(outcome.disposition_key)) {
      const fe = product !== "term_life";
      Object.assign(deal, { carrier: ctx.carrierName.get(lead.carrierId) ?? "Americo", product_type: fe ? pick(`${lead.key}:pt`, ["Level whole life", "Graded benefit whole life", "Level whole life"]) : pick(`${lead.key}:pt`, ["20-year term", "30-year term", "10-year term"]), monthly_premium_cents: fe ? 3500 + Math.floor(rnd(`${lead.key}:pr`) * 6000) : 2500 + Math.floor(rnd(`${lead.key}:pr`) * 5500), face_amount_cents: lead.coverage * 100, draft_date: localDate(lead.dispoMs + (3 + Math.floor(rnd(`${lead.key}:dd`) * 18)) * DAY, tz) });
      if (lead.n % 9 === 0) {
        Object.assign(deal, { monthly_premium_cents: deal.monthly_premium_cents + 450, notes: "Premium corrected after carrier re-rate.", updated_at: iso(lead.dispoMs + 26 * HOUR) });
        audit(`deal-edit:${lead.key}`, { actor_id: owner.id, action: "tenant.deal_flow_updated", target_type: "deal_flow", target_id: deal.id, ts: iso(lead.dispoMs + 26 * HOUR), metadata: { fields: ["monthly_premium_cents", "notes"] } });
      }
    }
    // Text row with the work item; normalize_partner_disposition_card turns it into the outcome card.
    card(uid(`card:outcome:${lead.key}`), lead, lead.dispoMs + 1500, { work_item_id: lead.wi, message: `${name}: ${outcome.label}`, message_kind: "text", card_type: null, event_key: null, created_by: owner.id });
    if (outcome.disposition_key === "do_not_call") R.tenant_do_not_call.push({ id: uid(`dnc:${lead.key}`), tenant_id: T, phone_digits: digits(lead.phone), lead_id: lead.id, added_by: owner.id, created_at: iso(lead.dispoMs), updated_at: iso(lead.dispoMs) });
    audit(`dispositioned:${lead.key}`, { actor_id: owner.id, action: "tenant.dispositioned", target_type: "lead_queue", target_id: lead.wi, ts: iso(lead.dispoMs), metadata: { leadId: lead.id, dispositionKey: outcome.disposition_key, status: outcome.closes_as, stageId: target.stage_id, dncAdded: outcome.disposition_key === "do_not_call", partnerCardPosted: true } });
  }

  // FK order. lead_queue rows go in with their FINAL status, so the SLA ladder never sees history as unclaimed.
  for (const table of ["screening_results", "screening_audit", "agent_leads", "lead_queue", "active_calls", "tenant_verification_sessions", "buffer_handoffs", "deal_flow", "lead_notifications", "intake_failures", "tenant_lead_sla_events", "tenant_do_not_call"]) {
    await ensure(table, R[table]);
  }
  ctx.pendingCards = R.partner_messages;
  await flushAudit();
  ctx.leadsOk = true;
}
const needLeads = () => { if (!ctx.leadsOk) throw new Error("skipped: leads were not seeded"); };

async function seedCards() {
  needLeads();
  // Outcome text rows need their work item already completed (the trigger checks it), so cards go last.
  await ensure("partner_messages", ctx.pendingCards ?? []);
}

// ── D16 · existing-customer pre-flight, through the product's own matcher ───────────────────────
const COMBINING_MARKS = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");
const normText = (v) => (v ?? "").normalize("NFKD").replace(COMBINING_MARKS, "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, "").trim();
// Mirrors lib/existingCustomerPreflight/service.ts OUTCOME_SOLD: outcomes are disposition keys
// ("application_submitted"), so the word may end the key as well as stand alone.
const SOLD = /(^|_)(sold|issued|approved|won|converted|submitted)$/i;
async function seedPreflight(plan) {
  needLeads();
  if (DRY) { stat("agent_leads (preflight)", "updated", plan.filter((l) => !l.manual).length); return; }
  const unchecked = new Set();
  for (const part of chunks(plan.filter((l) => !l.manual).map((l) => l.id), 150)) {
    for (const row of must(await db.from("agent_leads").select("id, preflight_status").in("id", part).in("preflight_status", ["unchecked", "spoken_before"]), "preflight lookup")) {
      // Unchecked leads, plus the planned "already customer" ones an earlier run stored as spoken_before
      // (the matcher's sold-outcome rule was too strict until the product fix above).
      const planned = plan.find((l) => l.id === row.id);
      if (row.preflight_status === "unchecked" || planned?.expect === "already_customer") unchecked.add(row.id);
    }
  }
  const counts = {};
  for (const lead of plan) {
    if (!unchecked.has(lead.id)) { if (!lead.manual) stat("agent_leads (preflight)", "kept"); continue; }
    const values = valuesFor(lead);
    const full = values.full_name ?? `${values.first_name} ${values.last_name}`;
    const address = [values.state].filter(Boolean).join(" ");
    const data = await rpc("find_existing_customer_preflight", { p_tenant_id: T, p_full_name: normText(full), p_dob: values.date_of_birth ?? null, p_phone_digits: digits(lead.phone), p_address_search: address ? normText(address) : null, p_exclude_lead_id: lead.id, p_limit: 20 });
    // Only what existed when this lead arrived.
    const matches = (data ?? []).filter((m) => Date.parse(m.submitted_at) < lead.createdMs).map((m) => ({ leadId: m.lead_id ?? null, contactId: m.contact_id ?? null, submittedAt: String(m.submitted_at), partnerId: m.partner_id ?? null, partnerName: m.partner_name ?? null, productLine: m.product_line ?? null, outcome: m.outcome ?? null, score: Number(m.score), matchedOn: Array.isArray(m.matched_on) ? m.matched_on : [], sourceType: m.source_type === "contact" ? "contact" : "lead" }));
    const status = !matches.length ? "new_household" : matches.some((m) => m.sourceType === "lead" && m.outcome && SOLD.test(m.outcome.trim())) ? "already_customer" : "spoken_before";
    const checkedAt = iso(lead.createdMs + 1300);
    must(await db.from("agent_leads").update({ preflight_status: status, preflight_checked_at: checkedAt, preflight_result: { status, policyMatchingIncluded: false, policyMatchingNote: "Policy matching is not included yet; this check covers prior leads and contacts only.", checkedAt, matches } }).eq("id", lead.id).in("preflight_status", ["unchecked", "spoken_before"]), "preflight store");
    stat("agent_leads (preflight)", "updated");
    counts[status] = (counts[status] ?? 0) + 1;
    if (lead.expect && lead.expect !== status) console.log(`  note: ${lead.key} planned ${lead.expect}, the matcher says ${status}`);
  }
  if (Object.keys(counts).length) console.log(`  preflight: ${JSON.stringify(counts)}`);
}

// ── D21 · callbacks (AZ / NY / CA customers) ────────────────────────────────────────────────────
const CB_PLAN = ["due", "due", "due", "overdue", "overdue", "missed", "upcoming", "upcoming", "upcoming", "upcoming", "cancelled", "completed"];
async function seedCallbacks(plan) {
  needLeads();
  const rows = [], history = [];
  for (const lead of plan.filter((l) => l.callbackIndex != null)) {
    const kind = CB_PLAN[lead.callbackIndex];
    const zone = TZ_BY_STATE[lead.state];
    const owner = person(lead.owner);
    const today = localDate(NOW.getTime(), zone);
    const dayOffset = (n) => localDate(NOW.getTime() + n * DAY, zone);
    let at;
    if (kind === "due") { at = zoned(today, [11, 14, 16][lead.callbackIndex], 30, zone); if (at <= NOW.getTime() + 20 * MIN) at = NOW.getTime() + (1 + lead.callbackIndex) * HOUR; }
    else if (kind === "overdue") at = NOW.getTime() - (lead.callbackIndex === 3 ? 25 : 70) * MIN;
    else if (kind === "missed") at = zoned(dayOffset(-1), 11, 0, zone);
    else if (kind === "upcoming") at = zoned(dayOffset([1, 2, 3, 5][lead.callbackIndex - 6]), [10, 13, 15, 11][lead.callbackIndex - 6], 0, zone);
    else if (kind === "cancelled") at = zoned(dayOffset(2), 12, 0, zone);
    else at = zoned(dayOffset(-2), 10, 0, zone);
    const id = uid(`callback:${lead.key}`);
    const status = { due: "scheduled", overdue: "scheduled", upcoming: "scheduled", missed: "missed", cancelled: "cancelled", completed: "completed" }[kind];
    const note = pick(`${lead.key}:sub`, SUBTYPES);
    rows.push({ id, tenant_id: T, lead_id: lead.id, work_item_id: lead.wi, scheduled_at_utc: iso(at), customer_timezone: zone, assigned_to: owner.id, note, status, created_by: owner.id, created_at: iso(lead.dispoMs), updated_at: iso(lead.dispoMs), idempotency_key: `qa-m1-callback-${String(lead.callbackIndex + 1).padStart(2, "0")}`, missed_at: kind === "missed" ? iso(zoned(dayOffset(-1), 21, 0, zone)) : null, completed_at: kind === "completed" ? iso(at + 6 * MIN) : null, completed_via: kind === "completed" ? "manual" : null });
    history.push({ id: uid(`cbh:${lead.key}:scheduled`), tenant_id: T, callback_id: id, lead_id: lead.id, actor_user_id: owner.id, action: "scheduled", new_scheduled_at_utc: iso(at), new_status: "scheduled", note, created_at: iso(lead.dispoMs) });
    if (kind === "missed") history.push({ id: uid(`cbh:${lead.key}:missed`), tenant_id: T, callback_id: id, lead_id: lead.id, actor_user_id: null, action: "missed", old_scheduled_at_utc: iso(at), old_status: "scheduled", new_status: "missed", note: "The customer's calling window closed on the due day with no kept call", via: "system", created_at: iso(zoned(dayOffset(-1), 21, 0, zone)) });
    if (kind === "cancelled") history.push({ id: uid(`cbh:${lead.key}:cancelled`), tenant_id: T, callback_id: id, lead_id: lead.id, actor_user_id: owner.id, action: "cancelled", old_scheduled_at_utc: iso(at), old_status: "scheduled", new_status: "cancelled", via: "manual", created_at: ago(5 * HOUR) });
    if (kind === "completed") history.push({ id: uid(`cbh:${lead.key}:completed`), tenant_id: T, callback_id: id, lead_id: lead.id, actor_user_id: owner.id, action: "completed", old_scheduled_at_utc: iso(at), old_status: "due", new_status: "completed", via: "manual", created_at: iso(at + 6 * MIN) });
    audit(`callback:${lead.key}`, { actor_id: owner.id, action: "tenant.callback_scheduled", target_type: "callback", target_id: id, ts: iso(lead.dispoMs), metadata: { leadId: lead.id, workItemId: lead.wi, scheduledAtUtc: iso(at), customerTimezone: zone } });
  }
  await ensure("tenant_callbacks", rows);
  await ensure("callback_history", history);
  await flushAudit();
}

// ── D20 · notes ─────────────────────────────────────────────────────────────────────────────────
async function seedNotes(plan) {
  needLeads();
  const candidates = plan.filter((l) => l.kind === "dispositioned" && l.partner !== "northwind" && l.partner !== "bluebird");
  const notes = [], edits = [], mentions = [], mirrors = [];
  for (let i = 0; i < 40; i += 1) {
    const lead = candidates[(i * 7) % candidates.length];
    const author = person(i % 3 === 0 ? "ray" : i % 3 === 1 ? "la" : lead.owner);
    const shared = i % 4 === 1; // 10 shared
    const at = lead.dispoMs - (2 + (i % 5)) * MIN;
    const id = uid(`note:${i}`);
    let body = NOTE_BODIES[i % NOTE_BODIES.length];
    const mention = i === 6 || i === 21;
    if (mention) body = `@${ctx.la.name.split(" ")[0]} can you take the follow-up? ${body}`;
    const edited = [3, 12, 27].includes(i);
    const deleted = [9, 33].includes(i);
    notes.push({ id, tenant_id: T, lead_id: lead.id, author_user_id: author.id, body: edited ? `${body} (updated after the second call)` : body, visibility: shared ? "shared" : "internal", idempotency_key: `qa-m1-note-${String(i + 1).padStart(2, "0")}`, created_at: iso(at), edited_at: edited || deleted ? iso(at + 3 * HOUR) : null, deleted_at: deleted ? iso(at + 3 * HOUR) : null });
    if (edited) edits.push({ id: uid(`note-edit:${i}`), tenant_id: T, note_id: id, lead_id: lead.id, actor_user_id: author.id, action: "edited", old_body: body, old_visibility: shared ? "shared" : "internal", new_body: `${body} (updated after the second call)`, new_visibility: shared ? "shared" : "internal", created_at: iso(at + 3 * HOUR) });
    if (deleted) edits.push({ id: uid(`note-edit:${i}`), tenant_id: T, note_id: id, lead_id: lead.id, actor_user_id: author.id, action: "deleted", old_body: body, old_visibility: shared ? "shared" : "internal", new_body: null, new_visibility: shared ? "shared" : "internal", created_at: iso(at + 3 * HOUR) });
    if (mention) mentions.push({ id: uid(`note-mention:${i}`), tenant_id: T, note_id: id, mentioned_user_id: ctx.la.id, created_at: iso(at) });
    // lib/leadNotes syncPartnerNote: a shared note is mirrored into the partner channel.
    if (shared && !deleted) mirrors.push({ id: uid(`note-mirror:${i}`), tenant_id: T, partner_id: ctx.partners[lead.partner].id, channel_id: ctx.channel.get(ctx.partners[lead.partner].id), work_item_id: lead.wi, message: edited ? `${body} (updated after the second call)` : body, message_kind: "text", card_type: null, card_payload: {}, event_key: `lead-note:${id}`, created_by: author.id, created_at: iso(at + 1000) });
  }
  await ensure("tenant_lead_notes", notes);
  await ensure("lead_note_edits", edits);
  await ensure("lead_note_mentions", mentions);
  await ensure("partner_messages", mirrors);
}

// ── D18–D19 · channels, human messages, attachments, mentions, unread ───────────────────────────
const CHAT = [
  // [channel, author, days ago, text, extras]
  ["apex", "Dana Whitfield", 27, "Morning! We're live with the new FE script today, expect 10-15 transfers."],
  ["apex", "ray", 27, "Great, we have two buffers on from 9 to 5 Arizona time."],
  ["apex", "Marcus Bell", 22, "Transfer coming in 2 min, she's 71 and a little hard of hearing."],
  ["apex", "la", 22, "Got her, thanks Marcus. Verification done, going for the app."],
  ["apex", "Dana Whitfield", 18, "Attached the updated consent script, v3. Legal signed off.", { attach: ["consent-script-v3.pdf", "application/pdf"] }],
  ["apex", "ray", 18, "@Dana thanks, forwarding to the team.", { mentions: ["Dana Whitfield"] }],
  ["apex", "Keisha Grant", 12, "Is the 72h callback window still the rule for no-answers?"],
  ["apex", "la", 12, "Yes, anything we can't reach in 72h goes back to you as returned."],
  ["apex", "Dana Whitfield", 6, "We saw three DQs yesterday for age; should we cap at 80?"],
  ["apex", "ray", 6, "Please cap at 80 for FE, 65 for term."],
  ["apex", "Marcus Bell", 1, "Heads up, the lady from Tucson may call back on her own."],
  ["apex", "Keisha Grant", 0.2, "Two more coming in the next hour."],
  ["vertex", "Rafael Ortiz", 26, "Vertex team is set up, Nina and Caleb will be sending FE only for now."],
  ["vertex", "ray", 26, "Welcome aboard. FE only is approved on our side."],
  ["vertex", "Nina Shah", 19, "Customer asked for a Spanish speaker, sending her over now."],
  ["vertex", "es", 19, "La tengo, gracias Nina. Verifying now."],
  ["vertex", "Caleb Stone", 11, "Are you seeing our transfers drop at the IVR?"],
  ["vertex", "la", 11, "Two dropped yesterday, both before the agent picked up. Checking on our end."],
  ["vertex", "Rafael Ortiz", 4, "Rate change for next month was sent by email, can you confirm?"],
  ["vertex", "ray", 4, "Confirmed, it's in the system with the new effective date."],
  ["vertex", "Nina Shah", 0.1, "Sending a Spanish lead now."],
  ["harbor", "Tara Quinn", 24, "Harbor's September campaign is live: TV + mailers in NY and FL."],
  ["harbor", "ray", 24, "Nice. Form leads come in as marketing, we'll call within 5 minutes."],
  ["harbor", "Leo Marsh", 15, "Here's the lead count by day so far.", { attach: ["september-lead-counts.txt", "text/plain"] }],
  ["harbor", "la", 15, "Thanks Leo, conversion is looking better on the mailer leads."],
  ["harbor", "Tara Quinn", 7, "Ivy never accepted her invite, can you resend?"],
  ["harbor", "ray", 7, "Will do, her link expired."],
  ["harbor", "Leo Marsh", 2, "One of ours says she was called twice by two agencies. Duplicate?"],
  ["seniorsavers", "Grace Holt", 20, "Our fall mailer link is live, first clicks are coming in."],
  ["seniorsavers", "ray", 20, "Seeing them. Referrals land in the affiliate pipeline."],
  ["seniorsavers", "Grace Holt", 9, "Can we get a second link for Facebook?"],
  ["seniorsavers", "ray", 9, "Done, the facebook-sept link is active."],
  ["familyfirst", "Hank Rios", 17, "Church bulletin went out Sunday, expect a few this week."],
  ["familyfirst", "la", 16, "Two came in already, both FE."],
  ["bluebird", "Paula Reed", 14, "We're pausing sends while we redo our consent script."],
  ["bluebird", "ray", 9, "Paused on our side. Your history stays visible in the portal."],
  ["group", "ray", 25, "Floor channel for the inbound team. Buffers: hand off at 100% only."],
  ["group", "la", 25, "Got it."],
  ["group", "en", 21, "Stepping away 10 min, Tomas has the queue."],
  ["group", "es", 21, "Covering."],
  ["group", "ray", 14, "@Marisol can you take the Vertex overflow this afternoon?", { mentions: ["la"] }],
  ["group", "la", 14, "Yes, on it."],
  ["group", "en", 8, "Reminder: DNC-warned leads need the acknowledgment before we dial."],
  ["group", "ray", 3, "Great week team, 30+ submitted apps."],
  ["group", "es", 1, "Spanish transfers are up this week, I can take more."],
  ["group", "la", 0.3, "Callback list for today is long, I'll take the NY ones."],
  ["group", "ray", 0.15, "Thanks. Queue is building, everyone on ready please."],
  ["dm", "ray", 10, "Can you cover the owner review on Friday?"],
  ["dm", "la", 10, "Sure, what time?"],
  ["dm", "ray", 10, "2pm, I'll send the invite."],
  ["dm", "la", 2, "The two sold-twice customers are flagged in pre-flight now."],
  ["dm", "ray", 0.4, "Perfect, show that in the demo."],
];

async function seedChat() {
  const idOf = (ref) => ref === "ray" ? ctx.ray.id : ref === "la" ? ctx.la.id : ref === "en" ? ctx.bufferEn.id : ref === "es" ? ctx.bufferEs.id : ctx.partnerUsers[ref];
  const groupId = uid("channel:group");
  const dmId = uid("channel:dm");
  const team = [ctx.ray.id, ctx.la.id, ...ctx.buffers.map((b) => b.id)];
  await ensure("partner_channels", [
    { id: groupId, tenant_id: T, partner_id: null, channel_type: "group", name: "QA · Floor team", status: "active", created_by: ctx.ray.id, created_at: ago(25 * DAY + HOUR) },
    { id: dmId, tenant_id: T, partner_id: null, channel_type: "direct", name: "Direct message", status: "active", created_by: ctx.ray.id, created_at: ago(10 * DAY + HOUR), direct_key: [ctx.ray.id, ctx.la.id].sort().join(":") },
  ]);
  await ensureComposite("partner_channel_members", [...new Set(team)].map((user_id) => ({ channel_id: groupId, tenant_id: T, user_id, created_at: ago(25 * DAY) })), ["channel_id", "user_id"]);
  await ensureComposite("partner_channel_members", [ctx.ray.id, ctx.la.id].map((user_id) => ({ channel_id: dmId, tenant_id: T, user_id, created_at: ago(10 * DAY) })), ["channel_id", "user_id"]);
  const channelFor = (key) => key === "group" ? groupId : key === "dm" ? dmId : ctx.channel.get(ctx.partners[key].id) ?? uid(`channel:${key}`);
  const messages = [], attachments = [], mentions = [];
  CHAT.forEach(([channel, author, days, text, extra = {}], i) => {
    const id = uid(`chat:${i}`);
    const at = NOW.getTime() - days * DAY + (i % 7) * MIN;
    messages.push({ id, tenant_id: T, partner_id: channel === "group" || channel === "dm" ? null : ctx.partners[channel].id, channel_id: channelFor(channel), work_item_id: null, message: text, message_kind: "text", card_type: null, card_payload: {}, event_key: null, created_by: idOf(author) ?? null, created_at: iso(at) });
    for (const who of extra.mentions ?? []) mentions.push({ id: uid(`chat-mention:${i}:${who}`), tenant_id: T, message_id: id, mentioned_user_id: idOf(who), created_at: iso(at) });
    if (extra.attach) {
      const [fileName, contentType] = extra.attach;
      const fileId = uid(`chat-file:${i}`);
      attachments.push({ id: fileId, tenant_id: T, message_id: id, file_name: fileName, storage_path: `${T}/${channelFor(channel)}/${id}/${fileId}-${fileName}`, content_type: contentType, size_bytes: 0, created_by: idOf(author), created_at: iso(at) });
    }
  });
  await ensure("partner_messages", messages);
  await ensure("partner_message_mentions", mentions);
  // Attachments: a real object in the partner-chat bucket so the download link works.
  const existing = new Set(must(await db.from("partner_message_attachments").select("id").in("id", attachments.map((a) => a.id)), "attachments").map((a) => a.id));
  for (const file of attachments) {
    const body = file.content_type === "application/pdf"
      ? Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n")
      : Buffer.from("date,leads\n2026-09-01,14\n2026-09-02,11\n2026-09-03,17\n(QA demo file)\n");
    file.size_bytes = body.length;
    if (existing.has(file.id)) { stat("partner_message_attachments", "kept"); continue; }
    if (!DRY) {
      const up = await db.storage.from("partner-chat-attachments").upload(file.storage_path, body, { contentType: file.content_type, upsert: true });
      if (up.error) { problem(`upload ${file.file_name}`, up.error); continue; }
      must(await db.from("partner_message_attachments").insert(file), "attachment insert");
      stat("storage objects", "inserted");
    }
    stat("partner_message_attachments", "inserted");
  }
  // agent_ready cards (postAgentReadyCards): every active partner channel, per ready transition.
  const readyCards = [];
  const activeKeys = PARTNERS.filter((p) => p.final === "active").map((p) => p.key);
  for (const [who, days] of [["ray", 3], ["la", 1]]) {
    const user = person(who);
    const transitionKey = `qa-${days}d`;
    for (const key of activeKeys) {
      const partnerId = ctx.partners[key].id;
      readyCards.push({ id: uid(`card:ready:${who}:${key}`), tenant_id: T, partner_id: partnerId, channel_id: channelFor(key), work_item_id: null, message: `${user.name} is ready to take transfers`, message_kind: "system_card", card_type: "agent_ready", card_payload: { customer: "Customer", agent: user.name, product: "lead", disposition: "Call outcome", qa_seed: TAG }, event_key: `agent-ready:${T}:${user.id}:${transitionKey}:${partnerId}`, created_by: user.id, created_at: ago(days * DAY - 2 * HOUR) });
    }
  }
  await ensure("partner_messages", readyCards);
  // Read state: Ray is behind on Apex and the floor channel (unread badges); caught up elsewhere.
  const reads = [];
  for (const key of ["apex", "vertex", "harbor", "seniorsavers", "familyfirst", "bluebird", "group", "dm"]) {
    reads.push({ channel_id: channelFor(key), tenant_id: T, user_id: ctx.ray.id, read_at: ["apex", "group"].includes(key) ? ago(2 * DAY) : iso(NOW.getTime()) });
  }
  reads.push({ channel_id: channelFor("apex"), tenant_id: T, user_id: ctx.partnerUsers["Dana Whitfield"], read_at: ago(1 * DAY) });
  reads.push({ channel_id: channelFor("group"), tenant_id: T, user_id: ctx.la.id, read_at: ago(3 * HOUR) });
  await ensureComposite("partner_message_reads", reads.filter((r) => r.user_id), ["channel_id", "user_id"]);
}

// ── D3 · drafts on older form versions ──────────────────────────────────────────────────────────
async function seedDrafts() {
  if (!ctx.templates?.final_expense) throw new Error("skipped: the FE form (D3) is not in place");
  const apex = ctx.partners.apex.id;
  const rows = [
    { id: uid("draft:fe-v1"), tenant_id: T, partner_id: apex, user_id: ctx.partnerUsers["Marcus Bell"], product_code: "final_expense", tenant_template_id: ctx.templates.final_expense.id, definition_version: 1, payload: { first_name: "Imogene", last_name: "Crenshaw", phone: "(520) 555-0188", state: "AZ", qa_seed: TAG }, created_at: ago(12 * DAY), updated_at: ago(12 * DAY) },
    { id: uid("draft:tl-old"), tenant_id: T, partner_id: apex, user_id: ctx.partnerUsers["Keisha Grant"], product_code: "term_life", tenant_template_id: ctx.templates.term_life.id, definition_version: Math.max(1, ctx.templates.term_life.current - 1), payload: { first_name: "Otis", last_name: "Rutledge", phone: "(512) 555-0189", state: "TX", qa_seed: TAG }, created_at: ago(9 * DAY), updated_at: ago(9 * DAY) },
  ].filter((r) => r.user_id);
  await ensure("form_drafts", rows);
}

// ── D10–D11 · the floor right now ───────────────────────────────────────────────────────────────
async function formFieldsFor(lead) {
  const version = lead.defVersion ?? versionAt(lead.product, lead.createdMs);
  const rev = must(await db.from("tenant_template_revisions").select("fields, form_definition").eq("tenant_template_id", ctx.templates[lead.product].id).eq("revision", version).single(), "revision");
  const byKey = new Map(rev.fields.map((field) => [field.field_key, field]));
  const entries = rev.form_definition.sections.flatMap((section) => section.fields).filter((ff) => byKey.has(ff.field_key));
  const unique = [...new Map(entries.map((ff) => [ff.field_key, ff])).values()];
  return unique.map((ff) => ({ key: ff.field_key, required: Boolean(ff.is_required || byKey.get(ff.field_key).is_required) }));
}

async function claimLive(lead, actor, confirmCount) {
  const claim = await rpc("claim_transfer_lead", { p_tenant_id: T, p_work_item_id: lead.wi, p_user_id: actor.id, p_owner_role: actor.role });
  stat("lead_queue (live claims)", "updated"); stat("active_calls", "inserted"); stat("tenant_verification_sessions", "inserted");
  const name = nameOf(lead);
  const partner = ctx.partners[lead.partner];
  const isBuffer = actor.role === "assistant";
  // announceTransferClaim: the partner card and the audit row.
  await ensure("partner_messages", [{ id: uid(`card:claim:${lead.key}`), tenant_id: T, partner_id: partner.id, channel_id: ctx.channel.get(partner.id), work_item_id: lead.wi, message: isBuffer ? `${name} is connected to the buffer agent` : `${name} is connected to the agent`, message_kind: "system_card", card_type: isBuffer ? "transferred" : "connected", card_payload: { customer: name, agent: actor.name, product: lead.product, disposition: "Call outcome", state: lead.state, qa_seed: TAG }, event_key: isBuffer ? `buffer-claim:${lead.wi}` : `claim:${lead.wi}`, created_by: actor.id }]);
  audit(`claimed:${lead.key}:${claim.verification_session_id}`, { actor_id: actor.id, action: "tenant.transfer_claimed", target_type: "lead_queue", target_id: lead.wi, metadata: { activeCallId: claim.active_call_id, verificationSessionId: claim.verification_session_id, chatPosted: true } });
  // getVerificationPanel seeds the checklist; update_verification_field confirms fields.
  const fields = await formFieldsFor(lead);
  await ensureComposite("verification_fields", fields.map((field) => ({ session_id: claim.verification_session_id, field_key: field.key, state: "outstanding", is_required: field.required, is_visible: true })), ["session_id", "field_key"]);
  const required = fields.filter((field) => field.required).map((field) => field.key);
  const visible = fields.map((field) => field.key);
  let progress = 0;
  for (const key of required.slice(0, confirmCount)) {
    const result = await rpc("update_verification_field", { p_tenant_id: T, p_session_id: claim.verification_session_id, p_work_item_id: lead.wi, p_user_id: actor.id, p_field_key: key, p_state: "confirmed", p_new_value: null, p_required_keys: required, p_visible_keys: visible, p_ip: null, p_user_agent: "qa-seed" });
    progress = result.progress_percentage;
    stat("verification_fields", "updated");
  }
  return { ...claim, progress, requiredCount: required.length };
}

async function seedLive(plan) {
  needLeads();
  const unclaimed = plan.filter((l) => l.kind === "unclaimed");
  const live = plan.filter((l) => l.kind === "live").sort((a, b) => (a.live === "L4" ? -1 : b.live === "L4" ? 1 : a.live.localeCompare(b.live)));
  if (REFRESH && !DRY) {
    for (const lead of unclaimed) {
      const q = must(await db.from("lead_queue").select("status").eq("id", lead.wi).maybeSingle(), "queue");
      if (!q || !["unclaimed", "expired"].includes(q.status)) { console.log(`  ${lead.key} is ${q?.status ?? "missing"} (someone worked it); left alone`); continue; }
      const queued = NOW.getTime() - lead.waitSeconds * 1000;
      must(await db.from("lead_queue").update({ status: "unclaimed", queued_at: iso(queued), created_at: iso(queued), sla_warned_at: null, sla_escalated_at: null, sla_partner_notified_at: null, sla_expired_at: null }).eq("id", lead.wi), "requeue");
      must(await db.from("agent_leads").update({ created_at: iso(queued - 1000) }).eq("id", lead.id), "lead time");
      must(await db.from("deal_flow").update({ local_date: localDate(queued, ctx.partners[lead.partner].tz) }).eq("lead_id", lead.id), "deal date");
      must(await db.from("partner_messages").update({ created_at: iso(queued + 1500) }).eq("id", uid(`card:new:${lead.key}`)), "card time");
      stat("lead_queue (refresh)", "updated");
    }
    for (const lead of live) {
      const q = must(await db.from("lead_queue").select("status, disposition").eq("id", lead.wi).maybeSingle(), "queue");
      if (!q || q.disposition) { console.log(`  ${lead.key} was dispositioned by someone; left alone`); continue; }
      const nowIso = iso(Date.now());
      must(await db.from("active_calls").update({ ended_at: nowIso }).eq("work_item_id", lead.wi).is("ended_at", null), "end calls");
      must(await db.from("tenant_verification_sessions").update({ status: "closed", ended_at: nowIso }).eq("work_item_id", lead.wi).is("ended_at", null), "close sessions");
      must(await db.from("buffer_handoffs").update({ status: "returned", returned_at: nowIso }).eq("work_item_id", lead.wi).eq("status", "pending"), "return handoffs");
      const queued = NOW.getTime() - lead.waitSeconds * 1000;
      must(await db.from("lead_queue").update({ status: "unclaimed", owner_user_id: null, claimed_by: null, owner_role: null, buffer_user_id: null, claimed_at: null, queued_at: iso(queued), sla_warned_at: null, sla_escalated_at: null, sla_partner_notified_at: null, sla_expired_at: null }).eq("id", lead.wi), "reset live");
      stat("lead_queue (refresh)", "updated");
    }
  }
  const results = {};
  for (const lead of live) {
    const q = DRY ? null : must(await db.from("lead_queue").select("status").eq("id", lead.wi).maybeSingle(), "queue");
    if (DRY) { stat("lead_queue (live claims)", "inserted"); continue; }
    if (q?.status !== "unclaimed") { stat("lead_queue (live claims)", "kept"); continue; }
    const en = person("en"), es = person("es"), x = { ...ctx.bufferX, role: "assistant" }, la = person("la"), ray = person("ray");
    if (lead.live === "L4") {
      const c = await claimLive(lead, en, 99);
      const offer = await rpc("offer_buffer_handoff", { p_tenant_id: T, p_work_item_id: lead.wi, p_buffer_user_id: en.id, p_target_user_id: la.id, p_timeout_seconds: 300, p_ip: null, p_user_agent: "qa-seed" });
      const accepted = await rpc("accept_buffer_handoff", { p_tenant_id: T, p_handoff_id: offer.handoff_id, p_licensed_agent_id: la.id, p_ip: null, p_user_agent: "qa-seed" });
      stat("buffer_handoffs", "inserted");
      const name = nameOf(lead);
      await ensure("partner_messages", [{ id: uid(`card:accept:${lead.key}:${offer.handoff_id}`), tenant_id: T, partner_id: ctx.partners[lead.partner].id, channel_id: ctx.channel.get(ctx.partners[lead.partner].id), work_item_id: lead.wi, message: `${la.name} accepted the transfer for ${name}`, message_kind: "system_card", card_type: "transferred", card_payload: { customer: name, agent: la.name, product: lead.product, disposition: "Call outcome", state: lead.state, qa_seed: TAG }, event_key: `handoff-accepted:${offer.handoff_id}`, created_by: la.id }]);
      results.L4 = `la_active with ${la.name} (from ${en.name}), ${accepted.progress_percentage}%`;
    } else if (lead.live === "L1") { const c = await claimLive(lead, en, 3); results.L1 = `buffer_active ${en.name}, ${c.progress}% (${c.requiredCount} required)`; }
    else if (lead.live === "L2") { const c = await claimLive(lead, es, 7); results.L2 = `buffer_active ${es.name} (Spanish lead), ${c.progress}% (${c.requiredCount} required)`; }
    else if (lead.live === "L3") {
      const c = await claimLive(lead, x, 99);
      await rpc("offer_buffer_handoff", { p_tenant_id: T, p_work_item_id: lead.wi, p_buffer_user_id: x.id, p_target_user_id: ray.id, p_timeout_seconds: 300, p_ip: null, p_user_agent: "qa-seed" });
      stat("buffer_handoffs", "inserted");
      results.L3 = `handed_pending ${x.name} → ${ray.name}, ${c.progress}% (expires in 5 min)`;
    } else if (lead.live === "L5") { const c = await claimLive(lead, ray, 2); results.L5 = `claimed by ${ray.name}, ${c.progress}%`; }
  }
  await flushAudit();
  if (Object.keys(results).length) console.log(`  live: ${JSON.stringify(results, null, 1)}`);
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  await loadContext();
  await section("D1 team (reused members, Spanish buffer, presence)", seedTeam);
  await section("D3 products and forms", seedProducts);
  await section("D4-D7 partners, lifecycle, products, terms", seedPartners);
  await section("D6 affiliate links", seedAffiliateLinks);
  await section("D8 partner users and invites", seedPartnerUsers);
  await section("D2 limits (this tenant's private plan)", seedLimits);
  const plan = buildPlan();
  const count = (kind) => plan.filter((l) => l.kind === kind).length;
  console.log(`  plan: ${plan.length} leads · dispositioned ${count("dispositioned")} · unclaimed ${count("unclaimed")} · live ${count("live")} · expired ${count("expired")} · claimed/no call ${count("claimed_nocall")} · intake failure ${count("failure")} · manual ${count("manual")} · affiliate ${plan.filter((l) => l.type === "affiliate").length} · marketing ${plan.filter((l) => l.type === "marketing").length} · FE ${plan.filter((l) => l.product === "final_expense").length} · TL ${plan.filter((l) => l.product === "term_life").length} · IUL ${plan.filter((l) => l.product === "iul").length} · screening ${JSON.stringify(plan.reduce((a, l) => ({ ...a, [l.screening + (l.dncInternal ? "(internal list)" : "")]: (a[l.screening + (l.dncInternal ? "(internal list)" : "")] ?? 0) + 1 }), {}))} · overrides ${plan.filter((l) => l.justification).length} · planned pre-flight ${JSON.stringify(plan.filter((l) => l.expect).map((l) => l.expect))} · dispositions ${JSON.stringify(plan.filter((l) => l.disposition).reduce((a, l) => ({ ...a, [l.disposition]: (a[l.disposition] ?? 0) + 1 }), {}))}`);
  await section("D9-D17 D24 leads, work items, calls, verification, deal flow, screening, SLA history", () => seedLeads(plan));
  await section("D19 cards", seedCards);
  await section("D16 pre-flight", () => seedPreflight(plan));
  await section("D21 callbacks", () => seedCallbacks(plan));
  await section("D20 notes", () => seedNotes(plan));
  await section("D18-D19 channels and messages", seedChat);
  await section("D3 drafts", seedDrafts);
  await section("D10-D11 live floor", () => seedLive(plan));
  await flushAudit().catch((error) => problem("audit flush", error));

  console.log(`\n${DRY ? "DRY RUN — nothing was written. " : ""}Summary`);
  const rows = [...stats.entries()].sort(([a], [b]) => a.localeCompare(b));
  const width = Math.max(...rows.map(([table]) => table.length), 5);
  console.log(`${"table".padEnd(width)}  inserted  updated  kept`);
  for (const [table, s] of rows) console.log(`${table.padEnd(width)}  ${String(s.inserted).padStart(8)}  ${String(s.updated).padStart(7)}  ${String(s.kept).padStart(4)}`);
  if (PASSWORD) console.log(`\nPassword for the new sign-in accounts (printed once, not stored anywhere): ${PASSWORD}\n  ${signInUsers.join("\n  ")}`);
  if (problems.length) { console.log(`\n${problems.length} problem(s):\n  ${problems.join("\n  ")}`); process.exitCode = 1; }
}

await main().catch((error) => { console.error(error.message); process.exitCode = 1; });
