// LA-4.4 · the discrepancy engine: every kind, and the guards that keep it from crying wolf.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const { computeDiscrepancies, owedSummary, planRefresh, NEVER_PAID_GRACE_DAYS } = await import("./compute.ts");

const TODAY = "2026-10-02";
const policy = (id, extra = {}) => ({ id, policyNumber: `MO-${id}`, insuredName: `Insured ${id}`, carrierId: "mo", carrierName: "Mutual of Omaha", status: "active", effectiveDate: "2026-06-01", ...extra });
const expected = (id, policyId, amountCents, postedOn, extra = {}) => ({ id, policyId, kind: "commission", amountCents, postedOn, rateBp: 10_000, premiumCents: 100_000, ...extra });
const received = (id, policyId, amountCents, extra = {}) => ({ id, policyId, statementId: "s-aug", carrierId: "mo", kind: "commission", amountCents, postedOn: "2026-08-31", periodStart: "2026-08-01", periodEnd: "2026-08-31", rateBp: null, premiumCents: null, ...extra });
const covered = (statementId = "s-aug", periodStart = "2026-08-01", periodEnd = "2026-08-31", carrierId = "mo") => ({ statementId, carrierId, periodStart, periodEnd });

test("never paid: in force past the grace, the carrier's statements cover the period, and no line pays it", () => {
  const found = computeDiscrepancies({
    policies: [policy("p1")],
    expected: [expected("p1:advance", "p1", 54_000, "2026-06-01", { kind: "advance" })],
    received: [],
    coverage: [covered("s-jul", "2026-07-01", "2026-07-31")],
    today: TODAY,
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "never_paid");
  assert.equal(found[0].owedCents, 54_000);
  assert.deepEqual(found[0].detail.expectedEntryIds, ["p1:advance"]);
  assert.match(found[0].detail.explanation, /One statement from Mutual of Omaha covers the time this payment was due, to 2026-07-31, and none pays this policy/);
  assert.equal(found[0].fingerprint, "never_paid|p1|issue:2026-06-01", "anchored at issue: unpaid since then");
});

test("never paid claims only what fell due while a statement was reporting", () => {
  // Issued July 2025; the only statement covers May–July 2026. The 2025 advance and year-1
  // commission may be on a 2025 statement nobody imported; only the July 2026 renewal is evidence.
  const found = computeDiscrepancies({
    policies: [policy("p1", { effectiveDate: "2025-07-24" })],
    expected: [
      expected("p1:advance", "p1", 85_860, "2025-07-24", { kind: "advance" }),
      expected("p1:1", "p1", 14_310, "2025-07-24"),
      expected("p1:2", "p1", 14_310, "2026-07-24"),
    ],
    received: [],
    coverage: [covered("s-q2", "2026-05-01", "2026-07-31")],
    today: TODAY,
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].owedCents, 14_310);
  assert.deepEqual(found[0].detail.expectedEntryIds, ["p1:2"]);
  // A statement that ends before anything fell due, alone, is no evidence at all.
  assert.equal(computeDiscrepancies({
    policies: [policy("p1", { effectiveDate: "2025-07-24" })],
    expected: [expected("p1:advance", "p1", 85_860, "2025-07-24", { kind: "advance" })],
    received: [],
    coverage: [covered("s-q2", "2026-05-01", "2026-07-31")],
    today: TODAY,
  }).length, 0);
});

test("never paid is not claimed without coverage, inside the grace, for another carrier's statements, or for a pending policy", () => {
  const base = { expected: [expected("e", "p1", 54_000, "2026-06-01")], received: [], today: TODAY };
  assert.equal(computeDiscrepancies({ ...base, policies: [policy("p1")], coverage: [] }).length, 0, "no statement is not no payment");
  assert.equal(computeDiscrepancies({ ...base, policies: [policy("p1", { effectiveDate: "2026-09-20" })], coverage: [covered("s-sep", "2026-09-01", "2026-09-30")] }).length, 0, `still inside the ${NEVER_PAID_GRACE_DAYS}-day grace`);
  assert.equal(computeDiscrepancies({ ...base, policies: [policy("p1")], coverage: [covered("s", "2026-08-01", "2026-08-31", "americo")] }).length, 0, "another carrier's statement says nothing about this one");
  assert.equal(computeDiscrepancies({ ...base, policies: [policy("p1", { status: "pending" })], coverage: [covered()] }).length, 0);
  assert.equal(computeDiscrepancies({ ...base, policies: [policy("p1", { status: "lapsed" })], coverage: [covered()] }).length, 0, "a lapsed policy is not owed new commission");
  assert.equal(computeDiscrepancies({ ...base, policies: [policy("p1", { effectiveDate: "2026-06-01" })], coverage: [covered("s-jun", "2026-06-01", "2026-06-30")] }).length, 0, "a statement that ends before the grace is not evidence");
});

test("short-paid: less than the contract expects for the periods reported, at the right rate", () => {
  const found = computeDiscrepancies({
    policies: [policy("p1")],
    expected: [expected("p1:2", "p1", 50_000, "2026-08-15")],
    received: [received("l1", "p1", 30_000, { rateBp: 10_000 })],
    coverage: [covered()],
    today: TODAY,
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "short_paid");
  assert.equal(found[0].owedCents, 20_000);
  assert.equal(found[0].detail.expectedCents, 50_000);
  assert.equal(found[0].detail.receivedCents, 30_000);
});

test("paid at the wrong rate: short, and the rate paid is not the schedule's", () => {
  const byColumn = computeDiscrepancies({
    policies: [policy("p1")],
    expected: [expected("p1:2", "p1", 110_000, "2026-08-15", { rateBp: 11_000 })],
    received: [received("l1", "p1", 100_000, { rateBp: 10_000 })],
    coverage: [covered()],
    today: TODAY,
  });
  assert.equal(byColumn[0].kind, "mis_rated");
  assert.equal(byColumn[0].owedCents, 10_000);
  assert.equal(byColumn[0].detail.paidRateBp, 10_000);
  assert.equal(byColumn[0].detail.expectedRateBp, 11_000);
  assert.match(byColumn[0].detail.explanation, /Paid at 100%; your contract's schedule is 110%/);
  // Without a rate column, commission ÷ premium is the rate paid.
  const byPremium = computeDiscrepancies({
    policies: [policy("p1")],
    expected: [expected("p1:2", "p1", 110_000, "2026-08-15", { rateBp: 11_000 })],
    received: [received("l1", "p1", 100_000, { premiumCents: 100_000 })],
    coverage: [covered()],
    today: TODAY,
  });
  assert.equal(byPremium[0].kind, "mis_rated");
});

test("paid in full, or within the rounding tolerance, is not a discrepancy", () => {
  const found = computeDiscrepancies({
    policies: [policy("p1")],
    expected: [expected("p1:2", "p1", 50_000, "2026-08-15")],
    received: [received("l1", "p1", 49_950)],
    coverage: [covered()],
    today: TODAY,
  });
  assert.equal(found.length, 0);
});

test("an unexpected chargeback: taken back from a policy the book has in force", () => {
  const found = computeDiscrepancies({
    policies: [policy("p1")],
    expected: [expected("p1:advance", "p1", 54_000, "2026-06-01", { kind: "advance" })],
    received: [received("adv", "p1", 54_000, { kind: "advance", periodStart: "2026-06-01", periodEnd: "2026-06-30", postedOn: "2026-06-30" }), received("cb", "p1", -54_000, { kind: "chargeback" })],
    coverage: [covered()],
    today: TODAY,
  });
  const unexpected = found.find((item) => item.kind === "unexpected_chargeback");
  assert.ok(unexpected);
  assert.equal(unexpected.owedCents, 54_000);
  assert.deepEqual(unexpected.detail.receivedLineIds, ["cb"]);
});

test("a lapsed policy's chargeback is expected; charging it back twice is a duplicate", () => {
  const lapsed = policy("p1", { status: "lapsed" });
  const advance = received("adv", "p1", 54_000, { kind: "advance", periodStart: "2026-06-01", periodEnd: "2026-06-30", postedOn: "2026-06-30" });
  const once = computeDiscrepancies({
    policies: [lapsed],
    expected: [expected("p1:cb", "p1", -54_000, "2026-08-10", { kind: "chargeback" })],
    received: [advance, received("cb1", "p1", -54_000, { kind: "chargeback" })],
    coverage: [covered()],
    today: TODAY,
  });
  assert.equal(once.filter((item) => item.kind.endsWith("chargeback")).length, 0, "one chargeback for one lapse is right");
  const twice = computeDiscrepancies({
    policies: [lapsed],
    expected: [expected("p1:cb", "p1", -54_000, "2026-08-10", { kind: "chargeback" })],
    received: [advance, received("cb1", "p1", -54_000, { kind: "chargeback" }), received("cb2", "p1", -54_000, { kind: "chargeback", statementId: "s-sep", periodStart: "2026-09-01", periodEnd: "2026-09-30" })],
    coverage: [covered()],
    today: TODAY,
  });
  const duplicate = twice.find((item) => item.kind === "duplicate_chargeback");
  assert.ok(duplicate);
  assert.equal(duplicate.owedCents, 54_000);
  assert.equal(duplicate.detail.allowedCents, 54_000);
  assert.equal(duplicate.detail.takenCents, 108_000);
  assert.deepEqual(duplicate.detail.statementIds.sort(), ["s-aug", "s-sep"]);
});

test("the same facts give the same fingerprints, and the summary adds them up", () => {
  const args = {
    policies: [policy("p1"), policy("p2")],
    expected: [expected("p1:a", "p1", 54_000, "2026-06-01", { kind: "advance" }), expected("p2:2", "p2", 50_000, "2026-08-15")],
    received: [received("l2", "p2", 30_000)],
    coverage: [covered("s-jul", "2026-07-01", "2026-07-31"), covered()],
    today: TODAY,
  };
  const first = computeDiscrepancies(args).map((item) => item.fingerprint);
  const again = computeDiscrepancies(args).map((item) => item.fingerprint);
  assert.deepEqual(first, again);
  const summary = owedSummary(computeDiscrepancies(args));
  assert.equal(summary.totalCents, 54_000 + 20_000);
  assert.equal(summary.byKind.never_paid.cents, 54_000);
  assert.equal(summary.byKind.short_paid.count, 1);
});

// ── fingerprints v2 (20261006110000): anchored where the problem started ─────────

test("a later statement grows the same short-paid finding instead of replacing it (a dispute survives)", () => {
  const august = {
    policies: [policy("p1")],
    expected: [expected("p1:aug", "p1", 50_000, "2026-08-15"), expected("p1:sep", "p1", 50_000, "2026-09-15")],
    received: [received("l-aug", "p1", 30_000)],
    coverage: [covered()],
    today: TODAY,
  };
  const september = { ...august, received: [...august.received, received("l-sep", "p1", 30_000, { statementId: "s-sep", periodStart: "2026-09-01", periodEnd: "2026-09-30", postedOn: "2026-09-30" })], coverage: [covered(), covered("s-sep", "2026-09-01", "2026-09-30")] };
  const [before] = computeDiscrepancies(august);
  const [after] = computeDiscrepancies(september);
  assert.equal(before.fingerprint, "short_paid|p1|from:2026-08-01");
  assert.equal(after.fingerprint, before.fingerprint, "same key, so the stored finding (and its dispute) is updated");
  assert.equal(after.owedCents, 40_000, "with the new month's shortfall added");
  // v1 keyed it by every period, so September made it a different finding.
  const [v1Before] = computeDiscrepancies({ ...august, fingerprints: "v1" });
  const [v1After] = computeDiscrepancies({ ...september, fingerprints: "v1" });
  assert.notEqual(v1After.fingerprint, v1Before.fingerprint);
  assert.equal(v1Before.fingerprint, "short_paid|p1|2026-08-01~2026-08-31");
});

test("each chargeback period on an active policy is its own unexpected chargeback (v2), one per policy in v1", () => {
  const args = {
    policies: [policy("p1")],
    expected: [],
    received: [
      received("cb-mar", "p1", -20_000, { kind: "chargeback", statementId: "s-mar", periodStart: "2026-03-01", periodEnd: "2026-03-31", postedOn: "2026-03-31" }),
      received("cb-sep", "p1", -30_000, { kind: "chargeback", statementId: "s-sep", periodStart: "2026-09-01", periodEnd: "2026-09-30", postedOn: "2026-09-30" }),
    ],
    coverage: [covered("s-mar", "2026-03-01", "2026-03-31"), covered("s-sep", "2026-09-01", "2026-09-30")],
    today: TODAY,
  };
  const v2 = computeDiscrepancies(args).filter((item) => item.kind === "unexpected_chargeback");
  assert.deepEqual(v2.map((item) => [item.fingerprint, item.owedCents]).sort(), [
    ["unexpected_chargeback|p1|2026-03-01~2026-03-31", 20_000],
    ["unexpected_chargeback|p1|2026-09-01~2026-09-30", 30_000],
  ]);
  assert.deepEqual(v2.find((item) => item.owedCents === 30_000).detail.receivedLineIds, ["cb-sep"], "each traces to its own line");
  const v1 = computeDiscrepancies({ ...args, fingerprints: "v1" }).filter((item) => item.kind === "unexpected_chargeback");
  assert.deepEqual(v1.map((item) => [item.fingerprint, item.owedCents]), [["unexpected_chargeback|p1", 50_000]]);
});

test("duplicate chargebacks are anchored at the first chargeback's period", () => {
  const lapsed = policy("p1", { status: "lapsed" });
  const found = computeDiscrepancies({
    policies: [lapsed],
    expected: [expected("p1:cb", "p1", -54_000, "2026-08-10", { kind: "chargeback" })],
    received: [received("cb1", "p1", -54_000, { kind: "chargeback" }), received("cb2", "p1", -54_000, { kind: "chargeback", statementId: "s-sep", periodStart: "2026-09-01", periodEnd: "2026-09-30" })],
    coverage: [covered()],
    today: TODAY,
  });
  assert.equal(found.find((item) => item.kind === "duplicate_chargeback").fingerprint, "duplicate_chargeback|p1|from:2026-08-01");
});

// ── the refresh: what a person decided stays decided, unless it gets worse ───────

const NOW = "2026-10-06T12:00:00.000Z";
const finding = (fingerprint, owedCents) => ({ fingerprint, kind: "short_paid", policyId: "p1", carrierId: "mo", periodStart: "2026-08-01", periodEnd: "2026-08-31", owedCents, detail: {} });
const stored = (id, fingerprint, status, owedCents, by = null, at = null) => ({ id, fingerprint, status, owedCents, statusChangedBy: by, statusChangedAt: at });

test("refresh: new opens, cleared reopens, open and disputed keep who decided, stale ones clear", () => {
  const plan = planRefresh(
    [stored("a", "k-cleared", "cleared", 100), stored("b", "k-disputed", "disputed", 5_000, "u1", "2026-09-01T00:00:00Z"), stored("c", "k-gone", "open", 900)],
    [finding("k-new", 1_000), finding("k-cleared", 2_000), finding("k-disputed", 6_000)],
    NOW,
  );
  const by = Object.fromEntries(plan.writes.map((write) => [write.finding.fingerprint, write]));
  assert.equal(by["k-new"].status, "open");
  assert.equal(by["k-new"].statusChangedAt, null, "an insert's history starts at first_seen_at");
  assert.equal(by["k-cleared"].status, "open");
  assert.equal(by["k-cleared"].statusChangedAt, NOW);
  assert.deepEqual([by["k-disputed"].status, by["k-disputed"].statusChangedBy, by["k-disputed"].statusChangedAt], ["disputed", "u1", "2026-09-01T00:00:00Z"], "a dispute keeps who and when; the upsert writes them back unchanged");
  assert.deepEqual(plan.clearIds, ["c"]);
  assert.equal(plan.opened, 2);
  assert.equal(plan.reopened, 0);
});

test("refresh: a resolved or written-off finding stays decided, and reopens only when the carrier owes more", () => {
  const decided = [stored("r", "k-resolved", "resolved", 20_000, "u1", "2026-09-01T00:00:00Z"), stored("w", "k-written", "written_off", 10_000, "u1", "2026-09-01T00:00:00Z")];
  const same = planRefresh(decided, [finding("k-resolved", 20_000), finding("k-written", 10_050)], NOW);
  assert.equal(same.writes.length, 0, "the same money (or rounding more) leaves the decision alone");
  assert.equal(same.reopened, 0);
  const worse = planRefresh(decided, [finding("k-resolved", 50_000), finding("k-written", 10_000)], NOW);
  assert.equal(worse.reopened, 1);
  assert.deepEqual(worse.writes.map((write) => [write.finding.fingerprint, write.status, write.statusChangedBy, write.statusChangedAt]), [["k-resolved", "open", null, NOW]], "reopened by the refresh, not by a person");
  assert.deepEqual(worse.clearIds, [], "a decided finding is never cleared");
  const gone = planRefresh(decided, [], NOW);
  assert.deepEqual(gone.clearIds, [], "nor cleared when it stops applying");
});

test("refresh is idempotent: applying a plan and planning again changes nothing", () => {
  let rows = [stored("a", "k-cleared", "cleared", 100), stored("b", "k-disputed", "disputed", 5_000, "u1", "2026-09-01T00:00:00Z"), stored("c", "k-gone", "open", 900), stored("r", "k-resolved", "resolved", 1_000, "u1", "2026-09-01T00:00:00Z")];
  const findings = [finding("k-new", 1_000), finding("k-cleared", 2_000), finding("k-disputed", 6_000), finding("k-resolved", 9_000)];
  const apply = (current, plan) => {
    const next = current.map((row) => (plan.clearIds.includes(row.id) ? { ...row, status: "cleared", statusChangedBy: null, statusChangedAt: NOW } : row));
    for (const write of plan.writes) {
      const at = next.findIndex((row) => row.fingerprint === write.finding.fingerprint);
      const row = { id: at >= 0 ? next[at].id : write.finding.fingerprint, fingerprint: write.finding.fingerprint, status: write.status, owedCents: write.finding.owedCents, statusChangedBy: write.statusChangedBy, statusChangedAt: write.statusChangedAt };
      if (at >= 0) next[at] = row; else next.push(row);
    }
    return next;
  };
  rows = apply(rows, planRefresh(rows, findings, NOW));
  const second = planRefresh(rows, findings, NOW);
  assert.equal(second.opened, 0);
  assert.equal(second.reopened, 0);
  assert.deepEqual(second.clearIds, []);
  assert.deepEqual(apply(rows, second), rows, "the second refresh writes the same rows back");
});

test("the migration re-keys stored rows to v2, keeps every status change, and checks itself", () => {
  const sql = fs.readFileSync(new URL("../../supabase/migrations/20261006110000_la_4_4_discrepancy_fingerprints_history.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists history jsonb not null default '\[\]'::jsonb/);
  assert.match(sql, /new\.history := old\.history;/, "append-only: history always continues from what is stored");
  assert.match(sql, /'from', old\.status, 'to', new\.status, 'by', new\.status_changed_by/);
  assert.match(sql, /'never_paid\|' \|\| d\.policy_id::text \|\| '\|issue:' \|\| p\.effective_date::text/);
  assert.match(sql, /'unexpected_chargeback\|' \|\| d\.policy_id::text \|\| '\|' \|\| d\.period_start::text \|\| '~' \|\| d\.period_end::text/);
  assert.match(sql, /d\.kind \|\| '\|' \|\| d\.policy_id::text \|\| '\|from:' \|\| d\.period_start::text/);
  assert.match(sql, /order by \(m\.status in \('open', 'disputed'\)\) desc/, "on a collision the finding being worked keeps the key");
  assert.match(sql, /disable trigger tenant_commission_discrepancies_guard[\s\S]*enable trigger tenant_commission_discrepancies_guard/);
  assert.match(sql, /tgname = 'tenant_commission_discrepancies_guard' and tgenabled = 'O'/, "the self-check proves the guard is back on");
  // The app switches to v2 only once this column exists.
  const service = fs.readFileSync(new URL("./service.ts", import.meta.url), "utf8");
  assert.match(service, /select\(`\$\{EXISTING_COLUMNS\}, history`\)[\s\S]*?version: "v2"[\s\S]*?version: "v1"/);
  assert.match(service, /computeDiscrepancies\(\{ \.\.\.inputs, today, fingerprints: existing\.version \}\)/);
  assert.match(service, /status, status_changed_by: statusChangedBy, status_changed_at: statusChangedAt, last_seen_at: now/, "every upserted row carries every status column");
});

// ── only a reviewed statement is evidence (2026-10-06) ───────────────────────────

test("days a statement is still being reviewed for are not judged: no short-paid from a half-reviewed statement", () => {
  const base = {
    policies: [policy("p1")],
    expected: [expected("p1:aug", "p1", 50_000, "2026-08-15")],
    received: [received("l-part", "p1", 20_000)],
    coverage: [],
    today: TODAY,
  };
  assert.equal(computeDiscrepancies(base).length, 1, "without the rule, the accepted part looks short");
  const reviewing = computeDiscrepancies({ ...base, pending: [covered("s-aug")] });
  assert.equal(reviewing.length, 0, "while August is under review, August is not judged");
});

test("an unreviewed statement covering the same days as a reviewed one cannot make the carrier look shorter", () => {
  // Reviewed Jun–Aug pays June; an unreviewed Jul–Aug statement (still being worked) is where the
  // carrier paid July and August. Judging Jul–Aug now would count only the reviewed side.
  const found = computeDiscrepancies({
    policies: [policy("p1")],
    expected: [expected("p1:jun", "p1", 10_000, "2026-06-15"), expected("p1:jul", "p1", 10_000, "2026-07-15"), expected("p1:aug", "p1", 10_000, "2026-08-15")],
    received: [received("l-jun", "p1", 10_000, { statementId: "s-q", periodStart: "2026-06-01", periodEnd: "2026-08-31", postedOn: "2026-06-30" })],
    coverage: [covered("s-q", "2026-06-01", "2026-08-31")],
    pending: [covered("s-jul-aug", "2026-07-01", "2026-08-31")],
    today: TODAY,
  });
  assert.equal(found.filter((item) => item.kind === "short_paid").length, 0, "June is paid in full; July and August wait for the review");
});

test("never paid is not claimed for what fell due while the statement is still being reviewed", () => {
  const args = {
    policies: [policy("p1")],
    expected: [expected("p1:advance", "p1", 54_000, "2026-07-20", { kind: "advance" })],
    received: [],
    coverage: [covered("s-jul", "2026-07-01", "2026-07-31")],
    today: TODAY,
  };
  assert.equal(computeDiscrepancies({ ...args, policies: [policy("p1", { effectiveDate: "2026-05-01" })] }).length, 1);
  assert.equal(computeDiscrepancies({ ...args, policies: [policy("p1", { effectiveDate: "2026-05-01" })], pending: [covered("s-jul-2", "2026-07-01", "2026-07-31")] }).length, 0);
  // Another carrier's unreviewed statement changes nothing for this one.
  assert.equal(computeDiscrepancies({ ...args, policies: [policy("p1", { effectiveDate: "2026-05-01" })], pending: [covered("s-other", "2026-07-01", "2026-07-31", "americo")] }).length, 1);
});
