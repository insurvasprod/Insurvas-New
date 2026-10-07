// LA-4.17 (Notion sprint) · carrier rules: resolution, effective dating, null means null, coverage gaps.
import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { coverageGaps, daysUntilCarrierCloses, resolveRule, resolveSettings, RULE_TYPES } from "./carrierRules.ts";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const T = "tenant-a";
const C = "carrier-1";
let n = 0;
const rule = (over) => ({ id: `r${++n}`, tenantId: null, carrierId: C, ruleType: "ongoing_payment", windowDays: 45, graceDays: null, redraftAttempts: null, redraftIntervalDays: null, source: "observed", notes: null, effectiveFrom: "2026-01-01", createdAt: "2026-01-01T00:00:00Z", cleared: false, verifiedAt: null, ...over });
const at = (rules, asOf = "2026-10-07", tenantId = T, ruleType = "ongoing_payment") => resolveRule(rules, { tenantId, carrierId: C, ruleType, asOf });

test("absent is null — no rule anywhere gives no rule and no countdown, never a default", () => {
  assert.equal(at([]), null);
  assert.equal(daysUntilCarrierCloses(null, 10), null);
  assert.equal(daysUntilCarrierCloses({ windowDays: null }, 10), null, "a rule with grace only still has no window");
  assert.equal(at([rule({ carrierId: "other" })]), null, "another carrier's rule does not leak");
  assert.equal(at([rule({ ruleType: "first_payment" })]), null, "nor another kind of save");
});

test("the agency's own rule wins over the platform's; the platform's is the fallback", () => {
  const platform = rule({ windowDays: 45 });
  const mine = rule({ tenantId: T, windowDays: 30, source: "carrier_agreement" });
  assert.equal(at([platform]).windowDays, 45);
  assert.equal(at([platform]).scope, "platform");
  assert.equal(at([platform, mine]).windowDays, 30);
  assert.equal(at([platform, mine]).scope, "agency");
  assert.equal(at([platform, rule({ tenantId: "tenant-b", windowDays: 10 })]).windowDays, 45, "another agency's override is not mine");
  assert.equal(at([platform, mine], "2026-10-07", null).scope, "platform", "the platform plane sees only platform rules");
});

test("clearing an override hands the rule back to the platform — or to nothing", () => {
  const platform = rule({ windowDays: 45 });
  const mine = rule({ tenantId: T, windowDays: 30, effectiveFrom: "2026-03-01" });
  const cleared = rule({ tenantId: T, windowDays: null, source: null, cleared: true, effectiveFrom: "2026-06-01" });
  assert.equal(at([platform, mine, cleared]).scope, "platform");
  assert.equal(at([platform, mine, cleared], "2026-05-01").windowDays, 30, "before the clear, the override held");
  assert.equal(at([mine, cleared]), null);
});

test("effective dating: the rule in force is the latest on or before the date; a past date keeps its rule", () => {
  const old = rule({ windowDays: 45, effectiveFrom: "2026-01-01" });
  const next = rule({ windowDays: 60, effectiveFrom: "2026-11-01" });
  assert.equal(at([old, next], "2026-10-31").windowDays, 45);
  assert.equal(at([old, next], "2026-11-01").windowDays, 60);
  assert.equal(at([next], "2026-10-31"), null, "a future rule is not in force yet");
  const sameDayLater = rule({ windowDays: 50, effectiveFrom: "2026-01-01", createdAt: "2026-01-02T00:00:00Z" });
  assert.equal(at([sameDayLater, old], "2026-10-07").windowDays, 50, "same day: the newest row wins, whatever the order");
});

test("unverified rules are used but marked unverified", () => {
  assert.equal(at([rule({})]).verified, false);
  assert.equal(at([rule({ verifiedAt: "2026-10-06T00:00:00Z" })]).verified, true);
});

test("the countdown is window minus days past due", () => {
  assert.equal(daysUntilCarrierCloses({ windowDays: 45 }, 10), 35);
  assert.equal(daysUntilCarrierCloses({ windowDays: 45 }, 50), -5);
  assert.equal(daysUntilCarrierCloses({ windowDays: 8 }, -3), 8, "not yet due counts as zero days");
});

test("coverage: every missing window is a sentence with the in-force count", () => {
  const resolved = Object.fromEntries(RULE_TYPES.map((type) => [type, null]));
  resolved.ongoing_payment = { ...rule({}), scope: "platform", verified: false };
  const gaps = coverageGaps({ carrierName: "Aetna", inForce: 340, resolved });
  assert.equal(gaps.length, RULE_TYPES.length - 1);
  assert.equal(gaps[0].sentence, "Aetna — first payment window not set. 340 policies in force; we cannot tell you how long you have to save these.");
  assert.equal(coverageGaps({ carrierName: "X", inForce: 1, resolved })[0].sentence, "X — first payment window not set. 1 policy in force; we cannot tell you how long you have to save it.");
  assert.equal(coverageGaps({ carrierName: "X", inForce: 0, resolved })[0].sentence, "X — first payment window not set.");
  resolved.first_payment = { ...rule({ windowDays: null, graceDays: 5 }), scope: "agency", verified: false };
  assert.ok(coverageGaps({ carrierName: "X", inForce: 0, resolved }).some((gap) => gap.ruleType === "first_payment"), "grace with no window is still a gap");
});

test("settings: the agency's value, else the platform's, else null", () => {
  const platform = { tenantId: null, carrierId: C, commissionTrigger: "on_issue", expectedLagDays: 30, minimumPayoutCents: null, toleranceCents: 100, expectedCadence: null, statementFormat: "spreadsheet" };
  const agency = { ...platform, tenantId: T, commissionTrigger: null, expectedLagDays: 14, toleranceCents: null, statementFormat: null };
  const s = resolveSettings(platform, agency);
  assert.deepEqual(s.expectedLagDays, { value: 14, scope: "agency" });
  assert.deepEqual(s.commissionTrigger, { value: "on_issue", scope: "platform" });
  assert.deepEqual(s.minimumPayoutCents, { value: null, scope: null });
  assert.deepEqual(resolveSettings(null, null).toleranceCents, { value: null, scope: null });
});

test("nothing in the new ingestion code hard-codes a window, a grace, a lag or a redraft count", () => {
  // The old statements engine (NEVER_PAID_GRACE_DAYS) is outside lib/ingestion and retires with it.
  const files = readdirSync(new URL("./", import.meta.url)).filter((name) => /\.tsx?$/.test(name));
  for (const name of files) {
    const source = read(`lib/ingestion/${name}`);
    assert.doesNotMatch(source, /(window|grace|lag|redraft)\w*\s*[:=]\s*\d/i, `${name} has a hard-coded rule number`);
    assert.doesNotMatch(source, /_(WINDOW|GRACE|LAG)_DAYS\b/, `${name} has a rule constant`);
  }
});

test("the migration: append-only, no default window, sourced, seeds observed and unverified", () => {
  const sql = read("supabase/migrations/20261008150000_la_4_17_carrier_rules.sql");
  assert.match(sql, /create trigger carrier_retention_rule_guard before update or delete/);
  assert.match(sql, /revoke delete, truncate on public\.carrier_retention_rule/);
  assert.doesNotMatch(sql, /window_days[^,\n]*default/i, "no default window");
  assert.doesNotMatch(sql, /grace_days[^,\n]*default/i, "no default grace");
  assert.match(sql, /constraint carrier_retention_rule_source check/);
  const seeds = sql.match(/insert into public\.carrier_retention_rule[\s\S]*?;/g) ?? [];
  assert.equal(seeds.length, 2, "only the two carriers the spec gives and the library has");
  for (const seed of seeds) {
    assert.match(seed, /'observed'/);
    assert.doesNotMatch(seed, /verified_at/);
    assert.match(seed, /not exists/);
  }
});

test("the screens say missing and unverified out loud", () => {
  const ui = read("components/app/carrier-rules-workspace.tsx");
  assert.match(ui, /"Not set"/);
  assert.match(ui, /"unverified"/);
  assert.match(read("app/app/(shell)/carrier-rules/page.tsx"), /guardPage\("statement_ingestion"\)/);
});
