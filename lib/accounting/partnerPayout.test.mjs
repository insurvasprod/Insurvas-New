// Partner payouts rework (owner, 2026-11-06; extends LA-7.4 and LA-1.1) · rulebook, ledger, invoice machine.
// Run with: node --experimental-strip-types --test lib/accounting/partnerPayout.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  clientStage, entryMath, entryState, expectedPayOn, invoiceLines, invoicePreview, invoiceRef, lastCompleteCycle, ledgerState, parsePctToBp, payoutCycle, pctLabel,
  rulebookRateLabel, RULEBOOK_MODELS,
} from "./partnerPayoutCore.ts";
import { PARTNER_PAYOUT_MODELS } from "../partners/constants.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const LEDGER = "supabase/migrations/20261106110000_partner_payout_rulebook_ledger.sql";
const MODEL_A = "supabase/migrations/20261106100000_partner_payout_model_submitted_application.sql";
const money = (c) => `${c < 0 ? "-" : ""}$${String(Math.abs(c)).padStart(3, "0").slice(0, -2)}.${String(Math.abs(c)).padStart(3, "0").slice(-2)}`;
const code = (sql) => sql.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const fn = (sql, name) => { const at = sql.indexOf(`create or replace function public.${name}(`); assert.ok(at >= 0, name); return sql.slice(at, sql.indexOf("\n$$;", at)); };

// ─── the timer ─────────────────────────────────────────────────────────────────────────────────
test("the pay timer: weekly is Monday–Sunday, every 15 days is 1st–15th and 16th–end, monthly is the month", () => {
  assert.deepEqual(payoutCycle("weekly", "2026-11-06"), { start: "2026-11-02", end: "2026-11-08" }); // a Friday
  assert.deepEqual(payoutCycle("weekly", "2026-11-02"), { start: "2026-11-02", end: "2026-11-08" }); // the Monday
  assert.deepEqual(payoutCycle("weekly", "2026-11-08"), { start: "2026-11-02", end: "2026-11-08" }); // the Sunday
  assert.deepEqual(payoutCycle("semi_monthly", "2026-11-15"), { start: "2026-11-01", end: "2026-11-15" });
  assert.deepEqual(payoutCycle("semi_monthly", "2026-11-16"), { start: "2026-11-16", end: "2026-11-30" });
  assert.deepEqual(payoutCycle("semi_monthly", "2026-02-20"), { start: "2026-02-16", end: "2026-02-28" });
  assert.deepEqual(payoutCycle("monthly", "2028-02-10"), { start: "2028-02-01", end: "2028-02-29" });
  // The machine invoices the cycle that ended last.
  assert.deepEqual(lastCompleteCycle("weekly", "2026-11-06"), { start: "2026-10-26", end: "2026-11-01" });
  assert.deepEqual(lastCompleteCycle("semi_monthly", "2026-11-06"), { start: "2026-10-16", end: "2026-10-31" });
  assert.deepEqual(lastCompleteCycle("monthly", "2026-11-06"), { start: "2026-10-01", end: "2026-10-31" });
  // The database draws the same cycles (public.partner_payout_cycle).
  const cycle = fn(read(LEDGER), "partner_payout_cycle");
  assert.match(cycle, /when 'weekly' then date_trunc\('week', p_on::timestamp\)::date \+ 6/);
  assert.match(cycle, /extract\(day from p_on\) <= 15 then date_trunc\('month', p_on::timestamp\)::date \+ 14/);
});

test("when a partner can expect an unpaid item: its cycle's end (or the current one, if that passed) plus the draft days", () => {
  assert.equal(expectedPayOn("monthly", "2026-11-03", "2026-11-06", 3), "2026-12-04");
  assert.equal(expectedPayOn("weekly", "2026-10-01", "2026-11-06", 0), "2026-11-09", "a missed item goes on the next invoice");
  assert.equal(expectedPayOn("semi_monthly", "2026-11-20", "2026-11-06", 2), "2026-12-03");
});

// ─── the rulebook ──────────────────────────────────────────────────────────────────────────────
test("the rulebook offers Model A and Model B; older terms keep pricing", () => {
  assert.deepEqual([...RULEBOOK_MODELS], ["per_submitted_application", "revenue_share"]);
  assert.ok(PARTNER_PAYOUT_MODELS.includes("per_submitted_application"));
  for (const old of ["per_transfer", "per_lead", "per_sale", "per_issued_policy"]) assert.ok(PARTNER_PAYOUT_MODELS.includes(old), old);
  assert.match(read(MODEL_A), /alter type public\.partner_payout_model add value if not exists 'per_submitted_application';/);
  assert.equal(rulebookRateLabel("per_submitted_application", 1000, null, money), "$10.00 per submitted application");
  assert.equal(rulebookRateLabel("revenue_share", null, 5000, money), "50% of the commission");
  assert.equal(rulebookRateLabel("per_transfer", 9000, null, money), "$90.00 per transfer");
});

test("percentages are basis points, by string handling", () => {
  assert.equal(pctLabel(5000), "50%");
  assert.equal(pctLabel(1250), "12.5%");
  assert.equal(pctLabel(5), "0.05%");
  assert.equal(parsePctToBp("50"), 5000);
  assert.equal(parsePctToBp("12.5"), 1250);
  assert.equal(parsePctToBp("12.55%"), 1255);
  assert.equal(parsePctToBp("0"), null);
  assert.equal(parsePctToBp("100.01"), null);
  assert.equal(parsePctToBp("1.234"), null);
});

test("the payee is a name, an email and a method: never an account number", () => {
  const sql = read(LEDGER);
  const profile = sql.slice(sql.indexOf("create table if not exists public.partner_payout_profile"), sql.indexOf("create index if not exists partner_payout_profile_tenant_idx"));
  assert.doesNotMatch(code(profile), /account_number|routing|iban|swift|card/i);
  assert.match(profile, /payment_method in \('bank_transfer', 'paypal', 'zelle', 'check', 'wire', 'other'\)/);
  assert.match(profile, /cadence in \('weekly', 'semi_monthly', 'monthly'\)/);
  assert.match(profile, /chargeback_policy in \('partner_shares', 'agency_absorbs'\)/);
});

// ─── the ledger ────────────────────────────────────────────────────────────────────────────────
test("never paid twice: one ledger entry per thing earned, locked to one invoice, stamped PAID once", () => {
  const sql = read(LEDGER);
  assert.match(sql, /constraint partner_ledger_entry_once unique \(tenant_id, partner_id, source_type, source_id\)/);
  assert.match(sql, /on conflict \(tenant_id, partner_id, source_type, source_id\) do nothing/);
  const guard = fn(sql, "partner_ledger_entry_guard");
  assert.match(guard, /A ledger entry is never removed/);
  assert.match(guard, /What a ledger entry earned never changes\./);
  assert.match(guard, /A paid ledger entry stays paid\./);
  // An invoice takes only entries no invoice holds yet.
  assert.match(fn(sql, "build_payout_run"), /update public\.partner_ledger_entry l set run_id = v_run, locked_at = now\(\)\n\s+where l\.tenant_id = p_tenant_id and l\.partner_id = p_partner_id and l\.run_id is null and l\.earned_on <= p_to/);
  // Paid stamps every entry on the invoice; void releases an unpaid invoice's entries and refuses a paid one.
  assert.match(fn(sql, "mark_payout_run_paid"), /update public\.partner_ledger_entry set paid_at = now\(\) where run_id = r\.id and paid_at is null;/);
  const voided = fn(sql, "void_payout_run");
  assert.match(voided, /if r\.status = 'paid' then\n\s+raise exception 'void_payout_run: a paid invoice stays on record/);
  assert.match(voided, /update public\.partner_ledger_entry set run_id = null, locked_at = null where run_id = r\.id and paid_at is null;/);
  // Anything a run priced before the ledger existed is not priced again.
  assert.match(fn(sql, "sync_partner_ledger"), /where not exists \(select 1 from public\.payout_run_item ri join public\.payout_run r on r\.id = ri\.run_id\n\s+where r\.tenant_id = p_tenant_id and r\.partner_id = p_partner_id and r\.status <> 'void'\n\s+and ri\.item_type = p\.legacy_item and ri\.source_id = p\.source_id\)/);
  // Writes only through the functions.
  assert.match(sql, /revoke insert, update, delete, truncate on public\.partner_ledger_entry from service_role, tenant_app;/);
});

test("Model A pays a submitted application; Model B pays a share of each commission entry on the partner's issued policies", () => {
  const sync = fn(read(LEDGER), "sync_partner_ledger");
  assert.match(sync, /'submitted_application'::text as source_type[\s\S]+?'per_submitted_application'::text as model_needed[\s\S]+?min\(\(a\.submitted_at at time zone 'UTC'\)::date\)/);
  assert.match(sync, /select 'commission', 'revenue_share', e\.id[\s\S]+?lower\(btrim\(coalesce\(i\.carrier, ''\)\)\) in \(lower\(btrim\(ca\.name\)\), lower\(btrim\(ca\.code\)\)\)/);
  assert.match(sync, /coalesce\(e\.corrects_type, ''\) <> 'held'/, "held money is not commission paid");
  assert.match(sync, /join lateral \(select \* from terms t where t\.eff <= b\.on_date order by t\.eff desc limit 1\) t on t\.model = b\.model_needed/, "each item priced by the term in force on its own date");
  assert.match(sync, /public\.bp_share\(p\.base_cents, p\.rate_bp\)/);
});

test("chargebacks: shared ones are taken back on the next invoice; absorbed ones never touch the partner", () => {
  const sync = fn(read(LEDGER), "sync_partner_ledger");
  assert.match(sync, /\(v_policy = 'partner_shares' or not \(e\.entry_type = 'chargeback' or \(e\.entry_type = 'reversal' and coalesce\(e\.corrects_type, ''\) = 'chargeback'\)\)\)/);
  assert.match(sync, /if v_policy = 'partner_shares' then[\s\S]+?'chargeback_clawback', l\.source_id[\s\S]+?-l\.amount_cents/, "Model A's fee is taken back once per charged-back policy");
  // A negative invoice is carried to the next one, not booked as money owed: never counted twice.
  const publish = fn(read(LEDGER), "publish_payout_run");
  assert.doesNotMatch(publish, /'refund'/);
  assert.match(fn(read(LEDGER), "build_payout_run"), /'carried_balance', r\.id, r\.period_end, r\.net_cents[\s\S]+?r\.status = 'published' and r\.net_cents < 0/);
  assert.match(fn(read(LEDGER), "void_payout_run"), /this balance was carried to a later invoice — void that one first/);
});

test("the invoice machine: every partner whose timer is up, one draft invoice each, nothing for a partner owed nothing", () => {
  const sql = read(LEDGER);
  const machine = fn(sql, "run_partner_invoices");
  assert.match(machine, /public\.partner_payout_cycle\(v_cad, \(select c0\.cycle_start from public\.partner_payout_cycle\(v_cad, p_as_of\) c0\) - 1\)/, "the cycle that ended last");
  assert.match(machine, /continue when v_items = 0 and v_carry = 0;/);
  assert.match(machine, /if not p_dry_run then[\s\S]+?exception when others then/, "one partner's problem never stops the others");
  assert.match(fn(sql, "payout_drafts_due"), /public\.run_partner_invoices\(s\.tenant_id, current_date - s\.draft_days, null, null, false\)/);
  assert.match(fn(sql, "build_payout_run"), /'INV-' \|\| to_char\(p_to, 'YYYYMM'\) \|\| '-' \|\| lpad\(v_seq::text, 4, '0'\)/);
  assert.match(sql, /create unique index if not exists payout_run_invoice_seq on public\.payout_run \(tenant_id, invoice_seq\) where invoice_seq is not null;/);
});

test("integer cents only in the new SQL", () => {
  assert.doesNotMatch(code(read(LEDGER)), /\b(numeric|real|double precision|float[48]?)\b/);
});

// ─── where a client stands ─────────────────────────────────────────────────────────────────────
test("a client's stage and where its money stands", () => {
  assert.equal(clientStage({ submittedOn: null, issuedOn: null, chargedBackOn: null }), "transferred");
  assert.equal(clientStage({ submittedOn: "2026-11-01", issuedOn: null, chargedBackOn: null }), "submitted");
  assert.equal(clientStage({ submittedOn: "2026-11-01", issuedOn: "2026-11-04", chargedBackOn: null }), "issued");
  assert.equal(clientStage({ submittedOn: "2026-11-01", issuedOn: "2026-11-04", chargedBackOn: "2026-12-01" }), "charged_back");
  assert.equal(ledgerState({ entries: 0, unpaidCents: 0, invoicedCents: 0, paidCents: 0, openFrom: null }), "nothing_yet");
  assert.equal(ledgerState({ entries: 2, unpaidCents: 1000, invoicedCents: 1000, paidCents: 0, openFrom: "2026-11-03" }), "unpaid");
  assert.equal(ledgerState({ entries: 1, unpaidCents: 0, invoicedCents: 1000, paidCents: 0, openFrom: null }), "invoiced");
  assert.equal(ledgerState({ entries: 1, unpaidCents: 0, invoicedCents: 0, paidCents: 1000, openFrom: null }), "paid");
  assert.equal(entryState({ runId: null, paidAt: null }), "unpaid");
  assert.equal(entryState({ runId: "r", paidAt: null }), "invoiced");
  assert.equal(entryState({ runId: "r", paidAt: "2026-11-06T00:00:00Z" }), "paid");
});

// ─── the invoice ───────────────────────────────────────────────────────────────────────────────
test("the invoice shows how each amount was worked out; rejected transfers are not lines", () => {
  const lines = invoiceLines([
    { itemType: "submitted_application", occurredOn: "2026-11-02", amountCents: 1000, rateCents: 1000, ratePctBp: null, basisCents: null, clientName: "Ana Lee", policyNumber: null, carrier: null, note: null },
    { itemType: "revenue_share", occurredOn: "2026-11-01", amountCents: 50000, rateCents: null, ratePctBp: 5000, basisCents: 100000, clientName: "Bo Moss", policyNumber: "0119990312", carrier: "AMAM", note: null },
    { itemType: "clawback", occurredOn: "2026-11-03", amountCents: -1000, rateCents: 1000, ratePctBp: null, basisCents: null, clientName: "Cy Diaz", policyNumber: "P9", carrier: null, note: null },
    { itemType: "rejected", occurredOn: "2026-11-02", amountCents: 0, rateCents: null, ratePctBp: null, basisCents: null, clientName: null, policyNumber: null, carrier: null, note: "tcpa_litigator" },
  ], money);
  assert.deepEqual(lines.map((l) => [l.date, l.what, l.math, l.amountCents]), [
    ["2026-11-01", "Commission share", "50% of $1000.00", 50000],
    ["2026-11-02", "Application submitted", "$10.00 each", 1000],
    ["2026-11-03", "Chargeback taken back", "$10.00 each", -1000],
  ]);
  assert.ok(!JSON.stringify(lines).includes("tcpa_litigator"));
  assert.equal(entryMath({ sourceType: "commission", rateCents: null, ratePctBp: 5000, basisCents: 100000 }, money), "50% of $1000.00");
  assert.deepEqual(invoicePreview([{ earnedOn: "2026-10-30", amountCents: 1000, runId: null }, { earnedOn: "2026-11-02", amountCents: 1000, runId: null }, { earnedOn: "2026-10-01", amountCents: 500, runId: "r1" }], "2026-10-31"), { items: 1, netCents: 1000 });
  assert.equal(invoiceRef({ id: "abcdef12-0000", invoiceNumber: null }), "RUN-ABCDEF12");
  assert.equal(invoiceRef({ id: "x", invoiceNumber: "INV-202611-0004" }), "INV-202611-0004");
});

test("the PDF is stored on publish and handed to the partner only for its own published invoice", () => {
  const store = read("lib/accounting/payoutStore.ts");
  assert.match(store, /await storeInvoicePdf\(tenantId, id\)\.catch\(/, "a PDF failure never undoes a publish");
  assert.match(store, /const pdfPath = \(tenantId: string, runId: string\) => `\$\{tenantId\}\/partner-invoices\/\$\{runId\}\.pdf`;/);
  assert.match(store, /if \(stored\?\.path && stored\.path\.startsWith\(`\$\{tenantId\}\/`\)\)/, "a stored path outside the agency's folder is never read");
  const route = read("app/api/partner/payouts/[id]/invoice/route.ts");
  assert.match(route, /requirePartner\(\["partner_admin"\]\)/);
  assert.match(route, /partnerInvoicePdf\(auth\.context\.tenantId, auth\.context\.partnerId, id\)/);
  assert.ok(existsSync(join(root, "lib/accounting/partnerInvoicePdf.ts")));
});

test("until the paste lands, the payout screens keep working and the new parts say they are waiting", () => {
  const store = read("lib/accounting/payoutStore.ts");
  assert.match(store, /export async function ledgerLive\(\): Promise<boolean>/);
  assert.match(store, /const runColumns = async \(\) => \(await ledgerLive\(\)\) \? `\$\{BASE_RUN_COLUMNS\}, invoice_number, invoice_pdf_path` : BASE_RUN_COLUMNS;/);
  assert.ok(existsSync(join(root, "supabase/deploy/2026-11-06-partner-payouts.sql")), "the paste bundle is in the repo");
});
