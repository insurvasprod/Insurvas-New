// AG-0.11 and AG-1.3 … AG-1.12 · the money and review pieces, with no database. The SQL is proven by rehearsal;
// these pin the pure arithmetic the screens and previews use, and the source-level rules a reviewer would check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { advanceCents, applyBps, chargebackCents, computeOverride, splitPool } from "./overrideCore.ts";
import { buildStatement } from "./statementCore.ts";
import { allocateLeadCost, countOrPercent } from "./scorecardCore.ts";
import { REVIEW_ERROR_LABELS, REVIEW_STATUS_LABELS, defaultRateBps, errorTally, sampled } from "./reviewCore.ts";

const migration = (prefix) => {
  const dir = "supabase/migrations";
  const file = readdirSync(dir).find((f) => f.startsWith(prefix));
  assert.ok(file, `migration ${prefix} exists`);
  return readFileSync(`${dir}/${file}`, "utf8");
};
const source = (path) => readFileSync(path, "utf8");

// AG-1.3 · the Notion worked example: $1,200 annual premium, agency at 120%, Maria at 90%.
test("AG-1.3 worked example: 1,440 to the agency, 1,080 to Maria, 360 override", () => {
  const r = computeOverride({ annualPremiumCents: 120000, agencyLevelBps: 12000, producerLevelBps: 9000 });
  assert.deepEqual(r, { agencyCommissionCents: 144000, producerPoolCents: 108000, overrideCents: 36000, flag: null, negativeSpread: false });
  assert.equal(advanceCents(108000, 7500), 81000, "75% advance on her pool");
  assert.equal(chargebackCents(108000, 8), -72000, "lapse at month 4: 8 unearned months of 12");
});

test("AG-1.3 property: agency = pool + override for every premium and level, in whole cents", () => {
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  for (let i = 0; i < 2000; i += 1) {
    const premium = next() % 5_000_000;
    const agency = 5000 + (next() % 10000);
    const producer = next() % 15000;
    const r = computeOverride({ annualPremiumCents: premium, agencyLevelBps: agency, producerLevelBps: producer });
    assert.equal(r.agencyCommissionCents, r.producerPoolCents + r.overrideCents);
    assert.equal(r.negativeSpread, r.producerPoolCents > r.agencyCommissionCents);
    assert.ok(Number.isInteger(r.overrideCents));
  }
});

test("AG-1.3 a missing level is null with a reason, never zero and never borrowed from the other side", () => {
  assert.equal(computeOverride({ annualPremiumCents: 120000, agencyLevelBps: null, producerLevelBps: 9000 }).flag, "agency_level_missing");
  const noProducer = computeOverride({ annualPremiumCents: 120000, agencyLevelBps: 12000, producerLevelBps: null });
  assert.equal(noProducer.producerPoolCents, null);
  assert.equal(noProducer.overrideCents, null);
});

test("AG-1.5 the ledger is signed and append-only: earned +810, payout −810, chargeback −720 leaves −720", () => {
  const e = (id, entryType, amountCents, occurredOn) => ({ id, entryType, basis: "reported", policyNumber: "P1", carrierName: "AMAM", clientName: "C", premiumCents: 10000, premiumMode: "monthly", levelBps: 9000, amountCents, occurredOn, reason: null });
  const s = buildStatement([e("1", "earned", 81000, "2026-05-02"), e("2", "payout", -81000, "2026-05-30")], [e("3", "chargeback", -72000, "2026-08-14")]);
  assert.equal(s.openingCents, 0);
  assert.equal(s.closingCents, -72000);
  const sql = migration("20261018210000");
  assert.match(sql, /revoke\s+update,\s*delete/i, "no role updates or deletes a ledger entry");
  assert.match(sql, /tenant_plan_audience\(e\.tenant_id\), ''''\) <> ''agency''/, "LA-7.5's sync skips agency tenants — one writer per tenant");
});

test("AG-1.6 splits must total exactly 100%; the parts add back to the pool with no cent lost", () => {
  assert.throws(() => splitPool(108000, [{ producerUserId: "a", shareBps: 6000 }, { producerUserId: "b", shareBps: 3900 }]), /split_must_total_10000:9900/);
  const parts = splitPool(108001, [{ producerUserId: "a", shareBps: 6000 }, { producerUserId: "b", shareBps: 4000 }]);
  assert.deepEqual(parts.map((p) => p.amountCents), [64801, 43200]);
  for (let pool = 0; pool < 3000; pool += 7) {
    const three = splitPool(pool, [{ producerUserId: "a", shareBps: 3334 }, { producerUserId: "b", shareBps: 3333 }, { producerUserId: "c", shareBps: 3333 }]);
    assert.equal(three.reduce((s, p) => s + p.amountCents, 0), pool);
  }
  assert.match(migration("20261018205000"), /split_must_total_10000/);
});

test("AG-1.7 the preview writes nothing, a run needs a method, and a period cannot be paid twice", () => {
  const sql = migration("20261018220000");
  for (const code of ["payout_method_required", "payout_no_producers", "payout_mode_unknown", "payout_amount_required"]) assert.ok(sql.includes(code), code);
  assert.ok(sql.includes("AG-1.7: the preview writes"), "a self-check proves the preview is read-only");
  assert.ok(sql.includes("AG-1.7: nothing stops a period being paid twice"));
});

test("AG-1.8 statement totals equal the sum of the ledger for the period, one basis only", () => {
  const e = (id, entryType, amountCents, basis = "reported") => ({ id, entryType, basis, policyNumber: null, carrierName: null, clientName: null, premiumCents: null, premiumMode: null, levelBps: null, amountCents, occurredOn: "2026-09-10", reason: entryType === "adjustment" ? "fix" : null });
  const during = [e("a", "earned", 81000), e("b", "chargeback", -7501), e("c", "adjustment", 250), e("d", "payout", -50000), e("x", "earned", 99999, "expected")];
  const s = buildStatement([e("o", "earned", 1000)], during);
  const sum = during.filter((x) => x.basis === "reported").reduce((t, x) => t + x.amountCents, 0);
  assert.equal(s.movementCents, sum);
  assert.equal(s.closingCents, 1000 + sum);
  assert.equal(s.lines.length, 2, "an expected-basis row never reaches a reported statement");
  assert.equal(s.lines.reduce((t, l) => t + l.netCents, 0) + s.adjustments.reduce((t, a) => t + a.amountCents, 0) + s.payouts.reduce((t, p) => t + p.amountCents, 0), s.movementCents);
});

test("AG-1.9 lead cost follows the producer the lead was ASSIGNED to, and adds back exactly", () => {
  const spend = new Map([["camp1", 10000], ["camp2", 1001]]);
  const assignments = [
    { campaignId: "camp1", producerUserId: "maria" }, { campaignId: "camp1", producerUserId: "maria" }, { campaignId: "camp1", producerUserId: "jay" },
    { campaignId: "camp2", producerUserId: "jay" }, { campaignId: "camp2", producerUserId: "jay" }, { campaignId: "camp2", producerUserId: "maria" },
  ];
  const out = allocateLeadCost(spend, assignments);
  assert.equal([...out.values()].reduce((s, n) => s + n, 0), 11001);
  assert.equal(out.get("maria"), 6667 + 334);
  assert.equal(out.get("jay"), 3333 + 667);
});

test("AG-1.9 / AG-0.11 under the sample a count, never a percentage", () => {
  assert.equal(countOrPercent(14, 16, 30), "14/16");
  assert.equal(countOrPercent(27, 30, 30), "90%");
  assert.equal(countOrPercent(0, 0, 30), "—");
  assert.equal(countOrPercent(1, 3, 1), "33%");
  assert.equal(countOrPercent(2, 3, 1), "67%");
});

test("AG-1.10 a refused submission names the missing item, not a generic refusal", () => {
  const gate = source("lib/agency/submitGate.ts");
  assert.match(gate, /You can't submit yet: \$\{reason/);
  assert.match(gate, /code: "cannot_submit", reason/);
  assert.match(source("app/api/app/applications/attempts/[id]/submissions/route.ts"), /refuseIfCannotSubmit/);
  assert.ok(migration("20261018240000").includes("AG-1.10: can_submit has a human-reachable update path"));
});

test("AG-1.11 the sample rate is honoured, deterministically, and the default halves after 90 days", () => {
  let hits = 0;
  const n = 20000;
  for (let i = 0; i < n; i += 1) if (sampled(`app-${i}-${i * 31}`, 1000)) hits += 1;
  assert.ok(Math.abs(hits / n - 0.1) < 0.01, `10% ±1 (got ${hits / n})`);
  assert.equal(sampled("same", 5000), sampled("same", 5000));
  assert.equal(sampled("x", 0), false);
  assert.equal(sampled("x", 10000), true);
  assert.equal(defaultRateBps("2026-09-01", "2026-10-18"), 5000);
  assert.equal(defaultRateBps("2026-01-01", "2026-10-18"), 1000);
  const tally = errorTally([{ producerUserId: "m", errorTypes: ["missing_field", "wrong_form"] }, { producerUserId: "m", errorTypes: ["missing_field"] }]);
  assert.deepEqual(tally.get("m"), [["missing_field", 2], ["wrong_form", 1]]);
});

test("AG-1.11 it is called Application review on screen — never QA", () => {
  for (const text of [...Object.values(REVIEW_ERROR_LABELS), ...Object.values(REVIEW_STATUS_LABELS)]) assert.doesNotMatch(text, /\bQA\b/);
  for (const file of ["components/app/agency/review-board.tsx", "app/app/(shell)/application-review/page.tsx"]) {
    const visible = source(file).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "").replace(/qaVerdict\w*|team_qa/g, "");
    assert.doesNotMatch(visible, /\bQA\b/, file);
    assert.match(visible, /Application review/);
  }
});

test("AG-1.12 no query sums amount_cents across bases: every SQL sum is filtered or grouped by basis", () => {
  for (const prefix of ["20261018210000", "20261018220000", "20261018230000"]) {
    const statements = migration(prefix).split(/;\s*\n/);
    for (const st of statements) {
      if (!/sum\(\s*[\w.]*amount_cents/i.test(st)) continue;
      assert.match(st, /basis/i, `${prefix}: a sum of amount_cents with no basis filter or grouping:\n${st.slice(0, 300)}`);
    }
  }
});

test("AG-1.12 every producer money figure on the money screens carries its basis label", () => {
  for (const file of ["components/app/agency/reconciliation-board.tsx", "components/app/agency/attribution-board.tsx", "components/app/agency/producer-money-tab.tsx"]) {
    assert.match(source(file), /BasisChip/, `${file} labels its money with a basis`);
  }
  const recon = source("components/app/agency/reconciliation-board.tsx");
  for (const b of ["expected", "reported", "received"]) assert.match(recon, new RegExp(`BasisChip basis="${b}"`));
  assert.doesNotMatch(recon, /(expectedCents|reportedCents|receivedCents)\s*\+\s*r\.(expectedCents|reportedCents|receivedCents)/, "the three truths are never added together");
  assert.ok(migration("20261018230000").includes("reconciliation writes to a money layer instead of raising a review item"));
});

test("AG-1.4 an unattributed row is never given to the owner, and a decision needs a reason", () => {
  const sql = migration("20261018200000");
  assert.ok(sql.includes("attribution_reason_required"));
  assert.ok(sql.includes("AG-1.4: an unattributed row defaults to the owner"));
  assert.match(source("components/app/agency/attribution-board.tsx"), /disabled=\{busy \|\| !choice \|\| !reason\.trim\(\)\}/);
});

test("AG-0.11 / AG-1 money rounding is integer-only, half away from zero", () => {
  assert.equal(applyBps(1, 5000), 1);
  assert.equal(applyBps(-1, 5000), -1);
  assert.throws(() => applyBps(1.5, 100), /integers only/);
});
