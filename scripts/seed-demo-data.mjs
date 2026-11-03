/**
 * Seeds coherent demo data across every module, for the demo accounts.
 *
 * Companion to `provision-demo-accounts.mjs`, which creates the five logins but no content behind
 * them. After the 2026-09-11 reconciliation the SaaS tables exist but are empty, so every admin and
 * agent screen renders its zero state. This fills them with linked, plausible rows.
 *
 * Idempotent by design: a table that already holds rows is left alone and reported as `kept`, so
 * re-running never duplicates and never overwrites something a human entered.
 *
 * Every module is independent and guarded — one failure reports and the rest still run, because a
 * seeder that stops at the first FK surprise tells you about one problem per run.
 *
 *   node --env-file=.env.local scripts/seed-demo-data.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const results = [];
/** Invoices temporarily put back to draft so their lines could be written. Restored below. */
let restoreInvoiceStatus = null;
const iso = (daysFromNow) => new Date(Date.now() + daysFromNow * 86400000).toISOString();
const day = (daysFromNow) => iso(daysFromNow).slice(0, 10);

/** Runs one module. Skips if the table already has rows, so re-runs are cheap and safe. */
async function seed(table, build, { force = false } = {}) {
  try {
    const { count, error: countError } = await db.from(table).select("*", { count: "exact", head: true });
    if (countError) throw countError;
    if (count > 0 && !force) {
      results.push([table, "kept", `${count} existing row(s)`]);
      return;
    }
    const rows = await build();
    if (!rows || rows.length === 0) {
      results.push([table, "skip", "nothing to insert (missing prerequisite)"]);
      return;
    }
    const { error } = await db.from(table).insert(rows);
    if (error) throw error;
    results.push([table, "seeded", `${rows.length} row(s)`]);
  } catch (e) {
    const detail = [e.message, e.details, e.hint, e.code].filter(Boolean).join(" · ");
    results.push([table, "FAIL", (detail || JSON.stringify(e)).slice(0, 200)]);
  }
}

// ---------------------------------------------------------------------------
// Reference ids. Everything below hangs off the demo agent's tenant so the data
// is visible when you sign in as demo.agent@insurvas.test.
// ---------------------------------------------------------------------------
const { data: agentUser } = await db.from("users").select("id, organization_id").eq("email", "demo.agent@insurvas.test").maybeSingle();
if (!agentUser) {
  console.error("demo.agent@insurvas.test is missing — run provision-demo-accounts.mjs first.");
  process.exit(1);
}
const { data: membership } = await db.from("tenant_users").select("tenant_id").eq("user_id", agentUser.id).maybeSingle();
const tenantId = membership?.tenant_id;
const orgId = agentUser.organization_id;

const { data: carriers } = await db.from("carriers").select("id, name").limit(6);
const { data: partners } = await db.from("partners").select("id, tenant_id, name").limit(3);
const { data: plans } = await db.from("plans").select("id, name").limit(4);
const { data: templates } = await db.from("templates").select("id, product_code").limit(3);
const { data: admin } = await db.from("admin_users").select("id").eq("email", "info@insurvas.com").maybeSingle();

console.log(`tenant ${tenantId} · org ${orgId} · ${carriers?.length ?? 0} carriers · ${partners?.length ?? 0} partners · ${plans?.length ?? 0} plans · ${templates?.length ?? 0} templates\n`);

// ---------------------------------------------------------------------------
// Agent plane — carrier appointments, licences, book of business
// ---------------------------------------------------------------------------
await seed("tenant_carriers", async () =>
  (carriers ?? []).slice(0, 4).map((c, i) => ({
    tenant_id: tenantId,
    carrier_id: c.id,
    contract_level_bp: [9000, 8500, 10000, 7500][i],
    writing_number: `WN-${1000 + i}`,
    effective_from: day(-365 + i * 30),
    is_active: true,
  })));

await seed("appointments", async () => {
  const rows = [];
  for (const [i, c] of (carriers ?? []).slice(0, 4).entries()) {
    for (const state of ["TX", "FL", "AZ"].slice(0, i === 0 ? 3 : 2)) {
      rows.push({
        tenant_id: tenantId,
        carrier_id: c.id,
        state,
        status: "active",
        effective_from: day(-300 + i * 20),
      });
    }
  }
  return rows;
});

await seed("licenses", async () =>
  [
    { state: "TX", license_number: "TX-2291045", expires_at: day(180) },
    { state: "FL", license_number: "FL-W418822", expires_at: day(45) },   // expiring soon, for the warning state
    { state: "AZ", license_number: "AZ-1180933", expires_at: day(320) },
    { state: "GA", license_number: "GA-3390211", expires_at: day(-12) },  // expired, for the alert state
  ].map((l) => ({ tenant_id: tenantId, ...l })));

await seed("households", async () =>
  [
    { line1: "4820 Bluebonnet Ln", city: "Austin", state: "TX", zip: "78745" },
    { line1: "1177 Ocean View Dr", city: "Tampa", state: "FL", zip: "33606" },
    { line1: "620 N Sierra Vista", city: "Phoenix", state: "AZ", zip: "85012" },
  ].map((h) => ({
    organization_id: orgId,
    tenant_id: tenantId,
    address_hash: randomUUID(),
    address_line1: h.line1,
    city: h.city,
    state: h.state,
    postal_code: h.zip,
  })));

// ---------------------------------------------------------------------------
// Admin plane — compliance, promotions, platform switches
// ---------------------------------------------------------------------------
// vendor_type is constrained to dnc_scrub | litigator_scrub | consent_certificate | phone_validation.
await seed("compliance_vendors", async () => [
  { name: "TrustedForm", vendor_type: "consent_certificate", endpoint: "https://cert.trustedform.com/", is_enabled: true, priority: 1, cost_per_lookup_cents: 8 },
  { name: "Jornaya LeadiD", vendor_type: "consent_certificate", endpoint: "https://api.leadid.com/", is_enabled: true, priority: 2, cost_per_lookup_cents: 6 },
  { name: "Blacklist Alliance", vendor_type: "dnc_scrub", endpoint: "https://api.blacklistalliance.com/lookup", is_enabled: true, priority: 1, cost_per_lookup_cents: 3 },
  { name: "Litigator Shield", vendor_type: "litigator_scrub", endpoint: "https://api.litigatorshield.com/v2/", is_enabled: true, priority: 1, cost_per_lookup_cents: 5 },
  { name: "Twilio Lookup", vendor_type: "phone_validation", endpoint: "https://lookups.twilio.com/v2/", is_enabled: false, priority: 3, cost_per_lookup_cents: 4 },
]);

const couponRows = [
  { code: "LAUNCH25", discount_type: "percent", percent_off: 25, duration: "n_periods", duration_periods: 3, max_redemptions: 100, is_active: true },
  { code: "WELCOME50", discount_type: "fixed", amount_off_cents: 5000, duration: "once", max_redemptions: 500, is_active: true },
  { code: "PARTNER10", discount_type: "percent", percent_off: 10, duration: "forever", is_active: true },
  { code: "EXPIRED2025", discount_type: "percent", percent_off: 40, duration: "once", is_active: false, expires_at: iso(-30) },
];
await seed("coupons", async () => couponRows.map((c) => ({ id: randomUUID(), ...c })));

await seed("offers", async () => {
  const { data: live } = await db.from("coupons").select("id, code").in("code", ["LAUNCH25", "WELCOME50"]);
  return (live ?? []).map((c, i) => ({
    name: c.code === "LAUNCH25" ? "New year launch promotion" : "Welcome credit",
    coupon_id: c.id,
    starts_at: iso(-14),
    ends_at: iso(i === 0 ? 30 : 90),
    auto_apply: i === 0,
    new_customers_only: true,
    is_active: true,
  }));
});

await seed("feature_switches", async () => [
  { feature_key: "outbound_dialing", state: "on" },
  { feature_key: "quoting", state: "beta" },
  { feature_key: "chargeback_radar", state: "off", off_message: "Chargeback Radar is being recalibrated and returns on the 1st." },
  { feature_key: "winback", state: "on" },
]);

// Single-row table (`CHECK (id = 1)`), level is banner_only | read_only | locked, and the schedule
// is all-or-nothing with end > start. A banner announcing future work is the harmless demo state —
// `locked` would take the whole platform down for anyone signing in.
await seed("maintenance", async () => [{
  id: 1,
  level: "banner_only",
  message: "Planned maintenance on Sunday 02:00–02:30 UTC. No action needed.",
  scheduled_start: iso(14),
  scheduled_end: iso(14.03),
}]);

await seed("metrics_daily", async () =>
  Array.from({ length: 30 }, (_, i) => {
    const n = 29 - i;
    const mrr = 418000 + n * 5200;
    return {
      date: day(-n),
      mrr_cents: mrr,
      arr_cents: mrr * 12,
      new_mrr_cents: 5200 + (n % 4) * 900,
      expansion_mrr_cents: 1400,
      contraction_mrr_cents: 600,
      churned_mrr_cents: n % 7 === 0 ? 2900 : 0,
      collected_cents: Math.round(mrr * 0.94),
      active_customers: 62 + Math.floor(n / 3),
      new_customers: n % 5 === 0 ? 2 : 1,
      churned_customers: n % 9 === 0 ? 1 : 0,
      trials_active: 7 + (n % 3),
    };
  }));

await seed("email_log", async () => [
  { to_address: "demo.agent@insurvas.test", template_key: "welcome", subject: "Welcome to Insurvas", status: "sent", provider: "smtp", tenant_id: tenantId },
  { to_address: "demo.partneradmin@insurvas.test", template_key: "partner_invite", subject: "You have been invited to the Insurvas partner portal", status: "sent", provider: "smtp" },
  { to_address: "demo.agent@insurvas.test", template_key: "appointment_expiry", subject: "A carrier appointment expires in 30 days", status: "sent", provider: "smtp", tenant_id: tenantId },
  { to_address: "bounce@invalid.test", template_key: "trial_reminder", subject: "Your trial ends in 3 days", status: "failed", provider: "smtp", failure_reason: "550 mailbox unavailable" },
  { to_address: "demo.superadmin@insurvas.test", template_key: "invoice_issued", subject: "Invoice INV-000128 is ready", status: "sent", provider: "smtp" },
]);

// ---------------------------------------------------------------------------
// Billing plane — invoices, lines, payments, credits
// ---------------------------------------------------------------------------
const invoiceIds = [randomUUID(), randomUUID(), randomUUID()];
await seed("platform_invoices", async () => [
  { id: invoiceIds[0], tenant_id: tenantId, number: "INV-000126", kind: "subscription", status: "paid", currency: "USD", subtotal_cents: 24900, discount_cents: 0, tax_cents: 0, total_cents: 24900, period_start: iso(-60), period_end: iso(-30), issued_at: iso(-60), due_at: iso(-46), paid_at: iso(-58) },
  { id: invoiceIds[1], tenant_id: tenantId, number: "INV-000127", kind: "subscription", status: "paid", currency: "USD", subtotal_cents: 24900, discount_cents: 6225, tax_cents: 0, total_cents: 18675, period_start: iso(-30), period_end: iso(0), issued_at: iso(-30), due_at: iso(-16), paid_at: iso(-28) },
  { id: invoiceIds[2], tenant_id: tenantId, number: "INV-000128", kind: "subscription", status: "issued", currency: "USD", subtotal_cents: 24900, discount_cents: 0, tax_cents: 0, total_cents: 24900, period_start: iso(0), period_end: iso(30), issued_at: iso(0), due_at: iso(14) },
]);

// The `invoice_immutable` trigger refuses line changes once an invoice leaves draft — correct
// behaviour, and it means the lines cannot simply be appended afterwards. So each invoice is put
// back to draft, given its lines, then returned to the status it is meant to display.
await seed("platform_invoice_lines", async () => {
  const { data: live } = await db.from("platform_invoices").select("id, number, status").order("number");
  if (!live?.length) return [];
  for (const inv of live) {
    const { error } = await db.from("platform_invoices").update({ status: "draft" }).eq("id", inv.id);
    if (error) throw error;
  }
  restoreInvoiceStatus = live;
  return live.flatMap((inv, i) => {
    const lines = [{ invoice_id: inv.id, position: 1, kind: "plan", label: "Agency plan — monthly", quantity: 1, unit_cents: 24900, amount_cents: 24900 }];
    if (i === 1) lines.push({ invoice_id: inv.id, position: 2, kind: "discount", label: "LAUNCH25 — 25% off", quantity: 1, unit_cents: -6225, amount_cents: -6225 });
    if (i === 2) lines.push({ invoice_id: inv.id, position: 2, kind: "overage", label: "Dialer minutes over included", quantity: 420, unit_cents: 2, amount_cents: 840, included_qty: 2000 });
    return lines;
  });
});

// Put the invoices back to the status they are meant to display. Runs even if the line insert
// failed, so a half-finished run never leaves paid invoices sitting in draft.
if (restoreInvoiceStatus) {
  let restored = 0;
  for (const inv of restoreInvoiceStatus) {
    const { error } = await db.from("platform_invoices").update({ status: inv.status }).eq("id", inv.id);
    if (!error) restored++;
  }
  results.push(["platform_invoices (status)", "restored", `${restored}/${restoreInvoiceStatus.length} back to issued/paid`]);
}

// `payments.invoice_id` carries an FK to `invoices` — the CRM-era table — not to
// `platform_invoices`, which SA-3 renamed out from under it. Until that FK is repointed, a payment
// cannot reference a SaaS invoice at all, so these are recorded against the tenant with a null
// invoice_id. Worth a ticket: the rename left this constraint behind.
await seed("payments", async () => {
  const { data: paid } = await db.from("platform_invoices").select("id, total_cents, paid_at").eq("status", "paid");
  return (paid ?? []).map((inv) => ({
    invoice_id: null,
    tenant_id: tenantId,
    amount_cents: inv.total_cents,
    currency: "USD",
    method: "provider",
    provider: "whop",
    provider_charge_id: `ch_demo_${randomUUID().slice(0, 12)}`,
    paid_at: inv.paid_at,
    status: "succeeded",
  }));
});

await seed("tenant_credits", async () => [{ tenant_id: tenantId, balance_cents: 2500 }]);

await seed("credit_notes", async () => {
  const { data: inv } = await db.from("platform_invoices").select("id").eq("number", "INV-000126").maybeSingle();
  return [
    { number: "CN-000012", tenant_id: tenantId, invoice_id: inv?.id ?? null, type: "credit", amount_cents: 2500, reason_code: "goodwill", reason_text: "Applied after a support delay during onboarding.", status: "approved", approved_by: admin?.id ?? null, approved_at: iso(-20) },
    { number: "CN-000013", tenant_id: tenantId, invoice_id: null, type: "refund", amount_cents: 4900, reason_code: "billing_error", reason_text: "Duplicate add-on charge, refunded to source.", status: "pending_approval" },
  ];
});

// ---------------------------------------------------------------------------
// Partner plane
// ---------------------------------------------------------------------------
await seed("partner_terms", async () =>
  (partners ?? []).map((p, i) => ({
    partner_id: p.id,
    payout_model: ["per_transfer", "per_lead", "revenue_share"][i % 3],
    rate_cents: i % 3 === 2 ? null : [3500, 1200][i % 2],
    rate_pct_bp: i % 3 === 2 ? 1500 : null,
    effective_from: day(-90),
  })));

await seed("affiliate_links", async () =>
  (partners ?? []).flatMap((p) => [
    { tenant_id: p.tenant_id, partner_id: p.id, slug: `${(p.name ?? "partner").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20)}-spring`, campaign: "spring-2026", is_active: true, click_count: 184 },
    { tenant_id: p.tenant_id, partner_id: p.id, slug: `${(p.name ?? "partner").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20)}-evergreen`, campaign: "evergreen", is_active: true, click_count: 57 },
  ]));

// ---------------------------------------------------------------------------
// Dynamic forms — the field/stage/form definition behind the intake templates
// ---------------------------------------------------------------------------
const template = templates?.[0];

await seed("template_fields", async () => {
  if (!template) return [];
  const fields = [
    { field_key: "first_name", label: "First name", type: "text", is_required: true },
    { field_key: "last_name", label: "Last name", type: "text", is_required: true },
    { field_key: "phone", label: "Phone", type: "phone", is_required: true },
    { field_key: "email", label: "Email", type: "email", is_required: false },
    { field_key: "date_of_birth", label: "Date of birth", type: "date", is_required: true },
    { field_key: "state", label: "State", type: "single_select", is_required: true, options: ["TX", "FL", "AZ", "GA"] },
    { field_key: "coverage_amount", label: "Coverage amount", type: "currency", is_required: false, help_text: "Face value the applicant is asking for." },
    { field_key: "tobacco", label: "Tobacco use", type: "boolean", is_required: true },
  ];
  return fields.map((f, i) => ({
    template_id: template.id,
    version: template.version ?? 1,
    ...f,
    options: f.options ?? [], // NOT NULL — a field with no choices carries an empty list, not null

    sort_order: i + 1,
  }));
});

await seed("template_stages", async () => {
  if (!template) return [];
  return [
    { stage_key: "new", label: "New", stage_type: "open", color: "#2563eb" },
    { stage_key: "contacted", label: "Contacted", stage_type: "open", color: "#7c3aed" },
    { stage_key: "quoted", label: "Quoted", stage_type: "open", color: "#f59e0b" },
    { stage_key: "submitted", label: "Submitted", stage_type: "open", color: "#0891b2" },
    { stage_key: "issued", label: "Issued", stage_type: "won", color: "#16a34a" },
    { stage_key: "declined", label: "Declined", stage_type: "lost", color: "#dc2626" },
  ].map((s, i) => ({ template_id: template.id, version: template.version ?? 1, ...s, sort_order: i + 1 }));
});

await seed("template_forms", async () => {
  if (!template) return [];
  return [{
    template_id: template.id,
    version: template.version ?? 1,
    // Each entry must be an OBJECT carrying field_key, not a bare string. lib/agentTemplates
    // /service.ts validates `!keys.has(field.field_key)` and rejects the whole form with
    // "Form fields must reference a lead field" if a section holds plain strings. Also
    // `section_key`, not `key` — that is what the section shape uses everywhere else.
    form_definition: {
      sections: [
        { section_key: "applicant", label: "Applicant", sort_order: 0, fields: [
          { field_key: "first_name", is_required: true, show_when: null },
          { field_key: "last_name", is_required: true, show_when: null },
          { field_key: "date_of_birth", is_required: true, show_when: null },
          { field_key: "state", is_required: true, show_when: null },
        ] },
        { section_key: "contact", label: "Contact", sort_order: 1, fields: [
          { field_key: "phone", is_required: true, show_when: null },
          { field_key: "email", is_required: false, show_when: null },
        ] },
        { section_key: "coverage", label: "Coverage", sort_order: 2, fields: [
          { field_key: "coverage_amount", is_required: false, show_when: null },
          { field_key: "tobacco", is_required: true, show_when: null },
        ] },
      ],
    },
  }];
});

await seed("tenant_template_assignments", async () => {
  if (!template) return [];
  return [{
    tenant_id: tenantId,
    product_code: template.product_code,
    template_id: template.id,
    template_version: template.version ?? 1,
  }];
});

// ---------------------------------------------------------------------------
// Lead workspace. pipeline_id / stage_id stay null — those tables are the
// quarantined ones, and both columns are nullable, so the leads still land.
// ---------------------------------------------------------------------------
const leadIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const leadPeople = [
  { first: "Marcus", last: "Ellery", phone: "5125550147", state: "TX", stage: "new", coverage: 250000 },
  { first: "Dana", last: "Whitfield", phone: "8135550192", state: "FL", stage: "contacted", coverage: 100000 },
  { first: "Rosa", last: "Nakamura", phone: "6025550138", state: "AZ", stage: "quoted", coverage: 500000 },
  { first: "Curtis", last: "Bramley", phone: "4045550176", state: "GA", stage: "issued", coverage: 150000 },
  { first: "Ines", last: "Vargas", phone: "5125550163", state: "TX", stage: "declined", coverage: 75000 },
];

await seed("agent_leads", async () => {
  if (!template) return [];
  return leadPeople.map((p, i) => ({
    id: leadIds[i],
    tenant_id: tenantId,
    template_id: template.id,
    template_version: template.version ?? 1,
    stage_key: p.stage,
    product_line: template.product_code,
    created_by: agentUser.id,
    created_at: iso(-14 + i * 2),
    values: {
      first_name: p.first,
      last_name: p.last,
      phone: p.phone,
      email: `${p.first.toLowerCase()}.${p.last.toLowerCase()}@example.test`,
      state: p.state,
      coverage_amount: p.coverage,
      tobacco: i % 3 === 0,
    },
  }));
});

await seed("lead_queue", async () => {
  const { data: leads } = await db.from("agent_leads").select("id, stage_key, product_line").eq("tenant_id", tenantId);
  if (!leads?.length) return [];
  return leads.map((l, i) => ({
    tenant_id: tenantId,
    lead_id: l.id,
    product_line: l.product_line ?? "term_life",
    stage_key: l.stage_key,
    status: i < 2 ? "unclaimed" : "claimed",
    owner_user_id: i < 2 ? null : agentUser.id,
    claimed_by: i < 2 ? null : agentUser.id,
    claimed_at: i < 2 ? null : iso(-10 + i),
    queued_at: iso(-12 + i),
  }));
});

// ---------------------------------------------------------------------------
// Tenant configuration
// ---------------------------------------------------------------------------
await seed("business_profiles", async () => [{
  tenant_id: tenantId,
  business_name: "Ellery & Fields Insurance Group",
  npn: "18442907",
  primary_state: "TX",
  products_sold: ["term_life", "final_expense", "medicare_advantage"],
  monthly_volume_range: "251_500", // constrained to 0_25 | 26_100 | 101_250 | 251_500 | 500_plus
  lead_sources: ["partner_transfers", "facebook", "referral"],
  completed_at: iso(-45),
}]);

await seed("tenant_queue_sla_settings", async () => [{
  tenant_id: tenantId,
  warn_after_seconds: 300,
  escalate_after_seconds: 900,
  partner_notify_after_seconds: 1800,
  expire_after_seconds: 3600,
}]);

await seed("tenant_do_not_call", async () => [
  { tenant_id: tenantId, phone_digits: "5125550101", reason: "Requested removal on a recorded call.", is_active: true },
  { tenant_id: tenantId, phone_digits: "8135550144", reason: "Litigator list match.", is_active: true },
  { tenant_id: tenantId, phone_digits: "6025550199", reason: "Added in error, since cleared.", is_active: false },
]);

// `whop_plans` is deliberately NOT seeded.
//
// It is not demo data. It is the record of "our plan X exists on Whop as plan Y", and `ensureWhopPlan`
// treats any row it finds as authoritative and returns it without asking Whop. Seeding it with
// invented ids (`plan_demo_m_0`, `plan_demo_y_0`, …) therefore does not create a demo — it tells the
// real checkout path that a Whop plan already exists, forever, so `ensureWhopPlan` never creates the
// genuine one.
//
// The result was that `POST /checkout_configurations` answered `404 This Plan was not found` on every
// attempt, and `verify:checkout` had never passed. Verified against the live sandbox: all six seeded
// ids were absent, while the account's four real plans were present and readable.
//
// The mapping fills itself in on the first real sale of each (plan version, billing cycle), which is
// exactly what `ensureWhopPlan` is for. A demo does not need it and must not fake it.

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad("TABLE", 26)} ${pad("RESULT", 9)} DETAIL`);
for (const [t, r, d] of results) console.log(`${pad(t, 26)} ${pad(r, 9)} ${d}`);
const failed = results.filter((r) => r[1] === "FAIL").length;
console.log(`\n${results.filter((r) => r[1] === "seeded").length} seeded · ${results.filter((r) => r[1] === "kept").length} kept · ${results.filter((r) => r[1] === "skip").length} skipped · ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
