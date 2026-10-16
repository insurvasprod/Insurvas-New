// LA-7.4 (Notion sprint, Module 7 — Accounting) · partner payout engine, statements & portal view.
// Run with: node --experimental-strip-types --test lib/accounting/payouts.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { partnerStatement, statementLines } from "./payoutsCore.ts";
import { la7Files } from "./la7Files.mjs";
import { AGENT_API_POLICIES } from "../entitlements/agentApiPolicy.ts";

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = "supabase/migrations/20261015240000_la_7_4_partner_payouts.sql";

const VERDICT_IDS = ["9f1e0000-0000-4000-8000-000000000001", "9f1e0000-0000-4000-8000-000000000002", "9f1e0000-0000-4000-8000-000000000003"];
const run = (status = "published") => ({ id: "r1", partnerId: "p1", periodStart: "2026-08-01", periodEnd: "2026-08-31", status, grossCents: 576500, deductionsCents: -18000, disputedCents: 9000, netCents: 549500, paidOn: null, publishedAt: "2026-09-02T10:00:00Z", footer: "Questions: accounts@agency" });
const items = [
  ...Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, itemType: "transfer", sourceId: `aaaaaaaa-0000-4000-8000-00000000000${i}`, occurredOn: "2026-08-05", rateAppliedCents: 9000, ratePctBp: null, amountCents: 9000, note: null })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: `u${i}`, itemType: "transfer", sourceId: `bbbbbbbb-0000-4000-8000-00000000000${i}`, occurredOn: "2026-08-20", rateAppliedCents: 10000, ratePctBp: null, amountCents: 10000, note: null })),
  ...VERDICT_IDS.map((v, i) => ({ id: `x${i}`, itemType: "rejected", sourceId: v, occurredOn: "2026-08-09", rateAppliedCents: null, ratePctBp: null, amountCents: 0, note: "tcpa_litigator" })),
  { id: "rs1", itemType: "revenue_share", sourceId: "cccccccc-0000-4000-8000-000000000001", occurredOn: "2026-08-10", rateAppliedCents: null, ratePctBp: 1000, amountCents: 18401, note: null },
  { id: "rs2", itemType: "revenue_share", sourceId: "cccccccc-0000-4000-8000-000000000002", occurredOn: "2026-08-28", rateAppliedCents: null, ratePctBp: 1000, amountCents: -4120, note: null },
  { id: "c1", itemType: "credit", sourceId: "dddddddd-0000-4000-8000-000000000001", occurredOn: "2026-08-20", rateAppliedCents: null, ratePctBp: null, amountCents: -18000, note: "2 of 4 claimed leads" },
];
const disputes = [{ id: "d1", itemId: "t0", side: "agent", reason: "Wrong number", claimCents: 9000, status: "open", resolutionNote: null, raisedAt: "2026-09-01T00:00:00Z", resolvedAt: null, carriedToRunId: null }];

test("the statement is itemised by rate: a mid-period change shows as two lines", () => {
  const lines = statementLines(items).filter((l) => l.itemType === "transfer");
  assert.deepEqual(lines.map((l) => [l.count, l.rateCents, l.amountCents]), [[10, 9000, 90000], [6, 10000, 60000]]);
  const sql = read(MIGRATION);
  assert.match(sql, /join lateral \(select \* from terms t where t\.eff <= b\.on_date order by t\.eff desc limit 1\) t on true/, "each item priced by the term in force on its own date");
});

test("rejected transfers reach the partner as a count with no identifying detail", () => {
  const s = partnerStatement(run(), items, disputes);
  assert.equal(s.rejectedCount, 3);
  const json = JSON.stringify(s);
  for (const v of VERDICT_IDS) assert.ok(!json.includes(v), "no verdict id");
  assert.ok(!json.includes("tcpa_litigator"), "no blocking reason");
  assert.ok(!s.items.some((i) => i.label.startsWith("Rejected")), "no rejected line items");
});

test("no commission figure in the partner payload: revenue share is one total, with no base and no per-policy line", () => {
  const s = partnerStatement(run(), items, disputes);
  assert.deepEqual(s.revenueShare, { amountCents: 18401 - 4120 });
  const json = JSON.stringify(s);
  assert.doesNotMatch(json, /commission|pct|Bp|basis|base/i);
  assert.ok(!json.includes("cccccccc"), "no reference to the commission entries");
  assert.ok(!s.items.some((i) => i.label === "Revenue share"));
  assert.deepEqual(Object.keys(s).sort(), ["credits", "disputes", "footer", "id", "items", "lines", "paidOn", "periodEnd", "periodStart", "publishedAt", "rejectedCount", "revenueShare", "status", "totals"]);
});

test("a draft run is invisible to the partner; only published and paid exist on its side", () => {
  assert.equal(partnerStatement(run("draft"), items, disputes), null);
  assert.equal(partnerStatement(run("void"), items, disputes), null);
  assert.ok(partnerStatement(run("paid"), items, disputes));
  const store = read("lib/accounting/payoutStore.ts");
  const side = store.slice(store.indexOf("// ─── the partner's side"));
  assert.equal((side.match(/\.eq\("tenant_id", tenantId\)\.eq\("partner_id", partnerId\)/g) ?? []).length, 2, "both partner reads are scoped by tenant and partner");
  assert.equal((side.match(/\.in\("status", \["published", "paid"\]\)/g) ?? []).length, 2);
});

test("on every portal route: no other partner's run and no commission figure", () => {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(join(root, dir))) {
      const p = `${dir}/${name}`;
      if (statSync(join(root, p)).isDirectory()) walk(p);
      else if (name === "route.ts") files.push(p);
    }
  };
  walk("app/api/partner");
  assert.ok(files.length > 20, "the scan reaches the portal's routes");
  for (const f of files) {
    const src = read(f);
    // No portal route touches the money ledgers or commission tables directly.
    assert.doesNotMatch(src, /commission_entry|commission_account_entry|commission_policy_totals|cost_entry|money_entry|pnl_|payout_run_item|rate_pct_bp/, f);
    if (/payoutStore/.test(src)) {
      assert.ok(f.startsWith("app/api/partner/payouts/"), `${f} reaches payouts outside the payouts routes`);
      assert.match(src, /requirePartner\(\["partner_admin"\]\)/, f);
      assert.match(src, /context\.tenantId, context\.partnerId|auth\.context\.tenantId, auth\.context\.partnerId/, `${f} scopes by the session's partner`);
      assert.doesNotMatch(src, /getRun\(|listRuns\(|statementCsv\(/, `${f} uses an agency-side read`);
    }
  }
  // The partner can name only its billable lines in a dispute — never a rejected one.
  assert.match(read("lib/accounting/payoutStore.ts"), /if \(!data \|\| !\["transfer", "lead", "sale", "issued_policy", "adjustment"\]\.includes\(data\.item_type\)\) throw new PayoutError\("Not found", 404\);/);
});

test("disputes either side: withheld, resolved accepted (next run, once) or upheld, never deleted", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /raise exception 'A dispute never silently disappears: resolve it accepted or upheld\.'/);
  assert.match(sql, /where d\.run_id = p_run_id and d\.raised_by_side = 'agent';/, "the agency's disputes stay out of their run however resolved");
  assert.match(sql, /d\.status = 'accepted' and d\.carried_to_run_id is null and d\.claim_cents > 0;/);
  assert.match(sql, /if p_status not in \('accepted', 'upheld'\) then/);
  assert.match(sql, /resolution_note = left\(btrim\(p_note\), 1000\), resolved_by = p_by, resolved_at = now\(\)/, "who and why");
});

test("publish creates the cost, dated the period's end; paid records only when; void reverses", () => {
  const sql = read(MIGRATION);
  assert.match(sql, /'entry_type', 'partner_payout', 'amount_cents', -r\.net_cents,\n\s+'incurred_on', r\.period_end/);
  assert.match(sql, /v_n := public\.mark_cost_entries_paid\(p_tenant_id, v_ids, p_paid_on\);/);
  assert.match(sql, /perform public\.reverse_cost_entry\(p_tenant_id, e\.id, 'Payout run voided: '/);
  assert.match(sql, /raise exception 'A published run is history: void it and build it again\.'/);
  // Frozen terms: the snapshot is among the columns a published run can never change.
  assert.match(sql, /new\.terms_snapshot_json, new\.period_start/);
  // Auto-publish is off unless the agency turns it on.
  assert.match(sql, /add column if not exists payout_auto_publish boolean not null default false/);
});

test("no outbound payment API anywhere in LA-7", () => {
  for (const f of la7Files()) {
    assert.doesNotMatch(read(f), /from ["'](stripe|@stripe\/[^"']+|plaid|dwolla|@moderntreasury\/[^"']+)["']|api\.stripe\.com|createPayout|payouts\.create|transfers\.create/i, f);
  }
});

test("owner and bookkeeper on the agency's routes; partner admins on the portal's", () => {
  for (const f of ["app/api/app/accounting/payouts/route.ts", "app/api/app/accounting/payouts/[id]/route.ts", "app/api/app/accounting/payouts/[id]/statement/route.ts"]) {
    assert.deepEqual(AGENT_API_POLICIES.find((p) => p.sourceFile === f)?.allowedRoles, ["owner", "bookkeeper"], f);
    assert.match(read(f), /requireFeatureRole\("payout_runs", ROLES/, f);
  }
  assert.match(read("app/partner/(portal)/payouts/page.tsx"), /if \(context\.role !== "partner_admin"\) redirect\("\/partner"\);/);
});
