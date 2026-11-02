// Setup › Pipeline rules (owner 2026-11-02, docs/la4/SIMPLIFY-PROPOSAL.md §4): the events computed from the
// book, and the checks — one function for a preview and a run. DB-free.
// Run with: node --experimental-strip-types --test lib/pipelineRules/pipelineRules.test.mjs
import test from "node:test";
import assert from "node:assert/strict";

import { computeEvents, policyKey } from "./events.ts";
import { doneKey, planRun } from "./plan.ts";
import { fillInsWithoutValue, fillNote, noteProblems, RULE_EVENTS } from "./rules.ts";

const T = "tenant-1";
const AM = "carrier-am";
const MO = "carrier-mo";
const rule = (type, grace, window = 30, tenantId = null, effectiveFrom = "2026-01-01") => ({ id: `${type}-${tenantId}-${grace}`, tenantId, carrierId: AM, ruleType: type, windowDays: window, graceDays: grace, redraftAttempts: null, redraftIntervalDays: null, source: "carrier_agreement", notes: null, effectiveFrom, createdAt: `${effectiveFrom}T00:00:00Z`, cleared: false, verifiedAt: null });
const policy = (over = {}) => ({ carrierId: AM, policyNumber: "AM-1", status: "active", paidToDate: "2026-10-01", effectiveDate: "2026-06-01", issuedOn: "2026-06-01", firstSeenDate: "2026-06-01", premiumCents: 5820, caseId: "case-1", applicationId: null, ...over });
const names = new Map([[AM, "Americo"], [MO, "Mutual of Omaha"]]);
const compute = (input) => computeEvents({ tenantId: T, asOf: "2026-11-02", changes: [], ledger: [], carrierRules: [], carrierNames: names, ...input });

test("every event the owner listed exists, in the proposal's order", () => {
  assert.deepEqual(RULE_EVENTS, ["issued", "waiting_first_payment", "first_payment_missed", "later_payment_missed", "paid_again", "lapsed", "not_taken", "cancelled", "declined", "withdrawn", "advance_received", "commission_credited", "chargeback_received"]);
});

test("a later payment is missed only past the carrier's grace, read from carrier rules — never a default", () => {
  const p = policy({ paidToDate: "2026-10-01" }); // 32 days behind on 2 Nov
  const none = compute({ policies: [p] });
  assert.equal(none.events.filter((e) => e.event === "later_payment_missed").length, 0, "no rule, no event");
  assert.deepEqual(none.carriersWithoutGrace, [AM]);

  const inside = compute({ policies: [p], carrierRules: [rule("ongoing_payment", 45)] });
  assert.equal(inside.events.filter((e) => e.event === "later_payment_missed").length, 0, "32 days is inside a 45-day grace");

  const past = compute({ policies: [p], carrierRules: [rule("ongoing_payment", 31, 60)] });
  const missed = past.events.find((e) => e.event === "later_payment_missed");
  assert.ok(missed);
  assert.equal(missed.date, "2026-11-02", "missed on paid-to + grace + 1");
  assert.equal(missed.fills.days_past_due, 32);
  assert.equal(missed.fills.days_left, 28, "the carrier window counts down from the same days");
  assert.equal(missed.changeKey, `${AM}:AM-1:later_missed:2026-10-01`, "the same miss gives the same key every morning");
});

test("the agency's own dated rule wins over Insurvas's from its date (owner decision 4)", () => {
  const p = policy({ paidToDate: "2026-10-01" });
  const rules = [rule("ongoing_payment", 31), rule("ongoing_payment", 45, 60, T, "2026-11-01")];
  assert.equal(compute({ policies: [p], carrierRules: rules }).events.filter((e) => e.event === "later_payment_missed").length, 0);
  const before = computeEvents({ tenantId: T, asOf: "2026-10-31", policies: [p], changes: [], ledger: [], carrierRules: rules, carrierNames: names });
  assert.equal(before.events.filter((e) => e.event === "later_payment_missed").length, 0, "30 days behind on 31 Oct, inside 31");
  const other = computeEvents({ tenantId: "someone-else", asOf: "2026-11-02", policies: [p], changes: [], ledger: [], carrierRules: rules, carrierNames: names });
  assert.equal(other.events.filter((e) => e.event === "later_payment_missed").length, 1, "another agency keeps Insurvas's 31 days");
});

test("an approved policy waits for its first payment, and misses it past the first-payment grace", () => {
  const p = policy({ status: "approved_unpaid", paidToDate: null, effectiveDate: "2026-10-20", issuedOn: "2026-10-15" });
  const out = compute({ policies: [p], carrierRules: [rule("first_payment", 8, 30)] });
  assert.ok(out.events.find((e) => e.event === "waiting_first_payment"));
  const missed = out.events.find((e) => e.event === "first_payment_missed");
  assert.ok(missed, "13 days late, grace 8");
  assert.equal(missed.date, "2026-10-29");
  assert.equal(missed.fills.days_left, 17);
});

test("status words, an end date, paid again and statement lines become events inside the look-back", () => {
  const p = policy({ paidToDate: "2026-11-01" });
  const changes = [
    { carrierId: AM, policyNumber: "AM-1", field: "status_normalized", oldValue: "active", newValue: "lapsed", fromDate: "2026-10-30", toDate: "2026-11-01" },
    { carrierId: AM, policyNumber: "AM-1", field: "paid_to_date", oldValue: "2026-09-01", newValue: "2026-11-01", fromDate: "2026-10-12", toDate: "2026-10-20" },
    { carrierId: AM, policyNumber: "AM-2", field: "termination_date", oldValue: null, newValue: "2026-10-31", fromDate: "2026-10-30", toDate: "2026-10-31" },
    { carrierId: AM, policyNumber: "AM-3", field: "status_normalized", oldValue: "active", newValue: "lapsed", fromDate: "2026-08-01", toDate: "2026-08-02" },
  ];
  const ledger = [
    { id: "l1", carrierId: AM, policyNumber: "AM-1", entryType: "advance", amountCents: 64200, date: "2026-10-21", reversesEntryId: null },
    { id: "l2", carrierId: AM, policyNumber: "AM-1", entryType: "chargeback", amountCents: -16050, date: "2026-10-25", reversesEntryId: null },
    { id: "l3", carrierId: AM, policyNumber: "AM-1", entryType: "reversal", amountCents: 16050, date: "2026-10-26", reversesEntryId: "l2" },
  ];
  const out = compute({ policies: [p], changes, ledger, carrierRules: [rule("ongoing_payment", 31)] });
  const kinds = out.events.map((e) => `${e.event}:${e.policyNumber}`).sort();
  assert.ok(kinds.includes("lapsed:AM-1"));
  assert.ok(kinds.includes("paid_again:AM-1"), "49 days behind before the file, past a 31-day grace");
  assert.ok(kinds.includes("cancelled:AM-2"));
  assert.ok(!kinds.includes("lapsed:AM-3"), "a lapse from August is outside the 30-day look-back");
  assert.ok(kinds.includes("advance_received:AM-1"));
  assert.ok(!kinds.includes("chargeback_received:AM-1"), "a reversed line is no event");
  assert.equal(out.events.find((e) => e.event === "advance_received").fills.amount, "$642.00");
});

test("a note fills its fill-ins, says 'not known' for a missing one, and names ones the event never has", () => {
  assert.equal(fillNote("Paid to {paid_to_date}, {days_past_due} days late, {days_left} left. {other}", { paid_to_date: "1 Oct 2026", days_past_due: 32, days_left: null }), "Paid to 1 Oct 2026, 32 days late, not known left. {other}");
  assert.deepEqual(fillInsWithoutValue("{amount} on {policy_number}", "lapsed"), ["amount"]);
  assert.deepEqual(noteProblems(true, "  "), ["Write the note, or switch the note off."]);
  assert.match(noteProblems(true, "{paid_to}")[0], /not fill-ins/);
  assert.deepEqual(noteProblems(false, null), []);
});

// ── the checks ─────────────────────────────────────────────────────────────────────────────────────

const STAGES = new Map([
  ["s-issued", { id: "s-issued", name: "Issued", pipelineId: "p-sales", pipelineName: "Sales", archived: false }],
  ["s-paying", { id: "s-paying", name: "Paying", pipelineId: "p-sales", pipelineName: "Sales", archived: false }],
  ["s-missed", { id: "s-missed", name: "First payment missed", pipelineId: "p-ret", pipelineName: "Retention", archived: false }],
  ["s-lapsed", { id: "s-lapsed", name: "Lapsed", pipelineId: "p-ret", pipelineName: "Retention", archived: false }],
  ["s-old", { id: "s-old", name: "Old", pipelineId: "p-ret", pipelineName: "Retention", archived: true }],
]);
const spec = (over = {}) => ({ ruleId: "r1", name: "Lapsed", mode: "forecast", enabled: true, versionId: "v1", version: 1, event: "lapsed", carrierIds: [], fromStageIds: [], targetPipelineId: "p-ret", targetStageId: "s-lapsed", noteOn: true, noteTemplate: "Lapsed: {policy_number}", since: null, ...over });
const ev = (n, over = {}) => ({ event: "lapsed", carrierId: AM, policyNumber: `AM-${n}`, date: "2026-11-01", changeKey: `${AM}:AM-${n}:status:lapsed:2026-11-01`, fills: { policy_number: `AM-${n}` }, because: "status lapsed", ...over });
const lead = (n, over = {}) => ({ leadId: `lead-${n}`, pipelineId: "p-sales", stageId: "s-issued", lastHandMoveAt: null, openPolicies: [], ...over });
const plan = (over = {}) => planRun({ now: "2026-11-02T12:00:00Z", rules: [spec()], events: [ev(1)], leads: new Map([[policyKey(AM, "AM-1"), lead(1)]]), stages: STAGES, done: new Set(), cap: 25, handMoveDays: 7, ...over });

test("a rule that passes every check moves the card once, with its note", () => {
  const { decisions } = plan();
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].outcome, "move");
  assert.equal(decisions[0].mode, "forecast");
  assert.equal(decisions[0].note, "Lapsed: AM-1");
  assert.equal(decisions[0].reason, "Sales › Issued → Retention › Lapsed");
});

test("once only: a change already recorded for this rule, version and mode is left out", () => {
  assert.equal(plan({ done: new Set([doneKey("r1", 1, "forecast", ev(1).changeKey)]) }).decisions.length, 0);
  assert.equal(plan({ done: new Set([doneKey("r1", 1, "forecast", ev(1).changeKey)]), rules: [spec({ version: 2 })] }).decisions.length, 1, "a new version looks again");
  assert.equal(plan({ done: new Set([doneKey("r1", 1, "forecast", ev(1).changeKey)]), rules: [spec({ mode: "live" })] }).decisions.length, 1, "going live is its own mode");
});

test("each skip says why: no lead (waits), stage gone, already there, from-stage, by hand, another policy", () => {
  const one = (over) => plan(over).decisions[0];
  assert.equal(one({ leads: new Map([[policyKey(AM, "AM-1"), null]]) }).outcome, "wait");
  assert.match(one({ rules: [spec({ targetStageId: "s-old" })] }).reason, /no longer on the board/);
  assert.match(one({ leads: new Map([[policyKey(AM, "AM-1"), lead(1, { stageId: "s-lapsed", pipelineId: "p-ret" })]]) }).reason, /^Already in Retention › Lapsed/);
  assert.match(one({ rules: [spec({ fromStageIds: ["s-paying"] })] }).reason, /not a stage this rule moves from/);
  assert.match(one({ leads: new Map([[policyKey(AM, "AM-1"), lead(1, { lastHandMoveAt: "2026-10-30T09:00:00.000Z" })]]) }).reason, /^Moved by hand on 2026-10-30/);
  assert.equal(one({ leads: new Map([[policyKey(AM, "AM-1"), lead(1, { lastHandMoveAt: "2026-10-20T09:00:00.000Z" })]]) }).outcome, "move", "a hand move 13 days ago no longer protects it");
  assert.match(one({ leads: new Map([[policyKey(AM, "AM-1"), lead(1, { openPolicies: [policyKey(AM, "AM-1"), policyKey(MO, "MO-9")] })]]) }).reason, /another open policy \(MO-9\)/);
  assert.equal(one({ rules: [spec({ carrierIds: [MO] })] }), undefined, "a rule for another carrier ignores it");
  assert.equal(one({ rules: [spec({ enabled: false })] }), undefined, "a rule switched off does nothing");
  assert.equal(one({ rules: [spec({ mode: "draft" })] }), undefined, "a draft does nothing");
  assert.equal(one({ rules: [spec({ mode: "draft" })], previewRuleId: "r1" }).outcome, "move", "but a preview of the draft runs the same checks");
});

test("live replays nothing from before it went live, unless a person asks", () => {
  const live = spec({ mode: "live", since: "2026-11-02" });
  assert.equal(plan({ rules: [live] }).decisions.length, 0);
  assert.equal(plan({ rules: [live], replay: new Set(["r1"]) }).decisions[0].outcome, "move");
  assert.equal(plan({ rules: [spec({ mode: "live", since: "2026-11-01" })] }).decisions[0].outcome, "move", "on the day it went live counts");
});

test("two rules that disagree about one card hold it; two that agree move it once", () => {
  const paid = spec({ ruleId: "r2", name: "Paid again", event: "lapsed", targetStageId: "s-paying", targetPipelineId: "p-sales" });
  const held = plan({ rules: [spec(), paid] }).decisions;
  assert.deepEqual(held.map((d) => d.outcome), ["hold", "hold"]);
  assert.match(held[0].reason, /^Rules disagree: Lapsed → Retention › Lapsed; Paid again → Sales › Paying/);
  const same = plan({ rules: [spec(), spec({ ruleId: "r3", name: "Also lapsed" })] }).decisions;
  assert.deepEqual(same.map((d) => d.outcome).sort(), ["move", "skip"]);
  const live = plan({ rules: [spec(), spec({ ruleId: "r4", name: "Live lapsed", mode: "live", targetStageId: "s-missed" })] }).decisions;
  assert.deepEqual(live.map((d) => d.outcome), ["move", "move"], "a forecast rule never holds a live one");
});

test("the cap stops a run at 25 moves per mode, oldest first; the rest are not recorded", () => {
  const events = Array.from({ length: 27 }, (_, i) => ev(i + 1, { date: `2026-10-${String(i + 1).padStart(2, "0")}` }));
  const leads = new Map(events.map((e, i) => [policyKey(AM, e.policyNumber), lead(i + 1)]));
  const out = plan({ events, leads });
  assert.equal(out.decisions.filter((d) => d.outcome === "move").length, 25);
  assert.equal(out.capped.forecast, 2);
  assert.equal(out.capped.live, 0);
  assert.deepEqual(out.decisions.filter((d) => d.outcome === "capped").map((d) => d.policyNumber), ["AM-26", "AM-27"]);
});
